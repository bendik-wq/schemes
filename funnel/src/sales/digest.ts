import type { Runtime } from "../app";
import { BRAND } from "../config";
import { kvGate } from "../lib/kv";
import { notifyTeam, notifyText } from "../integrations/notify";
import { localParts, validTimezone, zonedTime } from "../integrations/sequences";
import { dayKey } from "../integrations/meta-ads";
import { followUpsDue, paymentsDue } from "./followups";
import { listReps } from "./reps";
import { RULES } from "../admin/alerts";
import { popcount } from "../tracking/vsl";
import type { Lead } from "../funnel/leads";
import { outcomeLink } from "./outcome-link";

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
    const link = await outcomeLink(rt, l);
    rt.waitUntil(notifyTeam(rt, "call_soon", l, `Watched ${pct}% of the film`, link ? { label: "Log outcome", url: link } : undefined));
    n++;
  }
  // After the call: one nudge 45–90 minutes after the start time while it still says booked.
  const after = (await rt.env.DB.prepare(
    "SELECT * FROM leads WHERE status = 'booked' AND booking_cancelled_at IS NULL AND booking_source = 'funnel' AND call_at > ? AND call_at <= ?",
  ).bind(now - 90 * 60_000, now - 45 * 60_000).all<Lead>()).results || [];
  for (const l of after) {
    if (!(await kvGate(rt.env, `postping:${l.id}:${l.call_at}`, 365 * 86_400_000))) continue;
    const link = await outcomeLink(rt, l);
    rt.waitUntil(notifyTeam(rt, "needs_outcome", l, "One tap to log how it went", link ? { label: "Log outcome", url: link } : undefined));
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

export interface PeriodNumbers {
  visitors: number; leads: number; applied: number; qualified: number; booked: number; showed: number; won: number; cash: number;
}

/** Funnel numbers between two instants (bounded on both sides, unlike digestNumbers). */
export async function periodNumbers(rt: Runtime, from: number, to: number): Promise<PeriodNumbers> {
  const db = rt.env.DB;
  const [v, l, e, c] = await Promise.all([
    db.prepare("SELECT COUNT(DISTINCT visitor_id) AS n FROM sessions WHERE started_at >= ? AND started_at < ? AND is_bot = 0").bind(from, to).first<{ n: number }>(),
    db.prepare(
      `SELECT SUM(created_at >= ?1 AND created_at < ?2) AS leads, SUM(app_completed_at >= ?1 AND app_completed_at < ?2) AS applied,
         SUM(app_completed_at >= ?1 AND app_completed_at < ?2 AND COALESCE(tier_override, tier) IN ('A','B')) AS qualified
       FROM leads WHERE booking_source = 'funnel' AND (created_at >= ?1 OR app_completed_at >= ?1)`,
    ).bind(from, to).first<{ leads: number; applied: number; qualified: number }>(),
    db.prepare(
      `SELECT SUM(name='booking_scheduled') AS booked, SUM(name='call_showed') AS showed, SUM(name='deal_won') AS won FROM events
       WHERE ts >= ? AND ts < ? AND name IN ('booking_scheduled','call_showed','deal_won')`,
    ).bind(from, to).first<{ booked: number; showed: number; won: number }>(),
    db.prepare("SELECT COALESCE(SUM(amount),0) AS c FROM payments WHERE paid_at >= ? AND paid_at < ?").bind(from, to).first<{ c: number }>(),
  ]);
  return {
    visitors: v?.n || 0, leads: l?.leads || 0, applied: l?.applied || 0, qualified: l?.qualified || 0,
    booked: e?.booked || 0, showed: e?.showed || 0, won: e?.won || 0, cash: c?.c || 0,
  };
}

/** "▲ 25%" / "▼ 10%" / "= avg" against a daily average. */
export function fmtDelta(cur: number, avg: number): string {
  if (!avg) return cur ? "▲ new" : "= avg";
  const d = Math.round(((cur - avg) / avg) * 100);
  if (Math.abs(d) < 5) return "= avg";
  return d > 0 ? `▲ ${d}%` : `▼ ${Math.abs(d)}%`;
}

const money = (v: number) => "$" + Math.round(v).toLocaleString("en-US");
const nameShort = (first: unknown, last: unknown) => [first, typeof last === "string" && last ? last[0] + "." : ""].filter(Boolean).join(" ") || "Lead";

/** Pure: the digest's text lines. */
export function digestLines(d: {
  cur: PeriodNumbers; avg: PeriodNumbers; origin: string;
  calls: Array<{ closer: string; time: string; name: string; tier: string | null; risk: number | null }>;
  needs: string[]; needsTotal: number; followUps: string[]; followUpsTotal: number; payments: string[]; paymentsTotal: number;
  spend: { yesterday: number; cpl: number | null; cac7: number | null } | null;
  alerts: string[];
}): string[] {
  const k = (label: string, key: keyof PeriodNumbers, fmt: (v: number) => string = (v) => String(Math.round(v))) =>
    `${label} ${fmt(d.cur[key])} (${fmtDelta(d.cur[key], d.avg[key])})`;
  const lines = [
    [k("Visitors", "visitors"), k("Leads", "leads"), k("Applications", "applied"), k("Qualified", "qualified")].join(" · "),
    [k("Booked", "booked"), k("Held", "showed"), k("Won", "won"), k("Cash", "cash", money)].join(" · "),
    "Change is against the 7-day daily average.",
  ];
  if (d.spend) lines.push(`Ads yesterday: ${money(d.spend.yesterday)} spent · CPL ${d.spend.cpl == null ? "—" : money(d.spend.cpl)} · 7-day CAC ${d.spend.cac7 == null ? "—" : money(d.spend.cac7)}`);
  if (d.calls.length) {
    lines.push(`Calls today (${d.calls.length}):`);
    const byCloser = new Map<string, typeof d.calls>();
    for (const c of d.calls) { if (!byCloser.has(c.closer)) byCloser.set(c.closer, []); byCloser.get(c.closer)!.push(c); }
    const one = (c: (typeof d.calls)[number]) => {
      const tag = [c.tier ? `tier ${c.tier}` : "", c.risk != null ? `no-show risk ${Math.round(c.risk * 100)}%` : ""].filter(Boolean).join(", ");
      return `${c.time} ${c.name}${tag ? ` (${tag})` : ""}`;
    };
    for (const [closer, cs] of byCloser) lines.push(`  ${closer}: ${cs.map(one).join(" · ")}`);
  } else lines.push("No calls today.");
  if (d.needsTotal) lines.push(`Needs an outcome: ${d.needsTotal} (${d.needs.join(", ")}${d.needsTotal > d.needs.length ? ", …" : ""})`);
  if (d.followUpsTotal) lines.push(`Follow-ups due: ${d.followUpsTotal} (${d.followUps.join(", ")}${d.followUpsTotal > d.followUps.length ? ", …" : ""})`);
  if (d.paymentsTotal) lines.push(`Instalments due or overdue: ${d.paymentsTotal} (${d.payments.join(", ")}${d.paymentsTotal > d.payments.length ? ", …" : ""})`);
  if (d.alerts.length) lines.push(`Open alerts: ${d.alerts.join("; ")}`);
  lines.push(`Sales: ${d.origin}/admin#sales · Alerts: ${d.origin}/admin#alerts`);
  return lines;
}

/** Daily digest at DIGEST_HOUR in the sales time zone. */
export async function maybeSendDigest(rt: Runtime, force = false): Promise<boolean> {
  const s = rt.settings;
  if (!s.has("SLACK_WEBHOOK_URL") && !s.has("DISCORD_WEBHOOK_URL")) return false;
  const tz = validTimezone(s.get("SALES_TIMEZONE")) ? s.get("SALES_TIMEZONE") : BRAND.salesTimezone;
  const now = rt.now();
  const p = localParts(now, tz);
  if (!force && p.hh !== s.num("DIGEST_HOUR", 8)) return false;
  if (!force && !(await kvGate(rt.env, `digest:${p.y}-${p.mo}-${p.d}`, 365 * 86_400_000))) return false;
  await notifyText(rt, `${BRAND.name} · last 24 hours`, await buildDigest(rt));
  return true;
}

export async function buildDigest(rt: Runtime): Promise<string[]> {
  const DAY = 86_400_000;
  const tz = validTimezone(rt.settings.get("SALES_TIMEZONE")) ? rt.settings.get("SALES_TIMEZONE") : BRAND.salesTimezone;
  const now = rt.now();
  const p = localParts(now, tz);
  const dayStart = zonedTime(p.y, p.mo, p.d, 0, 0, tz);
  const db = rt.env.DB;
  const [cur, week, reps] = await Promise.all([periodNumbers(rt, now - DAY, now), periodNumbers(rt, now - 8 * DAY, now - DAY), listReps(rt)]);
  const avg = Object.fromEntries(Object.entries(week).map(([k, v]) => [k, v / 7])) as unknown as PeriodNumbers;
  const calls = ((await db.prepare(
    `SELECT l.first_name, l.last_name, l.call_at, l.closer_id, COALESCE(l.tier_override, l.tier) AS tier, r.noshow_risk
     FROM leads l LEFT JOIN lead_revops r ON r.lead_id = l.id
     WHERE l.status = 'booked' AND l.booking_cancelled_at IS NULL AND l.call_at >= ? AND l.call_at < ? ORDER BY l.call_at`,
  ).bind(Math.max(now, dayStart), dayStart + DAY).all<Record<string, unknown>>()).results) || [];
  const needs = ((await db.prepare(
    "SELECT first_name, last_name FROM leads WHERE status = 'booked' AND booking_cancelled_at IS NULL AND call_at < ? AND call_at > ? ORDER BY call_at DESC LIMIT 100",
  ).bind(now - 30 * 60_000, now - 30 * DAY).all<Record<string, unknown>>()).results) || [];
  const [fu, pay] = await Promise.all([followUpsDue(rt, reps), paymentsDue(rt, reps)]);
  const overduePay = pay.filter((x) => x.overdue);
  const yKey = dayKey(now - DAY, tz);
  const sp = await db.prepare(
    `SELECT SUM(CASE WHEN date = ?1 THEN spend ELSE 0 END) AS y, SUM(spend) AS w FROM ad_spend WHERE date >= ?2 AND date <= ?1`,
  ).bind(yKey, dayKey(now - 7 * DAY, tz)).first<{ y: number | null; w: number | null }>().catch(() => null);
  let spend: { yesterday: number; cpl: number | null; cac7: number | null } | null = null;
  if (sp && (sp.w || 0) > 0) {
    const yLeads = await db.prepare(
      `SELECT COUNT(*) AS n FROM leads l JOIN lead_revops r ON r.lead_id = l.id WHERE r.ft_ad_id IN (SELECT ad_id FROM ad_spend WHERE date = ?) AND l.created_at >= ? AND l.created_at < ?`,
    ).bind(yKey, dayStart - DAY, dayStart).first<{ n: number }>();
    const won7 = await db.prepare("SELECT COUNT(*) AS n FROM leads WHERE status = 'won' AND booking_source = 'funnel' AND closed_at >= ?").bind(now - 7 * DAY).first<{ n: number }>();
    spend = { yesterday: sp.y || 0, cpl: yLeads?.n ? (sp.y || 0) / yLeads.n : null, cac7: won7?.n ? (sp.w || 0) / won7.n : null };
  }
  const alerts = ((await db.prepare("SELECT rule, detail FROM alerts WHERE resolved_at IS NULL ORDER BY opened_at DESC LIMIT 5").all<{ rule: string; detail: string | null }>().catch(() => ({ results: [] }))).results) || [];
  const time = (ms: number) => new Intl.DateTimeFormat("en-GB", { timeZone: tz, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date(ms));
  return digestLines({
    cur, avg, origin: rt.origin,
    calls: calls.map((c) => ({
      closer: reps.find((r) => r.id === c.closer_id)?.name || (c.closer_id ? String(c.closer_id) : "Unassigned"),
      time: time(Number(c.call_at)), name: nameShort(c.first_name, c.last_name), tier: (c.tier as string) || null,
      risk: c.noshow_risk == null ? null : Number(c.noshow_risk),
    })),
    needs: needs.slice(0, 5).map((r) => nameShort(r.first_name, r.last_name)), needsTotal: needs.length,
    followUps: fu.slice(0, 5).map((r) => r.name.split(" ")[0] + (r.closer ? ` (${r.closer})` : "")), followUpsTotal: fu.length,
    payments: overduePay.slice(0, 5).map((r) => r.name.split(" ")[0]), paymentsTotal: overduePay.length,
    spend,
    alerts: alerts.map((a) => RULES[a.rule]?.label || a.rule),
  });
}
