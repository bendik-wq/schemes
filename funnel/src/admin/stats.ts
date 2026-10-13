// Funnel HQ report queries: shared filters, overview + funnel + daily trend, funnel-map stats,
// VSL retention, traffic by dimension, application drop-off, tracking/forwarding health, live stream.
// Every list here is aggregate or minimal: no raw IPs, no user agents, no free text from beacons.

import type { Runtime } from "../app";
import { APPLICATION, BRAND, HEADLINES, VIDEOS, type VideoId } from "../config";
import { localParts, tzOffset, validTimezone, zonedTime } from "../integrations/sequences";
import { MICRO_EVENTS } from "../tracking/catalog";
import { BUCKETS, bucketSet, popcount } from "../tracking/vsl";

// ── Small D1 helpers ─────────────────────────────────────────────────────────

export async function all<T>(rt: Runtime, sql: string, binds: unknown[] = []): Promise<T[]> {
  return ((await rt.env.DB.prepare(sql).bind(...binds).all<T>()).results || []) as T[];
}

export async function one<T>(rt: Runtime, sql: string, binds: unknown[] = []): Promise<T | null> {
  return (await rt.env.DB.prepare(sql).bind(...binds).first<T>()) || null;
}

export const num = (v: unknown): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

/** Percentage with one decimal, or null when the denominator is zero. */
export const pct = (a: number, b: number): number | null => (b > 0 ? Math.round((a / b) * 1000) / 10 : null);

export function salesTz(rt: Runtime): string {
  const tz = rt.settings.get("SALES_TIMEZONE");
  return validTimezone(tz) ? tz : BRAND.salesTimezone;
}

// ── Filters ──────────────────────────────────────────────────────────────────

export const RANGES = ["today", "7d", "30d", "90d", "all"] as const;
export type Range = (typeof RANGES)[number];

export interface Filters {
  range: Range;
  since: number;
  until: number;
  /** Start of the previous window of the same length (null for "all"). */
  prevSince: number | null;
  channel: string | null;
  campaign: string | null;
  variant: string | null;
  device: string | null;
}

const DAY = 86_400_000;

function cleanFilterValue(v: string | undefined | null): string | null {
  if (v == null) return null;
  const s = String(v).trim().slice(0, 120);
  return s ? s : null;
}

export function parseFilters(query: (k: string) => string | undefined, now: number, tz: string): Filters {
  const r = query("range");
  const range: Range = (RANGES as readonly string[]).includes(r || "") ? (r as Range) : "30d";
  let since = 0;
  if (range === "today") {
    const p = localParts(now, tz);
    since = zonedTime(p.y, p.mo, p.d, 0, 0, tz);
  } else if (range === "7d") since = now - 7 * DAY;
  else if (range === "30d") since = now - 30 * DAY;
  else if (range === "90d") since = now - 90 * DAY;
  const prevSince = range === "all" ? null : since - (now - since);
  return {
    range, since, until: now + 60_000, prevSince,
    channel: cleanFilterValue(query("channel")),
    campaign: cleanFilterValue(query("campaign")),
    variant: cleanFilterValue(query("variant")),
    device: cleanFilterValue(query("device")),
  };
}

/** Turn plain `?` placeholders into ?N, ?N+1… so they can follow numbered ones. */
export function renumber(sql: string, start: number): string {
  let i = start;
  return sql.replace(/\?(?!\d)/g, () => `?${i++}`);
}

export const hasDims = (f: Filters) => !!(f.channel || f.campaign || f.variant || f.device);

interface Frag { sql: string; binds: unknown[] }

/** Dimension filters on a sessions alias. */
export function sessDims(f: Filters, a = "s"): Frag {
  const parts: string[] = [];
  const binds: unknown[] = [];
  if (f.channel) { parts.push(`${a}.channel = ?`); binds.push(f.channel); }
  if (f.campaign) { parts.push(`${a}.utm_campaign = ?`); binds.push(f.campaign); }
  if (f.variant) { parts.push(`${a}.variant = ?`); binds.push(f.variant); }
  if (f.device) { parts.push(`${a}.device = ?`); binds.push(f.device); }
  return { sql: parts.length ? " AND " + parts.join(" AND ") : "", binds };
}

/** Dimension filters on a leads alias (first touch first, then last touch). */
export function leadDims(f: Filters, a = "l"): Frag {
  const parts: string[] = [];
  const binds: unknown[] = [];
  if (f.channel) { parts.push(`COALESCE(${a}.ft_channel, ${a}.channel) = ?`); binds.push(f.channel); }
  if (f.campaign) { parts.push(`COALESCE(${a}.ft_campaign, ${a}.utm_campaign) = ?`); binds.push(f.campaign); }
  if (f.variant) { parts.push(`${a}.variant = ?`); binds.push(f.variant); }
  if (f.device) { parts.push(`${a}.device = ?`); binds.push(f.device); }
  return { sql: parts.length ? " AND " + parts.join(" AND ") : "", binds };
}

/** Restrict a visitor-id column to visitors that had a matching session. */
export function visitorDims(f: Filters, col: string): Frag {
  if (!hasDims(f)) return { sql: "", binds: [] };
  const d = sessDims(f, "fs");
  return { sql: ` AND ${col} IN (SELECT fs.visitor_id FROM sessions fs WHERE 1=1${d.sql})`, binds: d.binds };
}

