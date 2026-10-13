// Landing pages and tests: the main-page headline A/B test (two-proportion z-test) and the 100
// industry landers (20 industries × 5 angles) with the bandit's current traffic share.

import type { Runtime } from "../app";
import { HEADLINES } from "../config";
import { ANGLES, INDUSTRIES, allLanders } from "../landers/catalog";
import { MIN_VISITORS, QUALIFIED_SWITCH, trafficShare, type ArmStats } from "../landers/bandit";
import { all, num, pct, sessDims, type Filters } from "./stats";

/** Standard normal CDF (Abramowitz–Stegun 7.1.26 erf approximation, |error| < 1.5e-7). */
export function normCdf(z: number): number {
  const x = Math.abs(z) / Math.SQRT2;
  const t = 1 / (1 + 0.3275911 * x);
  const y = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x);
  return z >= 0 ? 0.5 * (1 + y) : 0.5 * (1 - y);
}

/** Two-sided two-proportion z-test with a pooled standard error. */
export function twoProportionZ(x1: number, n1: number, x2: number, n2: number): { z: number | null; p: number | null } {
  if (n1 <= 0 || n2 <= 0) return { z: null, p: null };
  const p1 = x1 / n1, p2 = x2 / n2, pool = (x1 + x2) / (n1 + n2);
  const se = Math.sqrt(pool * (1 - pool) * (1 / n1 + 1 / n2));
  if (!se) return { z: null, p: null };
  const z = (p1 - p2) / se;
  return { z: Math.round(z * 1000) / 1000, p: Math.round(2 * (1 - normCdf(Math.abs(z))) * 10000) / 10000 };
}

export async function experiment(rt: Runtime, f: Filters) {
  // Visitors who really saw the main page (non-bot page_view on "/"), never lander traffic.
  const pv = `SELECT DISTINCT e.visitor_id FROM events e WHERE e.name = 'page_view' AND e.path = '/' AND e.is_bot = 0 AND e.ts >= ? AND e.visitor_id IS NOT NULL`;
  const [vis, leads] = await Promise.all([
    all<{ v: string | null; n: number }>(rt,
      `SELECT e.variant AS v, COUNT(DISTINCT e.visitor_id) AS n FROM events e WHERE e.name = 'page_view' AND e.path = '/' AND e.is_bot = 0 AND e.ts >= ? GROUP BY e.variant`, [f.since]),
    all<{ v: string | null; leads: number; applied: number; qualified: number; booked: number }>(rt,
      `SELECT l.variant AS v, COUNT(*) AS leads, SUM(l.app_completed_at IS NOT NULL) AS applied,
         SUM(l.app_completed_at IS NOT NULL AND COALESCE(l.tier_override, l.tier) IN ('A','B')) AS qualified, SUM(l.booked_at IS NOT NULL) AS booked
       FROM leads l WHERE l.ft_lander IS NULL AND l.booking_source = 'funnel' AND l.id NOT IN (SELECT lead_id FROM lead_revops WHERE is_test = 1) AND l.created_at >= ? AND l.visitor_id IN (${pv}) GROUP BY l.variant`, [f.since, f.since]),
  ]);
  const variants = HEADLINES.map((h) => {
    const v = vis.find((x) => x.v === h.id), l = leads.find((x) => x.v === h.id);
    const visitors = num(v?.n), applied = num(l?.applied);
    return {
      id: h.id, headline: `${h.h1} ${h.h1b}`, visitors, leads: num(l?.leads), applications: applied, qualified: num(l?.qualified), booked: num(l?.booked),
      rate: pct(applied, visitors), qualified_rate: pct(num(l?.qualified), visitors),
    };
  });
  const [a, b] = variants;
  const test = a && b ? twoProportionZ(a.applications, a.visitors, b.applications, b.visitors) : { z: null, p: null };
  const enough = !!(a && b && a.visitors >= 100 && b.visitors >= 100 && a.applications + b.applications >= 20);
  let leader: string | null = null;
  if (a && b && a.rate != null && b.rate != null && a.rate !== b.rate) leader = a.rate > b.rate ? a.id : b.id;
  return {
    variants, z: test.z, p: test.p, significant: enough && test.p != null && test.p < 0.05, enough_data: enough, leader,
    note: enough ? (test.p != null && test.p < 0.05 ? "The difference is unlikely to be chance (p < 0.05)." : "No reliable difference yet.") : "Needs at least 100 visitors per variant and 20 applications before the test means anything.",
  };
}

