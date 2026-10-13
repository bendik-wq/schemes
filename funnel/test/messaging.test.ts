// Round 3: email sending safety (stale steps, quiet hours, daily cap, go-live backlog skip), the shorter pre-call
// run, truthful copy, lander copy, the C-tier page and review link, the form's new fields, and consented text
// reminders over Twilio. Integration tests run the real code against a D1 shim over node:sqlite with every
// migration applied (the same shim as salesops.test.ts).

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { Hono } from "hono";
import type { AppEnv, Runtime } from "../src/app";
import { makeRuntime } from "../src/app";
import { clearSettingsCache } from "../src/settings";
import { resetSecretCache } from "../src/lib/secret";
import { APPLICATION, BANNED_PHRASES, FAQS, HEADLINES, LANDING, OFFER, BREAKOUT, RESOURCES_PAGE, SMS_CONSENT, CALL_CONSENT } from "../src/config";
import {
  FIRST_TOUCH, PRECALL_MAX_TOTAL, SEQUENCES, attendanceConfirmedFor, localParts, maxLateMs, nextLocalMorning, quietUntil, respectsQuietHours,
  slotsForPerDay, zonedTime,
} from "../src/integrations/sequences";
import { enqueueSequence, processEmailQueue, skipBacklog } from "../src/integrations/email";
import { TEMPLATES, precallPlan, rankPrecall } from "../src/integrations/all-templates";
import { buildDossier } from "../src/followup/dossier";
import { article } from "../src/followup/templates";
import { allLanders, ANGLES, INDUSTRIES } from "../src/landers/catalog";
import {
  founderHtml, headlinePool, pageTitle, productHtml, resourcesHtml, resourcesSub, reviewSig, splitHeadline, systemMobileHtml, applicationCfg,
} from "../src/funnel/pages";
import { cleanAnswer, cleanWebsite } from "../src/funnel/application";
import {
  inboundAction, processSmsQueue, recordSmsConsent, scheduleSmsReminders, smsBody, smsConsentGiven, smsSendTime, twilioSignature,
} from "../src/integrations/sms";
import { smsHooks } from "../src/routes/sms-hooks";
import { links } from "../src/routes/links";
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

const TZ = "Europe/Oslo";
// Tuesday 13 October 2026, 12:00 in Oslo (CEST, UTC+2).
const NOON = zonedTime(2026, 10, 13, 12, 0, TZ);
const M = 60_000, H = 60 * M, DAY = 24 * H;
let db: Shim;
let env: Record<string, unknown>;
let seq = 0;
const lid = () => "l" + String(++seq).padStart(19, "0");
const mid = () => "m" + String(++seq).padStart(19, "0");

function insertLead(f: Row = {}): string {
  const id = (f.id as string) || lid();
  const row: Row = {
    id, ref_code: "OP-" + id.slice(-6).toUpperCase(), created_at: NOON - DAY, updated_at: NOON - DAY, email: `${id}@acme.example`, status: "applied",
    first_name: "Kari", timezone: TZ, answers: JSON.stringify({ business: "Three dental clinics", goal: "own_growth", blockers: ["tracking"] }),
    tier: "A", app_completed_at: NOON - DAY, booking_source: "funnel", ...f,
  };
  const keys = Object.keys(row);
  db.x(`INSERT INTO leads (${keys.join(",")}) VALUES (${keys.map(() => "?").join(",")})`, ...keys.map((k) => row[k]));
  return id;
}
function insertEmail(leadId: string, sequence: string, step: number, template: string, sendAt: number, f: Row = {}): string {
  const id = (f.id as string) || mid();
  const row: Row = { id, lead_id: leadId, sequence, step, template, send_at: sendAt, status: "pending", attempts: 0, created_at: sendAt - H, ...f };
  const keys = Object.keys(row);
  db.x(`INSERT INTO emails (${keys.join(",")}) VALUES (${keys.map(() => "?").join(",")})`, ...keys.map((k) => row[k]));
  return id;
}
const email = (id: string) => db.q("SELECT * FROM emails WHERE id = ?", id)[0];

async function rt(): Promise<Runtime> {
  return makeRuntime(env as never, null, "https://apply.example.test/");
}

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOON);
  clearSettingsCache();
  resetSecretCache();
  db = await makeDb();
  env = { DB: db, SESSION_SECRET: "test-secret-" + "x".repeat(40), EMAIL_PERSONALIZE: "rules" };
  vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", { status: 200 })));
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  clearSettingsCache();
});

// ── 1. Sending safety ────────────────────────────────────────────────────────

