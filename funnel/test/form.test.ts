// Application form round: inline booking helpers, MX check, phone country, drafts, hot partials, catalog.
import { describe, it, expect, vi, afterEach } from "vitest";
import { APPLICATION, TIER_THRESHOLDS, APPLICATION_HOT_PARTIAL } from "../src/config";
import { scoreApplication } from "../src/funnel/scoring";
import { normalizePhone, dialCountry, DIAL, PHONE_MIN_DIGITS, PHONE_MAX_DIGITS } from "../src/lib/phone";
import { mxVerdict, emailDomainOk, isHotPartial, inlineTiers, saveAnswers, sweepHotPartials, bookInlineSlot } from "../src/funnel/application";
import { matchEventType, parseAvailable, pickSlots, inviteeLocation, availableTimes, bookInvitee, resolveEventType } from "../src/integrations/calendly";
import { CLIENT_EVENTS, MICRO_EVENTS } from "../src/tracking/catalog";
import type { Lead } from "../src/funnel/leads";

// ── a tiny in-memory D1 for kv_state and leads ──
function fakeDb(leads: Record<string, Partial<Lead>> = {}) {
  const kv = new Map<string, string>();
  const run = (sql: string, b: unknown[]) => {
    if (/^INSERT INTO kv_state/.test(sql)) {
      const [key, value] = b as [string, string];
      if (/WHERE CAST\(kv_state.value AS INTEGER\) <= \?/.test(sql)) {
        const cur = kv.get(key);
        if (cur !== undefined && !(Number(cur) <= Number(b[3]))) return { meta: { changes: 0 } };
      }
      kv.set(key, value);
      return { meta: { changes: 1 } };
    }
    if (/^UPDATE kv_state SET value = \?/.test(sql)) {
      const [value, , key, due] = b as [string, number, string, number];
      if (kv.has(key) && Number(kv.get(key)) <= due) { kv.set(key, value); return { meta: { changes: 1 } }; }
      return { meta: { changes: 0 } };
    }
    if (/^DELETE FROM kv_state WHERE key = \?/.test(sql)) { kv.delete(b[0] as string); return { meta: { changes: 1 } }; }
    if (/^UPDATE leads SET/.test(sql)) {
      const id = b[b.length - 1] as string;
      const cols = sql.slice("UPDATE leads SET ".length, sql.indexOf(" WHERE")).split(",").map((s) => s.trim().split(" ")[0]);
      cols.forEach((c, i) => { (leads[id] as Record<string, unknown>)[c] = b[i]; });
      return { meta: { changes: 1 } };
    }
    return { meta: { changes: 0 } };
  };
  const first = (sql: string, b: unknown[]) => {
    if (/FROM kv_state WHERE key = \?/.test(sql)) { const v = kv.get(b[0] as string); return v === undefined ? null : { value: v }; }
    if (/FROM leads WHERE id = \?/.test(sql)) return (leads[b[0] as string] as Lead) || null;
    return null;
  };
  const allRows = (sql: string, b: unknown[]) => {
    if (/FROM kv_state WHERE key LIKE 'hotpartial:%'/.test(sql)) {
      return [...kv.entries()].filter(([k, v]) => k.startsWith("hotpartial:") && Number(v) <= Number(b[0])).map(([key]) => ({ key }));
    }
    return [];
  };
  const db = {
    prepare(sql: string) {
      const stmt = (b: unknown[]) => ({
        bind: (...x: unknown[]) => stmt(x),
        run: async () => run(sql.trim(), b),
        first: async () => first(sql.trim(), b),
        all: async () => ({ results: allRows(sql.trim(), b) }),
      });
      return stmt([]);
    },
  };
  return { db, kv, leads };
}

function fakeRt(settings: Record<string, string> = {}, leads: Record<string, Partial<Lead>> = {}) {
  const f = fakeDb(leads);
  const waits: Promise<unknown>[] = [];
  let now = Date.UTC(2026, 9, 13, 10, 0, 0);
  const rt = {
    env: { DB: f.db },
    settings: { get: (k: string) => settings[k] || "", has: (k: string) => !!settings[k], bool: () => false, num: () => 0, source: () => "unset" },
    origin: "https://apply.example.com",
    waitUntil: (p: Promise<unknown>) => { waits.push(p); },
    now: () => now,
  };
  return { rt: rt as any, kv: f.kv, leads: f.leads, waits, tick: (ms: number) => { now += ms; } };
}

afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

