// Anomaly alerts. Every 15 minutes the cron compares the last hour (or day) with the same hours of
// the week over the previous four weeks (median; Poisson tail or robust z) and opens or resolves one
// alert per rule. Opening and resolving ping Slack/Discord; open alerts show as a red banner in HQ.

import type { Runtime } from "../app";
import { newId } from "../lib/ids";
import { kvGate, kvGet, kvGetJson, kvSet } from "../lib/kv";
import { notifyText } from "../integrations/notify";
import { dayKey } from "../integrations/meta-ads";
import { median, poissonCdf, THREE_SIGMA_TAIL } from "../sales/model";
import { all, num, one, salesTz } from "./stats";

const MIN = 60_000;
const H = 60 * MIN;
const DAY = 24 * H;
const WEEK = 7 * DAY;
export const COOLDOWN_MS = 2 * H;
export const HEARTBEAT_MAX_GAP = 15 * MIN;

export type Severity = "warn" | "crit";

export const RULES: Record<string, { label: string; severity: Severity; help: string }> = {
  traffic_zero: { label: "Page views stopped", severity: "crit", help: "No page views for an hour when this hour of the week normally has traffic." },
  vsl_zero: { label: "Film plays stopped", severity: "crit", help: "Page views arrive but nobody has pressed play for an hour, when plays are normal for this hour." },
  applications_drop: { label: "Applications dropped", severity: "warn", help: "The last 24 hours are far below the same 24 hours in the previous four weeks (beyond 3σ)." },
  bookings_drop: { label: "Bookings dropped", severity: "warn", help: "The last 24 hours of bookings are far below the same window in the previous four weeks (beyond 3σ)." },
  forward_failures: { label: "Ad platform forwarding failing", severity: "warn", help: "More than 10% of server-side events failed in the last 6 hours." },
  match_keys_drop: { label: "Meta match keys dropped", severity: "warn", help: "The share of Meta events with a hashed email fell by more than 20 points against the previous week." },
  email_failures: { label: "Email sending failing", severity: "warn", help: "More than 10% of email sends failed in the last 24 hours." },
  deliverability: { label: "Bounces or complaints too high", severity: "crit", help: "7-day complaint rate above 0.2% or bounce rate above 3%. Marketing sequences pause automatically." },
  calendly_stale: { label: "No bookings arriving from Calendly", severity: "warn", help: "No Calendly webhook or sync activity in 3 hours while bookings are normally expected." },
  cron_gap: { label: "Scheduled jobs stalled", severity: "crit", help: "The 5-minute cron missed a beat for more than 15 minutes. Emails, calls and syncs were delayed." },
  spend_no_sessions: { label: "Ads spending with no visits", severity: "warn", help: "An ad spent money yesterday but sent no tracked sessions. Check the ad URL and its parameters." },
  cpl_spike: { label: "Cost per lead doubled", severity: "warn", help: "Yesterday's paid cost per lead is more than twice the previous 28-day level." },
};

export interface CheckResult {
  rule: string;
  firing: boolean;
  value: number | null;
  baseline: number | null;
  detail: string;
  /** Not enough data to judge: leave any open alert as it is. */
  skip?: boolean;
}

export interface AlertRow {
  id: string; rule: string; severity: Severity; opened_at: number; resolved_at: number | null;
  last_value: number | null; baseline: number | null; detail: string | null; checked_at: number | null;
}

/** Pure: what to do with a check given the open alert (if any) and when this rule last resolved. */
export function transition(open: AlertRow | null, check: CheckResult, now: number, lastResolvedAt: number | null, cooldown = COOLDOWN_MS): "open" | "resolve" | "update" | "none" {
  if (check.skip) return open ? "update" : "none";
  if (check.firing) {
    if (open) return "update";
    if (lastResolvedAt != null && now - lastResolvedAt < cooldown) return "none";
    return "open";
  }
  return open ? "resolve" : "none";
}

/** Pure: a count collapsed to zero while the same hour of the week usually has at least `minExpected`. */
export function zeroCheck(rule: string, current: number, history: number[], minExpected: number, what: string): CheckResult {
  const base = median(history);
  if (base == null || base < minExpected) return { rule, firing: false, value: current, baseline: base, detail: `Quiet hour (usually ${base ?? 0} ${what})`, skip: current > 0 ? false : true };
  return { rule, firing: current === 0, value: current, baseline: base, detail: `${current} ${what} in the last hour; usually ${base}` };
}

