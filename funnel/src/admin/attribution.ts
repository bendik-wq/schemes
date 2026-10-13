// Multi-touch attribution and revenue cohorts.
// Attribution: each lead's non-bot sessions (by lead id or its browser) before the moment that counts get
// fractional credit under five models: lead created (leads), call booked (booked), deal won (wins, revenue,
// cash). Leads with no session are credited to "(no session)" so totals always match. Spend ties to the
// campaign or ad for ROAS. Cohorts: applicants by the week or month they arrived, cumulative cash by age,
// time to close, payment-plan collection, refunds and 90-day value. Both are cached for 10 minutes.

import type { Runtime } from "../app";
import { kvGetJson, kvSet } from "../lib/kv";
import { dayKey } from "../integrations/meta-ads";
import { isoWeek } from "../sales/analyst";
import { all, salesTz, type Filters } from "./stats";

const DAY = 86_400_000;
export const MODELS = ["first", "last_non_direct", "linear", "position", "time_decay"] as const;
export type AttrModel = (typeof MODELS)[number];
export const DIMS = ["campaign", "ad_id", "channel"] as const;
export type AttrDim = (typeof DIMS)[number];
export const HALF_LIFE_MS = 7 * DAY;
const CACHE_MS = 10 * 60_000;

export interface Touch { t: number; channel: string | null; key: string }

/** Pure: credit weights (summing to 1) for the touches at or before `convAt`, in time order. */
export function creditWeights(model: AttrModel, touches: Array<Pick<Touch, "t" | "channel">>, convAt: number): number[] {
  const n = touches.length;
  if (!n) return [];
  const w = new Array(n).fill(0);
  if (model === "first") w[0] = 1;
  else if (model === "last_non_direct") {
    let i = n - 1;
    while (i >= 0 && (!touches[i].channel || touches[i].channel === "direct")) i--;
    w[i >= 0 ? i : n - 1] = 1;
  } else if (model === "linear") w.fill(1 / n);
  else if (model === "position") {
    if (n === 1) w[0] = 1;
    else if (n === 2) { w[0] = 0.5; w[1] = 0.5; }
    else { w[0] = 0.4; w[n - 1] = 0.4; for (let i = 1; i < n - 1; i++) w[i] = 0.2 / (n - 2); }
  } else {
    const raw = touches.map((x) => Math.pow(2, -Math.max(0, convAt - x.t) / HALF_LIFE_MS));
    const s = raw.reduce((a, b) => a + b, 0) || 1;
    raw.forEach((v, i) => { w[i] = v / s; });
  }
  return w;
}

export interface AttrLead {
  id: string; created_at: number; booked_at: number | null; closed_at: number | null; won: boolean; revenue: number; cash: number;
  touches: Touch[];
}
export interface AttrRow { key: string; leads: number; booked: number; wins: number; revenue: number; cash: number; spend: number | null; roas: number | null; cost_per_booked: number | null }

const NO_SESSION = "(no session)";

/** Pure: credited totals per key. */
export function attribute(model: AttrModel, leads: AttrLead[], spend: Record<string, number> | null): { rows: AttrRow[]; totals: AttrRow } {
  const by = new Map<string, AttrRow>();
  const row = (k: string) => {
    let r = by.get(k);
    if (!r) { r = { key: k, leads: 0, booked: 0, wins: 0, revenue: 0, cash: 0, spend: null, roas: null, cost_per_booked: null }; by.set(k, r); }
    return r;
  };
  const give = (l: AttrLead, at: number, f: (r: AttrRow, w: number) => void) => {
    const ts = l.touches.filter((t) => t.t <= at).sort((a, b) => a.t - b.t);
    if (!ts.length) { f(row(NO_SESSION), 1); return; }
    const w = creditWeights(model, ts, at);
    ts.forEach((t, i) => { if (w[i]) f(row(t.key), w[i]); });
  };
  for (const l of leads) {
    give(l, l.created_at, (r, w) => { r.leads += w; });
    if (l.booked_at) give(l, l.booked_at, (r, w) => { r.booked += w; });
    if (l.won && l.closed_at) give(l, l.closed_at, (r, w) => { r.wins += w; r.revenue += w * l.revenue; r.cash += w * l.cash; });
  }
  if (spend) for (const [k, v] of Object.entries(spend)) row(k).spend = (row(k).spend || 0) + v;
  const r2 = (v: number) => Math.round(v * 100) / 100;
  // Totals from the unrounded credit, so fractions always add back up to whole leads and wins.
  const raw = [...by.values()].reduce((s, r) => ({ leads: s.leads + r.leads, booked: s.booked + r.booked, wins: s.wins + r.wins, revenue: s.revenue + r.revenue, cash: s.cash + r.cash, spend: s.spend + (r.spend || 0) }),
    { leads: 0, booked: 0, wins: 0, revenue: 0, cash: 0, spend: 0 });
  const rows = [...by.values()].map((r) => ({
    ...r, leads: r2(r.leads), booked: r2(r.booked), wins: r2(r.wins), revenue: Math.round(r.revenue), cash: Math.round(r.cash),
    spend: r.spend == null ? null : Math.round(r.spend), roas: r.spend ? r2(r.cash / r.spend) : null, cost_per_booked: r.spend && r.booked ? Math.round(r.spend / r.booked) : null,
  }));
  rows.sort((a, b) => b.cash - a.cash || b.booked - a.booked || b.leads - a.leads);
  const t: AttrRow = {
    key: "Total", leads: r2(raw.leads), booked: r2(raw.booked), wins: r2(raw.wins), revenue: Math.round(raw.revenue), cash: Math.round(raw.cash),
    spend: raw.spend ? Math.round(raw.spend) : null, roas: raw.spend ? r2(raw.cash / raw.spend) : null, cost_per_booked: raw.spend && raw.booked ? Math.round(raw.spend / raw.booked) : null,
  };
  return { rows, totals: t };
}

