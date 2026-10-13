// QA sweep 4: confirmed defects. Each block names the finding it pins down (H = high, M = medium, L = low).
// Integration tests run the real handlers against the same D1 shim over node:sqlite as test/hq.test.ts.

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { Hono } from "hono";
import type { AppEnv, Runtime } from "../src/app";
import { makeRuntime } from "../src/app";
import { clearSettingsCache } from "../src/settings";
import { resetSecretCache } from "../src/lib/secret";
import { canAccess, makeSession, makeUserSession, requireAdmin } from "../src/admin/auth";
import { adminApi } from "../src/routes/admin";
import { fitNoShowModel, scoreUpcomingCalls } from "../src/sales/noshow";
import { callNotYet } from "../src/sales/outcomes";
import { TEMPLATES } from "../src/integrations/all-templates";
import { renderEmail } from "../src/integrations/email";
import { buildDossier } from "../src/followup/dossier";
import { dueRule, RULES, type TriggerState } from "../src/personalize/triggers";
import { nojsMessage } from "../src/funnel/pages";
import { unescHtml } from "../src/lib/text";
import { listRepsNamed } from "../src/sales/reps";
import { ctaCheck } from "../src/admin/readiness";
import { saveContact } from "../src/funnel/application";
import type { EmailCtx } from "../src/integrations/email-types";
import type { Identity } from "../src/lib/identity";
import type { Lead } from "../src/funnel/leads";

// ── D1 shim over node:sqlite ─────────────────────────────────────────────────

type Row = Record<string, unknown>;
interface Shim { prepare(sql: string): unknown; batch(s: unknown[]): Promise<unknown[]>; q(sql: string, ...a: unknown[]): Row[]; x(sql: string, ...a: unknown[]): void }

async function makeDb(): Promise<Shim> {
  const sqliteMod = "node:sqlite", fsMod = "node:fs";
  const { DatabaseSync } = (await import(/* @vite-ignore */ sqliteMod)) as { DatabaseSync: new (p: string) => any };
  const fs = (await import(/* @vite-ignore */ fsMod)) as { readdirSync(p: string): string[]; readFileSync(p: string, e: string): string };
  const db = new DatabaseSync(":memory:");
  for (const f of fs.readdirSync("migrations").filter((x) => x.endsWith(".sql")).sort()) db.exec(fs.readFileSync("migrations/" + f, "utf8"));
  const norm = (v: unknown) => (v === undefined ? null : typeof v === "boolean" ? (v ? 1 : 0) : v);
  const plain = (r: unknown) => (r ? { ...(r as Row) } : null);
  class Stmt {
    constructor(public sql: string, public args: unknown[] = []) {}
    bind(...a: unknown[]) { return new Stmt(this.sql, a.map(norm)); }
    async first(col?: string) { const r = plain(db.prepare(this.sql).get(...this.args)); return r ? (col ? r[col] : r) : null; }
    async all() { return { results: (db.prepare(this.sql).all(...this.args) as unknown[]).map((r) => plain(r)), success: true }; }
    async run() { const r = db.prepare(this.sql).run(...this.args); return { success: true, meta: { changes: Number(r.changes), last_row_id: Number(r.lastInsertRowid) } }; }
  }
  return {
    prepare: (sql: string) => new Stmt(sql),
    batch: async (stmts: unknown[]) => {
      db.exec("BEGIN");
      try { const out = []; for (const s of stmts as Stmt[]) out.push(await s.run()); db.exec("COMMIT"); return out; } catch (e) { db.exec("ROLLBACK"); throw e; }
    },
    q: (sql: string, ...a: unknown[]) => (db.prepare(sql).all(...a.map(norm)) as unknown[]).map((r) => plain(r) as Row),
    x: (sql: string, ...a: unknown[]) => { db.prepare(sql).run(...a.map(norm)); },
  };
}

const NOW = Date.UTC(2026, 9, 13, 10, 0, 0);
const MIN = 60_000, H = 60 * MIN, DAY = 24 * H;
let db: Shim;
let env: Record<string, unknown>;
let seq = 0;
const lid = () => "l" + String(++seq).padStart(19, "0");

