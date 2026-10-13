// Logging call outcomes and deal markers. applyLeadUpdate validates everything and runs the side
// effects (sequences, rebook call, pings, Meta events), except for historical leads.

import type { Runtime } from "../app";
import { LOST_REASONS, OBJECTIONS, STATUSES, type Status, type Tier } from "../config";
import { newId } from "../lib/ids";
import { suppress } from "../lib/suppress";
import { clip } from "../lib/text";
import { getLead, updateLead, type Lead } from "../funnel/leads";
import { track } from "../tracking/track";
import { enqueueSequence, cancelSequences } from "../integrations/email";
import { ALL_MARKETING } from "../integrations/sequences";
import { queueCall, cancelCalls } from "../integrations/elevenlabs";
import { notifyTeam } from "../integrations/notify";
import { isHistorical } from "../integrations/booking";
import { allocatePayments, linkPayment, syncReceivables, unlinkPayment } from "./receivables";
import { isTestLead } from "../admin/testdata";
import { getPlan, scheduleRecap } from "./plan";

export { isHistorical };

/** Lead columns that shape a payment plan. */
const DEAL_KEYS = ["revenue", "payment_plan", "installments_total", "next_payment_at", "refunded_at"];

export interface LeadPatch {
  status?: string;
  tier_override?: string | null;
  closer_id?: string | null;
  setter_id?: string | null;
  revenue?: number;
  notes?: string;
  lost_reason?: string | null;
  objection?: string | null;
  industry?: string | null;
  revenue_band?: string | null;
  budget_band?: string | null;
  willing_to_invest?: string | null;
  temperature?: string | null;
  follow_up_at?: number | string | null;
  decision_maker?: string | null;
  fit_rating?: number | null;
  offer?: string | null;
  payment_plan?: string | null;
  installments_total?: number | null;
  next_payment_at?: number | string | null;
  contract_signed_at?: number | string | null;
  refunded_at?: number | string | null;
  refund_amount?: number | null;
  loi_signed_at?: number | string | null;
  target_business?: string | null;
  do_not_call?: boolean;
}

const TEMPS = new Set(["hot", "warm", "cold"]);
const DM = new Set(["yes", "no", "shared"]);
const WILLING = new Set(["yes", "no", "maybe"]);
const PLANS = new Set(["full", "split_2", "split_3", "monthly", "custom"]);
const OFFERS = new Set(["build_day", "core", "dwy", "embedded", "custom"]);

function toTs(v: unknown): number | null {
  if (v == null || v === "") return null;
  if (typeof v === "number" && Number.isFinite(v)) return v;
  const t = Date.parse(String(v));
  return Number.isFinite(t) ? t : null;
}

export class ValidationError extends Error {}
/** A readable refusal (shown as is, not as "Invalid <field>"). */
export class OutcomeError extends ValidationError {}

/** Showed / no-show can be logged from 10 minutes before the start: before that the call has not happened. */
export const OUTCOME_GRACE_MS = 10 * 60_000;
export const NOT_YET = "This call hasn't happened yet. Log showed or no-show once it has started.";
export function callNotYet(lead: { call_at: number | null }, now: number): boolean {
  return !!lead.call_at && lead.call_at > now + OUTCOME_GRACE_MS;
}

