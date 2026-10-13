// Security review round 2: regression tests for the confirmed findings. Integration tests run the real
// route handlers against a D1 shim over node:sqlite with every migration applied (as in salesops.test.ts).

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { Hono } from "hono";
import type { AppEnv, Runtime } from "../src/app";
import { makeRuntime } from "../src/app";
import { clearSettingsCache, isOwnerOnly, settingDef } from "../src/settings";
import { resetSecretCache } from "../src/lib/secret";
import { makeSession, makeUserSession, requireAdmin } from "../src/admin/auth";
import { adminApi } from "../src/routes/admin";
import { adminGrowth } from "../src/routes/admin-growth";
import { hqPublic } from "../src/routes/hq-public";
import { api } from "../src/routes/api";
import { v1 } from "../src/routes/v1";
import { createKey } from "../src/admin/api-keys";
import { eraseLead } from "../src/sales/erase";
import { purgeOld } from "../src/lib/retention";
import { WEBHOOK_EVENTS } from "../src/integrations/webhooks";
import { forwardEvent } from "../src/tracking/forward";
import { useLearnedPoints } from "../src/funnel/scoring";

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
let fetchMock: ReturnType<typeof vi.fn>;
const lid = () => "l" + String(++seq).padStart(19, "0");

function insertLead(f: Row): string {
  const id = (f.id as string) || lid();
  const row: Row = { id, ref_code: "OP-" + id.slice(-6).toUpperCase(), created_at: NOW - 10 * DAY, updated_at: NOW - 10 * DAY, email: `${id}@acme.example`, status: "applied", ...f };
  const keys = Object.keys(row);
  db.x(`INSERT INTO leads (${keys.join(",")}) VALUES (${keys.map(() => "?").join(",")})`, ...keys.map((k) => row[k]));
  return id;
}
function insertUser(id: string, email: string, role: string) {
  db.x("INSERT INTO users (id, email, name, role, rep_id, active, created_at) VALUES (?,?,?,?,?,1,?)", id, email, email.split("@")[0], role, null, NOW - 50 * DAY);
}
async function rtFor(): Promise<Runtime> {
  const rt = await makeRuntime(env as never, null, "https://hq.example.com/");
  return { ...rt, now: () => NOW };
}
const flush = async () => { for (let i = 0; i < 20; i++) await new Promise((r) => setTimeout(r, 0)); };

function testApp() {
  const app = new Hono<AppEnv>();
  app.use("*", async (c, next) => { c.set("rt", await makeRuntime(c.env, null, c.req.url)); await next(); });
  app.route("/api/v1", v1);
  app.route("/api", api);
  app.route("/", hqPublic);
  app.use("/admin/api/*", requireAdmin);
  app.route("/admin/api/growth", adminGrowth);
  app.route("/admin/api", adminApi);
  return app;
}
const ORIGIN = "https://hq.example.com";
interface CallOpts { method?: string; cookie?: string; cookies?: string; body?: unknown; form?: Record<string, string>; crossSite?: boolean; headers?: Record<string, string> }
async function call(path: string, o: CallOpts = {}) {
  const headers: Record<string, string> = { "user-agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15", "accept-language": "en", ...(o.headers || {}) };
  const jar = [o.cookie ? `_fa=${o.cookie}` : "", o.cookies || ""].filter(Boolean).join("; ");
  if (jar) headers.cookie = jar;
  if (o.method && o.method !== "GET") { headers["sec-fetch-site"] = o.crossSite ? "cross-site" : "same-origin"; headers.origin = o.crossSite ? "https://evil.example" : ORIGIN; }
  let body: string | undefined;
  if (o.form) { headers["content-type"] = "application/x-www-form-urlencoded"; body = new URLSearchParams(o.form).toString(); }
  else if (o.body !== undefined) { headers["content-type"] = "application/json"; body = JSON.stringify(o.body); }
  const res = await testApp().request(ORIGIN + path, { method: o.method || "GET", headers, body }, env);
  const text = await res.text();
  let json: any = null;
  try { json = JSON.parse(text); } catch { json = null; }
  return { status: res.status, json, text, headers: res.headers };
}
const cookiesOf = (h: Headers) => ((h as unknown as { getSetCookie?: () => string[] }).getSetCookie?.() || []).map((c) => c.split(";")[0]).join("; ");
const fetchCalls = () => fetchMock.mock.calls.map(([u, init]) => ({ url: String(u), init: (init || {}) as RequestInit }));

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
  clearSettingsCache();
  resetSecretCache();
  useLearnedPoints(null);
  db = await makeDb();
  env = { DB: db, ADMIN_PASSWORD: "correct horse battery staple", SESSION_SECRET: "test-secret-" + "x".repeat(40) };
  fetchMock = vi.fn(async () => new Response("{}", { status: 200 }));
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  useLearnedPoints(null);
  clearSettingsCache();
});

