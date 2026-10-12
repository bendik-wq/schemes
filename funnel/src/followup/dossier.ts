// The application reader. Turns a lead's answers and booking answers into a dossier that email
// templates can quote. EVERYTHING a lead typed is escaped and defanged here, once, so no template
// can forget. Strings in the dossier are HTML-safe; the plain-text part decodes entities later.

import { APPLICATION } from "../config";
import { getIndustry, inferIndustry } from "../landers/catalog";
import { parseAnswers, parseBookingAnswers, type Lead } from "../funnel/leads";
import { escHtml, quoteSafe, safeFirstName } from "../lib/text";

export interface Choice { value: string; label: string; }

export interface Dossier {
  firstName: string;
  /** Escaped + defanged business description, or "". */
  business: string;
  industry: { id: string; label: string; one: string; many: string; tool: string; rent: string } | null;
  role: Choice | null;
  revenue: Choice | null;
  spend: Choice | null;
  goal: Choice | null;
  timeline: Choice | null;
  blockers: Choice[];
  readiness: Choice | null;
  /** Escaped + defanged, trimmed to 280 chars. */
  whyNow: string;
  bookingQA: Array<{ q: string; a: string }>;
  objection: string | null;
  lostReason: string | null;
  tier: string | null;
  /** Illustrative first build, keyed by spend band. Always labelled illustrative in copy. */
  firstBuild: { spendMid: number; spendLabel: string; build: string } | null;
  hasApplication: boolean;
}

function choice(qid: string, v: unknown): Choice | null {
  if (typeof v !== "string") return null;
  const opt = APPLICATION.find((q) => q.id === qid)?.options?.find((o) => o.value === v);
  return opt ? { value: opt.value, label: escHtml(opt.label) } : null;
}

const SPEND_MID: Record<string, { mid: number; label: string; build: string }> = {
  under_25k: { mid: 15_000, label: "around $15k", build: "one VSL page and application, plus server-side tracking" },
  "25k_100k": { mid: 60_000, label: "around $60k", build: "the VSL page, tracking and the sales dashboard, replacing the pieces you rent today" },
  "100k_300k": { mid: 180_000, label: "around $180k", build: "the full growth machine plus one internal tool your team keeps asking for" },
  "300k_plus": { mid: 350_000, label: "$300k or more", build: "the full growth machine and a roadmap of internal tools, prioritised by what you spend most on" },
};

const KNOWN_OBJECTIONS = new Set(["Price", "Timing", "Needs to think", "Partner/spouse", "Funding doubts", "Trust/proof", "Time to commit", "Not a fit"]);
const KNOWN_LOST = new Set(["Price", "Timing", "Chose agency", "Built in-house", "No response", "Not a fit", "Trust", "Other"]);

export function buildDossier(lead: Partial<Lead> | null | undefined): Dossier {
  const l = (lead || {}) as Partial<Lead>;
  const a = parseAnswers(l as Lead);
  const booking = parseBookingAnswers(l as Lead).slice(0, 8).map((x) => ({ q: quoteSafe(x.q, 120), a: quoteSafe(x.a, 280) })).filter((x) => x.a);
  const businessRaw = typeof a.business === "string" ? a.business : "";
  const ind = getIndustry(l.industry) || inferIndustry(businessRaw, ...parseBookingAnswers(l as Lead).map((x) => x.a));
  const blockersRaw = Array.isArray(a.blockers) ? a.blockers : typeof a.blockers === "string" ? [a.blockers] : [];
  const spend = choice("spend", a.spend) || choice("spend", l.budget_band);
  const fb = spend ? SPEND_MID[spend.value] : undefined;
  return {
    firstName: escHtml(safeFirstName(l.first_name)),
    business: businessRaw ? quoteSafe(businessRaw, 160) : "",
    industry: ind ? { id: ind.id, label: escHtml(ind.label), one: ind.one, many: ind.many, tool: ind.tool, rent: ind.rent } : null,
    role: choice("role", a.role),
    revenue: choice("revenue", a.revenue) || choice("revenue", l.revenue_band),
    spend,
    goal: choice("goal", a.goal),
    timeline: choice("timeline", a.timeline),
    blockers: blockersRaw.map((b) => choice("blockers", b)).filter((x): x is Choice => !!x),
    readiness: choice("readiness", a.readiness),
    whyNow: typeof a.why_now === "string" ? quoteSafe(a.why_now, 280) : "",
    bookingQA: booking,
    objection: l.objection && KNOWN_OBJECTIONS.has(l.objection) ? l.objection : null,
    lostReason: l.lost_reason && KNOWN_LOST.has(l.lost_reason) ? l.lost_reason : null,
    tier: (l.tier_override || l.tier || null) as string | null,
    firstBuild: fb ? { spendMid: fb.mid, spendLabel: fb.label, build: fb.build } : null,
    hasApplication: Object.keys(a).length > 0,
  };
}

export function fmtMoney(n: number): string {
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(n % 1_000_000 ? 1 : 0)}M`;
  if (n >= 1000) return `$${Math.round(n / 1000)}k`;
  return `$${Math.round(n)}`;
}
