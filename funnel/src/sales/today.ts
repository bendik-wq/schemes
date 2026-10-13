// Today workspace (mobile-first, per rep): today's calls with prep cards, new A/B leads nobody has
// touched yet, follow-ups and instalments due. Touches (dial, connect, voicemail, SMS, email, DM) feed
// speed-to-lead (application → first human touch) and setter activity on the Sales tab.

import type { Runtime } from "../app";
import { APPLICATION } from "../config";
import { newId } from "../lib/ids";
import { clip } from "../lib/text";
import { popcount } from "../tracking/vsl";
import { parseAnswers, type Answers } from "../funnel/leads";
import { localParts, zonedTime } from "../integrations/sequences";
import { salesTz } from "../admin/stats";
import { NOSHOW_LABELS } from "./noshow";
import { followUpsDue, paymentsDue } from "./followups";
import { listReps } from "./reps";
import { businessMs, escalationState, inSalesHours, salesHours, slaLevel } from "./escalation";

const DAY = 86_400_000;
export const TOUCH_KINDS = ["dial", "connect", "voicemail", "sms", "email", "dm"] as const;
export type TouchKind = (typeof TOUCH_KINDS)[number];
export const TOUCH_OUTCOMES = ["", "booked", "follow_up", "not_interested", "wrong_number", "no_answer", "left_message"] as const;

export class TouchError extends Error {}

/** Pure validation of a logged touch. */
export function cleanTouch(input: { kind?: unknown; outcome?: unknown; note?: unknown; at?: unknown }, now: number): { kind: TouchKind; outcome: string | null; note: string | null; at: number } {
  const kind = String(input.kind || "");
  if (!(TOUCH_KINDS as readonly string[]).includes(kind)) throw new TouchError("Pick what you did: dial, connect, voicemail, SMS, email or DM.");
  const outcome = input.outcome == null ? "" : String(input.outcome);
  if (!(TOUCH_OUTCOMES as readonly string[]).includes(outcome)) throw new TouchError("Unknown outcome.");
  let at = now;
  if (input.at != null && input.at !== "") {
    const t = typeof input.at === "number" ? input.at : Date.parse(String(input.at));
    if (!Number.isFinite(t) || t > now + 5 * 60_000 || t < now - 30 * DAY) throw new TouchError("The time must be in the last 30 days.");
    at = t;
  }
  return { kind: kind as TouchKind, outcome: outcome || null, note: input.note ? clip(input.note, 500) : null, at };
}

export async function logTouch(rt: Runtime, leadId: string, repId: string | null, userId: string | null, input: Parameters<typeof cleanTouch>[0]) {
  const t = cleanTouch(input, rt.now());
  const row = { id: newId("t"), lead_id: leadId, rep_id: repId, user_id: userId, ...t };
  await rt.env.DB.prepare("INSERT INTO touches (id, lead_id, rep_id, user_id, kind, outcome, note, at) VALUES (?,?,?,?,?,?,?,?)")
    .bind(row.id, row.lead_id, row.rep_id, row.user_id, row.kind, row.outcome, row.note, row.at).run();
  return row;
}

export async function listTouches(rt: Runtime, leadId: string) {
  return ((await rt.env.DB.prepare("SELECT id, rep_id, kind, outcome, note, at FROM touches WHERE lead_id = ? ORDER BY at DESC LIMIT 100").bind(leadId).all<Record<string, unknown>>()).results) || [];
}

// ── Prep cards ───────────────────────────────────────────────────────────────

/** Pure: objections the answers predict, with the reason, strongest first. Labels match OBJECTIONS. */
export function predictObjections(a: Answers, watchedPct: number | null): Array<{ objection: string; why: string }> {
  const out: Array<{ objection: string; why: string }> = [];
  const add = (objection: string, why: string) => { if (!out.some((o) => o.objection === objection)) out.push({ objection, why }); };
  const has = (q: string, v: string) => (Array.isArray(a[q]) ? (a[q] as string[]).includes(v) : a[q] === v);
  if (has("readiness", "partner")) add("Partner/spouse", "Invests with a partner or board");
  if (has("role", "exec")) add("Partner/spouse", "Not an owner: someone else signs");
  if (has("readiness", "not_now")) add("Timing", "Said not ready to invest now");
  if (has("timeline", "6_plus") || has("timeline", "exploring")) add("Timing", "Wants this in six months or later");
  if (has("spend", "under_25k")) add("Price", "Spends under $25k a year on agencies and software");
  if (has("revenue", "1m_3m") && has("spend", "under_25k")) add("Funding doubts", "Smaller business with a small tools budget");
  if (has("blockers", "ai_doubt")) add("Trust/proof", "Not sure AI can do this");
  if (watchedPct != null && watchedPct < 25) add("Trust/proof", "Watched less than a quarter of the film");
  if (has("blockers", "time")) add("Time to commit", "No time to lead it");
  if (has("goal", "unsure")) add("Needs to think", "Not sure what matters most yet");
  if (has("blockers", "agency_lockin")) add("Timing", "Locked into an agency or retainer");
  return out.slice(0, 4);
}

