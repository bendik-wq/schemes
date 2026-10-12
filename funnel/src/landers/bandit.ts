// Thompson sampling over the 5 angles of each industry. Every angle gets MIN_VISITORS before
// sampling starts. Reward = leads per visitor, switching to qualified (A/B) applications once
// the industry has QUALIFIED_SWITCH of them.

import type { Runtime } from "../app";
import { ANGLES } from "./catalog";

export const MIN_VISITORS = 60;
export const QUALIFIED_SWITCH = 30;

export interface ArmStats { angle: string; visitors: number; leads: number; qualified: number; }

/** Gamma(k, 1) sampler (Marsaglia–Tsang), k > 0. */
function gamma(k: number, rnd: () => number): number {
  if (k < 1) return gamma(k + 1, rnd) * Math.pow(rnd(), 1 / k);
  const d = k - 1 / 3, c = 1 / Math.sqrt(9 * d);
  for (;;) {
    let x: number, v: number;
    do {
      const u1 = rnd() || 1e-12, u2 = rnd();
      x = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
      v = 1 + c * x;
    } while (v <= 0);
    v = v * v * v;
    const u = rnd();
    if (u < 1 - 0.0331 * x ** 4 || Math.log(u) < 0.5 * x * x + d * (1 - v + Math.log(v))) return d * v;
  }
}

export function betaSample(a: number, b: number, rnd: () => number = Math.random): number {
  const x = gamma(a, rnd), y = gamma(b, rnd);
  return x / (x + y);
}

/** Pure: pick an angle. Under-explored arms (below the floor) are served first, least-seen first. */
export function chooseAngle(stats: ArmStats[], rnd: () => number = Math.random): string {
  const arms = ANGLES.map((a) => stats.find((s) => s.angle === a.id) || { angle: a.id, visitors: 0, leads: 0, qualified: 0 });
  const under = arms.filter((a) => a.visitors < MIN_VISITORS);
  if (under.length) {
    const min = Math.min(...under.map((a) => a.visitors));
    const pool = under.filter((a) => a.visitors === min);
    return pool[Math.floor(rnd() * pool.length)].angle;
  }
  const useQualified = arms.reduce((s, a) => s + a.qualified, 0) >= QUALIFIED_SWITCH;
  let best = arms[0].angle, bestV = -1;
  for (const a of arms) {
    const wins = useQualified ? a.qualified : a.leads;
    const v = betaSample(1 + wins, 1 + Math.max(0, a.visitors - wins), rnd);
    if (v > bestV) { bestV = v; best = a.angle; }
  }
  return best;
}

/** Expected share of traffic per angle (Monte Carlo), for the dashboard. */
export function trafficShare(stats: ArmStats[], draws = 2000, rnd: () => number = Math.random): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const a of ANGLES) counts[a.id] = 0;
  for (let i = 0; i < draws; i++) counts[chooseAngle(stats, rnd)]++;
  for (const k of Object.keys(counts)) counts[k] = counts[k] / draws;
  return counts;
}

export async function armStats(rt: Runtime, industry: string): Promise<ArmStats[]> {
  const vis = (await rt.env.DB.prepare(
    `SELECT lander, COUNT(DISTINCT visitor_id) AS n FROM sessions WHERE lander LIKE ? AND is_bot = 0 GROUP BY lander`,
  ).bind(`${industry}/%`).all<{ lander: string; n: number }>()).results || [];
  const leads = (await rt.env.DB.prepare(
    `SELECT ft_lander AS lander, COUNT(*) AS n, SUM(app_completed_at IS NOT NULL AND COALESCE(tier_override, tier) IN ('A','B')) AS q
     FROM leads WHERE ft_lander LIKE ? GROUP BY ft_lander`,
  ).bind(`${industry}/%`).all<{ lander: string; n: number; q: number }>()).results || [];
  return ANGLES.map((a) => {
    const key = `${industry}/${a.id}`;
    return { angle: a.id, visitors: vis.find((v) => v.lander === key)?.n || 0, leads: leads.find((l) => l.lander === key)?.n || 0, qualified: leads.find((l) => l.lander === key)?.q || 0 };
  });
}