function insertLead(f: Row): string {
  const id = (f.id as string) || lid();
  const row: Row = { id, ref_code: "OP-" + id.slice(-6).toUpperCase(), created_at: NOW - 2 * DAY, updated_at: NOW - 2 * DAY, email: `${id}@acme.io`, status: "applied", booking_source: "funnel", ...f };
  const keys = Object.keys(row);
  db.x(`INSERT INTO leads (${keys.join(",")}) VALUES (${keys.map(() => "?").join(",")})`, ...keys.map((k) => row[k]));
  return id;
}
function insertRep(id: string, name: string) {
  db.x("INSERT INTO reps (id, name, role, tiers, weight, active, created_at) VALUES (?,?,?,?,1,1,?)", id, name, "closer", "A,B", NOW - 100 * DAY);
}
function insertUser(id: string, email: string, role: string, rep: string | null = null) {
  db.x("INSERT INTO users (id, email, name, role, rep_id, active, created_at) VALUES (?,?,?,?,?,1,?)", id, email, email.split("@")[0], role, rep, NOW - 50 * DAY);
}
async function rtFor(extra: Record<string, unknown> = {}): Promise<Runtime> {
  const rt = await makeRuntime({ ...env, ...extra } as never, null, "https://hq.example.com/");
  return { ...rt, now: () => NOW };
}
function testApp() {
  const app = new Hono<AppEnv>();
  app.use("*", async (c, next) => { c.set("rt", await makeRuntime(c.env, null, c.req.url)); await next(); });
  app.use("/admin/api/*", requireAdmin);
  app.route("/admin/api", adminApi);
  return app;
}
const ORIGIN = "https://hq.example.com";
async function call(path: string, o: { method?: string; cookie?: string; body?: unknown } = {}) {
  const headers: Record<string, string> = {};
  if (o.cookie) headers.cookie = `_fa=${o.cookie}`;
  if (o.method && o.method !== "GET") { headers["sec-fetch-site"] = "same-origin"; headers.origin = ORIGIN; }
  if (o.body !== undefined) headers["content-type"] = "application/json";
  const res = await testApp().request(ORIGIN + path, { method: o.method || "GET", headers, body: o.body === undefined ? undefined : JSON.stringify(o.body) }, env);
  const text = await res.text();
  let json: any = null;
  try { json = JSON.parse(text); } catch { json = null; }
  return { status: res.status, json, text };
}

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
  clearSettingsCache();
  resetSecretCache();
  db = await makeDb();
  env = { DB: db, ADMIN_PASSWORD: "correct horse battery staple", SESSION_SECRET: "test-secret-" + "x".repeat(40) };
  vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", { status: 200 })));
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  clearSettingsCache();
});

// ── H1: no-show scoring SQL ──────────────────────────────────────────────────

describe("H1 no-show model SQL", () => {
  it("hourly scoring runs (LIMIT comes after the test-data clause) and skips test leads", async () => {
    const real = insertLead({ status: "booked", call_at: NOW + 5 * H, booked_at: NOW - DAY, tier: "A" });
    const test = insertLead({ status: "booked", call_at: NOW + 6 * H, booked_at: NOW - DAY, tier: "A" });
    db.x("INSERT INTO lead_revops (lead_id, is_test, updated_at) VALUES (?,1,?)", test, NOW);
    const rt = await rtFor();
    await expect(scoreUpcomingCalls(rt, true)).resolves.toBeTypeOf("number");
    const scored = db.q("SELECT lead_id FROM lead_revops WHERE noshow_scored_at IS NOT NULL").map((r) => r.lead_id);
    expect(scored).toEqual([real]);
  });
  it("the nightly fit runs", async () => {
    insertLead({ status: "no_show", call_at: NOW - 2 * DAY, booked_at: NOW - 5 * DAY });
    await expect(fitNoShowModel(await rtFor())).resolves.toMatchObject({ fitted: false, n: 1 });
  });
});

// ── H2: rep routes ───────────────────────────────────────────────────────────

