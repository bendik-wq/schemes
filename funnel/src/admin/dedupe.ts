// Duplicate leads and merging, plus a small data-quality panel.
// Candidates: the same E.164 phone, the same visitor id, or the same name at the same company email domain.
// Merge: the survivor is the earlier lead. Every table with a lead_id column is re-pointed (found from the
// schema, so tables added later are covered), answers are merged (the survivor's win), empty fields are
// filled, the higher pipeline stage is kept, the loser's sequences and AI calls are cancelled, opt-outs carry
// over, and the loser is erased with the normal erase function (after its identifiers are detached so the
// erase cannot touch the merged history).

import type { Runtime } from "../app";
import { PERSONAL_EMAIL_DOMAINS } from "../config";
import { getLead, parseAnswers, updateLead, type Lead } from "../funnel/leads";
import { suppress } from "../lib/suppress";
import { cancelAllEmails } from "../integrations/email";
import { cancelCalls } from "../integrations/elevenlabs";
import { confirmBooking } from "../integrations/booking";
import { eraseLead } from "../sales/erase";
import { syncCash } from "../sales/outcomes";
import { syncReceivables } from "../sales/receivables";
import { all, one, num } from "./stats";

const DAY = 86_400_000;

export interface DupLead { id: string; ref_code: string; created_at: number; first_name: string | null; last_name: string | null; email: string; phone: string | null; visitor_id: string | null; status: string; tier: string | null }
export interface DupPair { survivor: DupLead; loser: DupLead; reasons: string[] }

const norm = (s: string | null | undefined) => (s || "").trim().toLowerCase().replace(/\s+/g, " ");
const domainOf = (email: string) => (email.toLowerCase().split("@")[1] || "").trim();

/** Pure: duplicate pairs from a list of leads. One pair per two leads, with every reason that matched. */
export function findDuplicates(leads: DupLead[], personal: string[] = PERSONAL_EMAIL_DOMAINS): DupPair[] {
  const pairs = new Map<string, DupPair>();
  const add = (group: DupLead[], reason: string) => {
    if (group.length < 2 || group.length > 20) return; // huge groups are shared values (a test number), not people
    const sorted = [...group].sort((a, b) => a.created_at - b.created_at || a.id.localeCompare(b.id));
    for (let i = 1; i < sorted.length; i++) {
      const s = sorted[0], l = sorted[i];
      const key = `${s.id}|${l.id}`;
      const p = pairs.get(key) || { survivor: s, loser: l, reasons: [] };
      if (!p.reasons.includes(reason)) p.reasons.push(reason);
      pairs.set(key, p);
    }
  };
  const group = (keyOf: (l: DupLead) => string | null) => {
    const m = new Map<string, DupLead[]>();
    for (const l of leads) { const k = keyOf(l); if (!k) continue; if (!m.has(k)) m.set(k, []); m.get(k)!.push(l); }
    return m;
  };
  for (const g of group((l) => (l.phone && /^\+\d{7,16}$/.test(l.phone) ? l.phone : null)).values()) add(g, "same phone");
  for (const g of group((l) => (l.visitor_id ? l.visitor_id : null)).values()) add(g, "same browser");
  for (const g of group((l) => {
    const d = domainOf(l.email);
    const name = norm(`${l.first_name || ""} ${l.last_name || ""}`);
    if (!d || personal.includes(d) || !l.first_name || !l.last_name || name.length < 4) return null;
    return `${name}@${d}`;
  }).values()) add(g, "same name and company domain");
  return [...pairs.values()].sort((a, b) => b.loser.created_at - a.loser.created_at);
}

async function candidateLeads(rt: Runtime): Promise<DupLead[]> {
  return all<DupLead>(rt,
    `SELECT id, ref_code, created_at, first_name, last_name, email, phone, visitor_id, status, COALESCE(tier_override, tier) AS tier
     FROM leads ORDER BY created_at DESC LIMIT 20000`);
}

export async function duplicatesReport(rt: Runtime) {
  const pairs = findDuplicates(await candidateLeads(rt));
  return { total: pairs.length, pairs: pairs.slice(0, 200) };
}