// Node fs without @types/node: the module name goes through a variable so tsc does not resolve it.
async function applyJs(): Promise<string> {
  const mod = "node:fs";
  const fs = (await import(/* @vite-ignore */ mod)) as { readFileSync(p: string, enc: string): string };
  return fs.readFileSync("public/assets/apply.js", "utf8");
}

describe("scoring after moving blockers out of the flow", () => {
  it("blockers is after submit, optional and worth 0 points, and is last", () => {
    const i = APPLICATION.findIndex((q) => q.id === "blockers");
    const q = APPLICATION[i];
    expect(i).toBe(APPLICATION.length - 1);
    expect(q.afterSubmit && q.optional).toBe(true);
    expect((q.options || []).every((o) => o.points === 0)).toBe(true);
    for (const x of APPLICATION.slice(0, -1)) expect(x.afterSubmit).toBeFalsy();
  });
  it("max score is unchanged, so the thresholds keep their meaning", () => {
    let max = 0;
    for (const q of APPLICATION) {
      if (q.options) max += q.type === "multi" ? q.options.reduce((s, o) => s + o.points, 0) : Math.max(...q.options.map((o) => o.points));
      if (q.lengthPoints) max += Math.max(...q.lengthPoints.map((l) => l.points));
    }
    expect(max).toBe(110);
    expect(TIER_THRESHOLDS.A).toBe(70);
    const strong = { business: "Three dental clinics in Bergen", role: "owner", revenue: "3m_10m", spend: "100k_300k", goal: "own_growth", timeline: "0_3", readiness: "yes" };
    // No why-now, no blockers: still A.
    expect(scoreApplication(strong, { email: "a@clinic.no", country: "NO" }).tier).toBe("A");
    expect(scoreApplication({ ...strong, blockers: ["time"] }, { email: "a@clinic.no", country: "NO" }).score)
      .toBe(scoreApplication(strong, { email: "a@clinic.no", country: "NO" }).score);
  });
});

describe("phone: shared rule and the picked country", () => {
  it("uses the picked country over IP geo, only when it is a known dial code", () => {
    expect(normalizePhone("912 34 567", "US", "NO")).toBe("+4791234567");
    expect(normalizePhone("912 34 567", "NO", "ZZ")).toBe("+4791234567");
    expect(normalizePhone("07700 900123", null, "gb")).toBe("+447700900123");
    expect(normalizePhone("+46 70 123 45 67", "NO", "GB")).toBe("+46701234567");
    expect(dialCountry("no")).toBe("NO");
    expect(dialCountry("<x>")).toBeNull();
    expect(dialCountry("toString")).toBeNull();
  });
  it("8–15 digits after the +", () => {
    expect(PHONE_MIN_DIGITS).toBe(8);
    expect(PHONE_MAX_DIGITS).toBe(15);
    expect(normalizePhone("+47 12345", null)).toBeNull(); // 7 digits
    expect(normalizePhone("+47 123456", null)).toBe("+47123456");
    expect(normalizePhone("+1 234 567 890 123 456", null)).toBeNull(); // 16
  });
  it("apply.js embeds the same dial table and digit limits", async () => {
    const js = await applyJs();
    for (const [iso, cc] of Object.entries(DIAL)) expect(js, iso).toContain(`["${iso}", "${cc}"]`);
    expect(js).toContain("PHONE_MIN = 8, PHONE_MAX = 15");
  });
});

describe("email MX check", () => {
  it("reads DNS-over-HTTPS answers", () => {
    expect(mxVerdict({ Status: 3 })).toBe(false);
    expect(mxVerdict({ Status: 0 })).toBe(false);
    expect(mxVerdict({ Status: 0, Answer: [{ type: 5, data: "x." }] })).toBe(false);
    expect(mxVerdict({ Status: 0, Answer: [{ type: 15, data: "0 ." }] })).toBe(false);
    expect(mxVerdict({ Status: 0, Answer: [{ type: 15, data: "10 mx.acme.no." }] })).toBe(true);
    expect(mxVerdict({ Status: 2 })).toBeNull();
    expect(mxVerdict("nope")).toBeNull();
  });
  it("rejects a domain with no mail server, caches, and fails open", async () => {
    const { rt } = fakeRt();
    const fetchMock = vi.fn(async (url: string) => {
      const name = new URL(url).searchParams.get("name");
      if (name === "acme.no") return new Response(JSON.stringify({ Status: 0, Answer: [{ type: 15, data: "10 mx.acme.no." }] }));
      if (name === "typo.cmo") return new Response(JSON.stringify({ Status: 3 }));
      throw new Error("network");
    });
    vi.stubGlobal("fetch", fetchMock);
    expect(await emailDomainOk(rt, "a@acme.no")).toBe(true);
    expect(await emailDomainOk(rt, "a@typo.cmo")).toBe(false);
    expect(await emailDomainOk(rt, "a@typo.cmo")).toBe(false);
    expect(fetchMock).toHaveBeenCalledTimes(2); // second answer from the cache
    expect(await emailDomainOk(rt, "a@down.example")).toBe(true); // fail open
    expect(await emailDomainOk(rt, "a@gmail.com")).toBe(true); // no lookup for big providers
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(String(fetchMock.mock.calls[0][0])).toContain("cloudflare-dns.com/dns-query?name=acme.no&type=MX");
  });
});

