import { describe, expect, it } from "vitest";
import { BANNED_PHRASES, OUTCOME_PROMISES, OBJECTIONS, LOST_REASONS } from "../src/config";
import { buildDossier } from "../src/followup/dossier";
import {
  ANSWER_TEMPLATES,
  BLOCKERS,
  FOLLOWUP_TEMPLATES,
  FOLLOWUP_TOPICS,
  GOALS,
  LOST_ANGLES,
  OBJECTION_COPY,
  TIMELINES,
  prepTemplates,
} from "../src/followup/templates";
import type { EmailContent, EmailCtx } from "../src/integrations/email-types";
import type { Lead } from "../src/funnel/leads";

const TAGS = new Set([
  "offer", "price", "time", "tech", "agency", "guarantee", "results", "trust", "ownership", "after", "tracking", "pages",
  "dashboard", "followup", "tools", "booking", "application", "resources", "call", "industry", "goal", "blocker", "why_now", "numbers",
]);
const PATHS = new Set(["/book", "/breakout", "/resources", "/apply", "/go/join", "/go/reschedule", "/"]);

function ctx(lead: Partial<Lead>, callTime: string | null = null): EmailCtx {
  const d = buildDossier(lead);
  return {
    lead: lead as Lead,
    d,
    firstName: d.firstName,
    link: (p) => `https://example.test${p}?t=x`,
    a: (p, label) => `<a href="https://example.test${p}">${label}</a>`,
    bookPath: "/book",
    callTime,
    closerName: "Bendik",
    sigName: "Bendik",
    now: Date.now(),
  };
}

const fullLead: Partial<Lead> = {
  first_name: "Kari",
  status: "showed",
  call_at: Date.now() + 3 * 86_400_000,
  answers: JSON.stringify({
    business: "Dental implants to patients in Bergen, three clinics",
    role: "owner",
    revenue: "3m_10m",
    spend: "100k_300k",
    goal: "own_growth",
    timeline: "0_3",
    blockers: ["tracking", "agency_lockin"],
    readiness: "partner",
    why_now: "Our agency contract ends in March and we want to own the funnel.",
  }),
  booking_answers: JSON.stringify([{ q: "What should we cover?", a: "How to move off our agency without losing leads." }]),
  objection: "Price",
  lost_reason: "Timing",
};

const cases: Array<[string, EmailCtx]> = [
  ["empty", ctx({})],
  ["full", ctx(fullLead, "Tuesday 14 October at 15:00 (CEST)")],
];

function text(e: EmailContent): string {
  return [e.subject, e.preheader || "", ...e.paragraphs, e.ps || "", e.cta?.label || "", e.cta?.path || ""].join("\n");
}

