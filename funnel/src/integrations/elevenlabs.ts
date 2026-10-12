// Outbound AI calls through ElevenLabs Conversational AI (Twilio number imported in ElevenLabs).
// Consent-gated, per-number and daily caps, calling hours from the PHONE NUMBER's country,
// do-not-call re-checked at queue time and at every dial, verified bookings only.

import type { Runtime } from "../app";
import { AI_CALLER, BRAND, FAQS, OUTBOUND_FIRST_MESSAGE, inboundSystemPrompt, outboundSystemPrompt } from "../config";
import { hmacHex, safeEqual } from "../lib/crypto";
import { newId } from "../lib/ids";
import { callingZones, phoneCountry } from "../lib/phone";
import { safeBusiness, safeFirstName, clip } from "../lib/text";
import { getLead, updateLead, effectiveTier, type Lead } from "../funnel/leads";
import { getRep } from "../sales/reps";
import { saveSetting } from "../settings";
import { track } from "../tracking/track";
import { callableCountry, nextCallingTime } from "./calling-rules";
import { formatCallTime, leadTimezone, sendOneOff } from "./email";
import { notifyTeam } from "./notify";

export type CallKind = "confirm" | "speed_to_lead" | "rebook" | "test";
const API = "https://api.elevenlabs.io/v1";
const MIN = 60_000;
const H = 60 * MIN;

const KIND_SETTING: Record<Exclude<CallKind, "test">, string> = {
  confirm: "AI_CALL_CONFIRM", speed_to_lead: "AI_CALL_SPEED_TO_LEAD", rebook: "AI_CALL_REBOOK",
};

/** Why this lead must not be called for this kind right now, or null. Pure. */
export function blockReason(lead: Lead, kind: CallKind, now: number): string | null {
  if (kind === "test") return null;
  if (!lead.phone) return "no phone";
  if (lead.do_not_call_at) return "do not call";
  if (!lead.call_consent_at) return "no consent";
  if (lead.unsubscribed_at) return "unsubscribed";
  if (lead.booking_source === "calendly-direct") return "imported contact";
  if (!callableCountry(lead.phone)) return "country not served";
  if (kind === "confirm") {
    if (lead.status !== "booked" || !lead.call_at || lead.booking_cancelled_at) return "not booked";
    if (lead.call_at - now < 30 * MIN) return "call too close";
  }
  if (kind === "speed_to_lead") {
    if (lead.call_at || lead.status !== "applied") return "already booked or not applied";
    const t = effectiveTier(lead);
    if (t !== "A" && t !== "B") return "tier";
  }
  if (kind === "rebook" && lead.status !== "no_show") return "not a no-show";
  return null;
}

/** Calls that would be stale by run time are dropped. Pure. */
export function isStale(lead: Lead, kind: CallKind, runAt: number, createdAt: number): boolean {
  if (kind === "confirm") return !lead.call_at || lead.call_at - runAt < 30 * MIN;
  if (kind === "speed_to_lead" || kind === "rebook") return runAt - createdAt > 72 * H;
  return false;
}

/** Do-not-call belongs to the phone number, not the lead: a new application cannot undo it. */
export async function numberOnDnc(rt: Runtime, phone: string | null): Promise<boolean> {
  if (!phone) return false;
  const r = await rt.env.DB.prepare("SELECT 1 AS x FROM leads WHERE phone = ? AND do_not_call_at IS NOT NULL LIMIT 1").bind(phone).first();
  return !!r;
}

