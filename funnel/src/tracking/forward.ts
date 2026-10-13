// Fan-out of server-side events to Meta CAPI, GA4 Measurement Protocol, PostHog and a CRM webhook.
// Every attempt is logged in forward_log; failures retry with backoff from the cron.

import type { Runtime } from "../app";
import { sha256Hex } from "../lib/crypto";
import { newId } from "../lib/ids";
import { consentRequiredFor } from "../lib/identity";
import { getLead, leadSessionContext, effectiveTier, type Lead } from "../funnel/leads";
import { EVENTS } from "./catalog";
import { isHttps, validOutbound } from "../lib/outbound";
import type { Who } from "./track";
import { popcount } from "./vsl";
import { settingsStageValue } from "../sales/values";

export type Destination = "meta" | "ga4" | "posthog" | "crm";

export interface ForwardEvent {
  id: string;
  ts: number;
  name: string;
  who: Who;
  props: Record<string, unknown>;
  value?: number;
  currency?: string;
}

const CRM_EVENTS = new Set([
  "lead_captured", "app_submitted", "lead_qualified", "booking_scheduled", "booking_rescheduled", "booking_cancelled",
  "call_showed", "call_no_show", "deal_won", "deal_lost", "payment_recorded", "lead_status_changed", "unsubscribed",
]);

/** CRM stages sent to Meta as offline conversions (action_source "system_generated"). */
export const CRM_STAGE_EVENTS = new Set(["call_showed", "call_no_show", "deal_won", "deal_lost", "payment_recorded", "lead_status_changed"]);

/**
 * The Meta event name for an event, or null when it is not sent to Meta. Most names come from the
 * catalog; a few depend on the event: refunds, disqualifications and the first application step.
 */
export function metaEventName(name: string, props: Record<string, unknown>, value?: number): string | null {
  const def = EVENTS[name];
  if (name === "lead_status_changed") return props.to === "disqualified" ? "Disqualified" : null;
  if (name === "payment_recorded") {
    const amount = typeof value === "number" ? value : Number(props.amount);
    if (!Number.isFinite(amount) || amount === 0) return null;
    return amount < 0 ? "Refund" : def?.meta || null;
  }
  return def?.meta || null;
}

/** Meta's own dedupe key. Stable per lead for once-per-lead events so a double send collapses. */
export function metaEventId(ev: Pick<ForwardEvent, "id" | "name" | "who">): string {
  if (ev.name === "app_step" && ev.who.leadId) return `startapp_${ev.who.leadId}`;
  return ev.id;
}

const BACKOFF_MIN = [1, 5, 30, 120, 720];
const MAX_ATTEMPTS = 5;

interface Prepared {
  dest: Destination;
  url: string;
  body: unknown;
  headers?: Record<string, string>;
  matchKeys: string[];
}

const norm = {
  email: (v: string) => v.trim().toLowerCase(),
  phone: (v: string) => v.replace(/\D/g, ""),
  name: (v: string) => v.trim().toLowerCase().normalize("NFKD").replace(/[^\p{L}]/gu, ""),
  country: (v: string) => v.trim().toLowerCase().slice(0, 2),
};

export async function metaUserData(lead: Lead | null, who: Who): Promise<{ data: Record<string, unknown>; keys: string[] }> {
  const ud: Record<string, unknown> = {};
  const keys: string[] = [];
  if (lead?.email) { ud.em = [await sha256Hex(norm.email(lead.email))]; keys.push("em"); }
  if (lead?.phone) { ud.ph = [await sha256Hex(norm.phone(lead.phone))]; keys.push("ph"); }
  if (lead?.first_name) { ud.fn = [await sha256Hex(norm.name(lead.first_name))]; keys.push("fn"); }
  if (lead?.last_name) { ud.ln = [await sha256Hex(norm.name(lead.last_name))]; keys.push("ln"); }
  const country = lead?.country || who.country;
  if (country) { ud.country = [await sha256Hex(norm.country(country))]; keys.push("country"); }
  const ext = lead?.id || who.visitorId;
  if (ext) { ud.external_id = [await sha256Hex(ext)]; keys.push("external_id"); }
  if (who.ip) { ud.client_ip_address = who.ip; keys.push("ip"); }
  if (who.ua) { ud.client_user_agent = who.ua; keys.push("ua"); }
  if (who.fbp) { ud.fbp = who.fbp; keys.push("fbp"); }
  if (who.fbc) { ud.fbc = who.fbc; keys.push("fbc"); }
  return { data: ud, keys };
}