/** Pure: channel paths before booking (or before the lead, when not booked), repeats collapsed. */
export function topPaths(leads: AttrLead[], limit = 20) {
  const m = new Map<string, { path: string[]; leads: number; booked: number; wins: number; cash: number }>();
  for (const l of leads) {
    const cut = l.booked_at || l.created_at;
    const seq: string[] = [];
    for (const t of [...l.touches].filter((x) => x.t <= cut).sort((a, b) => a.t - b.t)) {
      const c = t.channel || "direct";
      if (seq[seq.length - 1] !== c) seq.push(c);
    }
    const path = seq.length ? (seq.length > 5 ? [...seq.slice(0, 2), "…", ...seq.slice(-2)] : seq) : [NO_SESSION];
    const k = path.join(">");
    const r = m.get(k) || { path, leads: 0, booked: 0, wins: 0, cash: 0 };
    r.leads++; if (l.booked_at) r.booked++; if (l.won) { r.wins++; r.cash += l.cash; }
    m.set(k, r);
  }
  return [...m.values()].sort((a, b) => b.leads - a.leads || b.booked - a.booked).slice(0, limit).map((r) => ({ ...r, cash: Math.round(r.cash) }));
}

function keyOf(dim: AttrDim, s: { channel: string | null; utm_campaign: string | null; ad_id: string | null }): string {
  if (dim === "campaign") return s.utm_campaign || "(no campaign)";
  if (dim === "ad_id") return s.ad_id || "(no ad)";
  return s.channel || "direct";
}

async function loadAttrLeads(rt: Runtime, f: Filters, dim: AttrDim): Promise<AttrLead[]> {
  const leads = await all<{ id: string; visitor_id: string | null; created_at: number; booked_at: number | null; closed_at: number | null; status: string; revenue: number; cash_collected: number }>(rt,
    `SELECT id, visitor_id, created_at, booked_at, closed_at, status, revenue, cash_collected FROM leads
     WHERE booking_source = 'funnel' AND (? = 1 OR id NOT IN (SELECT lead_id FROM lead_revops WHERE is_test = 1)) AND created_at >= ? AND created_at < ? ORDER BY created_at DESC LIMIT 5000`, [f.includeTest ? 1 : 0, f.since, f.until]);
  if (!leads.length) return [];
  type S = { id: string; lead_id: string | null; visitor_id: string; started_at: number; channel: string | null; utm_campaign: string | null; ad_id: string | null };
  const sessions = new Map<string, S>();
  const ids = leads.map((l) => l.id), vids = leads.map((l) => l.visitor_id).filter((v): v is string => !!v);
  for (let i = 0; i < ids.length; i += 90) {
    const part = ids.slice(i, i + 90);
    for (const s of await all<S>(rt, `SELECT id, lead_id, visitor_id, started_at, channel, utm_campaign, ad_id FROM sessions WHERE is_bot = 0 AND lead_id IN (${part.map(() => "?").join(",")}) LIMIT 20000`, part)) sessions.set(s.id, s);
  }
  for (let i = 0; i < vids.length; i += 90) {
    const part = vids.slice(i, i + 90);
    for (const s of await all<S>(rt, `SELECT id, lead_id, visitor_id, started_at, channel, utm_campaign, ad_id FROM sessions WHERE is_bot = 0 AND visitor_id IN (${part.map(() => "?").join(",")}) LIMIT 20000`, part)) sessions.set(s.id, s);
  }
  const byLead = new Map<string, Touch[]>();
  const vidToLead = new Map(leads.filter((l) => l.visitor_id).map((l) => [l.visitor_id as string, l.id]));
  for (const s of sessions.values()) {
    const lid = (s.lead_id && byLeadHas(ids, s.lead_id) ? s.lead_id : null) || vidToLead.get(s.visitor_id);
    if (!lid) continue;
    if (!byLead.has(lid)) byLead.set(lid, []);
    byLead.get(lid)!.push({ t: Number(s.started_at), channel: s.channel, key: keyOf(dim, s) });
  }
  return leads.map((l) => ({
    id: l.id, created_at: Number(l.created_at), booked_at: l.booked_at == null ? null : Number(l.booked_at), closed_at: l.closed_at == null ? null : Number(l.closed_at),
    won: l.status === "won", revenue: Number(l.revenue) || 0, cash: Number(l.cash_collected) || 0, touches: (byLead.get(l.id) || []).slice(0, 200),
  }));
}
const idSets = new WeakMap<string[], Set<string>>();
function byLeadHas(ids: string[], id: string): boolean {
  let s = idSets.get(ids);
  if (!s) { s = new Set(ids); idSets.set(ids, s); }
  return s.has(id);
}