export async function dataQuality(rt: Runtime) {
  const since = rt.now() - 90 * DAY;
  const [l, b, dups] = await Promise.all([
    one<Record<string, number>>(rt,
      `SELECT COUNT(*) AS n, SUM(app_completed_at IS NOT NULL) AS applied,
         SUM(app_completed_at IS NOT NULL AND (phone IS NULL OR phone = '')) AS no_phone,
         SUM(COALESCE(ft_channel, channel, utm_source, '') = '') AS no_source,
         SUM(COALESCE(tier_override, tier) IS NULL AND app_completed_at IS NOT NULL) AS unscored
       FROM leads WHERE created_at >= ? AND booking_source = 'funnel'`, [since]),
    one<{ n: number; orphan: number }>(rt, "SELECT COUNT(*) AS n, SUM(lead_id IS NULL) AS orphan FROM calendly_bookings WHERE created_at >= ?", [since]).catch(() => null),
    candidateLeads(rt).then((x) => findDuplicates(x).length),
  ]);
  const p = (a: number, b: number) => (b > 0 ? Math.round((a / b) * 1000) / 10 : null);
  return {
    window_days: 90,
    leads: num(l?.n), applied: num(l?.applied),
    missing_phone: num(l?.no_phone), missing_phone_pct: p(num(l?.no_phone), num(l?.applied)),
    no_source: num(l?.no_source), no_source_pct: p(num(l?.no_source), num(l?.n)),
    unscored: num(l?.unscored),
    bookings: num(b?.n), unmatched_bookings: num(b?.orphan), unmatched_bookings_pct: p(num(b?.orphan), num(b?.n)),
    duplicate_candidates: dups,
  };
}

// ── Merge ────────────────────────────────────────────────────────────────────

export const STAGE_RANK: Record<string, number> = { partial: 0, applied: 1, nurture: 1, disqualified: 1, booked: 2, no_show: 3, showed: 4, lost: 5, won: 6 };

/** Columns that travel with the stage: taken from the loser when the loser is further along. */
const STAGE_COLS = [
  "status", "booked_at", "call_at", "booking_provider", "booking_ref", "booking_cancelled_at", "booking_join_url", "booking_reschedule_url",
  "booking_cancel_url", "booking_host_email", "booking_answers", "booking_source", "booking_verified", "showed_at", "closed_at", "revenue",
  "lost_reason", "offer", "payment_plan", "installments_total", "next_payment_at", "contract_signed_at", "refunded_at", "refund_amount",
  "loi_signed_at", "temperature", "objection", "follow_up_at", "decision_maker", "fit_rating", "target_business",
] as const;
/** Filled from the loser only where the survivor has nothing. */
const FILL_COLS = [
  "first_name", "last_name", "phone", "closer_id", "setter_id", "score", "score_breakdown", "tier", "tier_override", "route", "app_started_at",
  "app_completed_at", "industry", "revenue_band", "budget_band", "willing_to_invest", "qual_source", "qual_flags", "timezone", "call_consent_at",
  "call_consent_text", "visitor_id", "country", "region", "city", "device",
] as const;

/** Pure: the survivor patch. */
export function mergePatch(survivor: Lead, loser: Lead): Partial<Lead> {
  const s = survivor as unknown as Record<string, unknown>, l = loser as unknown as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  const empty = (v: unknown) => v == null || v === "";
  for (const k of FILL_COLS) if (empty(s[k]) && !empty(l[k])) out[k] = l[k];
  if ((STAGE_RANK[loser.status] ?? 0) > (STAGE_RANK[survivor.status] ?? 0)) for (const k of STAGE_COLS) out[k] = l[k] ?? null;
  const answers = { ...parseAnswers(loser), ...parseAnswers(survivor) };
  if (JSON.stringify(answers) !== (survivor.answers || "{}")) out.answers = JSON.stringify(answers);
  out.step_reached = Math.max(survivor.step_reached || 0, loser.step_reached || 0);
  // Opt-outs are honoured: the earliest one wins.
  for (const k of ["unsubscribed_at", "do_not_call_at"] as const) {
    const v = [survivor[k], loser[k]].filter((x): x is number => typeof x === "number");
    if (v.length && survivor[k] == null) out[k] = Math.min(...v);
  }
  if (loser.notes && loser.notes !== survivor.notes) out.notes = [survivor.notes, `Merged from ${loser.ref_code}: ${loser.notes}`].filter(Boolean).join("\n\n").slice(0, 5000);
  if (survivor.revenue === 0 && loser.revenue > 0 && !("revenue" in out)) out.revenue = loser.revenue;
  return out as Partial<Lead>;
}

const KNOWN_TABLES = ["visitors", "sessions", "events", "vsl_views", "emails", "whatsapp_messages", "voice_calls", "forward_log", "outbound_calls", "calendly_bookings", "payments", "lead_revops", "receivables", "touches"];
const SKIP_TABLES = new Set(["leads", "audit_log"]);