describe("follow-up templates", () => {
  for (const [name, c] of cases) {
    describe(`${name} lead`, () => {
      const rendered = Object.entries(FOLLOWUP_TEMPLATES).map(([id, t]) => [id, t(c)] as const);

      it("render cleanly", () => {
        for (const [id, e] of rendered) {
          const all = text(e);
          expect(all, id).not.toMatch(/undefined|null|NaN/);
          expect(all, id).not.toContain("!");
          expect(all.toLowerCase(), id).not.toMatch(/\bfree\s+(strategy\s+)?(call|consultation|session)/);
          for (const p of BANNED_PHRASES) expect(all.toLowerCase(), `${id}: ${p}`).not.toContain(p);
          for (const p of e.paragraphs) for (const re of OUTCOME_PROMISES) expect(p, id).not.toMatch(re);
          expect(e.paragraphs[0], id).toBe(`Hi ${c.firstName},`);
          expect(e.paragraphs.length, id).toBeGreaterThanOrEqual(3);
          expect(e.paragraphs.length, id).toBeLessThanOrEqual(7);
          expect(e.subject.length, id).toBeGreaterThan(0);
          expect(e.subject.length, id).toBeLessThan(80);
          expect(e.subject, id).not.toMatch(/[<>&]/);
          expect(all, id).not.toMatch(/https?:\/\//);
          if (e.cta) expect(PATHS.has(e.cta.path), id).toBe(true);
        }
      });

      it("has unique subjects", () => {
        const subjects = rendered.map(([, e]) => e.subject);
        expect(new Set(subjects).size).toBe(subjects.length);
      });
    });
  }

  it("full lead quotes answers", () => {
    const c = cases[1][1];
    expect(FOLLOWUP_TEMPLATES.pp_brief(c).paragraphs.join(" ")).toContain("“Our agency contract ends");
    expect(FOLLOWUP_TEMPLATES.pp_booking(c).paragraphs.join(" ")).toContain("“How to move off our agency");
    expect(FOLLOWUP_TEMPLATES.pp_numbers(c).paragraphs.join(" ")).toContain("illustrative, not advice");
    expect(FOLLOWUP_TEMPLATES.pp_industry(c).paragraphs.join(" ")).toContain("treatment-plan");
    expect(FOLLOWUP_TEMPLATES.fu_objection(c).subject).toBe(OBJECTION_COPY.Price.subject);
    expect(FOLLOWUP_TEMPLATES.lo_1(c).paragraphs).toContain(LOST_ANGLES.Timing[0][0]);
  });

  it("every template has topics", () => {
    for (const id of Object.keys(FOLLOWUP_TEMPLATES)) {
      const tags = FOLLOWUP_TOPICS[id];
      expect(tags, id).toBeDefined();
      expect(tags.length, id).toBeGreaterThanOrEqual(1);
      expect(tags.length, id).toBeLessThanOrEqual(3);
      for (const t of tags) expect(TAGS.has(t), `${id}: ${t}`).toBe(true);
    }
    for (const id of ANSWER_TEMPLATES) expect(FOLLOWUP_TEMPLATES[id], id).toBeDefined();
  });

  it("covers every answer value, objection and lost reason", () => {
    for (const v of ["dev_capacity", "agency_lockin", "tracking", "tool_sprawl", "time", "ai_doubt"]) expect(BLOCKERS[v], v).toBeDefined();
    for (const v of ["own_growth", "cut_costs", "internal_tools", "unsure"]) expect(GOALS[v], v).toBeDefined();
    for (const v of ["0_3", "3_6", "6_plus", "exploring"]) expect(TIMELINES[v], v).toBeDefined();
    for (const o of OBJECTIONS) expect(OBJECTION_COPY[o], o).toBeDefined();
    for (const r of LOST_REASONS) expect(LOST_ANGLES[r]?.length, r).toBe(6);
  });

  it("renders fu_objection and lo_* for every objection and lost reason", () => {
    for (const o of OBJECTIONS) {
      const e = FOLLOWUP_TEMPLATES.fu_objection(ctx({ objection: o }));
      expect(text(e)).not.toMatch(/undefined|null|NaN|!/);
    }
    for (const r of LOST_REASONS) {
      for (let i = 1; i <= 6; i++) {
        const e = FOLLOWUP_TEMPLATES[`lo_${i}`](ctx({ lost_reason: r }));
        expect(text(e)).not.toMatch(/undefined|null|NaN|!/);
        expect(e.paragraphs.length).toBeGreaterThanOrEqual(3);
        for (const p of BANNED_PHRASES) expect(text(e).toLowerCase()).not.toContain(p);
      }
    }
  });

  it("orders prep templates", () => {
    expect(prepTemplates(cases[0][1].d)).toEqual(["pp_homework"]);
    const full = prepTemplates(cases[1][1].d);
    expect(full[0]).toBe("pp_brief");
    expect(full[full.length - 1]).toBe("pp_homework");
    expect(full).toContain("pp_partner");
    expect(full).toContain("pp_blocker2");
    for (const id of full) expect(FOLLOWUP_TEMPLATES[id], id).toBeDefined();
  });

  it("escapes and defangs why_now", () => {
    const c = ctx({ first_name: "Ola", answers: JSON.stringify({ why_now: "<script>alert(1)</script> visit evil.com" }) });
    const all = text(FOLLOWUP_TEMPLATES.pp_why_now(c));
    expect(all).not.toContain("<script");
    expect(all).not.toContain("evil.com");
    expect(all).toContain("&lt;script&gt;");
  });
});