describe("H2 rep role matrix", () => {
  const L = "/leads/l0000000000000000001";
  it("closers and setters may log held calls, write plans and read the metric dictionary", () => {
    for (const role of ["closer", "setter"]) {
      expect(canAccess(role, "POST", "/calls/held")).toBe(true);
      expect(canAccess(role, "PUT", `${L}/plan`)).toBe(true);
      expect(canAccess(role, "GET", "/metrics")).toBe(true);
      // Deliberately manager-only.
      expect(canAccess(role, "POST", `${L}/test`)).toBe(false);
      expect(canAccess(role, "POST", `${L}/confirm-booking`)).toBe(false);
      expect(canAccess(role, "POST", "/reassign")).toBe(false);
      expect(canAccess(role, "POST", "/test-data/sweep")).toBe(false);
    }
    expect(canAccess("viewer", "POST", "/calls/held")).toBe(false);
    expect(canAccess("viewer", "PUT", `${L}/plan`)).toBe(false);
  });
  it("a closer logs a held call on their own lead only; a viewer cannot", async () => {
    insertRep("r1", "Cleo"); insertRep("r2", "Dan");
    insertUser("u0000000000000000011", "cleo@acme.io", "closer", "r1");
    insertUser("u0000000000000000012", "vic@acme.io", "viewer");
    const closer = await makeUserSession(env as never, "u0000000000000000011", NOW);
    const viewer = await makeUserSession(env as never, "u0000000000000000012", NOW);
    const mine = insertLead({ closer_id: "r1", status: "booked", call_at: NOW - H, booked_at: NOW - DAY, tier: "A" });
    const theirs = insertLead({ closer_id: "r2", status: "booked", call_at: NOW - H, booked_at: NOW - DAY, tier: "A" });
    const ok = await call("/admin/api/calls/held", { method: "POST", cookie: closer, body: { lead_id: mine, offer_made: "yes", plan: { first_build: "Quote tool", next_step: "Decide" } } });
    expect(ok.status).toBe(200);
    expect(db.q("SELECT status FROM leads WHERE id = ?", mine)[0].status).toBe("showed");
    expect((await call(`/admin/api/leads/${mine}/plan`, { method: "PUT", cookie: closer, body: { first_build: "Quote tool v2", next_step: "Decide" } })).status).toBe(200);
    expect((await call("/admin/api/calls/held", { method: "POST", cookie: closer, body: { lead_id: theirs, offer_made: "no" } })).status).toBe(404);
    expect((await call(`/admin/api/leads/${theirs}/plan`, { method: "PUT", cookie: closer, body: { first_build: "x", next_step: "y" } })).status).toBe(404);
    expect((await call("/admin/api/metrics", { cookie: closer })).status).toBe(200);
    expect((await call("/admin/api/calls/held", { method: "POST", cookie: viewer, body: { lead_id: mine, offer_made: "no" } })).status).toBe(403);
    expect((await call(`/admin/api/leads/${mine}/test`, { method: "POST", cookie: closer, body: { is_test: true } })).status).toBe(403);
  });
});

// ── M1: outcomes before the call ─────────────────────────────────────────────

