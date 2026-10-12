import { describe, it, expect } from "vitest";
import { scoreApplication, matchesExcludedIndustry } from "../src/funnel/scoring";
import { rotation } from "../src/funnel/routing";
import { precallTimes, zonedTime, localParts, slotsForPerDay } from "../src/integrations/sequences";
import { SEQUENCES } from "../src/integrations/sequences";
import { channelFor, parseTouch } from "../src/lib/attribution";
import { normalizePhone, phoneCountry, callingZones } from "../src/lib/phone";
import { INDUSTRIES, ANGLES, allLanders, inferIndustry } from "../src/landers/catalog";
import { chooseAngle, MIN_VISITORS } from "../src/landers/bandit";
import { qualifyCalendly, parseAmount } from "../src/sales/qualify";
import { auHolidays, easterSunday, inCallingHours, nextCallingTime, allZonesOk } from "../src/integrations/calling-rules";
import { blockReason } from "../src/integrations/elevenlabs";
import { orBitmaps, popcount, bucketSet } from "../src/tracking/vsl";
import type { Lead } from "../src/funnel/leads";

const full = {
  business: "Three dental clinics in Bergen",
  role: "owner", revenue: "3m_10m", spend: "100k_300k", goal: "own_growth", timeline: "0_3",
  blockers: ["dev_capacity", "tracking"], readiness: "yes", why_now: "x".repeat(170),
};

describe("scoring", () => {
  it("scores a strong owner as A", () => {
    const r = scoreApplication(full, { email: "a@clinic.no", country: "NO" });
    expect(r.tier).toBe("A");
    expect(r.score).toBeGreaterThanOrEqual(70);
    expect(r.breakdown.length).toBeGreaterThan(3);
  });
  it("caps under $1M at C", () => {
    expect(scoreApplication({ ...full, revenue: "under_1m" }, { email: "a@clinic.no", country: "NO" }).tier).toBe("C");
  });
  it("caps no business at C", () => {
    expect(scoreApplication({ ...full, role: "none" }, { country: "NO" }).tier).toBe("C");
  });
  it("caps non-owner, not ready, exploring, low spend, out of market at B", () => {
    for (const patch of [{ role: "exec" }, { readiness: "not_now" }, { timeline: "exploring" }, { spend: "under_25k" }]) {
      expect(scoreApplication({ ...full, ...patch }, { email: "a@clinic.no", country: "NO" }).tier).not.toBe("A");
    }
    expect(scoreApplication(full, { email: "a@clinic.no", country: "BR" }).tier).toBe("B");
  });
  it("personal email + small business caps at B", () => {
    const r = scoreApplication({ ...full, revenue: "1m_3m" }, { email: "a@gmail.com", country: "NO" });
    expect(r.flags).toContain("personal_email_small");
    expect(r.tier).not.toBe("A");
  });
  it("blocklist and excluded industries cap at C", () => {
    expect(scoreApplication(full, { email: "x@bad.com", country: "NO", blocklist: ["bad.com"] }).tier).toBe("C");
    expect(scoreApplication({ ...full, business: "Online casino affiliate" }, { country: "NO" }).tier).toBe("C");
  });
  it("matches excluded industries on whole words only", () => {
    expect(matchesExcludedIndustry("We bet on quality")).toBeNull();
    expect(matchesExcludedIndustry("better betting tips")).toBe("betting");
    expect(matchesExcludedIndustry("adulting coaching")).toBeNull();
  });
  it("why-now length points", () => {
    const a = scoreApplication({ ...full, why_now: "short" }).score;
    const b = scoreApplication({ ...full, why_now: "y".repeat(70) }).score;
    const c = scoreApplication({ ...full, why_now: "y".repeat(170) }).score;
    expect(b).toBeGreaterThanOrEqual(a);
    expect(c).toBeGreaterThanOrEqual(b);
  });
});

describe("routing", () => {
  it("weighted round robin", () => {
    expect(rotation([{ id: "a", weight: 2 }, { id: "b", weight: 1 }])).toEqual(["a", "b", "a"]);
    expect(rotation([{ id: "a", weight: 0 }])).toEqual([]);
  });
});