async function spendBy(rt: Runtime, f: Filters, dim: AttrDim): Promise<Record<string, number> | null> {
  if (dim === "channel") return null; // spend is per campaign and ad, not per channel grouping
  const tz = salesTz(rt);
  const col = dim === "campaign" ? "COALESCE(campaign_name, campaign_id, '(no campaign)')" : "ad_id";
  const rows = await all<{ k: string; s: number }>(rt, `SELECT ${col} AS k, SUM(spend) AS s FROM ad_spend WHERE date >= ? AND date <= ? GROUP BY 1`, [dayKey(f.since, tz), dayKey(f.until, tz)]).catch(() => []);
  return rows.length ? Object.fromEntries(rows.map((r) => [r.k, Number(r.s) || 0])) : null;
}

async function cached<T>(rt: Runtime, key: string, fn: () => Promise<T>): Promise<T & { cached_at: number }> {
  const hit = await kvGetJson<{ at: number; data: T } | null>(rt.env, key, null);
  if (hit && rt.now() - hit.at < CACHE_MS) return { ...hit.data, cached_at: hit.at };
  const data = await fn();
  await kvSet(rt.env, key, JSON.stringify({ at: rt.now(), data })).catch(() => undefined);
  return { ...data, cached_at: rt.now() };
}

export async function attributionReport(rt: Runtime, f: Filters, modelRaw: string | undefined, dimRaw: string | undefined) {
  const model = (MODELS as readonly string[]).includes(modelRaw || "") ? (modelRaw as AttrModel) : "last_non_direct";
  const dim = (DIMS as readonly string[]).includes(dimRaw || "") ? (dimRaw as AttrDim) : "campaign";
  return cached(rt, `cache:attr:${model}:${dim}:${f.range}`, async () => {
    const leads = await loadAttrLeads(rt, f, dim);
    const a = attribute(model, leads, await spendBy(rt, f, dim));
    return { model, dim, models: MODELS, dims: DIMS, rows: a.rows.slice(0, 300), totals: a.totals, paths: topPaths(leads), n_leads: leads.length };
  });
}

// ── Cohorts ──────────────────────────────────────────────────────────────────

export const COHORT_DAYS = [0, 7, 14, 30, 60, 90, 180];

export interface CohortLead { id: string; created_at: number; booked: boolean; won: boolean; closed_at: number | null; refunded: boolean }
export interface CohortPay { lead_id: string; amount: number; paid_at: number }
export interface CohortRecv { lead_id: string; status: string; amount: number; due_at: number }

function cohortKey(ts: number, by: "week" | "month"): string {
  const d = new Date(ts);
  return by === "month" ? `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}` : isoWeek(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate());
}

function quantile(v: number[], q: number): number | null {
  if (!v.length) return null;
  const s = [...v].sort((a, b) => a - b);
  const i = (s.length - 1) * q, lo = Math.floor(i), hi = Math.ceil(i);
  return s[lo] + (s[hi] - s[lo]) * (i - lo);
}

