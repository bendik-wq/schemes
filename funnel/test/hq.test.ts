// Funnel HQ round 3: one metric dictionary (funnel never grows down the steps, Overview = Traffic), small-sample
// guards, test-data separation, launch readiness, closer KPIs, the escalation ladder, written call plans and the
// smaller fixes (merged/erased drawer, email labels, application median time). Integration tests run the real
// route handlers against a D1 shim over node:sqlite with every migration applied.

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { Hono } from "hono";
import type { AppEnv, Runtime } from "../src/app";
import { makeRuntime } from "../src/app";
import { clearSettingsCache } from "../src/settings";
import { resetSecretCache } from "../src/lib/secret";
import { makeSession, makeUserSession, requireAdmin } from "../src/admin/auth";
import { adminApi, groupQueue } from "../src/routes/admin";
import { METRICS, FUNNEL_STEPS, bestBy, stepCounts, wilson } from "../src/admin/metrics";
import { medianSeconds, flagLabel } from "../src/admin/stats";
import { isTestEmail, isTestLead, isTestQuery, setTestFlag, sweepTestData, sessionIpHash } from "../src/admin/testdata";
import { ctaCheck, skipBacklog } from "../src/admin/readiness";
import { businessMs, parseSalesHours, slaLevel, runEscalations, reassignToken, verifyReassignToken, inSalesHours } from "../src/sales/escalation";
import { cleanPlan, newPlanToken, verifyPlanToken, PlanError, planView } from "../src/sales/plan";
import { cleanReview, closerKpis, CallError, weekKey } from "../src/sales/calls";
import { baseEmail, groupSamePerson } from "../src/sales/today";
import { sequenceName, triggerWhen, templateSubjects } from "../src/admin/email-catalog";
import { TEMPLATES } from "../src/integrations/all-templates";
import { buildDossier } from "../src/followup/dossier";
import type { EmailCtx } from "../src/integrations/email-types";
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

// Tuesday 13 October 2026, 12:00 in Oslo (CEST): inside sales hours.
const NOW = Date.UTC(2026, 9, 13, 10, 0, 0);
const MIN = 60_000, H = 3_600_000, DAY = 24 * H;
let db: Shim;
let env: Record<string, unknown>;
let seq = 0;
const lid = () => "l" + String(++seq).padStart(19, "0");
const vid = () => "v" + String(++seq).padStart(19, "0");

function insertLead(f: Row): string {
  const id = (f.id as string) || lid();
  const row: Row = { id, ref_code: "OP-" + id.slice(-6).toUpperCase(), created_at: NOW - 2 * DAY, updated_at: NOW - 2 * DAY, email: `${id}@acme.example`, status: "applied", booking_source: "funnel", ...f };
  const keys = Object.keys(row);
  db.x(`INSERT INTO leads (${keys.join(",")}) VALUES (${keys.map(() => "?").join(",")})`, ...keys.map((k) => row[k]));
  return id;
}
function insertSession(visitor: string, f: Row = {}) {
  const id = "s" + String(++seq).padStart(19, "0");
  const row: Row = { id, visitor_id: visitor, started_at: NOW - DAY, last_seen_at: NOW - DAY, channel: "Paid Social", is_bot: 0, ...f };
  const keys = Object.keys(row);
  db.x(`INSERT INTO sessions (${keys.join(",")}) VALUES (${keys.map(() => "?").join(",")})`, ...keys.map((k) => row[k]));
  db.x("INSERT OR IGNORE INTO visitors (id, created_at, last_seen_at) VALUES (?,?,?)", visitor, NOW - 5 * DAY, NOW - DAY);
}
function insertEvent(visitor: string, name: string, f: Row = {}) {
  db.x("INSERT INTO events (id, ts, name, visitor_id, path, source, is_bot) VALUES (?,?,?,?,?,?,0)", "e" + String(++seq).padStart(19, "0"), (f.ts as number) || NOW - DAY, name, visitor, (f.path as string) || null, "client");
}
function insertRep(id: string, name: string, tiers = "A,B", slack: string | null = null) {
  db.x("INSERT INTO reps (id, name, role, tiers, weight, active, slack_user_id, created_at) VALUES (?,?,?,?,1,1,?,?)", id, name, "closer", tiers, slack, NOW - 100 * DAY);
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
async function call(path: string, o: { method?: string; cookie?: string; body?: unknown; headers?: Record<string, string> } = {}) {
  const headers: Record<string, string> = { ...(o.headers || {}) };
  if (o.cookie) headers.cookie = `_fa=${o.cookie}`;
  if (o.method && o.method !== "GET") { headers["sec-fetch-site"] = "same-origin"; headers.origin = ORIGIN; }
  if (o.body !== undefined) headers["content-type"] = "application/json";
  const res = await testApp().request(ORIGIN + path, { method: o.method || "GET", headers, body: o.body === undefined ? undefined : JSON.stringify(o.body) }, env);
  const text = await res.text();
  let json: any = null;
  try { json = JSON.parse(text); } catch { json = null; }
  return { status: res.status, json, text };
}

let fetchMock: ReturnType<typeof vi.fn>;
beforeEach(async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
  clearSettingsCache();
  resetSecretCache();
  db = await makeDb();
  env = { DB: db, ADMIN_PASSWORD: "correct horse battery staple", SESSION_SECRET: "test-secret-" + "x".repeat(40) };
  fetchMock = vi.fn(async () => new Response("{}", { status: 200 }));
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  clearSettingsCache();
});

