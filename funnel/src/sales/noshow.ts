// No-show risk for booked calls in the next 72 hours. A rules prior (hand-set log-odds) until 50
// past calls have an outcome; then a logistic model fitted on those calls and shrunk towards the
// prior. High risk (> 40%) pings the team once per call with the reasons. Nothing is sent to the lead.

import type { Runtime } from "../app";
import { PERSONAL_EMAIL_DOMAINS } from "../config";
import { newId } from "../lib/ids";
import { kvGate } from "../lib/kv";
import { notifyTeam } from "../integrations/notify";
import { popcount } from "../tracking/vsl";
import type { Lead } from "../funnel/leads";
import { auc, brier, fitLogistic, logit, predict, type LogisticModel, type Sample } from "./model";

const H = 3_600_000;
const DAY = 24 * H;
export const HIGH_RISK = 0.4;
export const MIN_OUTCOMES = 50;

export const NOSHOW_FEATURES = ["lead_time_5d", "no_email_open", "confirm_unanswered", "vsl_under_25", "personal_email", "tier_b", "tier_c"] as const;
export const NOSHOW_LABELS: Record<string, string> = {
  lead_time_5d: "Booked more than 5 days ahead",
  no_email_open: "Has not opened a pre-call email",
  confirm_unanswered: "Did not answer the confirm call",
  vsl_under_25: "Watched less than 25% of the film",
  personal_email: "Personal email address",
  tier_b: "B tier",
  tier_c: "C tier",
};

/** Rules prior: 20% base rate, log-odds bumps per signal. */
export const NOSHOW_PRIOR: LogisticModel = {
  features: [...NOSHOW_FEATURES],
  weights: [0.6, 0.7, 0.6, 0.5, 0.3, 0.3, 0.6],
  bias: logit(0.2),
};

export interface NoShowInput {
  booked_at: number | null;
  call_at: number;
  email: string;
  tier: string | null;
  /** Pre-call/booked emails sent before the reference time, and how many of those were opened before it. */
  emails_sent: number;
  emails_opened: number;
  /** Outcome of the confirm AI call, if one was placed. */
  confirm: "answered" | "unanswered" | "none";
  watched_pct: number | null;
}

export function noShowFeatures(i: NoShowInput): number[] {
  const domain = (i.email.split("@")[1] || "").toLowerCase();
  return [
    i.booked_at != null && i.call_at - i.booked_at > 5 * DAY ? 1 : 0,
    i.emails_sent > 0 && i.emails_opened === 0 ? 1 : 0,
    i.confirm === "unanswered" ? 1 : 0,
    (i.watched_pct ?? 0) < 25 ? 1 : 0,
    PERSONAL_EMAIL_DOMAINS.includes(domain) ? 1 : 0,
    i.tier === "B" ? 1 : 0,
    i.tier === "C" ? 1 : 0,
  ];
}

/** Risk and the reasons behind it (active signals that push the risk up, strongest first). */
export function scoreNoShow(m: LogisticModel, x: number[]): { risk: number; reasons: string[] } {
  const risk = Math.round(predict(m, x) * 1000) / 1000;
  const reasons = m.features.map((f, i) => ({ f, c: x[i] * m.weights[i] })).filter((r) => r.c > 0.05).sort((a, b) => b.c - a.c).map((r) => r.f);
  return { risk, reasons };
}

interface Row {
  id: string; booked_at: number | null; call_at: number; email: string; tier: string | null; status: string;
  sent: number; opened: number; confirm_answered: number; confirm_missed: number; buckets: string | null;
}