export async function queueCall(rt: Runtime, lead: Lead, kind: Exclude<CallKind, "test">): Promise<{ queued: boolean; reason?: string }> {
  const s = rt.settings;
  if (!s.bool(KIND_SETTING[kind])) return { queued: false, reason: "disabled" };
  const now = rt.now();
  const block = blockReason(lead, kind, now);
  if (block) return { queued: false, reason: block };
  if (await numberOnDnc(rt, lead.phone)) return { queued: false, reason: "number on do-not-call" };
  if (!/^\+\d{8,15}$/.test(s.get("AI_CALL_CALLBACK_NUMBER"))) return { queued: false, reason: "no callback number set" };
  const db = rt.env.DB;
  const live = await db.prepare("SELECT id FROM outbound_calls WHERE lead_id = ? AND kind = ? AND status IN ('queued','dialing')").bind(lead.id, kind).first();
  if (live) return { queued: false, reason: "already queued" };
  const week = await db.prepare("SELECT COUNT(*) AS n FROM outbound_calls WHERE phone = ? AND created_at > ? AND status != 'cancelled'").bind(lead.phone, now - 7 * 24 * H).first<{ n: number }>();
  if ((week?.n || 0) >= AI_CALLER.perNumberPerWeek) return { queued: false, reason: "weekly cap for this number" };
  const zones = callingZones(lead.phone);
  const runAt = nextCallingTime(now + AI_CALLER.delays[kind] * MIN, zones, phoneCountry(lead.phone));
  if (!runAt) return { queued: false, reason: "no calling window" };
  if (isStale(lead, kind, runAt, now)) return { queued: false, reason: "would be stale" };
  const ins = await db.prepare(
    "INSERT OR IGNORE INTO outbound_calls (id, lead_id, kind, phone, status, run_at, attempts, created_at, updated_at) VALUES (?,?,?,?, 'queued', ?, 0, ?, ?)",
  ).bind(newId("c"), lead.id, kind, lead.phone, runAt, now, now).run();
  if (!ins.meta?.changes) return { queued: false, reason: "already queued" };
  await track(rt, { leadId: lead.id }, { name: "ai_call_queued", source: "server", props: { kind }, localOnly: true });
  return { queued: true };
}

export async function cancelCalls(rt: Runtime, leadId: string, kinds: CallKind[]): Promise<void> {
  if (!kinds.length) return;
  await rt.env.DB.prepare(
    `UPDATE outbound_calls SET status='cancelled', updated_at=? WHERE lead_id = ? AND status = 'queued' AND kind IN (${kinds.map(() => "?").join(",")})`,
  ).bind(rt.now(), leadId, ...kinds).run();
}

function opening(kind: CallKind, closer: string, callTime: string): string {
  if (kind === "confirm") return `I'm calling to confirm your call with ${closer} on ${callTime}. Does that still work for you?`;
  if (kind === "speed_to_lead") return `Thanks for applying for Operator. I can send you a link to pick a time with ${closer}. Would that help?`;
  if (kind === "rebook") return `We missed you on your call with ${closer}. I can send a link to pick a new time. Would that help?`;
  return "This is a test call from Funnel HQ.";
}

function voicemail(kind: CallKind, callback: string): string {
  const who = "This is an automated message from Operator by Asym.";
  const end = ` To reach us or to stop these calls, call ${callback}.`;
  if (kind === "confirm") return `${who} Calling to confirm your call. Your confirmation email has the details.${end}`;
  if (kind === "speed_to_lead") return `${who} Calling about your application. We have emailed you a link to book a time.${end}`;
  if (kind === "rebook") return `${who} Sorry we missed you. We have emailed you a link to pick a new time.${end}`;
  return `${who} This was a test call.${end}`;
}

export async function dynamicVariables(rt: Runtime, lead: Lead | null, kind: CallKind): Promise<Record<string, string>> {
  const rep = lead ? await getRep(rt, lead.closer_id) : null;
  const closer = safeFirstName(rep?.name || BRAND.founder, BRAND.founder);
  const tz = lead ? await leadTimezone(rt, lead) : "UTC";
  const callTime = lead?.call_at ? formatCallTime(lead.call_at, tz) : "your call";
  let business = "";
  if (lead) {
    try { business = safeBusiness(JSON.parse(lead.answers || "{}").business); } catch { business = ""; }
  }
  return {
    first_name: safeFirstName(lead?.first_name),
    opening: opening(kind, closer, callTime),
    call_kind: kind,
    call_time: callTime,
    closer_name: closer,
    business,
    tier: lead ? effectiveTier(lead) || "" : "",
    lead_ref: lead?.ref_code || "TEST",
    callback_number: rt.settings.get("AI_CALL_CALLBACK_NUMBER") || "the number in our email",
    voicemail_reason: voicemail(kind, rt.settings.get("AI_CALL_CALLBACK_NUMBER") || "the number in our email"),
  };
}

async function api(rt: Runtime, path: string, init: RequestInit = {}): Promise<{ ok: boolean; status: number; json: Record<string, unknown> }> {
  const r = await fetch(`${API}${path}`, {
    ...init,
    headers: { "xi-api-key": rt.settings.get("ELEVENLABS_API_KEY"), "content-type": "application/json", ...(init.headers || {}) },
  });
  const json = (await r.json().catch(() => ({}))) as Record<string, unknown>;
  return { ok: r.ok, status: r.status, json };
}

