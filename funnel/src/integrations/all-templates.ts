import { CORE_TEMPLATES, CORE_TOPICS, PRECALL_GENERAL } from "./templates";
import { FOLLOWUP_TEMPLATES, FOLLOWUP_TOPICS, ANSWER_TEMPLATES, prepTemplates } from "../followup/templates";
import type { Template } from "./email-types";
import type { Dossier } from "../followup/dossier";

export const TEMPLATES: Record<string, Template> = { ...CORE_TEMPLATES, ...FOLLOWUP_TEMPLATES };
export const TEMPLATE_TOPICS: Record<string, string[]> = { ...CORE_TOPICS, ...FOLLOWUP_TOPICS };
export { ANSWER_TEMPLATES, PRECALL_GENERAL, prepTemplates };

/** General pre-call emails that speak to each blocker and each goal answer (most relevant first). */
export const PRECALL_MATCH: { blockers: Record<string, string[]>; goal: Record<string, string[]> } = {
  blockers: {
    dev_capacity: ["pc_no_dev", "pc_claude_code"],
    agency_lockin: ["pc_agency", "pc_two_paths"],
    tracking: ["pc_pixel", "pc_capi"],
    tool_sprawl: ["pc_saas", "pc_dashboard"],
    time: ["pc_team_time"],
    ai_doubt: ["pc_ai_doubt", "pc_claude_code"],
  },
  goal: {
    own_growth: ["pc_ownership", "pc_vsl", "pc_rent"],
    cut_costs: ["pc_rent", "pc_dev_quote", "pc_agency"],
    internal_tools: ["pc_no_dev", "pc_dashboard", "pc_claude_code"],
    unsure: ["pc_agenda", "pc_if_you_could"],
  },
};

/**
 * Pure: the general pre-call emails ranked by how well they match this lead's blockers (3 points each, the
 * first-named blocker counts most) and goal (2 points), then "how the call runs" as a fallback. Only matched
 * templates are returned, best first; ties keep PRECALL_GENERAL order.
 */
export function rankPrecall(d: Dossier): string[] {
  const score = new Map<string, number>();
  const add = (t: string, n: number) => score.set(t, (score.get(t) || 0) + n);
  d.blockers.forEach((b, i) => (PRECALL_MATCH.blockers[b.value] || []).forEach((t, j) => add(t, 3 + (i === 0 ? 1 : 0) - j * 0.5)));
  if (d.goal) (PRECALL_MATCH.goal[d.goal.value] || []).forEach((t, j) => add(t, 2 - j * 0.5));
  add("pc_agenda", 0.5);
  return [...PRECALL_GENERAL].filter((t) => (score.get(t) || 0) > 0).sort((a, b) => (score.get(b) || 0) - (score.get(a) || 0) || PRECALL_GENERAL.indexOf(a) - PRECALL_GENERAL.indexOf(b));
}

/**
 * Pre-call plan (round 3): short and specific. The application brief first, then the best-matching general
 * email, then alternate lead-specific prep emails with the next best matches; "three things to prepare" closes
 * a short plan. Capped at `max` (PRECALL_MAX_TOTAL); the cron's per-day pacing decides how many actually go.
 * Deterministic per dossier, so step i always maps to the same template.
 */
export function precallPlan(d: Dossier, max = 5): string[] {
  const prep = prepTemplates(d).filter((t) => t !== "pp_homework");
  const ranked = rankPrecall(d);
  const out: string[] = [];
  if (prep[0] === "pp_brief") out.push(prep.shift() as string);
  while ((prep.length || ranked.length) && out.length < max) {
    if (ranked.length) out.push(ranked.shift() as string);
    if (prep.length && out.length < max) out.push(prep.shift() as string);
  }
  if (out.length < max) out.push("pp_homework");
  return out.slice(0, max);
}