// ── 1. Settings that redirect mail, links or data are owner-only; magic links use the request origin ──

describe("owner-only settings and magic-link origin", () => {
  it("marks secrets, URL settings and sender identity owner-only", () => {
    for (const k of ["PUBLIC_URL", "RESEND_API_KEY", "EMAIL_FROM", "EMAIL_REPLY_TO", "SLACK_WEBHOOK_URL", "DISCORD_WEBHOOK_URL", "LEAD_WEBHOOK_URL", "LEAD_WEBHOOK_SECRET", "WEBHOOK_ALLOWED_HOSTS", "LEARNED_POINTS", "POSTHOG_HOST", "BOOKING_URL_A"]) {
      expect(isOwnerOnly(settingDef(k)!), k).toBe(true);
    }
    for (const k of ["SITE_NAME", "DIGEST_HOUR", "PRECALL_EMAILS_PER_DAY"]) expect(isOwnerOnly(settingDef(k)!), k).toBe(false);
  });

  it("refuses a manager changing PUBLIC_URL or a webhook, allows the owner", async () => {
    insertUser("u0000000000000000002", "mgr@acme.example", "manager");
    const mgr = await makeUserSession(env as never, "u0000000000000000002", NOW);
    const owner = await makeSession(env as never, NOW);
    expect((await call("/admin/api/integrations", { method: "PUT", cookie: mgr, body: { key: "PUBLIC_URL", value: "https://evil.example" } })).status).toBe(403);
    expect((await call("/admin/api/integrations", { method: "PUT", cookie: mgr, body: { key: "SLACK_WEBHOOK_URL", value: "https://hooks.slack.com/services/T0/B0/X" } })).status).toBe(403);
    expect((await call("/admin/api/integrations", { method: "PUT", cookie: mgr, body: { key: "RESEND_API_KEY", value: "re_123" } })).status).toBe(403);
    expect(db.q("SELECT * FROM settings")).toHaveLength(0);
    expect((await call("/admin/api/integrations", { method: "PUT", cookie: mgr, body: { key: "SITE_NAME", value: "Acme" } })).status).toBe(200);
    const ok = await call("/admin/api/integrations", { method: "PUT", cookie: owner, body: { key: "PUBLIC_URL", value: "https://apply.acme.example" } });
    expect(ok.status).toBe(200);
    const pub = ok.json.groups.flatMap((g: any) => g.settings).find((s: any) => s.key === "PUBLIC_URL");
    expect(pub.owner_only).toBe(true);
  });

  it("builds the sign-in link from the request's own origin, never the stored PUBLIC_URL", async () => {
    insertUser("u0000000000000000003", "boss@acme.example", "owner");
    db.x("INSERT INTO settings (key, value, updated_at) VALUES ('PUBLIC_URL', 'https://evil.example', 1)");
    env.RESEND_API_KEY = "re_test"; env.EMAIL_FROM = "HQ <hq@acme.example>";
    const r = await call("/admin/login/email", { method: "POST", form: { email: "boss@acme.example" } });
    expect(r.status).toBe(303);
    expect(r.headers.get("location")).toBe("/admin/login?m=sent");
    const sent = fetchCalls().filter((c) => c.url.includes("api.resend.com"));
    expect(sent).toHaveLength(1);
    const body = JSON.parse(String(sent[0].init.body));
    expect(body.text).toContain("https://hq.example.com/admin/login/magic?t=");
    expect(body.html + body.text).not.toContain("evil.example");
    // Unknown address: the same answer, nothing sent.
    const u = await call("/admin/login/email", { method: "POST", form: { email: "nobody@acme.example" } });
    expect(u.headers.get("location")).toBe("/admin/login?m=sent");
    expect(fetchCalls().filter((c) => c.url.includes("api.resend.com"))).toHaveLength(1);
  });

  it("rate-limits sign-in links per address", async () => {
    const codes = [];
    for (let i = 0; i < 4; i++) codes.push((await call("/admin/login/email", { method: "POST", form: { email: "x@acme.example" }, headers: { "cf-connecting-ip": `10.0.0.${i}` } })).headers.get("location"));
    expect(codes.slice(0, 3).every((l) => l === "/admin/login?m=sent")).toBe(true);
    expect(codes[3]).toBe("/admin/login?e=magic_locked");
  });
});