export function voiceConfigured(rt: Runtime): boolean {
  const s = rt.settings;
  return s.has("ELEVENLABS_API_KEY") && s.has("ELEVENLABS_AGENT_ID") && s.has("ELEVENLABS_PHONE_NUMBER_ID");
}

async function dial(rt: Runtime, phone: string, vars: Record<string, string>): Promise<{ ok: boolean; conversationId?: string; callSid?: string; error?: string }> {
  const r = await api(rt, "/convai/twilio/outbound-call", {
    method: "POST",
    body: JSON.stringify({
      agent_id: rt.settings.get("ELEVENLABS_AGENT_ID"),
      agent_phone_number_id: rt.settings.get("ELEVENLABS_PHONE_NUMBER_ID"),
      to_number: phone,
      conversation_initiation_client_data: { dynamic_variables: vars },
    }),
  });
  if (!r.ok) return { ok: false, error: `elevenlabs ${r.status}: ${JSON.stringify(r.json).slice(0, 200)}` };
  return { ok: true, conversationId: String(r.json.conversation_id || ""), callSid: String(r.json.callSid || r.json.call_sid || "") };
}

interface CallRow { id: string; lead_id: string; kind: CallKind; phone: string; status: string; run_at: number; attempts: number; created_at: number; }

export async function processCallQueue(rt: Runtime): Promise<number> {
  const now = rt.now();
  const db = rt.env.DB;
  const due = (await db.prepare("SELECT * FROM outbound_calls WHERE status = 'queued' AND run_at <= ? ORDER BY run_at LIMIT 10").bind(now).all<CallRow>()).results || [];
  let dialed = 0;
  const dayStart = now - 24 * H;
  for (const c of due) {
    const claim = await db.prepare("UPDATE outbound_calls SET status='dialing', attempts = attempts + 1, updated_at = ? WHERE id = ? AND status = 'queued'").bind(now, c.id).run();
    if (!claim.meta?.changes) continue;
    const lead = await getLead(rt, c.lead_id);
    const fail = async (status: string, outcome: string) => {
      await db.prepare("UPDATE outbound_calls SET status=?, outcome=?, updated_at=? WHERE id=?").bind(status, outcome, rt.now(), c.id).run();
    };
    if (!lead) { await fail("cancelled", "lead gone"); continue; }
    // Re-check everything at dial time, including retries.
    if (!rt.settings.bool(KIND_SETTING[c.kind as Exclude<CallKind, "test">] || "AI_CALL_CONFIRM")) { await fail("cancelled", "disabled"); continue; }
    const block = blockReason(lead, c.kind, now);
    if (block) { await fail("cancelled", block); continue; }
    if (lead.phone !== c.phone) { await fail("cancelled", "phone changed"); continue; }
    if (await numberOnDnc(rt, c.phone)) { await fail("cancelled", "number on do-not-call"); continue; }
    if (!/^\+\d{8,15}$/.test(rt.settings.get("AI_CALL_CALLBACK_NUMBER"))) { await fail("cancelled", "no callback number set"); continue; }
    if (isStale(lead, c.kind, now, c.created_at)) { await fail("cancelled", "stale"); continue; }
    const zones = callingZones(c.phone);
    const next = nextCallingTime(now, zones, phoneCountry(c.phone));
    if (next == null || next > now) {
      await db.prepare("UPDATE outbound_calls SET status='queued', attempts = attempts - 1, run_at = ?, updated_at = ? WHERE id = ?").bind(next ?? now + 24 * H, now, c.id).run();
      continue;
    }
    const today = await db.prepare("SELECT COUNT(*) AS n FROM outbound_calls WHERE status IN ('dialing','done') AND updated_at > ? AND (outcome IS NULL OR outcome != 'simulated')").bind(dayStart).first<{ n: number }>();
    if ((today?.n || 0) >= rt.settings.num("AI_CALL_DAILY_CAP", 40)) {
      await db.prepare("UPDATE outbound_calls SET status='queued', attempts = attempts - 1, run_at = ?, updated_at = ? WHERE id = ?").bind(now + 2 * H, now, c.id).run();
      continue;
    }
    if (!voiceConfigured(rt)) {
      await fail("done", "simulated");
      await track(rt, { leadId: lead.id }, { name: "ai_call_started", source: "cron", props: { kind: c.kind, simulated: true }, localOnly: true });
      continue;
    }
    const vars = await dynamicVariables(rt, lead, c.kind);
    const r = await dial(rt, c.phone, vars);
    if (!r.ok) {
      if (c.attempts + 1 < AI_CALLER.maxAttempts) {
        await db.prepare("UPDATE outbound_calls SET status='queued', run_at=?, error=?, updated_at=? WHERE id=?").bind(now + AI_CALLER.retryAfterMin * MIN, r.error || null, now, c.id).run();
      } else await db.prepare("UPDATE outbound_calls SET status='failed', error=?, updated_at=? WHERE id=?").bind(r.error || null, now, c.id).run();
      continue;
    }
    await db.prepare("UPDATE outbound_calls SET conversation_id=?, call_sid=?, updated_at=? WHERE id=?").bind(r.conversationId || null, r.callSid || null, now, c.id).run();
    await track(rt, { leadId: lead.id }, { name: "ai_call_started", source: "cron", props: { kind: c.kind } });
    dialed++;
  }
  return dialed;
}