describe("inline booking helpers", () => {
  it("matches the event type by scheduling URL", () => {
    const col = [
      { uri: "https://api.calendly.com/event_types/OLD", scheduling_url: "https://calendly.com/bendik/strategy", active: false },
      { uri: "https://api.calendly.com/event_types/AAA", scheduling_url: "https://calendly.com/bendik/strategy", active: true, locations: [{ kind: "zoom_conference" }] },
      { uri: "https://api.calendly.com/event_types/BBB", scheduling_url: "https://calendly.com/bendik/intro", active: true },
    ];
    expect(matchEventType(col, "https://calendly.com/Bendik/strategy/?utm=x")?.uri).toBe("https://api.calendly.com/event_types/AAA");
    expect(matchEventType(col, "https://calendly.com/bendik/other")).toBeNull();
    expect(matchEventType([{ uri: "https://evil.com/x", scheduling_url: "https://calendly.com/a" }], "https://calendly.com/a")).toBeNull();
  });
  it("parses available times: only available, not too soon, sorted, unique", () => {
    const now = Date.UTC(2026, 9, 13, 10);
    const out = parseAvailable([
      { status: "available", start_time: "2026-10-14T09:00:00.000000Z" },
      { status: "available", start_time: "2026-10-14T08:00:00Z" },
      { status: "available", start_time: "2026-10-14T08:00:00Z" },
      { status: "unavailable", start_time: "2026-10-14T07:00:00Z" },
      { status: "available", start_time: "2026-10-13T10:05:00Z" },
      { status: "available", start_time: "garbage" },
    ], now);
    expect(out).toEqual(["2026-10-14T08:00:00.000Z", "2026-10-14T09:00:00.000Z"]);
  });
  it("picks at most N per local day, spread, on the first days", () => {
    const day = (d: number, h: number) => new Date(Date.UTC(2026, 9, d, h)).toISOString();
    const slots = [...Array(10)].map((_, i) => day(14, 7 + i)).concat([day(15, 9), day(16, 9), day(17, 9)]);
    const p = pickSlots(slots, "UTC", 4, 2);
    expect(p).toEqual([day(14, 7), day(14, 10), day(14, 13), day(14, 16), day(15, 9)]);
    // Local days, not UTC days: 23:30 UTC is the next day in Oslo.
    expect(pickSlots(["2026-10-14T23:30:00.000Z", "2026-10-15T08:00:00.000Z"], "Europe/Oslo", 6, 1)).toHaveLength(2);
    expect(pickSlots(["2026-10-14T23:30:00.000Z"], "Not/AZone", 6, 1)).toHaveLength(1);
  });
  it("location: video needs nothing, outbound call uses the lead's phone", () => {
    expect(inviteeLocation([{ kind: "physical", location: "Oslo" }, { kind: "google_conference" }], null)).toEqual({ kind: "google_conference" });
    expect(inviteeLocation([{ kind: "outbound_call" }], "+4791234567")).toEqual({ kind: "outbound_call", location: "+4791234567" });
    expect(inviteeLocation([], null)).toBeUndefined();
  });
  it("inline tiers default to A and follow the setting", () => {
    expect(inlineTiers(fakeRt().rt)).toEqual(["A"]);
    expect(inlineTiers(fakeRt({ INLINE_BOOKING_TIERS: "a, B, C" }).rt)).toEqual(["A", "B"]);
  });
  it("availableTimes: 7-day max range, cached about a minute", async () => {
    const { rt, tick } = fakeRt({ CALENDLY_API_TOKEN: "t" });
    const urls: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      urls.push(url);
      return new Response(JSON.stringify({ collection: [{ status: "available", start_time: "2026-10-15T08:00:00Z" }] }));
    }));
    const uri = "https://api.calendly.com/event_types/AAA";
    expect(await availableTimes(rt, uri, 30)).toEqual(["2026-10-15T08:00:00.000Z"]);
    const q = new URL(urls[0]).searchParams;
    expect(Date.parse(q.get("end_time")!) - Date.parse(q.get("start_time")!)).toBeLessThanOrEqual(7 * 86_400_000);
    await availableTimes(rt, uri, 30);
    expect(urls).toHaveLength(1);
    tick(61_000);
    await availableTimes(rt, uri, 30);
    expect(urls).toHaveLength(2);
    expect(await availableTimes(rt, "https://evil.com/x", 5)).toBeNull();
  });
  it("resolves the event type once and caches it", async () => {
    const { rt } = fakeRt({ CALENDLY_API_TOKEN: "t", CALENDLY_ORG_URI: "https://api.calendly.com/organizations/ORG" });
    const f = vi.fn(async () => new Response(JSON.stringify({ collection: [{ uri: "https://api.calendly.com/event_types/AAA", scheduling_url: "https://calendly.com/b/s", active: true }] })));
    vi.stubGlobal("fetch", f);
    expect((await resolveEventType(rt, "https://calendly.com/b/s"))?.uri).toBe("https://api.calendly.com/event_types/AAA");
    expect((await resolveEventType(rt, "https://calendly.com/b/s"))?.uri).toBe("https://api.calendly.com/event_types/AAA");
    expect(f).toHaveBeenCalledTimes(1);
  });
  it("bookInvitee sends the lead id as tracking and spots a taken slot", async () => {
    const { rt } = fakeRt({ CALENDLY_API_TOKEN: "t" });
    const lead = { id: "l0123456789abcdefghij", email: "a@acme.no", first_name: "Ann", last_name: null, phone: "+4791234567", utm_source: "facebook" } as unknown as Lead;
    let body: any = null;
    vi.stubGlobal("fetch", vi.fn(async (_u: string, init: RequestInit) => {
      body = JSON.parse(String(init.body));
      return new Response(JSON.stringify({ resource: { uri: "https://api.calendly.com/scheduled_events/EV/invitees/INV", event: "https://api.calendly.com/scheduled_events/EV", email: "a@acme.no", name: "Ann" } }), { status: 201 });
    }));
    const ok = await bookInvitee(rt, lead, "https://api.calendly.com/event_types/AAA", "2026-10-15T08:00:00.000Z", "Europe/Oslo", [{ kind: "zoom_conference" }]);
    expect(ok.ok).toBe(true);
    expect(body.tracking.salesforce_uuid).toBe(lead.id);
    expect(body.invitee).toMatchObject({ email: "a@acme.no", timezone: "Europe/Oslo" });
    expect(body.location).toEqual({ kind: "zoom_conference" });
    if (ok.ok) expect(ok.invitee.tracking.salesforce_uuid).toBe(lead.id);
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ title: "Invalid", message: "The selected time is no longer available." }), { status: 400 })));
    expect(await bookInvitee(rt, lead, "https://api.calendly.com/event_types/AAA", "2026-10-15T08:00:00.000Z", "UTC")).toEqual({ ok: false, status: 400, taken: true });
    vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", { status: 500 })));
    expect(await bookInvitee(rt, lead, "https://api.calendly.com/event_types/AAA", "2026-10-15T08:00:00.000Z", "UTC")).toEqual({ ok: false, status: 500, taken: false });
  });
});

