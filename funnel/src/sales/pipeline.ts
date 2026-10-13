// Pipeline board, weighted pipeline and the cash forecast.
// Columns map from the existing statuses and deal fields:
//   Booked              status booked (upcoming, plus calls that still need an outcome)
//   Held – follow-up    status showed
//   Verbal – contract   status showed with the verbal marker (lead_revops.pipeline_stage) or a contract date
//   Won – payment plan  won on a plan (2+ instalments) that is not fully collected
//   Won – paid in full  won and fully collected (last 90 days)
// Stage probabilities P(won | stage, tier) come from history (STAGE_VALUES cells with 20+ outcomes, and the
// verbal marker's own record), otherwise fixed fallbacks. Forecasts are in cash, against the sum of rep targets.

import type { Runtime } from "../app";
import { ECONOMICS, type Tier } from "../config";
import { MIN_CELL, parseStageValues, type StageValues } from "./values";
import { planCount, scheduledBetween } from "./receivables";
import { listRepsNamed } from "./reps";
import { localParts, zonedTime } from "../integrations/sequences";
import { salesTz } from "../admin/stats";

const DAY = 86_400_000;
const TIERS: Tier[] = ["A", "B", "C"];

export const PIPE_STAGES = [
  { id: "booked", label: "Booked", sub: "Upcoming calls" },
  { id: "held", label: "Held – follow-up", sub: "Showed, no decision yet" },
  { id: "verbal", label: "Verbal – contract out", sub: "Said yes, paperwork out" },
  { id: "won_plan", label: "Won – payment plan", sub: "Collecting instalments" },
  { id: "won_paid", label: "Won – paid in full", sub: "Last 90 days" },
] as const;
export type PipeStage = (typeof PIPE_STAGES)[number]["id"];
export const OPEN_STAGES: PipeStage[] = ["booked", "held", "verbal"];

/** P(won | stage, tier) when history is thin. */
export const FALLBACK_P: Record<"booked" | "held" | "verbal", Record<Tier, number>> = {
  booked: { A: 0.2, B: 0.12, C: 0.04 },
  held: { A: 0.35, B: 0.25, C: 0.1 },
  verbal: { A: 0.7, B: 0.65, C: 0.5 },
};
export const FALLBACK_SHOW = 0.7;
export const FALLBACK_CASH_SHARE = 0.5;

export interface PipeLead {
  status: string; call_at: number | null; booked_at: number | null; showed_at: number | null; closed_at: number | null;
  payment_plan: string | null; installments_total: number | null; revenue: number; cash_collected: number;
  refunded_at: number | null; booking_cancelled_at: number | null; contract_signed_at: number | null;
  pipeline_stage: string | null; pipeline_stage_at: number | null;
}

/** Pure: which column a lead sits in, or null when it is not on the board. */
export function stageOf(l: PipeLead): PipeStage | null {
  if (l.status === "booked") return l.booking_cancelled_at ? null : "booked";
  if (l.status === "showed") return l.pipeline_stage === "verbal" || l.contract_signed_at ? "verbal" : "held";
  if (l.status === "won" && !l.refunded_at) {
    const plan = planCount(l) > 0;
    const paidUp = l.revenue > 0 ? l.cash_collected >= l.revenue - 0.5 : true;
    return plan && !paidUp ? "won_plan" : "won_paid";
  }
  return null;
}

/** Pure: when the lead entered its column. */
export function stageSince(l: PipeLead, stage: PipeStage): number | null {
  if (stage === "booked") return l.booked_at;
  if (stage === "held") return l.showed_at || l.call_at;
  if (stage === "verbal") return l.pipeline_stage_at || l.contract_signed_at || l.showed_at;
  return l.closed_at;
}

export interface StageProbs {
  p: Record<"booked" | "held" | "verbal", Record<Tier, number>>;
  source: Record<"booked" | "held" | "verbal", Record<Tier, "history" | "fallback">>;
  show: Record<Tier, number>;
  avg_deal: number;
  cash_share: number;
}

