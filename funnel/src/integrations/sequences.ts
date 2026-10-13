// Email sequences. Steps are APPEND-ONLY: the step index is the dedupe key (lead_id, sequence, step).
// Never reorder or insert in the middle; add new steps at the end.

import type { Lead } from "../funnel/leads";

const M = 60_000;
const H = 60 * M;
const D = 24 * H;

export interface Step {
  template: string;
  /** Offset from the anchor in ms (negative = before the call). */
  offset: number;
  /** "enqueue" (default) = time of enqueue; "call" = the booked call time. */
  anchor?: "enqueue" | "call";
  /** Skip this step at send time when true (re-checked against fresh lead data). */
  skipIf?: (lead: Lead) => boolean;
}

export interface Sequence {
  id: string;
  label: string;
  trigger: string;
  steps: Step[];
  /** Stop the whole sequence (cancel remaining) when true at send time. */
  stopIf: (lead: Lead) => boolean;
}

const BOOKED_LIKE = new Set(["booked", "showed", "won"]);
const isBooked = (l: Lead) => l.status === "booked" || (!!l.call_at && !l.booking_cancelled_at && BOOKED_LIKE.has(l.status));
const isClosed = (l: Lead) => ["won", "lost", "disqualified"].includes(l.status);

/** "I'll be there" was tapped for the call that is booked now (a reschedule needs a new confirmation). */
export function attendanceConfirmedFor(l: Lead): boolean {
  const x = l as Lead & { attendance_confirmed_at?: number | null; attendance_call_at?: number | null };
  return !!x.attendance_confirmed_at && !!l.call_at && x.attendance_call_at === l.call_at;
}

const steps = (templates: string[], offsets: number[]): Step[] => templates.map((t, i) => ({ template: t, offset: offsets[i] }));