describe("sending safety: pure rules", () => {
  it("maxLateMs defaults by sequence", () => {
    const idx = (s: string, t: string) => SEQUENCES[s].steps.findIndex((x) => x.template === t);
    for (const t of FIRST_TOUCH) {
      const s = t.startsWith("ab") ? "abandoned" : t.startsWith("ta") ? "tier_a" : t.startsWith("tb") ? "tier_b" : "tier_c";
      expect(maxLateMs(s, idx(s, t), t)).toBe(45 * M);
    }
    expect(maxLateMs("tier_a", idx("tier_a", "ta_3"), "ta_3")).toBe(12 * H);
    expect(maxLateMs("behaviour", 0, "t_cost")).toBe(2 * H);
    expect(maxLateMs("nurture", 0, "nu_industry")).toBe(3 * DAY);
    expect(maxLateMs("booked", idx("booked", "bk_24h"), "bk_24h")).toBe(6 * H);
    expect(maxLateMs("booked", idx("booked", "bk_1h"), "bk_1h")).toBe(15 * M);
    expect(maxLateMs("booked", idx("booked", "bk_10m"), "bk_10m")).toBe(5 * M);
    expect(maxLateMs("booked", 0, "bk_confirm")).toBeNull(); // only "before the call"
    expect(maxLateMs("continue", 0, "continue_link")).toBeNull();
  });
  it("quiet hours: 08:00–20:00 local, call-anchored and transactional mail exempt", () => {
    expect(quietUntil(NOON, TZ)).toBeNull();
    const late = zonedTime(2026, 10, 13, 22, 30, TZ);
    expect(quietUntil(late, TZ)).toBe(zonedTime(2026, 10, 14, 8, 0, TZ));
    const early = zonedTime(2026, 10, 13, 6, 10, TZ);
    expect(quietUntil(early, TZ)).toBe(zonedTime(2026, 10, 13, 8, 0, TZ));
    expect(nextLocalMorning(NOON, TZ)).toBe(zonedTime(2026, 10, 14, 8, 0, TZ));
    // Across the end of daylight saving (25 October 2026 in Oslo).
    expect(localParts(nextLocalMorning(zonedTime(2026, 10, 24, 21, 0, TZ), TZ), TZ).hh).toBe(8);
    expect(respectsQuietHours("tier_a", 1, "ta_2")).toBe(true);
    expect(respectsQuietHours("nurture", 0, "nu_industry")).toBe(true);
    expect(respectsQuietHours("tier_a", 0, "ta_1")).toBe(false); // a receipt for their own submit
    expect(respectsQuietHours("booked", 2, "bk_24h")).toBe(false);
    expect(respectsQuietHours("booked", 0, "bk_confirm")).toBe(false);
  });
  it("one pre-call email a day lands mid-afternoon, a few a day stay inside 08:00–20:00", () => {
    expect(slotsForPerDay(1)).toEqual([[14, 30]]);
    for (const n of [1, 2, 3]) for (const [h] of slotsForPerDay(n)) expect(h).toBeGreaterThanOrEqual(8);
  });
});

describe("sending safety: the queue", () => {
  it("skips a stale first touch and sends a fresh one", async () => {
    const a = insertLead(), b = insertLead();
    const stale = insertEmail(a, "tier_a", 0, "ta_1", NOON - 50 * M);
    const fresh = insertEmail(b, "tier_a", 0, "ta_1", NOON - 10 * M);
    await processEmailQueue(await rt());
    expect(email(stale)).toMatchObject({ status: "skipped", error: "stale" });
    expect(email(fresh).status).toBe("simulated");
  });
  it("skips tier mail more than 12 h late and nurture more than 3 days late", async () => {
    const a = insertLead(), b = insertLead();
    const t = insertEmail(a, "tier_a", 2, "ta_3", NOON - 13 * H);
    const n = insertEmail(b, "nurture", 0, "nu_industry", NOON - 4 * DAY, { });
    db.x("UPDATE leads SET status = 'applied' WHERE id = ?", b);
    await processEmailQueue(await rt());
    expect(email(t)).toMatchObject({ status: "skipped", error: "stale" });
    expect(email(n)).toMatchObject({ status: "skipped", error: "stale" });
  });
  it("holds marketing mail for the morning outside 08:00–20:00 local, but not the booking confirmation", async () => {
    vi.setSystemTime(zonedTime(2026, 10, 13, 22, 0, TZ));
    const now = Date.now();
    const a = insertLead(), b = insertLead({ status: "booked", call_at: now + 2 * DAY, booking_verified: 1 });
    const m = insertEmail(a, "tier_a", 1, "ta_2", now - 5 * M);
    const c = insertEmail(b, "booked", 0, "bk_confirm", now - M);
    await processEmailQueue(await rt());
    const held = email(m);
    expect(held.status).toBe("pending");
    expect(held.error).toBe("quiet hours");
    const at = held.send_at as number;
    expect(at).toBeGreaterThanOrEqual(zonedTime(2026, 10, 14, 8, 0, TZ));
    expect(at).toBeLessThan(zonedTime(2026, 10, 14, 8, 20, TZ));
    expect(email(c).status).toBe("simulated");
    // In the morning it goes (not stale: the hold moved its due time).
    vi.setSystemTime(at + M);
    await processEmailQueue(await rt());
    expect(email(m).status).toBe("simulated");
  });
  it("caps marketing at MAX_MARKETING_PER_DAY a local day; booked reminders are exempt", async () => {
    const a = insertLead({ status: "booked", call_at: NOON + 5 * H, booking_verified: 1 });
    insertEmail(a, "tier_a", 0, "ta_1", NOON - 3 * H, { status: "simulated", sent_at: NOON - 3 * H });
    insertEmail(a, "behaviour", 0, "t_cost", NOON - 2 * H, { status: "simulated", sent_at: NOON - 2 * H });
    const third = insertEmail(a, "precall", 0, "pc_agenda", NOON - M);
    await processEmailQueue(await rt());
    expect(email(third)).toMatchObject({ status: "pending", error: "daily cap" });
    expect(email(third).send_at as number).toBeGreaterThanOrEqual(zonedTime(2026, 10, 14, 8, 0, TZ));
    const rem = insertEmail(a, "booked", 6, "bk_2h", NOON + 3 * H - M);
    vi.setSystemTime(NOON + 3 * H);
    await processEmailQueue(await rt());
    expect(email(rem).status).toBe("simulated");
    // The setting moves the cap.
    env.MAX_MARKETING_PER_DAY = "5";
    clearSettingsCache();
    const b = insertLead();
    insertEmail(b, "tier_a", 0, "ta_1", NOON - 3 * H, { status: "simulated", sent_at: NOON + 3 * H - 10 * M });
    insertEmail(b, "behaviour", 0, "t_cost", NOON - 2 * H, { status: "simulated", sent_at: NOON + 3 * H - 5 * M });
    const ok = insertEmail(b, "tier_a", 1, "ta_2", NOON + 3 * H - M);
    await processEmailQueue(await rt());
    expect(email(ok).status).toBe("simulated");
  });
  it("skipBacklog skips pending mail due more than an hour ago and leaves the rest", async () => {
    const a = insertLead();
    const old1 = insertEmail(a, "tier_a", 3, "ta_4", NOON - 3 * H);
    const old2 = insertEmail(a, "nurture", 0, "nu_industry", NOON - 20 * DAY);
    const recent = insertEmail(a, "tier_a", 4, "ta_5", NOON - 30 * M);
    const future = insertEmail(a, "tier_a", 5, "ta_6", NOON + DAY);
    const done = insertEmail(a, "tier_a", 0, "ta_1", NOON - 2 * DAY, { status: "sent", sent_at: NOON - 2 * DAY });
    expect(await skipBacklog(await rt())).toBe(2);
    expect(email(old1)).toMatchObject({ status: "skipped", error: "backlog" });
    expect(email(old2).status).toBe("skipped");
    expect(email(recent).status).toBe("pending");
    expect(email(future).status).toBe("pending");
    expect(email(done).status).toBe("sent");
    expect(await skipBacklog(await rt(), 10 * M)).toBe(1);
  });
});

