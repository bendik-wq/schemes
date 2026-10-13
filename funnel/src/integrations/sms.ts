// Text reminders about a booked call (Twilio Messaging API), only to numbers with their own explicit consent
// (SMS_CONSENT, a separate unticked box; never implied by the AI-call consent). Three texts per booking at
// most: at booking, 24 h before and 1 h before, each moved or dropped so it lands inside the calling hours of
// every time zone of the number's country (calling-rules.ts). "Reply 1" confirms attendance through the
// inbound webhook (src/routes/sms-hooks.ts); STOP withdraws consent at once and survives erasure (an HMAC in
// `suppressions`, kind "sms"). Without Twilio keys every text is simulated: logged in sms_messages, never sent.
//
// WhatsApp: whatsapp.ts only supports the single resources template (no utility reminder templates), so
// reminders go by SMS only.

import type { Runtime } from "../app";
import { isTestLead } from "../admin/testdata";
import { BRAND, SMS_CONSENT } from "../config";
import { getLead, type Lead } from "../funnel/leads";
import { hmacHex, safeEqual } from "../lib/crypto";
import { newId } from "../lib/ids";
import { callingZones, normalizePhone, phoneCountry } from "../lib/phone";
import { signingSecret } from "../lib/secret";
import { track } from "../tracking/track";
import { allZonesOk } from "./calling-rules";
import { formatCallTime, leadTimezone } from "./email";

const M = 60_000, H = 60 * M;

export type SmsKind = "booked" | "24h" | "1h";

/** Reminder kinds and their nominal time relative to the call (booked = at booking). */
export const SMS_PLAN: Array<{ kind: SmsKind; offset: number | null }> = [
  { kind: "booked", offset: null },
  { kind: "24h", offset: -24 * H },
  { kind: "1h", offset: -1 * H },
];

// ── Consent ───────────────────────────────────────────────────────────────────

async function stopKey(rt: Runtime, phone: string): Promise<string> {
  // Same shape as lib/suppress.ts, its own kind: a text STOP is not a do-not-call request.
  return (await hmacHex(await signingSecret(rt.env), `suppress|sms|${phone.trim().toLowerCase()}`)).slice(0, 40);
}

/** Text reminders are on (SMS_REMINDERS) for this deployment. */
export function smsEnabled(rt: Runtime): boolean {
  return rt.settings.bool("SMS_REMINDERS");
}

/** This number ticked the text-reminder box and has not sent STOP since. */
export async function smsConsentGiven(rt: Runtime, phone: string | null | undefined): Promise<boolean> {
  if (!phone) return false;
  const r = await rt.env.DB.prepare("SELECT consent_at, stopped_at FROM sms_consent WHERE phone = ?").bind(phone)
    .first<{ consent_at: number | null; stopped_at: number | null }>().catch(() => null);
  return !!r?.consent_at && !r.stopped_at;
}

/**
 * Called from the contact step. A tick records consent for this number (a fresh tick after STOP is a new,
 * explicit consent); no tick withdraws an earlier consent this lead gave for the same number.
 */
export async function recordSmsConsent(rt: Runtime, leadId: string, phone: string | null | undefined, consent: boolean): Promise<void> {
  if (!phone) return;
  const now = rt.now();
  if (consent) {
    await rt.env.DB.prepare(
      `INSERT INTO sms_consent (phone, lead_id, consent_at, consent_text, stopped_at, updated_at) VALUES (?,?,?,?,NULL,?)
       ON CONFLICT(phone) DO UPDATE SET lead_id = excluded.lead_id, consent_at = excluded.consent_at, consent_text = excluded.consent_text, stopped_at = NULL, updated_at = excluded.updated_at`,
    ).bind(phone, leadId, now, `${SMS_CONSENT.version}: ${SMS_CONSENT.label}`, now).run();
    await rt.env.DB.prepare("DELETE FROM suppressions WHERE hash = ?").bind(await stopKey(rt, phone)).run();
    return;
  }
  await rt.env.DB.prepare("UPDATE sms_consent SET consent_at = NULL, consent_text = NULL, updated_at = ? WHERE phone = ? AND lead_id = ? AND consent_at IS NOT NULL")
    .bind(now, phone, leadId).run();
  await cancelSms(rt, leadId);
}