/** Pure validation → a clean patch of lead columns. Throws ValidationError. */
export function validatePatch(p: LeadPatch): Partial<Lead> {
  const out: Partial<Lead> = {};
  if (p.status !== undefined) {
    if (!STATUSES.includes(p.status as Status)) throw new ValidationError("status");
    out.status = p.status as Status;
  }
  if (p.tier_override !== undefined) {
    if (p.tier_override !== null && p.tier_override !== "" && !["A", "B", "C"].includes(p.tier_override)) throw new ValidationError("tier_override");
    out.tier_override = (p.tier_override || null) as Tier | null;
  }
  for (const k of ["closer_id", "setter_id"] as const) if (p[k] !== undefined) out[k] = p[k] ? String(p[k]).slice(0, 40) : null;
  if (p.revenue !== undefined) {
    const n = Number(p.revenue);
    if (!Number.isFinite(n) || n < 0 || n > 1e9) throw new ValidationError("revenue");
    out.revenue = n;
  }
  if (p.notes !== undefined) out.notes = String(p.notes).slice(0, 5000);
  if (p.lost_reason !== undefined) {
    if (p.lost_reason && !(LOST_REASONS as readonly string[]).includes(p.lost_reason)) throw new ValidationError("lost_reason");
    out.lost_reason = p.lost_reason || null;
  }
  if (p.objection !== undefined) {
    if (p.objection && !(OBJECTIONS as readonly string[]).includes(p.objection)) throw new ValidationError("objection");
    out.objection = p.objection || null;
  }
  if (p.temperature !== undefined) {
    if (p.temperature && !TEMPS.has(p.temperature)) throw new ValidationError("temperature");
    out.temperature = p.temperature || null;
  }
  if (p.decision_maker !== undefined) {
    if (p.decision_maker && !DM.has(p.decision_maker)) throw new ValidationError("decision_maker");
    out.decision_maker = p.decision_maker || null;
  }
  if (p.willing_to_invest !== undefined) {
    if (p.willing_to_invest && !WILLING.has(p.willing_to_invest)) throw new ValidationError("willing_to_invest");
    out.willing_to_invest = p.willing_to_invest || null;
  }
  if (p.payment_plan !== undefined) {
    if (p.payment_plan && !PLANS.has(p.payment_plan)) throw new ValidationError("payment_plan");
    out.payment_plan = p.payment_plan || null;
  }
  if (p.offer !== undefined) {
    if (p.offer && !OFFERS.has(p.offer)) throw new ValidationError("offer");
    out.offer = p.offer || null;
  }
  if (p.fit_rating !== undefined) {
    if (p.fit_rating !== null && (!Number.isInteger(Number(p.fit_rating)) || Number(p.fit_rating) < 1 || Number(p.fit_rating) > 5)) throw new ValidationError("fit_rating");
    out.fit_rating = p.fit_rating === null ? null : Number(p.fit_rating);
  }
  if (p.installments_total !== undefined) {
    const n = p.installments_total === null ? null : Number(p.installments_total);
    if (n !== null && (!Number.isInteger(n) || n < 1 || n > 60)) throw new ValidationError("installments_total");
    out.installments_total = n;
  }
  if (p.refund_amount !== undefined) {
    const n = p.refund_amount === null ? null : Number(p.refund_amount);
    if (n !== null && (!Number.isFinite(n) || n < 0)) throw new ValidationError("refund_amount");
    out.refund_amount = n;
  }
  for (const k of ["industry", "revenue_band", "budget_band", "target_business"] as const) if (p[k] !== undefined) out[k] = p[k] ? clip(p[k], 120) : null;
  for (const k of ["follow_up_at", "next_payment_at", "contract_signed_at", "refunded_at", "loi_signed_at"] as const) {
    if (p[k] !== undefined) {
      const t = toTs(p[k]);
      if (p[k] !== null && p[k] !== "" && t === null) throw new ValidationError(k);
      out[k] = t;
    }
  }
  return out;
}

export async function applyLeadUpdate(
  rt: Runtime, lead: Lead, patch: LeadPatch, opts: { source: "admin" | "calendly" | "voice" } = { source: "admin" },
): Promise<Lead> {
  const clean = validatePatch(patch);
  const now = rt.now();
  const prev = lead.status;
  const next = clean.status ?? prev;
  // Date outcomes to the call when logging an old call.
  const anchor = lead.call_at && lead.call_at < now ? lead.call_at : now;
  // Pipeline drag, the drawer and the held form all land here: a future call cannot have been held or missed.
  if (next !== prev && (next === "showed" || next === "no_show") && opts.source === "admin" && callNotYet(lead, now)) throw new OutcomeError(NOT_YET);
  if (next !== prev) {
    if ((next === "showed" || next === "won" || next === "lost") && !lead.showed_at && lead.call_at && lead.call_at <= now) clean.showed_at = anchor;
    if ((next === "won" || next === "lost") && !lead.closed_at) clean.closed_at = anchor; // never in the future
    if (next === "won" && !clean.revenue && !lead.revenue) clean.revenue = 0;
  }
  if (patch.do_not_call === true) { clean.do_not_call_at = now; await suppress(rt, "phone", lead.phone); }
  if (patch.do_not_call === false) clean.do_not_call_at = null;
  await updateLead(rt, lead.id, clean);
  let fresh = (await getLead(rt, lead.id)) as Lead;
  // Instalments follow the deal: created on a won plan, regenerated on changes, cancelled on refund or reopen.
  if (fresh.status === "won" || prev === "won" || DEAL_KEYS.some((k) => k in clean)) {
    const r = await syncReceivables(rt, fresh, { reschedule: "next_payment_at" in clean && clean.next_payment_at !== lead.next_payment_at });
    if (r.created || r.cancelled) fresh = (await getLead(rt, lead.id)) as Lead;
  }

  if (next === prev && !clean.refunded_at) return fresh;
  const historical = isHistorical(lead, now);
  await track(rt, { leadId: lead.id }, { name: "lead_status_changed", source: opts.source === "admin" ? "admin" : "webhook", props: { from: prev, to: next }, localOnly: historical });

  if (clean.refunded_at && !lead.refunded_at) await cancelSequences(rt, lead.id, ["won"]);
  if (historical || next === prev) return fresh;
  // Test leads: outcomes are recorded, but no emails and no calls (src/admin/testdata.ts).
  const test = await isTestLead(rt, lead.id);

  if (next === "won" || next === "lost" || next === "disqualified") {
    await cancelSequences(rt, lead.id, ALL_MARKETING);
    await cancelCalls(rt, lead.id, ["confirm", "speed_to_lead", "rebook"]);
  }
  if (next === "no_show") {
    await cancelSequences(rt, lead.id, ["booked", "precall"]);
    if (!test) await enqueueSequence(rt, fresh, "no_show");
    if (!test) await queueCall(rt, fresh, "rebook");
    await track(rt, { leadId: lead.id }, { name: "call_no_show", source: "admin", eventId: `noshow_${lead.id}_${lead.call_at || 0}` });
    rt.waitUntil(notifyTeam(rt, "no_show", fresh));
  } else if (next === "showed") {
    await cancelSequences(rt, lead.id, ["booked", "precall", "no_show"]);
    if (!test) {
      await enqueueSequence(rt, fresh, "post_call");
      // The recap waits for the written plan (~2 h after the call) or goes as a neutral note after 24 h.
      await scheduleRecap(rt, lead.id, lead.call_at, !!(await getPlan(rt, lead.id)));
    }
    await track(rt, { leadId: lead.id }, { name: "call_showed", source: "admin", eventId: `showed_${lead.id}_${lead.call_at || 0}` });
    rt.waitUntil(notifyTeam(rt, "showed", fresh));
  } else if (next === "won") {
    if (!test) await enqueueSequence(rt, fresh, "won");
    if (prev !== "showed") await track(rt, { leadId: lead.id }, { name: "call_showed", source: "admin", eventId: `showed_${lead.id}_${lead.call_at || 0}` });
    await track(rt, { leadId: lead.id }, { name: "deal_won", source: "admin", value: fresh.revenue || undefined, currency: "USD", eventId: `won_${lead.id}` });
    rt.waitUntil(notifyTeam(rt, "won", fresh, fresh.revenue ? `Deal value ${Math.round(fresh.revenue).toLocaleString("en-US")}` : undefined));
  } else if (next === "lost") {
    if (!test) await enqueueSequence(rt, fresh, "lost");
    await track(rt, { leadId: lead.id }, { name: "deal_lost", source: "admin", props: { reason: fresh.lost_reason }, eventId: `lost_${lead.id}` });
    rt.waitUntil(notifyTeam(rt, "lost", fresh, fresh.lost_reason || undefined));
  }
  return fresh;
}

