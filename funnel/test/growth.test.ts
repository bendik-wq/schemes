import { describe, it, expect } from "vitest";
// @ts-ignore: the Workers tsconfig has no Node types; vitest runs these tests in Node.
import { readFileSync } from "node:fs";
import { BANNED_PHRASES, BRAND, FAQS, LANDING, OFFER, OUTCOME_PROMISES } from "../src/config";
import {
  ProofError, attribution, cleanProofInput, isRenderable, parseScope, pickProof, proofTextProblem, renderProof, safeMediaUrl, type ProofRow,
} from "../src/growth/proof";
import { bucketWins, cohortLine, endOfDay, fmtDay, noticeEligible, validDate } from "../src/growth/cohorts";
import { cleanRef } from "../src/growth/referrals";
import {
  ExperimentError, MIN_VISITORS_PER_ARM, cleanExperimentInput, compareArms, formatExpCookie, gateFrom, hashUnit, parseExpCookie, pickVariant,
} from "../src/growth/experiments";
import { offerStackHtml } from "../src/growth/offer";
import { setCohortSnapshot } from "../src/growth/snapshot";
import { parseTouch } from "../src/lib/attribution";
import { gateState } from "../src/funnel/pages";
import { SEQUENCES } from "../src/integrations/sequences";
import { TEMPLATES } from "../src/integrations/all-templates";
import { buildDossier } from "../src/followup/dossier";
import type { EmailCtx } from "../src/integrations/email-types";
import type { Lead } from "../src/funnel/leads";

const NOW = Date.UTC(2026, 9, 13, 12);

function proof(p: Partial<ProofRow> = {}): ProofRow {
  return {
    id: "p" + Math.random().toString(36).slice(2), kind: "quote", body: "Our team now ships page changes on its own, which we could not do before.",
    author_name: "Kari", author_role: "Founder", company: "Bergen Dental", industry: "dental", media_url: null,
    consent_at: NOW - 86_400_000, consent_scope: "site,name,company", approved: 1, lead_id: null, source: "admin",
    created_at: NOW - 1000, updated_at: NOW - 1000, ...p,
  };
}

const lower = (s: string) => s.toLowerCase();
function noBanned(s: string, label: string) {
  for (const b of BANNED_PHRASES) expect(lower(s).includes(b), `${label}: ${b}`).toBe(false);
}