/** Pure: probabilities from STAGE_VALUES cells and the verbal record, with fallbacks for thin cells. */
export function stageProbs(sv: StageValues | null, verbal: Record<string, { n: number; won: number }>, show: Record<string, { n: number; showed: number }>, cashShare: number | null): StageProbs {
  const p = { booked: { ...FALLBACK_P.booked }, held: { ...FALLBACK_P.held }, verbal: { ...FALLBACK_P.verbal } };
  const source = { booked: { A: "fallback", B: "fallback", C: "fallback" }, held: { A: "fallback", B: "fallback", C: "fallback" }, verbal: { A: "fallback", B: "fallback", C: "fallback" } } as StageProbs["source"];
  const showOut = { A: FALLBACK_SHOW, B: FALLBACK_SHOW, C: FALLBACK_SHOW };
  for (const t of TIERS) {
    const b = sv?.cells?.booking_scheduled?.[t], h = sv?.cells?.call_showed?.[t];
    if (b && b.n >= MIN_CELL && b.p != null) { p.booked[t] = b.p; source.booked[t] = "history"; }
    if (h && h.n >= MIN_CELL && h.p != null) { p.held[t] = h.p; source.held[t] = "history"; }
    const v = verbal[t];
    if (v && v.n >= MIN_CELL) { p.verbal[t] = Math.round((v.won / v.n) * 1e4) / 1e4; source.verbal[t] = "history"; }
    const s = show[t];
    if (s && s.n >= MIN_CELL) showOut[t] = Math.round((s.showed / s.n) * 1e4) / 1e4;
  }
  return { p, source, show: showOut, avg_deal: sv?.avg_deal && sv.avg_deal > 0 ? sv.avg_deal : ECONOMICS.avgDeal, cash_share: cashShare ?? FALLBACK_CASH_SHARE };
}

export async function loadStageProbs(rt: Runtime): Promise<StageProbs> {
  const db = rt.env.DB;
  const since = rt.now() - 365 * DAY;
  const [verbal, show, cash] = await Promise.all([
    db.prepare(
      `SELECT COALESCE(l.tier_override, l.tier) AS tier, COUNT(*) AS n, SUM(l.status = 'won') AS won FROM leads l JOIN lead_revops r ON r.lead_id = l.id
       WHERE r.pipeline_stage = 'verbal' AND COALESCE(r.is_test, 0) != 1 AND l.status IN ('won','lost') AND l.updated_at >= ? GROUP BY 1`,
    ).bind(since).all<{ tier: string; n: number; won: number }>(),
    db.prepare(
      `SELECT COALESCE(tier_override, tier) AS tier, COUNT(*) AS n, SUM(status IN ('showed','won','lost') OR showed_at IS NOT NULL) AS showed FROM leads
       WHERE booked_at IS NOT NULL AND booking_source = 'funnel' AND id NOT IN (SELECT lead_id FROM lead_revops WHERE is_test = 1) AND call_at >= ? AND call_at < ? AND status IN ('showed','won','lost','no_show') GROUP BY 1`,
    ).bind(since, rt.now()).all<{ tier: string; n: number; showed: number }>(),
    db.prepare(
      `SELECT COUNT(*) AS n, SUM(l.revenue) AS revenue, SUM((SELECT COALESCE(SUM(p.amount), 0) FROM payments p WHERE p.lead_id = l.id AND p.paid_at < l.closed_at + ${31 * DAY})) AS cash31
       FROM leads l WHERE l.status = 'won' AND l.revenue > 0 AND l.id NOT IN (SELECT lead_id FROM lead_revops WHERE is_test = 1) AND l.closed_at >= ? AND l.closed_at < ?`,
    ).bind(since, rt.now() - 31 * DAY).first<{ n: number; revenue: number; cash31: number }>(),
  ]);
  const by = <T extends { tier: string }>(rows: T[]) => Object.fromEntries(rows.map((r) => [r.tier, r]));
  const share = cash && Number(cash.n) >= 5 && Number(cash.revenue) > 0 ? Math.min(1, Math.max(0, Number(cash.cash31) / Number(cash.revenue))) : null;
  return stageProbs(parseStageValues(rt.settings.get("STAGE_VALUES")), by((verbal.results || []).map((r) => ({ ...r, n: Number(r.n), won: Number(r.won) }))),
    by((show.results || []).map((r) => ({ ...r, n: Number(r.n), showed: Number(r.showed) }))), share == null ? null : Math.round(share * 1000) / 1000);
}

export interface Card {
  id: string; ref_code: string; name: string; tier: string | null; closer_id: string | null; closer: string | null; temperature: string | null;
  stage: PipeStage; value: number; value_is_estimate: boolean; p: number | null; expected: number; days_in_stage: number | null;
  call_at: number | null; needs_outcome: boolean; noshow_risk: number | null; remaining: number | null;
}