/** Distinct values for the filter bar. */
export async function filterOptions(rt: Runtime) {
  const since = rt.now() - 365 * DAY;
  const q = (col: string) =>
    all<{ v: string; n: number }>(rt, `SELECT ${col} AS v, COUNT(*) AS n FROM sessions WHERE started_at >= ? AND is_bot = 0 AND ${col} IS NOT NULL AND ${col} != '' GROUP BY ${col} ORDER BY n DESC LIMIT 40`, [since]);
  const [channels, campaigns, variants, devices] = await Promise.all([q("channel"), q("utm_campaign"), q("variant"), q("device")]);
  const vs = new Set(variants.map((v) => v.v));
  for (const h of HEADLINES) vs.add(h.id);
  return {
    channels: channels.map((r) => r.v),
    campaigns: campaigns.map((r) => r.v),
    variants: [...vs].sort(),
    devices: devices.map((r) => r.v),
  };
}

// ── KPIs and funnel ──────────────────────────────────────────────────────────

export interface Counts {
  visitors: number; plays: number; pitch: number; cta_clicks: number; completed: number; apply_start: number; optins: number;
  applied: number; qualified: number; tier_a: number; tier_b: number; tier_c: number; booked: number; showed: number; no_show: number;
  won: number; lost: number; revenue: number; cash: number; whatsapp: number;
}

export async function windowCounts(rt: Runtime, f: Filters, from: number, to: number): Promise<Counts> {
  const sd = sessDims(f, "s");
  const vdV = visitorDims(f, "v.visitor_id");
  const vdE = visitorDims(f, "e.visitor_id");
  const ld = leadDims(f, "l");
  const [vis, vsl, starts, leads, cash, wa] = await Promise.all([
    one<{ n: number }>(rt, `SELECT COUNT(DISTINCT s.visitor_id) AS n FROM sessions s WHERE s.is_bot = 0 AND s.started_at >= ? AND s.started_at < ?${sd.sql}`, [from, to, ...sd.binds]),
    one<{ plays: number; pitch: number; clicks: number; done: number }>(rt,
      `SELECT SUM(v.played) AS plays, SUM(v.cta_revealed) AS pitch, SUM(v.cta_clicked) AS clicks, SUM(v.completed) AS done
       FROM vsl_views v WHERE v.video = 'main' AND v.first_at >= ? AND v.first_at < ?
         AND v.visitor_id NOT IN (SELECT id FROM visitors WHERE is_bot = 1)${vdV.sql}`, [from, to, ...vdV.binds]),
    one<{ n: number }>(rt, `SELECT COUNT(DISTINCT e.visitor_id) AS n FROM events e WHERE e.name = 'page_view' AND e.path = '/apply' AND e.is_bot = 0 AND e.ts >= ? AND e.ts < ?${vdE.sql}`, [from, to, ...vdE.binds]),
    one<Record<string, number>>(rt,
      `SELECT
         SUM(l.created_at >= ?1 AND l.created_at < ?2) AS optins,
         SUM(l.app_completed_at >= ?1 AND l.app_completed_at < ?2) AS applied,
         SUM(l.app_completed_at >= ?1 AND l.app_completed_at < ?2 AND COALESCE(l.tier_override, l.tier) IN ('A','B')) AS qualified,
         SUM(l.app_completed_at >= ?1 AND l.app_completed_at < ?2 AND COALESCE(l.tier_override, l.tier) = 'A') AS tier_a,
         SUM(l.app_completed_at >= ?1 AND l.app_completed_at < ?2 AND COALESCE(l.tier_override, l.tier) = 'B') AS tier_b,
         SUM(l.app_completed_at >= ?1 AND l.app_completed_at < ?2 AND COALESCE(l.tier_override, l.tier) = 'C') AS tier_c,
         SUM(l.booked_at >= ?1 AND l.booked_at < ?2) AS booked,
         SUM(l.showed_at >= ?1 AND l.showed_at < ?2) AS showed,
         SUM(l.status = 'no_show' AND l.call_at >= ?1 AND l.call_at < ?2) AS no_show,
         SUM(l.status = 'won' AND l.closed_at >= ?1 AND l.closed_at < ?2) AS won,
         SUM(l.status = 'lost' AND l.closed_at >= ?1 AND l.closed_at < ?2) AS lost,
         SUM(CASE WHEN l.status = 'won' AND l.closed_at >= ?1 AND l.closed_at < ?2 THEN l.revenue ELSE 0 END) AS revenue
       FROM leads l WHERE l.booking_source = 'funnel'${renumber(ld.sql, 3)}`,
      [from, to, ...ld.binds]),
    one<{ c: number }>(rt, `SELECT COALESCE(SUM(p.amount), 0) AS c FROM payments p JOIN leads l ON l.id = p.lead_id WHERE p.paid_at >= ? AND p.paid_at < ?${ld.sql}`, [from, to, ...ld.binds]),
    one<{ n: number }>(rt, `SELECT COUNT(*) AS n FROM events e WHERE e.name = 'whatsapp_click' AND e.is_bot = 0 AND e.ts >= ? AND e.ts < ?${vdE.sql}`, [from, to, ...vdE.binds]),
  ]);
  const L = leads || {};
  return {
    visitors: num(vis?.n), plays: num(vsl?.plays), pitch: num(vsl?.pitch), cta_clicks: num(vsl?.clicks), completed: num(vsl?.done),
    apply_start: num(starts?.n), optins: num(L.optins), applied: num(L.applied), qualified: num(L.qualified),
    tier_a: num(L.tier_a), tier_b: num(L.tier_b), tier_c: num(L.tier_c), booked: num(L.booked), showed: num(L.showed),
    no_show: num(L.no_show), won: num(L.won), lost: num(L.lost), revenue: num(L.revenue), cash: num(cash?.c), whatsapp: num(wa?.n),
  };
}

