// Behaviour-triggered one-off emails. Each rule fires at most once per lead (step = rule index in
// the append-only `behaviour` sequence), at most one trigger per lead per run, DAILY_CAP overall.

import type { Runtime } from "../app";
import { effectiveTier, type Lead } from "../funnel/leads";
import { kvGet, kvSet } from "../lib/kv";
import { popcount } from "../tracking/vsl";
import { sendOneOff } from "../integrations/email";
import { track } from "../tracking/track";

const MIN = 60_000;
const H = 60 * MIN;

export interface TriggerState {
  lead: Pick<Lead, "id" | "status" | "tier" | "tier_override" | "app_completed_at" | "step_reached" | "updated_at" | "call_at" | "booked_at" | "created_at">;
  mainWatchedPct: number;
  breakoutWatchedPct: number;
  precallPlayed: boolean;
  sessions: number;
  lastActivity: number;
  lastPageViewAfterApply: number | null;
  bookPageViewAt: number | null;
  bookingDateSelectedAt: number | null;
  guaranteeAt: number | null;
  costInterestAt: number | null;
  mainWatchedAt: number | null;
  breakoutWatchedAt: number | null;
}

export interface Rule {
  template: string;
  label: string;
  delayMin: number;
  /** Returns the time the condition became true (anchor), or null when it does not hold. */
  when: (s: TriggerState, now: number) => number | null;
}

const booked = (s: TriggerState) => !!s.lead.call_at || s.lead.status === "booked" || s.lead.status === "showed" || s.lead.status === "won";
const qualified = (s: TriggerState) => ["A", "B"].includes(effectiveTier(s.lead as Lead) || "");
const open = (s: TriggerState) => ["partial", "applied", "nurture"].includes(s.lead.status);

// APPEND-ONLY: the index is the dedupe step. Add new rules at the end.
export const RULES: Rule[] = [
  { template: "t_vsl_no_apply", label: "Watched half the film, didn't apply", delayMin: 30,
    when: (s) => (s.mainWatchedPct >= 50 && !s.lead.app_completed_at && open(s) ? s.mainWatchedAt : null) },
  { template: "t_stalled", label: "Stopped partway through the application", delayMin: 45,
    when: (s, now) => (!s.lead.app_completed_at && s.lead.step_reached >= 2 && s.lead.status === "partial" && now - s.lastActivity >= 30 * MIN ? s.lastActivity : null) },
  { template: "t_finish_booking", label: "Picked a date, didn't confirm", delayMin: 25,
    when: (s) => (s.bookingDateSelectedAt && !booked(s) ? s.bookingDateSelectedAt : null) },
  { template: "t_came_back", label: "Qualified, came back, not booked", delayMin: 40,
    when: (s) => (qualified(s) && !booked(s) && s.lastPageViewAfterApply ? s.lastPageViewAfterApply : null) },
  { template: "t_still_thinking", label: "3+ visits without booking", delayMin: 60,
    when: (s) => (s.sessions >= 3 && !booked(s) && open(s) ? s.lastActivity : null) },
  { template: "t_guarantee", label: "Read the guarantee, not booked", delayMin: 60,
    when: (s) => (s.guaranteeAt && !booked(s) && open(s) ? s.guaranteeAt : null) },
  { template: "t_cost", label: "Looked into cost, not booked", delayMin: 60,
    when: (s) => (s.costInterestAt && !booked(s) && open(s) ? s.costInterestAt : null) },
  { template: "t_book_nudge", label: "Opened the booking page, didn't book", delayMin: 30,
    when: (s) => (s.bookPageViewAt && qualified(s) && !booked(s) ? s.bookPageViewAt : null) },
  { template: "t_breakout_done", label: "Watched the breakout video, didn't book", delayMin: 30,
    when: (s) => (s.breakoutWatchedPct >= 70 && !booked(s) && open(s) ? s.breakoutWatchedAt : null) },
  { template: "t_watch_prep", label: "Booked 12h+ ago, hasn't watched the prep video", delayMin: 0,
    when: (s, now) => (s.lead.status === "booked" && s.lead.booked_at && now - s.lead.booked_at > 12 * H && !s.precallPlayed && (s.lead.call_at || 0) - now > 2 * H ? s.lead.booked_at + 12 * H : null) },
];

export const DAILY_CAP = 8;