const KEY_QUESTIONS = ["business", "role", "revenue", "spend", "goal", "timeline", "readiness", "why_now", "blockers"];

/** Pure: the answers a closer needs, as short label/answer pairs. */
export function keyAnswers(a: Answers): Array<{ q: string; a: string }> {
  const out: Array<{ q: string; a: string }> = [];
  for (const id of KEY_QUESTIONS) {
    const q = APPLICATION.find((x) => x.id === id);
    const v = a[id];
    if (!q || v == null || v === "" || (Array.isArray(v) && !v.length)) continue;
    const vals = Array.isArray(v) ? v : [v];
    const text = q.type === "text" ? String(v).slice(0, 240) : vals.map((x) => q.options?.find((o) => o.value === x)?.label || String(x)).join(", ");
    out.push({ q: id.replace(/_/g, " "), a: text });
  }
  return out;
}

function dayBounds(now: number, tz: string) {
  const p = localParts(now, tz);
  const start = zonedTime(p.y, p.mo, p.d, 0, 0, tz);
  return { start, end: start + DAY };
}

export async function todayView(rt: Runtime, rep: string | null | undefined) {
  const now = rt.now();
  const tz = salesTz(rt);
  const { start, end } = dayBounds(now, tz);
  const db = rt.env.DB;
  // rep === null means a rep user without a linked rep: show nothing.
  if (rep === null) return { scoped: true, linked: false, calls: [], fresh: [], follow_ups: [], payments_due: [], stats: { calls: 0, fresh: 0, follow_ups: 0, payments_due: 0 }, tz };
  const scope = " AND l.id NOT IN (SELECT lead_id FROM lead_revops WHERE is_test = 1)" + (rep ? " AND (l.closer_id = ? OR l.setter_id = ?)" : "");
  const sb = rep ? [rep, rep] : [];
  const reps = await listReps(rt);
  const repName = (id: string | null) => (id ? reps.find((r) => r.id === id)?.name || id : null);
  const [callRows, freshRows, fu, pay] = await Promise.all([
    db.prepare(
      `SELECT l.id, l.ref_code, l.first_name, l.last_name, l.email, l.phone, COALESCE(l.tier_override, l.tier) AS tier, l.score, l.status, l.call_at, l.closer_id,
         l.answers, l.booking_join_url, l.do_not_call_at, l.industry, l.notes, r.noshow_risk, r.noshow_reasons, r.p_win,
         (SELECT v.buckets FROM vsl_views v WHERE v.video = 'main' AND (v.lead_id = l.id OR (v.visitor_id = l.visitor_id AND l.visitor_id IS NOT NULL)) ORDER BY v.last_at DESC LIMIT 1) AS buckets,
         (SELECT COUNT(*) FROM touches t WHERE t.lead_id = l.id) AS touches
       FROM leads l LEFT JOIN lead_revops r ON r.lead_id = l.id
       WHERE l.call_at >= ? AND l.call_at < ? AND l.booking_cancelled_at IS NULL AND l.status IN ('booked','showed','no_show','won','lost')${scope}
       ORDER BY l.call_at LIMIT 60`,
    ).bind(start, end, ...sb).all<Record<string, unknown>>(),
    db.prepare(
      `SELECT l.id, l.ref_code, l.first_name, l.last_name, l.email, l.phone, COALESCE(l.tier_override, l.tier) AS tier, l.score, l.status, l.app_completed_at, l.closer_id, l.setter_id, l.do_not_call_at, l.visitor_id
       FROM leads l
       WHERE l.app_completed_at >= ? AND COALESCE(l.tier_override, l.tier) IN ('A','B') AND l.status IN ('applied','booked','nurture')
         AND l.booking_source = 'funnel' AND NOT EXISTS (SELECT 1 FROM touches t WHERE t.lead_id = l.id)${scope}
       ORDER BY l.app_completed_at DESC LIMIT 60`,
    ).bind(now - 7 * DAY, ...sb).all<Record<string, unknown>>(),
    followUpsDue(rt, reps, rep),
    paymentsDue(rt, reps, rep),
  ]);
  const name = (r: Record<string, unknown>) => [r.first_name, r.last_name].filter(Boolean).join(" ") || String(r.email);
  const tel = (r: Record<string, unknown>) => (r.phone && !r.do_not_call_at && /^\+\d{6,16}$/.test(String(r.phone)) ? String(r.phone) : null);
  const calls = (callRows.results || []).map((r) => {
    const answers = parseAnswers({ answers: String(r.answers || "{}") });
    const watched = r.buckets ? popcount(String(r.buckets)) : null;
    let reasons: string[] = [];
    try { reasons = JSON.parse(String(r.noshow_reasons || "[]")); } catch { reasons = []; }
    return {
      id: String(r.id), ref_code: String(r.ref_code), name: name(r), tier: (r.tier as string) || null, score: r.score == null ? null : Number(r.score),
      status: String(r.status), call_at: Number(r.call_at), closer: repName((r.closer_id as string) || null), phone: tel(r),
      join_url: typeof r.booking_join_url === "string" && /^https:\/\//.test(r.booking_join_url) ? r.booking_join_url : null,
      watched_pct: watched, key_answers: keyAnswers(answers), objections: predictObjections(answers, watched),
      noshow_risk: r.noshow_risk == null ? null : Number(r.noshow_risk), noshow_reasons: reasons.map((x) => NOSHOW_LABELS[x] || x),
      p_win: r.p_win == null ? null : Number(r.p_win), touches: Number(r.touches) || 0, notes: r.notes ? String(r.notes).slice(0, 300) : null,
      needs_outcome: r.status === "booked" && Number(r.call_at) < now - 30 * 60_000,
    };
  });
  const freshAll = (freshRows.results || []).map((r) => ({
    id: String(r.id), ref_code: String(r.ref_code), name: name(r), tier: (r.tier as string) || null, score: r.score == null ? null : Number(r.score),
    status: String(r.status), applied_at: Number(r.app_completed_at), waiting_ms: now - Number(r.app_completed_at), phone: tel(r),
    closer: repName((r.closer_id as string) || null), email: String(r.email || ""), raw_phone: (r.phone as string) || null, visitor_id: (r.visitor_id as string) || null,
  }));
  // The SLA clock runs in sales hours only; the same person applying twice is one row ("+1 more").
  const hours = salesHours(rt);
  const esc = await escalationState(rt, freshAll.map((r) => r.id));
  const fresh = groupSamePerson(freshAll).map((g) => {
    const { email: _e, raw_phone: _p, visitor_id: _v, ...r } = g.lead;
    const ms = businessMs(r.applied_at, now, tz, hours);
    return { ...r, sla_ms: ms, sla_level: slaLevel(ms), escalated: esc.get(r.id) || 0, also: g.others.map((o) => ({ id: o.id, ref_code: o.ref_code, applied_at: o.applied_at })) };
  });
  // Buying signal: the lead opened their written plan.
  const ids = [...new Set([...calls.map((c) => c.id), ...fu.map((f) => f.id)])];
  const views = ids.length ? ((await db.prepare(
    `SELECT lead_id, MAX(viewed_at) AS first_view, MAX(last_viewed_at) AS last_view, SUM(views) AS views FROM call_plans WHERE lead_id IN (${ids.map(() => "?").join(",")}) AND viewed_at IS NOT NULL GROUP BY lead_id`,
  ).bind(...ids).all<{ lead_id: string; first_view: number; last_view: number; views: number }>()).results || []) : [];
  const pv = new Map(views.map((v) => [v.lead_id, { at: Number(v.last_view) || Number(v.first_view), views: Number(v.views) || 1 }]));
  const withPlan = <T extends { id: string }>(r: T) => ({ ...r, plan_viewed: pv.get(r.id) || null });
  return {
    scoped: !!rep, linked: true, tz, day_start: start, calls: calls.map(withPlan), fresh, follow_ups: fu.map(withPlan), payments_due: pay,
    in_hours: inSalesHours(now, tz, hours), sales_hours: rt.settings.get("SALES_HOURS") || "Mon-Fri 09:00-18:00",
    stats: { calls: calls.length, fresh: fresh.length, follow_ups: fu.length, payments_due: pay.length },
  };
}

