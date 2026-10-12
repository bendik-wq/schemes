import { CORE_TEMPLATES, CORE_TOPICS, PRECALL_GENERAL } from "./templates";
import { FOLLOWUP_TEMPLATES, FOLLOWUP_TOPICS, ANSWER_TEMPLATES, prepTemplates } from "../followup/templates";
import type { Template } from "./email-types";
import type { Dossier } from "../followup/dossier";

export const TEMPLATES: Record<string, Template> = { ...CORE_TEMPLATES, ...FOLLOWUP_TEMPLATES };
export const TEMPLATE_TOPICS: Record<string, string[]> = { ...CORE_TOPICS, ...FOLLOWUP_TOPICS };
export { ANSWER_TEMPLATES, PRECALL_GENERAL, prepTemplates };

/**
 * Pre-call plan: the first two lead-specific prep emails, then alternate the remaining prep
 * emails with the general one-pain-point emails, then the rest of the general ones.
 * Deterministic per dossier, so step i always maps to the same template.
 */
export function precallPlan(d: Dossier): string[] {
  const prep = prepTemplates(d);
  const general = [...PRECALL_GENERAL];
  const out: string[] = prep.slice(0, 2);
  const restPrep = prep.slice(2);
  while (restPrep.length || general.length) {
    if (general.length) out.push(general.shift() as string);
    if (restPrep.length) out.push(restPrep.shift() as string);
  }
  return out;
}