/** Pure: the first rule that is due and has not fired. */
export function dueRule(s: TriggerState, fired: Set<number>, now: number): number | null {
  for (let i = 0; i < RULES.length; i++) {
    if (fired.has(i)) continue;
    const at = RULES[i].when(s, now);
    if (at != null && now >= at + RULES[i].delayMin * MIN) return i;
  }
  return null;
}

async function loadState(rt: Runtime, lead: Lead): Promise<TriggerState> {
  const db = rt.env.DB;
  const vid = lead.visitor_id || "";
  const vv = (await db.prepare("SELECT video, buckets, unmuted, played, last_at FROM vsl_views WHERE lead_id = ? OR visitor_id = ?").bind(lead.id, vid)
    .all<{ video: string; buckets: string; unmuted: number; played: number; last_at: number }>()).results || [];
  const main = vv.find((v) => v.video === "main");
  const bo = vv.find((v) => v.video === "breakout");
  const pc = vv.find((v) => v.video === "precall");
  const agg = await db.prepare(
    `SELECT MAX(ts) AS last,
       MAX(CASE WHEN name='page_view' AND ts > ? THEN ts END) AS pv_after,
       MAX(CASE WHEN name='page_view' AND path='/book' THEN ts END) AS book_pv,
       MAX(CASE WHEN name='booking_date_selected' THEN ts END) AS date_sel,
       MAX(CASE WHEN (name='section_dwell' OR name='section_revisit') AND props LIKE '%"section":"guarantee"%' THEN ts END) AS guar,
       MAX(CASE WHEN name='faq_open' AND (props LIKE '%"id":"cost"%' OR props LIKE '%"id":"guarantee"%') THEN ts END) AS cost
     FROM events WHERE (lead_id = ? OR visitor_id = ?) AND is_bot = 0`,
  ).bind((lead.app_completed_at || 0) + H, lead.id, vid).first<{ last: number; pv_after: number; book_pv: number; date_sel: number; guar: number; cost: number }>();
  const sess = await db.prepare("SELECT COUNT(*) AS n FROM sessions WHERE (lead_id = ? OR visitor_id = ?) AND is_bot = 0").bind(lead.id, vid).first<{ n: number }>();
  return {
    lead,
    mainWatchedPct: main && main.unmuted ? popcount(main.buckets) : 0,
    breakoutWatchedPct: bo ? popcount(bo.buckets) : 0,
    precallPlayed: !!pc?.played,
    sessions: sess?.n || 0,
    lastActivity: Math.max(agg?.last || 0, lead.updated_at),
    lastPageViewAfterApply: lead.app_completed_at ? agg?.pv_after || null : null,
    bookPageViewAt: agg?.book_pv || null,
    bookingDateSelectedAt: agg?.date_sel || null,
    guaranteeAt: agg?.guar || null,
    costInterestAt: agg?.cost || null,
    mainWatchedAt: main?.last_at || null,
    breakoutWatchedAt: bo?.last_at || null,
  };
}

export async function processTriggers(rt: Runtime): Promise<number> {
  const now = rt.now();
  const dayKey = `triggers:${new Date(now).toISOString().slice(0, 10)}`;
  let sentToday = Number((await kvGet(rt.env, dayKey)) || 0);
  if (sentToday >= DAILY_CAP) return 0;
  const leads = (await rt.env.DB.prepare(
    `SELECT * FROM leads WHERE unsubscribed_at IS NULL AND booking_source = 'funnel' AND status IN ('partial','applied','nurture','booked')
       AND (updated_at > ? OR id IN (SELECT DISTINCT lead_id FROM events WHERE ts > ? AND lead_id IS NOT NULL))
     ORDER BY updated_at DESC LIMIT 200`,
  ).bind(now - 7 * 24 * H, now - 2 * 24 * H).all<Lead>()).results || [];
  let fired = 0;
  for (const lead of leads) {
    if (sentToday >= DAILY_CAP) break;
    const done = new Set(((await rt.env.DB.prepare("SELECT step FROM emails WHERE lead_id = ? AND sequence = 'behaviour'").bind(lead.id).all<{ step: number }>()).results || []).map((r) => r.step));
    const state = await loadState(rt, lead);
    const idx = dueRule(state, done, now);
    if (idx == null) continue;
    const id = await sendOneOff(rt, lead, "behaviour", RULES[idx].template, idx);
    if (!id) continue;
    fired++;
    sentToday++;
    await track(rt, { leadId: lead.id }, { name: "trigger_fired", source: "cron", props: { rule: RULES[idx].template }, localOnly: true });
  }
  if (fired) await kvSet(rt.env, dayKey, String(sentToday));
  return fired;
}
