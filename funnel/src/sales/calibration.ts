// Scoring calibration. Nightly, over leads with a terminal outcome in the last 365 days:
//  · per application option: smoothed win rate, lift over the base rate, and suggested points;
//  · a small L2 logistic regression over one-hot answers, film watch share and flags (P(won));
//  · the model is stored in scoring_models and used to compute lead_revops.p_win for open leads.
// Routing still uses the points in config.ts: scoring.ts exposes no hook for a learned model, so
// "suggested points" are advice to copy into config by hand (documented follow-up).

import type { Runtime } from "../app";
import { APPLICATION, ECONOMICS, TIER_RULES } from "../config";
import { newId } from "../lib/ids";
import { kvGate } from "../lib/kv";
import { popcount } from "../tracking/vsl";
import { auc, brier, fitLogistic, isHoldout, predict, reliability, round4, smoothedRate, type LogisticModel, type ReliabilityBin, type Sample } from "./model";
import { fitNoShowModel } from "./noshow";
import { recomputeStageValues } from "./values";
import { LEARNED_MIN_N, parseLearnedPoints, type LearnedPoints } from "../funnel/scoring";
import { saveSetting } from "../settings";

const DAY = 86_400_000;
export const MIN_TRAIN = 30;
export const MIN_CLASS = 5;
export const TERMINAL = ["won", "lost", "no_show", "disqualified"];
export const OPEN = ["applied", "booked", "showed", "no_show", "nurture"];
export const FLAG_FEATURES = [...new Set([...TIER_RULES.maxC, ...TIER_RULES.maxB, "personal_email", "partner"])];

/** Feature names: q=value for every single/multi option, then film watch share, then flags. */
export function featureSpace(): string[] {
  const f: string[] = [];
  for (const q of APPLICATION) if (q.type === "single" || q.type === "multi") for (const o of q.options || []) f.push(`${q.id}=${o.value}`);
  f.push("vsl_watched");
  for (const fl of FLAG_FEATURES) f.push(`flag:${fl}`);
  return f;
}

export interface TrainRow { id: string; answers: Record<string, unknown>; watched: number | null; flags: string[]; tier: string | null; won: boolean; status: string; revenue: number; booked: boolean; showed: boolean }

export function encode(space: string[], answers: Record<string, unknown>, watched: number | null, flags: string[]): number[] {
  const idx = new Map(space.map((f, i) => [f, i]));
  const x = new Array(space.length).fill(0);
  for (const [qid, v] of Object.entries(answers)) {
    for (const val of Array.isArray(v) ? v : [v]) {
      const i = idx.get(`${qid}=${String(val)}`);
      if (i != null) x[i] = 1;
    }
  }
  const w = idx.get("vsl_watched");
  if (w != null) x[w] = Math.max(0, Math.min(100, watched ?? 0)) / 100;
  for (const fl of flags) { const i = idx.get(`flag:${fl}`); if (i != null) x[i] = 1; }
  return x;
}

export interface OptionStat { question: string; title: string; value: string; label: string; n: number; wins: number; rate: number | null; smoothed: number; lift: number | null; points: number; suggested: number }

/** Pure: per-option win rates (shrunk to the base rate) and points rescaled within each question. */
export function optionStats(rows: TrainRow[], k = 5): OptionStat[] {
  const base = rows.length ? rows.filter((r) => r.won).length / rows.length : 0;
  const out: OptionStat[] = [];
  for (const q of APPLICATION) {
    if (q.type !== "single" && q.type !== "multi") continue;
    const opts = q.options || [];
    const stats = opts.map((o) => {
      const has = rows.filter((r) => { const a = r.answers[q.id]; return Array.isArray(a) ? a.includes(o.value) : a === o.value; });
      const wins = has.filter((r) => r.won).length;
      const sm = smoothedRate(wins, has.length, base, k);
      return { question: q.id, title: q.title, value: o.value, label: o.label, n: has.length, wins, rate: has.length ? round4(wins / has.length) : null, smoothed: round4(sm), lift: base > 0 ? Math.round((sm / base) * 100) / 100 : null, points: o.points, suggested: o.points };
    });
    const maxPts = Math.max(0, ...opts.map((o) => o.points));
    const lo = Math.min(...stats.map((s) => s.smoothed)), hi = Math.max(...stats.map((s) => s.smoothed));
    if (maxPts > 0 && hi > lo) for (const s of stats) s.suggested = Math.round((maxPts * (s.smoothed - lo)) / (hi - lo));
    out.push(...stats);
  }
  return out;
}

export interface TierEconomics { tier: string; booked: number; showed: number; no_show: number; won: number; revenue: number; show_rate: number | null; close_rate: number | null; per_booked_call: number | null }