// ── Payments ledger ──────────────────────────────────────────────────────────

export interface Payment { id: string; lead_id: string; amount: number; paid_at: number; method: string | null; note: string | null; created_at: number; }

export async function syncCash(rt: Runtime, leadId: string) {
  await rt.env.DB.prepare("UPDATE leads SET cash_collected = (SELECT COALESCE(SUM(amount), 0) FROM payments WHERE lead_id = ?), updated_at = ? WHERE id = ?").bind(leadId, rt.now(), leadId).run();
}

export async function recordPayment(rt: Runtime, lead: Lead, input: { amount: unknown; paid_at?: unknown; method?: unknown; note?: unknown }, opts: { receivableId?: string } = {}): Promise<Payment> {
  const amount = Number(input.amount);
  if (!Number.isFinite(amount) || amount === 0 || Math.abs(amount) > 1e8) throw new ValidationError("amount");
  const paid = toTs(input.paid_at) ?? rt.now();
  const p: Payment = {
    id: newId("p"), lead_id: lead.id, amount, paid_at: paid,
    method: input.method ? clip(input.method, 40) : null, note: input.note ? clip(input.note, 300) : null, created_at: rt.now(),
  };
  await rt.env.DB.prepare("INSERT INTO payments (id, lead_id, amount, paid_at, method, note, created_at) VALUES (?,?,?,?,?,?,?)")
    .bind(p.id, p.lead_id, p.amount, p.paid_at, p.method, p.note, p.created_at).run();
  await syncCash(rt, lead.id);
  // Instalments: "mark paid" links this payment to that instalment; otherwise it pays the oldest pending one.
  if (amount > 0) {
    if (opts.receivableId) await linkPayment(rt, opts.receivableId, p.id);
    else await allocatePayments(rt, lead.id);
  }
  // Sent to Meta as CashCollected (or Refund when negative) with the amount as value; the id dedupes.
  if (!isHistorical(lead, rt.now())) {
    await track(rt, { leadId: lead.id }, { name: "payment_recorded", source: "admin", props: { amount }, value: amount, currency: "USD", eventId: `pay_${p.id}` });
  }
  return p;
}

export async function deletePayment(rt: Runtime, leadId: string, paymentId: string): Promise<void> {
  await rt.env.DB.prepare("DELETE FROM payments WHERE id = ? AND lead_id = ?").bind(paymentId, leadId).run();
  await syncCash(rt, leadId);
  await unlinkPayment(rt, leadId, paymentId);
}

export async function listPayments(rt: Runtime, leadId: string): Promise<Payment[]> {
  return ((await rt.env.DB.prepare("SELECT * FROM payments WHERE lead_id = ? ORDER BY paid_at DESC").bind(leadId).all<Payment>()).results) || [];
}