export const FUNNEL_STEPS: Array<{ key: keyof Counts; label: string }> = [
  { key: "visitors", label: "Landed" },
  { key: "plays", label: "Played the film" },
  { key: "pitch", label: "Reached the pitch" },
  { key: "apply_start", label: "Started applying" },
  { key: "applied", label: "Applied" },
  { key: "qualified", label: "Qualified (A/B)" },
  { key: "booked", label: "Booked" },
  { key: "showed", label: "Showed" },
  { key: "won", label: "Won" },
];

/** Step conversion. Rates over 100% (different time anchors per step) are hidden as null. */
export function funnelRows(c: Counts) {
  return FUNNEL_STEPS.map((s, i) => {
    const n = c[s.key];
    const prev = i ? c[FUNNEL_STEPS[i - 1].key] : null;
    const step = prev == null ? null : pct(n, prev);
    const total = pct(n, c.visitors);
    return { key: s.key, label: s.label, n, step: step != null && step > 100 ? null : step, of_total: total != null && total > 100 ? null : total };
  });
}

export async function dailyTrend(rt: Runtime, f: Filters) {
  const tz = salesTz(rt);
  const now = rt.now();
  let since = f.since;
  if (f.range === "all") {
    const first = await one<{ t: number }>(rt, "SELECT MIN(started_at) AS t FROM sessions WHERE is_bot = 0");
    since = Math.max(num(first?.t) || now - 30 * DAY, now - 365 * DAY);
  }
  if (f.range === "today") since = now - 14 * DAY; // a single point is not a trend
  else if (f.range !== "all") {
    // Start at the first full local day so the line does not open on a partial day.
    const p = localParts(since + DAY, tz);
    since = zonedTime(p.y, p.mo, p.d, 0, 0, tz);
  }
  const off = tzOffset(now, tz);
  const day = (col: string) => `strftime('%Y-%m-%d', (${col} + ${Math.trunc(off)}) / 1000, 'unixepoch')`;
  const sd = sessDims(f, "s");
  const ld = leadDims(f, "l");
  const [vis, opt, app, bk, won] = await Promise.all([
    all<{ d: string; n: number }>(rt, `SELECT ${day("s.started_at")} AS d, COUNT(DISTINCT s.visitor_id) AS n FROM sessions s WHERE s.is_bot = 0 AND s.started_at >= ?${sd.sql} GROUP BY d`, [since, ...sd.binds]),
    all<{ d: string; n: number }>(rt, `SELECT ${day("l.created_at")} AS d, COUNT(*) AS n FROM leads l WHERE l.booking_source = 'funnel' AND l.created_at >= ?${ld.sql} GROUP BY d`, [since, ...ld.binds]),
    all<{ d: string; n: number }>(rt, `SELECT ${day("l.app_completed_at")} AS d, COUNT(*) AS n FROM leads l WHERE l.booking_source = 'funnel' AND l.app_completed_at >= ?${ld.sql} GROUP BY d`, [since, ...ld.binds]),
    all<{ d: string; n: number }>(rt, `SELECT ${day("l.booked_at")} AS d, COUNT(*) AS n FROM leads l WHERE l.booking_source = 'funnel' AND l.booked_at >= ?${ld.sql} GROUP BY d`, [since, ...ld.binds]),
    all<{ d: string; n: number }>(rt, `SELECT ${day("l.closed_at")} AS d, COUNT(*) AS n FROM leads l WHERE l.status = 'won' AND l.closed_at >= ?${ld.sql} GROUP BY d`, [since, ...ld.binds]),
  ]);
  const days: string[] = [];
  for (let t = since; t <= now; t += DAY) {
    const p = localParts(t, tz);
    const k = `${p.y}-${String(p.mo).padStart(2, "0")}-${String(p.d).padStart(2, "0")}`;
    if (days[days.length - 1] !== k) days.push(k);
  }
  const todayP = localParts(now, tz);
  const todayK = `${todayP.y}-${String(todayP.mo).padStart(2, "0")}-${String(todayP.d).padStart(2, "0")}`;
  if (days[days.length - 1] !== todayK) days.push(todayK);
  const series = (rows: Array<{ d: string; n: number }>) => {
    const m = new Map(rows.map((r) => [r.d, num(r.n)]));
    return days.map((d) => m.get(d) || 0);
  };
  return { days, series: { visitors: series(vis), optins: series(opt), applications: series(app), booked: series(bk), won: series(won) } };
}

export async function overview(rt: Runtime, f: Filters) {
  const [cur, prev, trend] = await Promise.all([
    windowCounts(rt, f, f.since, f.until),
    f.prevSince != null ? windowCounts(rt, f, f.prevSince, f.since) : Promise.resolve(null),
    dailyTrend(rt, f),
  ]);
  const kpi = (c: Counts) => ({
    visitors: c.visitors,
    play_rate: pct(c.plays, c.visitors),
    applications: c.applied,
    booked: c.booked,
    optin_rate: pct(c.optins, c.visitors),
    pitch_rate: pct(c.pitch, c.plays),
    revenue: c.revenue,
    cash: c.cash,
    whatsapp: c.whatsapp,
  });
  return {
    range: f.range, since: f.since,
    kpis: kpi(cur),
    prev: prev ? kpi(prev) : null,
    counts: cur,
    funnel: funnelRows(cur),
    trend,
  };
}