export function tierEconomics(rows: TrainRow[]): TierEconomics[] {
  return ["A", "B", "C"].map((t) => {
    const b = rows.filter((r) => r.tier === t && r.booked);
    const showed = b.filter((r) => r.showed).length, noShow = b.filter((r) => r.status === "no_show").length;
    const won = b.filter((r) => r.won);
    const revenue = won.reduce((s, r) => s + r.revenue, 0);
    return {
      tier: t, booked: b.length, showed, no_show: noShow, won: won.length, revenue,
      show_rate: showed + noShow ? round4(showed / (showed + noShow)) : null,
      close_rate: showed ? round4(won.length / showed) : null,
      per_booked_call: b.length ? Math.round(revenue / b.length) : null,
    };
  });
}

export interface WinModelReport {
  features: string[]; weights: number[]; bias: number;
  base_rate: number; auc_kind: "holdout" | "in-sample"; n_test: number;
  reliability: ReliabilityBin[]; options: OptionStat[]; tiers: TierEconomics[];
}

/** Pure: fit and evaluate. Returns null when there is not enough data. */
export function trainWinModel(rows: TrainRow[]): { report: WinModelReport; auc: number | null; brier: number | null } | null {
  const wins = rows.filter((r) => r.won).length;
  if (rows.length < MIN_TRAIN || wins < MIN_CLASS || rows.length - wins < MIN_CLASS) return null;
  const space = featureSpace();
  const toSample = (r: TrainRow): Sample => ({ x: encode(space, r.answers, r.watched, r.flags), y: r.won ? 1 : 0 });
  const test = rows.filter((r) => isHoldout(r.id));
  const train = rows.filter((r) => !isHoldout(r.id));
  const testOk = test.length >= 15 && test.some((r) => r.won) && test.some((r) => !r.won) && train.filter((r) => r.won).length >= MIN_CLASS;
  let a: number | null = null;
  let kind: "holdout" | "in-sample" = "in-sample";
  if (testOk) {
    const m0 = fitLogistic(space, train.map(toSample), { l2: 2 });
    const s = test.map(toSample);
    a = auc(s.map((d) => predict(m0, d.x)), s.map((d) => d.y));
    kind = "holdout";
  }
  const all = rows.map(toSample);
  const m = fitLogistic(space, all, { l2: 2 });
  const probs = all.map((d) => predict(m, d.x));
  const labels = all.map((d) => d.y);
  if (a == null) a = auc(probs, labels);
  return {
    auc: a == null ? null : round4(a),
    brier: (() => { const b = brier(probs, labels); return b == null ? null : round4(b); })(),
    report: {
      features: m.features, weights: m.weights, bias: m.bias, base_rate: round4(wins / rows.length), auc_kind: kind, n_test: testOk ? test.length : 0,
      reliability: reliability(probs, labels, 10), options: optionStats(rows), tiers: tierEconomics(rows),
    },
  };
}

function parseJson(s: unknown): Record<string, unknown> {
  try { const v = JSON.parse(String(s || "{}")); return v && typeof v === "object" && !Array.isArray(v) ? v : {}; } catch { return {}; }
}

async function loadRows(rt: Runtime, statuses: string[], since: number, limit: number): Promise<TrainRow[]> {
  const res = await rt.env.DB.prepare(
    `SELECT l.id, l.answers, l.qual_flags, COALESCE(l.tier_override, l.tier) AS tier, l.status, l.revenue, l.booked_at, l.showed_at,
       (SELECT v.buckets FROM vsl_views v WHERE v.video = 'main' AND (v.lead_id = l.id OR v.visitor_id = l.visitor_id) ORDER BY v.last_at DESC LIMIT 1) AS buckets
     FROM leads l WHERE l.booking_source = 'funnel' AND l.id NOT IN (SELECT lead_id FROM lead_revops WHERE is_test = 1) AND l.app_completed_at IS NOT NULL AND l.status IN (${statuses.map(() => "?").join(",")}) AND l.updated_at >= ?
     ORDER BY l.updated_at DESC LIMIT ${limit}`,
  ).bind(...statuses, since).all<Record<string, unknown>>();
  return (res.results || []).map((r) => ({
    id: String(r.id), answers: parseJson(r.answers), watched: r.buckets ? popcount(String(r.buckets)) : null,
    flags: String(r.qual_flags || "").split(",").filter(Boolean), tier: (r.tier as string) || null, status: String(r.status),
    won: r.status === "won", revenue: Number(r.revenue) || 0, booked: r.booked_at != null, showed: r.showed_at != null || r.status === "won",
  }));
}

