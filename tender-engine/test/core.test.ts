import { describe, it, expect } from "vitest";
import { extractRequirements, findDeadline, findStandards, categorise, bestEvidence, scorecard, clarifications, findReference } from "../src/rfq/rules";
import { scoreTender } from "../src/match";
import { mapTed, mapFts, tedQuery } from "../src/feeds";
import { makeSession, checkSession, safeEqual } from "../src/auth";
import { validateApplication, tierOf } from "../src/apply";
import { SAMPLE_RFQ, SAMPLE_LIBRARY, SAMPLE_PROFILE } from "../src/sample";
import { csvCell } from "../src/util";

const lib = SAMPLE_LIBRARY.map((l, i) => ({ ...l, id: i + 1 }));
const NOW = Date.parse("2026-10-30T12:00:00Z");

describe("rule reader", () => {
  const reqs = extractRequirements(SAMPLE_RFQ);
  it("finds the obligations with clause numbers", () => {
    expect(reqs.length).toBeGreaterThanOrEqual(18);
    const coating = reqs.find((r) => r.text.includes("NORSOK M-501"))!;
    expect(coating.clause).toBe("2.4");
    expect(coating.standards).toContain("NORSOK M-501");
    expect(coating.mandatory).toBe(true);
  });
  it("marks should as optional", () => {
    expect(reqs.find((r) => r.text.includes("24/7"))!.mandatory).toBe(false);
  });
  it("categorises", () => {
    expect(categorise("Payment terms are 45 days net")).toBe("commercial");
    expect(categorise("HSE management system according to NORSOK S-006")).toBe("hse");
    expect(categorise("Product liability insurance of NOK 50 million")).toBe("legal");
    expect(reqs.find((r) => r.clause === "3.2")!.category).toBe("documentation");
    expect(reqs.find((r) => r.clause === "1.3")!.category).toBe("commercial");
    expect(reqs.find((r) => r.clause === "2.2")!.category).toBe("quality");
    expect(reqs.find((r) => r.clause === "3.3")!.category).toBe("quality");
  });
  it("reads standards", () => {
    expect(findStandards("per ISO 13628-8 / API 17H and IEC 60079-0, DNV-ST-0378")).toEqual(expect.arrayContaining(["ISO 13628-8", "API 17H", "IEC 60079-0"]));
  });
  it("finds deadline in several formats", () => {
    expect(findDeadline(SAMPLE_RFQ)).toBe("2026-12-04");
    expect(findDeadline("Tender due date: 04.12.2026 kl 12")).toBe("2026-12-04");
    expect(findDeadline("Closing date 4th December 2026")).toBe("2026-12-04");
    expect(findDeadline("Deadline: December 4, 2026")).toBe("2026-12-04");
    expect(findDeadline("no dates here")).toBeNull();
  });
  it("finds the reference", () => expect(findReference(SAMPLE_RFQ)).toBe("NSE-2026-0417"));
  it("matches library evidence", () => {
    const ev = bestEvidence(reqs.find((r) => r.clause === "2.4")!, lib);
    expect(ev?.item.title).toMatch(/M-501/);
    const iso = bestEvidence(reqs.find((r) => r.clause === "3.1")!, lib);
    expect(iso?.item.title).toMatch(/ISO 9001/);
  });
  it("scores bid/no-bid and lists missing approvals", () => {
    const card = scorecard(reqs, 10, { ...SAMPLE_PROFILE, evidencedStandards: ["ISO 13628-8", "API 17H"] }, SAMPLE_RFQ, "2026-12-04", NOW);
    expect(card.missing_certifications).not.toContain("API 17H");
    expect(card.missing_certifications).toEqual(expect.arrayContaining(["ATEX", "IECEX"]));
    expect(card.missing_certifications).not.toContain("ISO 9001");
    expect(["bid", "consider"]).toContain(card.recommendation);
    expect(scorecard(reqs, 10, SAMPLE_PROFILE, SAMPLE_RFQ, "2026-10-01", NOW).recommendation).toBe("no_bid");
  });
  it("suggests clarifications for vague clauses", () => {
    const q = clarifications(reqs, "2026-12-04");
    expect(q.some((s) => s.includes("5.3"))).toBe(true);
    expect(q.some((s) => /cap on liquidated/.test(s))).toBe(true);
  });
});