/** Signals as of `asOf` per lead (emails and confirm calls before that moment). */
async function signalRows(rt: Runtime, where: string, binds: unknown[], asOfCall: boolean): Promise<Row[]> {
  const ref = asOfCall ? "l.call_at" : "?1";
  const sql = `SELECT l.id, l.booked_at, l.call_at, l.email, COALESCE(l.tier_override, l.tier) AS tier, l.status,
      (SELECT COUNT(*) FROM emails e WHERE e.lead_id = l.id AND e.sequence IN ('booked','precall') AND e.status = 'sent' AND e.sent_at < ${ref}) AS sent,
      (SELECT COUNT(*) FROM emails e WHERE e.lead_id = l.id AND e.sequence IN ('booked','precall') AND e.status = 'sent' AND e.opened_at IS NOT NULL AND e.opened_at < ${ref}) AS opened,
      (SELECT COUNT(*) FROM outbound_calls o WHERE o.lead_id = l.id AND o.kind = 'confirm' AND o.outcome = 'answered' AND o.created_at < ${ref}) AS confirm_answered,
      (SELECT COUNT(*) FROM outbound_calls o WHERE o.lead_id = l.id AND o.kind = 'confirm' AND (o.outcome IN ('no_answer','voicemail') OR o.status = 'failed') AND o.created_at < ${ref}) AS confirm_missed,
      (SELECT v.buckets FROM vsl_views v WHERE v.video = 'main' AND (v.lead_id = l.id OR v.visitor_id = l.visitor_id) ORDER BY v.last_at DESC LIMIT 1) AS buckets
    FROM leads l WHERE (${where}) AND l.id NOT IN (SELECT lead_id FROM lead_revops WHERE is_test = 1)`;
  return ((await rt.env.DB.prepare(sql).bind(...binds).all<Row>()).results) || [];
}

function toInput(r: Row): NoShowInput {
  return {
    booked_at: r.booked_at, call_at: r.call_at, email: r.email, tier: r.tier,
    emails_sent: Number(r.sent) || 0, emails_opened: Number(r.opened) || 0,
    confirm: Number(r.confirm_answered) ? "answered" : Number(r.confirm_missed) ? "unanswered" : "none",
    watched_pct: r.buckets ? popcount(r.buckets) : null,
  };
}

export async function activeNoShowModel(rt: Runtime): Promise<{ model: LogisticModel; fitted: boolean; n: number }> {
  const r = await rt.env.DB.prepare("SELECT weights, n_train FROM scoring_models WHERE kind = 'noshow' AND active = 1 ORDER BY created_at DESC LIMIT 1").first<{ weights: string; n_train: number }>().catch(() => null);
  if (r) {
    try {
      const m = JSON.parse(r.weights) as LogisticModel;
      if (Array.isArray(m.weights) && m.weights.length === NOSHOW_FEATURES.length) return { model: { features: [...NOSHOW_FEATURES], weights: m.weights, bias: m.bias }, fitted: true, n: r.n_train };
    } catch { /* fall through to the prior */ }
  }
  return { model: NOSHOW_PRIOR, fitted: false, n: 0 };
}

/** Nightly: fit on past calls with an outcome once there are at least 50. */
export async function fitNoShowModel(rt: Runtime): Promise<{ fitted: boolean; n: number; auc: number | null }> {
  const now = rt.now();
  const rows = await signalRows(rt,
    "l.booking_source = 'funnel' AND l.booked_at IS NOT NULL AND l.call_at < ?2 AND l.call_at > ?3 AND l.status IN ('showed','won','lost','no_show') LIMIT 20000",
    [now, now - H, now - 365 * DAY], true);
  if (rows.length < MIN_OUTCOMES) return { fitted: false, n: rows.length, auc: null };
  const data: Sample[] = rows.map((r) => ({ x: noShowFeatures(toInput(r)), y: r.status === "no_show" ? 1 : 0 }));
  const m = fitLogistic([...NOSHOW_FEATURES], data, { l2: 5, priorWeights: NOSHOW_PRIOR.weights, iterations: 1500 });
  const probs = data.map((d) => predict(m, d.x));
  const labels = data.map((d) => d.y);
  const a = auc(probs, labels), b = brier(probs, labels);
  await rt.env.DB.batch([
    rt.env.DB.prepare("UPDATE scoring_models SET active = 0 WHERE kind = 'noshow'"),
    rt.env.DB.prepare("INSERT INTO scoring_models (id, created_at, kind, n_train, auc, brier, weights, active) VALUES (?,?,?,?,?,?,?,1)")
      .bind(newId("sm"), now, "noshow", data.length, a, b, JSON.stringify(m)),
  ]);
  return { fitted: true, n: data.length, auc: a };
}