export async function activeWinModel(rt: Runtime): Promise<{ id: string; model: LogisticModel } | null> {
  const r = await rt.env.DB.prepare("SELECT id, weights FROM scoring_models WHERE kind = 'win' AND active = 1 ORDER BY created_at DESC LIMIT 1").first<{ id: string; weights: string }>().catch(() => null);
  if (!r) return null;
  try {
    const w = JSON.parse(r.weights) as WinModelReport;
    return { id: r.id, model: { features: w.features, weights: w.weights, bias: w.bias } };
  } catch {
    return null;
  }
}

/** p_win for open leads with a completed application, from the active model. */
export async function scoreOpenLeads(rt: Runtime): Promise<number> {
  const active = await activeWinModel(rt);
  if (!active) return 0;
  const rows = await loadRows(rt, OPEN, rt.now() - 365 * DAY, 5000);
  const space = active.model.features;
  const stmt = rt.env.DB.prepare(
    `INSERT INTO lead_revops (lead_id, p_win, updated_at) VALUES (?,?,?)
     ON CONFLICT(lead_id) DO UPDATE SET p_win = excluded.p_win, updated_at = excluded.updated_at`,
  );
  const now = rt.now();
  const vals = rows.map((r) => stmt.bind(r.id, round4(predict(active.model, encode(space, r.answers, r.watched, r.flags))), now));
  for (let i = 0; i < vals.length; i += 50) await rt.env.DB.batch(vals.slice(i, i + 50));
  return rows.length;
}

/** Nightly (and the Recompute button): win model, p_win, no-show model, stage values. */
export async function runCalibration(rt: Runtime, force = false) {
  if (!force && !(await kvGate(rt.env, "gate:calibration", 23 * 3600_000, rt.now()))) return null;
  const rows = await loadRows(rt, TERMINAL, rt.now() - 365 * DAY, 20000);
  const fit = trainWinModel(rows);
  let modelId: string | null = null, activated = false;
  if (fit) {
    modelId = newId("sm");
    const cur = await rt.env.DB.prepare("SELECT auc FROM scoring_models WHERE kind = 'win' AND active = 1 ORDER BY created_at DESC LIMIT 1").first<{ auc: number | null }>();
    // A new model replaces the active one unless it is clearly worse.
    activated = !cur || fit.auc == null || cur.auc == null || fit.auc >= cur.auc - 0.02;
    const stmts = [];
    if (activated) stmts.push(rt.env.DB.prepare("UPDATE scoring_models SET active = 0 WHERE kind = 'win'"));
    stmts.push(rt.env.DB.prepare("INSERT INTO scoring_models (id, created_at, kind, n_train, auc, brier, weights, active) VALUES (?,?,?,?,?,?,?,?)")
      .bind(modelId, rt.now(), "win", rows.length, fit.auc, fit.brier, JSON.stringify(fit.report), activated ? 1 : 0));
    await rt.env.DB.batch(stmts);
  }
  const scored = await scoreOpenLeads(rt);
  const noshow = await fitNoShowModel(rt).catch(() => ({ fitted: false, n: 0, auc: null }));
  const values = await recomputeStageValues(rt);
  return { n: rows.length, model_id: modelId, activated, auc: fit?.auc ?? null, scored, noshow, stage_values: values.ok };
}

export async function activateModel(rt: Runtime, id: string): Promise<boolean> {
  const exists = await rt.env.DB.prepare("SELECT 1 AS x FROM scoring_models WHERE id = ? AND kind = 'win'").bind(id).first();
  if (!exists) return false;
  await rt.env.DB.batch([
    rt.env.DB.prepare("UPDATE scoring_models SET active = 0 WHERE kind = 'win'"),
    rt.env.DB.prepare("UPDATE scoring_models SET active = 1 WHERE id = ?").bind(id),
  ]);
  await scoreOpenLeads(rt);
  return true;
}

// ── Learned points for routing (opt-in) ─────────────────────────────────────

/** Pure: the learned table from a model report — suggested points for options with n ≥ 20 only. */
export function learnedFromReport(report: Pick<WinModelReport, "options">, modelId: string): LearnedPoints | null {
  const points: Record<string, number> = {}, n: Record<string, number> = {};
  for (const o of report.options || []) {
    if (o.n < LEARNED_MIN_N) continue;
    points[`${o.question}=${o.value}`] = o.suggested;
    n[`${o.question}=${o.value}`] = o.n;
  }
  return Object.keys(points).length ? { version: `learned:${modelId}`, points, n } : null;
}