/** Pure: a card from a row, with value = deal value (or the average deal) and expected = P × value. */
export function toCard(r: PipeLead & { id: string; ref_code: string; first_name: string | null; last_name: string | null; email: string; tier: string | null; closer_id: string | null; temperature: string | null; noshow_risk: number | null }, probs: StageProbs, now: number, closerName: (id: string | null) => string | null): Card | null {
  const stage = stageOf(r);
  if (!stage) return null;
  const tier = (TIERS as string[]).includes(r.tier || "") ? (r.tier as Tier) : "B";
  const est = !(r.revenue > 0);
  const value = est ? probs.avg_deal : r.revenue;
  const open = stage === "booked" || stage === "held" || stage === "verbal";
  const p = open ? probs.p[stage as "booked" | "held" | "verbal"][tier] : 1;
  const since = stageSince(r, stage);
  return {
    id: r.id, ref_code: r.ref_code, name: [r.first_name, r.last_name].filter(Boolean).join(" ") || r.email, tier: r.tier,
    closer_id: r.closer_id, closer: closerName(r.closer_id), temperature: r.temperature, stage, value, value_is_estimate: est && open,
    p: open ? p : null, expected: Math.round(open ? p * value : value), days_in_stage: since ? Math.max(0, Math.floor((now - since) / DAY)) : null,
    call_at: r.call_at, needs_outcome: stage === "booked" && !!r.call_at && r.call_at < now - 30 * 60_000,
    noshow_risk: r.noshow_risk == null ? null : Number(r.noshow_risk),
    remaining: stage === "won_plan" ? Math.max(0, Math.round(r.revenue - r.cash_collected)) : null,
  };
}

const COLS = `l.id, l.ref_code, l.first_name, l.last_name, l.email, COALESCE(l.tier_override, l.tier) AS tier, l.closer_id, l.setter_id, l.temperature,
  l.status, l.call_at, l.booked_at, l.showed_at, l.closed_at, l.payment_plan, l.installments_total, l.revenue, l.cash_collected, l.refunded_at,
  l.booking_cancelled_at, l.contract_signed_at, r.pipeline_stage, r.pipeline_stage_at, r.noshow_risk`;

async function boardRows(rt: Runtime, rep: string | null | undefined) {
  const now = rt.now();
  const scope = " AND l.id NOT IN (SELECT lead_id FROM lead_revops WHERE is_test = 1)" + (rep ? " AND (l.closer_id = ? OR l.setter_id = ?)" : "");
  return ((await rt.env.DB.prepare(
    `SELECT ${COLS} FROM leads l LEFT JOIN lead_revops r ON r.lead_id = l.id
     WHERE ((l.status = 'booked' AND l.booking_cancelled_at IS NULL AND l.call_at > ?) OR (l.status = 'showed' AND COALESCE(l.showed_at, l.call_at, l.updated_at) > ?)
       OR (l.status = 'won' AND l.refunded_at IS NULL AND (l.closed_at > ? OR l.cash_collected < l.revenue)))${scope}
     ORDER BY COALESCE(l.call_at, l.closed_at, l.updated_at) DESC LIMIT 600`,
  ).bind(now - 30 * DAY, now - 120 * DAY, now - 90 * DAY, ...(rep ? [rep, rep] : [])).all<Record<string, unknown>>()).results) || [];
}

function rowToLead(r: Record<string, unknown>) {
  const n = (v: unknown) => (v == null ? null : Number(v));
  return {
    id: String(r.id), ref_code: String(r.ref_code), first_name: (r.first_name as string) || null, last_name: (r.last_name as string) || null, email: String(r.email),
    tier: (r.tier as string) || null, closer_id: (r.closer_id as string) || null, temperature: (r.temperature as string) || null, status: String(r.status),
    call_at: n(r.call_at), booked_at: n(r.booked_at), showed_at: n(r.showed_at), closed_at: n(r.closed_at), payment_plan: (r.payment_plan as string) || null,
    installments_total: n(r.installments_total), revenue: Number(r.revenue) || 0, cash_collected: Number(r.cash_collected) || 0, refunded_at: n(r.refunded_at),
    booking_cancelled_at: n(r.booking_cancelled_at), contract_signed_at: n(r.contract_signed_at), pipeline_stage: (r.pipeline_stage as string) || null,
    pipeline_stage_at: n(r.pipeline_stage_at), noshow_risk: n(r.noshow_risk),
  };
}