/** STOP: no more texts to this number, ever, until a fresh tick on the form. Cancels everything queued. */
export async function stopSms(rt: Runtime, phone: string): Promise<void> {
  const now = rt.now();
  await rt.env.DB.prepare(
    `INSERT INTO sms_consent (phone, lead_id, consent_at, consent_text, stopped_at, updated_at) VALUES (?,NULL,NULL,NULL,?,?)
     ON CONFLICT(phone) DO UPDATE SET consent_at = NULL, consent_text = NULL, stopped_at = excluded.stopped_at, updated_at = excluded.updated_at`,
  ).bind(phone, now, now).run();
  await rt.env.DB.prepare("INSERT OR IGNORE INTO suppressions (hash, kind, created_at) VALUES (?,?,?)").bind(await stopKey(rt, phone), "sms", now).run();
  await rt.env.DB.prepare("UPDATE sms_messages SET status = 'cancelled', error = 'stop' WHERE phone = ? AND status = 'pending' AND direction = 'out'").bind(phone).run();
}

export async function smsStopped(rt: Runtime, phone: string): Promise<boolean> {
  return !!(await rt.env.DB.prepare("SELECT 1 AS x FROM suppressions WHERE hash = ?").bind(await stopKey(rt, phone)).first());
}

export async function cancelSms(rt: Runtime, leadId: string): Promise<void> {
  await rt.env.DB.prepare("UPDATE sms_messages SET status = 'cancelled' WHERE lead_id = ? AND status = 'pending' AND direction = 'out'").bind(leadId).run();
}

// ── Timing (pure) ─────────────────────────────────────────────────────────────

/**
 * When to send one reminder, or null to drop it. Every zone of the number's country must be inside calling
 * hours. The booking text waits for the next allowed time (if that is still at least 2 h before the call);
 * the 24 h reminder moves earlier, up to 12 h, to the latest allowed time (else later, while still 16 h before
 * the call); the 1 h reminder moves earlier, up to 2 h; otherwise it is dropped. Nothing is sent less than 15 minutes before the call. Pure.
 */
export function smsSendTime(kind: SmsKind, now: number, callAt: number, zones: string[], country: string | null): number | null {
  if (!zones.length || !(callAt > now + 15 * M)) return null;
  const ok = (t: number) => allZonesOk(t, zones, country);
  const step = 15 * M;
  if (kind === "booked") {
    for (let t = now; t <= callAt - 2 * H; t = t === now ? Math.ceil((now + 1) / step) * step : t + step) if (ok(t)) return t;
    return null;
  }
  const nominal = callAt + (kind === "24h" ? -24 * H : -1 * H);
  const window = kind === "24h" ? 12 * H : 2 * H;
  if (nominal < now) return kind === "1h" && callAt - now >= 30 * M && ok(now) ? now : null;
  for (let t = Math.floor(nominal / step) * step; t >= nominal - window; t -= step) {
    if (t < now) break;
    if (ok(t)) return t;
  }
  // The day-before reminder may also move later, while it is still at least 16 h before the call
  // (an 08:30 call: 09:00 the day before rather than nothing).
  if (kind === "24h") for (let t = Math.ceil(nominal / step) * step; t <= callAt - 16 * H; t += step) if (t >= now && ok(t)) return t;
  return null;
}

/** The text itself. First name only; never answers, email or anything else from the application. Pure. */
export function smsBody(kind: SmsKind, o: { first: string; closer: string; when: string; confirmed: boolean; join: string | null }): string {
  const hi = o.first ? `Hi ${o.first}, ` : "Hi, ";
  const reply = o.confirmed ? "" : " Reply 1 to confirm you'll be there.";
  const stop = " Reply STOP to stop texts.";
  if (kind === "booked") return `${hi}your strategy call with ${o.closer} (${BRAND.short}) is booked for ${o.when}.${reply}${stop}`;
  if (kind === "24h") return `${hi}a reminder: your call with ${o.closer} is tomorrow, ${o.when}.${reply}${stop}`;
  return `${hi}your call with ${o.closer} starts in about an hour (${o.when}).${o.join ? ` Join: ${o.join}` : ""}${stop}`;
}

// ── Queue ─────────────────────────────────────────────────────────────────────

/**
 * Queue the reminders for the lead's current call (on a verified booking or a reschedule). Needs SMS_REMINDERS
 * on, consent for this exact number and no STOP. Rows are keyed by (lead, kind, call time), so a reschedule
 * queues a fresh set and the old ones are skipped at send time.
 */