/** Owner switch. On: pins the active model's table (it does not follow later models until switched again). */
export async function setLearnedRouting(rt: Runtime, on: boolean): Promise<{ ok: boolean; error?: string; version?: string; options?: number }> {
  if (rt.settings.source("LEARNED_ROUTING") === "env" || rt.settings.source("LEARNED_POINTS") === "env") return { ok: false, error: "Learned routing is set as an environment variable." };
  if (!on) {
    await saveSetting(rt.env, "LEARNED_ROUTING", "false");
    return { ok: true };
  }
  const r = await rt.env.DB.prepare("SELECT id, weights FROM scoring_models WHERE kind = 'win' AND active = 1 ORDER BY created_at DESC LIMIT 1").first<{ id: string; weights: string }>();
  if (!r) return { ok: false, error: "Train a scoring model first (Recompute now)." };
  let report: WinModelReport;
  try { report = JSON.parse(r.weights) as WinModelReport; } catch { return { ok: false, error: "The active model could not be read." }; }
  const table = learnedFromReport(report, r.id);
  if (!table) return { ok: false, error: `No answer option has ${LEARNED_MIN_N} or more outcomes yet.` };
  await saveSetting(rt.env, "LEARNED_POINTS", JSON.stringify(table));
  await saveSetting(rt.env, "LEARNED_ROUTING", "true");
  return { ok: true, version: table.version, options: Object.keys(table.points).length };
}

/** Report for the Insights → Scoring view. */
export async function calibrationReport(rt: Runtime) {
  const models = ((await rt.env.DB.prepare("SELECT id, created_at, kind, n_train, auc, brier, active, weights FROM scoring_models ORDER BY created_at DESC LIMIT 20").all<Record<string, unknown>>()).results) || [];
  const win = models.filter((m) => m.kind === "win");
  const latest = win[0];
  const active = win.find((m) => Number(m.active));
  const show = active || latest;
  let report: WinModelReport | null = null;
  try { report = show ? (JSON.parse(String(show.weights)) as WinModelReport) : null; } catch { report = null; }
  const terminal = await rt.env.DB.prepare(
    `SELECT COUNT(*) AS n, SUM(status = 'won') AS won FROM leads WHERE booking_source = 'funnel' AND id NOT IN (SELECT lead_id FROM lead_revops WHERE is_test = 1) AND app_completed_at IS NOT NULL AND status IN ('won','lost','no_show','disqualified') AND updated_at >= ?`,
  ).bind(rt.now() - 365 * DAY).first<{ n: number; won: number }>();
  const pw = await rt.env.DB.prepare("SELECT COUNT(*) AS n, AVG(p_win) AS avg FROM lead_revops WHERE p_win IS NOT NULL").first<{ n: number; avg: number | null }>();
  return {
    min_train: MIN_TRAIN, n_terminal: Number(terminal?.n) || 0, n_won: Number(terminal?.won) || 0,
    avg_deal: ECONOMICS.avgDeal,
    model: show ? { id: String(show.id), created_at: Number(show.created_at), n_train: Number(show.n_train), auc: show.auc == null ? null : Number(show.auc), brier: show.brier == null ? null : Number(show.brier), active: !!Number(show.active) } : null,
    newer_inactive: latest && active && latest.id !== active.id ? { id: String(latest.id), auc: latest.auc == null ? null : Number(latest.auc), created_at: Number(latest.created_at) } : null,
    report: report ? { base_rate: report.base_rate, auc_kind: report.auc_kind, n_test: report.n_test, reliability: report.reliability, options: report.options, tiers: report.tiers } : null,
    top_weights: report ? report.features.map((f, i) => ({ feature: f, weight: report!.weights[i] })).sort((a, b) => Math.abs(b.weight) - Math.abs(a.weight)).slice(0, 12) : [],
    p_win: { n: Number(pw?.n) || 0, avg: pw?.avg == null ? null : round4(Number(pw.avg)) },
    learned: (() => {
      const table = parseLearnedPoints(rt.settings.get("LEARNED_POINTS"));
      const available = report ? (report.options || []).filter((o) => o.n >= LEARNED_MIN_N).length : 0;
      return {
        on: rt.settings.bool("LEARNED_ROUTING") && !!table, version: table?.version || null, options: table ? Object.keys(table.points).length : 0,
        points: table ? Object.entries(table.points).map(([k, v]) => ({ key: k, points: v, n: Number(table.n?.[k]) || null })) : [],
        available, min_n: LEARNED_MIN_N, locked: rt.settings.source("LEARNED_ROUTING") === "env",
      };
    })(),
    history: models.map((m) => ({ id: String(m.id), created_at: Number(m.created_at), kind: String(m.kind), n_train: Number(m.n_train), auc: m.auc == null ? null : Number(m.auc), brier: m.brier == null ? null : Number(m.brier), active: !!Number(m.active) })),
  };
}
