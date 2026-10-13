// One metric dictionary for Funnel HQ. Every number a report shows is defined here once: its label,
// the sentence shown behind the "?" on a tile, and its basis. Overview, Traffic, Application, Insights
// and the Sales tab all read their labels and definitions from this file, and the SQL that counts them
// lives next to it (stats.ts windowCounts for event-dated counts, funnelCohort below for the funnel).
//
// Two bases, never mixed inside one table:
//   "event"  — things that happened in the period, dated by when they happened (applications completed,
//              calls booked, deals won, cash collected). Tiles and trend lines use this.
//   "cohort" — people who were active in the period (a non-bot visit, or a funnel lead created), and how
//              far each of them has got so far. The funnel uses this, so a step can never be larger than
//              the step above it.
// Test leads and our own browsers are excluded from both unless "Include test data" is on.

import type { Runtime } from "../app";
import { all, leadDims, one, sessDims, visitorDims, type Filters } from "./stats";

export type Basis = "visitors" | "event" | "cohort" | "ratio" | "leads";

export interface MetricDef {
  id: string;
  label: string;
  /** Plain-English definition shown in the tile tooltip. */
  definition: string;
  basis: Basis;
}

const D = (id: string, label: string, basis: Basis, definition: string): MetricDef => ({ id, label, basis, definition });

export const METRICS: Record<string, MetricDef> = Object.fromEntries([
  D("visitors", "Visitors", "visitors", "Unique browsers with at least one non-bot visit that started in the period. Our own browsers and test traffic are left out."),
  D("plays", "Played the film", "visitors", "Visitors whose first play of the main film was in the period."),
  D("play_rate", "Play rate", "ratio", "Played the film ÷ visitors, both in the period."),
  D("pitch_rate", "Pitch reached", "ratio", "Of the people who played the film in the period, the share who watched up to the offer (the pitch)."),
  D("saw_form", "Saw the form", "visitors", "Unique people who saw the application in the period: the embedded form came into view (app_view) or they opened /apply. Anyone who left contact details counts too, because they used the form."),
  D("optins", "Left contact details", "leads", "Funnel leads created in the period: someone typed their name and email on the first step."),
  D("optin_rate", "Opt-in rate", "ratio", "Left contact details ÷ visitors, both in the period."),
  D("contact_rate", "Form → contact", "ratio", "Left contact details ÷ saw the form. Never above 100%: everyone who left details saw the form."),
  D("applied", "Applications", "event", "Applications completed in the period, dated by when they were submitted."),
  D("qualified", "Qualified", "event", "Applications completed in the period that scored A or B (after any manual tier override)."),
  D("booked", "Booked calls", "event", "Calls booked in the period, dated by when the booking was made (not the call date)."),
  D("showed", "Showed", "event", "Calls held in the period, dated by the call."),
  D("won", "Won", "event", "Deals marked won in the period, dated by the close."),
  D("revenue", "Revenue", "event", "Deal value of deals won in the period."),
  D("cash", "Cash collected", "event", "Payments recorded in the period (refunds count as negative)."),
  D("whatsapp", "WhatsApp clicks", "event", "Taps on a WhatsApp button in the period."),
  D("spend", "Ad spend", "event", "Spend on every platform for the days in the period."),
  D("cac", "CAC", "ratio", "Ad spend ÷ deals won in the period. Blended: every deal, paid or not."),
  D("cash_roas", "Cash ROAS", "ratio", "Cash collected ÷ ad spend, both in the period."),
  D("cost_per_booked", "Cost per booked call", "ratio", "Ad spend ÷ calls booked in the period."),
  D("completion_rate", "Completion", "ratio", "Of the leads created in the period, the share who finished the application."),
  D("median_time", "Median time", "leads", "Median time from the first application step to submit, for applications started in the period. Shown in seconds under a minute."),
  D("avg_score", "Average score", "leads", "Average score (0–100) of applications completed by leads created in the period."),
  D("show_rate", "Show rate", "ratio", "Calls held ÷ (held + no-shows), for calls dated in the period."),
  D("close_rate", "Close rate", "ratio", "Deals won ÷ calls held, for calls dated in the period."),
  D("held", "Held", "event", "Calls in the period that happened (showed, won or lost after the call)."),
  D("offer_rate", "Offer %", "ratio", "Held calls where the closer logged that an offer was made ÷ held calls with a review."),
  D("close_of_offers", "Close % of offers", "ratio", "Deals won ÷ held calls where an offer was made."),
  D("cash_on_call", "Cash on call", "event", "Payments recorded within 24 hours after a held call."),
  D("cycle_days", "Cycle", "event", "Median days from booking the call to the deal being won."),
  D("per_call_held", "$ per call held", "ratio", "Cash collected from leads whose call was held in the period ÷ calls held."),
  D("best_source", "Best source", "event", "The source with the most booked calls (then cash) in the period. Needs 5+ bookings before it names a winner."),
  // The funnel (cohort basis).
  D("f_landed", "Landed", "cohort", "People active in the period: a non-bot visit started in the period, or a funnel lead created in it."),
  D("f_saw_form", "Saw the form", "cohort", "Of those people, everyone who saw the application (app_view or /apply) or got further."),
  D("f_contact", "Left contact details", "cohort", "Everyone who left their name and email, or got further."),
  D("f_applied", "Applied", "cohort", "Everyone who submitted the application, or got further."),
  D("f_qualified", "Qualified (A/B)", "cohort", "Everyone who scored A or B, or got further."),
  D("f_booked", "Booked", "cohort", "Everyone who booked a call, or got further."),
  D("f_showed", "Showed", "cohort", "Everyone who showed up to their call, or got further."),
  D("f_won", "Won", "cohort", "Everyone who became a client."),
].map((m) => [m.id, m]));