async function prepare(rt: Runtime, ev: ForwardEvent): Promise<Prepared[]> {
  const s = rt.settings;
  const def = EVENTS[ev.name];
  if (!def) return [];
  const lead = await getLead(rt, ev.who.leadId);
  const who: Who = { ...ev.who };

  // Server-side events (webhooks, cron, admin) rebuild browser context from the lead's last session.
  let adsAllowed = who.adsAllowed;
  if (lead && (adsAllowed === undefined || !who.ip)) {
    const ctx = await leadSessionContext(rt, lead);
    who.ip ||= ctx.ip;
    who.ua ||= ctx.ua;
    who.fbp ||= ctx.fbp;
    who.fbc ||= ctx.fbc;
    who.country ||= ctx.country;
    if (adsAllowed === undefined) adsAllowed = ctx.consent !== "denied" && (!consentRequiredFor(rt, ctx.country) || ctx.consent === "granted");
  }
  if (adsAllowed === undefined) adsAllowed = !consentRequiredFor(rt, who.country ?? null);
  // Historical imports never produce ad conversions.
  if (lead?.booking_source === "calendly-direct") adsAllowed = false;

  const out: Prepared[] = [];
  const eventUrl = who.url || (rt.origin + (who.path || "/"));
  const value = ev.value ?? (typeof ev.props.value === "number" ? (ev.props.value as number) : undefined);
  const currency = ev.currency || "USD";

  let metaName = adsAllowed ? metaEventName(ev.name, ev.props, value) : null;
  // StartApplication: only the first application step per lead.
  if (metaName && ev.name === "app_step") {
    if (!lead) metaName = null;
    else if (await rt.env.DB.prepare("SELECT 1 AS x FROM forward_log WHERE destination = 'meta' AND event_name = 'app_step' AND lead_id = ? LIMIT 1").bind(lead.id).first()) metaName = null;
  }
  if (metaName && s.has("META_PIXEL_ID") && s.has("META_ACCESS_TOKEN")) {
    const { data, keys } = await metaUserData(lead, who);
    const custom: Record<string, unknown> = {};
    const tier = lead ? effectiveTier(lead) : typeof ev.props.tier === "string" ? (ev.props.tier as string) : null;
    // Stage values: P(won | stage, tier) x average deal once calibrated; the fixed tier value until then.
    const metaValue = settingsStageValue(s, ev.name, tier, value);
    if (metaValue != null) { custom.value = metaValue; custom.currency = currency; }
    if (tier) { custom.lead_tier = tier; custom.tier = tier; }
    if (typeof ev.props.video === "string") custom.content_name = ev.props.video;
    const watched = typeof ev.props.percent === "number" ? (ev.props.percent as number) : await watchedPct(rt, lead, who);
    if (watched != null) custom.watched_pct = watched;
    const crmStage = CRM_STAGE_EVENTS.has(ev.name);
    const body: Record<string, unknown> = {
      data: [{
        event_name: metaName,
        event_time: Math.floor(ev.ts / 1000),
        event_id: metaEventId(ev),
        action_source: crmStage ? "system_generated" : who.ip || who.ua ? "website" : "system_generated",
        event_source_url: eventUrl,
        user_data: data,
        custom_data: custom,
      }],
    };
    if (s.has("META_TEST_EVENT_CODE")) body.test_event_code = s.get("META_TEST_EVENT_CODE");
    out.push({ dest: "meta", url: `https://graph.facebook.com/v21.0/${encodeURIComponent(s.get("META_PIXEL_ID"))}/events`, body, matchKeys: keys });
  }

  if (adsAllowed && def.ga4 && s.has("GA4_MEASUREMENT_ID") && s.has("GA4_API_SECRET") && who.visitorId) {
    const params: Record<string, unknown> = { engagement_time_msec: 1, session_id: who.sessionId || undefined, page_location: eventUrl };
    if (value != null) { params.value = value; params.currency = currency; }
    for (const k of ["video", "percent", "step", "tier", "variant"]) if (ev.props[k] != null) params[k] = ev.props[k];
    if (ev.name.startsWith("vsl_") && ev.props.percent == null) {
      const m = ev.name.match(/vsl_(\d+)/);
      if (m) params.percent = Number(m[1]);
    }
    out.push({
      dest: "ga4",
      url: `https://www.google-analytics.com/mp/collect?measurement_id=${encodeURIComponent(s.get("GA4_MEASUREMENT_ID"))}&api_secret=${encodeURIComponent(s.get("GA4_API_SECRET"))}`,
      body: { client_id: who.visitorId, events: [{ name: def.ga4, params }] },
      matchKeys: ["client_id"],
    });
  }

  if (adsAllowed && s.has("POSTHOG_KEY") && who.visitorId && validOutbound("POSTHOG_HOST", s.get("POSTHOG_HOST"))) {
    const host = s.get("POSTHOG_HOST").replace(/\/+$/, "");
    const props: Record<string, unknown> = { $current_url: eventUrl, source: "server", variant: who.variant || undefined };
    // Only non-identifying fields. Never email, name, phone or free text.
    for (const k of ["video", "percent", "step", "tier", "status", "value", "kind", "sequence"]) if (ev.props[k] != null) props[k] = ev.props[k];
    if (lead) props.$set = { lead_id: lead.id, tier: effectiveTier(lead), status: lead.status };
    out.push({
      dest: "posthog",
      url: `${host}/capture/`,
      body: { api_key: s.get("POSTHOG_KEY"), event: ev.name, distinct_id: who.visitorId, timestamp: new Date(ev.ts).toISOString(), properties: props },
      matchKeys: ["distinct_id"],
    });
  }

  if (lead && CRM_EVENTS.has(ev.name) && s.has("LEAD_WEBHOOK_URL") && isHttps(s.get("LEAD_WEBHOOK_URL"))) {
    out.push({
      dest: "crm",
      url: s.get("LEAD_WEBHOOK_URL"),
      body: { event: ev.name, event_id: ev.id, ts: new Date(ev.ts).toISOString(), props: ev.props, lead: leadSnapshot(lead) },
      matchKeys: ["lead"],
    });
  }
  return out;
}