export const SEQUENCES: Record<string, Sequence> = {
  abandoned: {
    id: "abandoned", label: "Abandoned application", trigger: "Contact saved at step 1",
    steps: steps(["ab_1", "ab_2", "ab_3", "ab_4", "ab_5"], [15 * M, 3 * H, 1 * D, 2 * D, 4 * D]),
    stopIf: (l) => !!l.app_completed_at || isClosed(l) || isBooked(l),
  },
  tier_a: {
    id: "tier_a", label: "A tier: get booked", trigger: "A-tier application submitted",
    steps: steps(["ta_1", "ta_2", "ta_3", "ta_4", "ta_5", "ta_6", "ta_7", "ta_8"], [2 * M, 1 * H, 4 * H, 20 * H, 2 * D, 3 * D, 5 * D, 7 * D]),
    stopIf: (l) => isBooked(l) || isClosed(l) || !!l.call_at,
  },
  tier_b: {
    id: "tier_b", label: "B tier: objections, then book", trigger: "B-tier application submitted",
    steps: steps(["tb_1", "tb_2", "tb_3", "tb_4", "tb_5", "tb_6", "tb_7", "tb_8"], [2 * M, 3 * H, 1 * D, 2 * D, 3 * D, 5 * D, 7 * D, 10 * D]),
    stopIf: (l) => isBooked(l) || isClosed(l) || !!l.call_at,
  },
  tier_c: {
    id: "tier_c", label: "C tier: resources", trigger: "C-tier application submitted",
    steps: steps(["tc_1", "tc_2", "tc_3", "tc_4", "tc_5", "tc_6"], [1 * M, 2 * D, 5 * D, 9 * D, 14 * D, 21 * D]),
    stopIf: (l) => isBooked(l) || isClosed(l),
  },
  nurture: {
    id: "nurture", label: "Six-month nurture", trigger: "Any application submitted, not booked",
    steps: steps(
      ["nu_industry", "nu_blocker", "nu_numbers", "nu_agency", "nu_goal", "nu_why", "nu_tracking", "nu_checkin", "nu_last"],
      [25 * D, 35 * D, 50 * D, 65 * D, 80 * D, 100 * D, 120 * D, 150 * D, 180 * D],
    ),
    stopIf: (l) => isBooked(l) || !["applied", "partial", "nurture"].includes(l.status),
  },
  booked: {
    id: "booked", label: "Booked: confirmation and reminders", trigger: "Verified booking",
    steps: [
      { template: "bk_confirm", offset: 0 },
      { template: "bk_48h", offset: -48 * H, anchor: "call" },
      { template: "bk_24h", offset: -24 * H, anchor: "call" },
      { template: "bk_3h", offset: -3 * H, anchor: "call" },
      { template: "bk_1h", offset: -1 * H, anchor: "call" },
      { template: "bk_10m", offset: -10 * M, anchor: "call" },
      // Appended: two hours before, only when attendance is not confirmed for this call time.
      { template: "bk_2h", offset: -2 * H, anchor: "call", skipIf: (l) => attendanceConfirmedFor(l) },
    ],
    stopIf: (l) => l.status !== "booked" || !!l.booking_cancelled_at || !l.call_at,
  },
  precall: {
    id: "precall", label: "Pre-call barrage", trigger: "Verified booking (times computed per lead)",
    steps: [], // dynamic, see precallTimes()/precallPlan()
    stopIf: (l) => l.status !== "booked" || !!l.booking_cancelled_at || !l.call_at || l.call_at - Date.now() < 2 * H,
  },
  no_show: {
    id: "no_show", label: "No-show: rebook", trigger: "No-show logged",
    steps: steps(["ns_1", "ns_goal", "ns_blocker", "ns_numbers", "ns_5", "ns_6", "ns_final"], [15 * M, 1 * D, 3 * D, 5 * D, 7 * D, 10 * D, 14 * D]),
    stopIf: (l) => l.status !== "no_show",
  },
  post_call: {
    id: "post_call", label: "Post-call follow-up", trigger: "Call held, no decision",
    steps: steps(
      ["fu_recap", "fu_objection", "fu_numbers", "fu_industry", "fu_goal", "fu_proof", "fu_time", "fu_risk", "fu_final"],
      [2 * H, 1 * D, 2 * D, 3 * D, 5 * D, 7 * D, 9 * D, 12 * D, 21 * D],
    ),
    stopIf: (l) => l.status !== "showed",
  },
  cancelled: {
    id: "cancelled", label: "Cancelled: rebook", trigger: "Calendly cancel",
    steps: steps(["cx_1", "cx_2", "cx_3", "cx_4"], [30 * M, 1 * D, 3 * D, 6 * D]),
    stopIf: (l) => l.status === "booked" || l.status === "won" || l.status === "lost" || !l.booking_cancelled_at,
  },
  lost: {
    id: "lost", label: "Lost: re-engage", trigger: "Lost logged",
    steps: steps(["lo_1", "lo_2", "lo_3", "lo_4", "lo_5", "lo_6"], [3 * D, 21 * D, 45 * D, 75 * D, 120 * D, 180 * D]),
    stopIf: (l) => l.status !== "lost",
  },
  won: {
    id: "won", label: "Won: onboarding", trigger: "Won logged",
    steps: steps(["won_1", "won_2", "won_3", "won_4", "won_5", "won_6"], [10 * M, 1 * D, 3 * D, 7 * D, 14 * D, 30 * D]),
    stopIf: (l) => l.status !== "won" || !!l.refunded_at,
  },
  behaviour: {
    id: "behaviour", label: "Behaviour triggers", trigger: "Trigger rules (one-off emails)",
    steps: [], // step = rule index in personalize/triggers.ts RULES
    stopIf: (l) => isClosed(l) || l.booking_source === "calendly-direct",
  },
  continue: {
    id: "continue", label: "Continue application link", trigger: "Known email typed in a new browser",
    steps: [],
    stopIf: () => false,
  },
  voice: {
    id: "voice", label: "Links requested on AI calls", trigger: "AI call outcome",
    steps: [],
    stopIf: () => false,
  },
  test: {
    id: "test", label: "Test sends", trigger: "Integrations → Send test",
    steps: [],
    stopIf: () => false,
  },
};

/** Sequences that a new verified booking cancels. */
export const CANCEL_ON_BOOKING = ["tier_a", "tier_b", "tier_c", "abandoned", "no_show", "cancelled", "nurture", "lost"];
/** Sequences cancelled when an outcome closes the deal (won/lost/disqualified). */
export const ALL_MARKETING = ["abandoned", "tier_a", "tier_b", "tier_c", "nurture", "booked", "precall", "no_show", "post_call", "cancelled", "lost", "behaviour"];

