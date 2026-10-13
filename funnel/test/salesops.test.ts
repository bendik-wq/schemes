// Round 2 sales operations: roles and sessions, magic links, audit log, receivables, pipeline and forecast,
// Today and touches, dedupe/merge, learned scoring hook, attribution and cohorts, API keys, signed webhooks.
// Integration tests run the real route handlers against a D1 shim over node:sqlite with every migration applied.

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { Hono } from "hono";
import type { AppEnv } from "../src/app";
import { makeRuntime } from "../src/app";
import { clearSettingsCache } from "../src/settings";
import { resetSecretCache } from "../src/lib/secret";
import {
  BREAKGLASS, canAccess, consumeMagicLink, createMagicLink, leadVisible, makeSession, makeUserSession, repScope, requireAdmin, sessionUser,
} from "../src/admin/auth";
import { adminApi } from "../src/routes/admin";
import { hqPublic } from "../src/routes/hq-public";
import { v1, makeCursor, parsePage } from "../src/routes/v1";
import { diff } from "../src/admin/audit";
import { addMonths, planCount, planSchedule } from "../src/sales/receivables";
import { FALLBACK_P, forecastMonth, monthWindows, movePatch, stageOf, stageProbs, type PipeLead } from "../src/sales/pipeline";
import { cleanTouch, keyAnswers, predictObjections, speedStats, TouchError } from "../src/sales/today";
import { findDuplicates, mergePatch, type DupLead } from "../src/admin/dedupe";
import {
  LEARNED_MIN_N, parseLearnedPoints, scoreApplication, useLearnedPoints, matchesExcludedIndustry, emailDomain, isBlocked,
  type ScoreContext, type ScoreLine, type ScoreResult,
} from "../src/funnel/scoring";
import { learnedFromReport } from "../src/sales/calibration";
import { APPLICATION, PERSONAL_EMAIL_DOMAINS, TARGET_COUNTRIES, TIER_RULES, TIER_THRESHOLDS, type Question, type Tier } from "../src/config";
import { attribute, cohortTable, creditWeights, topPaths, type AttrLead } from "../src/admin/attribution";
import { signatureHeader, validWebhookUrl, verifySignatureHeader } from "../src/integrations/webhooks";
import { keyId } from "../src/admin/api-keys";
import { outcomeLink, verifyOutcomeLink } from "../src/sales/outcome-link";
import type { Lead } from "../src/funnel/leads";
import type { Runtime } from "../src/app";

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
const H = 3_600_000, DAY = 24 * H;
let db: Shim;
let env: Record<string, unknown>;
let seq = 0;
const lid = () => "l" + String(++seq).padStart(19, "0");

function insertLead(f: Row): string {
  const id = (f.id as string) || lid();
  const row: Row = { id, ref_code: "OP-" + id.slice(-6).toUpperCase(), created_at: NOW - 10 * DAY, updated_at: NOW - 10 * DAY, email: `${id}@acme.example`, status: "applied", ...f };
  const keys = Object.keys(row);
  db.x(`INSERT INTO leads (${keys.join(",")}) VALUES (${keys.map(() => "?").join(",")})`, ...keys.map((k) => row[k]));
  return id;
}
function insertRep(id: string, name: string, role = "closer", target = 0) {
  db.x("INSERT INTO reps (id, name, role, tiers, weight, monthly_target, active, created_at) VALUES (?,?,?,?,?,?,1,?)", id, name, role, "A,B", 1, target, NOW - 100 * DAY);
}
function insertUser(id: string, email: string, role: string, rep: string | null = null, active = 1) {
  db.x("INSERT INTO users (id, email, name, role, rep_id, active, created_at) VALUES (?,?,?,?,?,?,?)", id, email, email.split("@")[0], role, rep, active, NOW - 50 * DAY);
}

async function rtFor(): Promise<Runtime> {
  const rt = await makeRuntime(env as never, null, "https://hq.example.com/");
  return { ...rt, now: () => NOW };
}

function testApp() {
  const app = new Hono<AppEnv>();
  app.use("*", async (c, next) => { c.set("rt", await makeRuntime(c.env, null, c.req.url)); await next(); });
  app.route("/", hqPublic);
  app.use("/admin/api/*", requireAdmin);
  app.route("/admin/api", adminApi);
  app.route("/api/v1", v1);
  return app;
}
const ORIGIN = "https://hq.example.com";
async function call(path: string, o: { method?: string; cookie?: string; body?: unknown; crossSite?: boolean; headers?: Record<string, string> } = {}) {
  const headers: Record<string, string> = { ...(o.headers || {}) };
  if (o.cookie) headers.cookie = `_fa=${o.cookie}`;
  if (o.method && o.method !== "GET") { headers["sec-fetch-site"] = o.crossSite ? "cross-site" : "same-origin"; headers.origin = o.crossSite ? "https://evil.example" : ORIGIN; }
  if (o.body !== undefined) headers["content-type"] = "application/json";
  const res = await testApp().request(ORIGIN + path, { method: o.method || "GET", headers, body: o.body === undefined ? undefined : JSON.stringify(o.body) }, env);
  const text = await res.text();
  let json: any = null;
  try { json = JSON.parse(text); } catch { json = null; }
  return { status: res.status, json, text, headers: res.headers };
}

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
  clearSettingsCache();
  resetSecretCache();
  useLearnedPoints(null);
  db = await makeDb();
  env = { DB: db, ADMIN_PASSWORD: "correct horse battery staple", SESSION_SECRET: "test-secret-" + "x".repeat(40) };
  vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", { status: 200 })));
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  useLearnedPoints(null);
  clearSettingsCache();
});

// ── Schema ───────────────────────────────────────────────────────────────────

describe("migrations 0018/0019", () => {
  it("apply cleanly and keep every table under D1's 100-column limit", () => {
    const tables = db.q("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'").map((r) => String(r.name));
    for (const t of ["receivables", "users", "audit_log", "touches", "api_keys", "webhook_subscriptions"]) expect(tables).toContain(t);
    for (const t of tables) expect(db.q(`SELECT COUNT(*) AS n FROM pragma_table_info('${t}')`)[0].n as number).toBeLessThan(100);
    expect(db.q("SELECT COUNT(*) AS n FROM pragma_table_info('leads')")[0].n).toBe(96); // untouched by this round
  });
  it("constrains roles, touch kinds and receivable statuses", () => {
    expect(() => insertUser("u0000000000000000001", "a@x.example", "admin")).toThrow();
    expect(() => db.x("INSERT INTO touches (id, lead_id, kind, at) VALUES ('t1','l1','fax',1)")).toThrow();
    expect(() => db.x("INSERT INTO receivables (id, lead_id, seq, due_at, amount, status, created_at, updated_at) VALUES ('r','l',1,1,1,'late',1,1)")).toThrow();
  });
  it("records the scoring table version on lead_revops from the breakdown", () => {
    const id = insertLead({});
    db.x("UPDATE leads SET score_breakdown = ? WHERE id = ?", JSON.stringify({ lines: [{ id: "model", label: "learned:sm1", points: 0, flags: [] }] }), id);
    expect(db.q("SELECT score_model FROM lead_revops WHERE lead_id = ?", id)[0].score_model).toBe("learned:sm1");
    db.x("UPDATE leads SET score_breakdown = ? WHERE id = ?", JSON.stringify({ lines: [] }), id);
    expect(db.q("SELECT score_model FROM lead_revops WHERE lead_id = ?", id)[0].score_model).toBe("config");
  });
});

// ── Roles and sessions ───────────────────────────────────────────────────────