/** Pure: a count far below its baseline: Poisson P(X ≤ current | λ = median) under the 3σ tail. */
export function dropCheck(rule: string, current: number, history: number[], minExpected: number, what: string): CheckResult {
  const base = median(history);
  if (base == null || base < minExpected) return { rule, firing: false, value: current, baseline: base, detail: `Not enough history for ${what}`, skip: true };
  const p = poissonCdf(current, base);
  return { rule, firing: p < THREE_SIGMA_TAIL, value: current, baseline: base, detail: `${current} ${what} in 24 hours; usually ${base} (p = ${p.toExponential(1)})` };
}

/** Pure: a failure share over a threshold, with a minimum volume. */
export function rateCheck(rule: string, bad: number, total: number, threshold: number, minTotal: number, what: string): CheckResult {
  if (total < minTotal) return { rule, firing: false, value: total ? bad / total : null, baseline: threshold, detail: `Only ${total} ${what}`, skip: total === 0 };
  const r = bad / total;
  return { rule, firing: r > threshold, value: Math.round(r * 10000) / 10000, baseline: threshold, detail: `${bad} of ${total} ${what} (${(r * 100).toFixed(1)}%)` };
}

/** Same window at 1..4 weeks back. */
export function weekBackWindows(from: number, to: number, weeks = 4): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  for (let k = 1; k <= weeks; k++) out.push([from - k * WEEK, to - k * WEEK]);
  return out;
}

/** Count rows of `table` (filtered) in several [from,to) windows of `col` in one query. */
async function countIn(rt: Runtime, table: string, col: string, where: string, binds: unknown[], windows: Array<[number, number]>): Promise<number[]> {
  const sums = windows.map((_, i) => `SUM(${col} >= ?${binds.length + 2 * i + 1} AND ${col} < ?${binds.length + 2 * i + 2}) AS c${i}`).join(", ");
  const ors = windows.map((_, i) => `(${col} >= ?${binds.length + 2 * i + 1} AND ${col} < ?${binds.length + 2 * i + 2})`).join(" OR ");
  const sql = `SELECT ${sums} FROM ${table} WHERE ${where} AND (${ors})`;
  const numbered = renumberPlain(sql, binds.length);
  const r = await one<Record<string, number>>(rt, numbered, [...binds, ...windows.flat()]);
  return windows.map((_, i) => num(r?.[`c${i}`]));
}

/** Number the first `n` plain `?` placeholders ?1..?n (the window ones are already numbered). */
function renumberPlain(sql: string, n: number): string {
  let i = 0;
  return sql.replace(/\?(?!\d)/g, () => (i < n ? `?${++i}` : "?"));
}

async function eventWindows(rt: Runtime, name: string, from: number, to: number, weeks = 4): Promise<{ current: number; history: number[] }> {
  const wins: Array<[number, number]> = [[from, to], ...weekBackWindows(from, to, weeks)];
  const counts = await countIn(rt, "events", "ts", "name = ? AND is_bot = 0", [name], wins);
  return { current: counts[0], history: counts.slice(1) };
}

// ── Checks ───────────────────────────────────────────────────────────────────

