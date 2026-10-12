// /api/e beacon: browser-only signals (deep on-page behaviour). Whitelisted, capped, local-only.

import type { Runtime } from "../app";
import { CLIENT_EVENTS } from "./catalog";
import { track, type Who } from "./track";
import { clip, defang } from "../lib/text";

export const BEACON_MAX_BYTES = 32 * 1024;
export const BEACON_MAX_EVENTS = 25;
const MAX_KEYS = 20;
const MAX_VAL = 300;

export function flattenProps(input: unknown): Record<string, string | number | boolean> {
  const out: Record<string, string | number | boolean> = {};
  if (!input || typeof input !== "object" || Array.isArray(input)) return out;
  let n = 0;
  const walk = (obj: Record<string, unknown>, prefix: string) => {
    for (const [k, v] of Object.entries(obj)) {
      if (n >= MAX_KEYS) return;
      const key = (prefix ? prefix + "." : "") + k.replace(/[^\w.-]/g, "").slice(0, 40);
      if (!key) continue;
      if (v == null) continue;
      if (typeof v === "object" && !Array.isArray(v) && prefix.split(".").length < 2) { walk(v as Record<string, unknown>, key); continue; }
      if (typeof v === "number") { if (Number.isFinite(v)) { out[key] = v; n++; } continue; }
      if (typeof v === "boolean") { out[key] = v; n++; continue; }
      out[key] = String(Array.isArray(v) ? v.join(",") : v).slice(0, MAX_VAL);
      n++;
    }
  };
  walk(input as Record<string, unknown>, "");
  return out;
}

const PII_LIKE = /@|\+?\d[\d\s().-]{6,}\d|https?:|www\./i;

export function sanitizeClientEvent(name: string, props: Record<string, string | number | boolean>) {
  if (name === "text_select" || name === "text_copy") {
    const t = typeof props.text === "string" ? props.text : "";
    if (!t || PII_LIKE.test(t)) delete props.text;
    else props.text = clip(defang(t), 120);
  }
  if (name === "field_interaction") {
    // Never accept a value from the browser, whatever it sends.
    for (const k of Object.keys(props)) if (/value|text|content|input/i.test(k)) delete props[k];
  }
  return props;
}

export interface BeaconBody {
  events?: Array<{ n?: string; p?: unknown; path?: string }>;
  ctx?: { tz?: string; screen?: string; viewport?: string; dpr?: number; conn?: string };
}

export async function collectBeacon(rt: Runtime, who: Who, body: BeaconBody): Promise<number> {
  const evs = Array.isArray(body.events) ? body.events.slice(0, BEACON_MAX_EVENTS) : [];
  let stored = 0;
  let engaged = 0;
  let scroll = 0;
  for (const e of evs) {
    const name = typeof e.n === "string" ? e.n : "";
    if (!CLIENT_EVENTS.has(name)) continue;
    const props = sanitizeClientEvent(name, flattenProps(e.p));
    const path = typeof e.path === "string" && e.path.startsWith("/") ? e.path.slice(0, 200) : who.path;
    if (name === "engaged" && typeof props.ms === "number") engaged = Math.max(engaged, Math.min(props.ms, 6 * 3600_000));
    if (name === "scroll" && typeof props.pct === "number") scroll = Math.max(scroll, Math.min(100, props.pct));
    await track(rt, { ...who, path }, { name, source: "client", props, localOnly: true });
    stored++;
  }
  if (who.sessionId) {
    const c = body.ctx || {};
    const s = (v: unknown, n: number) => (typeof v === "string" ? v.slice(0, n) : null);
    await rt.env.DB.prepare(
      `UPDATE sessions SET event_count = event_count + ?, engaged_ms = MAX(engaged_ms, ?), max_scroll = MAX(max_scroll, ?),
        client_tz = COALESCE(?, client_tz), screen = COALESCE(?, screen), viewport = COALESCE(?, viewport),
        dpr = COALESCE(?, dpr), connection = COALESCE(?, connection), last_seen_at = ? WHERE id = ?`,
    ).bind(
      stored, engaged, scroll, s(c.tz, 64), s(c.screen, 20), s(c.viewport, 20),
      typeof c.dpr === "number" && Number.isFinite(c.dpr) ? c.dpr : null, s(c.conn, 20), rt.now(), who.sessionId,
    ).run();
  }
  return stored;
}