describe("proof: only approved, consented, clean items ever render", () => {
  it("unapproved items never render", () => {
    expect(isRenderable(proof({ approved: 0 }))).toBe(false);
    expect(renderProof([proof({ approved: 0 })], null, "landing")).toBe("");
    expect(renderProof([proof({ approved: 0 })], null, "book")).toBe("");
  });
  it("items without recorded consent never render, even when approved", () => {
    expect(isRenderable(proof({ consent_at: null }))).toBe(false);
    expect(renderProof([proof({ consent_at: null })], "dental", "landing")).toBe("");
  });
  it("consent must cover this website", () => {
    expect(isRenderable(proof({ consent_scope: "email,ads" }))).toBe(false);
    expect(isRenderable(proof({ consent_scope: "" }))).toBe(false);
    expect(isRenderable(proof({ consent_scope: "site" }))).toBe(true);
  });
  it("text with a banned phrase or a promised outcome never renders", () => {
    for (const b of BANNED_PHRASES) expect(isRenderable(proof({ body: `It was great, ${b} and all.` })), b).toBe(false);
    expect(isRenderable(proof({ body: "They guarantee revenue growth for everyone." }))).toBe(false);
    expect(isRenderable(proof({ body: "Book the free strategy session." }))).toBe(false);
    expect(proofTextProblem("Calm, useful and our team owns it now.")).toBeNull();
  });
  it("media kinds need a safe URL; logos need company consent", () => {
    expect(isRenderable(proof({ kind: "screenshot", media_url: "javascript:alert(1)" }))).toBe(false);
    expect(isRenderable(proof({ kind: "screenshot", media_url: "https://cdn.example.com/a.png" }))).toBe(true);
    expect(isRenderable(proof({ kind: "logo", media_url: "https://cdn.example.com/l.svg", consent_scope: "site" }))).toBe(false);
    expect(safeMediaUrl("//evil.example/x.png")).toBe("");
  });
  it("a mixed list renders only the qualifying items, escaped, with no banned phrase", () => {
    const html = renderProof([
      proof({ body: "<script>alert(1)</script> We own the funnel now." }),
      proof({ body: "Unapproved words", approved: 0 }),
      proof({ body: "No consent words", consent_at: null }),
      proof({ body: "Email-only words", consent_scope: "email" }),
    ], null, "landing");
    expect(html).toContain("&lt;script&gt;");
    expect(html).not.toContain("<script>");
    expect(html).not.toContain("Unapproved words");
    expect(html).not.toContain("No consent words");
    expect(html).not.toContain("Email-only words");
    noBanned(html, "proof html");
  });
  it("prints a name or company only with that consent", () => {
    expect(attribution(proof({ consent_scope: "site" }))).toBe("A client in dental practices");
    expect(attribution(proof({ consent_scope: "site", industry: null }))).toBe("A client");
    expect(attribution(proof({ consent_scope: "site,name" }))).toBe("Kari, Founder");
    expect(attribution(proof({ consent_scope: "site,name,company" }))).toBe("Kari, Founder · Bergen Dental");
  });
  it("prefers the visitor's industry, shows at most three, and one short quote on /book", () => {
    const items = [proof({ industry: "law", updated_at: NOW }), proof({ industry: "dental", updated_at: NOW - 5000 }), proof(), proof(), proof()];
    expect(pickProof(items, "dental", "landing")[0].industry).toBe("dental");
    expect(pickProof(items, "dental", "landing").length).toBe(3);
    expect(pickProof(items, "dental", "book").length).toBe(1);
    expect(pickProof([proof({ kind: "metric", body: "Show rate up from 50% to 70%" })], null, "book")).toEqual([]);
    expect(renderProof([proof()], null, "book")).toContain("&ldquo;");
  });
  it("approving needs consent and clean text", () => {
    expect(() => cleanProofInput({ body: "Fine words.", approved: true }, null, NOW)).toThrow(ProofError);
    expect(() => cleanProofInput({ body: "Fine words.", approved: true, consent_at: NOW, consent_scope: ["email"] }, null, NOW)).toThrow(ProofError);
    expect(() => cleanProofInput({ body: "It was a no-brainer.", approved: true, consent_at: NOW, consent_scope: ["site"] }, null, NOW)).toThrow(/banned/);
    const ok = cleanProofInput({ body: "Fine words.", approved: true, consent_at: NOW, consent_scope: ["site", "bogus"] }, null, NOW);
    expect(ok.approved).toBe(1);
    expect(ok.consent_scope).toBe("site");
    expect([...parseScope("site,name,nope")]).toEqual(["site", "name"]);
  });
});