describe("POST /api/apply/book guards", () => {
  const base = { id: "l0123456789abcdefghij", email: "a@acme.no", first_name: "Ann", status: "applied", tier: "A", tier_override: null, route: "/book", closer_id: null, timezone: null } as Partial<Lead>;
  const idOf = (leadId: string | null) => ({ leadId } as any);
  it("needs the lead's own cookie, a finished application and an inline tier", async () => {
    const { rt } = fakeRt({ CALENDLY_API_TOKEN: "t" }, { [base.id!]: { ...base, app_completed_at: null } });
    expect((await bookInlineSlot(rt, idOf(null), { start: "2026-10-15T08:00:00Z" })) as any).toMatchObject({ ok: false, code: "no_lead" });
    expect((await bookInlineSlot(rt, idOf(base.id!), { start: "2026-10-15T08:00:00Z" })) as any).toMatchObject({ ok: false, code: "not_ready" });
    const b = fakeRt({ CALENDLY_API_TOKEN: "t" }, { [base.id!]: { ...base, app_completed_at: 1, tier: "B" } });
    expect((await bookInlineSlot(b.rt, idOf(base.id!), { start: "2026-10-15T08:00:00Z" })) as any).toMatchObject({ ok: false, code: "not_allowed", route: "/book" });
  });
  it("only books a time that was offered", async () => {
    const { rt, kv } = fakeRt({ CALENDLY_API_TOKEN: "t" }, { [base.id!]: { ...base, app_completed_at: 1 } });
    kv.set(`offer:${base.id}`, JSON.stringify({ et: { uri: "https://api.calendly.com/event_types/AAA", locations: [] }, slots: ["2026-10-15T08:00:00.000Z"], tz: "UTC", at: rt.now() }));
    const f = vi.fn(async () => new Response("{}", { status: 500 }));
    vi.stubGlobal("fetch", f);
    const r = await bookInlineSlot(rt, idOf(base.id!), { start: "2026-10-15T09:00:00Z", tz: "UTC" }) as any;
    expect(r).toMatchObject({ ok: false, code: "taken", slots: ["2026-10-15T08:00:00.000Z"] });
    expect(f).not.toHaveBeenCalled();
    // An offered time goes to Calendly; an API error falls back to the full calendar.
    const r2 = await bookInlineSlot(rt, idOf(base.id!), { start: "2026-10-15T08:00:00.000Z", tz: "UTC" }) as any;
    expect(r2).toMatchObject({ ok: false, code: "failed", route: "/book" });
    expect(f).toHaveBeenCalledTimes(1);
    expect(kv.has(`booking_lock:${base.id}`)).toBe(false);
  });
  it("an already booked lead is sent on", async () => {
    const { rt } = fakeRt({ CALENDLY_API_TOKEN: "t" }, { [base.id!]: { ...base, app_completed_at: 1, status: "booked", call_at: Date.UTC(2026, 9, 20) } });
    expect(await bookInlineSlot(rt, idOf(base.id!), { start: "2026-10-15T08:00:00Z" })).toMatchObject({ ok: true, next: "/breakout" });
  });
});