// ── 2. Pre-call run ──────────────────────────────────────────────────────────

describe("pre-call run", () => {
  it("defaults to one a day, at most five per booking, ranked by blockers and goal", async () => {
    const callAt = zonedTime(2026, 10, 23, 15, 0, TZ);
    const a = insertLead({ status: "booked", call_at: callAt, booking_verified: 1, answers: JSON.stringify({ business: "Clinics", goal: "cut_costs", blockers: ["agency_lockin", "time"], spend: "100k_300k" }) });
    const lead = db.q("SELECT * FROM leads WHERE id = ?", a)[0] as unknown as Lead;
    const n = await enqueueSequence(await rt(), lead, "precall");
    expect(n).toBeGreaterThan(0);
    expect(n).toBeLessThanOrEqual(PRECALL_MAX_TOTAL);
    const rows = db.q("SELECT template, send_at FROM emails WHERE lead_id = ? AND sequence = 'precall' ORDER BY step", a);
    const perDay: Record<string, number> = {};
    for (const r of rows) { const p = localParts(r.send_at as number, TZ); perDay[`${p.mo}-${p.d}`] = (perDay[`${p.mo}-${p.d}`] || 0) + 1; }
    expect(Math.max(...Object.values(perDay))).toBe(1);
    expect(rows[0].template).toBe("pp_brief");
    expect(rows[1].template).toBe("pc_agency"); // first blocker: agency lock-in (also matches the goal)
    const d = buildDossier(lead);
    expect(rankPrecall(d).slice(0, 2)).toEqual(["pc_agency", "pc_two_paths"]);
    expect(precallPlan(d).length).toBeLessThanOrEqual(5);
  });
  it("stops after three unopened in a row", async () => {
    const a = insertLead({ status: "booked", call_at: NOON + 4 * DAY, booking_verified: 1 });
    for (let i = 0; i < 3; i++) insertEmail(a, "precall", i, "pc_agenda", NOON - (5 - i) * DAY, { status: "sent", sent_at: NOON - (5 - i) * DAY, opens: 0 });
    const next = insertEmail(a, "precall", 3, "pc_rent", NOON - M);
    const later = insertEmail(a, "precall", 4, "pc_saas", NOON + DAY);
    await processEmailQueue(await rt());
    expect(email(next)).toMatchObject({ status: "cancelled", error: "unopened" });
    expect(email(later).status).toBe("cancelled");
  });
  it("one open keeps it going", async () => {
    const a = insertLead({ status: "booked", call_at: NOON + 4 * DAY, booking_verified: 1 });
    for (let i = 0; i < 3; i++) insertEmail(a, "precall", i, "pc_agenda", NOON - (5 - i) * DAY, { status: "sent", sent_at: NOON - (5 - i) * DAY, opens: i === 1 ? 1 : 0 });
    const next = insertEmail(a, "precall", 3, "pc_rent", NOON - M);
    await processEmailQueue(await rt());
    expect(email(next).status).toBe("simulated");
  });
  it("stops once attendance is confirmed for this call", () => {
    const callAt = NOON + 2 * DAY;
    const l = { status: "booked", call_at: callAt, attendance_confirmed_at: NOON, attendance_call_at: callAt } as unknown as Lead;
    expect(SEQUENCES.precall.stopIf(l)).toBe(true);
    expect(SEQUENCES.precall.stopIf({ ...l, attendance_call_at: callAt - H } as Lead)).toBe(false);
  });
  it("bk_3h goes only to people who confirmed; bk_2h only to people who did not (never both)", () => {
    const steps = SEQUENCES.booked.steps;
    const s3 = steps.find((s) => s.template === "bk_3h")!, s2 = steps.find((s) => s.template === "bk_2h")!;
    const callAt = NOON + DAY;
    const confirmed = { status: "booked", call_at: callAt, attendance_confirmed_at: NOON, attendance_call_at: callAt } as unknown as Lead;
    const not = { status: "booked", call_at: callAt } as unknown as Lead;
    expect(attendanceConfirmedFor(confirmed)).toBe(true);
    expect([s3.skipIf!(confirmed), s2.skipIf!(confirmed)]).toEqual([false, true]);
    expect([s3.skipIf!(not), s2.skipIf!(not)]).toEqual([true, false]);
  });
});

// ── 3. Truthful copy ─────────────────────────────────────────────────────────