describe("pre-call timing", () => {
  const tz = "Europe/Oslo";
  it("zonedTime is DST-safe", () => {
    const summer = zonedTime(2026, 7, 1, 9, 30, tz);
    expect(new Date(summer).toISOString()).toBe("2026-07-01T07:30:00.000Z");
    const winter = zonedTime(2026, 12, 1, 9, 30, tz);
    expect(new Date(winter).toISOString()).toBe("2026-12-01T08:30:00.000Z");
    // Day of the spring-forward change.
    const dst = zonedTime(2026, 3, 29, 9, 30, tz);
    expect(localParts(dst, tz).hh).toBe(9);
  });
  it("starts 90 min after booking, ends 3h before the call, at local slots", () => {
    const now = zonedTime(2026, 10, 12, 10, 0, tz);
    const call = zonedTime(2026, 10, 16, 14, 0, tz);
    const times = precallTimes(now, call, tz, 6, 100);
    expect(times.length).toBeGreaterThan(5);
    for (const t of times) {
      expect(t).toBeGreaterThanOrEqual(now + 90 * 60_000);
      expect(t).toBeLessThanOrEqual(call - 3 * 3600_000);
      const p = localParts(t, tz);
      expect([[7, 30], [9, 30], [12, 0], [14, 30], [17, 0], [19, 30]].some(([h, m]) => p.hh === h && p.mm === m)).toBe(true);
      expect(Math.abs(t - (call - 48 * 3600_000))).toBeGreaterThanOrEqual(45 * 60_000);
      expect(Math.abs(t - (call - 24 * 3600_000))).toBeGreaterThanOrEqual(45 * 60_000);
    }
  });
  it("respects per-day cap and max", () => {
    const now = zonedTime(2026, 10, 12, 6, 0, tz);
    const call = zonedTime(2026, 10, 20, 15, 0, tz);
    const t2 = precallTimes(now, call, tz, 2, 100);
    const perDay: Record<string, number> = {};
    for (const t of t2) { const p = localParts(t, tz); const k = `${p.mo}-${p.d}`; perDay[k] = (perDay[k] || 0) + 1; }
    expect(Math.max(...Object.values(perDay))).toBeLessThanOrEqual(2);
    expect(precallTimes(now, call, tz, 6, 3)).toHaveLength(3);
    expect(precallTimes(now, call, tz, 0, 10)).toEqual([]);
    expect(slotsForPerDay(3)).toHaveLength(3);
  });
  it("a call tomorrow still gets emails", () => {
    const now = zonedTime(2026, 10, 12, 8, 0, tz);
    const call = zonedTime(2026, 10, 13, 15, 0, tz);
    expect(precallTimes(now, call, tz, 6, 10).length).toBeGreaterThan(0);
  });
  it("no times when the call is too close", () => {
    const now = Date.now();
    expect(precallTimes(now, now + 2 * 3600_000, tz, 6, 10)).toEqual([]);
  });
});

describe("sequences", () => {
  it("every step template exists in a sequence definition and offsets are ordered", () => {
    for (const s of Object.values(SEQUENCES)) {
      const enq = s.steps.filter((x) => x.anchor !== "call").map((x) => x.offset);
      expect([...enq].sort((a, b) => a - b)).toEqual(enq);
    }
  });
  it("tier sequences stop when booked", () => {
    const lead = { status: "booked", call_at: Date.now() + 1e6, booking_cancelled_at: null } as unknown as Lead;
    expect(SEQUENCES.tier_a.stopIf(lead)).toBe(true);
    expect(SEQUENCES.nurture.stopIf(lead)).toBe(true);
    expect(SEQUENCES.booked.stopIf(lead)).toBe(false);
  });
});

describe("attribution", () => {
  it("channel grouping", () => {
    const t = (q: string, ref: string | null = null) => parseTouch(new URL("https://x.com/?" + q), ref, "x.com").channel;
    expect(t("fbclid=abc")).toBe("Paid Social");
    expect(t("gclid=abc")).toBe("Paid Search");
    expect(t("utm_source=facebook&utm_medium=paid")).toBe("Paid Social");
    expect(t("utm_source=newsletter&utm_medium=email")).toBe("Email");
    expect(t("", "https://www.google.com/")).toBe("Organic Search");
    expect(t("", "https://chatgpt.com/")).toBe("AI Assistant");
    expect(t("", "https://x.com/page")).toBe("Direct");
    expect(t("")).toBe("Direct");
    expect(channelFor({ utm_source: "youtube", utm_medium: "video" } as never)).toBe("Organic Video");
  });
});