export async function runChecks(rt: Runtime): Promise<CheckResult[]> {
  const now = rt.now();
  const out: CheckResult[] = [];
  const safe = async (rule: string, fn: () => Promise<CheckResult | null>) => {
    try { const r = await fn(); if (r) out.push(r); } catch (e) { console.error("[alert]", rule, e); }
  };

  await safe("traffic_zero", async () => {
    const pv = await eventWindows(rt, "page_view", now - H, now);
    return zeroCheck("traffic_zero", pv.current, pv.history, 5, "page views");
  });
  await safe("vsl_zero", async () => {
    const pv = await eventWindows(rt, "page_view", now - H, now, 0);
    const plays = await eventWindows(rt, "vsl_play", now - H, now);
    if (pv.current === 0) return { rule: "vsl_zero", firing: false, value: 0, baseline: median(plays.history), detail: "No page views (see page views alert)", skip: true };
    return zeroCheck("vsl_zero", plays.current, plays.history, 3, "plays");
  });
  await safe("applications_drop", async () => {
    const a = await eventWindows(rt, "app_submitted", now - DAY, now);
    return dropCheck("applications_drop", a.current, a.history, 4, "applications");
  });
  await safe("bookings_drop", async () => {
    const b = await eventWindows(rt, "booking_scheduled", now - DAY, now);
    return dropCheck("bookings_drop", b.current, b.history, 3, "bookings");
  });
  await safe("forward_failures", async () => {
    const r = await one<{ bad: number; total: number }>(rt, "SELECT SUM(status = 'failed') AS bad, SUM(status IN ('sent','failed')) AS total FROM forward_log WHERE updated_at >= ?", [now - 6 * H]);
    return rateCheck("forward_failures", num(r?.bad), num(r?.total), 0.1, 20, "forwarded events");
  });
  await safe("match_keys_drop", async () => {
    const r = await one<Record<string, number>>(rt,
      `SELECT SUM(created_at >= ?1) AS n_now, SUM(created_at >= ?1 AND match_keys LIKE '%"em"%') AS em_now,
         SUM(created_at < ?1) AS n_prev, SUM(created_at < ?1 AND match_keys LIKE '%"em"%') AS em_prev
       FROM forward_log WHERE destination = 'meta' AND created_at >= ?2`, [now - DAY, now - 8 * DAY]);
    const nNow = num(r?.n_now), nPrev = num(r?.n_prev);
    if (nNow < 20 || nPrev < 20) return { rule: "match_keys_drop", firing: false, value: null, baseline: null, detail: "Not enough Meta events", skip: true };
    const cur = (num(r?.em_now) / nNow) * 100, prev = (num(r?.em_prev) / nPrev) * 100;
    return { rule: "match_keys_drop", firing: prev - cur > 20, value: Math.round(cur * 10) / 10, baseline: Math.round(prev * 10) / 10, detail: `Hashed email on ${cur.toFixed(0)}% of Meta events today vs ${prev.toFixed(0)}% last week` };
  });
  await safe("email_failures", async () => {
    const r = await one<{ bad: number; total: number }>(rt, "SELECT SUM(status = 'failed') AS bad, SUM(status IN ('sent','failed')) AS total FROM emails WHERE COALESCE(sent_at, send_at) >= ?", [now - DAY]);
    return rateCheck("email_failures", num(r?.bad), num(r?.total), 0.1, 10, "email sends");
  });
  await safe("deliverability", async () => {
    const st = await kvGetJson<{ firing?: boolean; detail?: string; bounce?: number; complaint?: number } | null>(rt.env, "email:deliverability", null);
    if (!st) return null;
    return { rule: "deliverability", firing: !!st.firing, value: st.complaint ?? null, baseline: 0.002, detail: st.detail || "" };
  });
  await safe("calendly_stale", async () => {
    if (!rt.settings.has("CALENDLY_API_TOKEN")) return null;
    const b = await eventWindows(rt, "booking_scheduled", now - 3 * H, now);
    const base = median(b.history) ?? 0;
    const last = await one<{ t: number }>(rt, "SELECT MAX(updated_at) AS t FROM calendly_bookings");
    const lastAt = num(last?.t);
    if (base < 1) return { rule: "calendly_stale", firing: false, value: b.current, baseline: base, detail: "Bookings not expected now", skip: !lastAt };
    const stale = b.current === 0 && now - lastAt > 3 * H;
    return { rule: "calendly_stale", firing: stale, value: lastAt ? Math.round((now - lastAt) / MIN) : null, baseline: base, detail: lastAt ? `Last Calendly activity ${Math.round((now - lastAt) / H)} h ago; usually ${base} bookings in 3 hours` : "No Calendly activity recorded yet" };
  });
  await safe("cron_gap", async () => {
    const g = await kvGetJson<{ at: number; gap: number } | null>(rt.env, "cron:last_gap", null);
    const recent = !!g && now - g.at < H;
    return { rule: "cron_gap", firing: recent, value: g ? Math.round(g.gap / MIN) : null, baseline: HEARTBEAT_MAX_GAP / MIN, detail: g ? `The cron was silent for ${Math.round(g.gap / MIN)} minutes until ${new Date(g.at).toISOString().slice(11, 16)} UTC` : "Healthy" };
  });
  await safe("spend_no_sessions", async () => {
    const tz = salesTz(rt);
    const y = dayKey(now - DAY, tz);
    const rows = await all<{ ad_id: string; ad_name: string | null; spend: number; sessions: number }>(rt,
      `SELECT a.ad_id, a.ad_name, a.spend,
         (SELECT COUNT(*) FROM sessions s WHERE s.ad_id = a.ad_id AND s.started_at >= ?2 AND s.is_bot = 0) AS sessions
       FROM ad_spend a WHERE a.platform = 'meta' AND a.date = ?1 AND a.spend >= 20 ORDER BY a.spend DESC LIMIT 50`, [y, now - 3 * DAY]);
    if (!rows.length) return { rule: "spend_no_sessions", firing: false, value: 0, baseline: null, detail: "No spend yesterday", skip: false };
    const dead = rows.filter((r) => !num(r.sessions));
    return { rule: "spend_no_sessions", firing: dead.length > 0, value: Math.round(dead.reduce((s, r) => s + num(r.spend), 0)), baseline: null, detail: dead.length ? `${dead.length} ad(s) spent with no visits: ${dead.slice(0, 3).map((r) => r.ad_name || r.ad_id).join(", ")}` : "Every spending ad sent visits" };
  });
  await safe("cpl_spike", async () => {
    const tz = salesTz(rt);
    const y = dayKey(now - DAY, tz), from = dayKey(now - 29 * DAY, tz);
    const sp = await one<{ y: number; base: number }>(rt, "SELECT SUM(CASE WHEN date = ?1 THEN spend ELSE 0 END) AS y, SUM(CASE WHEN date < ?1 THEN spend ELSE 0 END) AS base FROM ad_spend WHERE date >= ?2 AND date <= ?1", [y, from]);
    const leads = await one<{ y: number; base: number }>(rt,
      `SELECT SUM(l.created_at >= ?1) AS y, SUM(l.created_at < ?1) AS base FROM leads l JOIN lead_revops r ON r.lead_id = l.id
       WHERE r.ft_ad_id IN (SELECT DISTINCT ad_id FROM ad_spend WHERE date >= ?3) AND l.created_at >= ?2 AND l.created_at < ?4`,
      [now - 2 * DAY, now - 30 * DAY, from, now - DAY]);
    const ySpend = num(sp?.y), bSpend = num(sp?.base), yLeads = num(leads?.y), bLeads = num(leads?.base);
    if (ySpend < 50 || bLeads < 10) return { rule: "cpl_spike", firing: false, value: null, baseline: null, detail: "Not enough paid volume", skip: true };
    const baseCpl = bSpend / bLeads, yCpl = yLeads ? ySpend / yLeads : Infinity;
    return { rule: "cpl_spike", firing: yCpl > 2 * baseCpl, value: Number.isFinite(yCpl) ? Math.round(yCpl) : null, baseline: Math.round(baseCpl), detail: `Yesterday ${Number.isFinite(yCpl) ? "$" + Math.round(yCpl) : "no leads for $" + Math.round(ySpend)} per lead vs $${Math.round(baseCpl)} over 28 days` };
  });
  return out;
}