// ── Schema ───────────────────────────────────────────────────────────────────

describe("migration 0022", () => {
  it("adds side tables only and leaves leads untouched", () => {
    const tables = db.q("SELECT name FROM sqlite_master WHERE type = 'table'").map((r) => String(r.name));
    for (const t of ["test_visitors", "call_reviews", "call_plans", "lead_escalations", "lead_redirects"]) expect(tables).toContain(t);
    expect(db.q("SELECT COUNT(*) AS n FROM pragma_table_info('leads')")[0].n).toBe(96);
    expect(db.q("SELECT name FROM pragma_table_info('lead_revops')").map((r) => r.name)).toContain("is_test");
  });
  it("marks test addresses at insert and cleans its tables when a lead is erased", () => {
    const a = insertLead({ email: "ada@example.com" });
    const b = insertLead({ email: "bo+test@acme.io" });
    const c = insertLead({ email: "real@acme.io" });
    const flags = Object.fromEntries(db.q("SELECT lead_id, is_test FROM lead_revops").map((r) => [r.lead_id, r.is_test]));
    expect(flags[a]).toBe(1);
    expect(flags[b]).toBe(1);
    expect(flags[c]).toBeUndefined();
    db.x("INSERT INTO call_plans (id, lead_id, token, body, created_at) VALUES ('cp1', ?, 'tok', '{}', 1)", c);
    db.x("INSERT INTO call_reviews (id, lead_id, offer_made, created_at) VALUES ('cr1', ?, 1, 1)", c);
    db.x("DELETE FROM leads WHERE id = ?", c);
    expect(db.q("SELECT COUNT(*) AS n FROM call_plans")[0].n).toBe(0);
    expect(db.q("SELECT COUNT(*) AS n FROM call_reviews")[0].n).toBe(0);
  });
});

// ── Metric dictionary ────────────────────────────────────────────────────────

describe("metric dictionary", () => {
  it("defines every funnel step and the tiles once, in words", () => {
    for (const id of [...FUNNEL_STEPS, "visitors", "applied", "qualified", "booked", "saw_form", "contact_rate", "median_time", "show_rate", "offer_rate", "close_of_offers", "cash_on_call", "cycle_days", "per_call_held"]) {
      expect(METRICS[id], id).toBeTruthy();
      expect(METRICS[id].definition.length).toBeGreaterThan(20);
    }
  });
  it("stepCounts never increases down the funnel", () => {
    const c = stepCounts([0, 0, 1, 2, 2, 3, 7, 5, 4, 6]);
    for (let i = 1; i < c.length; i++) expect(c[i]).toBeLessThanOrEqual(c[i - 1]);
    expect(c[0]).toBe(10);
    expect(c[7]).toBe(1);
  });
  it("Wilson 90% interval and best-by-bookings guard", () => {
    const [lo, hi] = wilson(7, 20) as [number, number];
    expect(lo).toBeGreaterThan(0.18);
    expect(hi).toBeLessThan(0.55);
    expect(wilson(0, 0)).toBeNull();
    expect(bestBy([{ k: "a", booked: 4, cash: 9e6 }, { k: "b", booked: 3, cash: 0 }])).toBeNull();
    expect(bestBy([{ k: "a", booked: 6, cash: 0 }, { k: "b", booked: 5, cash: 1e6 }, { k: "c", booked: 6, cash: 10 }])!.k).toBe("c");
  });
  it("labels flags like people say them and measures time in seconds", () => {
    expect(flagLabel("under_1m")).toBe("Under $1M");
    expect(flagLabel("small")).toBe("$1–3M");
    expect(medianSeconds([20_000, 40_000, 90_000])).toBe(40);
    expect(medianSeconds([20_000, 40_000])).toBe(30);
    expect(medianSeconds([0, -5])).toBeNull();
  });
});

