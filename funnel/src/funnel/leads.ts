import type { Runtime } from "../app";
import type { Status, Tier } from "../config";

export interface Lead {
  id: string;
  ref_code: string;
  created_at: number;
  updated_at: number;
  first_name: string | null;
  last_name: string | null;
  email: string;
  phone: string | null;
  whatsapp_opt_in: number;
  answers: string;
  step_reached: number;
  app_started_at: number | null;
  app_completed_at: number | null;
  score: number | null;
  score_breakdown: string | null;
  tier: Tier | null;
  tier_override: Tier | null;
  route: string | null;
  closer_id: string | null;
  setter_id: string | null;
  status: Status;
  booked_at: number | null;
  call_at: number | null;
  booking_provider: string | null;
  booking_ref: string | null;
  booking_cancelled_at: number | null;
  booking_join_url: string | null;
  booking_reschedule_url: string | null;
  booking_cancel_url: string | null;
  booking_host_email: string | null;
  booking_answers: string | null;
  booking_source: "funnel" | "calendly-direct";
  whatsapp_last_in_at: number | null;
  whatsapp_last_out_at: number | null;
  unsubscribed_at: number | null;
  revenue: number;
  cash_collected: number;
  closed_at: number | null;
  showed_at: number | null;
  lost_reason: string | null;
  notes: string | null;
  visitor_id: string | null;
  channel: string | null;
  utm_source: string | null;
  utm_medium: string | null;
  utm_campaign: string | null;
  utm_content: string | null;
  utm_term: string | null;
  click_id: string | null;
  click_type: string | null;
  referrer: string | null;
  ft_channel: string | null;
  ft_source: string | null;
  ft_medium: string | null;
  ft_campaign: string | null;
  ft_content: string | null;
  ft_term: string | null;
  ft_referrer: string | null;
  ft_landing: string | null;
  landing_path: string | null;
  variant: string | null;
  lander: string | null;
  ft_lander: string | null;
  country: string | null;
  region: string | null;
  city: string | null;
  device: string | null;
  fbp: string | null;
  fbc: string | null;
  do_not_call_at: number | null;
  call_consent_at: number | null;
  call_consent_text: string | null;
  timezone: string | null;
  industry: string | null;
  revenue_band: string | null;
  budget_band: string | null;
  willing_to_invest: string | null;
  qual_source: string | null;
  qual_flags: string | null;
  temperature: string | null;
  objection: string | null;
  follow_up_at: number | null;
  decision_maker: string | null;
  fit_rating: number | null;
  offer: string | null;
  payment_plan: string | null;
  installments_total: number | null;
  next_payment_at: number | null;
  contract_signed_at: number | null;
  refunded_at: number | null;
  refund_amount: number | null;
  loi_signed_at: number | null;
  target_business: string | null;
  booking_verified: number;
}

export type Answers = Record<string, string | string[]>;

export function parseAnswers(lead: Pick<Lead, "answers"> | null | undefined): Answers {
  if (!lead?.answers) return {};
  try {
    const a = JSON.parse(lead.answers);
    return a && typeof a === "object" && !Array.isArray(a) ? (a as Answers) : {};
  } catch {
    return {};
  }
}

export function parseBookingAnswers(lead: Pick<Lead, "booking_answers"> | null | undefined): Array<{ q: string; a: string }> {
  if (!lead?.booking_answers) return [];
  try {
    const a = JSON.parse(lead.booking_answers);
    return Array.isArray(a) ? a.filter((x) => x && typeof x.q === "string").map((x) => ({ q: String(x.q), a: String(x.a ?? "") })) : [];
  } catch {
    return [];
  }
}

export function effectiveTier(lead: Pick<Lead, "tier" | "tier_override">): Tier | null {
  return (lead.tier_override || lead.tier) as Tier | null;
}