/** Share of the main film watched (0-100) by this lead or visitor, or null when they never played it. */
async function watchedPct(rt: Runtime, lead: Lead | null, who: Who): Promise<number | null> {
  const vid = who.visitorId || lead?.visitor_id || "";
  if (!lead && !vid) return null;
  const r = await rt.env.DB.prepare("SELECT buckets FROM vsl_views WHERE video = 'main' AND (lead_id = ? OR visitor_id = ?) ORDER BY last_at DESC LIMIT 1")
    .bind(lead?.id || "", vid).first<{ buckets: string }>().catch(() => null);
  return r ? popcount(r.buckets) : null;
}

export function leadSnapshot(lead: Lead) {
  return {
    id: lead.id, ref: lead.ref_code, first_name: lead.first_name, last_name: lead.last_name, email: lead.email, phone: lead.phone,
    status: lead.status, tier: effectiveTier(lead), score: lead.score, route: lead.route, closer_id: lead.closer_id,
    call_at: lead.call_at ? new Date(lead.call_at).toISOString() : null, revenue: lead.revenue, cash_collected: lead.cash_collected,
    channel: lead.channel, utm_source: lead.utm_source, utm_campaign: lead.utm_campaign, utm_content: lead.utm_content,
    country: lead.country, lander: lead.lander,
  };
}

async function send(p: Prepared): Promise<{ ok: boolean; status: number; error?: string }> {
  try {
    const r = await fetch(p.url, {
      method: "POST",
      headers: { "content-type": "application/json", ...(p.headers || {}) },
      body: JSON.stringify(p.body),
    });
    if (r.ok) return { ok: true, status: r.status };
    const t = (await r.text().catch(() => "")).slice(0, 300);
    return { ok: false, status: r.status, error: t };
  } catch (e) {
    return { ok: false, status: 0, error: e instanceof Error ? e.message : String(e) };
  }
}

function metaAuth(rt: Runtime, p: Prepared): Prepared {
  if (p.dest !== "meta") return p;
  return { ...p, url: `${p.url}?access_token=${encodeURIComponent(rt.settings.get("META_ACCESS_TOKEN"))}` };
}