describe("role gates", () => {
  it("closers and setters reach only their workspace", () => {
    for (const r of ["closer", "setter"]) {
      expect(canAccess(r, "GET", "/today")).toBe(true);
      expect(canAccess(r, "GET", "/pipeline")).toBe(true);
      expect(canAccess(r, "POST", "/pipeline/move")).toBe(true);
      expect(canAccess(r, "GET", "/leads/l0000000000000000001")).toBe(true);
      expect(canAccess(r, "POST", "/leads/l0000000000000000001/touches")).toBe(true);
      for (const [m, p] of [["GET", "/integrations"], ["PUT", "/integrations"], ["GET", "/team"], ["GET", "/users"], ["DELETE", "/leads/l0000000000000000001"],
        ["GET", "/leads.csv"], ["GET", "/exports/payments.csv"], ["GET", "/audit"], ["POST", "/calibration/run"], ["GET", "/overview"], ["POST", "/leads/l0000000000000000001/merge"], ["GET", "/api-keys"]]) {
        expect(canAccess(r, m, p)).toBe(false);
      }
    }
  });
  it("viewers read but never write, and cannot see settings, people or exports", () => {
    expect(canAccess("viewer", "GET", "/overview")).toBe(true);
    expect(canAccess("viewer", "GET", "/leads")).toBe(true);
    for (const p of ["/integrations", "/users", "/audit", "/api-keys", "/webhooks", "/exports/calls.csv", "/leads.csv"]) expect(canAccess("viewer", "GET", p)).toBe(false);
    for (const m of ["POST", "PATCH", "PUT", "DELETE"]) expect(canAccess("viewer", m, "/leads/l0000000000000000001")).toBe(false);
    expect(canAccess("viewer", "POST", "/logout")).toBe(true);
    expect(canAccess("nobody", "GET", "/overview")).toBe(false);
  });
  it("scopes reps to their own leads and fails closed without a rep", () => {
    const closer = { id: "u", email: null, name: "C", role: "closer" as const, rep_id: "r1", breakglass: false };
    expect(repScope(closer)).toBe("r1");
    expect(leadVisible(closer, { closer_id: "r1", setter_id: null })).toBe(true);
    expect(leadVisible(closer, { closer_id: null, setter_id: "r1" })).toBe(true);
    expect(leadVisible(closer, { closer_id: "r2", setter_id: null })).toBe(false);
    expect(leadVisible({ ...closer, rep_id: null }, { closer_id: null, setter_id: null })).toBe(false);
    expect(repScope(BREAKGLASS)).toBeUndefined();
    expect(repScope(null)).toBeNull();
  });
});

describe("sessions", () => {
  it("the round-1 password session still works and means owner", async () => {
    const tok = await makeSession(env as never, NOW);
    expect((await sessionUser(env as never, tok, NOW))?.role).toBe("owner");
    expect(await sessionUser(env as never, tok, NOW + 4 * DAY)).toBeNull();
    expect(await sessionUser({ ...env, ADMIN_PASSWORD: "changed" } as never, tok, NOW)).toBeNull();
  });
  it("user sessions carry the user's role, and die when the user is deactivated or the epoch moves", async () => {
    insertRep("r1", "Cleo");
    insertUser("u0000000000000000001", "cleo@acme.example", "closer", "r1");
    const tok = await makeUserSession(env as never, "u0000000000000000001", NOW);
    const u = await sessionUser(env as never, tok, NOW);
    expect(u?.role).toBe("closer");
    expect(u?.rep_id).toBe("r1");
    expect(await sessionUser(env as never, tok.replace(/.$/, (c) => (c === "0" ? "1" : "0")), NOW)).toBeNull();
    db.x("UPDATE users SET active = 0 WHERE id = 'u0000000000000000001'");
    expect(await sessionUser(env as never, tok, NOW)).toBeNull();
    db.x("UPDATE users SET active = 1 WHERE id = 'u0000000000000000001'");
    db.x("INSERT INTO kv_state (key, value, updated_at) VALUES ('admin:epoch', '99', 1)");
    expect(await sessionUser(env as never, tok, NOW)).toBeNull();
  });
});

