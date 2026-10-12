// Insights: everyone who booked (funnel and Calendly-direct), split by tier; A tier unpacked by
// revenue band, spend band, industry and source; Calendly bookings by month.

import type { Runtime } from "../app";
import { APPLICATION } from "../config";
import { getIndustry, inferIndustry } from "../landers/catalog";
import { parseAnswers, type Lead } from "../funnel/leads";
import { all, leadDims, num, pct, type Filters } from "./stats";

const label = (qid: string, v: string | null) => {
  if (!v) return "Unknown";
  return APPLICATION.find((q) => q.id === qid)?.options?.find((o) => o.value === v)?.label || v;
};

function tally<T>(items: T[], key: (t: T) => string) {
  const m = new Map<string, number>();
  for (const it of items) m.set(key(it), (m.get(key(it)) || 0) + 1);
  return [...m.entries()].sort((a, b) => b[1] - a[1]).map(([k, n]) => ({ key: k, n, pct: pct(n, items.length) }));
}

export async function insightsReport(rt: Runtime, f: Filters) {
  const ld = leadDims(f, "l");
  const booked = await all<Lead>(rt,
    `SELECT l.* FROM leads l WHERE (l.booked_at >= ? OR (l.booking_source = 'calendly-direct' AND l.call_at >= ?)
       OR l.id IN (SELECT lead_id FROM calendly_bookings WHERE start_at >= ? AND lead_id IS NOT NULL))${ld.sql} LIMIT 20000`,
    [f.since, f.since, f.since, ...ld.binds]);
  const tierOf = (l: Lead) => (l.tier_override || l.tier || "unscored") as string;
  const tiers = ["A", "B", "C", "unscored"].map((t) => {
    const ls = booked.filter((l) => tierOf(l) === t);
    const showed = ls.filter((l) => l.showed_at || ["showed", "won", "lost"].includes(l.status)).length;
    const noShow = ls.filter((l) => l.status === "no_show").length;
    const won = ls.filter((l) => l.status === "won");
    return {
      tier: t, booked: ls.length, funnel: ls.filter((l) => l.booking_source === "funnel").length,
      direct: ls.filter((l) => l.booking_source === "calendly-direct").length,
      showed, no_show: noShow, show_rate: pct(showed, showed + noShow), won: won.length, close_rate: pct(won.length, showed),
      revenue: won.reduce((s, l) => s + num(l.revenue), 0), cash: ls.reduce((s, l) => s + num(l.cash_collected), 0),
    };
  });
  const a = booked.filter((l) => tierOf(l) === "A");
  const industryOf = (l: Lead) => {
    const ans = parseAnswers(l);
    const ind = getIndustry(l.industry) || inferIndustry(typeof ans.business === "string" ? ans.business : "", l.ft_campaign, l.utm_content);
    return ind?.label || "Unknown";
  };
  const sourceOf = (l: Lead) => [l.ft_channel || l.channel || "direct", l.ft_source || l.utm_source].filter(Boolean).join(" · ");
  const months = await all<{ m: string; total: number; active: number; canceled: number; no_show: number; matched: number; direct: number }>(rt,
    `SELECT strftime('%Y-%m', b.start_at / 1000, 'unixepoch') AS m, COUNT(*) AS total,
       SUM(b.status = 'active') AS active, SUM(b.status = 'canceled') AS canceled, SUM(b.no_show = 1) AS no_show,
       SUM(l.booking_source = 'funnel') AS matched, SUM(l.booking_source = 'calendly-direct' OR b.lead_id IS NULL) AS direct
     FROM calendly_bookings b LEFT JOIN leads l ON l.id = b.lead_id WHERE b.start_at IS NOT NULL GROUP BY m ORDER BY m DESC LIMIT 36`);
  return {
    total: booked.length,
    tiers,
    a_tier: {
      n: a.length,
      revenue_bands: tally(a, (l) => label("revenue", l.revenue_band)),
      spend_bands: tally(a, (l) => label("spend", l.budget_band)),
      industries: tally(a, industryOf).slice(0, 12),
      sources: tally(a, sourceOf).slice(0, 12),
      willing: tally(a, (l) => l.willing_to_invest || "unknown"),
      qual_source: tally(a, (l) => l.qual_source || "unknown"),
    },
    calendly_months: months.map((m) => ({
      month: m.m, total: num(m.total), active: num(m.active), canceled: num(m.canceled), no_show: num(m.no_show),
      funnel: num(m.matched), direct: num(m.direct),
    })),
  };
}