const FORBIDDEN: RegExp[] = [
  /I'?ve read your application/i, /\bI read your application\b/i, /I'?ve read it\b/i, /\bI read them\b/i,
  /I enjoyed the conversation/i,
  /\bmost (founders|clients|owners|businesses|people) (I|we) (work with|speak to|talk to|see)\b/i,
  /\b(founders|clients|owners) (I|we) (work with|speak to)\b/i,
  /\bour clients\b/i, /\bclients of ours\b/i, /\bsome founders keep\b/i, /\bmost don'?t need to\b/i,
  /\bplenty of founders talk to us\b/i, /\bthe question I hear most\b/i, /\bquoted six figures\b/i,
  /\bwe (build|do) (it|everything) for you\b/i, /\bwe do the work for you\b/i,
];

function ctx(lead: Partial<Lead>, callTime: string | null = null): EmailCtx {
  const d = buildDossier(lead);
  return {
    lead: lead as Lead, d, firstName: d.firstName, link: (p) => `https://x.test/r${p}`, a: (p, l) => `<a href="https://x.test${p}">${l}</a>`,
    bookPath: "/book", callTime, closerName: "Bendik", sigName: "Bendik", now: Date.now(),
  };
}

describe("truthful copy", () => {
  const full = ctx({ first_name: "Kari", status: "booked", call_at: Date.now() + DAY, industry: "dental", objection: "Price", lost_reason: "Trust",
    booking_answers: JSON.stringify([{ q: "Anything else?", a: "Our agency contract ends soon." }]),
    answers: JSON.stringify({ business: "Dental clinics", role: "co_owner", goal: "unsure", blockers: ["dev_capacity", "tool_sprawl"], spend: "25k_100k", readiness: "partner", timeline: "exploring", why_now: "Because." }) }, "Tuesday 14 October at 15:00 (CEST)");
  const empty = ctx({ answers: "{}" });
  it("no automatic email claims a person read something, or implies clients that may not exist", () => {
    for (const [id, t] of Object.entries(TEMPLATES)) {
      for (const c of [full, empty]) {
        const e = t(c);
        const all = [e.subject, e.preheader || "", ...e.paragraphs, e.ps || ""].join("\n");
        for (const re of FORBIDDEN) {
          if (id === "fu_recap" && /enjoyed the conversation/.test(re.source)) continue; // sent after a real call (HQ owns it)
          expect(all, `${id}: ${re}`).not.toMatch(re);
        }
        for (const b of BANNED_PHRASES) expect(all.toLowerCase(), `${id}: ${b}`).not.toContain(b);
      }
    }
  });
  it("the first emails after submit say the application came through, not that it was read", () => {
    for (const id of ["ta_1", "tb_1", "tc_1"]) {
      const all = TEMPLATES[id](full).paragraphs.join(" ");
      expect(all).toMatch(/came through|on your answers/);
    }
    expect(TEMPLATES.ta_1(full).paragraphs.join(" ")).toContain("I'll read it properly before we speak.");
  });
  it("FAQ, landing and call copy carry no client claims", () => {
    const all = JSON.stringify({ FAQS, LANDING, OFFER, BREAKOUT, RESOURCES_PAGE, SMS_CONSENT });
    for (const re of FORBIDDEN) expect(all, String(re)).not.toMatch(re);
    expect(FAQS.find((f) => f.id === "after")!.a).toBe("Your team runs it. If you want a monthly session after that, we can set one up.");
    for (const b of BANNED_PHRASES) expect(all.toLowerCase(), b).not.toContain(b);
  });
  it("rent lines are general, not about who Bendik speaks to", () => {
    const e = TEMPLATES.pc_rent(full).paragraphs.join(" ");
    expect(e).toContain("Many dental practices rent");
    expect(TEMPLATES.pc_rent(empty).paragraphs.join(" ")).toContain("Many founders rent");
  });
  it("a and an", () => {
    expect(article("MSP")).toBe("an");
    expect(article("advisory firm")).toBe("an");
    expect(article("practice")).toBe("a");
  });
});

// ── 4. Landers ───────────────────────────────────────────────────────────────

describe("lander copy (all 100)", () => {
  const landers = allLanders();
  it("is 100 pages with clean copy", () => {
    expect(landers.length).toBe(INDUSTRIES.length * ANGLES.length);
    expect(landers.length).toBe(100);
    for (const l of landers) {
      const texts = [l.angle.pre(l.industry), l.headline, l.angle.sub(l.industry)];
      const { h1 } = splitHeadline(l.headline);
      const title = pageTitle(h1);
      expect(title, l.key).not.toMatch(/[.,:;]\s*$/);
      for (const t of texts) {
        expect(t, l.key).not.toMatch(/ {2}/);
        expect(t, l.key).not.toMatch(/\bthe (\w+)\b[^.]*\bnot the \1\b/i);
        expect(t, l.key).not.toMatch(/\b(\w+) owns the machine, not (?:the |an? |your )?\1\b/i);
        expect(t, l.key).not.toMatch(/\bads tracking\b|quoted six figures|live in two weeks|renting the [\w-]+ (fees|spend)\b/i);
        for (const b of BANNED_PHRASES) expect(t.toLowerCase(), `${l.key}: ${b}`).not.toContain(b);
      }
    }
  });
  it("the agency angle for agencies and the funnel angle read right", () => {
    const ag = landers.find((l) => l.key === "agencies/agency")!;
    expect(ag.angle.sub(ag.industry)).toContain("Your agency owns the machine, not your vendors.");
    expect(landers.find((l) => l.key === "dental/funnel")!.headline).toContain("live by week three");
    expect(pageTitle("Dental: in 56 days, Meta optimises for buyers,")).toBe(`${pageTitle("x").split(" · ")[0]} · Dental: in 56 days, Meta optimises for buyers`);
  });
});

