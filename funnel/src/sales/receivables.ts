// Receivables: one row per instalment of a won deal on a payment plan.
// Generated when a deal is won with a plan other than "paid in full" and two or more instalments;
// regenerated (pending rows only) when the deal value, plan or instalment count changes; cancelled when the
// deal is refunded or reopened. Payments recorded on the lead are matched to the oldest pending instalment,
// and "mark paid" records a payment in the ledger and links it. leads.next_payment_at mirrors the next
// pending instalment so the round-1 views and pings keep working.

import type { Runtime } from "../app";
import { newId } from "../lib/ids";
import type { Lead } from "../funnel/leads";

const DAY = 86_400_000;

export interface Receivable {
  id: string; lead_id: string; seq: number; due_at: number; amount: number; status: "pending" | "paid" | "cancelled";
  paid_payment_id: string | null; reminded_at: number | null; created_at: number; updated_at: number;
}

/** Add calendar months in UTC, clamping to the last day of a shorter month (31 Jan + 1 → 28/29 Feb). */
export function addMonths(ts: number, months: number): number {
  const d = new Date(ts);
  const y = d.getUTCFullYear(), m = d.getUTCMonth() + months, day = d.getUTCDate();
  const last = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
  return Date.UTC(y, m, Math.min(day, last), d.getUTCHours(), d.getUTCMinutes());
}

/** Instalments a lead's plan implies, or 0 when it is not a plan. */
export function planCount(lead: Pick<Lead, "payment_plan" | "installments_total">): number {
  if (!lead.payment_plan || lead.payment_plan === "full") return 0;
  const n = lead.installments_total ?? (lead.payment_plan === "split_2" ? 2 : lead.payment_plan === "split_3" ? 3 : 0);
  return n && n >= 2 ? Math.min(60, Math.floor(n)) : 0;
}

/** Pure: equal monthly instalments for `remaining` over `n`, cents rounding on the last one. */
export function planSchedule(remaining: number, n: number, firstDue: number, firstSeq = 1): Array<{ seq: number; due_at: number; amount: number }> {
  if (!(n > 0) || !(remaining > 0)) return [];
  const each = Math.floor((remaining / n) * 100) / 100;
  const out = [];
  for (let i = 0; i < n; i++) {
    const amount = i === n - 1 ? Math.round((remaining - each * (n - 1)) * 100) / 100 : each;
    out.push({ seq: firstSeq + i, due_at: addMonths(firstDue, i), amount });
  }
  return out;
}

export async function listReceivables(rt: Runtime, leadId: string): Promise<Receivable[]> {
  return ((await rt.env.DB.prepare("SELECT * FROM receivables WHERE lead_id = ? ORDER BY seq").bind(leadId).all<Receivable>()).results) || [];
}

async function setNextPayment(rt: Runtime, leadId: string): Promise<void> {
  await rt.env.DB.prepare(
    `UPDATE leads SET next_payment_at = (SELECT MIN(due_at) FROM receivables WHERE lead_id = ?1 AND status = 'pending'), updated_at = ?2
     WHERE id = ?1 AND EXISTS (SELECT 1 FROM receivables WHERE lead_id = ?1)`,
  ).bind(leadId, rt.now()).run();
}

/** Match recorded payments that are not linked yet to the oldest pending instalments. */
export async function allocatePayments(rt: Runtime, leadId: string): Promise<number> {
  const db = rt.env.DB;
  const free = ((await db.prepare(
    `SELECT p.id, p.amount, p.paid_at FROM payments p WHERE p.lead_id = ? AND p.amount > 0
       AND NOT EXISTS (SELECT 1 FROM receivables r WHERE r.paid_payment_id = p.id) ORDER BY p.paid_at, p.created_at`,
  ).bind(leadId).all<{ id: string; amount: number; paid_at: number }>()).results) || [];
  if (!free.length) return 0;
  const pending = ((await db.prepare("SELECT id, amount FROM receivables WHERE lead_id = ? AND status = 'pending' ORDER BY seq").bind(leadId).all<{ id: string; amount: number }>()).results) || [];
  let n = 0;
  for (let i = 0; i < Math.min(free.length, pending.length); i++) {
    await db.prepare("UPDATE receivables SET status = 'paid', paid_payment_id = ?, updated_at = ? WHERE id = ? AND status = 'pending'").bind(free[i].id, rt.now(), pending[i].id).run();
    n++;
  }
  if (n) await setNextPayment(rt, leadId);
  return n;
}