/** Counts and rates for the funnel map's nodes and edges. Rate keys are referenced by funnel-map.js. */
export async function funnelMapStats(rt: Runtime, f: Filters) {
  const c = await windowCounts(rt, f, f.since, f.until);
  const ld = leadDims(f, "l");
  const sd = sessDims(f, "s");
  const [route, emails, calls, landers, main] = await Promise.all([
    one<{ n: number }>(rt, `SELECT COUNT(DISTINCT s.visitor_id) AS n FROM sessions s WHERE s.is_bot = 0 AND s.started_at >= ? AND s.landing_path = '/m'${sd.sql}`, [f.since, ...sd.binds]),
    all<{ sequence: string; n: number }>(rt, `SELECT sequence, COUNT(*) AS n FROM emails WHERE status IN ('sent','simulated') AND sent_at >= ? GROUP BY sequence`, [f.since]),
    all<{ kind: string; n: number }>(rt, `SELECT kind, COUNT(*) AS n FROM outbound_calls WHERE created_at >= ? GROUP BY kind`, [f.since]),
    one<{ n: number }>(rt, `SELECT COUNT(DISTINCT s.visitor_id) AS n FROM sessions s WHERE s.is_bot = 0 AND s.started_at >= ? AND s.lander IS NOT NULL${sd.sql}`, [f.since, ...sd.binds]),
    one<{ n: number }>(rt, `SELECT COUNT(DISTINCT e.visitor_id) AS n FROM events e WHERE e.name = 'page_view' AND e.path = '/' AND e.is_bot = 0 AND e.ts >= ?`, [f.since]),
  ]);
  const extra = await Promise.all([
    one<{ n: number }>(rt, `SELECT COUNT(*) AS n FROM forward_log WHERE created_at >= ? AND status = 'sent'`, [f.since]),
    one<{ n: number }>(rt, `SELECT COUNT(*) AS n FROM voice_calls WHERE direction = 'inbound' AND created_at >= ?`, [f.since]),
    one<{ n: number }>(rt, `SELECT COUNT(*) AS n FROM events WHERE name = 'trigger_fired' AND ts >= ?`, [f.since]),
    one<{ n: number }>(rt, `SELECT COUNT(*) AS n FROM leads l WHERE l.booking_cancelled_at >= ?${ld.sql}`, [f.since, ...ld.binds]),
    one<{ n: number }>(rt, `SELECT COUNT(DISTINCT e.visitor_id) AS n FROM events e WHERE e.name = 'page_view' AND e.path = '/book' AND e.is_bot = 0 AND e.ts >= ?`, [f.since]),
    one<{ n: number }>(rt, `SELECT COUNT(DISTINCT e.visitor_id) AS n FROM events e WHERE e.name = 'page_view' AND e.path = '/breakout' AND e.is_bot = 0 AND e.ts >= ?`, [f.since]),
    one<{ n: number }>(rt, `SELECT COUNT(DISTINCT e.visitor_id) AS n FROM events e WHERE e.name = 'page_view' AND e.path = '/resources' AND e.is_bot = 0 AND e.ts >= ?`, [f.since]),
  ]);
  const ch = await all<{ g: string; n: number }>(rt,
    `SELECT CASE WHEN s.channel IN ('Paid Social','Paid Search','Paid Video','Paid Other') THEN 'paid'
                 WHEN s.channel IN ('Organic Video') OR s.landing_query LIKE '%lk=%' THEN 'video'
                 WHEN s.channel IN ('Direct','Email','SMS') THEN 'direct' ELSE 'organic' END AS g,
       COUNT(DISTINCT s.visitor_id) AS n FROM sessions s WHERE s.is_bot = 0 AND s.started_at >= ?${sd.sql} GROUP BY g`, [f.since, ...sd.binds]);
  const em = Object.fromEntries(emails.map((r) => [r.sequence, num(r.n)]));
  const cl = Object.fromEntries(calls.map((r) => [r.kind, num(r.n)]));
  const counts: Record<string, number> = {
    ...c,
    meta_route: num(route?.n), landers: num(landers?.n), main_page: num(main?.n),
    forwards: num(extra[0]?.n), inbound_calls: num(extra[1]?.n), triggers: num(extra[2]?.n), cancelled: num(extra[3]?.n),
    book_page: num(extra[4]?.n), breakout_page: num(extra[5]?.n), resources_page: num(extra[6]?.n),
    call_speed: cl.speed_to_lead || 0, call_confirm: cl.confirm || 0, call_rebook: cl.rebook || 0,
  };
  for (const [k, v] of Object.entries(em)) counts[`email_${k}`] = v;
  for (const g of ["paid", "video", "organic", "direct"]) counts[`src_${g}`] = num(ch.find((r) => r.g === g)?.n);
  const rates: Record<string, number | null> = {
    visit_play: pct(c.plays, c.visitors),
    play_pitch: pct(c.pitch, c.plays),
    pitch_apply: pct(c.apply_start, c.pitch),
    visit_apply: pct(c.apply_start, c.visitors),
    apply_optin: pct(c.optins, c.apply_start),
    optin_applied: pct(c.applied, c.optins),
    applied_a: pct(c.tier_a, c.applied),
    applied_b: pct(c.tier_b, c.applied),
    applied_c: pct(c.tier_c, c.applied),
    a_booked: pct(c.booked, c.tier_a + c.tier_b),
    booked_showed: pct(c.showed, c.showed + c.no_show),
    booked_noshow: pct(c.no_show, c.showed + c.no_show),
    showed_won: pct(c.won, c.showed),
    showed_lost: pct(c.lost, c.showed),
  };
  for (const k of Object.keys(rates)) if (rates[k] != null && (rates[k] as number) > 100) rates[k] = null;
  return { counts, rates };
}