export async function scheduleSmsReminders(rt: Runtime, lead: Lead): Promise<number> {
  if (!smsEnabled(rt) || !lead.phone || !lead.call_at || lead.booking_source === "calendly-direct") return 0;
  if (!(await smsConsentGiven(rt, lead.phone)) || (await smsStopped(rt, lead.phone))) return 0;
  const now = rt.now();
  const zones = callingZones(lead.phone);
  const country = phoneCountry(lead.phone);
  await rt.env.DB.prepare("UPDATE sms_messages SET status = 'cancelled', error = 'call moved' WHERE lead_id = ? AND status = 'pending' AND direction = 'out' AND call_at != ?")
    .bind(lead.id, lead.call_at).run();
  const times = SMS_PLAN.map((p) => ({ kind: p.kind, at: smsSendTime(p.kind, now, lead.call_at as number, zones, country) }));
  // The 24 h reminder adds nothing when it would land within 3 h of the booking text.
  const booked = times.find((t) => t.kind === "booked")?.at;
  const rows = times.filter((t) => t.at !== null && !(t.kind === "24h" && booked != null && Math.abs((t.at as number) - booked) < 3 * H));
  let n = 0;
  for (const r of rows) {
    const res = await rt.env.DB.prepare(
      `INSERT INTO sms_messages (id, lead_id, kind, direction, phone, call_at, send_at, status, created_at)
       VALUES (?,?,?,'out',?,?,?,'pending',?) ON CONFLICT DO NOTHING`,
    ).bind(newId("s"), lead.id, r.kind, lead.phone, lead.call_at, r.at, now).run();
    n += Number(res.meta?.changes || 0);
  }
  return n;
}

export interface SmsRow { id: string; lead_id: string; kind: SmsKind; phone: string; call_at: number; send_at: number; status: string }

/** Due reminders, re-checked against fresh data at send time. Runs from the email cron (processEmailQueue). */
export async function processSmsQueue(rt: Runtime, limit = 30): Promise<{ sent: number; simulated: number; skipped: number; failed: number }> {
  const out = { sent: 0, simulated: 0, skipped: 0, failed: 0 };
  const now = rt.now();
  const due = await rt.env.DB.prepare("SELECT * FROM sms_messages WHERE status = 'pending' AND direction = 'out' AND send_at <= ? ORDER BY send_at LIMIT ?")
    .bind(now, limit).all<SmsRow>().catch(() => ({ results: [] as SmsRow[] }));
  for (const row of due.results || []) {
    const claim = await rt.env.DB.prepare("UPDATE sms_messages SET status = 'sending' WHERE id = ? AND status = 'pending'").bind(row.id).run();
    if (!claim.meta?.changes) continue;
    if (row.lead_id && (await isTestLead(rt, row.lead_id))) {
      await rt.env.DB.prepare("UPDATE sms_messages SET status = 'skipped', error = 'test lead' WHERE id = ?").bind(row.id).run();
      out.skipped++;
      continue;
    }
    const r: SendResult = await sendOne(rt, row).catch((e): SendResult => ({ status: "failed", error: e instanceof Error ? e.message : String(e) }));
    const set = (status: string, extra: Record<string, unknown> = {}) => {
      const keys = Object.keys(extra);
      return rt.env.DB.prepare(`UPDATE sms_messages SET status = ?${keys.map((k) => `, ${k} = ?`).join("")} WHERE id = ?`).bind(status, ...keys.map((k) => extra[k] ?? null), row.id).run();
    };
    if ("error" in r) { await set(r.status, { error: r.error }); if (r.status === "skipped") out.skipped++; else out.failed++; }
    else { await set(r.status, { sent_at: rt.now(), provider_id: r.providerId || null, body: r.body, error: null }); if (r.status === "sent") out.sent++; else out.simulated++; }
  }
  return out;
}

type SendResult = { status: "sent" | "simulated"; providerId?: string; body: string } | { status: "skipped" | "failed"; error: string };