export async function testCall(rt: Runtime, to: string): Promise<{ ok: boolean; error?: string }> {
  if (!voiceConfigured(rt)) return { ok: false, error: "Voice is not configured yet." };
  const r = await dial(rt, to, await dynamicVariables(rt, null, "test"));
  return r.ok ? { ok: true } : { ok: false, error: r.error };
}

// ── Webhook ───────────────────────────────────────────────────────────────────

/** ElevenLabs-Signature: "t=<unix>,v0=<hex hmac of `${t}.${body}`>". 30-minute replay window. */
export async function verifyElevenLabs(secret: string, header: string | null, rawBody: string, nowMs: number): Promise<boolean> {
  if (!secret || !header) return false;
  const parts = Object.fromEntries(header.split(",").map((p) => p.trim().split("=", 2) as [string, string]));
  const t = Number(parts.t);
  const sig = parts.v0 || "";
  if (!t || !sig) return false;
  if (Math.abs(nowMs / 1000 - t) > 30 * 60) return false;
  return safeEqual(await hmacHex(secret, `${t}.${rawBody}`), sig);
}

interface PostCall {
  type?: string;
  data?: {
    agent_id?: string;
    conversation_id?: string;
    status?: string;
    transcript?: Array<{ role?: string; message?: string }>;
    metadata?: { call_duration_secs?: number; cost?: number; start_time_unix_secs?: number; phone_call?: { external_number?: string; direction?: string } };
    analysis?: { transcript_summary?: string; call_successful?: string; data_collection_results?: Record<string, { value?: unknown }> };
    conversation_initiation_client_data?: { dynamic_variables?: Record<string, unknown> };
  };
}

export function structuredResults(d: PostCall["data"]): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(d?.analysis?.data_collection_results || {})) out[k.slice(0, 40)] = v?.value ?? null;
  return out;
}