describe("one basis everywhere (seeded)", () => {
  let owner: string;
  beforeEach(async () => {
    owner = await makeSession(env as never, NOW);
    // 6 visitors in the period. Two saw the embedded form (app_view), one opened /apply.
    const vs = Array.from({ length: 6 }, () => vid());
    vs.forEach((v, i) => insertSession(v, { channel: i < 4 ? "Paid Social" : "Direct", utm_source: i < 4 ? "facebook" : null }));
    insertEvent(vs[0], "app_view");
    insertEvent(vs[1], "app_view");
    insertEvent(vs[2], "page_view", { path: "/apply" });
    // Leads: one from a visitor with a form view; two created through the API with no form event (the
    // simulator's case that produced "215% of form visitors"); one applied last month but booked this week.
    insertLead({ visitor_id: vs[0], created_at: NOW - DAY, app_completed_at: NOW - DAY + 5 * MIN, app_started_at: NOW - DAY, tier: "A", ft_channel: "Paid Social" });
    insertLead({ visitor_id: vs[3], created_at: NOW - DAY, app_completed_at: NOW - DAY + 90_000, app_started_at: NOW - DAY, tier: "B", ft_channel: "Paid Social" });
    insertLead({ visitor_id: null, created_at: NOW - DAY, tier: null, ft_channel: null });
    insertLead({ visitor_id: vs[4], created_at: NOW - 60 * DAY, app_completed_at: NOW - 60 * DAY, tier: "A", status: "booked", booked_at: NOW - 2 * DAY, call_at: NOW + DAY, ft_channel: "Direct" });
    // A test lead and an admin's browser: left out unless asked.
    const tv = vid();
    insertSession(tv);
    insertLead({ visitor_id: tv, email: "qa@example.com", created_at: NOW - DAY, app_completed_at: NOW - DAY, tier: "A" });
  });
  it("funnel steps never grow and saw-the-form covers everyone who left details", async () => {
    await sweepTestData(await rtFor());
    const o = await call("/admin/api/overview?range=7d", { cookie: owner });
    const f = o.json.funnel as Array<{ key: string; n: number }>;
    for (let i = 1; i < f.length; i++) expect(f[i].n, f[i].key).toBeLessThanOrEqual(f[i - 1].n);
    expect(f.map((x) => x.key)).toEqual([...FUNNEL_STEPS]);
    const app = await call("/admin/api/application?range=7d", { cookie: owner });
    expect(app.json.kpis.saw_form).toBeGreaterThanOrEqual(app.json.kpis.contacts);
    expect(app.json.kpis.contact_rate).toBeLessThanOrEqual(100);
    expect(app.json.kpis.median_seconds).toBeGreaterThan(0);
  });
  it("Traffic totals equal the Overview tiles", async () => {
    await sweepTestData(await rtFor());
    const o = await call("/admin/api/overview?range=7d", { cookie: owner });
    const t = await call("/admin/api/traffic?range=7d&dim=channel", { cookie: owner });
    expect(t.json.totals.applied).toBe(o.json.kpis.applications);
    expect(t.json.totals.qualified).toBe(o.json.counts.qualified);
    expect(t.json.totals.booked).toBe(o.json.kpis.booked);
    expect(t.json.totals.visitors).toBe(o.json.kpis.visitors);
    expect(t.json.best).toBeNull(); // fewer than 5 bookings: too early to call
  });
  it("leaves test data out unless included", async () => {
    await sweepTestData(await rtFor());
    const without = await call("/admin/api/overview?range=7d", { cookie: owner });
    const withTest = await call("/admin/api/overview?range=7d&test=1", { cookie: owner });
    expect(withTest.json.kpis.applications).toBe(without.json.kpis.applications + 1);
    expect(withTest.json.kpis.visitors).toBe(without.json.kpis.visitors + 1);
    const leads = await call("/admin/api/leads?range=7d", { cookie: owner });
    expect(leads.json.rows.some((r: Row) => String(r.email).endsWith("@example.com"))).toBe(false);
    const found = await call("/admin/api/leads?q=qa%40example", { cookie: owner });
    expect(found.json.rows.length).toBe(1);
    expect(found.json.rows[0].is_test).toBe(1);
  });
});

// ── Test data ────────────────────────────────────────────────────────────────