describe("phones", () => {
  it("normalises to E.164", () => {
    expect(normalizePhone("912 34 567", "NO")).toBe("+4791234567");
    expect(normalizePhone("07700 900123", "GB")).toBe("+447700900123");
    expect(normalizePhone("(415) 555-0123", "US")).toBe("+14155550123");
    expect(normalizePhone("0047 912 34 567", null)).toBe("+4791234567");
    expect(normalizePhone("call me", "NO")).toBeNull();
    expect(normalizePhone("123", "NO")).toBeNull();
  });
  it("country and zones come from the number", () => {
    expect(phoneCountry("+4791234567")).toBe("NO");
    expect(phoneCountry("+14165550123")).toBe("CA");
    expect(phoneCountry("+14155550123")).toBe("US");
    expect(callingZones("+18085550123")).toEqual(["Pacific/Honolulu"]);
    expect(callingZones("+61412345678").length).toBeGreaterThan(3);
  });
});

describe("calling rules", () => {
  it("easter", () => {
    expect(easterSunday(2026)).toEqual([4, 5]);
    expect(easterSunday(2027)).toEqual([3, 28]);
  });
  it("AU holidays", () => {
    const h = auHolidays(2026);
    expect(h.has("2026-04-03")).toBe(true); // Good Friday
    expect(h.has("2026-04-06")).toBe(true); // Easter Monday
    expect(h.has("2026-01-26")).toBe(true);
    expect(h.has("2026-12-25")).toBe(true);
  });
  it("hours: weekdays 9-20, Saturday 9-17, never Sunday", () => {
    const tz = "Europe/Oslo";
    expect(inCallingHours(zonedTime(2026, 10, 14, 10, 0, tz), tz)).toBe(true); // Wed
    expect(inCallingHours(zonedTime(2026, 10, 14, 20, 30, tz), tz)).toBe(false);
    expect(inCallingHours(zonedTime(2026, 10, 17, 16, 0, tz), tz)).toBe(true); // Sat
    expect(inCallingHours(zonedTime(2026, 10, 17, 17, 30, tz), tz)).toBe(false);
    expect(inCallingHours(zonedTime(2026, 10, 18, 12, 0, tz), tz)).toBe(false); // Sun
  });
  it("all zones of a country must be in hours", () => {
    const zones = callingZones("+14155550123");
    const t = nextCallingTime(Date.UTC(2026, 9, 14, 12, 0), zones)!; // 8am NY, 5am LA
    expect(allZonesOk(t, zones)).toBe(true);
    expect(localParts(t, "America/Los_Angeles").hh).toBeGreaterThanOrEqual(9);
    expect(localParts(t, "America/New_York").hh).toBeLessThan(20);
  });
  it("AU holiday blocks calls", () => {
    const zones = ["Australia/Sydney"];
    expect(allZonesOk(zonedTime(2026, 4, 3, 11, 0, "Australia/Sydney"), zones)).toBe(false);
  });
});

describe("voice block reasons", () => {
  const base = {
    phone: "+4791234567", do_not_call_at: null, call_consent_at: 1, unsubscribed_at: null, booking_source: "funnel",
    status: "applied", tier: "A", tier_override: null, call_at: null, booking_cancelled_at: null,
  } as unknown as Lead;
  const now = Date.now();
  it("consent, DNC, country", () => {
    expect(blockReason(base, "speed_to_lead", now)).toBeNull();
    expect(blockReason({ ...base, call_consent_at: null }, "speed_to_lead", now)).toBe("no consent");
    expect(blockReason({ ...base, do_not_call_at: 1 }, "speed_to_lead", now)).toBe("do not call");
    expect(blockReason({ ...base, phone: "+5511987654321" }, "speed_to_lead", now)).toBe("country not served");
    expect(blockReason({ ...base, booking_source: "calendly-direct" }, "speed_to_lead", now)).toBe("imported contact");
  });
  it("kind checks", () => {
    expect(blockReason({ ...base, tier: "C" } as Lead, "speed_to_lead", now)).toBe("tier");
    expect(blockReason(base, "confirm", now)).toBe("not booked");
    expect(blockReason({ ...base, status: "booked", call_at: now + 10 * 60_000 } as Lead, "confirm", now)).toBe("call too close");
    expect(blockReason({ ...base, status: "booked", call_at: now + 3600_000 * 5 } as Lead, "confirm", now)).toBeNull();
    expect(blockReason(base, "rebook", now)).toBe("not a no-show");
  });
});