export async function handlePostCall(rt: Runtime, body: PostCall): Promise<{ ok: boolean; leadId?: string }> {
  const d = body.data;
  if (!d?.conversation_id) return { ok: false };
  const db = rt.env.DB;
  const now = rt.now();
  const call = await db.prepare("SELECT * FROM outbound_calls WHERE conversation_id = ?").bind(d.conversation_id).first<CallRow>();
  const inbound = d.agent_id && d.agent_id === rt.settings.get("ELEVENLABS_INBOUND_AGENT_ID");
  let lead: Lead | null = call ? await getLead(rt, call.lead_id) : null;
  let matchKind = call ? "outbound_call" : null;
  if (!lead && !inbound) {
    const ref = String(d.conversation_initiation_client_data?.dynamic_variables?.lead_ref || "");
    if (/^OP-[A-Z0-9]{6}$/.test(ref)) {
      lead = await db.prepare("SELECT * FROM leads WHERE ref_code = ?").bind(ref).first<Lead>();
      if (lead) matchKind = "lead_ref";
    }
  }
  const structured = structuredResults(d);
  const transcript = (d.transcript || []).slice(0, 200).map((t) => `${t.role === "agent" ? "Agent" : "Caller"}: ${clip(t.message, 1000)}`).join("\n");
  await db.prepare(
    `INSERT INTO voice_calls (id, provider, direction, conversation_id, lead_id, outbound_call_id, phone, status, started_at, duration_s, transcript, summary, structured, cost, match_kind, created_at)
     VALUES (?, 'elevenlabs', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(conversation_id) DO UPDATE SET status=excluded.status, transcript=excluded.transcript, summary=excluded.summary, structured=excluded.structured, duration_s=excluded.duration_s, cost=excluded.cost`,
  ).bind(
    newId("vc"), inbound ? "inbound" : "outbound", d.conversation_id, lead?.id ?? null, call?.id ?? null,
    call?.phone ?? d.metadata?.phone_call?.external_number ?? null, d.status ?? null,
    d.metadata?.start_time_unix_secs ? d.metadata.start_time_unix_secs * 1000 : now, d.metadata?.call_duration_secs ?? null,
    transcript.slice(0, 60_000), clip(d.analysis?.transcript_summary, 2000) || null, JSON.stringify(structured), d.metadata?.cost ?? null, matchKind, now,
  ).run();

  // Inbound callers are never acted on from the webhook (caller ID can be spoofed).
  if (inbound || !lead || !call) return { ok: true, leadId: lead?.id };

  const voicemail = structured.reached_voicemail === true || d.status === "voicemail";
  const answered = !voicemail && (d.metadata?.call_duration_secs || 0) > 10;
  await db.prepare("UPDATE outbound_calls SET status='done', outcome=?, updated_at=? WHERE id=?").bind(voicemail ? "voicemail" : answered ? "answered" : "no_answer", now, call.id).run();
  await track(rt, { leadId: lead.id }, { name: answered ? "ai_call_completed" : "ai_call_unanswered", source: "webhook", props: { kind: call.kind } });

  if (structured.do_not_call === true) {
    await updateLead(rt, lead.id, { do_not_call_at: now });
    await cancelCalls(rt, lead.id, ["confirm", "speed_to_lead", "rebook"]);
  }
  if (!answered && call.attempts < AI_CALLER.maxAttempts && structured.do_not_call !== true) {
    const fresh = await getLead(rt, lead.id);
    if (fresh && !blockReason(fresh, call.kind, now)) {
      const next = nextCallingTime(now + AI_CALLER.retryAfterMin * MIN, callingZones(fresh.phone), phoneCountry(fresh.phone));
      if (next && !isStale(fresh, call.kind, next, call.created_at)) {
        await db.prepare("UPDATE outbound_calls SET status='queued', run_at=?, updated_at=? WHERE id=?").bind(next, now, call.id).run();
      }
    }
  }
  if (structured.wants_booking_link === true) await sendOneOff(rt, lead, "voice", "voice_link_book");
  if (structured.wants_reschedule === true) await sendOneOff(rt, lead, "voice", "voice_link_reschedule");
  if (answered) rt.waitUntil(notifyTeam(rt, "ai_call", lead, `${call.kind.replace(/_/g, " ")}: ${structured.do_not_call === true ? "asked not to be called" : structured.wants_reschedule === true ? "wants to reschedule" : structured.wants_booking_link === true ? "wants the booking link" : "spoke with Sam"}`));
  return { ok: true, leadId: lead.id };
}

// ── Provisioning ──────────────────────────────────────────────────────────────

const DATA_COLLECTION = {
  do_not_call: { type: "boolean", description: "True if the person asked not to be called again, said stop, or asked to be removed." },
  wants_reschedule: { type: "boolean", description: "True if the person wants to move their call to another time." },
  wants_booking_link: { type: "boolean", description: "True if the person wants a link emailed to book a call." },
  reached_voicemail: { type: "boolean", description: "True if the call reached voicemail or an answering machine." },
  objects_to_recording: { type: "boolean", description: "True if the person objected to the call being recorded." },
  callback_request: { type: "boolean", description: "True if the caller asked for a human to call them back." },
};

function agentBody(rt: Runtime, kind: "outbound" | "inbound") {
  const voice = rt.settings.get("ELEVENLABS_VOICE_ID");
  return {
    name: kind === "outbound" ? "Operator · outbound (Sam)" : "Operator · inbound callback (Sam)",
    conversation_config: {
      agent: {
        first_message: kind === "outbound"
          ? OUTBOUND_FIRST_MESSAGE
          : "Hi, this is Sam, an AI assistant for Operator by Asym. This call is recorded. How can I help?",
        language: "en",
        prompt: { prompt: kind === "outbound" ? outboundSystemPrompt(FAQS) : inboundSystemPrompt(FAQS), llm: rt.settings.get("ELEVENLABS_LLM") || "claude-sonnet-5-5" },
      },
      ...(voice ? { tts: { voice_id: voice } } : {}),
      conversation: { max_duration_seconds: AI_CALLER.maxMinutes * 60 },
    },
    platform_settings: {
      data_collection: DATA_COLLECTION,
    },
  };
}