describe("test data", () => {
  it("rules: addresses, ?test=1, admin browsers, internal IPs; a person's 'not test' sticks", async () => {
    expect(isTestEmail("a@example.org")).toBe(true);
    expect(isTestEmail("a+test@gmail.com")).toBe(true);
    expect(isTestEmail("a@example.co")).toBe(false);
    expect(isTestQuery("utm_source=x&test=1")).toBe(true);
    expect(isTestQuery("contest=10")).toBe(false);
    const rt = await rtFor();
    const v1 = vid(), v2 = vid(), v3 = vid();
    insertSession(v1, { landing_query: "test=1&utm_source=fb", started_at: NOW - H });
    insertSession(v2, { started_at: NOW - H });
    insertSession(v3, { started_at: NOW - H, ip_hash: (await sessionIpHash(rt, "203.0.113.9")) as string });
    db.x("INSERT INTO test_visitors (visitor_id, reason, created_at) VALUES (?, 'admin', ?)", v2, NOW);
    const a = insertLead({ visitor_id: v1, created_at: NOW - H, email: "x1@acme.io" });
    const b = insertLead({ visitor_id: v2, created_at: NOW - H, email: "x2@acme.io" });
    const c = insertLead({ visitor_id: v3, created_at: NOW - H, email: "x3@acme.io" });
    expect(await isTestLead(rt, a)).toBe(true);
    expect(await isTestLead(rt, b)).toBe(true);
    expect(await isTestLead(rt, c)).toBe(false);
    const rt2 = await rtFor({ INTERNAL_IP_HASHES: (await sessionIpHash(rt, "203.0.113.9")) as string });
    expect(await isTestLead(rt2, c)).toBe(true);
    await setTestFlag(rt2, c, false, "owner");
    expect(await isTestLead(rt2, c)).toBe(false);
    expect(await sweepTestData(rt2)).toBe(2);
    expect(db.q("SELECT is_test FROM lead_revops WHERE lead_id = ?", c)[0].is_test).toBe(0);
  });
  it("test leads get no emails or calls from an outcome; purge erases them (owner only)", async () => {
    const owner = await makeSession(env as never, NOW);
    const t = insertLead({ email: "demo@example.com", status: "booked", call_at: NOW - H, booked_at: NOW - DAY, tier: "A" });
    const r = await call(`/admin/api/calls/held`, { method: "POST", cookie: owner, body: { lead_id: t, offer_made: "no" } });
    expect(r.status).toBe(200);
    expect(db.q("SELECT COUNT(*) AS n FROM emails WHERE lead_id = ?", t)[0].n).toBe(0);
    insertRep("r1", "Cleo");
    db.x("INSERT INTO users (id, email, name, role, active, created_at) VALUES ('u0000000000000000002','m@acme.io','M','manager',1,1)");
    const mgr = await makeUserSession(env as never, "u0000000000000000002", NOW);
    expect((await call("/admin/api/test-data/purge", { method: "POST", cookie: mgr, body: { confirm: "PURGE" } })).status).toBe(403);
    const p = await call("/admin/api/test-data/purge", { method: "POST", cookie: owner, body: { confirm: "PURGE" } });
    expect(p.json.erased).toBe(1);
    expect(db.q("SELECT COUNT(*) AS n FROM leads WHERE id = ?", t)[0].n).toBe(0);
  });
  it("Today, the pipeline and the escalation ladder leave test leads out", async () => {
    const owner = await makeSession(env as never, NOW);
    insertLead({ email: "x@example.net", tier: "A", app_completed_at: NOW - 10 * MIN, status: "applied" });
    const real = insertLead({ email: "r@acme.io", tier: "A", app_completed_at: NOW - 10 * MIN, status: "applied" });
    const today = await call("/admin/api/today", { cookie: owner });
    expect(today.json.fresh.map((r: Row) => r.id)).toEqual([real]);
    const esc = await runEscalations(await rtFor());
    expect(esc.pinged).toBe(1);
  });
});

// ── Launch readiness ─────────────────────────────────────────────────────────

