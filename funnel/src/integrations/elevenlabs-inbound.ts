// Inbound callback agent. Caller ID can be spoofed, so the init webhook passes only first name,
// status and call time, and inbound calls never trigger actions on their own.

import type { Runtime } from "../app";
import { safeEqual } from "../lib/crypto";
import { newId } from "../lib/ids";
import { normalizePhone } from "../lib/phone";
import { clip, safeFirstName } from "../lib/text";
import { kvGate } from "../lib/kv";
import type { Lead } from "../funnel/leads";
import { validEmail } from "../funnel/application";
import { formatCallTime, leadTimezone } from "./email";
import { structuredResults } from "./elevenlabs";
import { notifyTeam } from "./notify";

export function initAuthorized(rt: Runtime, header: string | null): "ok" | "unconfigured" | "denied" {
  const secret = rt.settings.get("ELEVENLABS_INIT_SECRET");
  if (!secret) return "unconfigured";
  return header && safeEqual(header, secret) ? "ok" : "denied";
}

export async function initVariables(rt: Runtime, body: { caller_id?: unknown }): Promise<Record<string, string>> {
  const phone = normalizePhone(body.caller_id, null);
  let lead: Lead | null = null;
  if (phone) lead = await rt.env.DB.prepare("SELECT * FROM leads WHERE phone = ? ORDER BY updated_at DESC LIMIT 1").bind(phone).first<Lead>();
  const vars: Record<string, string> = { first_name: "there", status: "unknown", call_time: "" };
  if (lead && lead.booking_source === "funnel") {
    vars.first_name = safeFirstName(lead.first_name);
    vars.status = lead.status === "booked" ? "booked" : lead.status === "no_show" ? "missed_call" : ["applied", "nurture", "partial"].includes(lead.status) ? "applied" : "other";
    if (lead.status === "booked" && lead.call_at) vars.call_time = formatCallTime(lead.call_at, await leadTimezone(rt, lead));
  }
  return vars;
}

/** Cron: pull recent inbound conversations into voice_calls, link them for the team, never act. */
export async function syncInbound(rt: Runtime): Promise<number> {
  const s = rt.settings;
  const agent = s.get("ELEVENLABS_INBOUND_AGENT_ID");
  if (!s.has("ELEVENLABS_API_KEY") || !agent) return 0;
  if (!(await kvGate(rt.env, "gate:inbound_sync", 10 * 60_000))) return 0;
  const headers = { "xi-api-key": s.get("ELEVENLABS_API_KEY") };
  const r = await fetch(`https://api.elevenlabs.io/v1/convai/conversations?agent_id=${encodeURIComponent(agent)}&page_size=30`, { headers });
  if (!r.ok) return 0;
  const j = (await r.json().catch(() => ({}))) as { conversations?: Array<{ conversation_id?: string }> };
  let n = 0;
  for (const c of j.conversations || []) {
    if (!c.conversation_id) continue;
    const seen = await rt.env.DB.prepare("SELECT id FROM voice_calls WHERE conversation_id = ?").bind(c.conversation_id).first();
    if (seen) continue;
    const d = await fetch(`https://api.elevenlabs.io/v1/convai/conversations/${encodeURIComponent(c.conversation_id)}`, { headers });
    if (!d.ok) continue;
    const conv = (await d.json().catch(() => ({}))) as Record<string, any>;
    const structured = structuredResults(conv as never);
    const caller = normalizePhone(conv.metadata?.phone_call?.external_number, null);
    let lead: Lead | null = null;
    let match: string | null = null;
    if (caller) {
      lead = await rt.env.DB.prepare("SELECT * FROM leads WHERE phone = ? ORDER BY updated_at DESC LIMIT 1").bind(caller).first<Lead>();
      if (lead) match = "caller_id";
    }
    const spoken = validEmail(structured.email);
    if (!lead && spoken) {
      lead = await rt.env.DB.prepare("SELECT * FROM leads WHERE email = ?").bind(spoken).first<Lead>();
      if (lead) match = "spoken_email";
    }
    const transcript = ((conv.transcript || []) as Array<{ role?: string; message?: string }>).slice(0, 200)
      .map((t) => `${t.role === "agent" ? "Agent" : "Caller"}: ${clip(t.message, 1000)}`).join("\n");
    await rt.env.DB.prepare(
      `INSERT INTO voice_calls (id, provider, direction, conversation_id, lead_id, phone, status, started_at, duration_s, transcript, summary, structured, cost, match_kind, created_at)
       VALUES (?, 'elevenlabs', 'inbound', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(conversation_id) DO NOTHING`,
    ).bind(newId("vc"), c.conversation_id, lead?.id ?? null, caller, String(conv.status || ""),
      conv.metadata?.start_time_unix_secs ? conv.metadata.start_time_unix_secs * 1000 : rt.now(), conv.metadata?.call_duration_secs ?? null,
      transcript.slice(0, 60_000), clip(conv.analysis?.transcript_summary, 2000) || null, JSON.stringify(structured), conv.metadata?.cost ?? null, match, rt.now()).run();
    // Requests from callers are surfaced to the team; nothing is done automatically.
    if (structured.wants_reschedule === true || structured.callback_request === true) {
      rt.waitUntil(notifyTeam(rt, "callback_request", lead && lead.booking_source === "funnel" ? lead : null, match === "spoken_email" ? "Matched by a spoken email only: verify before acting" : "Inbound caller asked for a follow-up"));
    }
    n++;
  }
  return n;
}