describe("tender fit", () => {
  const p = { ...SAMPLE_PROFILE };
  const base = { title: "Rental of ROV tooling and torque tool services", description: "Subsea intervention for the offshore fleet", buyer: "Buyer", country: "NOR", cpv: ["42910000"], deadline_at: "2026-12-20", value_eur: 500000 };
  it("ranks a matching tender high with reasons", () => {
    const r = scoreTender(base, p, NOW);
    expect(r.score).toBeGreaterThanOrEqual(70);
    expect(r.reasons.join(" ")).toMatch(/ROV tooling/);
  });
  it("zeroes excluded and expired", () => {
    expect(scoreTender({ ...base, title: "Catering offshore" }, p, NOW).score).toBe(0);
    expect(scoreTender({ ...base, deadline_at: "2026-10-01" }, p, NOW).score).toBe(0);
  });
  it("keeps a single generic keyword without sector signal low", () => {
    const r = scoreTender({ ...base, title: "Mental health early intervention service", description: "Support for young people", cpv: ["85000000"], country: "GBR" }, p, NOW);
    expect(r.score).toBeLessThan(30);
  });
  it("does not match keyword fragments", () => {
    expect(scoreTender({ ...base, title: "Office furniture", description: "Provision of chairs", cpv: ["39100000"], country: "SWE" }, p, NOW).score).toBeLessThan(15);
  });
});

describe("feeds", () => {
  it("builds a safe TED query", () => {
    const q = tedQuery({ ...SAMPLE_PROFILE, keywords: ["ROV tooling", 'x") OR (1'] }, "20261001");
    expect(q).toContain('FT~"ROV tooling"');
    expect(q).toContain("classification-cpv=4291*");
    expect(q).not.toContain('")');
    expect(q).toContain("buyer-country IN (NOR GBR DNK NLD)");
  });
  it("maps a TED notice", () => {
    const t = mapTed({
      "publication-number": "725889-2026", "notice-title": { eng: "Norway – Electrical circuit parts – Procurement of SDU and jumper" },
      "buyer-name": { eng: ["Institute of Marine Research"] }, "buyer-country": ["NOR"], "publication-date": "2026-10-20+02:00",
      "deadline-receipt-tender-date-lot": ["2026-11-24+01:00"], "classification-cpv": ["31220000", "31220000"], "description-lot": { eng: ["SDU"] },
    });
    expect(t).toMatchObject({ ext_id: "725889-2026", title: "Procurement of SDU and jumper", country: "NOR", buyer: "Institute of Marine Research", cpv: ["31220000"] });
    expect(t.deadline_at).toMatch(/^2026-11-24/);
  });
  it("maps a Find a Tender release", () => {
    const t = mapFts({ ocid: "ocds-h6vhtk-05a1b2", id: "035123-2026-x", buyer: { name: "Port" }, tender: { title: "Subsea survey", tenderPeriod: { endDate: "2026-12-01T12:00:00Z" }, value: { amount: 100000, currency: "GBP" }, classification: { id: "71354500" } } });
    expect(t).toMatchObject({ source: "fts", country: "GBR", value_eur: 117000, cpv: ["71354500"] });
  });
});

describe("auth", () => {
  const env = { APP_PASSWORD: "pw", SESSION_SECRET: "s" };
  it("round-trips a session and rejects tampering and expiry", async () => {
    const t = (await makeSession(env, NOW))!;
    expect(await checkSession(env, t, NOW)).toBe(true);
    expect(await checkSession(env, t.replace(/.$/, (c) => (c === "a" ? "b" : "a")), NOW)).toBe(false);
    expect(await checkSession(env, t, NOW + 13 * 3600_000)).toBe(false);
    expect(await checkSession({ ...env, APP_PASSWORD: "new" }, t, NOW)).toBe(false);
  });
  it("fails closed without a password", async () => {
    expect(await makeSession({})).toBeNull();
    expect(await checkSession({}, "1.abc")).toBe(false);
  });
  it("compares in constant time shape", () => {
    expect(safeEqual("abc", "abc")).toBe(true);
    expect(safeEqual("abc", "abcd")).toBe(false);
  });
});

describe("application", () => {
  const good = { name: "Kari Nordmann", email: "kari@supplier.no", company: "Supplier AS", answers: { role: "supplier", revenue: "100to500", rfqs: "6to15", writer: "engineers", qualification: "jqs", timeline: "now", pain: "" } };
  it("validates and tiers", () => {
    const v = validateApplication(good);
    expect(v.ok).toBe(true);
    if (v.ok) expect(tierOf(v.app.answers)).toBe("A");
    expect(validateApplication({ ...good, email: "nope" }).ok).toBe(false);
    expect(validateApplication({ ...good, answers: { ...good.answers, role: "hacker" } }).ok).toBe(false);
  });
  it("routes small and buyer leads to C", () => {
    expect(tierOf({ ...good.answers, revenue: "lt20", rfqs: "0to2" } as never)).toBe("C");
    expect(tierOf({ ...good.answers, role: "operator" } as never)).toBe("C");
    expect(tierOf({ ...good.answers, revenue: "20to100", rfqs: "3to5", timeline: "quarter" } as never)).toBe("B");
  });
});

it("escapes CSV formulas", () => {
  expect(csvCell("=HYPERLINK(1)")).toBe("'=HYPERLINK(1)");
  expect(csvCell('a,"b"')).toBe('"a,""b"""');
});