describe("launch readiness", () => {
  it("cue point against the film", () => {
    expect(ctaCheck(0, 540, null).ok).toBe(false);
    expect(ctaCheck(600, 540, null).ok).toBe(false);
    expect(ctaCheck(312, 540, 300).ok).toBe(false);
    expect(ctaCheck(312, 540, 700).ok).toBe(false);
    expect(ctaCheck(312, 540, 545).ok).toBe(true);
  });
  it("red bar only when ads spend while a required check fails; managers see it, closers do not", async () => {
    const owner = await makeSession(env as never, NOW);
    let r = await call("/admin/api/readiness", { cookie: owner });
    expect(r.json.red).toBe(false);
    expect(r.json.required_failing).toBeGreaterThan(0);
    db.x("INSERT INTO ad_spend (platform, date, ad_id, spend, updated_at) VALUES ('meta', '2026-10-12', 'ad1', 120, 1)");
    r = await call("/admin/api/readiness", { cookie: owner });
    expect(r.json.red).toBe(true);
    insertRep("r1", "Cleo");
    db.x("INSERT INTO users (id, email, name, role, rep_id, active, created_at) VALUES ('u0000000000000000003','c@acme.io','C','closer','r1',1,1)");
    const closer = await makeUserSession(env as never, "u0000000000000000003", NOW);
    expect((await call("/admin/api/readiness", { cookie: closer })).status).toBe(403);
  });
  it("manual confirmations are owner-only; go live skips the stale backlog", async () => {
    const owner = await makeSession(env as never, NOW);
    expect((await call("/admin/api/readiness/confirm", { method: "POST", cookie: owner, body: { key: "PRIVACY_REVIEWED", value: true } })).status).toBe(200);
    clearSettingsCache();
    const r = await call("/admin/api/readiness", { cookie: owner });
    expect(r.json.checks.find((c: Row) => c.id === "privacy_reviewed").ok).toBe(true);
    expect((await call("/admin/api/readiness/confirm", { method: "POST", cookie: owner, body: { key: "RESEND_API_KEY", value: true } })).status).toBe(400);
    const l = insertLead({});
    db.x("INSERT INTO emails (id, lead_id, sequence, step, template, send_at, status, created_at) VALUES ('m1', ?, 'tier_a', 0, 'ta_1', ?, 'pending', 1)", l, NOW - 3 * H);
    db.x("INSERT INTO emails (id, lead_id, sequence, step, template, send_at, status, created_at) VALUES ('m2', ?, 'tier_a', 1, 'ta_2', ?, 'pending', 1)", l, NOW - 10 * MIN);
    expect(await skipBacklog(await rtFor(), H)).toBe(1);
    expect(db.q("SELECT id, status FROM emails ORDER BY id").map((x) => x.status)).toEqual(["skipped", "pending"]);
  });
});

// ── Escalation ladder ────────────────────────────────────────────────────────