export async function forwardEvent(rt: Runtime, ev: ForwardEvent): Promise<void> {
  const prepared = await prepare(rt, ev);
  for (const p of prepared) {
    const now = rt.now();
    const logId = newId("f");
    // Payload stored without credentials so the cron can retry it.
    const ins = await rt.env.DB.prepare(
      `INSERT INTO forward_log (id, event_id, event_name, destination, lead_id, status, attempts, match_keys, payload, created_at, updated_at)
       VALUES (?,?,?,?,?, 'sending', 1, ?, ?, ?, ?) ON CONFLICT(event_id, destination) DO NOTHING`,
    ).bind(logId, ev.id, ev.name, p.dest, ev.who.leadId ?? null, JSON.stringify(p.matchKeys), JSON.stringify({ url: stripSecrets(p), body: p.body }), now, now).run();
    if (!ins.meta?.changes) continue;
    const r = await send(metaAuth(rt, p));
    await finish(rt, logId, 1, r);
  }
}

function stripSecrets(p: Prepared): string {
  // GA4 api_secret lives in the query; re-derived at retry time.
  if (p.dest === "ga4") return "ga4";
  if (p.dest === "crm") return "crm";
  return p.url;
}

async function finish(rt: Runtime, logId: string, attempts: number, r: { ok: boolean; status: number; error?: string }) {
  const now = rt.now();
  if (r.ok) {
    await rt.env.DB.prepare("UPDATE forward_log SET status='sent', http_status=?, error=NULL, attempts=?, next_at=NULL, updated_at=? WHERE id=?")
      .bind(r.status, attempts, now, logId).run();
    return;
  }
  const permanent = attempts >= MAX_ATTEMPTS || (r.status >= 400 && r.status < 500 && r.status !== 429 && r.status !== 408);
  const next = permanent ? null : now + BACKOFF_MIN[Math.min(attempts - 1, BACKOFF_MIN.length - 1)] * 60_000;
  await rt.env.DB.prepare("UPDATE forward_log SET status=?, http_status=?, error=?, attempts=?, next_at=?, updated_at=? WHERE id=?")
    .bind(permanent ? "failed" : "retry", r.status, (r.error || "").slice(0, 300), attempts, next, now, logId).run();
}

function rebuildUrl(rt: Runtime, dest: string, stored: string): string | null {
  const s = rt.settings;
  if (dest === "ga4") {
    if (!s.has("GA4_MEASUREMENT_ID") || !s.has("GA4_API_SECRET")) return null;
    return `https://www.google-analytics.com/mp/collect?measurement_id=${encodeURIComponent(s.get("GA4_MEASUREMENT_ID"))}&api_secret=${encodeURIComponent(s.get("GA4_API_SECRET"))}`;
  }
  if (dest === "crm") return s.has("LEAD_WEBHOOK_URL") ? s.get("LEAD_WEBHOOK_URL") : null;
  if (dest === "meta") return s.has("META_ACCESS_TOKEN") ? stored : null;
  return stored;
}

/** Cron: retry failed forwards whose backoff has elapsed. */
export async function retryForwards(rt: Runtime): Promise<number> {
  const now = rt.now();
  const rows = await rt.env.DB.prepare(
    "SELECT id, destination, attempts, payload FROM forward_log WHERE status='retry' AND next_at <= ? ORDER BY next_at LIMIT 50",
  ).bind(now).all<{ id: string; destination: Destination; attempts: number; payload: string }>();
  let n = 0;
  for (const row of rows.results || []) {
    const claim = await rt.env.DB.prepare("UPDATE forward_log SET status='sending', updated_at=? WHERE id=? AND status='retry'").bind(now, row.id).run();
    if (!claim.meta?.changes) continue;
    let stored: { url: string; body: unknown };
    try { stored = JSON.parse(row.payload); } catch { continue; }
    const url = rebuildUrl(rt, row.destination, stored.url);
    if (!url) {
      await rt.env.DB.prepare("UPDATE forward_log SET status='failed', error='destination not configured', updated_at=? WHERE id=?").bind(now, row.id).run();
      continue;
    }
    const p = metaAuth(rt, { dest: row.destination, url, body: stored.body, matchKeys: [] });
    const r = await send(p);
    await finish(rt, row.id, row.attempts + 1, r);
    n++;
  }
  // Sends interrupted mid-flight (Worker evicted) go back to retry after 10 minutes.
  await rt.env.DB.prepare("UPDATE forward_log SET status='retry', next_at=? WHERE status='sending' AND updated_at < ?").bind(now, now - 10 * 60_000).run();
  return n;
}
