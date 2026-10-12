// Sales reports (team scoreboard, call log, calls that need an outcome), the leads list and CSV export.

import type { Runtime } from "../app";
import { STATUSES } from "../config";
import { listReps, type Rep } from "../sales/reps";
import { all, leadDims, num, one, pct, type Filters } from "./stats";

const DAY = 86_400_000;

export interface RepRow {
  id: string; name: string; role: string; active: boolean;
  calls: number; showed: number; no_show: number; show_rate: number | null; won: number; lost: number; close_rate: number | null;
  revenue: number; cash: number; commission: number; target: number; target_pct: number | null; booked_set: number; upcoming: number;
}

export async function salesTeam(rt: Runtime, f: Filters) {
  const now = rt.now();
  const ld = leadDims(f, "l");
  const reps = await listReps(rt);
  const [calls, cash, sets, upcoming] = await Promise.all([
    all<{ rep: string | null; calls: number; showed: number; no_show: number; won: number; lost: number; revenue: number }>(rt,
      `SELECT l.closer_id AS rep, COUNT(*) AS calls,
         SUM(l.showed_at IS NOT NULL OR l.status IN ('showed','won','lost')) AS showed,
         SUM(l.status = 'no_show') AS no_show,
         SUM(l.status = 'won') AS won, SUM(l.status = 'lost') AS lost,
         SUM(CASE WHEN l.status = 'won' THEN l.revenue ELSE 0 END) AS revenue
       FROM leads l WHERE l.call_at >= ? AND l.call_at <= ? AND l.booking_cancelled_at IS NULL AND l.booking_source = 'funnel'${ld.sql}
       GROUP BY l.closer_id`, [f.since, now, ...ld.binds]),
    all<{ rep: string | null; cash: number }>(rt,
      `SELECT l.closer_id AS rep, SUM(p.amount) AS cash FROM payments p JOIN leads l ON l.id = p.lead_id WHERE p.paid_at >= ?${ld.sql} GROUP BY l.closer_id`,
      [f.since, ...ld.binds]),
    all<{ rep: string | null; n: number }>(rt,
      `SELECT l.setter_id AS rep, COUNT(*) AS n FROM leads l WHERE l.booked_at >= ? AND l.setter_id IS NOT NULL${ld.sql} GROUP BY l.setter_id`, [f.since, ...ld.binds]),
    all<{ rep: string | null; n: number }>(rt,
      `SELECT l.closer_id AS rep, COUNT(*) AS n FROM leads l WHERE l.status = 'booked' AND l.call_at > ? AND l.call_at < ? AND l.booking_cancelled_at IS NULL GROUP BY l.closer_id`,
      [now, now + 7 * DAY]),
  ]);
  const ids = new Set<string>([...reps.map((r) => r.id)]);
  for (const r of [...calls, ...cash, ...upcoming]) ids.add(r.rep || "");
  const repById = new Map(reps.map((r) => [r.id, r]));
  const rows: RepRow[] = [...ids].map((id) => {
    const rep: Rep | undefined = repById.get(id);
    const c = calls.find((x) => (x.rep || "") === id);
    const cashN = num(cash.find((x) => (x.rep || "") === id)?.cash);
    const showed = num(c?.showed), noShow = num(c?.no_show), won = num(c?.won);
    const target = num(rep?.monthly_target);
    return {
      id, name: rep?.name || (id ? id : "Unassigned"), role: rep?.role || "closer", active: rep ? !!rep.active : !id,
      calls: num(c?.calls), showed, no_show: noShow, show_rate: pct(showed, showed + noShow), won, lost: num(c?.lost),
      close_rate: pct(won, showed), revenue: num(c?.revenue), cash: cashN,
      commission: Math.round(cashN * num(rep?.commission_pct)) / 100,
      target, target_pct: target ? pct(cashN, target) : null,
      booked_set: num(sets.find((x) => (x.rep || "") === id)?.n), upcoming: num(upcoming.find((x) => (x.rep || "") === id)?.n),
    };
  }).filter((r) => r.calls || r.cash || r.upcoming || r.booked_set || (r.id && repById.get(r.id)?.active));
  rows.sort((a, b) => b.cash - a.cash || b.won - a.won || b.calls - a.calls);
  const tot = rows.reduce((t, r) => ({ calls: t.calls + r.calls, showed: t.showed + r.showed, no_show: t.no_show + r.no_show, won: t.won + r.won, revenue: t.revenue + r.revenue, cash: t.cash + r.cash }), { calls: 0, showed: 0, no_show: 0, won: 0, revenue: 0, cash: 0 });
  return {
    kpis: { ...tot, show_rate: pct(tot.showed, tot.showed + tot.no_show), close_rate: pct(tot.won, tot.showed), avg_deal: tot.won ? Math.round(tot.revenue / tot.won) : null },
    reps: rows,
    call_log: await callLog(rt, f),
    needs_outcome: await needsOutcome(rt),
  };
}