describe("escalation ladder", () => {
  it("sales hours: the clock pauses overnight and at the weekend", () => {
    const h = parseSalesHours("Mon-Fri 09:00-18:00");
    // Friday 16 Oct 17:55 Oslo → Monday 19 Oct 09:05 Oslo: 5 + 5 minutes.
    const fri = Date.UTC(2026, 9, 16, 15, 55), mon = Date.UTC(2026, 9, 19, 7, 5);
    expect(businessMs(fri, mon, "Europe/Oslo", h)).toBe(10 * MIN);
    expect(inSalesHours(NOW, "Europe/Oslo", h)).toBe(true);
    expect(parseSalesHours("24/7").always).toBe(true);
    expect([...parseSalesHours("Mon-Sat 08:30-17:00").days].sort()).toEqual([1, 2, 3, 4, 5, 6]);
    expect([slaLevel(4 * MIN), slaLevel(6 * MIN), slaLevel(31 * MIN), slaLevel(3 * H)]).toEqual([0, 1, 2, 3]);
  });
  it("pings each rung once, then offers a signed reassign that rotates to the next rep", async () => {
    env.SLACK_WEBHOOK_URL = "https://hooks.slack.com/services/T000/B000/XYZ";
    insertRep("r1", "Cleo", "A,B", "U01");
    insertRep("r2", "Dan", "A,B", "U02");
    const id = insertLead({ tier: "A", closer_id: "r1", app_completed_at: NOW - 6 * MIN, first_name: "Ann" });
    expect((await runEscalations(await rtFor())).pinged).toBe(1);
    expect((await runEscalations(await rtFor())).pinged).toBe(0);
    expect(db.q("SELECT level FROM lead_escalations WHERE lead_id = ?", id).map((r) => r.level)).toEqual([1]);
    db.x("UPDATE leads SET app_completed_at = ? WHERE id = ?", NOW - 150 * MIN, id);
    fetchMock.mockClear();
    expect((await runEscalations(await rtFor())).pinged).toBe(1);
    expect(db.q("SELECT level FROM lead_escalations WHERE lead_id = ? ORDER BY level", id).map((r) => r.level)).toEqual([1, 2, 3]);
    const body = String((fetchMock.mock.calls[0] as unknown[])[1] && ((fetchMock.mock.calls[0] as unknown[])[1] as { body: string }).body);
    const m = /#reassign=([^|>"\\]+)/.exec(body);
    expect(m).toBeTruthy();
    const token = decodeURIComponent(m![1]);
    expect(await verifyReassignToken(await rtFor(), token)).toBe(id);
    expect(await verifyReassignToken(await rtFor(), token.replace(/.$/, (c) => (c === "a" ? "b" : "a")))).toBeNull();
    const owner = await makeSession(env as never, NOW);
    const prev = await call(`/admin/api/reassign?token=${encodeURIComponent(token)}`, { cookie: owner });
    expect(prev.json.next.name).toBe("Dan");
    const r = await call("/admin/api/reassign", { method: "POST", cookie: owner, body: { token } });
    expect(r.json.closer.id).toBe("r2");
    expect(db.q("SELECT closer_id FROM leads WHERE id = ?", id)[0].closer_id).toBe("r2");
  });
  it("a touched lead never escalates; tokens expire", async () => {
    const id = insertLead({ tier: "B", app_completed_at: NOW - 40 * MIN });
    db.x("INSERT INTO touches (id, lead_id, kind, at) VALUES ('t1', ?, 'dial', ?)", id, NOW - 30 * MIN);
    expect((await runEscalations(await rtFor())).pinged).toBe(0);
    const tok = await reassignToken(await rtFor(), id);
    vi.setSystemTime(NOW + 25 * H);
    const later = { ...(await rtFor()), now: () => NOW + 25 * H };
    expect(await verifyReassignToken(later, tok)).toBeNull();
  });
  it("Today merges the same person and colours by business time", async () => {
    const owner = await makeSession(env as never, NOW);
    const v = vid();
    insertLead({ tier: "A", email: "ada@acme.io", app_completed_at: NOW - 40 * MIN, visitor_id: v });
    insertLead({ tier: "A", email: "ada+2@acme.io", app_completed_at: NOW - 3 * MIN });
    const today = await call("/admin/api/today", { cookie: owner });
    expect(today.json.fresh.length).toBe(1);
    expect(today.json.fresh[0].also.length).toBe(1);
    expect(today.json.fresh[0].sla_level).toBe(2);
    expect(baseEmail("Ada+X@Acme.io")).toBe("ada@acme.io");
    const g = groupSamePerson([
      { id: "a", applied_at: 1, email: "a@x.io", raw_phone: "+4711", visitor_id: null, waiting_ms: 0 },
      { id: "b", applied_at: 2, email: "b@x.io", raw_phone: "+47 11", visitor_id: null, waiting_ms: 0 },
      { id: "c", applied_at: 3, email: "c@x.io", raw_phone: null, visitor_id: null, waiting_ms: 0 },
    ]);
    expect(g.length).toBe(2);
  });
});

// ── Held calls, plans and closer KPIs ────────────────────────────────────────