export async function landersReport(rt: Runtime, f: Filters) {
  const sd = sessDims(f, "s");
  const [vis, plays, leads, armVis, armLeads] = await Promise.all([
    all<{ k: string; n: number }>(rt, `SELECT s.lander AS k, COUNT(DISTINCT s.visitor_id) AS n FROM sessions s WHERE s.lander IS NOT NULL AND s.is_bot = 0 AND s.started_at >= ?${sd.sql} GROUP BY s.lander`, [f.since, ...sd.binds]),
    all<{ k: string; n: number }>(rt,
      `SELECT x.k, COUNT(*) AS n FROM (SELECT DISTINCT s.lander AS k, s.visitor_id AS vid FROM sessions s WHERE s.lander IS NOT NULL AND s.is_bot = 0 AND s.started_at >= ?${sd.sql}) x
       JOIN vsl_views v ON v.visitor_id = x.vid AND v.video = 'main' AND v.played = 1 GROUP BY x.k`, [f.since, ...sd.binds]),
    all<{ k: string; leads: number; qualified: number; a: number; booked: number; won: number; revenue: number; cash: number }>(rt,
      `SELECT l.ft_lander AS k, COUNT(*) AS leads,
         SUM(l.app_completed_at IS NOT NULL AND COALESCE(l.tier_override, l.tier) IN ('A','B')) AS qualified,
         SUM(l.app_completed_at IS NOT NULL AND COALESCE(l.tier_override, l.tier) = 'A') AS a,
         SUM(l.booked_at IS NOT NULL) AS booked, SUM(l.status = 'won') AS won,
         SUM(CASE WHEN l.status = 'won' THEN l.revenue ELSE 0 END) AS revenue, SUM(l.cash_collected) AS cash
       FROM leads l WHERE l.ft_lander IS NOT NULL AND l.id NOT IN (SELECT lead_id FROM lead_revops WHERE is_test = 1) AND l.created_at >= ? GROUP BY l.ft_lander`, [f.since]),
    // Bandit inputs are all-time, exactly like armStats() in landers/bandit.ts.
    all<{ k: string; n: number }>(rt, "SELECT lander AS k, COUNT(DISTINCT visitor_id) AS n FROM sessions WHERE lander IS NOT NULL AND is_bot = 0 GROUP BY lander"),
    all<{ k: string; n: number; q: number }>(rt,
      "SELECT ft_lander AS k, COUNT(*) AS n, SUM(app_completed_at IS NOT NULL AND COALESCE(tier_override, tier) IN ('A','B')) AS q FROM leads WHERE ft_lander IS NOT NULL GROUP BY ft_lander"),
  ]);
  const V = new Map(vis.map((r) => [r.k, num(r.n)]));
  const P = new Map(plays.map((r) => [r.k, num(r.n)]));
  const L = new Map(leads.map((r) => [r.k, r]));
  const AV = new Map(armVis.map((r) => [r.k, num(r.n)]));
  const AL = new Map(armLeads.map((r) => [r.k, r]));
  const share: Record<string, Record<string, number>> = {};
  const explored: Record<string, boolean> = {};
  for (const ind of INDUSTRIES) {
    const stats: ArmStats[] = ANGLES.map((a) => {
      const k = `${ind.id}/${a.id}`;
      return { angle: a.id, visitors: AV.get(k) || 0, leads: num(AL.get(k)?.n), qualified: num(AL.get(k)?.q) };
    });
    share[ind.id] = trafficShare(stats, 1000);
    explored[ind.id] = stats.every((s) => s.visitors >= MIN_VISITORS);
  }
  const landers = allLanders().map(({ industry, angle, key, headline }) => {
    const l = L.get(key);
    const visitors = V.get(key) || 0;
    return {
      key, industry: industry.id, industry_label: industry.label, angle: angle.id, angle_label: angle.label, headline,
      visitors, plays: P.get(key) || 0, leads: num(l?.leads), qualified: num(l?.qualified), a_tier: num(l?.a), booked: num(l?.booked),
      won: num(l?.won), revenue: num(l?.revenue), cash: num(l?.cash), lead_rate: pct(num(l?.leads), visitors),
      share: Math.round((share[industry.id]?.[angle.id] || 0) * 1000) / 10,
      all_time_visitors: AV.get(key) || 0,
      preview_url: `/for/${industry.id}/${angle.id}?preview=1`,
    };
  });
  const sumBy = (rows: typeof landers) => rows.reduce((t, r) => ({
    visitors: t.visitors + r.visitors, plays: t.plays + r.plays, leads: t.leads + r.leads, qualified: t.qualified + r.qualified,
    a_tier: t.a_tier + r.a_tier, booked: t.booked + r.booked, won: t.won + r.won, revenue: t.revenue + r.revenue, cash: t.cash + r.cash,
  }), { visitors: 0, plays: 0, leads: 0, qualified: 0, a_tier: 0, booked: 0, won: 0, revenue: 0, cash: 0 });
  const industries = INDUSTRIES.map((ind) => {
    const rows = landers.filter((r) => r.industry === ind.id);
    const t = sumBy(rows);
    const best = [...rows].sort((a, b) => b.share - a.share)[0];
    return {
      id: ind.id, label: ind.label, ...t, lead_rate: pct(t.leads, t.visitors), explored: explored[ind.id], leader: best?.share ? best.angle : null,
      ad_urls: { lander: `/for/${ind.id}`, smart: `/m?ind=${ind.id}` },
    };
  });
  const angles = ANGLES.map((a) => {
    const t = sumBy(landers.filter((r) => r.angle === a.id));
    return { id: a.id, label: a.label, ...t, lead_rate: pct(t.leads, t.visitors), qualified_rate: pct(t.qualified, t.visitors) };
  });
  return {
    experiment: await experiment(rt, f),
    landers, industries, angles,
    bandit: { min_visitors: MIN_VISITORS, qualified_switch: QUALIFIED_SWITCH },
  };
}
