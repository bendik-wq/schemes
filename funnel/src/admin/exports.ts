// CSV exports for owners and managers: payments, calls, emails, attribution and cohorts.
// Cells go through csvCell (formula-injection safe). Each export is capped at 20,000 rows.

import type { Runtime } from "../app";
import { listReps } from "../sales/reps";
import { toCsv } from "./sales";
import { all, type Filters } from "./stats";
import { attributionReport, cohortsReport, COHORT_DAYS } from "./attribution";

const iso = (t: unknown) => (typeof t === "number" && t > 0 ? new Date(t).toISOString() : "");
export const EXPORTS = ["payments", "calls", "emails", "attribution", "cohorts"] as const;

export async function exportCsv(rt: Runtime, kind: string, f: Filters, q: (k: string) => string | undefined): Promise<string | null> {
  const reps = await listReps(rt);
  const rep = (id: unknown) => (id ? reps.find((r) => r.id === id)?.name || String(id) : "");
  if (kind === "payments") {
    const rows = await all<Record<string, unknown>>(rt,
      `SELECT p.id, p.paid_at, p.amount, p.method, p.lead_id, l.ref_code, l.first_name, l.last_name, l.email, l.closer_id, l.offer, l.payment_plan,
         (SELECT r.seq FROM receivables r WHERE r.paid_payment_id = p.id) AS instalment
       FROM payments p LEFT JOIN leads l ON l.id = p.lead_id WHERE p.paid_at >= ? AND p.paid_at < ? ORDER BY p.paid_at DESC LIMIT 20000`, [f.since, f.until]);
    return toCsv(["payment_id", "paid_at", "amount", "method", "instalment", "lead_ref", "first_name", "last_name", "email", "closer", "offer", "payment_plan"],
      rows.map((r) => [r.id, iso(r.paid_at), r.amount, r.method, r.instalment, r.ref_code, r.first_name, r.last_name, r.email, rep(r.closer_id), r.offer, r.payment_plan]));
  }
  if (kind === "calls") {
    const rows = await all<Record<string, unknown>>(rt,
      `SELECT l.ref_code, l.first_name, l.last_name, l.email, COALESCE(l.tier_override, l.tier) AS tier, l.booked_at, l.call_at, l.status, l.closer_id, l.setter_id,
         l.showed_at, l.closed_at, l.revenue, l.cash_collected, l.lost_reason, l.objection, l.booking_source, r.noshow_risk
       FROM leads l LEFT JOIN lead_revops r ON r.lead_id = l.id WHERE l.call_at >= ? AND l.call_at < ? ORDER BY l.call_at DESC LIMIT 20000`, [f.since, f.until + 30 * 86_400_000]);
    return toCsv(["lead_ref", "first_name", "last_name", "email", "tier", "booked_at", "call_at", "status", "closer", "setter", "showed_at", "closed_at", "revenue", "cash_collected", "lost_reason", "objection", "booking_source", "noshow_risk"],
      rows.map((r) => [r.ref_code, r.first_name, r.last_name, r.email, r.tier, iso(r.booked_at), iso(r.call_at), r.status, rep(r.closer_id), rep(r.setter_id), iso(r.showed_at), iso(r.closed_at), r.revenue, r.cash_collected, r.lost_reason, r.objection, r.booking_source, r.noshow_risk]));
  }
  if (kind === "emails") {
    const rows = await all<Record<string, unknown>>(rt,
      `SELECT e.id, e.sequence, e.step, e.template, e.status, e.send_at, e.sent_at, e.opens, e.clicks, e.bounced_at, e.complained_at, l.ref_code
       FROM emails e LEFT JOIN leads l ON l.id = e.lead_id WHERE e.created_at >= ? AND e.created_at < ? ORDER BY e.send_at DESC LIMIT 20000`, [f.since, f.until]);
    return toCsv(["email_id", "lead_ref", "sequence", "step", "template", "status", "send_at", "sent_at", "opens", "clicks", "bounced_at", "complained_at"],
      rows.map((r) => [r.id, r.ref_code, r.sequence, r.step, r.template, r.status, iso(r.send_at), iso(r.sent_at), r.opens, r.clicks, iso(r.bounced_at), iso(r.complained_at)]));
  }
  if (kind === "attribution") {
    const a = await attributionReport(rt, f, q("model"), q("dim"));
    return toCsv(["model", "dimension", "key", "leads", "booked", "wins", "revenue", "cash", "spend", "cash_roas", "cost_per_booked"],
      a.rows.map((r) => [a.model, a.dim, r.key, r.leads, r.booked, r.wins, r.revenue, r.cash, r.spend, r.roas, r.cost_per_booked]));
  }
  if (kind === "cohorts") {
    const c = await cohortsReport(rt, q("by"));
    return toCsv(["cohort", "leads", "booked", "won", ...COHORT_DAYS.map((d) => `cash_d${d}`), "ttc_p50_days", "ttc_p90_days", "plan_collection_pct", "refund_pct", "value90_per_lead", "value90_per_booked"],
      c.rows.map((r) => [r.cohort, r.leads, r.booked, r.won, ...COHORT_DAYS.map((d) => r.cash[`d${d}`]), r.ttc_p50_days, r.ttc_p90_days, r.plan_collection_pct, r.refund_pct, r.value90_per_lead, r.value90_per_booked]));
  }
  return null;
}