/** Every table with a lead_id column, from the schema; the known list when the schema cannot be read. */
export async function leadTables(rt: Runtime): Promise<string[]> {
  try {
    const rows = await all<{ name: string }>(rt,
      `SELECT m.name AS name FROM sqlite_master m JOIN pragma_table_info(m.name) p ON p.name = 'lead_id'
       WHERE m.type = 'table' AND m.name NOT LIKE 'sqlite_%' AND m.name NOT LIKE '_cf_%' AND m.name NOT LIKE 'd1_%'`);
    const names = rows.map((r) => r.name).filter((n) => /^[a-z_][a-z0-9_]*$/i.test(n) && !SKIP_TABLES.has(n));
    if (names.length) return [...new Set([...names])];
  } catch { /* fall through */ }
  return KNOWN_TABLES;
}

export class MergeError extends Error {}

export async function mergeLeads(rt: Runtime, aId: string, bId: string): Promise<{ survivor: Lead; loser_ref: string; tables: string[] }> {
  if (aId === bId) throw new MergeError("Pick two different leads.");
  const [a, b] = await Promise.all([getLead(rt, aId), getLead(rt, bId)]);
  if (!a || !b) throw new MergeError("Lead not found.");
  const [survivor, loser] = a.created_at < b.created_at || (a.created_at === b.created_at && a.id < b.id) ? [a, b] : [b, a];
  const db = rt.env.DB;
  // Stop everything queued for the duplicate first.
  await cancelAllEmails(rt, loser.id);
  await cancelCalls(rt, loser.id, ["confirm", "speed_to_lead", "rebook"]);
  if (loser.unsubscribed_at) await suppress(rt, "email", loser.email);
  if (loser.do_not_call_at) await suppress(rt, "phone", loser.phone);

  const tables = await leadTables(rt);
  const S = survivor.id, L = loser.id;
  const stmts = [];
  for (const t of tables) {
    if (t === "lead_revops") {
      // Keep the survivor's row; adopt the loser's only when the survivor has none.
      stmts.push(db.prepare("UPDATE OR IGNORE lead_revops SET lead_id = ? WHERE lead_id = ?").bind(S, L));
      stmts.push(db.prepare("DELETE FROM lead_revops WHERE lead_id = ?").bind(L));
    } else {
      // OR IGNORE: rows that would collide with one of the survivor's (the same email step) stay behind and are erased.
      stmts.push(db.prepare(`UPDATE OR IGNORE ${t} SET lead_id = ? WHERE lead_id = ?`).bind(S, L));
    }
  }
  await db.batch(stmts);

  // Referral credit the loser earned moves to the survivor before the erase trigger
  // (trg_leads_growth_erase deletes rows WHERE referrer_lead_id = the erased lead). A referral of oneself
  // that the merge creates (the survivor referred the loser, or the reverse) is dropped.
  await db.batch([
    db.prepare("UPDATE OR IGNORE lead_referrals SET referrer_lead_id = ? WHERE referrer_lead_id = ?").bind(S, L),
    db.prepare("UPDATE OR IGNORE visitor_referrals SET referrer_lead_id = ? WHERE referrer_lead_id = ?").bind(S, L),
    db.prepare("DELETE FROM lead_referrals WHERE lead_id = referrer_lead_id"),
  ]);

  const patch = mergePatch(survivor, loser);
  await updateLead(rt, S, patch);
  // Detach the loser's identifiers so its erasure cannot reach the merged history (shared browser, bookings by email, calls by phone).
  await db.prepare("UPDATE leads SET email = ?, phone = NULL, visitor_id = NULL, updated_at = ? WHERE id = ?").bind(`merged+${L}@invalid.invalid`, rt.now(), L).run();
  for (const t of tables) if (!KNOWN_TABLES.includes(t) && t !== "lead_revops") await db.prepare(`DELETE FROM ${t} WHERE lead_id = ?`).bind(L).run();
  await eraseLead(rt, L);
  await syncCash(rt, S);
  const fresh = (await getLead(rt, S)) as Lead;
  await syncReceivables(rt, fresh);
  // The loser held the live, verified booking: its reminders and confirm call were cancelled above, so
  // start them for the survivor the way a confirmed booking does (no second Meta Schedule event or ping).
  if (patch.booking_ref && patch.booking_ref === loser.booking_ref && fresh.booking_verified && fresh.status === "booked"
    && !fresh.booking_cancelled_at && fresh.call_at && fresh.call_at > rt.now()) {
    await confirmBooking(rt, fresh);
  }
  return { survivor: (await getLead(rt, S)) as Lead, loser_ref: loser.ref_code, tables };
}