/** Pure: the normalised address without a +tag ("ada+2@x.com" → "ada@x.com"). */
export function baseEmail(e: string): string {
  const m = /^([^+@]+)(?:\+[^@]*)?@(.+)$/.exec(String(e || "").trim().toLowerCase());
  return m ? `${m[1]}@${m[2]}` : String(e || "").trim().toLowerCase();
}

/** Pure: group rows that are the same person (same browser, phone or base email); newest row leads the group. */
export function groupSamePerson<T extends { id: string; applied_at: number; email: string; raw_phone: string | null; visitor_id: string | null }>(rows: T[]): Array<{ lead: T; others: T[] }> {
  const groups: Array<{ lead: T; others: T[]; keys: Set<string> }> = [];
  const sorted = rows.slice().sort((a, b) => b.applied_at - a.applied_at);
  for (const r of sorted) {
    const keys = [r.visitor_id ? "v:" + r.visitor_id : "", r.raw_phone ? "p:" + r.raw_phone.replace(/\D/g, "") : "", r.email ? "e:" + baseEmail(r.email) : ""].filter(Boolean);
    const g = groups.find((x) => keys.some((k) => x.keys.has(k)));
    if (g) { g.others.push(r); keys.forEach((k) => g.keys.add(k)); } else groups.push({ lead: r, others: [], keys: new Set(keys) });
  }
  // Longest-waiting first, as before (the clock runs from the earliest application in the group).
  return groups.map(({ lead, others }) => {
    const first = [lead, ...others].reduce((a, b) => (b.applied_at < a.applied_at ? b : a));
    return { lead: { ...lead, applied_at: first.applied_at, waiting_ms: (lead as unknown as { waiting_ms: number }).waiting_ms + (lead.applied_at - first.applied_at) }, others };
  }).sort((a, b) => b.lead.applied_at - a.lead.applied_at);
}