// ── Time zones ────────────────────────────────────────────────────────────────

/** Offset (ms) of `tz` at instant `ms`: local wall time minus UTC. */
export function tzOffset(ms: number, tz: string): number {
  const f = new Intl.DateTimeFormat("en-US", {
    timeZone: tz, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit",
  });
  const p: Record<string, number> = {};
  for (const part of f.formatToParts(new Date(ms))) if (part.type !== "literal") p[part.type] = Number(part.value);
  const asUTC = Date.UTC(p.year, p.month - 1, p.day, p.hour === 24 ? 0 : p.hour, p.minute, p.second);
  return asUTC - Math.floor(ms / 1000) * 1000;
}

/** UTC ms for a local wall-clock time in `tz`. DST-safe via a two-pass offset. */
export function zonedTime(y: number, mo: number, d: number, hh: number, mm: number, tz: string): number {
  const guess = Date.UTC(y, mo - 1, d, hh, mm);
  const off1 = tzOffset(guess, tz);
  let t = guess - off1;
  const off2 = tzOffset(t, tz);
  if (off2 !== off1) t = guess - off2;
  return t;
}

/** Local calendar date parts of an instant in `tz`. */
export function localParts(ms: number, tz: string): { y: number; mo: number; d: number; hh: number; mm: number; dow: number } {
  const f = new Intl.DateTimeFormat("en-US", {
    timeZone: tz, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", weekday: "short",
  });
  const p: Record<string, string> = {};
  for (const part of f.formatToParts(new Date(ms))) if (part.type !== "literal") p[part.type] = part.value;
  const dows = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  return { y: +p.year, mo: +p.month, d: +p.day, hh: +p.hour % 24, mm: +p.minute, dow: dows.indexOf(p.weekday) };
}

export function validTimezone(tz: string | null | undefined): tz is string {
  if (!tz) return false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

export const PRECALL_SLOTS: Array<[number, number]> = [[7, 30], [9, 30], [12, 0], [14, 30], [17, 0], [19, 30]];

/** Which of the six daily slots to use for a given per-day count (spread evenly). */
export function slotsForPerDay(perDay: number): Array<[number, number]> {
  const n = Math.max(0, Math.min(PRECALL_SLOTS.length, Math.floor(perDay)));
  if (n === 0) return [];
  if (n >= PRECALL_SLOTS.length) return PRECALL_SLOTS;
  const out: Array<[number, number]> = [];
  for (let i = 0; i < n; i++) out.push(PRECALL_SLOTS[Math.floor((i * PRECALL_SLOTS.length) / n)]);
  return out;
}

/**
 * Pre-call send times: local slots from 90 min after booking until 3 h before the call,
 * at most `perDay` per local day, kept 45 min clear of the 48 h / 24 h reminders. Pure.
 */
export function precallTimes(now: number, callAt: number, tz: string, perDay: number, max: number): number[] {
  if (!(callAt > now) || perDay <= 0 || max <= 0) return [];
  const zone = validTimezone(tz) ? tz : "UTC";
  const start = now + 90 * M;
  const end = callAt - 3 * H;
  if (end <= start) return [];
  const reminders = [callAt - 48 * H, callAt - 24 * H];
  const slots = slotsForPerDay(perDay);
  const out: number[] = [];
  // Walk local days from the start day to the end day.
  let cursor = localParts(start, zone);
  for (let day = 0; day < 60 && out.length < max; day++) {
    const base = Date.UTC(cursor.y, cursor.mo - 1, cursor.d) + day * D;
    const dt = new Date(base);
    const y = dt.getUTCFullYear(), mo = dt.getUTCMonth() + 1, d = dt.getUTCDate();
    let any = false;
    for (const [hh, mm] of slots) {
      const t = zonedTime(y, mo, d, hh, mm, zone);
      if (t > end) break;
      any = true;
      if (t < start) continue;
      if (reminders.some((r) => Math.abs(t - r) < 45 * M)) continue;
      out.push(t);
      if (out.length >= max) break;
    }
    if (!any && zonedTime(y, mo, d, 0, 0, zone) > end) break;
  }
  return out;
}

export const _units = { M, H, D };