/** Hourly: score every booked call in the next 72 hours; ping once per call when risk is high. */
export async function scoreUpcomingCalls(rt: Runtime, force = false): Promise<number> {
  const now = rt.now();
  if (!force && !(await kvGate(rt.env, "gate:noshow", 55 * 60_000, now))) return 0;
  const { model } = await activeNoShowModel(rt);
  const rows = await signalRows(rt,
    "l.status = 'booked' AND l.booking_cancelled_at IS NULL AND l.booking_source = 'funnel' AND l.call_at > ?1 AND l.call_at <= ?2 LIMIT 500",
    [now, now + 72 * H], false);
  const stmt = rt.env.DB.prepare(
    `INSERT INTO lead_revops (lead_id, noshow_risk, noshow_reasons, noshow_scored_at, updated_at) VALUES (?,?,?,?,?)
     ON CONFLICT(lead_id) DO UPDATE SET noshow_risk = excluded.noshow_risk, noshow_reasons = excluded.noshow_reasons, noshow_scored_at = excluded.noshow_scored_at, updated_at = excluded.updated_at`,
  );
  const scored = rows.map((r) => ({ r, s: scoreNoShow(model, noShowFeatures(toInput(r))) }));
  for (let i = 0; i < scored.length; i += 50) {
    await rt.env.DB.batch(scored.slice(i, i + 50).map(({ r, s }) => stmt.bind(r.id, s.risk, JSON.stringify(s.reasons), now, now)));
  }
  for (const { r, s } of scored) {
    if (s.risk <= HIGH_RISK) continue;
    if (!(await kvGate(rt.env, `noshowping:${r.id}:${r.call_at}`, 365 * DAY, now))) continue;
    const lead = await rt.env.DB.prepare("SELECT * FROM leads WHERE id = ?").bind(r.id).first<Lead>();
    if (!lead) continue;
    const when = Math.round((r.call_at - now) / H);
    rt.waitUntil(notifyTeam(rt, "noshow_risk", lead, `${Math.round(s.risk * 100)}% risk · call in ${when} h · ${s.reasons.map((x) => NOSHOW_LABELS[x] || x).join("; ")}`));
  }
  return scored.length;
}

export async function upcomingByRisk(rt: Runtime) {
  const now = rt.now();
  const rows = ((await rt.env.DB.prepare(
    `SELECT l.id, l.ref_code, l.first_name, l.last_name, l.email, COALESCE(l.tier_override, l.tier) AS tier, l.call_at, l.closer_id,
       r.noshow_risk, r.noshow_reasons, r.noshow_scored_at, r.p_win
     FROM leads l LEFT JOIN lead_revops r ON r.lead_id = l.id
     WHERE l.status = 'booked' AND l.booking_cancelled_at IS NULL AND l.booking_source = 'funnel' AND l.call_at > ? AND l.call_at <= ? AND l.id NOT IN (SELECT lead_id FROM lead_revops WHERE is_test = 1)
     ORDER BY COALESCE(r.noshow_risk, 0) DESC, l.call_at LIMIT 100`,
  ).bind(now, now + 72 * H).all<Record<string, unknown>>()).results) || [];
  const m = await activeNoShowModel(rt);
  return {
    model: { fitted: m.fitted, n: m.n, threshold: HIGH_RISK, min_outcomes: MIN_OUTCOMES },
    labels: NOSHOW_LABELS,
    rows: rows.map((r) => {
      let reasons: string[] = [];
      try { reasons = JSON.parse(String(r.noshow_reasons || "[]")); } catch { reasons = []; }
      return {
        id: String(r.id), ref_code: String(r.ref_code), name: [r.first_name, r.last_name].filter(Boolean).join(" ") || String(r.email),
        tier: (r.tier as string) || null, call_at: Number(r.call_at), closer_id: (r.closer_id as string) || null,
        risk: r.noshow_risk == null ? null : Number(r.noshow_risk), reasons, scored_at: r.noshow_scored_at == null ? null : Number(r.noshow_scored_at),
        p_win: r.p_win == null ? null : Number(r.p_win),
      };
    }),
  };
}