describe("cohorts: places are computed, never typed", () => {
  it("states capacity and open places honestly", () => {
    const line = cohortLine({ id: "c", starts: "Monday 3 November", applyBy: "Friday 24 October", capacity: 6, open: 2 });
    expect(line).toBe("Next build cohort starts Monday 3 November. We take 6 businesses per cohort; 2 places are open. Applications for this cohort close Friday 24 October.");
    expect(cohortLine({ id: "c", starts: "x", applyBy: "y", capacity: 6, open: 1 })).toContain("1 place is open");
    noBanned(line, "cohort line");
  });
  it("buckets won deals into cohort windows by close date", () => {
    const tz = "Europe/Oslo";
    const cohorts = [
      { id: "a", apply_by: "2026-10-24", created_at: Date.UTC(2026, 8, 1) },
      { id: "b", apply_by: "2026-12-05", created_at: Date.UTC(2026, 9, 1) },
    ];
    const wins = [Date.UTC(2026, 7, 1), Date.UTC(2026, 9, 10), endOfDay("2026-10-24", tz), endOfDay("2026-10-24", tz) + 1, Date.UTC(2026, 11, 1), Date.UTC(2027, 0, 5)];
    const m = bucketWins(cohorts, wins, tz);
    expect(m.get("a")).toBe(2); // Oct 10 and the last millisecond of apply-by day; the August win predates the cohort
    expect(m.get("b")).toBe(2); // the next millisecond and Dec 1; January falls after
  });
  it("formats and validates dates", () => {
    expect(fmtDay("2026-11-02", NOW)).toBe("Monday 2 November");
    expect(fmtDay("2027-01-04", NOW)).toBe("Monday 4 January 2027");
    expect(validDate("2026-02-30")).toBe(false);
    expect(validDate("2026-11-02")).toBe(true);
  });
  it("the apply-by note only goes to open A/B applicants", () => {
    const base = { status: "applied", tier: "A", tier_override: null, app_completed_at: 1, unsubscribed_at: null, booking_source: "funnel", call_at: null, booking_cancelled_at: null } as const;
    expect(noticeEligible(base as unknown as Lead)).toBe(true);
    expect(noticeEligible({ ...base, tier: "C" } as unknown as Lead)).toBe(false);
    expect(noticeEligible({ ...base, status: "booked" } as unknown as Lead)).toBe(false);
    expect(noticeEligible({ ...base, unsubscribed_at: 5 } as unknown as Lead)).toBe(false);
    expect(noticeEligible({ ...base, booking_source: "calendly-direct" } as unknown as Lead)).toBe(false);
  });
});

describe("referrals", () => {
  it("accepts only real reference codes", () => {
    expect(cleanRef("op-7kq2mx")).toBe("OP-7KQ2MX");
    expect(cleanRef("OP-7KQ2MX\"><script>")).toBeNull();
    expect(cleanRef("")).toBeNull();
  });
  it("a referral link is first-touch Referral attribution, and campaign tags still win", () => {
    const t = parseTouch(new URL("https://x.test/?r=OP-7KQ2MX"), null, "x.test");
    expect(t.channel).toBe("Referral");
    expect(t.utm_medium).toBe("referral");
    expect(parseTouch(new URL("https://x.test/?r=OP-7KQ2MX&utm_source=facebook&utm_medium=paid"), null, "x.test").channel).toBe("Paid Social");
    expect(parseTouch(new URL("https://x.test/?r=nope"), null, "x.test").channel).toBe("Direct");
  });
  it("referred visitors are never gated", () => {
    const url = new URL("https://x.test/");
    expect(gateState({ mode: "hard", hasFilm: true, revealedBefore: false, knownLead: false, url })).toBe(true);
    expect(gateState({ mode: "hard", hasFilm: true, revealedBefore: false, knownLead: false, url, referred: true })).toBe(false);
    expect(gateState({ mode: "hard", hasFilm: true, revealedBefore: false, knownLead: false, url: new URL("https://x.test/?r=OP-7KQ2MX") })).toBe(false);
  });
});