describe("held calls and written plans", () => {
  it("validates the review and the plan", () => {
    expect(() => cleanReview({})).toThrow(CallError);
    expect(cleanReview({ offer_made: "yes", qa_score: "4" })).toMatchObject({ offer_made: true, qa_score: 4 });
    expect(() => cleanReview({ offer_made: "no", recording_url: "http://x.io/a" })).toThrow(CallError);
    expect(() => cleanReview({ offer_made: "no", qa_score: 6 })).toThrow(CallError);
    expect(() => cleanPlan({ first_build: "x" }, NOW)).toThrow(PlanError);
    expect(cleanPlan({ first_build: " Quote tool ", next_step: "Decide", next_step_at: "2026-10-20" }, NOW)).toMatchObject({ first_build: "Quote tool", next_step_at: Date.UTC(2026, 9, 20) });
  });
  it("signs plan tokens", async () => {
    const rt = await rtFor();
    const t = await newPlanToken(rt);
    expect(await verifyPlanToken(rt, t)).toBe(true);
    expect(await verifyPlanToken(rt, t.slice(0, -1) + (t.endsWith("0") ? "1" : "0"))).toBe(false);
    expect(await verifyPlanToken(rt, "l0000000000000000001")).toBe(false);
    const v = planView({ first_build: "<b>x</b>", why: null, keep: null, next_step: "y", next_step_at: null, price: null, plan: null }, { first_name: "Ann Lee", call_at: NOW, timezone: null }, "Cleo", "Europe/Oslo");
    expect(v.first_name).toBe("Ann");
    expect(v.first_build).toBe("<b>x</b>"); // escaped by HTMLRewriter's setInnerContent (text), never as HTML
  });
  it("showed with a plan: review stored, plan saved, recap moved to ~2 h after the call", async () => {
    const owner = await makeSession(env as never, NOW);
    const id = insertLead({ status: "booked", call_at: NOW - 30 * MIN, booked_at: NOW - 3 * DAY, tier: "A", first_name: "Ann" });
    const bad = await call("/admin/api/calls/held", { method: "POST", cookie: owner, body: { lead_id: id } });
    expect(bad.status).toBe(422);
    const r = await call("/admin/api/calls/held", { method: "POST", cookie: owner, body: {
      lead_id: id, offer_made: "yes", qa_score: 4, objection: "Price", recording_url: "https://rec.example/1",
      plan: { first_build: "Quote follow-up tool", why: "We lose 30% of quotes", next_step: "Decide with partner", next_step_at: "2026-10-20" },
    } });
    expect(r.status).toBe(200);
    expect(r.json.plan.url).toMatch(/^https:\/\/hq\.example\.com\/plan\/[0-9a-f]{24}\.[0-9a-f]{20}$/);
    const lead = db.q("SELECT status, objection, target_business, follow_up_at FROM leads WHERE id = ?", id)[0];
    expect(lead).toMatchObject({ status: "showed", objection: "Price", target_business: "Quote follow-up tool", follow_up_at: Date.UTC(2026, 9, 20) });
    expect(db.q("SELECT offer_made, qa_score FROM call_reviews WHERE lead_id = ?", id)[0]).toMatchObject({ offer_made: 1, qa_score: 4 });
    const recap = db.q("SELECT send_at FROM emails WHERE lead_id = ? AND sequence = 'post_call' AND step = 0", id)[0];
    expect(recap.send_at).toBe(NOW - 30 * MIN + 2 * H);
    const next = db.q("SELECT send_at FROM emails WHERE lead_id = ? AND sequence = 'post_call' AND step = 1", id)[0];
    expect(Number(next.send_at)).toBeGreaterThanOrEqual(Number(recap.send_at) + 12 * H);
    const d = await call(`/admin/api/leads/${id}`, { cookie: owner });
    expect(d.json.plan.body.first_build).toBe("Quote follow-up tool");
    expect(d.json.review.offer_made).toBe(1);
  });
  it("showed without a plan: the neutral recap goes after 24 h", async () => {
    const owner = await makeSession(env as never, NOW);
    const id = insertLead({ status: "booked", call_at: NOW - H, booked_at: NOW - 3 * DAY, tier: "B" });
    await call("/admin/api/calls/held", { method: "POST", cookie: owner, body: { lead_id: id, offer_made: "no" } });
    expect(db.q("SELECT send_at FROM emails WHERE lead_id = ? AND sequence = 'post_call' AND step = 0", id)[0].send_at).toBe(NOW - H + 24 * H);
  });
  it("fu_recap never claims a feeling, and links the plan only when one exists and the link is signed", () => {
    const base = { id: "l0000000000000000099", first_name: "Ann", answers: "{}", status: "showed", booking_source: "funnel", showed_at: NOW } as unknown as Lead;
    const ctx = (lead: Lead, signed: boolean): EmailCtx => ({
      lead, d: buildDossier(lead), firstName: "Ann", bookPath: "/book", callTime: null, closerName: "Cleo", sigName: "Cleo", now: NOW,
      link: (p) => (signed || !p.startsWith("/plan/") ? `https://x/r/m1/sig?u=${encodeURIComponent(p)}` : "https://x/r/m1/sig?u=%2F"),
      a: (p, l) => `<a href="${p}">${l}</a>`,
    });
    const generic = TEMPLATES.fu_recap(ctx(base, true));
    expect(JSON.stringify(generic)).not.toMatch(/enjoy/i);
    const withPlan = { ...base, target_business: "Quote tool" } as Lead;
    expect(TEMPLATES.fu_recap(ctx(withPlan, true)).subject).toBe("Your written plan from the call");
    expect(TEMPLATES.fu_recap(ctx(withPlan, true)).cta?.path).toBe("/plan/for/l0000000000000000099");
    expect(TEMPLATES.fu_recap(ctx(withPlan, false)).subject).toBe(generic.subject); // link not signed yet: no plan claim
  });
  it("closer KPIs: offer %, close % of offers, cash on call, cycle, $ per call held", () => {
    const k = closerKpis([
      { id: "a", closer_id: "r1", status: "won", call_at: 0, booked_at: 0, closed_at: 0, cash_collected: 9000, offer_made: 1, qa: 5, cash24: 3000 },
      { id: "b", closer_id: "r1", status: "showed", call_at: 0, booked_at: 0, closed_at: null, cash_collected: 0, offer_made: 1, qa: 3, cash24: 0 },
      { id: "c", closer_id: "r1", status: "lost", call_at: 0, booked_at: 0, closed_at: 0, cash_collected: 0, offer_made: 0, qa: null, cash24: 0 },
      { id: "d", closer_id: "r1", status: "showed", call_at: 0, booked_at: 0, closed_at: null, cash_collected: 0, offer_made: null, qa: null, cash24: 0 },
    ], [{ closer_id: "r1", booked_at: 0, closed_at: 4 * DAY }, { closer_id: "r1", booked_at: 0, closed_at: 10 * DAY }]).get("r1")!;
    expect(k).toMatchObject({ held: 4, reviewed: 3, offers: 2, offer_rate: 66.7, won_of_offers: 1, close_of_offers: 50, cash_on_call: 3000, cycle_days: 7, per_call_held: 2250, qa_avg: 4 });
    expect(weekKey(NOW, "Europe/Oslo")).toBe("2026-10-12");
  });
});