/**
 * Bring a lead's receivables in line with its deal. Idempotent: does nothing when the pending rows already
 * add up to what is left to collect over the instalments that are left.
 */
export async function syncReceivables(rt: Runtime, lead: Lead, opts: { reschedule?: boolean } = {}): Promise<{ created: number; cancelled: number }> {
  const db = rt.env.DB;
  const now = rt.now();
  const rows = await listReceivables(rt, lead.id);
  const pending = rows.filter((r) => r.status === "pending");
  const paid = rows.filter((r) => r.status === "paid");
  const n = planCount(lead);
  const active = lead.status === "won" && !lead.refunded_at && n > 0 && lead.revenue > 0;
  if (!active) {
    if (!pending.length) return { created: 0, cancelled: 0 };
    await db.prepare("UPDATE receivables SET status = 'cancelled', updated_at = ? WHERE lead_id = ? AND status = 'pending'").bind(now, lead.id).run();
    await setNextPayment(rt, lead.id);
    return { created: 0, cancelled: pending.length };
  }
  const paidSum = paid.reduce((s, r) => s + r.amount, 0);
  const remaining = Math.round((lead.revenue - paidSum) * 100) / 100;
  const left = Math.max(0, n - paid.length);
  const pendingSum = Math.round(pending.reduce((s, r) => s + r.amount, 0) * 100) / 100;
  const moved = !!opts.reschedule && lead.next_payment_at != null && pending.length > 0 && lead.next_payment_at !== Math.min(...pending.map((r) => r.due_at));
  if (!moved && pending.length === left && Math.abs(pendingSum - Math.max(0, remaining)) < 0.01) {
    await allocatePayments(rt, lead.id);
    return { created: 0, cancelled: 0 };
  }
  const lastPaidDue = paid.length ? Math.max(...paid.map((r) => r.due_at)) : null;
  // An explicit new "next payment" date moves the remaining schedule.
  const firstDue = moved ? (lead.next_payment_at as number)
    : lastPaidDue != null ? addMonths(lastPaidDue, 1)
    : lead.next_payment_at && pending.length === 0 ? lead.next_payment_at
    : pending.length ? Math.min(...pending.map((r) => r.due_at))
    : lead.closed_at || now;
  const plan = remaining > 0 && left > 0 ? planSchedule(remaining, left, firstDue, paid.length + 1) : [];
  const stmts = [db.prepare("DELETE FROM receivables WHERE lead_id = ? AND status = 'pending'").bind(lead.id)];
  for (const p of plan) {
    stmts.push(db.prepare("INSERT INTO receivables (id, lead_id, seq, due_at, amount, status, created_at, updated_at) VALUES (?,?,?,?,?, 'pending', ?, ?)")
      .bind(newId("rv"), lead.id, p.seq, p.due_at, p.amount, now, now));
  }
  await db.batch(stmts);
  await allocatePayments(rt, lead.id);
  await setNextPayment(rt, lead.id);
  return { created: plan.length, cancelled: pending.length };
}

/** A payment was deleted: its instalment goes back to pending. */
export async function unlinkPayment(rt: Runtime, leadId: string, paymentId: string): Promise<void> {
  const r = await rt.env.DB.prepare("UPDATE receivables SET status = 'pending', paid_payment_id = NULL, updated_at = ? WHERE lead_id = ? AND paid_payment_id = ?").bind(rt.now(), leadId, paymentId).run();
  if (r.meta?.changes) await setNextPayment(rt, leadId);
}

export async function getReceivable(rt: Runtime, id: string): Promise<Receivable | null> {
  return (await rt.env.DB.prepare("SELECT * FROM receivables WHERE id = ?").bind(id).first<Receivable>()) || null;
}

/** Link a just-recorded payment to an instalment and mark it paid. */
export async function linkPayment(rt: Runtime, receivableId: string, paymentId: string): Promise<boolean> {
  const r = await rt.env.DB.prepare("UPDATE receivables SET status = 'paid', paid_payment_id = ?, updated_at = ? WHERE id = ? AND status = 'pending'").bind(paymentId, rt.now(), receivableId).run();
  const row = await getReceivable(rt, receivableId);
  if (row) await setNextPayment(rt, row.lead_id);
  return !!r.meta?.changes;
}