async function sendOne(rt: Runtime, row: SmsRow): Promise<SendResult> {
  const lead = await getLead(rt, row.lead_id);
  if (!lead) return { status: "skipped", error: "lead gone" };
  if (!smsEnabled(rt)) return { status: "skipped", error: "sms off" };
  if (lead.status !== "booked" || lead.booking_cancelled_at || !lead.call_at || lead.call_at !== row.call_at) return { status: "skipped", error: "call changed" };
  if (lead.phone !== row.phone || !(await smsConsentGiven(rt, row.phone)) || (await smsStopped(rt, row.phone))) return { status: "skipped", error: "no consent" };
  const now = rt.now();
  if (lead.call_at - now < 15 * M) return { status: "skipped", error: "too close to the call" };
  // A cron outage must not text people at night or long after the moment.
  if (now - row.send_at > 2 * H) return { status: "skipped", error: "stale" };
  if (!allZonesOk(now, callingZones(row.phone), phoneCountry(row.phone))) return { status: "skipped", error: "outside hours" };
  const a = lead as Lead & { attendance_confirmed_at?: number | null; attendance_call_at?: number | null };
  const confirmed = !!a.attendance_confirmed_at && a.attendance_call_at === lead.call_at;
  const tz = await leadTimezone(rt, lead);
  const join = /^https:\/\/[^\s"'<>]+$/.test(lead.booking_join_url || "") ? (lead.booking_join_url as string) : null;
  const body = smsBody(row.kind, {
    first: (lead.first_name || "").replace(/[^\p{L}\p{M}' .-]/gu, "").slice(0, 30),
    closer: BRAND.founder,
    when: formatCallTime(lead.call_at, tz),
    confirmed,
    join,
  });
  const s = rt.settings;
  const live = s.has("TWILIO_ACCOUNT_SID") && s.has("TWILIO_AUTH_TOKEN") && s.has("TWILIO_SMS_FROM");
  if (!live) {
    console.log("sms simulated", row.kind, row.id);
    await track(rt, { leadId: lead.id }, { name: "sms_sent", source: "cron", localOnly: true, props: { kind: row.kind, simulated: true } });
    return { status: "simulated", body };
  }
  const r = await sendViaTwilio(rt, row.phone, body);
  if (!r.ok) return { status: "failed", error: r.error };
  await track(rt, { leadId: lead.id }, { name: "sms_sent", source: "cron", localOnly: true, props: { kind: row.kind } });
  return { status: "sent", providerId: r.sid, body };
}

/** POST to Twilio's Messages API. TWILIO_SMS_FROM is an E.164 number or a Messaging Service SID (MG…). */
export async function sendViaTwilio(rt: Runtime, to: string, body: string): Promise<{ ok: true; sid: string } | { ok: false; error: string }> {
  const s = rt.settings;
  const sid = s.get("TWILIO_ACCOUNT_SID");
  const from = s.get("TWILIO_SMS_FROM");
  const form = new URLSearchParams({ To: to, Body: body, StatusCallback: `${rt.origin}/hooks/twilio-sms/status` });
  if (/^MG[0-9a-f]{32}$/i.test(from)) form.set("MessagingServiceSid", from); else form.set("From", from);
  try {
    const r = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(sid)}/Messages.json`, {
      method: "POST",
      headers: { authorization: `Basic ${btoa(`${sid}:${s.get("TWILIO_AUTH_TOKEN")}`)}`, "content-type": "application/x-www-form-urlencoded" },
      body: form.toString(),
    });
    const j = (await r.json().catch(() => ({}))) as { sid?: string; message?: string; code?: number };
    if (r.ok && j.sid) return { ok: true, sid: j.sid };
    return { ok: false, error: `twilio ${r.status}${j.code ? ` ${j.code}` : ""}: ${String(j.message || "").slice(0, 200)}` };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

/** A 24 h or 1 h text reached the phone for the lead's current call (the 3 h and 1 h emails then stay quiet). */
export async function smsReminderDelivered(rt: Runtime, leadId: string, callAt: number | null): Promise<boolean> {
  if (!callAt) return false;
  const r = await rt.env.DB.prepare("SELECT 1 AS x FROM sms_messages WHERE lead_id = ? AND call_at = ? AND kind IN ('24h','1h') AND status = 'delivered' LIMIT 1")
    .bind(leadId, callAt).first().catch(() => null);
  return !!r;
}

// ── Inbound (Twilio webhook) ──────────────────────────────────────────────────

const enc = new TextEncoder();

/**
 * X-Twilio-Signature: base64(HMAC-SHA1(auth token, full URL + each POST param name and value, sorted by name)).
 * Constant-time compare.
 */
export async function twilioSignature(authToken: string, url: string, params: Record<string, string>): Promise<string> {
  const data = url + Object.keys(params).sort().map((k) => k + params[k]).join("");
  const key = await crypto.subtle.importKey("raw", enc.encode(authToken), { name: "HMAC", hash: "SHA-1" }, false, ["sign"]);
  const sig = new Uint8Array(await crypto.subtle.sign("HMAC", key, enc.encode(data)));
  let bin = "";
  for (let i = 0; i < sig.length; i++) bin += String.fromCharCode(sig[i]);
  return btoa(bin);
}

export async function verifyTwilio(authToken: string, header: string | undefined | null, urls: string[], params: Record<string, string>): Promise<boolean> {
  if (!authToken || !header) return false;
  for (const u of urls) if (safeEqual(await twilioSignature(authToken, u, params), header)) return true;
  return false;
}

export const STOP_WORDS = ["stop", "stopall", "unsubscribe", "cancel", "end", "quit", "revoke", "optout"];
export const HELP_WORDS = ["help", "info"];

export type InboundAction = "stop" | "help" | "confirm" | "other";

/** Pure: what an inbound text asks for. "1" (or "yes") confirms; carrier keywords win over everything. */
export function inboundAction(text: string): InboundAction {
  const t = text.trim().toLowerCase().replace(/[.!]+$/, "");
  if (STOP_WORDS.includes(t)) return "stop";
  if (HELP_WORDS.includes(t)) return "help";
  if (t === "1" || t === "yes" || t === "y") return "confirm";
  return "other";
}

/** Handle one inbound text. Returns the reply to send back (TwiML message), or "" for none. */
export async function handleInboundSms(rt: Runtime, fromRaw: string, text: string, sid: string): Promise<string> {
  const from = normalizePhone(fromRaw, null);
  const action = inboundAction(text);
  const now = rt.now();
  let lead: Lead | null = null;
  if (from) {
    const c = await rt.env.DB.prepare("SELECT lead_id FROM sms_consent WHERE phone = ?").bind(from).first<{ lead_id: string | null }>();
    lead = c?.lead_id ? await getLead(rt, c.lead_id) : null;
    if (!lead) lead = await rt.env.DB.prepare("SELECT * FROM leads WHERE phone = ? ORDER BY updated_at DESC LIMIT 1").bind(from).first<Lead>();
  }
  await rt.env.DB.prepare("INSERT INTO sms_messages (id, lead_id, kind, direction, phone, call_at, send_at, status, body, provider_id, created_at) VALUES (?,?,?,'in',?,NULL,?,'received',?,?,?)")
    .bind(newId("s"), lead?.id ?? null, action, from, now, text.slice(0, 500), sid.slice(0, 64) || null, now).run();
  if (action === "stop") {
    if (from) await stopSms(rt, from);
    if (lead) await track(rt, { leadId: lead.id }, { name: "sms_stop", source: "webhook", localOnly: true });
    return ""; // Twilio's own opt-out confirmation goes out; one reply is enough.
  }
  if (action === "help") return `${BRAND.name}: reminders about your call. Reply STOP to stop texts. Questions: reply to any of our emails.`;
  if (action === "confirm") {
    if (!lead || !from || lead.phone !== from || lead.status !== "booked" || !lead.call_at || lead.booking_cancelled_at || lead.call_at < now) {
      return "We couldn't find an upcoming call for this number. The latest email from us has the details.";
    }
    const a = lead as Lead & { attendance_confirmed_at?: number | null; attendance_call_at?: number | null };
    if (!(a.attendance_confirmed_at && a.attendance_call_at === lead.call_at)) {
      await rt.env.DB.prepare("UPDATE leads SET attendance_confirmed_at = ?, attendance_call_at = ?, updated_at = ? WHERE id = ?").bind(now, lead.call_at, now, lead.id).run();
      await track(rt, { leadId: lead.id }, { name: "attendance_confirmed", source: "webhook", localOnly: true, props: { call_at: lead.call_at, via: "sms" } });
    }
    return `Thanks, you're confirmed for ${formatCallTime(lead.call_at, await leadTimezone(rt, lead))}. See you then.`;
  }
  return "";
}

/** Delivery receipts (StatusCallback): sent → delivered / undelivered / failed. */
export async function handleSmsStatus(rt: Runtime, sid: string, status: string): Promise<void> {
  const s = status.toLowerCase();
  if (!/^SM[0-9a-f]{32}$/i.test(sid) && !/^MM[0-9a-f]{32}$/i.test(sid)) return;
  if (s === "delivered") await rt.env.DB.prepare("UPDATE sms_messages SET status = 'delivered', delivered_at = ? WHERE provider_id = ?").bind(rt.now(), sid).run();
  else if (s === "undelivered" || s === "failed") await rt.env.DB.prepare("UPDATE sms_messages SET status = 'failed', error = ? WHERE provider_id = ? AND status != 'delivered'").bind(`twilio ${s}`, sid).run();
}
