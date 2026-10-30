import { describe, it, expect } from "vitest";
import { classify, findBuyers, rankSignal, CASCADES } from "../src/radar/cascade";
import { parseRss, dedupe, mapAward, newsQueries } from "../src/radar";
import { SAMPLE_PROFILE } from "../src/sample";

const NOW = Date.parse("2026-10-30T12:00:00Z");

describe("classify", () => {
  it.each([
    ["Aker BP and DNO sanction Lyra subsea development in Gjøa area", "fid"],
    ["Equinor awards Aibel Wisting FPSO FEED contract", "feed_award"],
    ["Aker BP awards long-term MMO contract to Aker Solutions for North Sea assets", "frame"],
    ["DOF Group awards North Sea subsea decommissioning contract", "decom"],
    ["Norway backs two floating wind projects with $428m in funding", "wind_grant"],
    ["Subsea7 secures sizeable contract offshore Norway", "epci_award"],
    ["Transocean rig contract extension with Equinor", "vessel"],
    ["Equinor reports third-quarter results", "other"],
  ])("%s → %s", (t, k) => expect(classify(t)).toBe(k));
});

it("finds next buyers without fragments", () => {
  expect(findBuyers("Equinor awards Aibel Wisting FPSO FEED contract")).toEqual(["Equinor", "Aibel"]);
  expect(findBuyers("Woodside news")).toEqual([]);
  expect(findBuyers("Fulkrum wins Vår Energi subsea inspection contract offshore Norway")).toEqual(["Fulkrum", "Vår Energi"]);
  expect(findBuyers("Worley Rosenberg wins Subsea7 contract for Northern Lights CCS project")).toEqual(["Worley Rosenberg", "Subsea7"]);
});

describe("rank", () => {
  const p = { ...SAMPLE_PROFILE, keywords: ["ROV", "tooling", "hydraulic"] };
  it("ranks a fresh North Sea FID that needs ROV tooling high", () => {
    const r = rankSignal({ title: "Aker BP and DNO sanction Lyra subsea development in Gjøa area", kind: "fid", buyers: ["Aker BP", "DNO"], packages: CASCADES.fid.packages, publishedAt: "2026-10-29T00:00:00Z" }, p, NOW);
    expect(r.score).toBeGreaterThanOrEqual(70);
    expect(r.matched).toEqual(expect.arrayContaining(["subsea tooling", "ROV services"]));
  });
  it("pushes contracts in other regions down", () => {
    const r = rankSignal({ title: "Subsea7 awarded contract offshore Egypt", kind: "epci_award", buyers: ["Subsea7"], packages: CASCADES.epci_award.packages, publishedAt: "2026-10-26T00:00:00Z" }, p, NOW);
    expect(r.score).toBeLessThan(45);
  });
  it("pushes non-energy contracts down", () => {
    const r = rankSignal({ title: "Veidekke: Signerte ny kontrakt på NTNU Campussamling", kind: "epci_award", buyers: [], packages: CASCADES.epci_award.packages, publishedAt: "2026-10-29T00:00:00Z" }, { ...p, keywords: ["rental", "tooling"] }, NOW);
    expect(r.score).toBeLessThan(30);
  });
  it("drops old and irrelevant news", () => {
    expect(rankSignal({ title: "Results", kind: "other", buyers: [], packages: [], publishedAt: null }, p, NOW).score).toBe(0);
    const old = rankSignal({ title: "Aker BP sanction Lyra", kind: "fid", buyers: [], packages: [], publishedAt: "2025-01-01T00:00:00Z" }, p, NOW);
    expect(old.score).toBeLessThan(50);
  });
});

it("parses Google News RSS and strips the outlet", () => {
  const xml = `<rss><channel><item><title>Equinor awards Aibel Wisting FEED - Offshore Magazine</title><link>https://news.google.com/rss/articles/abc</link><pubDate>Thu, 22 Oct 2026 07:00:00 GMT</pubDate><source url="https://x">Offshore Magazine</source></item>
  <item><title><![CDATA[Bad & <b>link</b>]]></title><link>javascript:alert(1)</link></item></channel></rss>`;
  const items = parseRss(xml);
  expect(items).toHaveLength(1);
  expect(items[0]).toMatchObject({ title: "Equinor awards Aibel Wisting FEED", outlet: "Offshore Magazine" });
  expect(items[0].publishedAt).toMatch(/^2026-10-22/);
});

it("dedupes syndicated stories", () => {
  const a = { title: "Equinor awards Aibel Wisting FPSO FEED contract", url: "https://a", outlet: "A", publishedAt: null };
  const b = { ...a, title: "Equinor awards Aibel Wisting FPSO FEED contract!", url: "https://b" };
  expect(dedupe([a, b])).toHaveLength(1);
});

it("maps a TED award with winners, value in EUR and bid count", () => {
  const a = mapAward({ "publication-number": "2868-2025", "notice-title": { eng: "Denmark – Offshore services – Frame agreement for offshore inspection" }, "buyer-name": { eng: ["Energinet"] }, "buyer-country": ["DNK"],
    "organisation-name-tenderer": { dan: ["Bravida Danmark A/S"] }, "result-value-notice": "80000000", "result-value-cur-notice": "DKK", "received-submissions-type-val": ["3", "0"], "winner-size": ["large"], "publication-date": "2025-01-06+01:00" });
  expect(a).toMatchObject({ title: "Frame agreement for offshore inspection", winners: ["Bravida Danmark A/S"], bids_received: 3, value_eur: 10720000, published_at: "2025-01-06" });
});

it("adds the supplier's own keywords to news searches", () => {
  expect(newsQueries(["ROV tooling", "x"]).at(-1)).toBe('"ROV tooling" contract offshore');
});

import { clusterStories } from "../src/radar";
it("clusters one story told by several outlets", () => {
  const mk = (title: string, d: string) => ({ title, url: "https://x/" + title, outlet: "", publishedAt: d, kind: "epci_award" });
  const out = clusterStories([
    mk("Equinor and Aker BP award Aibel topside contract for Wisting", "2026-10-23"),
    mk("Aibel lands Wisting FPSO topsides contract", "2026-10-22"),
    mk("Aibel awarded contract for Wisting", "2026-10-22"),
    mk("DOF lands North Sea decom contract", "2026-10-13"),
  ]);
  expect(out.map((o) => o.title)).toEqual(["Equinor and Aker BP award Aibel topside contract for Wisting", "DOF lands North Sea decom contract"]);
});
