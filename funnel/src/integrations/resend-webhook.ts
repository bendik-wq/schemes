// Resend delivery webhooks (Svix-signed): delivered, delayed, bounced, complained. Hard bounces and
// complaints suppress the address, cancel every queued email and mark the lead; complaints ping the
// team. Hourly, the 7-day bounce and complaint rates pause marketing sequences when they get too high.

import type { Runtime } from "../app";
import { safeEqual } from "../lib/crypto";
import { kvGate, kvGetJson, kvSet, kvDelete } from "../lib/kv";
import { PAUSABLE_SEQUENCES, marketingPause, setLeadEmailStatus, suppress } from "../lib/suppress";
import { getLead, updateLead, getLeadByEmail, type Lead } from "../funnel/leads";
import { track } from "../tracking/track";
import { cancelAllEmails } from "./email";
import { notifyTeam } from "./notify";

const DAY = 86_400_000;
export const SVIX_TOLERANCE_S = 5 * 60;
export const COMPLAINT_LIMIT = 0.002;
export const BOUNCE_LIMIT = 0.03;
export const MIN_SENT_FOR_PAUSE = 100;

function b64ToBytes(b64: string): Uint8Array | null {
  try {
    const bin = atob(b64);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  } catch {
    return null;
  }
}

function bytesToB64(b: Uint8Array): string {
  let s = "";
  for (let i = 0; i < b.length; i++) s += String.fromCharCode(b[i]);
  return btoa(s);
}