describe("magic links", () => {
  beforeEach(() => insertUser("u0000000000000000002", "mia@acme.example", "manager"));
  it("are signed, single use and expire after 15 minutes", async () => {
    const r = await createMagicLink(env as never, ORIGIN, "Mia@Acme.example ", "203.0.113.5", NOW);
    expect(r.ok && r.url).toBeTruthy();
    const t = new URL(r.url!).searchParams.get("t")!;
    expect(await consumeMagicLink(env as never, t, NOW + 16 * 60_000)).toBeNull(); // expired (and not consumed)
    expect(await consumeMagicLink(env as never, t.slice(0, -2) + "00", NOW)).toBeNull(); // forged
    expect(await consumeMagicLink(env as never, t, NOW + 60_000)).toBe("u0000000000000000002");
    expect(await consumeMagicLink(env as never, t, NOW + 61_000)).toBeNull(); // used
  });
  it("say nothing about unknown addresses and are rate-limited", async () => {
    const r = await createMagicLink(env as never, ORIGIN, "stranger@acme.example", "203.0.113.6", NOW);
    expect(r).toEqual({ ok: true, status: 200 });
    for (let i = 0; i < 3; i++) expect((await createMagicLink(env as never, ORIGIN, "mia@acme.example", "203.0.113.7", NOW)).ok).toBe(true);
    expect((await createMagicLink(env as never, ORIGIN, "mia@acme.example", "203.0.113.8", NOW)).status).toBe(429);
  });
  it("sign in through the confirm page and set a user session", async () => {
    const r = await createMagicLink(env as never, ORIGIN, "mia@acme.example", "203.0.113.9", NOW);
    const t = new URL(r.url!).searchParams.get("t")!;
    const page = await call(`/admin/login/magic?t=${encodeURIComponent(t)}`);
    expect(page.status).toBe(200);
    expect(page.text).not.toContain("<script");
    const res = await testApp().request(ORIGIN + "/admin/login/magic", { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded", "sec-fetch-site": "same-origin", origin: ORIGIN }, body: "t=" + encodeURIComponent(t) }, env);
    expect(res.status).toBe(303);
    const cookie = /_fa=([^;]+)/.exec(res.headers.get("set-cookie") || "")![1];
    const me = await call("/admin/api/me", { cookie });
    expect(me.json.user.role).toBe("manager");
    expect(db.q("SELECT action FROM audit_log WHERE action = 'login'").length).toBe(1);
  });
});

// ── Enforcement through the real routes ──────────────────────────────────────

describe("admin API with roles", () => {
  let owner: string, closer: string, viewer: string;
  let mine: string, theirs: string;
  beforeEach(async () => {
    insertRep("r1", "Cleo"); insertRep("r2", "Dan");
    insertUser("u0000000000000000011", "cleo@acme.example", "closer", "r1");
    insertUser("u0000000000000000012", "vic@acme.example", "viewer");
    owner = await makeSession(env as never, NOW);
    closer = await makeUserSession(env as never, "u0000000000000000011", NOW);
    viewer = await makeUserSession(env as never, "u0000000000000000012", NOW);
    mine = insertLead({ closer_id: "r1", status: "booked", call_at: NOW + 2 * H, booked_at: NOW - DAY, first_name: "Ann" });
    theirs = insertLead({ closer_id: "r2", status: "booked", call_at: NOW + 3 * H, booked_at: NOW - DAY, first_name: "Bob" });
  });
  it("closers see their own leads only", async () => {
    const list = await call("/admin/api/leads?range=all", { cookie: closer });
    expect(list.json.rows.map((r: Row) => r.id)).toEqual([mine]);
    expect((await call(`/admin/api/leads/${theirs}`, { cookie: closer })).status).toBe(404);
    expect((await call(`/admin/api/leads/${mine}`, { cookie: closer })).status).toBe(200);
    expect((await call(`/admin/api/leads/${theirs}`, { method: "PATCH", cookie: closer, body: { notes: "x" } })).status).toBe(404);
    expect((await call("/admin/api/integrations", { cookie: closer })).status).toBe(403);
    expect((await call("/admin/api/team", { cookie: closer })).status).toBe(403);
    expect((await call("/admin/api/leads.csv", { cookie: closer })).status).toBe(403);
    expect((await call(`/admin/api/leads/${mine}`, { method: "DELETE", cookie: closer, body: { confirm: "x" } })).status).toBe(403);
  });
  it("closers cannot hand a lead to another rep", async () => {
    await call(`/admin/api/leads/${mine}`, { method: "PATCH", cookie: closer, body: { closer_id: "r2", notes: "called" } });
    const r = db.q("SELECT closer_id, notes FROM leads WHERE id = ?", mine)[0];
    expect(r.closer_id).toBe("r1");
    expect(r.notes).toBe("called");
  });
  it("viewers cannot write; cross-site writes are refused for everyone", async () => {
    expect((await call(`/admin/api/leads/${mine}`, { method: "PATCH", cookie: viewer, body: { notes: "x" } })).status).toBe(403);
    expect((await call("/admin/api/integrations", { cookie: viewer })).status).toBe(403);
    expect((await call(`/admin/api/leads/${mine}`, { method: "PATCH", cookie: owner, body: { notes: "x" }, crossSite: true })).status).toBe(403);
    expect((await call("/admin/api/me")).status).toBe(401);
  });
  it("writes the audit log: lead changes, payments, setting names (never values), users", async () => {
    await call(`/admin/api/leads/${mine}`, { method: "PATCH", cookie: owner, body: { temperature: "hot" } });
    const p = await call(`/admin/api/leads/${mine}/payments`, { method: "POST", cookie: owner, body: { amount: 500 } });
    await call(`/admin/api/leads/${mine}/payments/${p.json.payment.id}`, { method: "DELETE", cookie: owner });
    await call("/admin/api/integrations", { method: "PUT", cookie: owner, body: { key: "SLACK_WEBHOOK_URL", value: "https://hooks.slack.com/services/T000/B000/SECRETVALUE123" } });
    await call("/admin/api/users", { method: "POST", cookie: owner, body: { email: "new@acme.example", role: "setter", rep_id: "r2" } });
    const rows = db.q("SELECT action, entity, entity_id, before, after, user_id FROM audit_log ORDER BY ts");
    const actions = rows.map((r) => r.action);
    for (const a of ["lead_update", "payment_add", "payment_delete", "setting_set", "user_create"]) expect(actions).toContain(a);
    const lu = rows.find((r) => r.action === "lead_update")!;
    expect(JSON.parse(String(lu.after))).toEqual({ temperature: "hot" });
    expect(lu.user_id).toBe("owner");
    expect(JSON.stringify(rows)).not.toContain("SECRETVALUE123");
    expect(rows.find((r) => r.action === "setting_set")!.entity_id).toBe("SLACK_WEBHOOK_URL");
  });
  it("managers cannot create owners; reps must be linked to a rep", async () => {
    insertUser("u0000000000000000013", "max@acme.example", "manager");
    const mgr = await makeUserSession(env as never, "u0000000000000000013", NOW);
    expect((await call("/admin/api/users", { method: "POST", cookie: mgr, body: { email: "o@acme.example", role: "owner" } })).status).toBe(422);
    expect((await call("/admin/api/users", { method: "POST", cookie: mgr, body: { email: "c@acme.example", role: "closer" } })).status).toBe(422);
    expect((await call("/admin/api/users", { method: "POST", cookie: mgr, body: { email: "c@acme.example", role: "closer", rep_id: "r1" } })).status).toBe(200);
  });
  it("Today shows a closer their calls with a prep card and logs touches", async () => {
    db.x("UPDATE leads SET answers = ?, phone = '+4791234567' WHERE id = ?", JSON.stringify({ readiness: "partner", spend: "under_25k", role: "owner" }), mine);
    const t = await call("/admin/api/today", { cookie: closer });
    expect(t.json.calls.map((c: Row) => c.id)).toEqual([mine]);
    const card = t.json.calls[0];
    expect(card.phone).toBe("+4791234567");
    expect(card.objections.map((o: Row) => o.objection)).toEqual(expect.arrayContaining(["Partner/spouse", "Price"]));
    expect((await call(`/admin/api/leads/${mine}/touches`, { method: "POST", cookie: closer, body: { kind: "dial", outcome: "no_answer" } })).status).toBe(200);
    expect((await call(`/admin/api/leads/${theirs}/touches`, { method: "POST", cookie: closer, body: { kind: "dial" } })).status).toBe(404);
    expect(db.q("SELECT rep_id, kind FROM touches")).toEqual([{ rep_id: "r1", kind: "dial" }]);
  });
});

// ── Receivables ──────────────────────────────────────────────────────────────

describe("receivables", () => {
  it("schedules equal monthly instalments with rounding on the last", () => {
    const s = planSchedule(10000, 3, Date.UTC(2026, 0, 31));
    expect(s.map((x) => x.amount)).toEqual([3333.33, 3333.33, 3333.34]);
    expect(new Date(s[1].due_at).toISOString().slice(0, 10)).toBe("2026-02-28");
    expect(new Date(addMonths(Date.UTC(2026, 10, 15), 2)).toISOString().slice(0, 10)).toBe("2027-01-15");
    expect(planCount({ payment_plan: "full", installments_total: 3 })).toBe(0);
    expect(planCount({ payment_plan: "split_3", installments_total: null })).toBe(3);
    expect(planCount({ payment_plan: "monthly", installments_total: 1 })).toBe(0);
  });
  it("are created on a won plan, paid by payments, unlinked on delete, cancelled on refund", async () => {
    const owner = await makeSession(env as never, NOW);
    const id = insertLead({ status: "showed", call_at: NOW - DAY, showed_at: NOW - DAY, closer_id: "r1" });
    const won = await call("/admin/api/pipeline/move", { method: "POST", cookie: owner, body: { lead_id: id, stage: "won_plan", revenue: 9000, installments: 3 } });
    expect(won.status).toBe(200);
    let rv = db.q("SELECT seq, amount, status FROM receivables WHERE lead_id = ? ORDER BY seq", id);
    expect(rv).toEqual([{ seq: 1, amount: 3000, status: "pending" }, { seq: 2, amount: 3000, status: "pending" }, { seq: 3, amount: 3000, status: "pending" }]);
    const first = db.q("SELECT due_at FROM receivables WHERE lead_id = ? AND seq = 1", id)[0].due_at;
    expect(db.q("SELECT next_payment_at FROM leads WHERE id = ?", id)[0].next_payment_at).toBe(first);
    // A payment recorded on the lead pays the oldest instalment.
    const p = await call(`/admin/api/leads/${id}/payments`, { method: "POST", cookie: owner, body: { amount: 3000 } });
    expect(db.q("SELECT status, paid_payment_id FROM receivables WHERE seq = 1 AND lead_id = ?", id)[0]).toEqual({ status: "paid", paid_payment_id: p.json.payment.id });
    // Mark paid on instalment 3 records a payment and links it.
    const r3 = String(db.q("SELECT id FROM receivables WHERE seq = 3 AND lead_id = ?", id)[0].id);
    expect((await call(`/admin/api/receivables/${r3}/paid`, { method: "POST", cookie: owner, body: {} })).status).toBe(200);
    expect(db.q("SELECT cash_collected FROM leads WHERE id = ?", id)[0].cash_collected).toBe(6000);
    // Due list shows the remaining instalment with its amount.
    const due = await call("/admin/api/receivables?days=90", { cookie: owner });
    expect(due.json.rows.map((r: Row) => [r.seq, r.amount])).toEqual([[2, 3000]]);
    // Deleting the payment puts its instalment back to pending.
    await call(`/admin/api/leads/${id}/payments/${p.json.payment.id}`, { method: "DELETE", cookie: owner });
    expect(db.q("SELECT status FROM receivables WHERE seq = 1 AND lead_id = ?", id)[0].status).toBe("pending");
    // A refund cancels what is still pending.
    await call(`/admin/api/leads/${id}`, { method: "PATCH", cookie: owner, body: { refunded_at: NOW, refund_amount: 3000 } });
    rv = db.q("SELECT seq, status FROM receivables WHERE lead_id = ? ORDER BY seq", id);
    expect(rv.map((r) => r.status)).toEqual(["cancelled", "cancelled", "paid"]);
  });
  it("regenerate pending instalments when the deal changes", async () => {
    const owner = await makeSession(env as never, NOW);
    const id = insertLead({ status: "showed", call_at: NOW - DAY });
    await call("/admin/api/pipeline/move", { method: "POST", cookie: owner, body: { lead_id: id, stage: "won_plan", revenue: 6000, installments: 2 } });
    await call(`/admin/api/leads/${id}/payments`, { method: "POST", cookie: owner, body: { amount: 3000 } });
    await call(`/admin/api/leads/${id}`, { method: "PATCH", cookie: owner, body: { revenue: 12000, installments_total: 4 } });
    const rv = db.q("SELECT seq, amount, status FROM receivables WHERE lead_id = ? ORDER BY seq", id);
    expect(rv).toEqual([{ seq: 1, amount: 3000, status: "paid" }, { seq: 2, amount: 3000, status: "pending" }, { seq: 3, amount: 3000, status: "pending" }, { seq: 4, amount: 3000, status: "pending" }]);
  });
});

// ── Pipeline and forecast ────────────────────────────────────────────────────

const pl = (o: Partial<PipeLead>): PipeLead => ({
  status: "booked", call_at: NOW, booked_at: NOW - DAY, showed_at: null, closed_at: null, payment_plan: null, installments_total: null, revenue: 0,
  cash_collected: 0, refunded_at: null, booking_cancelled_at: null, contract_signed_at: null, pipeline_stage: null, pipeline_stage_at: null, ...o,
});

describe("pipeline", () => {
  it("maps statuses and deal fields to columns", () => {
    expect(stageOf(pl({}))).toBe("booked");
    expect(stageOf(pl({ booking_cancelled_at: 1 }))).toBeNull();
    expect(stageOf(pl({ status: "showed" }))).toBe("held");
    expect(stageOf(pl({ status: "showed", pipeline_stage: "verbal" }))).toBe("verbal");
    expect(stageOf(pl({ status: "showed", contract_signed_at: 1 }))).toBe("verbal");
    expect(stageOf(pl({ status: "won", payment_plan: "split_3", revenue: 9000, cash_collected: 3000 }))).toBe("won_plan");
    expect(stageOf(pl({ status: "won", payment_plan: "split_3", revenue: 9000, cash_collected: 9000 }))).toBe("won_paid");
    expect(stageOf(pl({ status: "won", payment_plan: "full", revenue: 9000 }))).toBe("won_paid");
    expect(stageOf(pl({ status: "won", refunded_at: 1 }))).toBeNull();
    expect(stageOf(pl({ status: "lost" }))).toBeNull();
  });
  it("uses history only for cells with enough outcomes", () => {
    const sv = { computed_at: 0, avg_deal: 20000, n_total: 100, cells: { booking_scheduled: { A: { n: 40, won: 10, p: 0.25, value: 5000 }, B: { n: 5, won: 1, p: 0.2, value: null } }, call_showed: { A: { n: 30, won: 12, p: 0.4, value: 8000 } } } };
    const p = stageProbs(sv as never, { A: { n: 25, won: 20 } }, { A: { n: 50, showed: 40 } }, 0.6);
    expect(p.p.booked.A).toBe(0.25);
    expect(p.source.booked.A).toBe("history");
    expect(p.p.booked.B).toBe(FALLBACK_P.booked.B);
    expect(p.p.held.A).toBe(0.4);
    expect(p.p.verbal.A).toBe(0.8);
    expect(p.show.A).toBe(0.8);
    expect(p.avg_deal).toBe(20000);
    expect(p.cash_share).toBe(0.6);
  });
  it("forecasts commit, expected and best case", () => {
    const probs = stageProbs(null, {}, {}, 0.5);
    const f = forecastMonth({ key: "2026-10", from: 0, to: 1 }, {
      current: true, collected: 1000, scheduled: 2000, target: 50000, probs,
      open: [{ stage: "verbal", tier: "A", value: 10000 }, { stage: "held", tier: "B", value: 20000 }, { stage: "won_paid", tier: "A", value: 99999 }],
      calls: [{ tier: "A", noshow_risk: 0.5 }],
    });
    expect(f.commit).toBe(3000 + 5000);
    const callExp = 0.5 * probs.p.held.A * probs.avg_deal * 0.5;
    expect(f.expected).toBe(Math.round(3000 + 0.7 * 10000 * 0.5 + 0.25 * 20000 * 0.5 + callExp));
    expect(f.best).toBe(Math.round(3000 + 5000 + 10000 + 0.5 * probs.avg_deal * 0.5));
    const next = forecastMonth({ key: "2026-11", from: 0, to: 1 }, { current: false, collected: 0, scheduled: 500, target: 0, probs, open: [{ stage: "verbal", tier: "A", value: 10000 }], calls: [] });
    expect(next.expected).toBe(500);
  });
  it("months follow the sales time zone", () => {
    const m = monthWindows(Date.UTC(2026, 11, 31, 23, 30), "Europe/Oslo");
    expect(m.map((x) => x.key)).toEqual(["2027-01", "2027-02"]);
  });
  it("validates moves", () => {
    const lead = { status: "showed", revenue: 0, payment_plan: null, installments_total: null };
    expect(movePatch("verbal", lead, {})).toEqual({ patch: { status: "showed" }, verbal: true });
    expect(() => movePatch("won_paid", lead, {})).toThrow(/deal value/);
    expect(movePatch("won_paid", lead, { revenue: 5000 }).patch).toEqual({ status: "won", revenue: 5000, payment_plan: "full", installments_total: null });
    expect(() => movePatch("won_plan", lead, { revenue: 5000 })).toThrow(/instalments/);
    expect(movePatch("won_plan", lead, { revenue: 5000, installments: 3 }).patch.payment_plan).toBe("split_3");
    expect(() => movePatch("booked", lead, {})).toThrow();
  });
  it("builds the board and weighted pipeline from the database", async () => {
    insertRep("r1", "Cleo", "closer", 40000);
    const owner = await makeSession(env as never, NOW);
    insertLead({ status: "booked", call_at: NOW + DAY, booked_at: NOW - DAY, tier: "A", closer_id: "r1" });
    const v = insertLead({ status: "showed", call_at: NOW - 2 * DAY, showed_at: NOW - 2 * DAY, tier: "A", revenue: 20000 });
    await call("/admin/api/pipeline/move", { method: "POST", cookie: owner, body: { lead_id: v, stage: "verbal" } });
    const r = await call("/admin/api/pipeline", { cookie: owner });
    const col = (id: string) => r.json.stages.find((s: Row) => s.id === id);
    expect(col("booked").count).toBe(1);
    expect(col("verbal").cards[0].id).toBe(v);
    expect(col("verbal").cards[0].expected).toBe(Math.round(FALLBACK_P.verbal.A * 20000));
    expect(r.json.forecast).toHaveLength(2);
    expect(r.json.forecast[0].target).toBe(40000);
    expect(r.json.weighted).toBeGreaterThan(0);
  });
});

// ── Today ────────────────────────────────────────────────────────────────────

describe("today and touches", () => {
  it("predicts objections from answers", () => {
    const o = predictObjections({ readiness: "partner", timeline: "exploring", spend: "under_25k", revenue: "1m_3m", blockers: ["ai_doubt"] }, 10);
    expect(o.map((x) => x.objection)).toEqual(["Partner/spouse", "Timing", "Price", "Funding doubts"]);
    expect(predictObjections({ role: "owner", readiness: "yes", spend: "300k_plus" }, 90)).toEqual([]);
    expect(keyAnswers({ role: "owner", revenue: "3m_10m" })).toEqual([{ q: "role", a: "Founder or owner" }, { q: "revenue", a: "$3M – $10M" }]);
  });
  it("validates touches", () => {
    expect(cleanTouch({ kind: "connect", outcome: "booked", note: " hi " }, NOW)).toMatchObject({ kind: "connect", outcome: "booked", at: NOW });
    expect(() => cleanTouch({ kind: "fax" }, NOW)).toThrow(TouchError);
    expect(() => cleanTouch({ kind: "dial", outcome: "rude" }, NOW)).toThrow(TouchError);
    expect(() => cleanTouch({ kind: "dial", at: NOW + DAY }, NOW)).toThrow(TouchError);
  });
  it("speed to lead: median and share within 5 minutes", () => {
    expect(speedStats([60_000, 4 * 60_000, 10 * 60_000])).toEqual({ n: 3, median_min: 4, within5_pct: 66.7 });
    expect(speedStats([])).toEqual({ n: 0, median_min: null, within5_pct: null });
  });
  it("speed to lead and setter numbers on the Sales tab", async () => {
    insertRep("s1", "Sam", "setter");
    const owner = await makeSession(env as never, NOW);
    const a = insertLead({ app_completed_at: NOW - 5 * DAY, setter_id: "s1", booked_at: NOW - 4 * DAY, call_at: NOW - 2 * DAY, status: "showed", showed_at: NOW - 2 * DAY });
    db.x("INSERT INTO touches (id, lead_id, rep_id, kind, at) VALUES ('t1', ?, 's1', 'dial', ?)", a, NOW - 5 * DAY + 3 * 60_000);
    db.x("INSERT INTO touches (id, lead_id, rep_id, kind, at) VALUES ('t2', ?, 's1', 'connect', ?)", a, NOW - 5 * DAY + 9 * 60_000);
    const s = await call("/admin/api/sales?range=30d", { cookie: owner });
    const sam = s.json.activity.reps.find((r: Row) => r.rep_id === "s1");
    expect(sam).toMatchObject({ dials: 2, connects: 1, sets: 1, set_show_pct: 100 });
    expect(sam.speed).toEqual({ n: 1, median_min: 3, within5_pct: 100 });
  });
});

// ── Signed outcome links ─────────────────────────────────────────────────────

describe("one-tap outcome links", () => {
  it("only work for that call, until 48 hours after it", async () => {
    const rt = await rtFor();
    const id = insertLead({ status: "booked", call_at: NOW - H, closer_id: "r1" });
    const link = (await outcomeLink(rt, { id, call_at: NOW - H }))!;
    const [, , , , call_at, exp, sig] = new URL(link).pathname.split("/");
    expect(new URL(link).pathname.startsWith(`/admin/o/${id}/`)).toBe(true);
    expect(await verifyOutcomeLink(rt, id, call_at, exp, sig)).toBeTruthy();
    expect(await verifyOutcomeLink(rt, id, call_at, exp, sig.replace(/^./, (c) => (c === "a" ? "b" : "a")))).toBeNull();
    expect(await verifyOutcomeLink(rt, id, call_at, String(Number(exp) + 1), sig)).toBeNull();
    expect(await verifyOutcomeLink({ ...rt, now: () => NOW + 48 * H }, id, call_at, exp, sig)).toBeNull();
    db.x("UPDATE leads SET call_at = ? WHERE id = ?", NOW + DAY, id); // rescheduled
    expect(await verifyOutcomeLink(rt, id, call_at, exp, sig)).toBeNull();
  });
  it("log the outcome from the page, same-origin only, and audit it", async () => {
    const rt = await rtFor();
    const id = insertLead({ status: "booked", call_at: NOW - H, closer_id: "r1", first_name: "Ann" });
    const path = new URL((await outcomeLink(rt, { id, call_at: NOW - H }))!).pathname;
    const page = await call(path);
    expect(page.status).toBe(200);
    expect(page.text).toContain("Ann");
    expect(page.text).not.toContain("<script");
    const post = (body: string, cross = false) => testApp().request(ORIGIN + path, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded", "sec-fetch-site": cross ? "cross-site" : "same-origin", origin: cross ? "https://evil.example" : ORIGIN }, body }, env);
    expect((await post("status=won", true)).status).toBe(403);
    expect((await post("status=disqualified")).status).toBe(400);
    expect((await post("status=showed")).status).toBe(200);
    expect(db.q("SELECT status FROM leads WHERE id = ?", id)[0].status).toBe("showed");
    expect(db.q("SELECT user_id, action FROM audit_log WHERE action = 'outcome_link'")).toEqual([{ user_id: "link:r1", action: "outcome_link" }]);
    expect((await call(path.replace(/[0-9a-f]{4}$/, "0000"))).status).toBe(404);
  });
});

// ── Dedupe and merge ─────────────────────────────────────────────────────────

const dl = (o: Partial<DupLead>): DupLead => ({ id: lid(), ref_code: "R", created_at: NOW, first_name: null, last_name: null, email: `${seq}@x.example`, phone: null, visitor_id: null, status: "applied", tier: null, ...o });

describe("duplicates", () => {
  it("pairs by phone, browser, or name at a company domain (not personal mail)", () => {
    const a = dl({ created_at: 1, phone: "+4791234567", first_name: "Ann", last_name: "Lee", email: "ann@acme.example" });
    const b = dl({ created_at: 2, phone: "+4791234567" });
    const c = dl({ created_at: 3, first_name: "ann", last_name: "LEE", email: "a.lee@acme.example" });
    const d = dl({ created_at: 4, visitor_id: "v1" }), e = dl({ created_at: 5, visitor_id: "v1" });
    const g1 = dl({ created_at: 6, first_name: "Jo", last_name: "Smith", email: "jo@gmail.com" }), g2 = dl({ created_at: 7, first_name: "Jo", last_name: "Smith", email: "js@gmail.com" });
    const pairs = findDuplicates([a, b, c, d, e, g1, g2]);
    const key = (p: { survivor: DupLead; loser: DupLead }) => `${p.survivor.id}>${p.loser.id}`;
    expect(pairs.map(key).sort()).toEqual([`${a.id}>${b.id}`, `${a.id}>${c.id}`, `${d.id}>${e.id}`].sort());
    expect(pairs.find((p) => p.loser.id === c.id)!.reasons).toEqual(["same name and company domain"]);
  });
  it("merge patch: fills gaps, keeps the further stage, merges answers, honours opt-outs", () => {
    const s = { id: "s", ref_code: "S", status: "applied", answers: JSON.stringify({ role: "owner" }), phone: null, first_name: "Ann", revenue: 0, step_reached: 3, notes: null, unsubscribed_at: null, do_not_call_at: null } as unknown as Lead;
    const l = { id: "l", ref_code: "L", status: "won", answers: JSON.stringify({ role: "exec", revenue: "3m_10m" }), phone: "+4791234567", first_name: "X", revenue: 9000, closed_at: 5, step_reached: 8, notes: "paid", unsubscribed_at: 7, do_not_call_at: null } as unknown as Lead;
    const p = mergePatch(s, l) as Record<string, unknown>;
    expect(p.phone).toBe("+4791234567");
    expect(p.first_name).toBeUndefined();
    expect(p.status).toBe("won");
    expect(p.revenue).toBe(9000);
    expect(JSON.parse(String(p.answers))).toEqual({ role: "owner", revenue: "3m_10m" });
    expect(p.step_reached).toBe(8);
    expect(p.unsubscribed_at).toBe(7);
    expect(String(p.notes)).toContain("Merged from L");
  });
  it("merges in the database: history moves, the duplicate is erased, shared browser history survives", async () => {
    const owner = await makeSession(env as never, NOW);
    const s = insertLead({ created_at: NOW - 20 * DAY, phone: "+4791234567", visitor_id: "v1", status: "applied", answers: '{"role":"owner"}' });
    const l = insertLead({ created_at: NOW - 2 * DAY, phone: "+4791234567", visitor_id: "v1", status: "booked", call_at: NOW + DAY, booked_at: NOW - DAY, answers: '{"revenue":"3m_10m"}' });
    db.x("INSERT INTO visitors (id, created_at, last_seen_at, lead_id) VALUES ('v1', 1, 1, ?)", l);
    db.x("INSERT INTO events (id, ts, name, visitor_id, lead_id) VALUES ('e1', 1, 'page_view', 'v1', ?)", s);
    db.x("INSERT INTO events (id, ts, name, visitor_id, lead_id) VALUES ('e2', 2, 'booking_scheduled', 'v1', ?)", l);
    db.x("INSERT INTO payments (id, lead_id, amount, paid_at, created_at) VALUES ('p1', ?, 1000, 1, 1)", l);
    db.x("INSERT INTO touches (id, lead_id, kind, at) VALUES ('t1', ?, 'dial', 1)", l);
    db.x("INSERT INTO emails (id, lead_id, sequence, step, template, send_at, status, created_at) VALUES ('m1', ?, 'booked', 0, 't', ?, 'pending', 1)", l, NOW + H);
    const dups = await call("/admin/api/duplicates", { cookie: owner });
    expect(dups.json.total).toBe(1);
    const r = await call(`/admin/api/leads/${l}/merge`, { method: "POST", cookie: owner, body: { into: s } });
    expect(r.status).toBe(200);
    expect(r.json.survivor.id).toBe(s);
    expect(db.q("SELECT id FROM leads").map((x) => x.id)).toEqual([s]);
    const sv = db.q("SELECT status, call_at, cash_collected, answers FROM leads WHERE id = ?", s)[0];
    expect(sv.status).toBe("booked");
    expect(sv.cash_collected).toBe(1000);
    expect(JSON.parse(String(sv.answers))).toEqual({ role: "owner", revenue: "3m_10m" });
    expect(db.q("SELECT id FROM events ORDER BY id").map((x) => x.id)).toEqual(["e1", "e2"]);
    expect(db.q("SELECT lead_id FROM payments")[0].lead_id).toBe(s);
    expect(db.q("SELECT lead_id FROM touches")[0].lead_id).toBe(s);
    expect(db.q("SELECT id FROM visitors")[0]).toEqual({ id: "v1" });
    expect(db.q("SELECT status FROM emails WHERE id = 'm1'")).toEqual([{ status: "cancelled" }]);
    expect(db.q("SELECT action FROM audit_log WHERE action = 'lead_merge'").length).toBe(1);
  });
});

// ── Learned scoring hook ─────────────────────────────────────────────────────

/** The scoring function exactly as it was before the hook (reference for "byte-identical when off"). */
function referenceScore(answers: Record<string, string | string[]>, ctx: ScoreContext = {}): ScoreResult {
  const breakdown: ScoreLine[] = [];
  const flags = new Set<string>();
  let score = 0;
  const lengthPoints = (q: Question, text: string) => { const len = text.trim().length; for (const lp of q.lengthPoints || []) if (len >= lp.min) return lp.points; return 0; };
  for (const q of APPLICATION) {
    const a = answers[q.id];
    if (q.type === "contact" || a == null) continue;
    if (q.type === "text") {
      const pts = lengthPoints(q, String(a));
      if (q.id === "business" && matchesExcludedIndustry(String(a))) flags.add("excluded_industry");
      if (pts) { score += pts; breakdown.push({ id: q.id, label: `${q.id}: detail`, points: pts, flags: [] }); }
      continue;
    }
    for (const v of Array.isArray(a) ? a : [a]) {
      const opt = q.options?.find((o) => o.value === v);
      if (!opt) continue;
      score += opt.points;
      for (const f of opt.flags || []) flags.add(f);
      if (opt.points || opt.flags?.length) breakdown.push({ id: q.id, label: `${q.id}: ${opt.label}`, points: opt.points, flags: opt.flags || [] });
    }
  }
  const domain = emailDomain(ctx.email);
  if (domain && PERSONAL_EMAIL_DOMAINS.includes(domain)) { flags.add("personal_email"); if (flags.has("small")) flags.add("personal_email_small"); }
  if (ctx.country && !TARGET_COUNTRIES.includes(ctx.country.toUpperCase())) flags.add("out_of_market");
  if (isBlocked(ctx.email, ctx.blocklist || [])) flags.add("blocked");
  score = Math.max(0, Math.min(100, score));
  const rawTier: Tier = score >= TIER_THRESHOLDS.A ? "A" : score >= TIER_THRESHOLDS.B ? "B" : "C";
  let tier = rawTier;
  let cappedBy: string | null = null;
  const c = TIER_RULES.maxC.find((f) => flags.has(f));
  if (c && tier !== "C") { tier = "C"; cappedBy = c; }
  else if (!c) { const b = TIER_RULES.maxB.find((f) => flags.has(f)); if (b && tier === "A") { tier = "B"; cappedBy = b; } }
  if (c) cappedBy = cappedBy || c;
  return { score, tier, rawTier, flags: [...flags], breakdown, cappedBy };
}

function randomAnswers(r: () => number): Record<string, string | string[]> {
  const a: Record<string, string | string[]> = {};
  for (const q of APPLICATION) {
    if (q.type === "contact" || r() < 0.1) continue;
    if (q.type === "text") a[q.id] = "x".repeat(Math.floor(r() * 200)) + (r() < 0.05 ? " casino" : "");
    else if (q.type === "multi") a[q.id] = (q.options || []).filter(() => r() < 0.4).map((o) => o.value);
    else a[q.id] = (q.options || [])[Math.floor(r() * (q.options || []).length)].value;
  }
  return a;
}

describe("learned scoring hook", () => {
  const rng = (seed: number) => { let s = seed >>> 0; return () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 2 ** 32); };
  it("is byte-identical to the old scoring when off", () => {
    const r = rng(42);
    for (let i = 0; i < 2000; i++) {
      const a = randomAnswers(r);
      const ctx = { email: r() < 0.3 ? "x@gmail.com" : "x@acme.example", country: r() < 0.2 ? "BR" : "NO", blocklist: r() < 0.1 ? ["acme.example"] : [] };
      const ref = JSON.stringify(referenceScore(a, ctx));
      expect(JSON.stringify(scoreApplication(a, ctx))).toBe(ref);
      expect(JSON.stringify(scoreApplication(a, { ...ctx, learned: null }))).toBe(ref);
    }
  });
  it("stays off unless the owner switch and a valid table are both present", async () => {
    const table = { version: "learned:sm1", points: { "revenue=1m_3m": 25 }, n: { "revenue=1m_3m": 50 } };
    db.x("INSERT INTO settings (key, value, updated_at) VALUES ('LEARNED_POINTS', ?, 1)", JSON.stringify(table));
    clearSettingsCache();
    await rtFor();
    const a = { role: "owner", revenue: "1m_3m" };
    expect(JSON.stringify(scoreApplication(a))).toBe(JSON.stringify(referenceScore(a)));
    db.x("INSERT INTO settings (key, value, updated_at) VALUES ('LEARNED_ROUTING', 'true', 1)");
    clearSettingsCache();
    await rtFor();
    const on = scoreApplication(a);
    expect(on.score).toBe(20 + 25);
    expect(on.breakdown.at(-1)).toEqual({ id: "model", label: "learned:sm1", points: 0, flags: [] });
  });
  it("uses learned points only for options with n ≥ 20, within the question's range, and keeps hard caps", () => {
    expect(parseLearnedPoints({ version: "v1", points: { "role=exec": 20, "role=owner": 5 }, n: { "role=exec": 25, "role=owner": 19 } })!.points).toEqual({ "role=exec": 20 });
    expect(parseLearnedPoints({ version: "v1", points: { "role=exec": 20 } })).toBeNull(); // no counts: refused
    expect(parseLearnedPoints("{bad")).toBeNull();
    const learned = { version: "v2", points: { "role=exec": 20, "revenue=under_1m": 999, "spend=under_25k": 20 }, n: { "role=exec": 30, "revenue=under_1m": 30, "spend=under_25k": 30 } };
    const a = { role: "exec", revenue: "under_1m", spend: "under_25k", timeline: "0_3", readiness: "yes" };
    const r = scoreApplication(a, { learned });
    expect(r.breakdown.find((l) => l.id === "revenue")!.points).toBe(25); // clamped to the question's max
    expect(r.tier).toBe("C"); // under_1m still caps at C
    expect(r.cappedBy).toBe("under_1m");
    expect(r.flags).toEqual(expect.arrayContaining(["not_owner", "under_1m", "low_spend"]));
  });
  it("builds the table from the model report with the n guard", () => {
    const t = learnedFromReport({ options: [
      { question: "role", title: "", value: "owner", label: "", n: 40, wins: 10, rate: 0.25, smoothed: 0.25, lift: 1, points: 20, suggested: 18 },
      { question: "role", title: "", value: "exec", label: "", n: 12, wins: 1, rate: 0.1, smoothed: 0.1, lift: 1, points: 6, suggested: 0 },
    ] }, "sm42")!;
    expect(t).toEqual({ version: "learned:sm42", points: { "role=owner": 18 }, n: { "role=owner": 40 } });
    expect(LEARNED_MIN_N).toBe(20);
  });
  it("only the owner can switch it on", async () => {
    insertUser("u0000000000000000021", "m@acme.example", "manager");
    const mgr = await makeUserSession(env as never, "u0000000000000000021", NOW);
    expect((await call("/admin/api/calibration/learned", { method: "POST", cookie: mgr, body: { on: true } })).status).toBe(403);
    const owner = await makeSession(env as never, NOW);
    expect((await call("/admin/api/calibration/learned", { method: "POST", cookie: owner, body: { on: true } })).json.error).toMatch(/model/);
    expect((await call("/admin/api/integrations", { method: "PUT", cookie: owner, body: { key: "LEARNED_ROUTING", value: "true" } })).status).toBe(409);
  });
});

// ── Attribution and cohorts ──────────────────────────────────────────────────

describe("attribution", () => {
  const t = (d: number, channel: string | null) => ({ t: NOW - d * DAY, channel });
  it("credits each model", () => {
    const ts = [t(10, "paid_social"), t(5, "email"), t(1, "direct")];
    expect(creditWeights("first", ts, NOW)).toEqual([1, 0, 0]);
    expect(creditWeights("last_non_direct", ts, NOW)).toEqual([0, 1, 0]);
    expect(creditWeights("last_non_direct", [t(1, "direct")], NOW)).toEqual([1]);
    expect(creditWeights("linear", ts, NOW).map((x) => x.toFixed(3))).toEqual(["0.333", "0.333", "0.333"]);
    expect(creditWeights("position", ts, NOW)).toEqual([0.4, 0.2, 0.4]);
    expect(creditWeights("position", ts.slice(0, 2), NOW)).toEqual([0.5, 0.5]);
    const td = creditWeights("time_decay", [t(7, "a"), t(0, "b")], NOW);
    expect(td[1] / td[0]).toBeCloseTo(2, 5);
    for (const m of ["first", "last_non_direct", "linear", "position", "time_decay"] as const) expect(creditWeights(m, ts, NOW).reduce((a, b) => a + b, 0)).toBeCloseTo(1, 9);
  });
  it("credits only touches before each conversion, ties to spend, and keeps totals whole", () => {
    const leads: AttrLead[] = [
      { id: "a", created_at: NOW - 5 * DAY, booked_at: NOW - 3 * DAY, closed_at: NOW - DAY, won: true, revenue: 10000, cash: 4000,
        touches: [{ t: NOW - 6 * DAY, channel: "paid_social", key: "C1" }, { t: NOW - 4 * DAY, channel: "email", key: "C2" }, { t: NOW - 2 * DAY, channel: "email", key: "C3" }] },
      { id: "b", created_at: NOW - 5 * DAY, booked_at: null, closed_at: null, won: false, revenue: 0, cash: 0, touches: [] },
    ];
    const r = attribute("linear", leads, { C1: 2000 });
    const row = (k: string) => r.rows.find((x) => x.key === k)!;
    expect(row("C1").leads).toBe(1); // only C1 was before the lead was created
    expect(row("C1").booked).toBe(0.5);
    expect(row("C3").cash).toBe(Math.round(4000 / 3));
    expect(row("(no session)").leads).toBe(1);
    expect(row("C1").roas).toBe(Math.round((4000 / 3 / 2000) * 100) / 100);
    expect(r.totals.leads).toBe(2);
    expect(r.totals.wins).toBe(1);
    expect(topPaths(leads)[0].path).toEqual(["paid_social", "email"]);
  });
  it("cohorts: cumulative cash by age, blank when too young, plan collection and refunds", () => {
    const leads = [
      { id: "a", created_at: Date.UTC(2026, 5, 3), booked: true, won: true, closed_at: Date.UTC(2026, 5, 13), refunded: false },
      { id: "b", created_at: Date.UTC(2026, 5, 20), booked: true, won: true, closed_at: Date.UTC(2026, 6, 20), refunded: true },
      { id: "c", created_at: Date.UTC(2026, 9, 10), booked: false, won: false, closed_at: null, refunded: false },
    ];
    const pays = [{ lead_id: "a", amount: 3000, paid_at: Date.UTC(2026, 5, 13) }, { lead_id: "a", amount: 3000, paid_at: Date.UTC(2026, 6, 13) }, { lead_id: "b", amount: 5000, paid_at: Date.UTC(2026, 6, 20) }];
    const recv = [{ lead_id: "a", status: "paid", amount: 3000, due_at: Date.UTC(2026, 6, 13) }, { lead_id: "a", status: "pending", amount: 3000, due_at: Date.UTC(2026, 7, 13) }, { lead_id: "a", status: "pending", amount: 3000, due_at: Date.UTC(2027, 0, 1) }];
    const rows = cohortTable(leads, pays, recv, "month", NOW);
    expect(rows.map((r) => r.cohort)).toEqual(["2026-10", "2026-06"]);
    const june = rows[1];
    expect(june.cash).toMatchObject({ d0: 0, d7: 0, d14: 3000, d30: 8000, d60: 11000, d90: 11000, d180: null });
    expect(june.ttc_p50_days).toBe(20);
    expect(june.plan_collection_pct).toBe(50);
    expect(june.refund_pct).toBe(50);
    expect(june.value90_per_lead).toBe(5500);
    expect(rows[0].cash.d7).toBeNull();
  });
  it("is served and cached", async () => {
    const owner = await makeSession(env as never, NOW);
    const a = insertLead({ created_at: NOW - 3 * DAY, visitor_id: "v9" });
    db.x("INSERT INTO sessions (id, visitor_id, started_at, last_seen_at, channel, utm_campaign, lead_id) VALUES ('s9', 'v9', ?, ?, 'paid_social', 'Spring', ?)", NOW - 4 * DAY, NOW - 4 * DAY, a);
    const r1 = await call("/admin/api/attribution?model=first&dim=campaign&range=30d", { cookie: owner });
    expect(r1.json.rows.find((r: Row) => r.key === "Spring").leads).toBe(1);
    db.x("UPDATE sessions SET utm_campaign = 'Changed'");
    const r2 = await call("/admin/api/attribution?model=first&dim=campaign&range=30d", { cookie: owner });
    expect(r2.json.rows[0].key).toBe("Spring"); // served from the 10-minute cache
    expect((await call("/admin/api/cohorts?by=week", { cookie: owner })).json.by).toBe("week");
    const csv = await call("/admin/api/exports/attribution.csv?model=first&dim=campaign&range=30d", { cookie: owner });
    expect(csv.text.split("\r\n")[0]).toBe("model,dimension,key,leads,booked,wins,revenue,cash,spend,cash_roas,cost_per_booked");
  });
});

// ── Public API and signed webhooks ───────────────────────────────────────────

describe("API keys and /api/v1", () => {
  it("keys are shown once, stored as a hash, scoped and revocable", async () => {
    const owner = await makeSession(env as never, NOW);
    const created = await call("/admin/api/api-keys", { method: "POST", cookie: owner, body: { name: "CRM", scopes: ["leads:read"] } });
    const key = created.json.key as string;
    expect(keyId(key)).toBe(created.json.row.id);
    expect(JSON.stringify(db.q("SELECT * FROM api_keys"))).not.toContain(key.split("_")[2]);
    expect((await call("/admin/api/api-keys", { cookie: owner })).text).not.toContain(key);
    insertLead({ updated_at: NOW - 3 * H }); insertLead({ updated_at: NOW - 2 * H }); insertLead({ updated_at: NOW - H });
    const auth = { authorization: `Bearer ${key}` };
    const p1 = await call("/api/v1/leads?limit=2", { headers: auth });
    expect(p1.status).toBe(200);
    expect(p1.json.data).toHaveLength(2);
    expect(p1.json.has_more).toBe(true);
    const p2 = await call(`/api/v1/leads?limit=2&cursor=${p1.json.next_cursor}`, { headers: auth });
    expect(p2.json.data).toHaveLength(1);
    expect(p2.json.has_more).toBe(false);
    expect((await call(`/api/v1/leads?updated_since=${NOW - 90 * 60_000}`, { headers: auth })).json.data).toHaveLength(1);
    expect((await call("/api/v1/payments", { headers: auth })).status).toBe(403);
    expect((await call("/api/v1/leads", { headers: { authorization: `Bearer ${key.slice(0, -1)}0` } })).status).toBe(401);
    await call(`/admin/api/api-keys/${created.json.row.id}/revoke`, { method: "POST", cookie: owner });
    expect((await call("/api/v1/leads", { headers: auth })).status).toBe(401);
  });
  it("paging parameters", () => {
    expect(parsePage(() => undefined)).toEqual({ since: 0, afterTs: -1, afterId: "", limit: 100 });
    const c = makeCursor(123, "l1");
    expect(parsePage((k) => ({ cursor: c, limit: "999", updated_since: "2026-10-01T00:00:00Z" } as Record<string, string>)[k])).toEqual({ since: Date.UTC(2026, 9, 1), afterTs: 123, afterId: "l1", limit: 200 });
    expect(() => parsePage((k) => (k === "cursor" ? "!!" : undefined))).toThrow();
  });
});

describe("signed webhooks", () => {
  it("signatures verify and reject tampering and replays", async () => {
    const body = JSON.stringify({ event: "deal_won" });
    const h = await signatureHeader("whsec_x", 1_700_000_000, body);
    expect(await verifySignatureHeader("whsec_x", h, body, 1_700_000_100)).toBe(true);
    expect(await verifySignatureHeader("whsec_x", h, body + " ", 1_700_000_100)).toBe(false);
    expect(await verifySignatureHeader("whsec_y", h, body, 1_700_000_100)).toBe(false);
    expect(await verifySignatureHeader("whsec_x", h, body, 1_700_001_000)).toBe(false);
  });
  it("only public https hosts, and the allowlist when set", () => {
    expect(validWebhookUrl("https://hooks.zapier.com/x")).toBe(true);
    for (const u of ["http://hooks.zapier.com/x", "https://127.0.0.1/x", "https://10.0.0.1/", "https://[::1]/", "https://localhost/x", "https://box.internal/x", "https://a:b@hooks.zapier.com/", "https://hooks.zapier.com:8443/", "https://169.254.169.254/"]) expect(validWebhookUrl(u)).toBe(false);
    expect(validWebhookUrl("https://api.example.com/h", ["example.com"])).toBe(true);
    expect(validWebhookUrl("https://hooks.zapier.com/x", ["example.com"])).toBe(false);
  });
  it("fan out through forward_log with a signature and event id; the CRM webhook is signed too", async () => {
    const owner = await makeSession(env as never, NOW);
    const created = await call("/admin/api/webhooks", { method: "POST", cookie: owner, body: { url: "https://hooks.example.com/in", events: ["deal_won"] } });
    expect(created.json.secret).toMatch(/^whsec_/);
    expect((await call("/admin/api/webhooks", { cookie: owner })).text).not.toContain(created.json.secret);
    db.x("INSERT INTO settings (key, value, updated_at) VALUES ('LEAD_WEBHOOK_URL', 'https://crm.example.com/hook', 1), ('LEAD_WEBHOOK_SECRET', 'crm-secret', 1)");
    clearSettingsCache();
    const id = insertLead({ status: "showed", call_at: NOW - DAY });
    await call(`/admin/api/leads/${id}`, { method: "PATCH", cookie: owner, body: { status: "won", revenue: 5000 } });
    await vi.waitFor(() => expect(db.q("SELECT destination FROM forward_log WHERE event_name = 'deal_won'").length).toBe(2));
    const calls = (fetch as unknown as { mock: { calls: Array<[string, RequestInit]> } }).mock.calls;
    const hook = calls.find(([u]) => u === "https://hooks.example.com/in")!;
    const crm = calls.find(([u]) => u === "https://crm.example.com/hook")!;
    const hh = hook[1].headers as Record<string, string>;
    expect(await verifySignatureHeader(created.json.secret, hh["x-funnel-signature"], String(hook[1].body), Math.floor(Date.now() / 1000))).toBe(true);
    expect(hh["x-funnel-event-id"]).toBe(JSON.parse(String(hook[1].body)).event_id);
    expect(await verifySignatureHeader("crm-secret", (crm[1].headers as Record<string, string>)["x-funnel-signature"], String(crm[1].body), Math.floor(Date.now() / 1000))).toBe(true);
    expect(JSON.stringify(db.q("SELECT payload FROM forward_log"))).not.toContain(created.json.secret);
  });
});

describe("audit helpers", () => {
  it("diff keeps only changed fields", () => {
    expect(diff({ a: 1, b: 2, updated_at: 1 }, { a: 1, b: 3, updated_at: 2 })).toEqual({ before: { b: 2 }, after: { b: 3 } });
    expect(diff(null, { a: 1 }, ["a", "b"])).toEqual({ before: { a: null }, after: { a: 1 } });
  });
});