// ── VSL ──────────────────────────────────────────────────────────────────────

export async function vslReport(rt: Runtime, f: Filters, videoParam: string | undefined) {
  const video = (videoParam && videoParam in VIDEOS ? videoParam : "main") as VideoId;
  const cfg = VIDEOS[video];
  const vd = visitorDims(f, "v.visitor_id");
  const rows = await all<{ buckets: string; played: number; unmuted: number; completed: number; cta_revealed: number; cta_clicked: number; watched_seconds: number; lead_id: string | null }>(rt,
    `SELECT v.buckets, v.played, v.unmuted, v.completed, v.cta_revealed, v.cta_clicked, v.watched_seconds, v.lead_id FROM vsl_views v
     WHERE v.video = ? AND v.first_at >= ? AND v.visitor_id NOT IN (SELECT id FROM visitors WHERE is_bot = 1)${vd.sql} LIMIT 25000`,
    [video, f.since, ...vd.binds]);
  const plays = rows.filter((r) => r.played).length;
  const viewers = rows.filter((r) => r.unmuted);
  const counts = new Array(BUCKETS).fill(0);
  let watchedPctSum = 0;
  const dist = new Array(10).fill(0);
  for (const r of viewers) {
    for (let i = 0; i < BUCKETS; i++) if (bucketSet(r.buckets, i)) counts[i]++;
    const w = popcount(r.buckets);
    watchedPctSum += w;
    dist[Math.min(9, Math.floor(w / 10))]++;
  }
  const n = viewers.length;
  const retention = counts.map((x) => (n ? Math.round((x / n) * 1000) / 10 : 0));
  const at = (sec: number) => retention[Math.min(BUCKETS - 1, Math.max(0, Math.floor((sec / cfg.duration) * BUCKETS)))] ?? 0;
  const chapters = cfg.chapters.map((ch, i) => {
    const end = cfg.chapters[i + 1]?.at ?? cfg.duration;
    return { key: ch.key, label: ch.label, at: ch.at, end, start_retention: at(ch.at), end_retention: at(Math.max(ch.at, end - 1)) };
  });
  let worst: { at: number; drop: number } | null = null;
  for (let i = 2; i < BUCKETS; i++) {
    const drop = retention[i - 1] - retention[i];
    if (!worst || drop > worst.drop) worst = { at: Math.round((i / BUCKETS) * cfg.duration), drop: Math.round(drop * 10) / 10 };
  }
  const leadsFromViewers = viewers.filter((r) => r.lead_id).length;
  return {
    video,
    videos: Object.values(VIDEOS).map((v) => ({ id: v.id, title: v.title })),
    title: cfg.title,
    duration: cfg.duration,
    cta_reveal_at: cfg.ctaRevealAt,
    kpis: {
      plays,
      viewers: n,
      unmute_rate: pct(n, plays),
      avg_watched_pct: n ? Math.round((watchedPctSum / n) * 10) / 10 : null,
      completed: viewers.filter((r) => r.completed).length,
      completion_rate: pct(viewers.filter((r) => r.completed).length, n),
      pitch: rows.filter((r) => r.cta_revealed).length,
      pitch_rate: pct(rows.filter((r) => r.cta_revealed).length, plays),
      cta_clicks: rows.filter((r) => r.cta_clicked).length,
      cta_click_rate: pct(rows.filter((r) => r.cta_clicked).length, rows.filter((r) => r.cta_revealed).length),
      became_leads: leadsFromViewers,
    },
    retention,
    milestones: [25, 50, 75, 95].map((m) => ({ pct: m, viewers: viewers.filter((r) => popcount(r.buckets) >= m).length })),
    watched_distribution: dist.map((v, i) => ({ from: i * 10, to: i * 10 + 10, viewers: v })),
    chapters,
    biggest_drop: worst,
  };
}

// ── Traffic and ads ──────────────────────────────────────────────────────────

export const TRAFFIC_DIMS: Array<{ id: string; label: string; col: string }> = [
  { id: "channel", label: "Channel", col: "s.channel" },
  { id: "source", label: "Source", col: "s.utm_source" },
  { id: "medium", label: "Medium", col: "s.utm_medium" },
  { id: "campaign", label: "Campaign", col: "s.utm_campaign" },
  { id: "content", label: "Ad (utm_content)", col: "s.utm_content" },
  { id: "term", label: "Ad set (utm_term)", col: "s.utm_term" },
  { id: "ad_id", label: "Ad id", col: "s.ad_id" },
  { id: "placement", label: "Placement", col: "s.placement" },
  { id: "landing_path", label: "Landing page", col: "s.landing_path" },
  { id: "referrer_host", label: "Referrer", col: "s.referrer_host" },
  { id: "country", label: "Country", col: "s.country" },
  { id: "device", label: "Device", col: "s.device" },
  { id: "browser", label: "Browser", col: "s.browser" },
  { id: "os", label: "OS", col: "s.os" },
  { id: "variant", label: "Headline variant", col: "s.variant" },
];