// ── Storage and pings ────────────────────────────────────────────────────────

async function ping(rt: Runtime, kind: "open" | "resolve", rule: string, detail: string) {
  if (!rt.settings.bool("ALERT_PINGS")) return;
  const r = RULES[rule];
  const sev = r?.severity === "crit" ? "critical" : "warning";
  await notifyText(rt, `${kind === "open" ? `Alert (${sev})` : "Resolved"}: ${r?.label || rule}`, [detail, `${rt.origin}/admin#alerts`]);
}

export async function applyChecks(rt: Runtime, checks: CheckResult[]): Promise<{ opened: string[]; resolved: string[] }> {
  const now = rt.now();
  const opened: string[] = [], resolved: string[] = [];
  for (const c of checks) {
    const open = await one<AlertRow>(rt, "SELECT * FROM alerts WHERE rule = ? AND resolved_at IS NULL ORDER BY opened_at DESC LIMIT 1", [c.rule]);
    const last = await one<{ t: number }>(rt, "SELECT MAX(resolved_at) AS t FROM alerts WHERE rule = ?", [c.rule]);
    const act = transition(open, c, now, last?.t ?? null);
    const detail = c.detail.slice(0, 500);
    if (act === "open") {
      await rt.env.DB.prepare("INSERT INTO alerts (id, rule, severity, opened_at, last_value, baseline, detail, checked_at) VALUES (?,?,?,?,?,?,?,?)")
        .bind(newId("a"), c.rule, RULES[c.rule]?.severity || "warn", now, c.value, c.baseline, detail, now).run();
      opened.push(c.rule);
      rt.waitUntil(ping(rt, "open", c.rule, detail));
    } else if (act === "update" && open) {
      await rt.env.DB.prepare("UPDATE alerts SET last_value = ?, baseline = ?, detail = ?, checked_at = ? WHERE id = ?")
        .bind(c.skip ? open.last_value : c.value, c.skip ? open.baseline : c.baseline, c.skip ? open.detail : detail, now, open.id).run();
    } else if (act === "resolve" && open) {
      await rt.env.DB.prepare("UPDATE alerts SET resolved_at = ?, last_value = ?, checked_at = ? WHERE id = ?").bind(now, c.value, now, open.id).run();
      resolved.push(c.rule);
      rt.waitUntil(ping(rt, "resolve", c.rule, detail));
    }
  }
  return { opened, resolved };
}

