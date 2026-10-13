// Honest cohort capacity. Places are computed from real data, never typed: capacity minus the clients who
// joined that cohort. Membership is explicit when the team assigns a client (Cohorts tab), otherwise a won
// deal (not refunded) belongs to the cohort whose window contains its closed_at: after the previous
// cohort's apply-by day, up to and including this cohort's apply-by day. This needs no change to the sales
// code: marking a deal won (or refunding it) moves the count by itself.

import type { Runtime } from "../app";
import { BRAND } from "../config";
import { newId } from "../lib/ids";
import { marketingPause } from "../lib/suppress";
import { getLead, type Lead } from "../funnel/leads";
import { sendOneOff } from "../integrations/email";
import { validTimezone, zonedTime } from "../integrations/sequences";
import { setCohortSnapshot, type CohortCopy } from "./snapshot";

export interface CohortRow {
  id: string;
  starts_on: string;
  capacity: number;
  apply_by: string;
  status: "draft" | "open" | "closed";
  created_at: number;
  updated_at: number;
}

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const DAY = 86_400_000;

export function validDate(s: unknown): s is string {
  const m = DATE_RE.exec(String(s ?? ""));
  if (!m) return false;
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  return d.getUTCFullYear() === +m[1] && d.getUTCMonth() === +m[2] - 1 && d.getUTCDate() === +m[3];
}

export function salesZone(rt: Runtime): string {
  const tz = rt.settings.get("SALES_TIMEZONE");
  return validTimezone(tz) ? tz : BRAND.salesTimezone;
}

/** The last moment of a calendar day in `tz`. */
export function endOfDay(ymd: string, tz: string): number {
  const m = DATE_RE.exec(ymd);
  if (!m) return 0;
  return zonedTime(+m[1], +m[2], +m[3], 23, 59, tz) + 59_999;
}

/** "Monday 3 November" (the year is added when it differs from `now`'s year). */
export function fmtDay(ymd: string, now = Date.now()): string {
  const m = DATE_RE.exec(ymd);
  if (!m) return ymd;
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], 12));
  const withYear = d.getUTCFullYear() !== new Date(now).getUTCFullYear();
  const p: Record<string, string> = {};
  for (const x of new Intl.DateTimeFormat("en-GB", { timeZone: "UTC", weekday: "long", day: "numeric", month: "long", year: "numeric" }).formatToParts(d)) p[x.type] = x.value;
  return `${p.weekday} ${p.day} ${p.month}${withYear ? ` ${p.year}` : ""}`;
}

/**
 * Pure: counts won deals per cohort window. `cohorts` excludes drafts; windows chain by apply-by date, and
 * the first cohort's window starts when it was created (earlier clients are not counted against it).
 */
export function bucketWins(cohorts: Array<Pick<CohortRow, "id" | "apply_by" | "created_at">>, closedAts: number[], tz: string): Map<string, number> {
  const sorted = [...cohorts].sort((a, b) => a.apply_by.localeCompare(b.apply_by));
  const out = new Map<string, number>(sorted.map((c) => [c.id, 0]));
  sorted.forEach((c, i) => {
    const lower = i === 0 ? c.created_at : endOfDay(sorted[i - 1].apply_by, tz) + 1;
    const upper = endOfDay(c.apply_by, tz);
    out.set(c.id, closedAts.filter((t) => t >= lower && t <= upper).length);
  });
  return out;
}

/** Pure: the public line. Never shown without an open cohort with places. */
export function cohortLine(c: CohortCopy): string {
  const places = c.open === 1 ? "1 place is open" : `${c.open} places are open`;
  return `Next build cohort starts ${c.starts}. We take ${c.capacity} businesses per cohort; ${places}. Applications for this cohort close ${c.applyBy}.`;
}

export async function listCohorts(rt: Runtime): Promise<CohortRow[]> {
  try {
    return (await rt.env.DB.prepare("SELECT * FROM cohorts ORDER BY starts_on ASC").all<CohortRow>()).results || [];
  } catch {
    return []; // before the migration
  }
}

/** Seats taken per cohort: explicit members plus won deals in the window (without a member row). */
export async function seatsTaken(rt: Runtime, cohorts: CohortRow[]): Promise<Map<string, number>> {
  const live = cohorts.filter((c) => c.status !== "draft");
  const out = new Map<string, number>(cohorts.map((c) => [c.id, 0]));
  if (!live.length) return out;
  const db = rt.env.DB;
  const since = Math.min(...live.map((c) => c.created_at));
  const [members, wins] = await Promise.all([
    db.prepare(
      `SELECT m.cohort_id AS id, COUNT(*) AS n FROM cohort_members m JOIN leads l ON l.id = m.lead_id
       WHERE l.status = 'won' AND l.refunded_at IS NULL GROUP BY m.cohort_id`,
    ).all<{ id: string; n: number }>(),
    db.prepare(
      `SELECT closed_at FROM leads WHERE status = 'won' AND refunded_at IS NULL AND closed_at IS NOT NULL AND closed_at >= ?
       AND id NOT IN (SELECT lead_id FROM cohort_members)`,
    ).bind(since).all<{ closed_at: number }>(),
  ]);
  const buckets = bucketWins(live, (wins.results || []).map((r) => r.closed_at), salesZone(rt));
  for (const c of cohorts) out.set(c.id, (buckets.get(c.id) || 0));
  for (const m of members.results || []) if (out.has(m.id)) out.set(m.id, (out.get(m.id) || 0) + m.n);
  return out;
}

