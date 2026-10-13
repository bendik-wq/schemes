// Spend, CAC and ROAS by campaign, ad set and ad. Spend comes from ad_spend; outcomes are credited to
// the ad a lead first arrived from (lead_revops.ft_ad_id), or to a campaign by name when the import
// has no ad ids. Every count is "happened in the period" so it lines up with the Overview numbers.

import type { Runtime } from "../app";
import { dayKey, type SpendRow } from "../integrations/meta-ads";
import { kvGet } from "../lib/kv";
import { all, num, salesTz, type Filters } from "./stats";

export const SPEND_LEVELS = ["campaign", "adset", "ad"] as const;
export type SpendLevel = (typeof SPEND_LEVELS)[number];

export interface LeadFact {
  ad_id: string | null;
  campaign: string | null;
  lead: number; applied: number; qualified: number; booked: number; showed: number; won: number;
  revenue: number; cash: number;
}

export interface SpendAgg {
  key: string; name: string; platform: string; parent: string | null;
  spend: number; impressions: number; clicks: number; link_clicks: number; sessions: number;
  leads: number; applied: number; qualified: number; booked: number; showed: number; won: number; revenue: number; cash: number;
  cpl: number | null; cost_per_app: number | null; cost_per_qualified: number | null; cost_per_booked: number | null; cost_per_show: number | null;
  cac: number | null; cash_roas: number | null; revenue_roas: number | null; ctr: number | null;
  zero_sessions: boolean;
}

const div = (a: number, b: number): number | null => (b > 0 ? Math.round((a / b) * 100) / 100 : null);

function levelKey(r: SpendRow, level: SpendLevel): { key: string; name: string; parent: string | null } {
  if (level === "ad") return { key: r.ad_id, name: r.ad_name || r.ad_id, parent: r.adset_name || r.campaign_name };
  if (level === "adset") {
    const key = r.adset_id || `adset:${r.adset_name || "(none)"}`;
    return { key, name: r.adset_name || r.adset_id || "(no ad set)", parent: r.campaign_name };
  }
  const key = r.campaign_id || `campaign:${(r.campaign_name || "(none)").toLowerCase()}`;
  return { key, name: r.campaign_name || r.campaign_id || "(no campaign)", parent: null };
}

/**
 * Join spend to sessions and lead outcomes at one level. Pure.
 * Leads are credited through their first ad id; at campaign level, leads without a known ad id are
 * matched by campaign name (utm_campaign) as a fallback.
 */
export function aggregateSpend(spend: SpendRow[], sessionsByAd: Map<string, number>, leads: LeadFact[], level: SpendLevel): SpendAgg[] {
  const rows = new Map<string, SpendAgg>();
  const adToKey = new Map<string, string>();
  const campaignNameToKey = new Map<string, string>();
  const adsInRow = new Map<string, Set<string>>();
  for (const r of spend) {
    const k = levelKey(r, level);
    let row = rows.get(k.key);
    if (!row) {
      row = {
        key: k.key, name: k.name, platform: r.platform, parent: k.parent,
        spend: 0, impressions: 0, clicks: 0, link_clicks: 0, sessions: 0,
        leads: 0, applied: 0, qualified: 0, booked: 0, showed: 0, won: 0, revenue: 0, cash: 0,
        cpl: null, cost_per_app: null, cost_per_qualified: null, cost_per_booked: null, cost_per_show: null, cac: null, cash_roas: null, revenue_roas: null, ctr: null,
        zero_sessions: false,
      };
      rows.set(k.key, row);
    }
    row.spend += r.spend; row.impressions += r.impressions; row.clicks += r.clicks; row.link_clicks += r.link_clicks;
    adToKey.set(r.ad_id, k.key);
    if (level === "campaign" && r.campaign_name) campaignNameToKey.set(r.campaign_name.trim().toLowerCase(), k.key);
    if (!adsInRow.has(k.key)) adsInRow.set(k.key, new Set());
    adsInRow.get(k.key)!.add(r.ad_id);
  }
  for (const [key, ads] of adsInRow) {
    const row = rows.get(key)!;
    for (const a of ads) row.sessions += sessionsByAd.get(a) || 0;
  }
  for (const l of leads) {
    let key = l.ad_id ? adToKey.get(l.ad_id) : undefined;
    if (!key && level === "campaign" && l.campaign) key = campaignNameToKey.get(l.campaign.trim().toLowerCase());
    const row = key ? rows.get(key) : undefined;
    if (!row) continue;
    row.leads += l.lead; row.applied += l.applied; row.qualified += l.qualified; row.booked += l.booked; row.showed += l.showed;
    row.won += l.won; row.revenue += l.revenue; row.cash += l.cash;
  }
  for (const r of rows.values()) {
    r.spend = Math.round(r.spend * 100) / 100;
    r.cpl = div(r.spend, r.leads); r.cost_per_app = div(r.spend, r.applied); r.cost_per_qualified = div(r.spend, r.qualified);
    r.cost_per_booked = div(r.spend, r.booked); r.cost_per_show = div(r.spend, r.showed); r.cac = div(r.spend, r.won);
    r.cash_roas = div(r.cash, r.spend); r.revenue_roas = div(r.revenue, r.spend);
    r.ctr = r.impressions ? Math.round((r.link_clicks / r.impressions) * 10000) / 100 : null;
    r.zero_sessions = r.spend > 0 && r.sessions === 0;
  }
  return [...rows.values()].sort((a, b) => b.spend - a.spend);
}

