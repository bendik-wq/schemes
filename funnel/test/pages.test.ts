import { describe, it, expect } from "vitest";
// @ts-ignore: the Workers tsconfig has no Node types; vitest runs these tests in Node.
import { readFileSync, readdirSync } from "node:fs";
import { BANNED_PHRASES, BRAND, FAQS, LANDING, OFFER, RESOURCES, VIDEOS } from "../src/config";
import {
  answerLabel, assetVersion, attendanceConfirmed, BUILD_VERSION, closerHtml, gateState, previewMeta, resourceHtml, spendLine, versioned,
} from "../src/funnel/pages";
import { isDocumentNavigation, isNonDocumentFetch } from "../src/lib/identity";
import { SEQUENCES, attendanceConfirmedFor } from "../src/integrations/sequences";
import { CORE_TEMPLATES } from "../src/integrations/templates";
import { buildDossier } from "../src/followup/dossier";
import type { Lead } from "../src/funnel/leads";
import type { EmailCtx } from "../src/integrations/email-types";

const req = (path: string, headers: Record<string, string> = {}, method = "GET") => new Request(`https://apply.example.test${path}`, { method, headers });

describe("404 handling and page-view counting", () => {
  it("redirects only document navigations without a file extension", () => {
    expect(isDocumentNavigation(req("/old-page", { "sec-fetch-dest": "document" }))).toBe(true);
    expect(isDocumentNavigation(req("/old-page", { accept: "text/html,application/xhtml+xml" }))).toBe(true);
    expect(isDocumentNavigation(req("/favicon.ico", { "sec-fetch-dest": "document" }))).toBe(false);
    expect(isDocumentNavigation(req("/apple-touch-icon-120x120.png", { accept: "*/*" }))).toBe(false);
    expect(isDocumentNavigation(req("/old-page", { "sec-fetch-dest": "image" }))).toBe(false);
    expect(isDocumentNavigation(req("/api/nope", { "sec-fetch-dest": "document" }))).toBe(false);
    expect(isDocumentNavigation(req("/assets/x", { "sec-fetch-dest": "document" }))).toBe(false);
    expect(isDocumentNavigation(req("/old-page", { accept: "*/*" }))).toBe(false);
    expect(isDocumentNavigation(req("/old-page", { "sec-fetch-dest": "document" }, "POST"))).toBe(false);
  });
  it("treats non-document fetches of a page as not countable", () => {
    expect(isNonDocumentFetch(req("/", { "sec-fetch-dest": "document" }))).toBe(false);
    expect(isNonDocumentFetch(req("/"))).toBe(false);
    expect(isNonDocumentFetch(req("/", { "sec-fetch-dest": "image" }))).toBe(true);
    expect(isNonDocumentFetch(req("/", { "sec-fetch-dest": "iframe" }))).toBe(true);
    expect(isNonDocumentFetch(req("/", { "sec-fetch-dest": "empty" }))).toBe(true);
  });
});