export function toCopy(c: CohortRow, taken: number, now: number): CohortCopy {
  return { id: c.id, starts: fmtDay(c.starts_on, now), applyBy: fmtDay(c.apply_by, now), capacity: c.capacity, open: Math.max(0, c.capacity - taken) };
}

let cache: { at: number; copy: CohortCopy | null } | null = null;

/**
 * The next cohort that is open, still taking applications and has places, as public copy. Cached per
 * isolate for a minute; also primes the email snapshot. Null when there is none (nothing is shown).
 */
export async function nextCohort(rt: Runtime): Promise<CohortCopy | null> {
  const now = rt.now();
  if (cache && now - cache.at < 60_000) return cache.copy;
  const all = await listCohorts(rt);
  const tz = salesZone(rt);
  const open = all.filter((c) => c.status === "open" && endOfDay(c.apply_by, tz) >= now);
  let copy: CohortCopy | null = null;
  if (open.length) {
    const taken = await seatsTaken(rt, all);
    for (const c of open) {
      const x = toCopy(c, taken.get(c.id) || 0, now);
      if (x.open > 0) { copy = x; break; }
    }
  }
  cache = { at: now, copy };
  setCohortSnapshot(copy, now);
  return copy;
}

export function clearCohortCache(): void { cache = null; }

export interface CohortInput { starts_on?: unknown; capacity?: unknown; apply_by?: unknown; status?: unknown }
export class CohortError extends Error {}

export async function saveCohort(rt: Runtime, id: string | null, b: CohortInput): Promise<CohortRow> {
  const now = rt.now();
  const existing = id ? await rt.env.DB.prepare("SELECT * FROM cohorts WHERE id = ?").bind(id).first<CohortRow>() : null;
  if (id && !existing) throw new CohortError("Not found.");
  const starts = b.starts_on === undefined ? existing?.starts_on : String(b.starts_on);
  const applyBy = b.apply_by === undefined ? existing?.apply_by : String(b.apply_by);
  const capacity = b.capacity === undefined ? existing?.capacity : Math.round(Number(b.capacity));
  const status = String(b.status ?? existing?.status ?? "draft");
  if (!validDate(starts)) throw new CohortError("Start date must be a date (YYYY-MM-DD).");
  if (!validDate(applyBy)) throw new CohortError("Apply-by date must be a date (YYYY-MM-DD).");
  if (applyBy > starts) throw new CohortError("Applications must close on or before the start date.");
  if (!Number.isFinite(capacity) || (capacity as number) < 1 || (capacity as number) > 200) throw new CohortError("Capacity must be between 1 and 200.");
  if (!["draft", "open", "closed"].includes(status)) throw new CohortError("Unknown status.");
  const cid = existing?.id || newId("co");
  await rt.env.DB.prepare(
    `INSERT INTO cohorts (id, starts_on, capacity, apply_by, status, created_at, updated_at) VALUES (?,?,?,?,?,?,?)
     ON CONFLICT(id) DO UPDATE SET starts_on = excluded.starts_on, capacity = excluded.capacity, apply_by = excluded.apply_by,
       status = excluded.status, updated_at = excluded.updated_at`,
  ).bind(cid, starts, capacity, applyBy, status, existing?.created_at || now, now).run();
  clearCohortCache();
  return (await rt.env.DB.prepare("SELECT * FROM cohorts WHERE id = ?").bind(cid).first<CohortRow>())!;
}

export async function deleteCohort(rt: Runtime, id: string): Promise<void> {
  await rt.env.DB.batch([
    rt.env.DB.prepare("DELETE FROM cohort_members WHERE cohort_id = ?").bind(id),
    rt.env.DB.prepare("DELETE FROM cohort_notices WHERE cohort_id = ?").bind(id),
    rt.env.DB.prepare("DELETE FROM cohorts WHERE id = ?").bind(id),
  ]);
  clearCohortCache();
}

/** Explicit membership (or "" to go back to the automatic window rule). */
export async function assignMember(rt: Runtime, leadId: string, cohortId: string): Promise<void> {
  if (!cohortId) await rt.env.DB.prepare("DELETE FROM cohort_members WHERE lead_id = ?").bind(leadId).run();
  else await rt.env.DB.prepare(
    "INSERT INTO cohort_members (lead_id, cohort_id, assigned_at) VALUES (?,?,?) ON CONFLICT(lead_id) DO UPDATE SET cohort_id = excluded.cohort_id, assigned_at = excluded.assigned_at",
  ).bind(leadId, cohortId, rt.now()).run();
  clearCohortCache();
}