describe("drafts and hot partials", () => {
  const lead = { id: "l0123456789abcdefghij", answers: "{}", step_reached: 3, app_completed_at: null, status: "partial", first_name: "Ann", ref_code: "R1", booking_source: "funnel", call_consent_at: null } as Partial<Lead>;
  it("a draft is stored without advancing the step or counting as an answer", async () => {
    const { rt, leads } = fakeRt({}, { [lead.id!]: { ...lead } });
    await saveAnswers(rt, { leadId: lead.id } as any, { answers: { why_now: "Because", role: "owner" }, step: 9, draft: true });
    expect(JSON.parse(leads[lead.id!].answers as string)).toEqual({ why_now: "Because" });
    expect(leads[lead.id!].step_reached).toBe(3);
  });
  it("marks a strong partial once and pings the team after the delay, only if still incomplete", async () => {
    expect(isHotPartial({ role: "owner", revenue: "3m_10m" })).toBe(true);
    expect(isHotPartial({ role: "exec", revenue: "10m_plus" })).toBe(false);
    expect(isHotPartial({ role: "owner", revenue: "1m_3m" })).toBe(false);
    const { rt, kv, tick, waits } = fakeRt({}, { [lead.id!]: { ...lead, answers: JSON.stringify({ role: "owner" }) } });
    const notify = vi.fn(async () => new Response("ok"));
    vi.stubGlobal("fetch", notify);
    await saveAnswers(rt, { leadId: lead.id, visitorId: "v", sessionId: "s", geo: {} } as any, { answers: { revenue: "10m_plus" }, step: 4 }).catch(() => undefined);
    expect(kv.has(`hotpartial:${lead.id}`)).toBe(true);
    expect(await sweepHotPartials(rt)).toBe(0); // not yet due
    tick(APPLICATION_HOT_PARTIAL.afterMin * 60_000 + 1000);
    expect(await sweepHotPartials(rt)).toBe(1);
    await Promise.all(waits);
    expect(await sweepHotPartials(rt)).toBe(0); // exactly once
  });
});

describe("catalog", () => {
  it("form analytics and slot events are client micro events", () => {
    for (const n of ["app_view", "app_step_view", "app_step_done", "app_error", "slot_view", "slot_pick", "slot_booked", "slot_failed", "app_back"]) {
      expect(CLIENT_EVENTS.has(n), n).toBe(true);
      expect(MICRO_EVENTS.has(n), n).toBe(true);
    }
  });
});

describe("apply.js hard rules", () => {
  it("no document-level shortcuts, no aria-pressed, no banned phrase", async () => {
    const js = await applyJs();
    expect(js).not.toMatch(/d\.addEventListener\("keydown"/);
    expect(js).not.toContain("aria-pressed");
    expect(js.toLowerCase()).not.toContain("free call");
    expect(js).toContain('track("app_back", { step: idx + 1');
  });
});