/** The dictionary as the browser sees it. */
export function metricsPayload() {
  return { metrics: Object.values(METRICS), small_n: SMALL_N };
}

// ── Small samples ────────────────────────────────────────────────────────────

/** Rates with a denominator below this are shown muted with n and an interval. */
export const SMALL_N = 20;
/** Bookings a source needs before "Best source" names it. */
export const BEST_MIN_BOOKINGS = 5;

/** Wilson score interval for k successes out of n (default 90%: z = 1.645), as proportions 0..1. */
export function wilson(k: number, n: number, z = 1.645): [number, number] | null {
  if (!(n > 0) || k < 0 || k > n) return null;
  const p = k / n, z2 = z * z;
  const den = 1 + z2 / n;
  const mid = (p + z2 / (2 * n)) / den;
  const half = (z * Math.sqrt((p * (1 - p)) / n + z2 / (4 * n * n))) / den;
  return [Math.max(0, mid - half), Math.min(1, mid + half)];
}

/** Pick the best row by booked calls, then cash, only when it has enough bookings. */
export function bestBy<T extends { booked: number; cash: number }>(rows: T[], min = BEST_MIN_BOOKINGS): T | null {
  const ok = rows.filter((r) => r.booked >= min);
  if (!ok.length) return null;
  return ok.slice().sort((a, b) => b.booked - a.booked || b.cash - a.cash)[0];
}

// ── Funnel (cohort basis) ────────────────────────────────────────────────────

export const FUNNEL_STEPS = ["f_landed", "f_saw_form", "f_contact", "f_applied", "f_qualified", "f_booked", "f_showed", "f_won"] as const;

/** Lead stage index on the FUNNEL_STEPS scale (2 = left contact details … 7 = won). */
export const LEAD_STAGE_SQL = `CASE
  WHEN l.status = 'won' THEN 7
  WHEN l.showed_at IS NOT NULL OR l.status = 'showed' THEN 6
  WHEN l.booked_at IS NOT NULL OR l.status IN ('booked','no_show','showed') THEN 5
  WHEN l.app_completed_at IS NOT NULL AND COALESCE(l.tier_override, l.tier) IN ('A','B') THEN 4
  WHEN l.app_completed_at IS NOT NULL THEN 3
  ELSE 2 END`;