describe("asset versions", () => {
  it("uses the deployed version id, else the build constant", () => {
    expect(assetVersion({ CF_VERSION_METADATA: { id: "4342881a-c1b9-4f00-9e2c-aaaaaaaaaaaa" } })).toBe("4342881ac1b9");
    expect(assetVersion({})).toBe(BUILD_VERSION);
    expect(assetVersion({ CF_VERSION_METADATA: { id: "<>\"" } })).toBe(BUILD_VERSION);
  });
  it("versions only same-site asset URLs without a query", () => {
    expect(versioned("/assets/site.css", "abc")).toBe("/assets/site.css?v=abc");
    expect(versioned("/assets/site.css?v=1", "abc")).toBe("/assets/site.css?v=1");
    expect(versioned("https://connect.facebook.net/x.js", "abc")).toBe("https://connect.facebook.net/x.js");
  });
  it("every page template references only assets that exist, and keeps the site.css link simple", () => {
    for (const f of readdirSync("public").filter((x: string) => x.endsWith(".html"))) {
      const html = readFileSync(`public/${f}`, "utf8");
      for (const m of html.matchAll(/(?:href|src)="(\/assets\/[^"?#]+)"/g)) {
        expect(() => readFileSync(`public${m[1]}`), `${f}: ${m[1]}`).not.toThrow();
      }
      expect(html).toContain('<link rel="stylesheet" href="/assets/site.css">');
      expect(html).toContain('<link rel="apple-touch-icon" href="/apple-touch-icon.png">');
    }
    expect(readFileSync("public/favicon.ico").length).toBeGreaterThan(100);
    expect(readFileSync("public/assets/og.png").length).toBeGreaterThan(1000);
  });
  it("immutable caching covers every versioned css/js file", () => {
    const h = (readFileSync("public/_headers", "utf8") as string).split("\n").filter((l: string) => !l.startsWith("#")).join("\n");
    for (const f of ["site.css", "f.js", "vsl.js", "book.js", "apply.js", "hls.light.min.js"]) {
      expect(h).toMatch(new RegExp(`/assets/${f.replace(/\./g, "\\.")}\\n\\s+Cache-Control: public, max-age=31536000, immutable`));
    }
    expect(h).toMatch(/\/assets\/admin\.js\n\s+Cache-Control: public, max-age=300/);
    // A Cache-Control on the catch-all would be joined with the specific rules.
    expect(h.split("/assets/fonts/*")[0]).not.toContain("Cache-Control");
  });
});

describe("brand link label (WCAG 2.5.3)", () => {
  it("has a real space and no mismatching aria-label", () => {
    for (const f of readdirSync("public").filter((x: string) => x.endsWith(".html"))) {
      const html = readFileSync(`public/${f}`, "utf8");
      expect(html, f).toContain("<strong>Asymmetrical</strong> <span class=\"brand-sub\">AI Solutions</span>");
      expect(html, f).not.toContain('aria-label="Asymmetrical AI Solutions home"');
    }
  });
});

describe("link previews", () => {
  it("escapes values and includes OG and Twitter tags", () => {
    const m = previewMeta({ title: 'A "quoted" <title>', description: "d & e", url: "https://x.test/", image: "https://x.test/assets/og.png", siteName: BRAND.name });
    expect(m).toContain('property="og:image" content="https://x.test/assets/og.png"');
    expect(m).toContain('name="twitter:card" content="summary_large_image"');
    expect(m).not.toContain("<title>");
    expect(m).toContain("&quot;quoted&quot;");
  });
  it("robots.txt lets unfurlers in and keeps everyone else out", () => {
    const r = readFileSync("public/robots.txt", "utf8");
    for (const b of ["Twitterbot", "LinkedInBot", "facebookexternalhit", "Slackbot"]) expect(r).toMatch(new RegExp(`User-agent: ${b}\\nAllow: /`));
    expect(r).toMatch(/User-agent: \*\nDisallow: \/\s*$/);
  });
});

describe("gate", () => {
  const url = (q = "") => new URL(`https://x.test/${q}`);
  const base = { mode: "soft" as const, hasFilm: true, revealedBefore: false, knownLead: false };
  it("gates a cold visitor while a film exists", () => {
    expect(gateState({ ...base, url: url() })).toBe(true);
    expect(gateState({ ...base, mode: "hard", url: url() })).toBe(true);
  });
  it("never gates without a film, in open mode, for known leads, retargeting or referrals", () => {
    expect(gateState({ ...base, hasFilm: false, url: url() })).toBe(false);
    expect(gateState({ ...base, mode: "open", url: url() })).toBe(false);
    expect(gateState({ ...base, knownLead: true, url: url() })).toBe(false);
    expect(gateState({ ...base, revealedBefore: true, url: url() })).toBe(false);
    expect(gateState({ ...base, url: url("?utm_content=rt_dental_v2") })).toBe(false);
    expect(gateState({ ...base, url: url("?utm_content=RT_x") })).toBe(false);
    expect(gateState({ ...base, url: url("?r=OP-ABC123") })).toBe(false);
    expect(gateState({ ...base, url: url("?utm_content=cold_rt") })).toBe(true);
  });
  it("defaults to a soft gate at 90 s", () => {
    expect(VIDEOS.main.gate).toEqual({ mode: "soft", softAt: 90 });
  });
});

describe("book page copy", () => {
  it("quotes the lead's own spend label", () => {
    const lead = { answers: JSON.stringify({ spend: "100k_300k" }) } as Lead;
    expect(answerLabel(lead, "spend")).toBe("$100k – $300k");
    expect(spendLine(lead)).toContain("You told us you spend $100k – $300k a year");
    expect(spendLine({ answers: "{}" } as Lead)).toBe("");
    expect(spendLine({ answers: JSON.stringify({ spend: "<script>" }) } as Lead)).toBe("");
  });
  it("shows the closer's name, and a photo only from a safe URL", () => {
    expect(closerHtml(null)).toContain(BRAND.founder);
    const rep = { name: "Ingrid <b>", photo_url: "javascript:alert(1)", bio: "Builds things." } as never;
    const html = closerHtml(rep);
    expect(html).toContain("Ingrid &lt;b&gt;");
    expect(html).not.toContain("javascript:");
    expect(html).not.toContain("<img");
    expect(closerHtml({ name: "Ingrid", photo_url: "https://cdn.example.test/i.jpg" } as never)).toContain('<img class="closer-photo" src="https://cdn.example.test/i.jpg"');
  });
});

describe("resources", () => {
  it("renders a link when a URL exists and 'Coming soon' otherwise", () => {
    expect(resourceHtml({ title: "Guide", body: "b" }, 0)).toContain("Coming soon");
    const linked = resourceHtml({ title: "Guide", body: "b", url: "https://example.test/g.pdf" }, 1);
    expect(linked).toContain('href="https://example.test/g.pdf"');
    expect(linked).toContain('rel="noopener"');
    expect(resourceHtml({ title: "G", body: "b", url: "javascript:alert(1)" }, 0)).toContain("Coming soon");
    expect(RESOURCES.length).toBeGreaterThan(0);
  });
});

describe("attendance confirmation", () => {
  const callAt = Date.now() + 86_400_000;
  it("counts only for the call time that was confirmed", () => {
    expect(attendanceConfirmed({ call_at: callAt, attendance_confirmed_at: Date.now(), attendance_call_at: callAt })).toBe(true);
    expect(attendanceConfirmed({ call_at: callAt + 3_600_000, attendance_confirmed_at: Date.now(), attendance_call_at: callAt })).toBe(false);
    expect(attendanceConfirmed({ call_at: callAt, attendance_confirmed_at: null, attendance_call_at: null })).toBe(false);
  });
  it("the booked sequence gains a -2 h step, appended, skipped once confirmed", () => {
    const steps = SEQUENCES.booked.steps;
    const last = steps[steps.length - 1];
    expect(steps.slice(0, 6).map((s) => s.template)).toEqual(["bk_confirm", "bk_48h", "bk_24h", "bk_3h", "bk_1h", "bk_10m"]);
    expect(last.template).toBe("bk_2h");
    expect(last.offset).toBe(-2 * 3_600_000);
    expect(last.anchor).toBe("call");
    const lead = { status: "booked", call_at: callAt, attendance_confirmed_at: Date.now(), attendance_call_at: callAt } as unknown as Lead;
    expect(last.skipIf?.(lead)).toBe(true);
    expect(attendanceConfirmedFor({ ...lead, attendance_call_at: callAt - 1 } as Lead)).toBe(false);
  });
  it("the 24 h reminder and the 2 h nudge carry an I'll be there button that falls back to /breakout", () => {
    const d = buildDossier({ answers: "{}" } as Lead);
    const mk = (signed: string[]): EmailCtx => ({
      lead: { answers: "{}" } as Lead, d, firstName: "Kari",
      link: (p) => (signed.includes(p) ? `https://x.test/r${p}` : "https://x.test/r/"),
      a: (p, l) => `<a href="https://x.test${p}">${l}</a>`,
      bookPath: "/book", callTime: "Tuesday 14 October at 15:00 (CEST)", closerName: "Bendik", sigName: "Bendik", now: Date.now(),
    });
    for (const id of ["bk_24h", "bk_2h"]) {
      expect(CORE_TEMPLATES[id](mk(["/", "/go/confirm"])).cta).toEqual({ label: "I'll be there", path: "/go/confirm" });
      expect(CORE_TEMPLATES[id](mk(["/"])).cta?.path).toBe("/breakout");
    }
    const tc6 = CORE_TEMPLATES.tc_6(mk(["/", "/go/requalify"])).paragraphs.join(" ");
    expect(tc6).toContain("/go/requalify");
    expect(CORE_TEMPLATES.tc_6(mk(["/"])).paragraphs.join(" ")).toContain("/apply");
  });
});

describe("new copy stays clean", () => {
  it("no banned phrases in the new config copy", () => {
    const all = JSON.stringify({ OFFER, noFilm: LANDING.noFilm, below: LANDING.below, softCta: LANDING.softCta, labels: Object.values(VIDEOS).map((v) => v.label) }).toLowerCase();
    for (const b of BANNED_PHRASES) expect(all, b).not.toContain(b);
    expect(all).not.toMatch(/\bfree\s+(strategy\s+)?(call|consultation|session)/);
  });
  it("landing FAQ ids exist", () => {
    for (const id of LANDING.below.faqIds) expect(FAQS.find((f) => f.id === id), id).toBeDefined();
  });
  it("gradient headline text uses the accessible --flow-text stops", () => {
    const css = readFileSync("public/assets/site.css", "utf8");
    expect(css).toMatch(/h1 \.h1b, h2 span, \.h2 span \{[^}]*background: var\(--flow-text\)/);
    expect(css).not.toContain("silk-2.svg");
    expect(css).toMatch(/@keyframes heroIn \{ from \{ transform: translateY\(12px\); \}/);
  });
});