describe("experiments", () => {
  const exp = { id: "x0000000000000000001", variants: [{ id: "a", value: "on" }, { id: "b", value: "off" }], weights: [1, 1] };
  it("assignment is deterministic, sticky and balanced", () => {
    expect(hashUnit("v1|x")).toBe(hashUnit("v1|x"));
    let b = 0;
    for (let i = 0; i < 10000; i++) {
      const v = pickVariant(`v${i}`, exp);
      expect(pickVariant(`v${i}`, exp).id).toBe(v.id);
      if (v.id === "b") b++;
    }
    expect(b).toBeGreaterThan(4700);
    expect(b).toBeLessThan(5300);
  });
  it("weights are respected", () => {
    let a = 0;
    for (let i = 0; i < 10000; i++) if (pickVariant(`w${i}`, { ...exp, weights: [9, 1] }).id === "a") a++;
    expect(a).toBeGreaterThan(8700);
    expect(a).toBeLessThan(9300);
  });
  it("the cookie round-trips and rejects junk", () => {
    const m = parseExpCookie("x0000000000000000001.b~bad.z~x0000000000000000002.a~<script>");
    expect([...m.entries()]).toEqual([["x0000000000000000001", "b"], ["x0000000000000000002", "a"]]);
    expect(parseExpCookie(formatExpCookie(m))).toEqual(m);
  });
  it("validates new experiments", () => {
    expect(() => cleanExperimentInput({ slot: "nope", values: ["a", "b"] })).toThrow(ExperimentError);
    expect(() => cleanExperimentInput({ slot: "gate_mode", values: ["hard", "sideways"] })).toThrow(/not a value/);
    expect(() => cleanExperimentInput({ slot: "gate_mode", values: ["hard"] })).toThrow(/two to four/);
    expect(() => cleanExperimentInput({ slot: "cta_label", values: [LANDING.ctaLabel, "Book your free call"] })).toThrow(ExperimentError);
    expect(() => cleanExperimentInput({ slot: "cta_label", values: [LANDING.ctaLabel, "Act now and apply"] })).toThrow(/banned/);
    const ok = cleanExperimentInput({ slot: "cta_label", values: [LANDING.ctaLabel, "See if it fits"], weights: "1, 1" });
    expect(ok.variants).toEqual([{ id: "a", value: LANDING.ctaLabel }, { id: "b", value: "See if it fits" }]);
    expect(cleanExperimentInput({ slot: "inline_booking", values: "on\noff" }).weights).toEqual([1, 1]);
  });
  it("warns below the minimum sample and tests booked-qualified per visitor", () => {
    const c = (visitors: number, bq: number) => ({ visitors, leads: 0, applications: 0, qualified: 0, booked: bq, booked_qualified: bq, showed: 0, won: 0, cash: 0 });
    const small = compareArms([{ id: "a", counts: c(50, 1) }, { id: "b", counts: c(50, 3) }]);
    expect(small.enough_data).toBe(false);
    expect(small.warning).toContain(String(MIN_VISITORS_PER_ARM));
    expect(small.arms[1].significant).toBe(false);
    const big = compareArms([{ id: "a", counts: c(4000, 40) }, { id: "b", counts: c(4000, 90) }]);
    expect(big.enough_data).toBe(true);
    expect(big.arms[0].p).toBeNull();
    expect(big.arms[1].p).toBeLessThan(0.05);
    expect(big.arms[1].significant).toBe(true);
  });
  it("gate_mode arms map onto the gate", () => {
    expect(gateFrom({ gate_mode: { exp: "x", variant: "b", value: "open" } }, "soft")).toBe("open");
    expect(gateFrom({}, "soft")).toBe("soft");
  });
});

