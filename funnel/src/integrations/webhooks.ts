// Signed outbound webhooks. Subscriptions are delivered through forward_log (destination wh_<id>), so they
// share its retries and backoff. Every delivery (and the CRM webhook, when LEAD_WEBHOOK_SECRET is set) carries
//   X-Funnel-Signature: t=<unix seconds>,v1=<hex HMAC-SHA256(secret, "<t>.<raw body>")>
//   X-Funnel-Event-Id: <stable event id>   (dedupe on this; retries reuse it)
// URLs must be https, must not point at private or local hosts, and must match WEBHOOK_ALLOWED_HOSTS when set.

import type { Runtime } from "../app";
import { hmacHex, safeEqual } from "../lib/crypto";
import { newId, randomToken } from "../lib/ids";

export const WEBHOOK_EVENTS = [
  "lead_captured", "app_submitted", "lead_qualified", "booking_scheduled", "booking_rescheduled", "booking_cancelled",
  "call_showed", "call_no_show", "deal_won", "deal_lost", "payment_recorded", "lead_status_changed", "unsubscribed", "lead_erased",
] as const;

export interface WebhookSub { id: string; url: string; events: string; secret: string; active: number; created_at: number }

/** Pure: is this a host we may post to? Blocks IP literals in private ranges, localhost and internal names. */
export function validWebhookUrl(raw: string, allowedHosts: string[] = []): boolean {
  let u: URL;
  try { u = new URL(raw); } catch { return false; }
  if (u.protocol !== "https:" || u.username || u.password || (u.port && u.port !== "443")) return false;
  const h = u.hostname.toLowerCase().replace(/\.$/, "");
  if (!h.includes(".") || /(^|\.)(localhost|local|internal|intranet|home|lan|corp)$/.test(h)) return false;
  if (h.startsWith("[") || /^[\d.]+$/.test(h) || /^0x/i.test(h)) return false; // no IP literals at all
  if (/(^|\.)(metadata\.google\.internal|169\.254\.169\.254)$/.test(h)) return false;
  if (allowedHosts.length) return allowedHosts.some((a) => { const x = a.trim().toLowerCase(); return !!x && (h === x || h.endsWith("." + x)); });
  return true;
}

export function allowedHosts(rt: Runtime): string[] {
  return rt.settings.get("WEBHOOK_ALLOWED_HOSTS").split(",").map((x) => x.trim()).filter(Boolean);
}

/** Pure: the signature header value for a body sent at `tSec`. */
export async function signatureHeader(secret: string, tSec: number, body: string): Promise<string> {
  return `t=${tSec},v1=${await hmacHex(secret, `${tSec}.${body}`)}`;
}

/** Pure: verify a signature header (receiver side; used in tests and documented for integrators). */
export async function verifySignatureHeader(secret: string, header: string, body: string, nowSec: number, toleranceSec = 300): Promise<boolean> {
  const parts = Object.fromEntries(String(header || "").split(",").map((p) => { const i = p.indexOf("="); return [p.slice(0, i).trim(), p.slice(i + 1).trim()]; }));
  const t = Number(parts.t);
  if (!Number.isFinite(t) || Math.abs(nowSec - t) > toleranceSec || !/^[0-9a-f]{64}$/.test(parts.v1 || "")) return false;
  return safeEqual(await hmacHex(secret, `${t}.${body}`), parts.v1);
}

export async function signedHeaders(secret: string | null | undefined, body: string, eventId: string | null | undefined, nowMs: number): Promise<Record<string, string>> {
  const h: Record<string, string> = {};
  if (eventId) h["x-funnel-event-id"] = eventId;
  if (secret) h["x-funnel-signature"] = await signatureHeader(secret, Math.floor(nowMs / 1000), body);
  return h;
}

export function subEvents(s: Pick<WebhookSub, "events">): string[] {
  return s.events.split(",").map((x) => x.trim()).filter(Boolean);
}

export async function listSubs(rt: Runtime): Promise<WebhookSub[]> {
  return ((await rt.env.DB.prepare("SELECT * FROM webhook_subscriptions ORDER BY created_at").all<WebhookSub>().catch(() => ({ results: [] as WebhookSub[] }))).results) || [];
}

export async function getSub(rt: Runtime, id: string): Promise<WebhookSub | null> {
  return (await rt.env.DB.prepare("SELECT * FROM webhook_subscriptions WHERE id = ?").bind(id).first<WebhookSub>().catch(() => null)) || null;
}

/** Active subscriptions that want this event. */
export async function subsFor(rt: Runtime, event: string): Promise<WebhookSub[]> {
  const hosts = allowedHosts(rt);
  return (await listSubs(rt)).filter((s) => s.active && validWebhookUrl(s.url, hosts) && (subEvents(s).includes("*") || subEvents(s).includes(event)));
}

export class WebhookError extends Error {}

export async function createSub(rt: Runtime, input: { url?: unknown; events?: unknown }): Promise<WebhookSub> {
  const url = typeof input.url === "string" ? input.url.trim() : "";
  if (url.length > 500 || !validWebhookUrl(url, allowedHosts(rt))) throw new WebhookError(allowedHosts(rt).length ? "Use an https URL on an allowed host (see WEBHOOK_ALLOWED_HOSTS)." : "Use a public https URL (no IP addresses or local hosts).");
  const ev = Array.isArray(input.events) ? input.events.map(String) : [];
  const events = ev.includes("*") || !ev.length ? ["*"] : ev.filter((e) => (WEBHOOK_EVENTS as readonly string[]).includes(e));
  if (!events.length) throw new WebhookError("Pick at least one event.");
  if ((await listSubs(rt)).length >= 20) throw new WebhookError("Twenty webhooks at most.");
  const s: WebhookSub = { id: newId("wh"), url, events: events.join(","), secret: "whsec_" + randomToken(24), active: 1, created_at: rt.now() };
  await rt.env.DB.prepare("INSERT INTO webhook_subscriptions (id, url, events, secret, active, created_at) VALUES (?,?,?,?,?,?)").bind(s.id, s.url, s.events, s.secret, s.active, s.created_at).run();
  return s;
}

export async function setSubActive(rt: Runtime, id: string, active: boolean): Promise<boolean> {
  return !!(await rt.env.DB.prepare("UPDATE webhook_subscriptions SET active = ? WHERE id = ?").bind(active ? 1 : 0, id).run()).meta?.changes;
}

export async function deleteSub(rt: Runtime, id: string): Promise<boolean> {
  return !!(await rt.env.DB.prepare("DELETE FROM webhook_subscriptions WHERE id = ?").bind(id).run()).meta?.changes;
}

/** Subscriptions for the API tab: never the secret. */
export async function subsPayload(rt: Runtime) {
  const subs = await listSubs(rt);
  const stats = ((await rt.env.DB.prepare(
    "SELECT destination, SUM(status = 'sent') AS sent, SUM(status = 'failed') AS failed FROM forward_log WHERE destination LIKE 'wh_%' AND created_at >= ? GROUP BY destination",
  ).bind(rt.now() - 30 * 86_400_000).all<{ destination: string; sent: number; failed: number }>().catch(() => ({ results: [] }))).results) || [];
  return {
    events: WEBHOOK_EVENTS,
    subs: subs.map((s) => {
      const st = stats.find((x) => x.destination === s.id);
      return { id: s.id, url: s.url, events: subEvents(s), active: !!s.active, created_at: s.created_at, sent: Number(st?.sent) || 0, failed: Number(st?.failed) || 0 };
    }),
  };
}