/** Pure: monthly windows in the sales time zone: [this month, next month]. */
export function monthWindows(now: number, tz: string): Array<{ key: string; from: number; to: number }> {
  const p = localParts(now, tz);
  const start = (y: number, m: number) => zonedTime(y + Math.floor((m - 1) / 12), ((m - 1) % 12 + 12) % 12 + 1, 1, 0, 0, tz);
  const out = [];
  for (let i = 0; i < 2; i++) {
    const y = p.y + Math.floor((p.mo - 1 + i) / 12), m = ((p.mo - 1 + i) % 12) + 1;
    out.push({ key: `${y}-${String(m).padStart(2, "0")}`, from: start(y, m), to: start(y, m + 1) });
  }
  return out;
}

export interface ForecastMonth {
  key: string; from: number; to: number; collected: number; scheduled: number; commit: number; expected: number; best: number; target: number;
  calls: number; open_deals: number;
}

/** Pure: forecast for one month from its parts. Open deals only count in the current month. */
export function forecastMonth(m: { key: string; from: number; to: number }, parts: {
  current: boolean; collected: number; scheduled: number; target: number; probs: StageProbs;
  open: Array<{ stage: PipeStage; tier: string | null; value: number }>;
  calls: Array<{ tier: string | null; noshow_risk: number | null }>;
}): ForecastMonth {
  const pr = parts.probs;
  const share = pr.cash_share;
  const tierOf = (t: string | null): Tier => ((TIERS as string[]).includes(t || "") ? (t as Tier) : "B");
  let commitAdd = 0, expectedAdd = 0, bestAdd = 0;
  if (parts.current) {
    for (const d of parts.open) {
      if (d.stage !== "held" && d.stage !== "verbal") continue;
      const p = pr.p[d.stage][tierOf(d.tier)];
      if (d.stage === "verbal") commitAdd += d.value * share;
      expectedAdd += p * d.value * share;
      bestAdd += d.value * share;
    }
  }
  for (const c of parts.calls) {
    const t = tierOf(c.tier);
    const pShow = c.noshow_risk != null ? 1 - c.noshow_risk : pr.show[t];
    const pClose = pr.p.held[t];
    expectedAdd += pShow * pClose * pr.avg_deal * share;
    bestAdd += pShow * pr.avg_deal * share;
  }
  const base = parts.collected + parts.scheduled;
  const r = (v: number) => Math.round(v);
  return {
    key: m.key, from: m.from, to: m.to, collected: r(parts.collected), scheduled: r(parts.scheduled), commit: r(base + commitAdd), expected: r(base + expectedAdd),
    best: r(base + bestAdd), target: r(parts.target), calls: parts.calls.length, open_deals: parts.current ? parts.open.filter((d) => d.stage === "held" || d.stage === "verbal").length : 0,
  };
}