async function upsertAgent(rt: Runtime, key: "ELEVENLABS_AGENT_ID" | "ELEVENLABS_INBOUND_AGENT_ID", kind: "outbound" | "inbound"): Promise<string> {
  const existing = rt.settings.get(key);
  const body = agentBody(rt, kind);
  if (existing) {
    const r = await api(rt, `/convai/agents/${encodeURIComponent(existing)}`, { method: "PATCH", body: JSON.stringify(body) });
    if (r.ok) return existing;
    if (r.status !== 404) throw new Error(`update ${kind} agent: ${r.status} ${JSON.stringify(r.json).slice(0, 200)}`);
  }
  const r = await api(rt, "/convai/agents/create", { method: "POST", body: JSON.stringify(body) });
  if (!r.ok || !r.json.agent_id) throw new Error(`create ${kind} agent: ${r.status} ${JSON.stringify(r.json).slice(0, 200)}`);
  await saveSetting(rt.env, key, String(r.json.agent_id));
  return String(r.json.agent_id);
}

export async function listPhoneNumbers(rt: Runtime): Promise<Array<{ id: string; number: string; label: string }>> {
  const r = await api(rt, "/convai/phone-numbers");
  const arr = Array.isArray(r.json) ? (r.json as unknown[]) : (Array.isArray((r.json as { phone_numbers?: unknown[] }).phone_numbers) ? (r.json as { phone_numbers: unknown[] }).phone_numbers : []);
  return arr.map((p) => {
    const x = p as Record<string, unknown>;
    return { id: String(x.phone_number_id || x.id || ""), number: String(x.phone_number || ""), label: String(x.label || "") };
  }).filter((p) => p.id);
}

/** Create/update both agents, set webhooks, assign the inbound agent to the number. Re-run when prompts change. */
export async function provision(rt: Runtime): Promise<{ ok: boolean; steps: string[]; error?: string }> {
  const steps: string[] = [];
  if (!rt.settings.has("ELEVENLABS_API_KEY")) return { ok: false, steps, error: "Add the ElevenLabs API key in Integrations first." };
  try {
    const outId = await upsertAgent(rt, "ELEVENLABS_AGENT_ID", "outbound");
    steps.push(`Outbound agent ready (${outId.slice(-6)})`);
    const inId = await upsertAgent(rt, "ELEVENLABS_INBOUND_AGENT_ID", "inbound");
    steps.push(`Inbound agent ready (${inId.slice(-6)})`);
    if (!rt.settings.has("ELEVENLABS_INIT_SECRET")) {
      const { randomToken } = await import("../lib/ids");
      await saveSetting(rt.env, "ELEVENLABS_INIT_SECRET", randomToken(24));
    }
    const s2 = await import("../settings").then((m) => m.loadSettings(rt.env));
    const settingsBody = {
      conversation_initiation_client_data_webhook: {
        url: `${rt.origin}/hooks/elevenlabs/init`,
        request_headers: { "x-funnel-secret": s2.get("ELEVENLABS_INIT_SECRET") },
      },
    };
    const st = await api(rt, "/convai/settings", { method: "PATCH", body: JSON.stringify(settingsBody) });
    steps.push(st.ok ? "Caller lookup webhook set" : `Caller lookup webhook not set (${st.status}); set it in ElevenLabs → Settings`);
    steps.push(`Post-call webhook: in ElevenLabs → Settings → Webhooks, point it at ${rt.origin}/hooks/elevenlabs and paste its secret into Integrations.`);
    const phoneId = rt.settings.get("ELEVENLABS_PHONE_NUMBER_ID");
    if (phoneId) {
      const ph = await api(rt, `/convai/phone-numbers/${encodeURIComponent(phoneId)}`, { method: "PATCH", body: JSON.stringify({ agent_id: inId }) });
      steps.push(ph.ok ? "Inbound agent assigned to your number" : `Could not assign the number (${ph.status})`);
    } else steps.push("Pick a phone number next");
    return { ok: true, steps };
  } catch (e) {
    return { ok: false, steps, error: e instanceof Error ? e.message : String(e) };
  }
}
