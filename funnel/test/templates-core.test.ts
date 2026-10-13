import { describe, expect, it } from "vitest";
import { APPLICATION, BANNED_PHRASES, OUTCOME_PROMISES } from "../src/config";
import { buildDossier } from "../src/followup/dossier";
import type { Lead } from "../src/funnel/leads";
import type { EmailContent, EmailCtx } from "../src/integrations/email-types";
import { CORE_TEMPLATES, CORE_TOPICS, PRECALL_GENERAL } from "../src/integrations/templates";
import { escHtml } from "../src/lib/text";

const TOPICS = new Set([
  "offer", "price", "time", "tech", "agency", "guarantee", "results", "trust", "ownership", "after", "tracking", "pages",
  "dashboard", "followup", "tools", "booking", "application", "resources", "call", "industry", "goal", "blocker", "why_now", "numbers",
]);
const ALLOWED_PATHS = new Set(["/apply", "/book", "/breakout", "/resources", "/", "/go/join", "/go/reschedule", "/go/confirm", "/go/requalify"]);

function fullAnswers(): string {
  const a: Record<string, string | string[]> = {};
  for (const q of APPLICATION) {
    if (q.type === "contact") continue;
    if (q.id === "business") a.business = "Dental implants to patients in Bergen, three clinics";
    else if (q.id === "why_now") a.why_now = "Our agency contract ends in January and we want to own the next version ourselves.";
    else if (q.type === "multi") a[q.id] = (q.options || []).map((o) => o.value);
    else if (q.type === "single") a[q.id] = (q.options || [])[0].value;
    else a[q.id] = "Some answer";
  }
  return JSON.stringify(a);
}

function makeCtx(lead: Partial<Lead>, bookPath: string, callTime: string | null): EmailCtx {
  const d = buildDossier(lead);
  return {
    lead: lead as Lead,
    d,
    firstName: d.firstName,
    link: (path: string) => `https://example.test${path}?t=sig`,
    a: (path: string, label: string) => `<a href="https://example.test${path}?t=sig">${escHtml(label)}</a>`,
    bookPath,
    callTime,
    closerName: "Bendik",
    sigName: "Bendik",
    now: Date.now(),
  };
}

const empty = makeCtx({ answers: "", first_name: null }, "/resources", null);
const full = makeCtx(
  {
    first_name: "Kari",
    answers: fullAnswers(),
    booking_answers: JSON.stringify([{ q: "Anything we should know?", a: "We run three clinics and want our own tracking." }]),
    call_at: Date.now() + 3 * 86400000,
    industry: "dental",
    tier: "A",
  },
  "/book",
  "Tuesday 14 October at 15:00 (CEST)",
);
const otherCloser: EmailCtx = { ...full, closerName: "Ingrid", bookPath: "/breakout" };

const CASES: Array<[string, EmailCtx]> = [["empty", empty], ["full", full], ["other closer", otherCloser]];
const ids = Object.keys(CORE_TEMPLATES);

function texts(e: EmailContent): string[] {
  return [e.subject, e.preheader || "", ...e.paragraphs, e.ps || "", e.cta?.label || ""];
}