describe("M1 a future call cannot be marked showed or no-show", () => {
  it("pure: 10 minutes of grace before the start", () => {
    expect(callNotYet({ call_at: NOW + 11 * MIN }, NOW)).toBe(true);
    expect(callNotYet({ call_at: NOW + 9 * MIN }, NOW)).toBe(false);
    expect(callNotYet({ call_at: null }, NOW)).toBe(false);
  });
  it("held form, drawer patch, outcome and pipeline drag all refuse; nothing is cancelled or queued", async () => {
    const owner = await makeSession(env as never, NOW);
    const id = insertLead({ status: "booked", call_at: NOW + DAY, booked_at: NOW - DAY, tier: "A" });
    db.x("INSERT INTO emails (id, lead_id, sequence, step, template, send_at, status, created_at) VALUES ('m1','" + id + "','booked',1,'bk_24h',?,'pending',?)", NOW + 2 * H, NOW);
    const held = await call("/admin/api/calls/held", { method: "POST", cookie: owner, body: { lead_id: id, offer_made: "yes" } });
    expect(held.status).toBe(422);
    expect(held.json.error).toMatch(/hasn't happened yet/);
    const patch = await call(`/admin/api/leads/${id}`, { method: "PATCH", cookie: owner, body: { status: "no_show" } });
    expect(patch.status).toBe(422);
    expect(patch.json.error).toMatch(/hasn't happened yet/);
    expect((await call("/admin/api/sales/outcome", { method: "POST", cookie: owner, body: { lead_id: id, patch: { status: "showed" } } })).status).toBe(422);
    expect((await call("/admin/api/pipeline/move", { method: "POST", cookie: owner, body: { lead_id: id, stage: "held" } })).status).toBe(422);
    expect(db.q("SELECT status FROM leads WHERE id = ?", id)[0].status).toBe("booked");
    expect(db.q("SELECT status FROM emails WHERE id = 'm1'")[0].status).toBe("pending");
    expect(db.q("SELECT COUNT(*) AS n FROM emails WHERE lead_id = ? AND sequence IN ('post_call','no_show')", id)[0].n).toBe(0);
    expect(db.q("SELECT COUNT(*) AS n FROM call_reviews WHERE lead_id = ?", id)[0].n).toBe(0);
  });
  it("from 10 minutes before the start it is allowed", async () => {
    const owner = await makeSession(env as never, NOW);
    const id = insertLead({ status: "booked", call_at: NOW + 5 * MIN, booked_at: NOW - DAY, tier: "A" });
    expect((await call("/admin/api/calls/held", { method: "POST", cookie: owner, body: { lead_id: id, offer_made: "no" } })).status).toBe(200);
    expect(db.q("SELECT status FROM leads WHERE id = ?", id)[0].status).toBe("showed");
  });
});

// ── M2: emails never promise a video that does not exist ─────────────────────

function ctx(hasVideo: { breakout: boolean; precall: boolean } | undefined, closerName = "Bendik"): EmailCtx {
  const lead = { id: "l0000000000000000099", first_name: "Ann", answers: JSON.stringify({ business: "We sell dental implants" }), status: "booked", booking_source: "funnel", call_at: NOW + DAY } as unknown as Lead;
  return {
    lead, d: buildDossier(lead), firstName: "Ann", bookPath: "/book", callTime: "Tuesday 14 October at 15:00 (CEST)", closerName, sigName: "Bendik", now: NOW, hasVideo,
    link: (p) => `https://x/r/m1/sig?u=${encodeURIComponent(p)}`, a: (p, l) => `<a href="${p}">${l}</a>`,
  };
}
const VIDEO_EMAILS = ["bk_confirm", "tb_1", "tb_3", "tb_4", "tb_8", "t_breakout_done", "t_watch_prep"];

describe("M2 video promises", () => {
  it("without films, no email mentions a video", () => {
    for (const hv of [undefined, { breakout: false, precall: false }]) {
      for (const id of VIDEO_EMAILS) {
        const e = TEMPLATES[id](ctx(hv));
        expect(JSON.stringify(e), id).not.toMatch(/video/i);
      }
    }
  });
  it("with films, the video copy and CTA come back", () => {
    const on = ctx({ breakout: true, precall: true });
    expect(TEMPLATES.bk_confirm(on).cta?.label).toBe("Watch the pre-call video");
    expect(TEMPLATES.tb_1(on).subject).toBe("Thanks for applying. One short video first");
    expect(TEMPLATES.t_watch_prep(on).cta?.label).toBe("Watch the pre-call video");
    // Each film is checked on its own.
    expect(JSON.stringify(TEMPLATES.bk_confirm(ctx({ breakout: true, precall: false })))).not.toMatch(/video/i);
    expect(JSON.stringify(TEMPLATES.tb_1(ctx({ breakout: false, precall: true })))).not.toMatch(/video/i);
  });
  it("the film triggers never fire without the film", () => {
    const iWatch = RULES.findIndex((r) => r.template === "t_watch_prep");
    const iDone = RULES.findIndex((r) => r.template === "t_breakout_done");
    const others = new Set(RULES.map((_, i) => i).filter((i) => i !== iWatch && i !== iDone));
    const base: TriggerState = {
      lead: { id: "l1", status: "booked", tier: "A", tier_override: null, app_completed_at: NOW - 2 * DAY, step_reached: 9, updated_at: NOW - DAY, call_at: NOW + 2 * DAY, booked_at: NOW - DAY, created_at: NOW - 3 * DAY } as never,
      mainWatchedPct: 0, breakoutWatchedPct: 0, precallPlayed: false, sessions: 1, lastActivity: NOW - DAY, lastPageViewAfterApply: null,
      bookPageViewAt: null, bookingDateSelectedAt: null, guaranteeAt: null, costInterestAt: null, mainWatchedAt: null, breakoutWatchedAt: null,
    };
    expect(dueRule({ ...base, films: { breakout: false, precall: false } }, others, NOW)).toBe(null);
    expect(dueRule({ ...base, films: { breakout: false, precall: true } }, others, NOW)).toBe(iWatch);
    const open = { ...base, lead: { ...base.lead, status: "applied", call_at: null, booked_at: null }, breakoutWatchedPct: 90, breakoutWatchedAt: NOW - 2 * H } as TriggerState;
    expect(dueRule({ ...open, films: { breakout: false, precall: false } }, others, NOW)).toBe(null);
    expect(dueRule({ ...open, films: { breakout: true, precall: false } }, others, NOW)).toBe(iDone);
  });
});

// ── L5 / L6 / L2: email copy ─────────────────────────────────────────────────

describe("L2 L5 L6 email copy", () => {
  it("bk_confirm says 'our call' only when the sender is the closer, and the prep list reads cleanly", () => {
    const own = TEMPLATES.bk_confirm(ctx(undefined, "Bendik"));
    expect(own.paragraphs[1]).toBe("You're booked. Our call is on Tuesday 14 October at 15:00 (CEST).");
    const other = TEMPLATES.bk_confirm(ctx(undefined, "Cleo"));
    expect(other.paragraphs[1]).toBe("You're booked. Your call is on Tuesday 14 October at 15:00 (CEST), with Cleo.");
    expect(own.paragraphs[2]).toMatch(/software; have your ad account .*; and bring anyone/);
  });
  it("fu_recap's subject does not say 'today' (it can go 24 h later)", () => {
    const lead = { id: "l0000000000000000099", first_name: "Ann", answers: "{}", status: "showed", booking_source: "funnel", showed_at: NOW } as unknown as Lead;
    const subject = TEMPLATES.fu_recap({ ...ctx(undefined), lead, d: buildDossier(lead) }).subject;
    expect(subject).not.toMatch(/today/i);
  });
  it("plain-text parts decode quotes and dashes instead of showing entities", () => {
    expect(unescHtml("&ldquo;Hi&rdquo; &mdash; it&#39;s &lt;b&gt; &amp;lt; &hellip;")).toBe("“Hi” — it's <b> &lt; …");
    const r = renderEmail({ subject: "S", paragraphs: ["You described the business as &ldquo;x&rdquo;."] }, { link: (p) => p, unsubUrl: "https://u", pixelUrl: null, address: "A", sigName: "B", company: "C" });
    expect(r.text).not.toMatch(/&[a-z]+;/);
    expect(r.text).toContain("“x”");
    const tb1 = TEMPLATES.tb_1(ctx(undefined));
    expect(JSON.stringify(tb1)).not.toMatch(/&ldquo;|&rdquo;/);
  });
});

// ── M3: no-JS messages ───────────────────────────────────────────────────────

describe("M3 no-JS result messages", () => {
  it("maps each code, with a generic line for unknown ones", () => {
    expect(nojsMessage("confirm")).toBe("Check your inbox: we sent you a link to continue.");
    expect(nojsMessage("rate")).toMatch(/Too many/);
    expect(nojsMessage("phone")).toMatch(/mobile number/);
    expect(nojsMessage("<script>")).toMatch(/Something went wrong/);
  });
});

// ── L3, L12 ──────────────────────────────────────────────────────────────────

describe("L3 fallback closer and L12 readiness", () => {
  it("the config fallback closer has a name, and stays selectable only while the reps table is empty", async () => {
    const rt = await rtFor();
    expect((await listRepsNamed(rt)).find((r) => r.id === "founder")).toMatchObject({ name: "Bendik", active: 1 });
    insertRep("r1", "Cleo");
    expect((await listRepsNamed(rt)).find((r) => r.id === "founder")).toMatchObject({ name: "Bendik", active: 0 });
  });
  it("the drawer and the pipeline show the fallback closer's name", async () => {
    const owner = await makeSession(env as never, NOW);
    const id = insertLead({ status: "booked", call_at: NOW + DAY, booked_at: NOW - DAY, tier: "A", closer_id: "founder" });
    const d = await call(`/admin/api/leads/${id}`, { cookie: owner });
    expect(d.json.lead.closer).toBe("Bendik");
    expect(d.json.reps.map((r: Row) => r.id)).toContain("founder");
    const p = await call("/admin/api/pipeline", { cookie: owner });
    const card = p.json.stages.flatMap((s: Row) => s.cards as Row[]).find((c: Row) => c.id === id);
    expect(card.closer).toBe("Bendik");
  });
  it("the unlock-second check fails while there is no film", () => {
    expect(ctaCheck(120, 600, null, false).ok).toBe(false);
    expect(ctaCheck(120, 600, null, true).ok).toBe(true);
  });
});

// ── L13, L14: contact step ───────────────────────────────────────────────────

function ident(visitorId: string): Identity {
  return {
    visitorId, sessionId: "s" + visitorId.slice(1), leadId: null, newVisitor: false, newSession: false, isBot: false, botReason: null, variant: "a", lander: null,
    geo: { country: "NO", region: null, city: null } as never, ip: null, ua: "test", device: "desktop", consentRequired: false, consent: {} as never, adsAllowed: false,
    fbp: null, fbc: null, touch: null, channel: "Direct", isPrefetch: false,
  } as unknown as Identity;
}

describe("L13 L14 contact step", () => {
  it("a number already on another recent lead: consent is not stored and the client is told", async () => {
    const rt = await rtFor();
    const a = await saveContact(rt, ident("v0000000000000000001"), { first_name: "Ann", email: "ann.qa4@gmail.com", phone: "+4791234567", call_consent: true }, { skipTurnstile: true });
    expect(a).toMatchObject({ ok: true, consentDropped: false });
    const b = await saveContact(rt, ident("v0000000000000000002"), { first_name: "Bob", email: "bob.qa4@gmail.com", phone: "+4791234567", call_consent: true }, { skipTurnstile: true });
    expect(b).toMatchObject({ ok: true, consentDropped: true });
    expect(db.q("SELECT call_consent_at FROM leads WHERE email = 'bob.qa4@gmail.com'")[0].call_consent_at).toBe(null);
  });
  it("a test lead's browser leaves the visitor counts at insert, not at the next sweep", async () => {
    const rt = await rtFor();
    const v = "v0000000000000000003";
    db.x("INSERT INTO visitors (id, created_at, last_seen_at) VALUES (?,?,?)", v, NOW - H, NOW - H);
    db.x("INSERT INTO sessions (id, visitor_id, started_at, last_seen_at, landing_query, is_bot) VALUES (?,?,?,?,?,0)", "s0000000000000000003", v, NOW - H, NOW - H, "test=1");
    const r = await saveContact(rt, ident(v), { first_name: "Tess", email: "tess.qa4@gmail.com", phone: "+4791234999" }, { skipTurnstile: true });
    expect(r.ok).toBe(true);
    expect(db.q("SELECT is_test FROM lead_revops r JOIN leads l ON l.id = r.lead_id WHERE l.email = 'tess.qa4@gmail.com'")[0].is_test).toBe(1);
    expect(db.q("SELECT visitor_id FROM test_visitors").map((x) => x.visitor_id)).toContain(v);
  });
});