describe("offer stack", () => {
  it("matches existing copy and invents nothing", () => {
    const html = offerStackHtml({ risk: true });
    expect(html).toContain(OFFER.stack.name);
    // The effort line agrees with the "time" FAQ and the fit list.
    expect(FAQS.find((f) => f.id === "time")!.a).toMatch(/^Three to four hours a week/);
    expect(OFFER.stack.effort).toMatch(/^Three to four hours a week/);
    expect(html).toContain(BRAND.guarantee.replace(/'/g, "&#39;"));
    expect(offerStackHtml({ risk: false })).not.toContain(BRAND.guarantee);
    expect(OFFER.stack.bonuses).toEqual([]);
    expect(html).not.toContain("Also included");
    expect(html).not.toMatch(/\$\d/); // no price
    noBanned(html, "offer");
    // Sentence by sentence (the guarantee sentence and the delivery sentence are separate promises).
    const sentences = html.replace(/<[^>]+>/g, " ").split(/(?<=[.;])\s+/);
    for (const sn of sentences) for (const re of OUTCOME_PROMISES) expect(sn).not.toMatch(re);
  });
});

describe("growth emails", () => {
  function ctx(lead: Partial<Lead>, signedPaths: string[] = []): EmailCtx {
    const d = buildDossier(lead as Lead);
    return {
      lead: lead as Lead, d, firstName: d.firstName,
      link: (p) => (signedPaths.includes(p) || ["/", "/book"].includes(p) ? `https://x.test/r${p}` : "https://x.test/r/"),
      a: (p, l) => `<a href="https://x.test${p}">${l}</a>`, bookPath: "/book", callTime: null, closerName: "Bendik", sigName: "Bendik", now: NOW,
    };
  }
  it("are appended, never inserted", () => {
    expect(SEQUENCES.won.steps.map((s) => s.template)).toEqual(["won_1", "won_2", "won_3", "won_4", "won_5", "won_6", "won_7", "won_8"]);
    expect(SEQUENCES.won.steps[7].offset).toBe(54 * 86_400_000);
    expect(SEQUENCES.lost.steps.map((s) => s.template)).toEqual(["lo_1", "lo_2", "lo_3", "lo_4", "lo_5", "lo_6"]);
    expect(SEQUENCES.cohort.steps).toEqual([]);
  });
  it("ask by reply until the personal pages are pre-signed, then link to them", () => {
    const plain = TEMPLATES.won_7(ctx({}));
    expect(plain.cta).toBeUndefined();
    expect(plain.paragraphs.join(" ")).toContain("reply with their name");
    const linked = TEMPLATES.won_7(ctx({}, ["/refer"]));
    expect(linked.cta?.path).toBe("/refer");
    expect(TEMPLATES.won_8(ctx({}, ["/proof/submit"])).cta?.path).toBe("/proof/submit");
    expect(TEMPLATES.won_8(ctx({})).paragraphs.join(" ")).toContain("checked the wording with you");
    expect(TEMPLATES.lo_2(ctx({ lost_reason: "Timing" })).ps).toContain("Know someone it fits better");
  });
  it("the cohort note uses real numbers when primed, and stays vague otherwise", () => {
    setCohortSnapshot(null);
    const vague = TEMPLATES.co_apply_by(ctx({}));
    expect(vague.paragraphs.join(" ")).not.toMatch(/\d+ places?/);
    setCohortSnapshot({ id: "c", starts: "Monday 2 November", applyBy: "Friday 23 October", capacity: 6, open: 1 }, NOW);
    const real = TEMPLATES.co_apply_by(ctx({}));
    expect(real.paragraphs.join(" ")).toContain("1 place is open");
    expect(real.paragraphs.join(" ")).toContain("Friday 23 October");
    for (const e of [vague, real, TEMPLATES.won_7(ctx({})), TEMPLATES.won_8(ctx({}))]) {
      noBanned([e.subject, ...e.paragraphs, e.ps || ""].join(" "), e.subject);
      expect([e.subject, ...e.paragraphs].join(" ")).not.toContain("!");
    }
    setCohortSnapshot(null);
  });
});

describe("page templates", () => {
  it("keep headline → film → application, then the offer, guarantees and proof", () => {
    const html = readFileSync("public/index.html", "utf8") as string;
    const at = (s: string) => { const i = html.indexOf(s); expect(i, s).toBeGreaterThan(-1); return i; };
    const order = [at('data-slot="h1"'), at('data-section="video"'), at('data-section="application"'), at('data-section="offer"'), at('data-section="guarantee_band"'), at('data-section="proof"'), at('data-section="weeks"')];
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    expect(html).toContain('data-section="cohort"');
    expect(html).toContain('data-section="referral"');
    expect(readFileSync("public/book.html", "utf8")).toContain('data-section="proof"');
    expect(readFileSync("public/breakout.html", "utf8")).toContain("Bring a co-founder or partner to the call.");
  });
});