export async function trafficReport(rt: Runtime, f: Filters, dimParam: string | undefined) {
  const dim = TRAFFIC_DIMS.find((d) => d.id === dimParam) || TRAFFIC_DIMS[0];
  const sd = sessDims(f, "s");
  const key = `COALESCE(NULLIF(${dim.col}, ''), '(none)')`;
  const base = `SELECT DISTINCT ${key} AS k, s.visitor_id AS vid FROM sessions s WHERE s.is_bot = 0 AND s.started_at >= ? AND s.started_at < ?${sd.sql}`;
  const binds = [f.since, f.until, ...sd.binds];
  const [vis, sess, plays, leads, cash] = await Promise.all([
    all<{ k: string; visitors: number }>(rt, `SELECT k, COUNT(*) AS visitors FROM (${base}) GROUP BY k ORDER BY visitors DESC LIMIT 200`, binds),
    all<{ k: string; sessions: number; engaged: number; bounce: number }>(rt,
      `SELECT ${key} AS k, COUNT(*) AS sessions, AVG(s.engaged_ms) AS engaged, SUM(s.pageviews <= 1 AND s.engaged_ms < 10000) AS bounce
       FROM sessions s WHERE s.is_bot = 0 AND s.started_at >= ? AND s.started_at < ?${sd.sql} GROUP BY k`, binds),
    all<{ k: string; plays: number }>(rt,
      `SELECT b.k, COUNT(*) AS plays FROM (${base}) b JOIN vsl_views v ON v.visitor_id = b.vid AND v.video = 'main' AND v.played = 1 GROUP BY b.k`, binds),
    all<{ k: string; leads: number; applied: number; qualified: number; booked: number; showed: number; won: number; revenue: number }>(rt,
      `SELECT k, COUNT(*) AS leads, SUM(app_completed_at IS NOT NULL) AS applied,
         SUM(app_completed_at IS NOT NULL AND COALESCE(tier_override, tier) IN ('A','B')) AS qualified,
         SUM(booked_at IS NOT NULL) AS booked, SUM(showed_at IS NOT NULL) AS showed, SUM(status = 'won') AS won,
         SUM(CASE WHEN status = 'won' THEN revenue ELSE 0 END) AS revenue
       FROM (SELECT DISTINCT b.k, l.id, l.app_completed_at, l.tier, l.tier_override, l.booked_at, l.showed_at, l.status, l.revenue
             FROM (${base}) b JOIN leads l ON l.visitor_id = b.vid WHERE l.booking_source = 'funnel') GROUP BY k`, binds),
    all<{ k: string; cash: number }>(rt,
      `SELECT k, SUM(cash_collected) AS cash FROM (SELECT DISTINCT b.k, l.id, l.cash_collected FROM (${base}) b JOIN leads l ON l.visitor_id = b.vid) GROUP BY k`, binds),
  ]);
  const by = <T extends { k: string }>(arr: T[]) => new Map(arr.map((r) => [r.k, r]));
  const S = by(sess), P = by(plays), L = by(leads), C = by(cash);
  const rows = vis.map((v) => {
    const s = S.get(v.k), p = P.get(v.k), l = L.get(v.k), c = C.get(v.k);
    const visitors = num(v.visitors);
    const leadsN = num(l?.leads), applied = num(l?.applied), qualified = num(l?.qualified);
    return {
      key: String(v.k).slice(0, 160),
      sessions: num(s?.sessions), visitors, engaged_s: Math.round(num(s?.engaged) / 1000), bounce_rate: pct(num(s?.bounce), num(s?.sessions)),
      plays: num(p?.plays), play_rate: pct(num(p?.plays), visitors),
      leads: leadsN, applied, qualified, booked: num(l?.booked), showed: num(l?.showed), won: num(l?.won),
      apply_rate: pct(applied, visitors), qualified_rate: pct(qualified, visitors),
      revenue: num(l?.revenue), cash: num(c?.cash),
    };
  });
  const totals = rows.reduce((t, r) => {
    for (const k of ["sessions", "visitors", "plays", "leads", "applied", "qualified", "booked", "showed", "won", "revenue", "cash"] as const) t[k] = (t[k] || 0) + r[k];
    return t;
  }, {} as Record<string, number>);
  return { dim: dim.id, dims: TRAFFIC_DIMS.map((d) => ({ id: d.id, label: d.label })), rows, totals };
}

// ── Application ──────────────────────────────────────────────────────────────