// ── Speed to lead and setter activity ────────────────────────────────────────

/** Pure: median minutes and share within 5 minutes, from per-lead delays (ms). */
export function speedStats(delays: number[]): { n: number; median_min: number | null; within5_pct: number | null } {
  const v = delays.filter((d) => Number.isFinite(d) && d >= 0).sort((a, b) => a - b);
  if (!v.length) return { n: 0, median_min: null, within5_pct: null };
  const m = Math.floor(v.length / 2);
  const med = v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2;
  return { n: v.length, median_min: Math.round((med / 60_000) * 10) / 10, within5_pct: Math.round((v.filter((d) => d <= 5 * 60_000).length / v.length) * 1000) / 10 };
}

/**
 * Speed to lead per rep: application completed → first human touch on that lead (by anyone; credited to the
 * rep who made it). Setter activity: dials (dial, connect, voicemail), connects, sets (leads they set that
 * booked in the period) and set → show.
 */
export async function salesActivity(rt: Runtime, since: number, rep?: string | null) {
  const db = rt.env.DB;
  const now = rt.now();
  const [first, acts, sets] = await Promise.all([
    db.prepare(
      `SELECT t.rep_id, l.app_completed_at, t.at FROM leads l
       JOIN touches t ON t.lead_id = l.id AND t.at = (SELECT MIN(t2.at) FROM touches t2 WHERE t2.lead_id = l.id)
       WHERE l.app_completed_at >= ? AND l.booking_source = 'funnel' AND l.id NOT IN (SELECT lead_id FROM lead_revops WHERE is_test = 1) AND t.at >= l.app_completed_at LIMIT 20000`,
    ).bind(since).all<{ rep_id: string | null; app_completed_at: number; at: number }>(),
    db.prepare(
      `SELECT rep_id, SUM(kind IN ('dial','connect','voicemail')) AS dials, SUM(kind = 'connect') AS connects, COUNT(*) AS touches
       FROM touches WHERE at >= ? GROUP BY rep_id`,
    ).bind(since).all<{ rep_id: string | null; dials: number; connects: number; touches: number }>(),
    db.prepare(
      `SELECT setter_id AS rep_id, COUNT(*) AS sets, SUM(call_at < ?) AS held_or_missed,
         SUM(call_at < ? AND (showed_at IS NOT NULL OR status IN ('showed','won','lost'))) AS showed
       FROM leads WHERE setter_id IS NOT NULL AND booked_at >= ? GROUP BY setter_id`,
    ).bind(now, now, since).all<{ rep_id: string; sets: number; held_or_missed: number; showed: number }>(),
  ]);
  const reps = await listReps(rt);
  const ids = new Set<string>();
  for (const r of [...(first.results || []), ...(acts.results || []), ...(sets.results || [])]) ids.add(r.rep_id || "");
  const all = (first.results || []).map((r) => r.at - r.app_completed_at);
  const rows = [...ids].filter((id) => !rep || id === rep).map((id) => {
    const a = (acts.results || []).find((x) => (x.rep_id || "") === id);
    const s = (sets.results || []).find((x) => (x.rep_id || "") === id);
    const held = Number(s?.held_or_missed) || 0;
    return {
      rep_id: id || null, name: id ? reps.find((r) => r.id === id)?.name || id : "Unassigned",
      speed: speedStats((first.results || []).filter((x) => (x.rep_id || "") === id).map((x) => x.at - x.app_completed_at)),
      dials: Number(a?.dials) || 0, connects: Number(a?.connects) || 0, touches: Number(a?.touches) || 0,
      sets: Number(s?.sets) || 0, set_show_pct: held ? Math.round(((Number(s?.showed) || 0) / held) * 1000) / 10 : null,
    };
  });
  rows.sort((a, b) => b.touches - a.touches || b.sets - a.sets);
  return { overall: speedStats(rep ? (first.results || []).filter((x) => x.rep_id === rep).map((x) => x.at - x.app_completed_at) : all), reps: rows };
}