// ── 5. Landing pieces ────────────────────────────────────────────────────────

describe("landing pieces", () => {
  it("keeps the owner's two headlines and adds C only when switched on", () => {
    expect(HEADLINES.slice(0, 2).map((h) => h.h1)).toEqual(["56 days to hands-free scaling.", "In 56 days, your funnel runs itself."]);
    expect(headlinePool(() => false).map((h) => h.id)).toEqual(["a", "b"]);
    expect(headlinePool((k) => k === "HEADLINE_C").map((h) => h.id)).toEqual(["a", "b", "c"]);
  });
  it("FAQ ids exist and the landing list is the agreed eight", () => {
    expect(LANDING.below.faqIds).toEqual(["what", "cost", "time", "tech", "guarantee", "data", "agency", "results"]);
    for (const id of LANDING.below.faqIds) expect(FAQS.find((f) => f.id === id), id).toBeDefined();
  });
  it("no-film card on phones: three items and a native disclosure for the rest", () => {
    const html = systemMobileHtml();
    expect(html.match(/<li>/g)?.length).toBe(LANDING.system.length);
    expect(html).toContain("<details class=\"fc-more\"><summary>See all six</summary>");
    expect(html.split("<details")[0].match(/<li>/g)?.length).toBe(3);
  });
  it("founder block only with a photo, safe links only", () => {
    expect(founderHtml({ photo: "", bio: "x", linkedin: "" })).toBe("");
    expect(founderHtml({ photo: "javascript:alert(1)", bio: "x", linkedin: "" })).toBe("");
    const h = founderHtml({ photo: "https://cdn.example.test/b.jpg", bio: "Line one.|Line <two>.|Line three.", linkedin: "https://www.linkedin.com/in/bendik" });
    expect(h).toContain('src="https://cdn.example.test/b.jpg"');
    expect(h.match(/founder-bio/g)?.length).toBe(2);
    expect(h).toContain("Line &lt;two&gt;.");
    expect(h).toContain('href="https://www.linkedin.com/in/bendik"');
    expect(founderHtml({ photo: "/assets/b.jpg", bio: "", linkedin: "https://evil.example/in/x" })).not.toContain("evil");
  });
  it("product shots are captioned as demo data, lazy, sized and described", () => {
    const h = productHtml();
    expect(h.match(/<figure/g)?.length).toBe(LANDING.product.shots.length);
    expect(h.match(/Demo data/g)?.length).toBe(LANDING.product.shots.length);
    for (const m of h.matchAll(/<img ([^>]+)>/g)) {
      expect(m[1]).toMatch(/loading="lazy"/);
      expect(m[1]).toMatch(/decoding="async"/);
      expect(m[1]).toMatch(/width="\d+" height="\d+"/);
      expect(m[1]).toMatch(/alt="[^"]{20,}"/);
    }
  });
  it("product images exist and are small", async () => {
    const mod = "node:fs";
    const fs = (await import(/* @vite-ignore */ mod)) as { statSync(p: string): { size: number } };
    for (const s of LANDING.product.shots) expect(fs.statSync(`public${s.src}`).size).toBeLessThan(120 * 1024);
  });
});

// ── 6. C tier ────────────────────────────────────────────────────────────────

describe("C-tier page", () => {
  it("branches the sub-line on the lead's flags", () => {
    expect(resourcesSub({ qual_flags: "excluded_industry,under_1m", score_breakdown: null })).toBe(RESOURCES_PAGE.sub.excluded_industry);
    expect(resourcesSub({ qual_flags: "no_business", score_breakdown: null })).toBe(RESOURCES_PAGE.sub.no_business);
    expect(resourcesSub({ qual_flags: null, score_breakdown: JSON.stringify({ flags: ["under_1m"] }) })).toBe(RESOURCES_PAGE.sub.under_1m);
    expect(resourcesSub({ qual_flags: "exploring", score_breakdown: null })).toBe(RESOURCES_PAGE.sub.low);
    expect(resourcesSub(null)).toBe(RESOURCES_PAGE.sub.low);
  });
  it("hides resources without a URL", () => {
    expect(resourcesHtml([{ title: "A", body: "b" }, { title: "B", body: "c", url: "https://example.test/b" }])).not.toContain(">A<");
    expect(resourcesHtml([{ title: "A", body: "b" }])).toBe("");
  });

  function linksApp() {
    const app = new Hono<AppEnv>();
    app.use("*", async (c, next) => { c.set("rt", await makeRuntime(c.env, null, c.req.url)); await next(); });
    app.route("/", links);
    return app;
  }
  it("/go/review is signed, records once with a person's click, and refuses cross-site posts", async () => {
    const a = insertLead({ tier: "C", route: "/resources", qual_flags: "under_1m" });
    const sig = await reviewSig(await rt(), a);
    const app = linksApp();
    const url = `https://apply.example.test/go/review/${a}/${sig}`;
    // A scanner (no Sec-Fetch-User) gets a button and records nothing.
    let r = await app.request(url, {}, env);
    expect(r.status).toBe(200);
    expect(await r.text()).toContain('method="post"');
    expect(db.q("SELECT review_requested_at FROM lead_revops WHERE lead_id = ?", a)[0]?.review_requested_at ?? null).toBeNull();
    // Bad signature: back to /resources.
    r = await app.request(`https://apply.example.test/go/review/${a}/${"0".repeat(24)}`, { headers: { "sec-fetch-user": "?1" } }, env);
    expect(r.status).toBe(302);
    // Cross-site POST refused.
    r = await app.request(url, { method: "POST", headers: { "sec-fetch-site": "cross-site", origin: "https://evil.example" } }, env);
    expect(r.status).toBe(403);
    // A person's click records it and pings the team once.
    r = await app.request(url, { headers: { "sec-fetch-user": "?1", "sec-fetch-dest": "document" } }, env);
    expect(await r.text()).toContain("second look");
    expect(db.q("SELECT review_requested_at FROM lead_revops WHERE lead_id = ?", a)[0].review_requested_at).toBe(NOON);
    vi.setSystemTime(NOON + H);
    await app.request(url, { method: "POST", headers: { "sec-fetch-site": "same-origin", origin: "https://apply.example.test" } }, env);
    expect(db.q("SELECT review_requested_at FROM lead_revops WHERE lead_id = ?", a)[0].review_requested_at).toBe(NOON);
    // Not for A/B leads.
    const b = insertLead({ tier: "A" });
    r = await app.request(`https://apply.example.test/go/review/${b}/${await reviewSig(await rt(), b)}`, { headers: { "sec-fetch-user": "?1" } }, env);
    expect(r.status).toBe(302);
  });
});