export async function applicationReport(rt: Runtime, f: Filters) {
  const ld = leadDims(f, "l");
  const leads = await all<{ step_reached: number; app_completed_at: number | null; app_started_at: number | null; created_at: number; answers: string; score: number | null; tier: string | null; tier_override: string | null; qual_flags: string | null }>(rt,
    `SELECT l.step_reached, l.app_completed_at, l.app_started_at, l.created_at, l.answers, l.score, l.tier, l.tier_override, l.qual_flags
     FROM leads l WHERE l.booking_source = 'funnel' AND l.created_at >= ?${ld.sql} LIMIT 20000`, [f.since, ...ld.binds]);
  const vdE = visitorDims(f, "e.visitor_id");
  const median = (xs: number[]): number | null => {
    const s = xs.filter((x) => Number.isFinite(x) && x >= 0).sort((a, b) => a - b);
    return s.length ? s[Math.floor(s.length / 2)] : null;
  };
  // Starts: the /apply page, or the form embedded under the film becoming half visible (app_view).
  const [starts, backs, stepViews, stepDone, errors] = await Promise.all([
    one<{ n: number }>(rt, `SELECT COUNT(DISTINCT e.visitor_id) AS n FROM events e WHERE ((e.name = 'page_view' AND e.path = '/apply') OR e.name = 'app_view') AND e.is_bot = 0 AND e.ts >= ?${vdE.sql}`, [f.since, ...vdE.binds]),
    all<{ step: string; n: number }>(rt, `SELECT json_extract(e.props, '$.step') AS step, COUNT(*) AS n FROM events e WHERE e.name = 'app_back' AND e.is_bot = 0 AND e.ts >= ?${vdE.sql} GROUP BY step`, [f.since, ...vdE.binds]),
    all<{ step: string; n: number }>(rt, `SELECT json_extract(e.props, '$.step') AS step, COUNT(*) AS n FROM events e WHERE e.name = 'app_step_view' AND e.is_bot = 0 AND e.ts >= ?${vdE.sql} GROUP BY step`, [f.since, ...vdE.binds]),
    all<{ step: string; ms: number | null; first: number | null; abandoned: number | null }>(rt,
      `SELECT json_extract(e.props, '$.step') AS step, json_extract(e.props, '$.ms') AS ms, json_extract(e.props, '$.ms_first') AS first,
        json_extract(e.props, '$.abandoned') AS abandoned
       FROM events e WHERE e.name = 'app_step_done' AND e.is_bot = 0 AND e.ts >= ?${vdE.sql} LIMIT 50000`, [f.since, ...vdE.binds]),
    all<{ step: string; code: string; n: number }>(rt, `SELECT json_extract(e.props, '$.step') AS step, json_extract(e.props, '$.code') AS code, COUNT(*) AS n FROM events e WHERE e.name = 'app_error' AND e.is_bot = 0 AND e.ts >= ?${vdE.sql} GROUP BY step, code`, [f.since, ...vdE.binds]),
  ]);
  const completed = leads.filter((l) => l.app_completed_at);
  const backBy = new Map(backs.map((b) => [String(b.step), num(b.n)]));
  const viewsBy = new Map(stepViews.map((b) => [String(b.step), num(b.n)]));
  const steps = APPLICATION.map((q, i) => {
    const key = String(i + 1);
    // After-submit questions are optional: "reached" there is everyone who finished.
    const reached = q.afterSubmit ? completed.length : leads.filter((l) => l.app_completed_at || l.step_reached >= i + 1).length;
    const done = stepDone.filter((d) => String(d.step) === key);
    const abandoned = done.filter((d) => num(d.abandoned) === 1).length;
    const errs = errors.filter((e) => String(e.step) === key);
    return {
      id: q.id, title: q.title, step: i + 1, reached, backs: backBy.get(key) || 0, after_submit: !!q.afterSubmit,
      views: viewsBy.get(key) || 0,
      median_ms: median(done.filter((d) => num(d.abandoned) !== 1).map((d) => num(d.ms))),
      median_hesitation_ms: median(done.filter((d) => d.first != null).map((d) => num(d.first))),
      abandon_rate: pct(abandoned, viewsBy.get(key) || done.length),
      errors: errs.reduce((s, e) => s + num(e.n), 0),
    };
  });
  steps.forEach((s, i) => Object.assign(s, { kept: i ? pct(s.reached, steps[i - 1].reached) : null }));
  const errorCodes: Record<string, number> = {};
  for (const e of errors) { const k = String(e.code || "unknown"); errorCodes[k] = (errorCodes[k] || 0) + num(e.n); }
  const parsed = completed.map((l) => { try { return JSON.parse(l.answers || "{}") as Record<string, unknown>; } catch { return {}; } });
  const questions = APPLICATION.filter((q) => q.type === "single" || q.type === "multi").map((q) => {
    const total = parsed.filter((a) => a[q.id] != null).length;
    return {
      id: q.id, title: q.title, type: q.type, answered: total,
      options: (q.options || []).map((o) => {
        const n = parsed.filter((a) => (Array.isArray(a[q.id]) ? (a[q.id] as unknown[]).includes(o.value) : a[q.id] === o.value)).length;
        return { value: o.value, label: o.label, points: o.points, n, pct: pct(n, total) };
      }),
    };
  });
  const textAnswered = APPLICATION.filter((q) => q.type === "text").map((q) => ({
    id: q.id, title: q.title, answered: parsed.filter((a) => typeof a[q.id] === "string" && (a[q.id] as string).trim()).length,
    avg_length: Math.round(parsed.reduce((s, a) => s + (typeof a[q.id] === "string" ? (a[q.id] as string).length : 0), 0) / (completed.length || 1)),
  }));
  const hist = new Array(10).fill(0);
  for (const l of completed) if (l.score != null) hist[Math.min(9, Math.floor(l.score / 10))]++;
  const flags: Record<string, number> = {};
  for (const l of completed) for (const fl of (l.qual_flags || "").split(",").filter(Boolean)) flags[fl] = (flags[fl] || 0) + 1;
  const durations = completed.map((l) => (l.app_completed_at || 0) - (l.app_started_at || l.created_at)).filter((d) => d > 0 && d < 6 * 3600_000).sort((a, b) => a - b);
  const tier = (t: string) => completed.filter((l) => (l.tier_override || l.tier) === t).length;
  return {
    kpis: {
      apply_starts: num(starts?.n), contacts: leads.length, completed: completed.length,
      completion_rate: pct(completed.length, leads.length),
      median_minutes: durations.length ? Math.round((durations[Math.floor(durations.length / 2)] / 60_000) * 10) / 10 : null,
      avg_score: completed.length ? Math.round(completed.reduce((s, l) => s + (l.score || 0), 0) / completed.length) : null,
    },
    steps, questions, text: textAnswered,
    tiers: { A: tier("A"), B: tier("B"), C: tier("C") },
    score_histogram: hist.map((n, i) => ({ from: i * 10, to: i * 10 + 9, n })),
    flags: Object.entries(flags).sort((a, b) => b[1] - a[1]).map(([flag, n]) => ({ flag, n })),
    errors: Object.entries(errorCodes).sort((a, b) => b[1] - a[1]).map(([code, n]) => ({ code, n })),
  };
}

