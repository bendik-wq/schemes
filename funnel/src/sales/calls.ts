// Held calls: the "Showed" outcome with a review (offer made, recording, QA score, objection) and the
// written plan, plus the closer KPIs built on it (offer %, close % of offers, cash on call, cycle days,
// $ per call held) and the weekly objections chart.

import type { Runtime } from "../app";
import { OBJECTIONS } from "../config";
import { newId } from "../lib/ids";
import { getLead, type Lead } from "../funnel/leads";
import { all, leadDims, salesTz, type Filters } from "../admin/stats";
import { localParts } from "../integrations/sequences";
import { NOT_YET, OutcomeError, ValidationError, applyLeadUpdate, callNotYet } from "./outcomes";
import { PlanError, savePlan, type PlanRow } from "./plan";

const DAY = 86_400_000;

export class CallError extends Error {}

export interface ReviewInput { offer_made: boolean; recording_url: string | null; qa_score: number | null; objection: string | null }

/** Pure validation of the review part of the "Showed" modal. Offer made is required. */
export function cleanReview(b: Record<string, unknown>): ReviewInput {
  const o = b.offer_made;
  const offer = o === true || o === "yes" || o === 1 || o === "1" ? true : o === false || o === "no" || o === 0 || o === "0" ? false : null;
  if (offer === null) throw new CallError("Say whether an offer was made.");
  let url: string | null = null;
  if (b.recording_url != null && String(b.recording_url).trim()) {
    const u = String(b.recording_url).trim();
    if (!/^https:\/\/[^\s"'<>]{4,500}$/.test(u)) throw new CallError("The recording link must start with https://");
    url = u;
  }
  let qa: number | null = null;
  if (b.qa_score != null && b.qa_score !== "") {
    qa = Number(b.qa_score);
    if (!Number.isInteger(qa) || qa < 1 || qa > 5) throw new CallError("QA score is 1 to 5.");
  }
  let objection: string | null = null;
  if (b.objection != null && b.objection !== "") {
    if (!(OBJECTIONS as readonly string[]).includes(String(b.objection))) throw new CallError("Pick an objection from the list.");
    objection = String(b.objection);
  }
  return { offer_made: offer, recording_url: url, qa_score: qa, objection };
}

const planGiven = (p: unknown): p is Record<string, unknown> =>
  !!p && typeof p === "object" && ["first_build", "next_step", "why", "keep", "price", "plan"].some((k) => String((p as Record<string, unknown>)[k] ?? "").trim());

/**
 * Log a held call: status → showed (when it still says booked or no-show), the review row, the objection on
 * the deal, and the plan when one was written. Returns the fresh lead and the plan.
 */
export async function logHeldCall(rt: Runtime, lead: Lead, body: Record<string, unknown>, by: string): Promise<{ lead: Lead; plan: PlanRow | null }> {
  if ((lead.status === "booked" || lead.status === "no_show") && callNotYet(lead, rt.now())) throw new CallError(NOT_YET);
  const review = cleanReview(body);
  // Validate the plan before anything is written.
  if (planGiven(body.plan)) {
    const p = body.plan as Record<string, unknown>;
    if (!String(p.first_build ?? "").trim() || !String(p.next_step ?? "").trim()) throw new CallError("A plan needs what we would build first and the next step.");
  }
  let fresh = lead;
  const patch: Record<string, unknown> = {};
  if (lead.status === "booked" || lead.status === "no_show") patch.status = "showed";
  if (review.objection) patch.objection = review.objection;
  if (Object.keys(patch).length) {
    try {
      fresh = await applyLeadUpdate(rt, lead, patch, { source: "admin" });
    } catch (e) {
      if (e instanceof OutcomeError) throw new CallError(e.message);
      if (e instanceof ValidationError) throw new CallError(`Invalid ${e.message}`);
      throw e;
    }
  }
  await rt.env.DB.prepare(
    "INSERT INTO call_reviews (id, lead_id, call_at, offer_made, recording_url, qa_score, objection, created_by, created_at) VALUES (?,?,?,?,?,?,?,?,?)",
  ).bind(newId("cr"), lead.id, lead.call_at, review.offer_made ? 1 : 0, review.recording_url, review.qa_score, review.objection, by.slice(0, 60), rt.now()).run();
  let plan: PlanRow | null = null;
  if (planGiven(body.plan)) {
    try {
      plan = await savePlan(rt, fresh, body.plan as Record<string, unknown>, by);
    } catch (e) {
      if (e instanceof PlanError) throw new CallError(e.message);
      throw e;
    }
  }
  return { lead: (await getLead(rt, lead.id)) as Lead, plan };
}

export async function latestReview(rt: Runtime, leadId: string) {
  return rt.env.DB.prepare("SELECT offer_made, recording_url, qa_score, objection, created_by, created_at, call_at FROM call_reviews WHERE lead_id = ? ORDER BY created_at DESC LIMIT 1")
    .bind(leadId).first<{ offer_made: number; recording_url: string | null; qa_score: number | null; objection: string | null; created_by: string | null; created_at: number; call_at: number | null }>();
}

// ── Closer KPIs ──────────────────────────────────────────────────────────────

export interface CloserKpis {
  held: number; reviewed: number; offers: number; offer_rate: number | null; won_of_offers: number; close_of_offers: number | null;
  cash_on_call: number; cycle_days: number | null; cycle_n: number; held_cash: number; per_call_held: number | null; qa_avg: number | null;
}

const pct = (a: number, b: number) => (b > 0 ? Math.round((a / b) * 1000) / 10 : null);

/** Pure: median of a list (null when empty). */
export function median(xs: number[]): number | null {
  const v = xs.filter((x) => Number.isFinite(x)).sort((a, b) => a - b);
  if (!v.length) return null;
  const m = Math.floor(v.length / 2);
  return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2;
}

interface HeldRow { id: string; closer_id: string | null; status: string; call_at: number; booked_at: number | null; closed_at: number | null; cash_collected: number; offer_made: number | null; qa: number | null; cash24: number }

/** Pure: per-closer KPIs from held calls (and wins closed in the period for the cycle). */
export function closerKpis(held: HeldRow[], wins: Array<{ closer_id: string | null; booked_at: number | null; closed_at: number | null }>): Map<string, CloserKpis> {
  const ids = new Set<string>([...held.map((h) => h.closer_id || ""), ...wins.map((w) => w.closer_id || "")]);
  const out = new Map<string, CloserKpis>();
  for (const id of ids) {
    const hs = held.filter((h) => (h.closer_id || "") === id);
    const reviewed = hs.filter((h) => h.offer_made != null);
    const offers = reviewed.filter((h) => h.offer_made === 1);
    const wonOffers = offers.filter((h) => h.status === "won").length;
    const cycles = wins.filter((w) => (w.closer_id || "") === id && w.booked_at != null && w.closed_at != null && w.closed_at >= w.booked_at).map((w) => ((w.closed_at as number) - (w.booked_at as number)) / DAY);
    const heldCash = hs.reduce((s, h) => s + (Number(h.cash_collected) || 0), 0);
    const qa = hs.filter((h) => h.qa != null).map((h) => Number(h.qa));
    const cyc = median(cycles);
    out.set(id, {
      held: hs.length, reviewed: reviewed.length, offers: offers.length, offer_rate: pct(offers.length, reviewed.length),
      won_of_offers: wonOffers, close_of_offers: pct(wonOffers, offers.length),
      cash_on_call: hs.reduce((s, h) => s + (Number(h.cash24) || 0), 0),
      cycle_days: cyc == null ? null : Math.round(cyc * 10) / 10, cycle_n: cycles.length,
      held_cash: heldCash, per_call_held: hs.length ? Math.round(heldCash / hs.length) : null,
      qa_avg: qa.length ? Math.round((qa.reduce((a, b) => a + b, 0) / qa.length) * 10) / 10 : null,
    });
  }
  return out;
}

export async function closerStats(rt: Runtime, f: Filters): Promise<Map<string, CloserKpis>> {
  const ld = leadDims(f, "l");
  const now = rt.now();
  const [held, wins] = await Promise.all([
    all<HeldRow>(rt,
      `SELECT l.id, l.closer_id, l.status, l.call_at, l.booked_at, l.closed_at, l.cash_collected,
         (SELECT c.offer_made FROM call_reviews c WHERE c.lead_id = l.id ORDER BY c.created_at DESC LIMIT 1) AS offer_made,
         (SELECT c.qa_score FROM call_reviews c WHERE c.lead_id = l.id ORDER BY c.created_at DESC LIMIT 1) AS qa,
         (SELECT COALESCE(SUM(p.amount), 0) FROM payments p WHERE p.lead_id = l.id AND p.paid_at >= l.call_at AND p.paid_at < l.call_at + ${DAY}) AS cash24
       FROM leads l WHERE l.call_at >= ? AND l.call_at <= ? AND l.booking_cancelled_at IS NULL AND l.booking_source = 'funnel'
         AND (l.showed_at IS NOT NULL OR l.status IN ('showed','won','lost'))${ld.sql} LIMIT 20000`, [f.since, now, ...ld.binds]),
    all<{ closer_id: string | null; booked_at: number | null; closed_at: number | null }>(rt,
      `SELECT l.closer_id, l.booked_at, l.closed_at FROM leads l WHERE l.status = 'won' AND l.closed_at >= ? AND l.closed_at < ?${ld.sql} LIMIT 20000`, [f.since, f.until, ...ld.binds]),
  ]);
  return closerKpis(held, wins);
}

// ── Objections by week ───────────────────────────────────────────────────────

/** Monday (local) of the week an instant falls in, as YYYY-MM-DD. */
export function weekKey(ms: number, tz: string): string {
  const p = localParts(ms, tz);
  const back = (p.dow + 6) % 7;
  const d = new Date(Date.UTC(p.y, p.mo - 1, p.d - back));
  return d.toISOString().slice(0, 10);
}

/** Objections logged on open held deals (by call) and on lost deals (by close), per week, last `weeks` weeks. */
export async function objectionsByWeek(rt: Runtime, f: Filters, weeks = 8) {
  const tz = salesTz(rt);
  const now = rt.now();
  const since = Math.max(f.range === "all" ? 0 : f.since, now - weeks * 7 * DAY);
  const ld = leadDims(f, "l");
  const rows = await all<{ objection: string | null; lost_reason: string | null; status: string; at: number }>(rt,
    `SELECT l.objection, l.lost_reason, l.status, CASE WHEN l.status = 'lost' THEN COALESCE(l.closed_at, l.updated_at) ELSE COALESCE(l.showed_at, l.call_at, l.updated_at) END AS at
     FROM leads l WHERE ((l.status = 'showed') OR (l.status = 'lost' AND l.closed_at >= ?))
       AND (l.objection IS NOT NULL OR (l.status = 'lost' AND l.lost_reason IS NOT NULL))${ld.sql} LIMIT 20000`,
    [since, ...ld.binds]);
  const keys: string[] = [];
  for (let t = since; t <= now + DAY; t += 7 * DAY) { const k = weekKey(t, tz); if (!keys.includes(k)) keys.push(k); }
  const nowKey = weekKey(now, tz);
  if (!keys.includes(nowKey)) keys.push(nowKey);
  const series = new Map<string, number[]>();
  let total = 0;
  for (const r of rows) {
    if (!(Number(r.at) >= since)) continue;
    const label = r.objection || (r.lost_reason ? `Lost: ${r.lost_reason}` : null);
    if (!label) continue;
    const i = keys.indexOf(weekKey(Number(r.at), tz));
    if (i < 0) continue;
    if (!series.has(label)) series.set(label, new Array(keys.length).fill(0));
    (series.get(label) as number[])[i]++;
    total++;
  }
  const list = [...series.entries()].map(([objection, counts]) => ({ objection, counts, total: counts.reduce((a, b) => a + b, 0) })).sort((a, b) => b.total - a.total);
  return { weeks: keys, series: list.slice(0, 6), other: list.slice(6).reduce((s, x) => s + x.total, 0), total };
}

