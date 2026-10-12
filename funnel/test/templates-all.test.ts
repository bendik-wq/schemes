import { describe, it, expect } from "vitest";
import { TEMPLATES, TEMPLATE_TOPICS, PRECALL_GENERAL, precallPlan } from "../src/integrations/all-templates";
import { SEQUENCES } from "../src/integrations/sequences";
import { RULES } from "../src/personalize/triggers";
import { buildDossier } from "../src/followup/dossier";
import type { EmailCtx } from "../src/integrations/email-types";
import type { Lead } from "../src/funnel/leads";
import { BANNED_PHRASES } from "../src/config";

function ctx(lead: Partial<Lead>): EmailCtx {
  const d = buildDossier(lead as Lead);
  return {
    lead: lead as Lead, d, firstName: d.firstName, link: (p) => `https://x.test/r${p}`, a: (p, l) => `<a href="https://x.test${p}">${l}</a>`,
    bookPath: "/book", callTime: null, closerName: "Bendik", sigName: "Bendik", now: Date.now(),
  };
}

describe("all templates", () => {
  it("every template referenced by a sequence, the pre-call plan or a trigger exists", () => {
    for (const s of Object.values(SEQUENCES)) for (const st of s.steps) expect(TEMPLATES[st.template], `${s.id}:${st.template}`).toBeTypeOf("function");
    for (const t of PRECALL_GENERAL) expect(TEMPLATES[t], t).toBeTypeOf("function");
    for (const r of RULES) expect(TEMPLATES[r.template], r.template).toBeTypeOf("function");
    for (const t of ["continue_link", "voice_link_book", "voice_link_reschedule", "test_email"]) expect(TEMPLATES[t], t).toBeTypeOf("function");
  });
  it("pre-call plan puts two personal emails first and only uses real templates", () => {
    const full = buildDossier({ answers: JSON.stringify({ business: "Dental clinics", goal: "own_growth", blockers: ["tracking", "time"], spend: "100k_300k", timeline: "0_3", why_now: "Because." }) } as Lead);
    const plan = precallPlan(full);
    expect(plan[0]).toBe("pp_brief");
    expect(plan[1].startsWith("pp_")).toBe(true);
    for (const t of plan) expect(TEMPLATES[t], t).toBeTypeOf("function");
    expect(new Set(plan).size).toBe(plan.length);
    expect(precallPlan(buildDossier(null))[0]).toBe("pp_homework");
  });
  it("subjects are unique across every template and topics exist", () => {
    const c = ctx({ answers: "{}" });
    const seen = new Map<string, string>();
    for (const [id, t] of Object.entries(TEMPLATES)) {
      const subj = t(c).subject;
      if (id !== "fu_objection") {
        expect(seen.has(subj), `${id} duplicates ${seen.get(subj)}: ${subj}`).toBe(false);
        seen.set(subj, id);
      }
      expect(TEMPLATE_TOPICS[id]?.length, id).toBeGreaterThan(0);
    }
  });
  it("no banned phrase anywhere, empty lead", () => {
    const c = ctx({ answers: "{}" });
    for (const [id, t] of Object.entries(TEMPLATES)) {
      const out = t(c);
      const all = [out.subject, out.preheader || "", ...out.paragraphs, out.ps || ""].join(" ").toLowerCase();
      for (const b of BANNED_PHRASES) expect(all.includes(b), `${id}: ${b}`).toBe(false);
      expect(/undefined|null|nan/i.test(all.replace(/annual/g, "")), id).toBe(false);
    }
  });
});
