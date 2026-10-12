import type { Runtime } from "../app";
import { BRAND } from "../config";
import { kvGate } from "../lib/kv";
import { notifyTeam, notifyText } from "../integrations/notify";
import { localParts, validTimezone } from "../integrations/sequences";
import { popcount } from "../tracking/vsl";
import type { Lead } from "../funnel/leads";

/** Ping the assigned rep ~15 minutes before each call, with how much of the film they watched. */
export async function pingUpcomingCalls(rt: Runtime): Promise<number> {
  const now = rt.now();
  const rows = (await rt.env.DB.prepare(
    "SELECT * FROM leads WHERE status = 'booked' AND booking_cancelled_at IS NULL AND booking_source = 'funnel' AND call_at > ? AND call_at <= ?",
  ).bind(now + 5 * 60_000, now + 20 * 60_000).all<Lead>()).results || [];
  let n = 0;
  for (const l of rows) {
    if (!(await kvGate(rt.env, `ping:${l.id}:${l.call_at}`, 365 * 86_400_000))) continue;
    const v = await rt.env.DB.prepare("SELECT buckets FROM vsl_views WHERE (lead_id = ? OR visitor_id = ?) AND video = 'main'").bind(l.id, l.visitor_id || "").first<{ buckets: string }>();
    const pct = v ? popcount(v.buckets) : 0;
    rt.waitUntil(notifyTeam(rt, "call_soon", l, `Watched ${pct}% of the film`));
    n++;
  }
  return n;
}

export interface DigestNumbers {
  visitors: number; leads: number; applied: number; a: number; b: number; booked: number; showed: number; won: number; cash: number; callsToday: number;
}

export async function digestNumbers(rt: Runtime, since: number, dayStart: number, dayEnd: number): Promise<DigestNumbers> {
  const db = rt.env.DB;
  const v = await db.prepare("SELECT COUNT(DISTINCT visitor_id) AS n FROM sessions WHERE started_at >= ? AND is_bot = 0").bind(since).first<{ n: number }>();
  const l = await db.prepare(
    `SELECT COUNT(*) AS leads, SUM(app_completed_at >= ?) AS applied,
       SUM(app_completed_at >= ? AND COALESCE(tier_override, tier) = 'A') AS a, SUM(app_completed_at >= ? AND COALESCE(tier_override, tier) = 'B') AS b
     FROM leads WHERE created_at >= ? AND booking_source = 'funnel'`,
  ).bind(since, since, since, since).first<{ leads: number; applied: number; a: number; b: number }>();
  const e = await db.prepare(
    `SELECT SUM(name='booking_scheduled') AS booked, SUM(name='call_showed') AS showed, SUM(name='deal_won') AS won FROM events WHERE ts >= ? AND name IN ('booking_scheduled','call_showed','deal_won')`,
  ).bind(since).first<{ booked: number; showed: number; won: number }>();
  const cash = await db.prepare("SELECT COALESCE(SUM(amount),0) AS c FROM payments WHERE paid_at >= ?").bind(since).first<{ c: number }>();
  const calls = await db.prepare("SELECT COUNT(*) AS n FROM leads WHERE status = 'booked' AND call_at >= ? AND call_at < ?").bind(dayStart, dayEnd).first<{ n: number }>();
  return {
    visitors: v?.n || 0, leads: l?.leads || 0, applied: l?.applied || 0, a: l?.a || 0, b: l?.b || 0,
    booked: e?.booked || 0, showed: e?.showed || 0, won: e?.won || 0, cash: cash?.c || 0, callsToday: calls?.n || 0,
  };
}

/** Daily digest at DIGEST_HOUR in the sales time zone. */
export async function maybeSendDigest(rt: Runtime): Promise<boolean> {
  const s = rt.settings;
  if (!s.has("SLACK_WEBHOOK_URL") && !s.has("DISCORD_WEBHOOK_URL")) return false;
  const tz = validTimezone(s.get("SALES_TIMEZONE")) ? s.get("SALES_TIMEZONE") : BRAND.salesTimezone;
  const now = rt.now();
  const p = localParts(now, tz);
  if (p.hh !== s.num("DIGEST_HOUR", 8)) return false;
  if (!(await kvGate(rt.env, `digest:${p.y}-${p.mo}-${p.d}`, 365 * 86_400_000))) return false;
  const n = await digestNumbers(rt, now - 86_400_000, now, now + 86_400_000);
  await notifyText(rt, `${BRAND.name} · last 24 hours`, [
    `Visitors ${n.visitors} · Leads ${n.leads} · Applications ${n.applied} (A ${n.a}, B ${n.b})`,
    `Booked ${n.booked} · Held ${n.showed} · Won ${n.won} · Cash ${Math.round(n.cash).toLocaleString("en-US")}`,
    `Calls in the next 24 hours: ${n.callsToday}`,
    `${rt.origin}/admin`,
  ]);
  return true;
}