export async function pipelineReport(rt: Runtime, rep?: string | null) {
  const now = rt.now();
  const [rows, probs, reps] = await Promise.all([boardRows(rt, rep), loadStageProbs(rt), listRepsNamed(rt)]);
  const name = (id: string | null) => (id ? reps.find((r) => r.id === id)?.name || id : null);
  const cards = rows.map((r) => toCard(rowToLead(r) as never, probs, now, name)).filter((c): c is Card => !!c);
  const columns = PIPE_STAGES.map((s) => {
    const cs = cards.filter((c) => c.stage === s.id).sort((a, b) => (s.id === "booked" ? (a.call_at || 0) - (b.call_at || 0) : b.expected - a.expected));
    return { ...s, cards: cs, count: cs.length, value: cs.reduce((t, c) => t + c.value, 0), weighted: cs.reduce((t, c) => t + c.expected, 0) };
  });
  const weighted = columns.filter((c) => (OPEN_STAGES as string[]).includes(c.id)).reduce((t, c) => t + c.weighted, 0);

  // Forecast
  const tz = salesTz(rt);
  const months = monthWindows(now, tz);
  const scope = " AND l.id NOT IN (SELECT lead_id FROM lead_revops WHERE is_test = 1)" + (rep ? " AND (l.closer_id = ? OR l.setter_id = ?)" : "");
  const sb = rep ? [rep, rep] : [];
  const db = rt.env.DB;
  const forecast: ForecastMonth[] = [];
  const target = rep ? Number(reps.find((r) => r.id === rep)?.monthly_target) || 0 : reps.filter((r) => r.active).reduce((t, r) => t + (Number(r.monthly_target) || 0), 0);
  for (let i = 0; i < months.length; i++) {
    const m = months[i];
    const current = i === 0;
    const [collected, scheduled, calls] = await Promise.all([
      current ? db.prepare(`SELECT COALESCE(SUM(p.amount), 0) AS s FROM payments p JOIN leads l ON l.id = p.lead_id WHERE p.paid_at >= ? AND p.paid_at <= ?${scope}`).bind(m.from, now, ...sb).first<{ s: number }>() : Promise.resolve({ s: 0 }),
      // The current month also carries overdue instalments: they are still expected.
      scheduledBetween(rt, current ? 0 : m.from, m.to, rep),
      db.prepare(
        `SELECT COALESCE(l.tier_override, l.tier) AS tier, r.noshow_risk FROM leads l LEFT JOIN lead_revops r ON r.lead_id = l.id
         WHERE l.status = 'booked' AND l.booking_cancelled_at IS NULL AND l.call_at >= ? AND l.call_at < ?${scope}`,
      ).bind(Math.max(m.from, now), m.to, ...sb).all<{ tier: string | null; noshow_risk: number | null }>(),
    ]);
    forecast.push(forecastMonth(m, {
      current, collected: Number(collected?.s) || 0, scheduled, target, probs,
      open: cards.filter((c) => c.stage === "held" || c.stage === "verbal").map((c) => ({ stage: c.stage, tier: c.tier, value: c.value })),
      calls: (calls.results || []).map((c) => ({ tier: c.tier, noshow_risk: c.noshow_risk == null ? null : Number(c.noshow_risk) })),
    }));
  }
  return { stages: columns, weighted: Math.round(weighted), probs, forecast, scoped: !!rep };
}

/** Pure: the lead patch and verbal marker for a drag to `stage`. Throws a message for moves that need more. */
export function movePatch(stage: string, lead: { status: string; revenue: number; payment_plan: string | null; installments_total: number | null }, input: { revenue?: unknown; installments?: unknown }): { patch: Record<string, unknown>; verbal: boolean | null } {
  const rev = input.revenue === undefined || input.revenue === null || input.revenue === "" ? null : Number(input.revenue);
  if (rev != null && (!Number.isFinite(rev) || rev <= 0 || rev > 1e9)) throw new Error("Enter the deal value.");
  if (stage === "held") return { patch: { status: "showed" }, verbal: false };
  if (stage === "verbal") return { patch: { status: "showed" }, verbal: true };
  if (stage === "won_paid" || stage === "won_plan") {
    const revenue = rev ?? (lead.revenue > 0 ? lead.revenue : null);
    if (revenue == null) throw new Error("Enter the deal value.");
    if (stage === "won_paid") return { patch: { status: "won", revenue, payment_plan: "full", installments_total: null }, verbal: null };
    const n = input.installments === undefined || input.installments === null || input.installments === "" ? lead.installments_total : Number(input.installments);
    if (!n || !Number.isInteger(n) || n < 2 || n > 60) throw new Error("Enter the number of instalments (2 or more).");
    const plan = lead.payment_plan && lead.payment_plan !== "full" ? lead.payment_plan : n === 2 ? "split_2" : n === 3 ? "split_3" : "monthly";
    return { patch: { status: "won", revenue, payment_plan: plan, installments_total: n }, verbal: null };
  }
  throw new Error(stage === "booked" ? "Calls move to Booked when they are booked." : "Unknown stage.");
}

export async function setVerbal(rt: Runtime, leadId: string, on: boolean): Promise<void> {
  const now = rt.now();
  await rt.env.DB.prepare(
    `INSERT INTO lead_revops (lead_id, pipeline_stage, pipeline_stage_at, updated_at) VALUES (?,?,?,?)
     ON CONFLICT(lead_id) DO UPDATE SET pipeline_stage = excluded.pipeline_stage,
       pipeline_stage_at = CASE WHEN lead_revops.pipeline_stage IS excluded.pipeline_stage THEN lead_revops.pipeline_stage_at ELSE excluded.pipeline_stage_at END,
       updated_at = excluded.updated_at`,
  ).bind(leadId, on ? "verbal" : null, on ? now : null, now).run();
}