// ── 7. Form ──────────────────────────────────────────────────────────────────

describe("form: company website and where they heard about us", () => {
  it("validates the website and scores nothing", () => {
    expect(cleanWebsite("acme.no")).toBe("https://acme.no");
    expect(cleanWebsite("HTTP://WWW.Acme.co.uk/en/")).toBe("https://www.acme.co.uk/en");
    for (const bad of ["javascript:alert(1)", "localhost", "http://10.0.0.1", "https://user:pw@acme.no", "not a site", "ftp://acme.no", "acme"]) expect(cleanWebsite(bad), bad).toBeNull();
    expect(cleanAnswer("company_url", "acme.no")).toBe("https://acme.no");
    expect(cleanAnswer("company_url", "")).toBe("");
    expect(cleanAnswer("company_url", "<script>")).toBeNull();
    const q = APPLICATION.find((x) => x.id === "company_url")!;
    expect(q.inlineWith).toBe("business");
    expect(q.optional && !q.lengthPoints && !q.options).toBe(true);
  });
  it("heard_about is after submit, multi-choice with Other text, and reaches the dossier", () => {
    expect(cleanAnswer("heard_about", ["linkedin", "nope", "other"])).toEqual(["linkedin", "other"]);
    const d = buildDossier({ answers: JSON.stringify({ heard_about: ["linkedin", "other"], heard_about_other: "A <b>newsletter</b>", company_url: "https://acme.no" }) } as Lead);
    expect(d.heardAbout.map((h) => h.value)).toEqual(["linkedin", "other"]);
    expect(d.heardAboutOther).not.toContain("<b>");
    expect(d.website).toBe("https://acme.no");
  });
  it("the application cfg carries the inline and after-submit flags, and the text box only when switched on", () => {
    const rtOff = { settings: { get: () => "" } } as unknown as Runtime;
    const id = { consentRequired: false, consent: "granted", geo: { country: "NO" } } as never;
    const off = applicationCfg(rtOff, id, null) as { questions: Array<{ id: string; inlineWith: string; afterSubmit: boolean }>; smsConsent: unknown };
    expect(off.smsConsent).toBeNull();
    expect(off.questions.find((q) => q.id === "company_url")?.inlineWith).toBe("business");
    expect(off.questions.find((q) => q.id === "heard_about")?.afterSubmit).toBe(true);
    const rtOn = { settings: { get: (k: string) => (k === "SMS_REMINDERS" ? "true" : "") } } as unknown as Runtime;
    const on = applicationCfg(rtOn, id, null) as { smsConsent: { label: string } };
    expect(on.smsConsent.label).toBe(SMS_CONSENT.label);
    expect(SMS_CONSENT.label).not.toBe(CALL_CONSENT.label);
  });
  it("apply.js keeps the text box separate and unticked by default", async () => {
    const mod = "node:fs";
    const fs = (await import(/* @vite-ignore */ mod)) as { readFileSync(p: string, e: string): string };
    const js = fs.readFileSync("public/assets/apply.js", "utf8");
    expect(js).toContain('el("input", { type: "checkbox", name: "sms_consent", id: "f-sms" })');
    expect(js).not.toMatch(/f-sms"[^)]*checked: true/);
    expect(js).toContain("sms_consent: sms ? sms.checked : undefined");
  });
});

// ── 8. Text reminders ────────────────────────────────────────────────────────

describe("text reminders: pure", () => {
  const zones = ["Europe/Oslo"];
  it("times land inside calling hours or are dropped", () => {
    const call = zonedTime(2026, 10, 15, 14, 0, TZ); // Thursday 14:00
    expect(smsSendTime("booked", NOON, call, zones, "NO")).toBe(NOON);
    expect(smsSendTime("24h", NOON, call, zones, "NO")).toBe(call - DAY);
    expect(smsSendTime("1h", NOON, call, zones, "NO")).toBe(call - H);
    // An 08:30 call: the 1 h reminder (07:30) is outside hours and cannot move far enough, so it is dropped;
    // the 24 h one (08:30 the day before) has no allowed time in the 12 h before it, so it moves to 09:00.
    const early = zonedTime(2026, 10, 15, 8, 30, TZ);
    expect(smsSendTime("1h", NOON, early, zones, "NO")).toBeNull();
    const t24 = smsSendTime("24h", NOON, early, zones, "NO")!;
    expect(t24).toBe(zonedTime(2026, 10, 14, 9, 0, TZ));
    // A 10:00 call: 10:00 the day before is allowed as it is.
    expect(smsSendTime("24h", NOON, zonedTime(2026, 10, 15, 10, 0, TZ), zones, "NO")).toBe(zonedTime(2026, 10, 14, 10, 0, TZ));
    // Booked late on a Saturday evening: waits for Monday 09:00 (no Sunday texts).
    const sat = zonedTime(2026, 10, 17, 21, 0, TZ);
    const t = smsSendTime("booked", sat, zonedTime(2026, 10, 20, 15, 0, TZ), zones, "NO")!;
    expect(localParts(t, TZ)).toMatchObject({ dow: 1, hh: 9, mm: 0 });
    expect(smsSendTime("booked", NOON, NOON + 10 * M, zones, "NO")).toBeNull();
  });
  it("bodies: first name only, a STOP line, and Reply 1 until confirmed", () => {
    const b = smsBody("24h", { first: "Kari", closer: "Bendik", when: "Thursday 15 October at 14:00 (CEST)", confirmed: false, join: null });
    expect(b).toContain("Reply 1");
    expect(b).toContain("Reply STOP");
    expect(b.length).toBeLessThan(320);
    expect(smsBody("24h", { first: "Kari", closer: "Bendik", when: "x", confirmed: true, join: null })).not.toContain("Reply 1");
    expect(smsBody("1h", { first: "", closer: "Bendik", when: "x", confirmed: true, join: "https://zoom.example/j/1" })).toContain("Join: https://zoom.example/j/1");
  });
  it("keywords", () => {
    expect(inboundAction(" STOP ")).toBe("stop");
    expect(inboundAction("Unsubscribe")).toBe("stop");
    expect(inboundAction("help")).toBe("help");
    expect(inboundAction("1")).toBe("confirm");
    expect(inboundAction("Yes!")).toBe("confirm");
    expect(inboundAction("stop calling me maybe")).toBe("other");
  });
  it("signs like Twilio (HMAC-SHA1 over URL + sorted params, base64)", async () => {
    const mod = "node:crypto";
    const nodeCrypto = (await import(/* @vite-ignore */ mod)) as { createHmac(a: string, k: string): { update(s: string): { digest(e: string): string } } };
    const params = { CallSid: "CA1234567890ABCDE", Caller: "+12349013030", Digits: "1234", From: "+12349013030", To: "+18005551212" };
    const url = "https://mycompany.com/myapp.php?foo=1&bar=2";
    const expected = nodeCrypto.createHmac("sha1", "12345").update(url + "CallSid" + params.CallSid + "Caller" + params.Caller + "Digits1234From" + params.From + "To" + params.To).digest("base64");
    expect(await twilioSignature("12345", url, params)).toBe(expected);
  });
});

describe("text reminders: queue and webhook", () => {
  const PHONE = "+4791234567";
  function hooksApp() {
    const app = new Hono<AppEnv>();
    app.use("*", async (c, next) => { c.set("rt", await makeRuntime(c.env, null, c.req.url)); await next(); });
    app.route("/hooks/twilio-sms", smsHooks);
    return app;
  }
  async function signedPost(path: string, params: Record<string, string>, token = "tok-" + "y".repeat(28), sigOverride?: string) {
    const url = `https://apply.example.test${path}`;
    const sig = sigOverride ?? (await twilioSignature(token, url, params));
    return hooksApp().request(url, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded", "x-twilio-signature": sig }, body: new URLSearchParams(params).toString() }, env);
  }
  const bookedLead = (f: Row = {}) => insertLead({ status: "booked", call_at: zonedTime(2026, 10, 15, 14, 0, TZ), booking_verified: 1, phone: PHONE, ...f });

  it("needs its own consent and the switch; schedules three texts at booking, simulated without keys", async () => {
    const a = bookedLead();
    let lead = db.q("SELECT * FROM leads WHERE id = ?", a)[0] as unknown as Lead;
    expect(await scheduleSmsReminders(await rt(), lead)).toBe(0); // switch off
    env.SMS_REMINDERS = "true"; clearSettingsCache();
    db.x("UPDATE leads SET call_consent_at = ? WHERE id = ?", NOON, a); // the call consent is not text consent
    lead = db.q("SELECT * FROM leads WHERE id = ?", a)[0] as unknown as Lead;
    expect(await scheduleSmsReminders(await rt(), lead)).toBe(0);
    await recordSmsConsent(await rt(), a, PHONE, true);
    expect(await smsConsentGiven(await rt(), PHONE)).toBe(true);
    // Through the real booking hook: enqueueSequence("booked") queues the texts too.
    await enqueueSequence(await rt(), lead, "booked");
    const rows = db.q("SELECT kind, send_at FROM sms_messages WHERE lead_id = ? ORDER BY send_at", a);
    expect(rows.map((r) => r.kind)).toEqual(["booked", "24h", "1h"]);
    const out = await processSmsQueue(await rt());
    expect(out.simulated).toBe(1);
    const sent = db.q("SELECT status, body FROM sms_messages WHERE lead_id = ? AND kind = 'booked'", a)[0];
    expect(sent.status).toBe("simulated");
    expect(String(sent.body)).toContain("Reply 1");
    expect(vi.mocked(fetch)).not.toHaveBeenCalledWith(expect.stringContaining("twilio"), expect.anything());
    // Withdrawn (unticked on the form): queued texts are cancelled.
    await recordSmsConsent(await rt(), a, PHONE, false);
    expect(db.q("SELECT COUNT(*) AS n FROM sms_messages WHERE lead_id = ? AND status = 'pending'", a)[0].n).toBe(0);
  });

  it("sends through Twilio with keys, and a cancelled booking texts nothing", async () => {
    env.SMS_REMINDERS = "true"; env.TWILIO_ACCOUNT_SID = "AC" + "1".repeat(32); env.TWILIO_AUTH_TOKEN = "tok-" + "y".repeat(28); env.TWILIO_SMS_FROM = "+4790000000";
    clearSettingsCache();
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ sid: "SM" + "a".repeat(32) }), { status: 201 })));
    const a = bookedLead();
    await recordSmsConsent(await rt(), a, PHONE, true);
    await scheduleSmsReminders(await rt(), db.q("SELECT * FROM leads WHERE id = ?", a)[0] as unknown as Lead);
    await processSmsQueue(await rt());
    const call = vi.mocked(fetch).mock.calls[0];
    expect(String(call[0])).toContain(`/Accounts/AC${"1".repeat(32)}/Messages.json`);
    const body = new URLSearchParams(String((call[1] as RequestInit).body));
    expect(body.get("To")).toBe(PHONE);
    expect(body.get("StatusCallback")).toBe("https://apply.example.test/hooks/twilio-sms/status");
    expect(db.q("SELECT status, provider_id FROM sms_messages WHERE lead_id = ? AND kind = 'booked'", a)[0]).toMatchObject({ status: "sent", provider_id: "SM" + "a".repeat(32) });
    // Delivery receipt marks it delivered.
    const r = await signedPost("/hooks/twilio-sms/status", { MessageSid: "SM" + "a".repeat(32), MessageStatus: "delivered" });
    expect(r.status).toBe(204);
    expect(db.q("SELECT status FROM sms_messages WHERE lead_id = ? AND kind = 'booked'", a)[0].status).toBe("delivered");
    // Cancelled before the 24 h text: skipped at send time.
    db.x("UPDATE leads SET booking_cancelled_at = ?, status = 'applied' WHERE id = ?", NOON, a);
    vi.setSystemTime(zonedTime(2026, 10, 14, 14, 0, TZ));
    await processSmsQueue(await rt());
    expect(db.q("SELECT status, error FROM sms_messages WHERE lead_id = ? AND kind = '24h'", a)[0]).toMatchObject({ status: "skipped", error: "call changed" });
  });

  it("a delivered text reminder keeps the 3 h and 1 h emails quiet", async () => {
    const callAt = NOON + 50 * M;

    const a = insertLead({ status: "booked", call_at: callAt, booking_verified: 1, phone: PHONE });
    db.x("INSERT INTO sms_messages (id, lead_id, kind, direction, phone, call_at, send_at, status, created_at) VALUES ('s1', ?, '24h', 'out', ?, ?, ?, 'delivered', ?)", a, PHONE, callAt, callAt - DAY, callAt - DAY);
    const e = insertEmail(a, "booked", 4, "bk_1h", callAt - H);
    await processEmailQueue(await rt());
    expect(email(e)).toMatchObject({ status: "skipped", error: "text reminder delivered" });
  });

  it("webhook: fails closed, verifies the signature, STOP and 1", async () => {
    const r0 = await signedPost("/hooks/twilio-sms", { From: PHONE, Body: "1" });
    expect(r0.status).toBe(501); // no auth token
    env.SMS_REMINDERS = "true"; env.TWILIO_AUTH_TOKEN = "tok-" + "y".repeat(28); clearSettingsCache();
    const a = bookedLead();
    await recordSmsConsent(await rt(), a, PHONE, true);
    const bad = await signedPost("/hooks/twilio-sms", { From: PHONE, Body: "1" }, undefined, "AAAA");
    expect(bad.status).toBe(403);
    const ok = await signedPost("/hooks/twilio-sms", { From: PHONE, Body: "1", MessageSid: "SM" + "b".repeat(32) });
    expect(ok.status).toBe(200);
    expect(ok.headers.get("content-type")).toContain("text/xml");
    expect(await ok.text()).toContain("you&#39;re confirmed");
    const l = db.q("SELECT attendance_confirmed_at, attendance_call_at, call_at FROM leads WHERE id = ?", a)[0];
    expect(l.attendance_confirmed_at).toBe(NOON);
    expect(l.attendance_call_at).toBe(l.call_at);
    // HELP answers; STOP stops everything, outlives the consent row, and the queue sends nothing more.
    expect(await (await signedPost("/hooks/twilio-sms", { From: PHONE, Body: "HELP" })).text()).toContain("Reply STOP");
    await scheduleSmsReminders(await rt(), db.q("SELECT * FROM leads WHERE id = ?", a)[0] as unknown as Lead);
    const stop = await signedPost("/hooks/twilio-sms", { From: PHONE, Body: "STOP" });
    expect(await stop.text()).toContain("<Response/>");
    expect(await smsConsentGiven(await rt(), PHONE)).toBe(false);
    expect(db.q("SELECT COUNT(*) AS n FROM sms_messages WHERE lead_id = ? AND direction = 'out' AND status = 'pending'", a)[0].n).toBe(0);
    expect(db.q("SELECT COUNT(*) AS n FROM suppressions WHERE kind = 'sms'")[0].n).toBe(1);
    expect(await scheduleSmsReminders(await rt(), db.q("SELECT * FROM leads WHERE id = ?", a)[0] as unknown as Lead)).toBe(0);
    // Erasing the lead removes its consent row and texts (the STOP hash stays).
    db.x("DELETE FROM leads WHERE id = ?", a);
    expect(db.q("SELECT COUNT(*) AS n FROM sms_consent")[0].n).toBe(0);
    expect(db.q("SELECT COUNT(*) AS n FROM sms_messages")[0].n).toBe(0);
    expect(db.q("SELECT COUNT(*) AS n FROM suppressions WHERE kind = 'sms'")[0].n).toBe(1);
  });

  it("migration 0021 leaves leads untouched", () => {
    expect(db.q("SELECT COUNT(*) AS n FROM pragma_table_info('leads')")[0].n).toBe(96);
    expect(db.q("SELECT COUNT(*) AS n FROM pragma_table_info('lead_revops') WHERE name = 'review_requested_at'")[0].n).toBe(1);
  });
});