describe("landers", () => {
  it("20 × 5 with unique headlines", () => {
    expect(INDUSTRIES).toHaveLength(20);
    expect(ANGLES).toHaveLength(5);
    const all = allLanders();
    expect(all).toHaveLength(100);
    expect(new Set(all.map((l) => l.headline)).size).toBe(100);
    expect(new Set(INDUSTRIES.map((i) => i.id)).size).toBe(20);
  });
  it("infers industries without false positives", () => {
    expect(inferIndustry("Dental – LAL 2%")?.id).toBe("dental");
    expect(inferIndustry("roofer in Oslo")?.id).toBe("construction");
    expect(inferIndustry("We beat every competitor")).toBeNull();
    expect(inferIndustry("app development")?.id).toBe("saas");
    expect(inferIndustry("happy customers")).toBeNull();
    expect(inferIndustry("")).toBeNull();
  });
});

describe("bandit", () => {
  it("explores every arm to the floor first", () => {
    const stats = ANGLES.map((a, i) => ({ angle: a.id, visitors: i === 0 ? 10 : MIN_VISITORS, leads: 0, qualified: 0 }));
    expect(chooseAngle(stats, () => 0.5)).toBe(ANGLES[0].id);
  });
  it("exploits the best arm", () => {
    const stats = ANGLES.map((a, i) => ({ angle: a.id, visitors: 500, leads: i === 2 ? 60 : 5, qualified: 0 }));
    let wins = 0;
    for (let i = 0; i < 200; i++) if (chooseAngle(stats) === ANGLES[2].id) wins++;
    expect(wins).toBeGreaterThan(180);
  });
});

describe("calendly qualification", () => {
  it("parses amounts", () => {
    expect(parseAmount("$2.5M")).toBe(2_500_000);
    expect(parseAmount("750k")).toBe(750_000);
    expect(parseAmount("about 30 mill NOK")).toBe(3_000_000);
  });
  it("maps answers to bands and tier", () => {
    const q = qualifyCalendly([
      { q: "What is your annual revenue?", a: "$4M" },
      { q: "What do you spend on agencies and software?", a: "200k" },
      { q: "Are you willing to invest if it's a fit?", a: "Yes" },
      { q: "What industry are you in?", a: "dental clinics" },
    ]);
    expect(q.revenue_band).toBe("3m_10m");
    expect(q.budget_band).toBe("100k_300k");
    expect(q.industry).toBe("dental");
    expect(q.tier).toBe("A");
    expect(qualifyCalendly([{ q: "Revenue?", a: "300k" }]).tier).toBe("C");
  });
});

describe("vsl bitmap", () => {
  it("ORs and counts", () => {
    const a = "f".padEnd(25, "0");
    const b = "0f".padEnd(25, "0");
    const c = orBitmaps(a, b);
    expect(popcount(c)).toBe(8);
    expect(bucketSet(c, 0)).toBe(true);
    expect(bucketSet(c, 8)).toBe(false);
    expect(orBitmaps("zz<script>", "")).toHaveLength(25);
  });
});

import { callableCountry } from "../src/integrations/calling-rules";
describe("toll-fraud protection", () => {
  it("refuses Caribbean NANP, premium and personal ranges", () => {
    for (const n of ["+18765550123", "+18095550123", "+12685550123", "+19005550123", "+17875550123", "+18005550123", "+447012345678", "+449012345678", "+61190012345", "+4790012345".replace("479", "4782")]) {
      expect(callableCountry(n), n).toBe(false);
    }
  });
  it("allows ordinary mobile and geographic numbers in served markets", () => {
    for (const n of ["+14155550123", "+14165550123", "+447700900123", "+61412345678", "+4791234567", "+46701234567", "+353871234567"]) {
      expect(callableCountry(n), n).toBe(true);
    }
  });
});