/** YYYY-MM-DD bounds of a filter window in the sales time zone. */
export function spendDays(rt: Runtime, from: number, to: number): { from: string; to: string } {
  const tz = salesTz(rt);
  return { from: from > 0 ? dayKey(from, tz) : "0000-00-00", to: dayKey(Math.max(from, to - 1), tz) };
}

export async function spendRows(rt: Runtime, from: number, to: number): Promise<SpendRow[]> {
  const d = spendDays(rt, from, to);
  return all<SpendRow>(rt,
    `SELECT platform, date, ad_id, ad_name, adset_id, adset_name, campaign_id, campaign_name, spend, impressions, clicks, link_clicks
     FROM ad_spend WHERE date >= ? AND date <= ? LIMIT 50000`, [d.from, d.to]);
}

async function leadFacts(rt: Runtime, from: number, to: number): Promise<LeadFact[]> {
  const rows = await all<Record<string, unknown>>(rt,
    `SELECT r.ft_ad_id AS ad_id, COALESCE(l.ft_campaign, l.utm_campaign) AS campaign,
       (l.created_at >= ?1 AND l.created_at < ?2) AS lead,
       (l.app_completed_at >= ?1 AND l.app_completed_at < ?2) AS applied,
       (l.app_completed_at >= ?1 AND l.app_completed_at < ?2 AND COALESCE(l.tier_override, l.tier) IN ('A','B')) AS qualified,
       (l.booked_at >= ?1 AND l.booked_at < ?2) AS booked,
       (l.showed_at >= ?1 AND l.showed_at < ?2) AS showed,
       (l.status = 'won' AND l.closed_at >= ?1 AND l.closed_at < ?2) AS won,
       CASE WHEN l.status = 'won' AND l.closed_at >= ?1 AND l.closed_at < ?2 THEN l.revenue ELSE 0 END AS revenue,
       (SELECT COALESCE(SUM(p.amount), 0) FROM payments p WHERE p.lead_id = l.id AND p.paid_at >= ?1 AND p.paid_at < ?2) AS cash
     FROM leads l LEFT JOIN lead_revops r ON r.lead_id = l.id
     WHERE l.booking_source = 'funnel' AND (r.ft_ad_id IS NOT NULL OR COALESCE(l.ft_campaign, l.utm_campaign) IS NOT NULL)
       AND (l.created_at >= ?1 OR l.app_completed_at >= ?1 OR l.booked_at >= ?1 OR l.showed_at >= ?1 OR l.closed_at >= ?1
            OR l.id IN (SELECT lead_id FROM payments WHERE paid_at >= ?1))
     LIMIT 50000`, [from, to]);
  return rows.map((r) => ({
    ad_id: (r.ad_id as string) || null, campaign: (r.campaign as string) || null,
    lead: num(r.lead), applied: num(r.applied), qualified: num(r.qualified), booked: num(r.booked), showed: num(r.showed), won: num(r.won),
    revenue: num(r.revenue), cash: num(r.cash),
  }));
}

async function sessionsByAd(rt: Runtime, from: number, to: number): Promise<Map<string, number>> {
  const rows = await all<{ ad_id: string; n: number }>(rt,
    "SELECT ad_id, COUNT(*) AS n FROM sessions WHERE is_bot = 0 AND started_at >= ? AND started_at < ? AND ad_id IS NOT NULL AND ad_id != '' GROUP BY ad_id", [from, to]);
  return new Map(rows.map((r) => [r.ad_id, num(r.n)]));
}

export async function spendReport(rt: Runtime, f: Filters, levelParam: string | undefined) {
  const level = (SPEND_LEVELS as readonly string[]).includes(levelParam || "") ? (levelParam as SpendLevel) : "campaign";
  const [spend, sess, leads, lastOk, lastErr] = await Promise.all([
    spendRows(rt, f.since, f.until), sessionsByAd(rt, f.since, f.until), leadFacts(rt, f.since, f.until),
    kvGet(rt.env, "meta_ads:last_ok"), kvGet(rt.env, "meta_ads:last_error"),
  ]);
  const rows = aggregateSpend(spend, sess, leads, level);
  const t = rows.reduce((a, r) => {
    for (const k of ["spend", "impressions", "link_clicks", "sessions", "leads", "applied", "qualified", "booked", "showed", "won", "revenue", "cash"] as const) a[k] = (a[k] || 0) + r[k];
    return a;
  }, {} as Record<string, number>);
  const zero = aggregateSpend(spend, sess, [], "ad").filter((r) => r.zero_sessions && r.spend >= 1);
  return {
    level, levels: SPEND_LEVELS,
    configured: rt.settings.has("META_ADS_TOKEN") && rt.settings.has("META_AD_ACCOUNT_ID"),
    last_sync: lastOk ? Number(lastOk) : null, last_error: lastErr || null,
    totals: {
      ...t, spend: Math.round((t.spend || 0) * 100) / 100,
      cpl: div(t.spend || 0, t.leads || 0), cost_per_booked: div(t.spend || 0, t.booked || 0), cac: div(t.spend || 0, t.won || 0),
      cash_roas: div(t.cash || 0, t.spend || 0), revenue_roas: div(t.revenue || 0, t.spend || 0),
    },
    rows: rows.slice(0, 300),
    zero_session_ads: zero.slice(0, 50).map((r) => ({ ad_id: r.key, name: r.name, platform: r.platform, spend: r.spend, parent: r.parent })),
  };
}