/** Cron, every 15 minutes (gated). */
export async function runAlerts(rt: Runtime, force = false) {
  if (!force && !(await kvGate(rt.env, "gate:alerts", 14 * MIN, rt.now()))) return null;
  return applyChecks(rt, await runChecks(rt));
}

/** First thing every cron run: record the beat, and remember a gap longer than 15 minutes. */
export async function cronHeartbeat(rt: Runtime): Promise<number | null> {
  const now = rt.now();
  const prev = Number((await kvGet(rt.env, "cron:heartbeat")) || 0);
  await kvSet(rt.env, "cron:heartbeat", String(now));
  if (prev && now - prev > HEARTBEAT_MAX_GAP) {
    await kvSet(rt.env, "cron:last_gap", JSON.stringify({ at: now, gap: now - prev }));
    return now - prev;
  }
  return null;
}

export async function openAlerts(rt: Runtime) {
  const rows = await all<AlertRow>(rt, "SELECT * FROM alerts WHERE resolved_at IS NULL ORDER BY opened_at DESC LIMIT 50");
  const hb = Number((await kvGet(rt.env, "cron:heartbeat")) || 0);
  return {
    open: rows.map((r) => ({ ...r, label: RULES[r.rule]?.label || r.rule })),
    heartbeat_at: hb || null,
    heartbeat_stale: !!hb && rt.now() - hb > HEARTBEAT_MAX_GAP,
  };
}

export async function alertsReport(rt: Runtime) {
  const [open, recent] = await Promise.all([
    openAlerts(rt),
    all<AlertRow>(rt, "SELECT * FROM alerts WHERE resolved_at IS NOT NULL ORDER BY opened_at DESC LIMIT 100"),
  ]);
  return {
    ...open,
    recent: recent.map((r) => ({ ...r, label: RULES[r.rule]?.label || r.rule })),
    rules: Object.entries(RULES).map(([id, r]) => ({ id, ...r })),
    pings: rt.settings.bool("ALERT_PINGS") && (rt.settings.has("SLACK_WEBHOOK_URL") || rt.settings.has("DISCORD_WEBHOOK_URL")),
  };
}

export async function resolveAlert(rt: Runtime, id: string): Promise<boolean> {
  const r = await rt.env.DB.prepare("UPDATE alerts SET resolved_at = ?, detail = COALESCE(detail, '') || ' · resolved by hand' WHERE id = ? AND resolved_at IS NULL").bind(rt.now(), id).run();
  return (r.meta?.changes ?? 0) > 0;
}