/** Admin view: every cohort with seats taken and its members (explicit or by window). */
export async function cohortsReport(rt: Runtime) {
  const all = await listCohorts(rt);
  const taken = await seatsTaken(rt, all);
  const tz = salesZone(rt);
  const live = all.filter((c) => c.status !== "draft").sort((a, b) => a.apply_by.localeCompare(b.apply_by));
  const wins = (await rt.env.DB.prepare(
    `SELECT l.id, l.first_name, l.last_name, l.ref_code, l.closed_at, m.cohort_id AS member_of FROM leads l LEFT JOIN cohort_members m ON m.lead_id = l.id
     WHERE l.status = 'won' AND l.refunded_at IS NULL ORDER BY l.closed_at DESC LIMIT 300`,
  ).all<{ id: string; first_name: string | null; last_name: string | null; ref_code: string; closed_at: number | null; member_of: string | null }>()).results || [];
  const windowOf = (t: number | null): string | null => {
    if (!t) return null;
    for (let i = 0; i < live.length; i++) {
      const lower = i === 0 ? live[i].created_at : endOfDay(live[i - 1].apply_by, tz) + 1;
      if (t >= lower && t <= endOfDay(live[i].apply_by, tz)) return live[i].id;
    }
    return null;
  };
  const next = await nextCohort(rt);
  return {
    timezone: tz,
    next: next ? { ...next, line: cohortLine(next) } : null,
    notice_days: noticeDays(rt),
    cohorts: all.map((c) => ({ ...c, taken: taken.get(c.id) || 0, open: Math.max(0, c.capacity - (taken.get(c.id) || 0)), notices: 0 })),
    clients: wins.map((w) => ({
      id: w.id, name: [w.first_name, w.last_name].filter(Boolean).join(" ") || w.ref_code, ref: w.ref_code, closed_at: w.closed_at,
      cohort_id: w.member_of || windowOf(w.closed_at), explicit: !!w.member_of,
    })),
  };
}

// ── "Applications close soon" email ──────────────────────────────────────────

/** Days before apply-by when open A/B leads get one note (setting COHORT_NOTICE_DAYS, default 4; 0 turns it off). */
export function noticeDays(rt: Runtime): number {
  return Math.max(0, Math.min(21, rt.settings.num("COHORT_NOTICE_DAYS", 4)));
}

/** Pure: which leads may get the note. */
export function noticeEligible(l: Pick<Lead, "status" | "tier" | "tier_override" | "app_completed_at" | "unsubscribed_at" | "booking_source" | "call_at" | "booking_cancelled_at">): boolean {
  const tier = l.tier_override || l.tier;
  return l.status === "applied" && (tier === "A" || tier === "B") && !!l.app_completed_at && !l.unsubscribed_at && l.booking_source === "funnel";
}

/**
 * Sends the note to open A/B leads once per cohort, inside the notice window before apply-by. At most
 * `limit` per run; safe to call often (cron, the Cohorts tab). The template reads the primed snapshot.
 */
export async function sendCohortNotices(rt: Runtime, limit = 25): Promise<{ sent: number; reason?: string }> {
  clearCohortCache();
  const c = await nextCohort(rt);
  if (!c) return { sent: 0, reason: "no open cohort with places" };
  const days = noticeDays(rt);
  if (!days) return { sent: 0, reason: "turned off (COHORT_NOTICE_DAYS = 0)" };
  const row = await rt.env.DB.prepare("SELECT * FROM cohorts WHERE id = ?").bind(c.id).first<CohortRow>();
  if (!row) return { sent: 0, reason: "cohort gone" };
  const close = endOfDay(row.apply_by, salesZone(rt));
  if (rt.now() < close - days * DAY) return { sent: 0, reason: `too early: notes go out ${days} days before applications close` };
  if (await marketingPause(rt)) return { sent: 0, reason: "marketing email is paused (deliverability)" };
  const leads = (await rt.env.DB.prepare(
    `SELECT id FROM leads WHERE status = 'applied' AND app_completed_at IS NOT NULL AND unsubscribed_at IS NULL AND booking_source = 'funnel'
       AND COALESCE(tier_override, tier) IN ('A','B') AND app_completed_at > ?
       AND id NOT IN (SELECT lead_id FROM cohort_notices WHERE cohort_id = ?) ORDER BY app_completed_at DESC LIMIT ?`,
  ).bind(rt.now() - 120 * DAY, c.id, limit).all<{ id: string }>()).results || [];
  let sent = 0;
  for (const r of leads) {
    const lead = await getLead(rt, r.id);
    if (!lead || !noticeEligible(lead)) continue;
    const claim = await rt.env.DB.prepare("INSERT OR IGNORE INTO cohort_notices (cohort_id, lead_id, sent_at) VALUES (?,?,?)").bind(c.id, lead.id, rt.now()).run();
    if (!claim.meta?.changes) continue;
    if (await sendOneOff(rt, lead, "cohort", "co_apply_by")) sent++;
  }
  return { sent };
}
