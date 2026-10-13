// Human labels for the Emails tab: short sequence names ("A tier", not "Tier a"), what starts each behaviour
// trigger and when it fires ("12 h after booking"), and every template's subject line (rendered once with a
// sample lead, cached per isolate).

import type { EmailCtx } from "../integrations/email-types";
import type { Lead } from "../funnel/leads";
import { SEQUENCES } from "../integrations/sequences";
import { TEMPLATES } from "../integrations/all-templates";
import { RULES } from "../personalize/triggers";
import { buildDossier } from "../followup/dossier";

/** "A tier: get booked" → "A tier"; ids without a sequence get a readable fallback. */
export function sequenceName(id: string): string {
  const s = SEQUENCES[id];
  if (s) return s.label.split(":")[0].trim();
  const t = String(id || "").replace(/_/g, " ");
  return t.charAt(0).toUpperCase() + t.slice(1);
}

const TRIGGER_ANCHOR: Record<string, string> = {
  t_vsl_no_apply: "watching half the film",
  t_stalled: "they stop partway (30 min idle)",
  t_finish_booking: "picking a date",
  t_came_back: "they come back to the site",
  t_still_thinking: "the third visit",
  t_guarantee: "reading the guarantee",
  t_cost: "looking into cost",
  t_book_nudge: "opening the booking page",
  t_breakout_done: "watching the breakout video",
};
const TRIGGER_FIXED: Record<string, string> = { t_watch_prep: "12 h after booking" };

/** Pure: when a trigger fires, in words. */
export function triggerWhen(template: string, delayMin: number): string {
  if (TRIGGER_FIXED[template]) return TRIGGER_FIXED[template];
  const anchor = TRIGGER_ANCHOR[template] || "the trigger";
  if (!delayMin) return `Right after ${anchor}`;
  const d = delayMin >= 120 && delayMin % 60 === 0 ? `${delayMin / 60} h` : `${delayMin} min`;
  return `${d} after ${anchor}`;
}

let subjects: Map<string, string> | null = null;

/** Every template's subject with a sample lead (no personalisation, nothing sent). */
export function templateSubjects(): Map<string, string> {
  if (subjects) return subjects;
  const lead = { id: "lpreview0000000000000", ref_code: "OP-SAMPLE", email: "sample@example.com", first_name: "Alex", answers: "{}", status: "applied", booking_source: "funnel", tier: "A" } as unknown as Lead;
  const ctx: EmailCtx = {
    lead, d: buildDossier(lead), firstName: "Alex", link: (p) => p, a: (p, l) => `<a href="${p}">${l}</a>`, bookPath: "/book",
    callTime: "Tuesday 14 October at 15:00 (CEST)", closerName: "Bendik", sigName: "Bendik", now: Date.now(),
  };
  const out = new Map<string, string>();
  for (const id of Object.keys(TEMPLATES)) {
    try { out.set(id, String(TEMPLATES[id](ctx).subject || id)); } catch { out.set(id, id); }
  }
  subjects = out;
  return out;
}

export function emailCatalog() {
  const subj = templateSubjects();
  return {
    sequence_names: Object.fromEntries([...Object.keys(SEQUENCES), "behaviour"].map((id) => [id, sequenceName(id)])),
    triggers: RULES.map((r, i) => ({ index: i, template: r.template, label: r.label, delay_min: r.delayMin, when: triggerWhen(r.template, r.delayMin), subject: subj.get(r.template) || r.template })),
    subjects: Object.fromEntries(subj),
  };
}