export async function getLead(rt: Runtime, id: string | null | undefined): Promise<Lead | null> {
  if (!id) return null;
  return (await rt.env.DB.prepare("SELECT * FROM leads WHERE id = ?").bind(id).first<Lead>()) || null;
}

export async function getLeadByEmail(rt: Runtime, email: string): Promise<Lead | null> {
  return (await rt.env.DB.prepare("SELECT * FROM leads WHERE email = ?").bind(email.toLowerCase()).first<Lead>()) || null;
}

export async function getLeadByRef(rt: Runtime, ref: string): Promise<Lead | null> {
  return (await rt.env.DB.prepare("SELECT * FROM leads WHERE ref_code = ?").bind(ref.toUpperCase()).first<Lead>()) || null;
}

const UPDATABLE = new Set<string>([
  "first_name", "last_name", "email", "phone", "whatsapp_opt_in", "answers", "step_reached", "app_started_at", "app_completed_at",
  "score", "score_breakdown", "tier", "tier_override", "route", "closer_id", "setter_id", "status", "booked_at", "call_at",
  "booking_provider", "booking_ref", "booking_cancelled_at", "booking_join_url", "booking_reschedule_url", "booking_cancel_url",
  "booking_host_email", "booking_answers", "booking_source", "whatsapp_last_in_at", "whatsapp_last_out_at", "unsubscribed_at",
  "revenue", "cash_collected", "closed_at", "showed_at", "lost_reason", "notes", "visitor_id", "channel", "utm_source", "utm_medium",
  "utm_campaign", "utm_content", "utm_term", "click_id", "click_type", "referrer", "landing_path", "variant", "lander", "ft_lander",
  "country", "region", "city", "device", "fbp", "fbc", "do_not_call_at", "call_consent_at", "call_consent_text", "timezone",
  "industry", "revenue_band", "budget_band", "willing_to_invest", "qual_source", "qual_flags", "temperature", "objection",
  "follow_up_at", "decision_maker", "fit_rating", "offer", "payment_plan", "installments_total", "next_payment_at",
  "contract_signed_at", "refunded_at", "refund_amount", "loi_signed_at", "target_business", "booking_verified",
]);

export async function updateLead(rt: Runtime, id: string, patch: Partial<Lead>): Promise<void> {
  const keys = Object.keys(patch).filter((k) => UPDATABLE.has(k));
  if (!keys.length) return;
  const sets = keys.map((k) => `${k} = ?`).join(", ");
  const vals = keys.map((k) => (patch as Record<string, unknown>)[k] ?? null);
  await rt.env.DB.prepare(`UPDATE leads SET ${sets}, updated_at = ? WHERE id = ?`).bind(...vals, rt.now(), id).run();
}

export function displayName(lead: Pick<Lead, "first_name" | "last_name" | "email">): string {
  const n = [lead.first_name, lead.last_name].filter(Boolean).join(" ").trim();
  return n || lead.email;
}

/** Session context (IP, UA, fbp/fbc) from the lead's most recent session, for server-side conversions. */
export async function leadSessionContext(rt: Runtime, lead: Lead): Promise<{ ip: string | null; ua: string | null; fbp: string | null; fbc: string | null; consent: string | null; country: string | null; path: string | null }> {
  const s = await rt.env.DB.prepare(
    `SELECT s.ip, s.user_agent, s.country, s.landing_path, v.consent FROM sessions s LEFT JOIN visitors v ON v.id = s.visitor_id
     WHERE s.lead_id = ? OR s.visitor_id = ? ORDER BY s.last_seen_at DESC LIMIT 1`,
  ).bind(lead.id, lead.visitor_id || "").first<{ ip: string | null; user_agent: string | null; country: string | null; landing_path: string | null; consent: string | null }>();
  return { ip: s?.ip ?? null, ua: s?.user_agent ?? null, fbp: lead.fbp, fbc: lead.fbc, consent: s?.consent ?? null, country: s?.country ?? lead.country, path: s?.landing_path ?? null };
}
