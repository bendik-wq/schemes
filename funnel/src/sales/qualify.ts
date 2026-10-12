// Qualify people who booked straight through Calendly from their booking-form answers,
// so they show up in the A/B/C insights next to funnel leads.

import type { Runtime } from "../app";
import type { Tier } from "../config";
import { inferIndustry } from "../landers/catalog";
import { parseBookingAnswers, type Lead } from "../funnel/leads";

export interface Qualification {
  revenue_band: string | null;
  budget_band: string | null;
  willing_to_invest: string | null;
  industry: string | null;
  tier: Tier;
  flags: string[];
}

/** Parse "$2.5M", "2,500,000", "3m", "750k", "NOK 30 mill" into dollars-ish numbers (best effort). */
export function parseAmount(text: string): number | null {
  const t = text.toLowerCase().replace(/,/g, "").replace(/\s+/g, " ");
  const m = t.match(/(\d+(?:\.\d+)?)\s*(m|mm|mil|mill|million|millioner|k|thousand|b|bn|billion)?/);
  if (!m) return null;
  let n = Number(m[1]);
  const unit = m[2] || "";
  if (/^(m|mm|mil|mill|million|millioner)$/.test(unit)) n *= 1_000_000;
  else if (/^(k|thousand)$/.test(unit)) n *= 1000;
  else if (/^(b|bn|billion)$/.test(unit)) n *= 1_000_000_000;
  if (/\bnok\b|\bkr\b|kroner/.test(t)) n /= 10; // rough NOK → USD
  return Number.isFinite(n) ? n : null;
}

export function revenueBand(n: number | null): string | null {
  if (n == null) return null;
  if (n < 1_000_000) return "under_1m";
  if (n < 3_000_000) return "1m_3m";
  if (n < 10_000_000) return "3m_10m";
  return "10m_plus";
}

export function spendBand(n: number | null): string | null {
  if (n == null) return null;
  if (n < 25_000) return "under_25k";
  if (n < 100_000) return "25k_100k";
  if (n < 300_000) return "100k_300k";
  return "300k_plus";
}

export function qualifyCalendly(answers: Array<{ q: string; a: string }>): Qualification {
  let revenue: string | null = null, budget: string | null = null, willing: string | null = null, industry: string | null = null;
  const flags: string[] = [];
  const texts: string[] = [];
  for (const { q, a } of answers) {
    const ql = q.toLowerCase(), al = a.toLowerCase().trim();
    texts.push(a);
    if (/revenue|turnover|omsetning|annual sales/.test(ql)) revenue = revenueBand(parseAmount(al)) ?? revenue;
    else if (/budget|spend|invest(ment)? (range|amount)|agency|software/.test(ql) && /\d/.test(al)) budget = spendBand(parseAmount(al)) ?? budget;
    if (/willing|ready to invest|able to invest|prepared to invest/.test(ql)) {
      willing = /^(yes|ja|y\b|absolutely|definitely)/.test(al) ? "yes" : /^(no|nei|not)/.test(al) ? "no" : "maybe";
    }
    if (/industry|business|company|what do you (do|sell)/.test(ql)) industry = inferIndustry(a)?.id ?? industry;
  }
  industry = industry || inferIndustry(...texts)?.id || null;
  let score = 0;
  score += revenue === "10m_plus" ? 40 : revenue === "3m_10m" ? 35 : revenue === "1m_3m" ? 25 : 0;
  score += budget === "300k_plus" ? 30 : budget === "100k_300k" ? 25 : budget === "25k_100k" ? 15 : budget === "under_25k" ? 5 : 10;
  score += willing === "yes" ? 30 : willing === "maybe" ? 15 : willing === "no" ? 0 : 10;
  if (revenue === "under_1m") flags.push("under_1m");
  if (willing === "no") flags.push("not_ready");
  if (budget === "under_25k") flags.push("low_spend");
  let tier: Tier = score >= 70 ? "A" : score >= 40 ? "B" : "C";
  if (flags.includes("under_1m")) tier = "C";
  else if (tier === "A" && (flags.includes("not_ready") || flags.includes("low_spend"))) tier = "B";
  return { revenue_band: revenue, budget_band: budget, willing_to_invest: willing, industry, tier, flags };
}

/** Apply Calendly qualification to a lead that has no completed application. Field updates only. */
export async function applyCalendlyQualification(rt: Runtime, lead: Lead): Promise<boolean> {
  if (lead.app_completed_at) return false;
  const answers = parseBookingAnswers(lead);
  if (!answers.length) return false;
  const q = qualifyCalendly(answers);
  await rt.env.DB.prepare(
    `UPDATE leads SET revenue_band = COALESCE(?, revenue_band), budget_band = COALESCE(?, budget_band), willing_to_invest = COALESCE(?, willing_to_invest),
       industry = COALESCE(industry, ?), tier = ?, qual_source = 'calendly', qual_flags = ?, updated_at = ? WHERE id = ?`,
  ).bind(q.revenue_band, q.budget_band, q.willing_to_invest, q.industry, q.tier, q.flags.join(","), rt.now(), lead.id).run();
  return true;
}

export async function requalifyCalendlyLeads(rt: Runtime): Promise<number> {
  const rows = (await rt.env.DB.prepare("SELECT * FROM leads WHERE app_completed_at IS NULL AND booking_answers IS NOT NULL LIMIT 2000").all<Lead>()).results || [];
  let n = 0;
  for (const l of rows) if (await applyCalendlyQualification(rt, l)) n++;
  return n;
}