export interface CallRow {
  id: string; ref_code: string; name: string; tier: string | null; call_at: number; status: string; closer: string | null; closer_id: string | null;
  revenue: number; cash_collected: number; booking_source: string; lost_reason: string | null;
}

function repName(reps: Rep[], id: string | null): string | null {
  if (!id) return null;
  return reps.find((r) => r.id === id)?.name || id;
}

export async function callLog(rt: Runtime, f: Filters): Promise<CallRow[]> {
  const ld = leadDims(f, "l");
  const reps = await listReps(rt);
  const rows = await all<Record<string, unknown>>(rt,
    `SELECT l.id, l.ref_code, l.first_name, l.last_name, l.email, COALESCE(l.tier_override, l.tier) AS tier, l.call_at, l.status, l.closer_id,
       l.revenue, l.cash_collected, l.booking_source, l.lost_reason
     FROM leads l WHERE l.call_at >= ? AND l.call_at <= ? AND l.booking_cancelled_at IS NULL${ld.sql} ORDER BY l.call_at DESC LIMIT 200`,
    [f.since, rt.now() + 14 * DAY, ...ld.binds]);
  return rows.map((r) => ({
    id: String(r.id), ref_code: String(r.ref_code), name: [r.first_name, r.last_name].filter(Boolean).join(" ") || String(r.email),
    tier: (r.tier as string) || null, call_at: num(r.call_at), status: String(r.status), closer_id: (r.closer_id as string) || null,
    closer: repName(reps, (r.closer_id as string) || null), revenue: num(r.revenue), cash_collected: num(r.cash_collected),
    booking_source: String(r.booking_source), lost_reason: (r.lost_reason as string) || null,
  }));
}

/** Calls in the last 30 days that happened but still say "booked". */
export async function needsOutcome(rt: Runtime): Promise<CallRow[]> {
  const now = rt.now();
  const reps = await listReps(rt);
  const rows = await all<Record<string, unknown>>(rt,
    `SELECT l.id, l.ref_code, l.first_name, l.last_name, l.email, COALESCE(l.tier_override, l.tier) AS tier, l.call_at, l.status, l.closer_id,
       l.revenue, l.cash_collected, l.booking_source, l.lost_reason
     FROM leads l WHERE l.status = 'booked' AND l.booking_cancelled_at IS NULL AND l.call_at < ? AND l.call_at > ? ORDER BY l.call_at DESC LIMIT 100`,
    [now - 30 * 60_000, now - 30 * DAY]);
  return rows.map((r) => ({
    id: String(r.id), ref_code: String(r.ref_code), name: [r.first_name, r.last_name].filter(Boolean).join(" ") || String(r.email),
    tier: (r.tier as string) || null, call_at: num(r.call_at), status: String(r.status), closer_id: (r.closer_id as string) || null,
    closer: repName(reps, (r.closer_id as string) || null), revenue: num(r.revenue), cash_collected: num(r.cash_collected),
    booking_source: String(r.booking_source), lost_reason: (r.lost_reason as string) || null,
  }));
}

// ── Leads list ───────────────────────────────────────────────────────────────

export const LEAD_SORTS: Record<string, string> = {
  created: "l.created_at DESC",
  updated: "l.updated_at DESC",
  score: "l.score DESC NULLS LAST, l.created_at DESC",
  call: "l.call_at DESC NULLS LAST",
  value: "l.revenue DESC, l.cash_collected DESC",
  name: "lower(COALESCE(l.first_name, l.email)) ASC",
};
export const PER_PAGE = 50;

export interface LeadQuery { q?: string; status?: string; tier?: string; sort?: string; page?: number }

function leadWhere(f: Filters, lq: LeadQuery): { sql: string; binds: unknown[] } {
  const parts: string[] = ["1=1"];
  const binds: unknown[] = [];
  const q = (lq.q || "").trim().slice(0, 80);
  if (q) {
    // Search ignores the date range: you are looking for a person.
    const like = `%${q.replace(/[%_\\]/g, (m) => "\\" + m)}%`;
    parts.push(`(l.email LIKE ? ESCAPE '\\' OR l.first_name LIKE ? ESCAPE '\\' OR l.last_name LIKE ? ESCAPE '\\' OR l.ref_code LIKE ? ESCAPE '\\' OR l.phone LIKE ? ESCAPE '\\' OR (COALESCE(l.first_name,'') || ' ' || COALESCE(l.last_name,'')) LIKE ? ESCAPE '\\')`);
    binds.push(like, like, like, like, like, like);
  } else if (f.range !== "all") {
    parts.push("l.created_at >= ?");
    binds.push(f.since);
  }
  if (lq.status && (STATUSES as readonly string[]).includes(lq.status)) { parts.push("l.status = ?"); binds.push(lq.status); }
  if (lq.tier && ["A", "B", "C"].includes(lq.tier)) { parts.push("COALESCE(l.tier_override, l.tier) = ?"); binds.push(lq.tier); }
  if (lq.tier === "none") parts.push("COALESCE(l.tier_override, l.tier) IS NULL");
  const ld = leadDims(f, "l");
  return { sql: parts.join(" AND ") + ld.sql, binds: [...binds, ...ld.binds] };
}