/** Pure: the cohort table, newest first. Cash cells are null until every lead in the cohort is that old. */
export function cohortTable(leads: CohortLead[], pays: CohortPay[], recv: CohortRecv[], by: "week" | "month", now: number) {
  const payBy = new Map<string, CohortPay[]>();
  for (const p of pays) { if (!payBy.has(p.lead_id)) payBy.set(p.lead_id, []); payBy.get(p.lead_id)!.push(p); }
  const recvBy = new Map<string, CohortRecv[]>();
  for (const r of recv) { if (!recvBy.has(r.lead_id)) recvBy.set(r.lead_id, []); recvBy.get(r.lead_id)!.push(r); }
  const groups = new Map<string, CohortLead[]>();
  for (const l of leads) { const k = cohortKey(l.created_at, by); if (!groups.has(k)) groups.set(k, []); groups.get(k)!.push(l); }
  const r1 = (v: number) => Math.round(v * 10) / 10;
  const rows = [...groups.entries()].map(([cohort, ls]) => {
    const newest = Math.max(...ls.map((l) => l.created_at));
    const cash: Record<string, number | null> = {};
    for (const d of COHORT_DAYS) {
      if (now - newest < d * DAY) { cash[`d${d}`] = null; continue; }
      let s = 0;
      for (const l of ls) for (const p of payBy.get(l.id) || []) if (p.paid_at - l.created_at <= (d + 1) * DAY - 1) s += p.amount;
      cash[`d${d}`] = Math.round(s);
    }
    const won = ls.filter((l) => l.won);
    const ttc = won.filter((l) => l.closed_at).map((l) => ((l.closed_at as number) - l.created_at) / DAY);
    let due = 0, paid = 0;
    for (const l of ls) for (const r of recvBy.get(l.id) || []) { if (r.status === "cancelled" || r.due_at > now) continue; due += r.amount; if (r.status === "paid") paid += r.amount; }
    const booked = ls.filter((l) => l.booked).length;
    const v90 = cash.d90;
    return {
      cohort, leads: ls.length, booked, won: won.length, cash,
      ttc_p50_days: ttc.length ? r1(quantile(ttc, 0.5) as number) : null, ttc_p90_days: ttc.length ? r1(quantile(ttc, 0.9) as number) : null,
      plan_collection_pct: due > 0 ? r1((paid / due) * 100) : null, refund_pct: won.length ? r1((won.filter((l) => l.refunded).length / won.length) * 100) : null,
      value90_per_lead: v90 == null ? null : Math.round(v90 / ls.length), value90_per_booked: v90 == null || !booked ? null : Math.round(v90 / booked),
    };
  });
  rows.sort((a, b) => (a.cohort < b.cohort ? 1 : -1));
  return rows;
}

export async function cohortsReport(rt: Runtime, byRaw: string | undefined) {
  const by = byRaw === "week" ? "week" : "month";
  return cached(rt, `cache:cohorts:${by}`, async () => {
    const since = rt.now() - (by === "week" ? 26 * 7 : 400) * DAY;
    const [leads, pays, recv] = await Promise.all([
      all<{ id: string; created_at: number; booked_at: number | null; status: string; closed_at: number | null; refunded_at: number | null }>(rt,
        `SELECT id, created_at, booked_at, status, closed_at, refunded_at FROM leads WHERE booking_source = 'funnel' AND id NOT IN (SELECT lead_id FROM lead_revops WHERE is_test = 1) AND app_completed_at IS NOT NULL AND created_at >= ? LIMIT 20000`, [since]),
      all<CohortPay>(rt, `SELECT p.lead_id, p.amount, p.paid_at FROM payments p JOIN leads l ON l.id = p.lead_id WHERE l.created_at >= ? AND l.app_completed_at IS NOT NULL LIMIT 50000`, [since]),
      all<CohortRecv>(rt, `SELECT r.lead_id, r.status, r.amount, r.due_at FROM receivables r JOIN leads l ON l.id = r.lead_id WHERE l.created_at >= ? LIMIT 50000`, [since]).catch(() => []),
    ]);
    const rows = cohortTable(leads.map((l) => ({ id: l.id, created_at: Number(l.created_at), booked: l.booked_at != null, won: l.status === "won", closed_at: l.closed_at == null ? null : Number(l.closed_at), refunded: l.refunded_at != null })),
      pays.map((p) => ({ ...p, amount: Number(p.amount), paid_at: Number(p.paid_at) })), recv.map((r) => ({ ...r, amount: Number(r.amount), due_at: Number(r.due_at) })), by, rt.now());
    return { by, days: COHORT_DAYS, rows };
  });
}