// ── Tracking / forwarding ────────────────────────────────────────────────────

export const MATCH_KEYS = ["em", "ph", "fbp", "fbc", "ip", "ua", "external_id"] as const;

export async function trackingReport(rt: Runtime, f: Filters) {
  const [byDest, errors, meta, byEvent] = await Promise.all([
    all<{ destination: string; status: string; n: number }>(rt, "SELECT destination, status, COUNT(*) AS n FROM forward_log WHERE created_at >= ? GROUP BY destination, status", [f.since]),
    all<{ id: string; destination: string; event_name: string; status: string; http_status: number | null; error: string | null; attempts: number; updated_at: number }>(rt,
      "SELECT id, destination, event_name, status, http_status, error, attempts, updated_at FROM forward_log WHERE status IN ('failed','retry') AND created_at >= ? ORDER BY updated_at DESC LIMIT 30", [f.since]),
    one<Record<string, number>>(rt,
      `SELECT COUNT(*) AS total, ${MATCH_KEYS.map((k) => `SUM(match_keys LIKE '%"${k}"%') AS ${k}`).join(", ")} FROM forward_log WHERE destination = 'meta' AND created_at >= ?`, [f.since]),
    all<{ event_name: string; destination: string; n: number }>(rt, "SELECT event_name, destination, COUNT(*) AS n FROM forward_log WHERE created_at >= ? AND status = 'sent' GROUP BY event_name, destination ORDER BY n DESC LIMIT 60", [f.since]),
  ]);
  const s = rt.settings;
  const configured: Record<string, boolean> = {
    meta: s.has("META_PIXEL_ID") && s.has("META_ACCESS_TOKEN"),
    ga4: s.has("GA4_MEASUREMENT_ID") && s.has("GA4_API_SECRET"),
    posthog: s.has("POSTHOG_KEY"),
    crm: s.has("LEAD_WEBHOOK_URL"),
  };
  const destinations = ["meta", "ga4", "posthog", "crm"].map((d) => {
    const rows = byDest.filter((r) => r.destination === d);
    const get = (st: string) => num(rows.find((r) => r.status === st)?.n);
    const sent = get("sent"), retry = get("retry") + get("sending"), failed = get("failed");
    return { id: d, configured: configured[d], sent, retry, failed, success_rate: pct(sent, sent + failed) };
  });
  const total = num(meta?.total);
  return {
    destinations,
    errors: errors.map((e) => ({ ...e, error: (e.error || "").replace(/access_token=[^&\s"]+/g, "access_token=…").slice(0, 200) })),
    match_keys: MATCH_KEYS.map((k) => ({ key: k, n: num(meta?.[k]), pct: pct(num(meta?.[k]), total) })),
    meta_events: total,
    by_event: byEvent,
    test_event_code: s.has("META_TEST_EVENT_CODE"),
  };
}

// ── Live ─────────────────────────────────────────────────────────────────────

const LIVE_EXCLUDE = [...MICRO_EVENTS];

export async function liveEvents(rt: Runtime, sinceParam: string | undefined) {
  const since = Math.max(0, Number(sinceParam) || 0) || rt.now() - 3600_000;
  const placeholders = LIVE_EXCLUDE.map(() => "?").join(",");
  const rows = await all<{ id: string; ts: number; name: string; path: string | null; country: string | null; device: string | null; lead_id: string | null; first_name: string | null; tier: string | null; source: string }>(rt,
    `SELECT e.id, e.ts, e.name, e.path, e.source, s.country, s.device, e.lead_id, l.first_name, COALESCE(l.tier_override, l.tier) AS tier
     FROM events e LEFT JOIN sessions s ON s.id = e.session_id LEFT JOIN leads l ON l.id = e.lead_id
     WHERE e.ts > ? AND e.is_bot = 0 AND e.name NOT IN (${placeholders}) ORDER BY e.ts DESC LIMIT 50`,
    [since, ...LIVE_EXCLUDE]);
  const active = await one<{ n: number }>(rt, "SELECT COUNT(DISTINCT visitor_id) AS n FROM sessions WHERE last_seen_at > ? AND is_bot = 0", [rt.now() - 5 * 60_000]);
  return {
    now: rt.now(),
    active_visitors: num(active?.n),
    events: rows.map((r) => ({
      id: r.id, ts: r.ts, name: r.name, path: r.path ? r.path.split("?")[0].slice(0, 80) : null, country: r.country, device: r.device,
      source: r.source, lead_id: r.lead_id, first_name: r.first_name ? r.first_name.slice(0, 40) : null, tier: r.tier,
    })),
  };
}