const LIST_COLS = `l.id, l.ref_code, l.created_at, l.updated_at, l.first_name, l.last_name, l.email, l.status, l.score,
  COALESCE(l.tier_override, l.tier) AS tier, l.tier_override, l.closer_id, l.call_at, l.booked_at, l.revenue, l.cash_collected,
  COALESCE(l.ft_channel, l.channel) AS channel, COALESCE(l.ft_campaign, l.utm_campaign) AS campaign, l.country, l.device,
  l.industry, l.booking_source, l.step_reached, l.app_completed_at, l.lander, l.variant`;

export async function listLeads(rt: Runtime, f: Filters, lq: LeadQuery) {
  const w = leadWhere(f, lq);
  const page = Math.max(1, Math.min(10_000, Math.floor(Number(lq.page) || 1)));
  const order = LEAD_SORTS[lq.sort || ""] || LEAD_SORTS.created;
  const [rows, total, reps] = await Promise.all([
    all<Record<string, unknown>>(rt, `SELECT ${LIST_COLS} FROM leads l WHERE ${w.sql} ORDER BY ${order} LIMIT ? OFFSET ?`, [...w.binds, PER_PAGE, (page - 1) * PER_PAGE]),
    one<{ n: number }>(rt, `SELECT COUNT(*) AS n FROM leads l WHERE ${w.sql}`, w.binds),
    listReps(rt),
  ]);
  const n = num(total?.n);
  return {
    rows: rows.map((r) => ({ ...r, closer: repName(reps, (r.closer_id as string) || null) })),
    total: n, page, per_page: PER_PAGE, pages: Math.max(1, Math.ceil(n / PER_PAGE)),
  };
}

// ── CSV ──────────────────────────────────────────────────────────────────────

/** One CSV cell. Strings starting with = + - @ tab or CR get a leading quote (formula injection). */
export function csvCell(v: unknown): string {
  if (v == null) return "";
  if (typeof v === "number") return Number.isFinite(v) ? String(v) : "";
  if (typeof v === "boolean") return v ? "true" : "false";
  let s = String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
  if (/[",\r\n]/.test(s)) s = `"${s.replace(/"/g, '""')}"`;
  return s;
}

export function toCsv(header: string[], rows: unknown[][]): string {
  return [header, ...rows].map((r) => r.map(csvCell).join(",")).join("\r\n") + "\r\n";
}

const iso = (t: unknown) => (typeof t === "number" && t > 0 ? new Date(t).toISOString() : "");

export const CSV_COLUMNS = [
  "ref", "created", "first_name", "last_name", "email", "phone", "status", "tier", "score", "closer", "call_at", "revenue",
  "cash_collected", "channel", "source", "campaign", "content", "landing", "lander", "variant", "country", "industry",
  "revenue_band", "budget_band", "offer", "payment_plan", "lost_reason", "booking_source",
];

export async function leadsCsv(rt: Runtime, f: Filters, lq: LeadQuery): Promise<string> {
  const w = leadWhere(f, lq);
  const order = LEAD_SORTS[lq.sort || ""] || LEAD_SORTS.created;
  const reps = await listReps(rt);
  const rows = await all<Record<string, unknown>>(rt,
    `SELECT l.*, COALESCE(l.tier_override, l.tier) AS eff_tier FROM leads l WHERE ${w.sql} ORDER BY ${order} LIMIT 10000`, w.binds);
  return toCsv(CSV_COLUMNS, rows.map((r) => [
    r.ref_code, iso(r.created_at), r.first_name, r.last_name, r.email, r.phone, r.status, r.eff_tier, r.score,
    repName(reps, (r.closer_id as string) || null), iso(r.call_at), r.revenue, r.cash_collected,
    r.ft_channel || r.channel, r.ft_source || r.utm_source, r.ft_campaign || r.utm_campaign, r.ft_content || r.utm_content,
    r.ft_landing || r.landing_path, r.ft_lander || r.lander, r.variant, r.country, r.industry, r.revenue_band, r.budget_band,
    r.offer, r.payment_plan, r.lost_reason, r.booking_source,
  ]));
}