describe("core email templates", () => {
  it("full dossier is actually full", () => {
    expect(full.d.business).not.toBe("");
    expect(full.d.goal).not.toBeNull();
    expect(full.d.blockers.length).toBeGreaterThan(0);
    expect(full.d.industry).not.toBeNull();
    expect(empty.d.hasApplication).toBe(false);
  });

  for (const [name, ctx] of CASES) {
    describe(`renders with ${name} lead`, () => {
      for (const id of ids) {
        it(id, () => {
          const e = CORE_TEMPLATES[id](ctx);
          const all = texts(e).join("\n");
          expect(all).not.toMatch(/undefined|\bnull\b|NaN|\[object/);
          expect(all).not.toContain("!");
          expect(e.subject.length).toBeLessThan(80);
          expect(e.subject).not.toMatch(/[<>&]/);
          expect(e.paragraphs[0]).toMatch(/^Hi /);
          expect(e.paragraphs[0]).toBe(`Hi ${ctx.firstName},`);
          expect(e.paragraphs.length).toBeGreaterThanOrEqual(3);
          expect(e.paragraphs.length).toBeLessThanOrEqual(7);
          for (const p of e.paragraphs) expect(p.trim()).not.toBe("");
          const lower = all.toLowerCase();
          for (const b of BANNED_PHRASES) expect(lower, `banned "${b}" in ${id}`).not.toContain(b);
          expect(lower).not.toMatch(/\bfree\s+(strategy\s+)?(call|consultation|session)/);
          for (const t of texts(e)) for (const re of OUTCOME_PROMISES) expect(t, `outcome promise in ${id}`).not.toMatch(re);
          expect(all).not.toMatch(/https?:\/\/(?!example\.test)/);
          // Strip what comes from the context (call time zone, their own spend answer) before the copy checks.
          let own = all;
          if (ctx.callTime) own = own.split(ctx.callTime).join("");
          if (ctx.d.spend) own = own.split(ctx.d.spend.label).join("");
          expect(own).not.toMatch(/\b[A-Z]{4,}\b/);
          expect(lower).not.toMatch(/i saw you|you watched|you read /);
          if (e.cta) expect(ALLOWED_PATHS.has(e.cta.path) || e.cta.path === ctx.bookPath).toBe(true);
          // Any dollar figure other than the $1M fit threshold must be labelled illustrative.
          if (/\$\d/.test(own.replace(/\$1M/g, ""))) expect(lower).toContain("illustrative, not advice");
        });
      }
    });
  }

  it("subjects are unique and short", () => {
    const subs = ids.map((id) => CORE_TEMPLATES[id](full).subject);
    expect(new Set(subs).size).toBe(subs.length);
    const subsEmpty = ids.map((id) => CORE_TEMPLATES[id](empty).subject);
    expect(new Set(subsEmpty).size).toBe(subsEmpty.length);
  });

  it("every template has 1-3 known topics, and no stray topics", () => {
    for (const id of ids) {
      const t = CORE_TOPICS[id];
      expect(t, id).toBeDefined();
      expect(t.length).toBeGreaterThanOrEqual(1);
      expect(t.length).toBeLessThanOrEqual(3);
      for (const x of t) expect(TOPICS.has(x), `${id}: ${x}`).toBe(true);
    }
    for (const id of Object.keys(CORE_TOPICS)) expect(CORE_TEMPLATES[id], id).toBeDefined();
  });

  it("PRECALL_GENERAL has 24 unique existing ids", () => {
    expect(PRECALL_GENERAL.length).toBe(24);
    expect(new Set(PRECALL_GENERAL).size).toBe(24);
    for (const id of PRECALL_GENERAL) expect(CORE_TEMPLATES[id], id).toBeDefined();
  });

  it("has exactly the expected ids", () => {
    const expected = [
      ...["ab_1", "ab_2", "ab_3", "ab_4", "ab_5"],
      ...Array.from({ length: 8 }, (_, i) => `ta_${i + 1}`),
      ...Array.from({ length: 8 }, (_, i) => `tb_${i + 1}`),
      ...Array.from({ length: 6 }, (_, i) => `tc_${i + 1}`),
      "bk_confirm", "bk_48h", "bk_24h", "bk_2h", "bk_3h", "bk_1h", "bk_10m",
      "continue_link", "voice_link_book", "voice_link_reschedule", "test_email",
      "t_vsl_no_apply", "t_stalled", "t_finish_booking", "t_came_back", "t_still_thinking", "t_guarantee", "t_cost",
      "t_book_nudge", "t_breakout_done", "t_watch_prep",
      ...PRECALL_GENERAL,
    ];
    expect(ids.sort()).toEqual([...expected].sort());
  });

  it("booking reminders carry the call time and the join and reschedule links", () => {
    for (const id of ["bk_48h", "bk_24h", "bk_2h", "bk_3h", "bk_1h", "bk_10m"]) {
      const all = CORE_TEMPLATES[id](full).paragraphs.join(" ");
      expect(all).toContain(full.callTime as string);
      expect(all).toContain("/go/join");
      expect(all).toContain("/go/reschedule");
    }
    expect(CORE_TEMPLATES.bk_confirm(full).paragraphs.join(" ")).toContain("/breakout");
  });
});