// ── Small fixes ──────────────────────────────────────────────────────────────

describe("small fixes", () => {
  it("drawer follows a merged lead and explains an erased one", async () => {
    const owner = await makeSession(env as never, NOW);
    const a = insertLead({ created_at: NOW - 5 * DAY, first_name: "Ann", phone: "+4790000001" });
    const b = insertLead({ created_at: NOW - DAY, first_name: "Ann", phone: "+4790000001" });
    expect((await call(`/admin/api/leads/${b}/merge`, { method: "POST", cookie: owner, body: { into: a } })).status).toBe(200);
    expect((await call(`/admin/api/leads/${b}`, { cookie: owner })).json.moved_to).toBe(a);
    const ref = String(db.q("SELECT ref_code FROM leads WHERE id = ?", a)[0].ref_code);
    expect((await call(`/admin/api/leads/${a}`, { method: "DELETE", cookie: owner, body: { confirm: ref } })).status).toBe(200);
    expect((await call(`/admin/api/leads/${a}`, { cookie: owner })).json.gone).toBe(true);
    const log = await call("/admin/api/audit", { cookie: owner });
    expect(log.json.rows.find((r: Row) => r.action === "lead_merge").lead_state).toBe("erased");
  });
  it("email labels: short sequence names, trigger timing in words, subjects, de-duplicated queue", () => {
    expect(sequenceName("tier_a")).toBe("A tier");
    expect(sequenceName("post_call")).toBe("Post-call follow-up");
    expect(triggerWhen("t_watch_prep", 0)).toBe("12 h after booking");
    expect(triggerWhen("t_vsl_no_apply", 30)).toBe("30 min after watching half the film");
    const subj = templateSubjects();
    expect(subj.size).toBe(Object.keys(TEMPLATES).length);
    expect(subj.get("fu_recap")).toBe("Thanks for the call today");
    const q = groupQueue([
      { email: "ada+1@x.io", name: "Ada", template: "ta_1", send_at: 0 },
      { email: "ada+2@x.io", name: "Ada", template: "ta_1", send_at: 60_000 },
      { email: "bo@x.io", name: "Bo", template: "ta_1", send_at: 0 },
    ]);
    expect(q.map((r) => r.count)).toEqual([2, 1]);
  });
  it("the admin's browser is marked as ours on /me", async () => {
    const owner = await makeSession(env as never, NOW);
    const v = vid();
    await call("/admin/api/me", { headers: { cookie: `_fa=${owner}; _fv=${v}` } });
    expect(db.q("SELECT reason FROM test_visitors WHERE visitor_id = ?", v)[0].reason).toBe("admin");
  });
  it("sales scoreboard carries the closer KPIs and the weekly objections", async () => {
    const owner = await makeSession(env as never, NOW);
    insertRep("r1", "Cleo");
    const id = insertLead({ closer_id: "r1", status: "lost", call_at: NOW - 2 * DAY, showed_at: NOW - 2 * DAY, closed_at: NOW - DAY, objection: "Timing", lost_reason: "Timing" });
    db.x("INSERT INTO call_reviews (id, lead_id, call_at, offer_made, created_at) VALUES ('cr1', ?, ?, 1, ?)", id, NOW - 2 * DAY, NOW - 2 * DAY);
    const s = await call("/admin/api/sales?range=30d", { cookie: owner });
    const rep = s.json.reps.find((r: Row) => r.id === "r1");
    expect(rep.kpi).toMatchObject({ held: 1, offers: 1, reviewed: 1 });
    expect(s.json.objections.series[0].objection).toBe("Timing");
    expect(s.json.team_kpi.offer_rate).toBe(100);
  });
});