/** Svix signature: base64(HMAC-SHA256(base64decode(secret after "whsec_"), `${id}.${timestamp}.${body}`)). */
export async function svixSign(secret: string, id: string, timestamp: string, body: string): Promise<string | null> {
  const raw = secret.startsWith("whsec_") ? secret.slice(6) : secret;
  const keyBytes = b64ToBytes(raw);
  if (!keyBytes || keyBytes.length < 16) return null;
  const key = await crypto.subtle.importKey("raw", keyBytes, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${id}.${timestamp}.${body}`));
  return bytesToB64(new Uint8Array(sig));
}

/** Fail closed: missing headers, a stale or future timestamp, or no matching v1 signature → false. */
export async function verifySvix(
  secret: string, headers: { id: string | null; timestamp: string | null; signature: string | null }, body: string, nowMs: number,
): Promise<boolean> {
  const { id, timestamp, signature } = headers;
  if (!secret || !id || !timestamp || !signature) return false;
  if (!/^\d{1,12}$/.test(timestamp)) return false;
  if (Math.abs(nowMs / 1000 - Number(timestamp)) > SVIX_TOLERANCE_S) return false;
  const expected = await svixSign(secret, id, timestamp, body);
  if (!expected) return false;
  let ok = false;
  for (const part of signature.split(" ")) {
    const [ver, sig] = part.split(",", 2);
    if (ver === "v1" && sig && safeEqual(sig, expected)) ok = true;
  }
  return ok;
}

export type ResendKind = "delivered" | "delayed" | "bounced" | "soft_bounce" | "complained" | "ignored";

/** Pure: classify a Resend event. Bounces are hard unless Resend says Transient. */
export function classifyResend(j: Record<string, any>): { kind: ResendKind; emailId: string | null; to: string | null; bounceType: string | null } {
  const type = String(j?.type || "");
  const d = (j?.data && typeof j.data === "object" ? j.data : {}) as Record<string, any>;
  const emailId = typeof d.email_id === "string" && /^[A-Za-z0-9_-]{1,100}$/.test(d.email_id) ? d.email_id : null;
  const toRaw = Array.isArray(d.to) ? d.to[0] : d.to;
  const to = typeof toRaw === "string" ? toRaw.trim().toLowerCase().slice(0, 200) : null;
  const bounceType = typeof d.bounce?.type === "string" ? String(d.bounce.type).slice(0, 40) : null;
  let kind: ResendKind = "ignored";
  if (type === "email.delivered") kind = "delivered";
  else if (type === "email.delivery_delayed") kind = "delayed";
  else if (type === "email.complained") kind = "complained";
  else if (type === "email.bounced") kind = /transient/i.test(bounceType || "") ? "soft_bounce" : "bounced";
  return { kind, emailId, to, bounceType };
}

export async function handleResendEvent(rt: Runtime, j: Record<string, any>): Promise<{ kind: ResendKind; matched: boolean }> {
  const ev = classifyResend(j);
  if (ev.kind === "ignored") return { kind: ev.kind, matched: false };
  const now = rt.now();
  const row = ev.emailId
    ? await rt.env.DB.prepare("SELECT id, lead_id FROM emails WHERE provider_id = ?").bind(ev.emailId).first<{ id: string; lead_id: string }>()
    : null;
  if (row) {
    const col = ev.kind === "delivered" ? "delivered_at" : ev.kind === "delayed" ? "delayed_at" : ev.kind === "complained" ? "complained_at" : "bounced_at";
    await rt.env.DB.prepare(`UPDATE emails SET ${col} = COALESCE(${col}, ?)${col === "bounced_at" ? ", bounce_type = ?" : ""} WHERE id = ?`)
      .bind(...(col === "bounced_at" ? [now, ev.kind === "soft_bounce" ? "soft" : "hard", row.id] : [now, row.id])).run();
  }
  if (ev.kind !== "bounced" && ev.kind !== "complained") return { kind: ev.kind, matched: !!row };
  let lead: Lead | null = row ? await getLead(rt, row.lead_id) : null;
  if (!lead && ev.to) lead = await getLeadByEmail(rt, ev.to);
  // The address itself is suppressed even when we cannot find the lead (it survives erasure as an HMAC).
  await suppress(rt, "email", lead?.email || ev.to);
  if (!lead) return { kind: ev.kind, matched: !!row };
  await setLeadEmailStatus(rt, lead.id, ev.kind);
  await cancelAllEmails(rt, lead.id);
  if (ev.kind === "complained") {
    if (!lead.unsubscribed_at) {
      await updateLead(rt, lead.id, { unsubscribed_at: now });
      await track(rt, { leadId: lead.id }, { name: "unsubscribed", source: "webhook", props: { reason: "complaint" } });
    }
    if (await kvGate(rt.env, `complaint:${lead.id}`, 365 * DAY, now)) rt.waitUntil(notifyTeam(rt, "complaint", lead, "Marked one of our emails as spam. Every email to them is stopped."));
  }
  return { kind: ev.kind, matched: true };
}

// ── Deliverability (7 days) ──────────────────────────────────────────────────

export interface DeliverabilityRow { sequence: string; sent: number; delivered: number; bounced: number; soft: number; complained: number; bounce_rate: number | null; complaint_rate: number | null }

const rate = (a: number, b: number) => (b > 0 ? Math.round((a / b) * 100000) / 1000 : null);

export async function deliverabilityBySequence(rt: Runtime, since: number): Promise<DeliverabilityRow[]> {
  const rows = ((await rt.env.DB.prepare(
    `SELECT sequence, COUNT(*) AS sent, SUM(delivered_at IS NOT NULL) AS delivered, SUM(bounced_at IS NOT NULL AND COALESCE(bounce_type, 'hard') = 'hard') AS bounced,
       SUM(bounce_type = 'soft') AS soft, SUM(complained_at IS NOT NULL) AS complained
     FROM emails WHERE status = 'sent' AND sent_at >= ? GROUP BY sequence ORDER BY sent DESC`,
  ).bind(since).all<Record<string, number | string>>()).results) || [];
  return rows.map((r) => {
    const sent = Number(r.sent) || 0, bounced = Number(r.bounced) || 0, complained = Number(r.complained) || 0;
    return { sequence: String(r.sequence), sent, delivered: Number(r.delivered) || 0, bounced, soft: Number(r.soft) || 0, complained, bounce_rate: rate(bounced, sent), complaint_rate: rate(complained, sent) };
  });
}

/** Pure: should marketing pause? Rates are fractions; needs a minimum volume. */
export function deliverabilityVerdict(sent: number, bounced: number, complained: number, minSent = MIN_SENT_FOR_PAUSE) {
  const bounce = sent ? bounced / sent : 0, complaint = sent ? complained / sent : 0;
  const firing = sent >= minSent && (complaint > COMPLAINT_LIMIT || bounce > BOUNCE_LIMIT);
  return {
    firing, bounce: Math.round(bounce * 10000) / 10000, complaint: Math.round(complaint * 100000) / 100000,
    detail: `7 days: ${sent} sent, ${bounced} hard bounces (${(bounce * 100).toFixed(2)}%), ${complained} complaints (${(complaint * 100).toFixed(2)}%)`,
  };
}

/** Hourly: compute 7-day rates, store them for the alert rule, pause marketing when they are too high. */
export async function checkDeliverability(rt: Runtime, force = false): Promise<ReturnType<typeof deliverabilityVerdict> | null> {
  if (!force && !(await kvGate(rt.env, "gate:deliverability", 55 * 60_000, rt.now()))) return null;
  const rows = await deliverabilityBySequence(rt, rt.now() - 7 * DAY);
  const t = rows.reduce((a, r) => ({ sent: a.sent + r.sent, bounced: a.bounced + r.bounced, complained: a.complained + r.complained }), { sent: 0, bounced: 0, complained: 0 });
  const v = deliverabilityVerdict(t.sent, t.bounced, t.complained);
  await kvSet(rt.env, "email:deliverability", JSON.stringify({ ...v, at: rt.now() }));
  if (v.firing && rt.settings.bool("EMAIL_AUTO_PAUSE") && !(await marketingPause(rt))) {
    await kvSet(rt.env, "email:paused", JSON.stringify({ at: rt.now(), reason: v.detail }));
  }
  return v;
}

export async function resumeMarketing(rt: Runtime): Promise<void> {
  await kvDelete(rt.env, "email:paused");
}

export async function deliverabilityPayload(rt: Runtime, since: number) {
  const [bySeq, pause, last] = await Promise.all([
    deliverabilityBySequence(rt, since), marketingPause(rt), kvGetJson<Record<string, unknown> | null>(rt.env, "email:deliverability", null),
  ]);
  return { by_sequence: bySeq, paused: pause, pausable: PAUSABLE_SEQUENCES, last_check: last, webhook: rt.settings.has("RESEND_WEBHOOK_SECRET"), webhook_url: `${rt.origin}/hooks/resend` };
}
