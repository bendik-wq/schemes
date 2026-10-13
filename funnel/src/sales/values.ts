// Conversion values for ad platforms. The fixed TIER_VALUE constants are replaced, once there is
// enough history, by P(won | stage, tier) × average deal, computed from leads with a terminal outcome
// in the last 365 days and stored in the STAGE_VALUES setting (Recompute on the Tracking tab, nightly).

import type { Runtime } from "../app";
import { ECONOMICS, TIER_VALUE, type Tier } from "../config";
import { saveSetting, type Settings } from "../settings";

const num = (v: unknown): number => (Number.isFinite(Number(v)) ? Number(v) : 0);

const DAY = 86_400_000;
export const VALUE_STAGES = ["lead_qualified", "booking_scheduled", "call_showed"] as const;
export type ValueStage = (typeof VALUE_STAGES)[number];
export const STAGE_LABELS: Record<ValueStage, string> = { lead_qualified: "Applied (QualifiedLead)", booking_scheduled: "Booked (Schedule)", call_showed: "Showed (CallShowed)" };
const TIERS: Tier[] = ["A", "B", "C"];
/** Cells with fewer terminal outcomes than this keep the fixed value. */
export const MIN_CELL = 20;

export interface StageValues {
  computed_at: number;
  avg_deal: number;
  n_total: number;
  cells: Record<string, Record<string, { n: number; won: number; p: number | null; value: number | null }>>;
}

export interface OutcomeFact {
  tier: string | null;
  qualified: boolean;
  booked: boolean;
  showed: boolean;
  won: boolean;
  revenue: number;
}

/** Pure: per stage × tier win probability and value. Cells below `minN` get value null (use fallback). */
export function computeStageValues(facts: OutcomeFact[], fallbackDeal: number, now: number, minN = MIN_CELL): StageValues {
  const wins = facts.filter((f) => f.won && f.revenue > 0);
  const avgDeal = wins.length >= 3 ? Math.round(wins.reduce((s, f) => s + f.revenue, 0) / wins.length) : fallbackDeal;
  const cells: StageValues["cells"] = {};
  for (const st of VALUE_STAGES) {
    cells[st] = {};
    for (const t of TIERS) {
      const pool = facts.filter((f) => f.tier === t && (st === "lead_qualified" ? f.qualified : st === "booking_scheduled" ? f.booked : f.showed));
      const won = pool.filter((f) => f.won).length;
      const p = pool.length ? won / pool.length : null;
      cells[st][t] = { n: pool.length, won, p: p == null ? null : Math.round(p * 10000) / 10000, value: pool.length >= minN && p != null ? Math.round(p * avgDeal) : null };
    }
  }
  return { computed_at: now, avg_deal: avgDeal, n_total: facts.length, cells };
}

export function parseStageValues(raw: string | null | undefined): StageValues | null {
  if (!raw) return null;
  try {
    const v = JSON.parse(raw) as StageValues;
    if (!v || typeof v !== "object" || !v.cells || typeof v.cells !== "object") return null;
    return v;
  } catch {
    return null;
  }
}

/** The value to send for a stage event: calibrated when that cell has enough data, else `fallback`. */
export function stageValue(sv: StageValues | null, event: string, tier: string | null, fallback: number | undefined): number | undefined {
  if (!sv || !tier) return fallback;
  const v = sv.cells?.[event]?.[tier]?.value;
  return typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : fallback;
}

export function settingsStageValue(s: Settings, event: string, tier: string | null, fallback: number | undefined): number | undefined {
  if (!(VALUE_STAGES as readonly string[]).includes(event)) return fallback;
  return stageValue(parseStageValues(s.get("STAGE_VALUES")), event, tier, fallback);
}

export async function outcomeFacts(rt: Runtime): Promise<OutcomeFact[]> {
  const rows = ((await rt.env.DB.prepare(
    `SELECT COALESCE(tier_override, tier) AS tier, app_completed_at IS NOT NULL AS qualified, booked_at IS NOT NULL AS booked,
       (showed_at IS NOT NULL OR status = 'won') AS showed, status = 'won' AS won, revenue
     FROM leads WHERE booking_source = 'funnel' AND id NOT IN (SELECT lead_id FROM lead_revops WHERE is_test = 1) AND status IN ('won','lost','no_show','disqualified') AND updated_at >= ? LIMIT 50000`,
  ).bind(rt.now() - 365 * DAY).all<Record<string, unknown>>()).results || []);
  return rows.map((r) => ({ tier: (r.tier as string) || null, qualified: !!num(r.qualified), booked: !!num(r.booked), showed: !!num(r.showed), won: !!num(r.won), revenue: num(r.revenue) }));
}

/** Recompute and store. Returns the table, or an error when the setting is locked by an env var. */
export async function recomputeStageValues(rt: Runtime): Promise<{ ok: boolean; values: StageValues; error?: string }> {
  const values = computeStageValues(await outcomeFacts(rt), ECONOMICS.avgDeal, rt.now());
  if (rt.settings.source("STAGE_VALUES") === "env") return { ok: false, values, error: "STAGE_VALUES is set as an environment variable." };
  await saveSetting(rt.env, "STAGE_VALUES", JSON.stringify(values));
  return { ok: true, values };
}

/** Table for the dashboard: calibrated vs fixed, per stage and tier. */
export function stageValueTable(sv: StageValues | null) {
  return VALUE_STAGES.map((st) => ({
    stage: st, label: STAGE_LABELS[st],
    tiers: TIERS.map((t) => {
      const c = sv?.cells?.[st]?.[t];
      const fixed = st === "call_showed" ? null : TIER_VALUE[t];
      return { tier: t, n: c?.n ?? 0, p: c?.p ?? null, calibrated: c?.value ?? null, fixed, used: c?.value ?? fixed };
    }),
  }));
}