// ── 2. No-JS form: unverified until the inbox confirms ───────────────────────

describe("no-JS application form", () => {
  const form = { name: "Ada Lovelace", email: "ada@gmail.com", phone: "+4791234567" };
  beforeEach(() => {
    env.META_PIXEL_ID = "123"; env.META_ACCESS_TOKEN = "tok"; env.CONSENT_REQUIRED_EU = "false";
    env.RESEND_API_KEY = "re_test"; env.EMAIL_FROM = "Team <t@acme.example>"; env.BUSINESS_ADDRESS = "1 Main St";
  });

  it("stores the lead unconfirmed: no Lead event, no sequence, one confirm email", async () => {
    const r = await call("/api/apply/nojs", { method: "POST", form });
    expect(r.status).toBe(303);
    await flush();
    const lead = db.q("SELECT id, status FROM leads WHERE email = ?", "ada@gmail.com")[0];
    expect(lead).toBeTruthy();
    expect(db.q("SELECT * FROM emails WHERE lead_id = ?", lead.id)).toHaveLength(0);
    expect(db.q("SELECT * FROM forward_log WHERE lead_id = ?", lead.id)).toHaveLength(0);
    expect(fetchCalls().some((c) => c.url.includes("graph.facebook.com"))).toBe(false);
    expect(db.q("SELECT 1 FROM kv_state WHERE key = ?", `nojs_unverified:${lead.id}`)).toHaveLength(1);
    const mails = fetchCalls().filter((c) => c.url.includes("api.resend.com"));
    expect(mails).toHaveLength(1);
    const m = JSON.parse(String(mails[0].init.body));
    expect(m.to).toEqual(["ada@gmail.com"]);
    const link = /https:\/\/hq\.example\.com(\/api\/apply\/nojs\/confirm\/l[0-9a-z]{19}\/[^\s")]+)/.exec(m.text)![1];

    // The JSON steps are closed to it until confirmed.
    const jar = cookiesOf(r.headers);
    const sub = await call("/api/apply/submit", { method: "POST", cookies: jar, body: {} });
    expect(sub.status).toBe(403);
    expect(sub.json.code).toBe("verify_email");

    // A link scanner (no user activation) gets a button, and confirms nothing.
    const scan = await call(link);
    expect(scan.status).toBe(200);
    expect(scan.text).toContain(`action="${link}"`);
    expect(db.q("SELECT 1 FROM kv_state WHERE key = ?", `nojs_unverified:${lead.id}`)).toHaveLength(1);

    // A person's click confirms: the Lead event goes out once, the sequence starts, on to /apply.
    const click = await call(link, { headers: { "sec-fetch-user": "?1", "sec-fetch-dest": "document", "sec-fetch-site": "cross-site" } });
    expect(click.status).toBe(303);
    expect(click.headers.get("location")).toBe("/apply");
    await flush();
    expect(db.q("SELECT 1 FROM kv_state WHERE key = ?", `nojs_unverified:${lead.id}`)).toHaveLength(0);
    expect(db.q("SELECT COUNT(*) n FROM emails WHERE lead_id = ? AND sequence = 'abandoned'", lead.id)[0].n).toBeGreaterThan(0);
    expect(db.q("SELECT event_name FROM forward_log WHERE lead_id = ? AND destination = 'meta'", lead.id)).toEqual([{ event_name: "lead_captured" }]);
    expect(db.q("SELECT COUNT(*) n FROM events WHERE lead_id = ? AND name = 'lead_captured'", lead.id)[0].n).toBe(1);
    // A second click does nothing more.
    await call(link, { headers: { "sec-fetch-user": "?1", "sec-fetch-dest": "document" } });
    await flush();
    expect(db.q("SELECT COUNT(*) n FROM forward_log WHERE lead_id = ?", lead.id)[0].n).toBe(1);
    // Now the JSON steps open up.
    expect((await call("/api/apply/submit", { method: "POST", cookies: jar, body: {} })).status).not.toBe(403);
  });

  it("refuses a forged confirm link", async () => {
    await call("/api/apply/nojs", { method: "POST", form });
    const id = String(db.q("SELECT id FROM leads")[0].id);
    const r = await call(`/api/apply/nojs/confirm/${id}/AAAAAAAAAAAAAAAAAAAAAA`, { headers: { "sec-fetch-user": "?1" } });
    expect(r.status).toBe(400);
    expect(db.q("SELECT 1 FROM kv_state WHERE key = ?", `nojs_unverified:${id}`)).toHaveLength(1);
  });

  it("counts the daily cap only after validation passes", async () => {
    const day = `nojs_day:${new Date(NOW).toISOString().slice(0, 10)}`;
    db.x("INSERT INTO kv_state (key, value, updated_at) VALUES (?, '49', ?)", day, NOW);
    const bad = await call("/api/apply/nojs", { method: "POST", form: { ...form, email: "not-an-email" } });
    expect(bad.headers.get("location")).toBe("/apply?nojs=email");
    expect(db.q("SELECT value FROM kv_state WHERE key = ?", day)[0].value).toBe("49");
    const ok = await call("/api/apply/nojs", { method: "POST", form, headers: { "cf-connecting-ip": "10.0.0.2" } });
    expect(ok.headers.get("location")).toBe("/apply?nojs=confirm");
    const full = await call("/api/apply/nojs", { method: "POST", form: { ...form, email: "bob@gmail.com" }, headers: { "cf-connecting-ip": "10.0.0.3" } });
    expect(full.headers.get("location")).toBe("/apply?nojs=rate");
    expect(db.q("SELECT COUNT(*) n FROM leads")[0].n).toBe(1);
  });

  it("refuses cross-site posts", async () => {
    expect((await call("/api/apply/nojs", { method: "POST", form, crossSite: true })).status).toBe(403);
  });
});

// ── 3 and 4. Receivables: one payment per "mark paid", allocation by running balance ──

describe("receivables", () => {
  async function wonPlan(owner: string): Promise<string> {
    const id = insertLead({ status: "showed", call_at: NOW - DAY, showed_at: NOW - DAY });
    const r = await call("/admin/api/pipeline/move", { method: "POST", cookie: owner, body: { lead_id: id, stage: "won_plan", revenue: 9000, installments: 3 } });
    expect(r.status).toBe(200);
    return id;
  }
  const plan = (id: string) => db.q("SELECT seq, amount, status FROM receivables WHERE lead_id = ? AND status != 'cancelled' ORDER BY seq", id);

  it("records one payment when mark-paid is clicked twice at once", async () => {
    const owner = await makeSession(env as never, NOW);
    const id = await wonPlan(owner);
    const r1 = String(db.q("SELECT id FROM receivables WHERE seq = 1 AND lead_id = ?", id)[0].id);
    // Widen the race: both requests read the instalment as pending before either one writes.
    const real = db.prepare.bind(db);
    const slow = (st: any): any => ({
      bind: (...a: unknown[]) => slow(st.bind(...a)),
      first: async (col?: string) => { const r = await st.first(col); if (/FROM receivables WHERE id = \?/.test(st.sql)) await new Promise((res) => setTimeout(res, 5)); return r; },
      all: () => st.all(), run: () => st.run(), sql: st.sql,
    });
    env.DB = { ...db, prepare: (sql: string) => slow(real(sql)) };
    const [a, b] = await Promise.all([
      call(`/admin/api/receivables/${r1}/paid`, { method: "POST", cookie: owner, body: {} }),
      call(`/admin/api/receivables/${r1}/paid`, { method: "POST", cookie: owner, body: {} }),
    ]);
    expect([a.status, b.status].filter((s) => s === 200)).toHaveLength(1);
    expect(db.q("SELECT COUNT(*) n, SUM(amount) s FROM payments WHERE lead_id = ?", id)[0]).toEqual({ n: 1, s: 3000 });
    expect(db.q("SELECT cash_collected FROM leads WHERE id = ?", id)[0].cash_collected).toBe(3000);
    const linked = db.q("SELECT paid_payment_id FROM receivables WHERE id = ?", r1)[0].paid_payment_id;
    expect(linked).toBe(db.q("SELECT id FROM payments WHERE lead_id = ?", id)[0].id);
  });

  it("a $1 payment leaves the $3000 instalment pending", async () => {
    const owner = await makeSession(env as never, NOW);
    const id = await wonPlan(owner);
    expect((await call(`/admin/api/leads/${id}/payments`, { method: "POST", cookie: owner, body: { amount: 1 } })).status).toBe(200);
    expect(plan(id)).toEqual([
      { seq: 1, amount: 3000, status: "pending" }, { seq: 2, amount: 3000, status: "pending" }, { seq: 3, amount: 3000, status: "pending" },
    ]);
    // The rest of the first instalment completes it.
    await call(`/admin/api/leads/${id}/payments`, { method: "POST", cookie: owner, body: { amount: 2999 } });
    expect(plan(id).map((r) => r.status)).toEqual(["paid", "pending", "pending"]);
  });

  it("an overpayment pays two instalments and carries the rest", async () => {
    const owner = await makeSession(env as never, NOW);
    const id = await wonPlan(owner);
    await call(`/admin/api/leads/${id}/payments`, { method: "POST", cookie: owner, body: { amount: 7000 } });
    expect(plan(id).map((r) => r.status)).toEqual(["paid", "paid", "pending"]);
    await call(`/admin/api/leads/${id}/payments`, { method: "POST", cookie: owner, body: { amount: 2000 } });
    expect(plan(id).map((r) => r.status)).toEqual(["paid", "paid", "paid"]);
    // Deleting the big payment un-pays what it no longer covers.
    const big = String(db.q("SELECT id FROM payments WHERE lead_id = ? AND amount = 7000", id)[0].id);
    expect((await call(`/admin/api/leads/${id}/payments/${big}`, { method: "DELETE", cookie: owner })).status).toBe(200);
    expect(plan(id).map((r) => r.status)).toEqual(["pending", "pending", "pending"]);
  });

  it("a deposit taken before the plan counts toward the first instalment", async () => {
    const owner = await makeSession(env as never, NOW);
    const id = insertLead({ status: "showed", call_at: NOW - DAY, showed_at: NOW - DAY });
    await call(`/admin/api/leads/${id}/payments`, { method: "POST", cookie: owner, body: { amount: 3000 } });
    await call("/admin/api/pipeline/move", { method: "POST", cookie: owner, body: { lead_id: id, stage: "won_plan", revenue: 9000, installments: 3 } });
    expect(plan(id)).toEqual([
      { seq: 1, amount: 3000, status: "paid" }, { seq: 2, amount: 3000, status: "pending" }, { seq: 3, amount: 3000, status: "pending" },
    ]);
    // A small deposit pays nothing yet.
    const id2 = insertLead({ status: "showed", call_at: NOW - DAY, showed_at: NOW - DAY });
    await call(`/admin/api/leads/${id2}/payments`, { method: "POST", cookie: owner, body: { amount: 500 } });
    await call("/admin/api/pipeline/move", { method: "POST", cookie: owner, body: { lead_id: id2, stage: "won_plan", revenue: 9000, installments: 3 } });
    expect(plan(id2).map((r) => r.status)).toEqual(["pending", "pending", "pending"]);
  });
});

// ── 5 and 6. Merge keeps referral credit and the booking's reminders ────────

describe("merge", () => {
  it("moves the duplicate's referral credit to the survivor", async () => {
    const owner = await makeSession(env as never, NOW);
    const s = insertLead({ created_at: NOW - 20 * DAY, phone: "+4791234567" });
    const l = insertLead({ created_at: NOW - 2 * DAY, phone: "+4791234567" });
    const friend = insertLead({ created_at: NOW - DAY });
    db.x("INSERT INTO lead_referrals (lead_id, referrer_lead_id, ref_code, created_at) VALUES (?,?,?,1)", friend, l, "OP-XXXXXX");
    db.x("INSERT INTO lead_referrals (lead_id, referrer_lead_id, ref_code, created_at) VALUES (?,?,?,1)", l, s, "OP-YYYYYY");
    db.x("INSERT INTO visitor_referrals (visitor_id, ref_code, referrer_lead_id, first_at) VALUES ('vz','OP-XXXXXX',?,1)", l);
    const r = await call(`/admin/api/leads/${l}/merge`, { method: "POST", cookie: owner, body: { into: s } });
    expect(r.status).toBe(200);
    expect(db.q("SELECT lead_id, referrer_lead_id FROM lead_referrals")).toEqual([{ lead_id: friend, referrer_lead_id: s }]);
    expect(db.q("SELECT referrer_lead_id FROM visitor_referrals")).toEqual([{ referrer_lead_id: s }]);
  });

  it("restarts the booking reminders when the duplicate held the booking", async () => {
    const owner = await makeSession(env as never, NOW);
    const s = insertLead({ created_at: NOW - 20 * DAY, phone: "+4791234567", status: "applied", tier: "A" });
    const l = insertLead({
      created_at: NOW - 2 * DAY, phone: "+4791234567", status: "booked", tier: "A", booked_at: NOW - DAY, call_at: NOW + 3 * DAY,
      booking_ref: "cal-1", booking_provider: "calendly", booking_verified: 1, booking_source: "funnel",
    });
    db.x("INSERT INTO emails (id, lead_id, sequence, step, template, send_at, status, attempts, created_at) VALUES ('m0000000000000000001', ?, 'booked', 0, 'booked_confirm', ?, 'pending', 0, ?)", l, NOW + H, NOW);
    const r = await call(`/admin/api/leads/${l}/merge`, { method: "POST", cookie: owner, body: { into: s } });
    expect(r.status).toBe(200);
    expect(db.q("SELECT status, booking_ref FROM leads WHERE id = ?", s)[0]).toEqual({ status: "booked", booking_ref: "cal-1" });
    const pending = db.q("SELECT sequence FROM emails WHERE lead_id = ? AND status = 'pending'", s).map((x) => x.sequence);
    expect(pending).toContain("booked");
    expect(pending).toContain("precall");
    // No second Schedule conversion.
    expect(db.q("SELECT COUNT(*) n FROM events WHERE name = 'booking_scheduled'")[0].n).toBe(0);
  });
});

// ── 7 and 8. Erasure reaches the audit log and every webhook subscriber ─────

describe("erasure", () => {
  it("strips the lead's data from the audit log and keeps the action", async () => {
    const id = insertLead({ notes: "secret note" });
    const other = insertLead({});
    db.x("INSERT INTO audit_log (id, ts, user_id, action, entity, entity_id, before, after) VALUES ('a1', ?, 'owner', 'lead_update', 'lead', ?, ?, ?)", NOW, id, '{"notes":"old"}', '{"notes":"secret note"}');
    db.x("INSERT INTO audit_log (id, ts, user_id, action, entity, entity_id, before, after) VALUES ('a2', ?, 'owner', 'payment_add', 'payment', 'p1', NULL, ?)", NOW, JSON.stringify({ lead_id: id, amount: 5, method: "card x" }));
    db.x("INSERT INTO audit_log (id, ts, user_id, action, entity, entity_id, before, after) VALUES ('a3', ?, 'owner', 'payment_add', 'payment', 'p2', NULL, ?)", NOW, JSON.stringify({ lead_id: other, amount: 7 }));
    db.x("INSERT INTO audit_log (id, ts, user_id, action, entity, entity_id, before, after) VALUES ('a4', ?, 'owner', 'x', 'payment', 'p3', NULL, 'not json')", NOW);
    expect((await eraseLead(await rtFor(), id)).ok).toBe(true);
    const rows = Object.fromEntries(db.q("SELECT id, action, before, after FROM audit_log").map((r) => [r.id, r]));
    expect(rows.a1).toEqual({ id: "a1", action: "lead_update", before: null, after: null });
    expect(rows.a2).toEqual({ id: "a2", action: "payment_add", before: null, after: null });
    expect(rows.a3.after).toContain(other);
    expect(rows.a4.after).toBe("not json");
  });

  it("tells every active webhook subscription, whatever events it picked", async () => {
    expect(WEBHOOK_EVENTS as readonly string[]).toContain("lead_erased");
    const id = insertLead({});
    db.x("INSERT INTO webhook_subscriptions (id, url, events, secret, active, created_at) VALUES ('wh000000000000000001', 'https://hooks.zapier.com/a', 'deal_won', 'whsec_a', 1, 1)");
    db.x("INSERT INTO webhook_subscriptions (id, url, events, secret, active, created_at) VALUES ('wh000000000000000002', 'https://hooks.zapier.com/b', '*', 'whsec_b', 0, 1)");
    await eraseLead(await rtFor(), id);
    await flush();
    const posts = fetchCalls().filter((c) => c.url.startsWith("https://hooks.zapier.com/"));
    expect(posts.map((p) => p.url)).toEqual(["https://hooks.zapier.com/a"]);
    const body = JSON.parse(String(posts[0].init.body));
    expect(body.event).toBe("lead_erased");
    expect(body.lead).toEqual({ id, ref: "OP-" + id.slice(-6).toUpperCase() });
    expect((posts[0].init.headers as Record<string, string>)["x-funnel-signature"]).toMatch(/^t=\d+,v1=[0-9a-f]+$/);
    expect(posts[0].init.redirect).toBe("manual");
  });
});

// ── 9. Retention, redirects, proof links, metrics budget ───────────────────

describe("hardening", () => {
  it("purges stale kv rows and old audit detail", async () => {
    const old = NOW - 400 * DAY;
    for (const k of ["magic:abc", "noshowping:l1:1", "hotpartial:l1", "mx:acme.example", "magic_em:x:1", "nojs_unverified:l1"]) db.x("INSERT INTO kv_state (key, value, updated_at) VALUES (?, '1', ?)", k, old);
    db.x("INSERT INTO kv_state (key, value, updated_at) VALUES ('mx:fresh.example', '1', ?)", NOW);
    db.x("INSERT INTO kv_state (key, value, updated_at) VALUES ('admin:epoch', '1', ?)", old);
    db.x("INSERT INTO audit_log (id, ts, user_id, action, entity, entity_id, before, after) VALUES ('old', ?, 'owner', 'lead_update', 'lead', 'l1', '{}', '{\"notes\":\"x\"}')", old);
    db.x("INSERT INTO audit_log (id, ts, user_id, action, entity, entity_id, before, after) VALUES ('new', ?, 'owner', 'lead_update', 'lead', 'l1', '{}', '{\"notes\":\"x\"}')", NOW);
    await purgeOld(await rtFor(), true);
    expect(db.q("SELECT key FROM kv_state ORDER BY key").map((r) => r.key)).toEqual(["admin:epoch", "mx:fresh.example"]);
    expect(db.q("SELECT id, action, after FROM audit_log ORDER BY id")).toEqual([
      { id: "new", action: "lead_update", after: '{"notes":"x"}' }, { id: "old", action: "lead_update", after: null },
    ]);
  });

  it("does not follow redirects from webhook destinations", async () => {
    env.LEAD_WEBHOOK_URL = "https://crm.example.com/hook";
    const id = insertLead({});
    fetchMock.mockImplementation(async () => new Response(null, { status: 302, headers: { location: "http://169.254.169.254/" } }));
    const rt = await rtFor();
    await forwardEvent(rt, { id: "e0000000000000000001", ts: NOW, name: "deal_won", who: { leadId: id }, props: {} });
    const c = fetchCalls().find((x) => x.url === "https://crm.example.com/hook")!;
    expect(c.init.redirect).toBe("manual");
    expect(fetchCalls().some((x) => x.url.includes("169.254"))).toBe(false);
    expect(db.q("SELECT status, http_status FROM forward_log WHERE destination = 'crm'")).toEqual([{ status: "failed", http_status: 302 }]);
  });

  it("shows signed proof links to owners and managers only", async () => {
    insertLead({ status: "won", closed_at: NOW - DAY, revenue: 9000 });
    insertUser("u0000000000000000004", "v@acme.example", "viewer");
    const viewer = await makeUserSession(env as never, "u0000000000000000004", NOW);
    const owner = await makeSession(env as never, NOW);
    const v = await call("/admin/api/growth/proof", { cookie: viewer });
    expect(v.status).toBe(200);
    expect(v.json.clients).toHaveLength(1);
    expect(v.json.clients[0].link).toBeNull();
    const o = await call("/admin/api/growth/proof", { cookie: owner });
    expect(o.json.clients[0].link).toMatch(/\/proof\/submit\?ref=l[0-9a-z]{19}&sig=/);
  });

  it("gives /metrics/daily its own budget and a 31-day range", async () => {
    const { key } = await createKey(await rtFor(), { name: "bi", scopes: ["metrics:read"] }, null);
    const auth = { authorization: `Bearer ${key}` };
    expect((await call("/api/v1/metrics/daily?from=2026-08-01&to=2026-10-01", { headers: auth })).status).toBe(400);
    const codes = [];
    // The refused range above counted too: nine more fit in the minute.
    for (let i = 0; i < 10; i++) codes.push((await call("/api/v1/metrics/daily?from=2026-10-10&to=2026-10-12", { headers: auth })).status);
    expect(codes.slice(0, 9)).toEqual(Array(9).fill(200));
    expect(codes[9]).toBe(429);
  });
});