/** Pure: per-person maximum stages → counts per step (non-increasing by construction). */
export function stepCounts(stages: number[]): number[] {
  const out = new Array(FUNNEL_STEPS.length).fill(0);
  for (const s of stages) for (let i = 0; i <= Math.min(s, FUNNEL_STEPS.length - 1); i++) out[i]++;
  return out;
}

/**
 * People active in the period and the furthest step each has reached so far. A person is a browser
 * (visitor id) or, for a lead with no browser, the lead itself.
 */
export async function funnelCohort(rt: Runtime, f: Filters, from = f.since, to = f.until) {
  const sd = sessDims(f, "s");
  const ld = leadDims(f, "l");
  const vdE = visitorDims(f, "e.visitor_id");
  const [people, forms, leads] = await Promise.all([
    all<{ pid: string }>(rt, `SELECT DISTINCT s.visitor_id AS pid FROM sessions s WHERE s.is_bot = 0 AND s.started_at >= ? AND s.started_at < ?${sd.sql} LIMIT 200000`, [from, to, ...sd.binds]),
    all<{ pid: string }>(rt,
      `SELECT DISTINCT e.visitor_id AS pid FROM events e WHERE e.is_bot = 0 AND e.visitor_id IS NOT NULL AND e.ts >= ? AND e.ts < ?
         AND (e.name = 'app_view' OR (e.name = 'page_view' AND e.path = '/apply'))${vdE.sql} LIMIT 200000`, [from, to, ...vdE.binds]),
    all<{ pid: string; stage: number; created_at: number }>(rt,
      `SELECT COALESCE(l.visitor_id, l.id) AS pid, ${LEAD_STAGE_SQL} AS stage, l.created_at
       FROM leads l WHERE l.booking_source = 'funnel' AND (
         (l.created_at >= ? AND l.created_at < ?)
         OR l.visitor_id IN (SELECT s.visitor_id FROM sessions s WHERE s.is_bot = 0 AND s.started_at >= ? AND s.started_at < ?${sd.sql})
       )${ld.sql} LIMIT 200000`, [from, to, from, to, ...sd.binds, ...ld.binds]),
  ]);
  const stage = new Map<string, number>();
  for (const p of people) stage.set(p.pid, 0);
  for (const p of forms) if (stage.has(p.pid)) stage.set(p.pid, Math.max(stage.get(p.pid) || 0, 1));
  for (const l of leads) stage.set(l.pid, Math.max(stage.get(l.pid) ?? 0, Number(l.stage) || 2));
  const counts = stepCounts([...stage.values()]);
  return FUNNEL_STEPS.map((id, i) => {
    const prev = i ? counts[i - 1] : null;
    return {
      key: id, label: METRICS[id].label, n: counts[i],
      prev: prev,
      step: prev ? Math.round((counts[i] / prev) * 1000) / 10 : null,
      of_total: counts[0] ? Math.round((counts[i] / counts[0]) * 1000) / 10 : null,
    };
  });
}

/** Unique people who saw the application in the period, including everyone who left details (event basis). */
export async function sawFormCount(rt: Runtime, f: Filters, from = f.since, to = f.until): Promise<number> {
  const vdE = visitorDims(f, "e.visitor_id");
  const ld = leadDims(f, "l");
  const r = await one<{ n: number }>(rt,
    `SELECT COUNT(*) AS n FROM (
       SELECT e.visitor_id AS pid FROM events e WHERE e.is_bot = 0 AND e.visitor_id IS NOT NULL AND e.ts >= ? AND e.ts < ?
         AND (e.name = 'app_view' OR (e.name = 'page_view' AND e.path = '/apply'))${vdE.sql}
       UNION
       SELECT COALESCE(l.visitor_id, l.id) AS pid FROM leads l WHERE l.booking_source = 'funnel' AND l.created_at >= ? AND l.created_at < ?${ld.sql}
     )`, [from, to, ...vdE.binds, from, to, ...ld.binds]);
  return Number(r?.n) || 0;
}