export interface DueReceivable {
  id: string; receivable_id: string | null; lead_id: string; ref_code: string; name: string; tier: string | null; status: string;
  closer_id: string | null; closer: string | null; due_at: number; overdue: boolean; amount: number | null; seq: number | null; of: number | null;
  revenue: number; cash_collected: number; installments_total: number | null; days_overdue: number;
}

/**
 * Instalments due within `aheadMs` or overdue. Receivables first; won deals with a next_payment_at but no
 * receivables (set up before receivables existed) are included from the lead, as before.
 */
export async function receivablesDue(rt: Runtime, opts: { aheadMs?: number; rep?: string | null; reps?: Array<{ id: string; name: string }> } = {}): Promise<DueReceivable[]> {
  const now = rt.now();
  const until = now + (opts.aheadMs ?? 7 * DAY);
  const scope = opts.rep ? " AND (l.closer_id = ? OR l.setter_id = ?)" : "";
  const sb = opts.rep ? [opts.rep, opts.rep] : [];
  const db = rt.env.DB;
  const [rec, legacy] = await Promise.all([
    db.prepare(
      `SELECT r.id AS rid, r.seq, r.due_at, r.amount, (SELECT COUNT(*) FROM receivables x WHERE x.lead_id = r.lead_id AND x.status != 'cancelled') AS total,
         l.id, l.ref_code, l.first_name, l.last_name, l.email, COALESCE(l.tier_override, l.tier) AS tier, l.status, l.closer_id, l.revenue, l.cash_collected, l.installments_total
       FROM receivables r JOIN leads l ON l.id = r.lead_id
       WHERE r.status = 'pending' AND r.due_at < ? AND l.status = 'won' AND l.refunded_at IS NULL${scope}
       ORDER BY r.due_at LIMIT 300`,
    ).bind(until, ...sb).all<Record<string, unknown>>(),
    db.prepare(
      `SELECT NULL AS rid, NULL AS seq, l.next_payment_at AS due_at, NULL AS amount, NULL AS total,
         l.id, l.ref_code, l.first_name, l.last_name, l.email, COALESCE(l.tier_override, l.tier) AS tier, l.status, l.closer_id, l.revenue, l.cash_collected, l.installments_total
       FROM leads l WHERE l.next_payment_at IS NOT NULL AND l.next_payment_at < ? AND l.status = 'won' AND l.refunded_at IS NULL
         AND (l.revenue <= 0 OR l.cash_collected < l.revenue) AND NOT EXISTS (SELECT 1 FROM receivables r WHERE r.lead_id = l.id)${scope}
       ORDER BY l.next_payment_at LIMIT 200`,
    ).bind(until, ...sb).all<Record<string, unknown>>(),
  ]);
  const reps = opts.reps || [];
  const rows = [...(rec.results || []), ...(legacy.results || [])].map((r) => {
    const due = Number(r.due_at);
    const closerId = (r.closer_id as string) || null;
    return {
      id: String(r.id), receivable_id: (r.rid as string) || null, lead_id: String(r.id), ref_code: String(r.ref_code),
      name: [r.first_name, r.last_name].filter(Boolean).join(" ") || String(r.email), tier: (r.tier as string) || null, status: String(r.status),
      closer_id: closerId, closer: closerId ? reps.find((x) => x.id === closerId)?.name || closerId : null,
      due_at: due, overdue: due < now, amount: r.amount == null ? null : Number(r.amount), seq: r.seq == null ? null : Number(r.seq), of: r.total == null ? null : Number(r.total),
      revenue: Number(r.revenue) || 0, cash_collected: Number(r.cash_collected) || 0, installments_total: r.installments_total == null ? null : Number(r.installments_total),
      days_overdue: due < now ? Math.floor((now - due) / DAY) : 0,
    };
  });
  rows.sort((a, b) => a.due_at - b.due_at);
  return rows;
}

/** Receivables totals for the forecast: pending amounts due in [from, to). */
export async function scheduledBetween(rt: Runtime, from: number, to: number, rep?: string | null): Promise<number> {
  const scope = rep ? " AND (l.closer_id = ? OR l.setter_id = ?)" : "";
  const r = await rt.env.DB.prepare(
    `SELECT COALESCE(SUM(r.amount), 0) AS s FROM receivables r JOIN leads l ON l.id = r.lead_id
     WHERE r.status = 'pending' AND r.due_at >= ? AND r.due_at < ? AND l.status = 'won' AND l.refunded_at IS NULL${scope}`,
  ).bind(from, to, ...(rep ? [rep, rep] : [])).first<{ s: number }>();
  return Number(r?.s) || 0;
}
