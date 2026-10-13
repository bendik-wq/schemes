// The written call plan. /book promises "You leave with a written plan, whether or not we work together":
// the closer fills it in the "Showed" outcome modal, it is stored in call_plans, and the lead gets a signed,
// unlisted page at /plan/<token> (public/plan.html filled with HTMLRewriter, noindex, everything escaped).
//
// Email: fu_recap (src/followup/templates.ts) links to /plan/for/<lead id> through the signed email click,
// which identifies the browser as that lead; that route then redirects to the plan's token page. The recap
// goes ~2 hours after the call once a plan is saved, otherwise the neutral note goes after 24 hours.
// Opening the page records a `plan_view` event (server-side, local only) and stamps viewed_at, a buying
// signal on Today and in the lead drawer. Team members' views (an HQ session cookie) are not counted.

import type { Ctx, Runtime } from "../app";
import { BRAND } from "../config";
import { hmacHex, safeEqual } from "../lib/crypto";
import { signingSecret } from "../lib/secret";
import { newId } from "../lib/ids";
import { clip } from "../lib/text";
import { getLead, updateLead, type Lead } from "../funnel/leads";
import { track } from "../tracking/track";
import { resolveIdentity } from "../lib/identity";
import { getCookie } from "hono/cookie";
import { ADMIN_COOKIE } from "../admin/auth";
import { salesTz } from "../admin/stats";
import { getRep } from "./reps";
import { assetVersion, versioned } from "../funnel/pages";

const H = 3_600_000;

export interface PlanBody {
  first_build: string;
  why: string | null;
  keep: string | null;
  next_step: string;
  next_step_at: number | null;
  price: string | null;
  plan: string | null;
}

export interface PlanRow {
  id: string; lead_id: string; token: string; body: string; created_by: string | null; created_at: number; updated_at: number | null;
  viewed_at: number | null; last_viewed_at: number | null; views: number;
}

export class PlanError extends Error {}

const txt = (v: unknown, max: number): string | null => {
  if (v == null) return null;
  const s = clip(String(v).replace(/\r\n?/g, "\n"), max).trim();
  return s ? s : null;
};

/** Pure validation. First build and next step are required; everything else is optional. */
export function cleanPlan(input: Record<string, unknown>, now: number): PlanBody {
  const first = txt(input.first_build, 300);
  const next = txt(input.next_step, 300);
  if (!first) throw new PlanError("Write what we would build first.");
  if (!next) throw new PlanError("Write the next step.");
  let at: number | null = null;
  if (input.next_step_at != null && input.next_step_at !== "") {
    const t = typeof input.next_step_at === "number" ? input.next_step_at : Date.parse(String(input.next_step_at));
    if (!Number.isFinite(t) || t < now - 30 * 24 * H || t > now + 366 * 24 * H) throw new PlanError("Pick a date for the next step within the next year.");
    at = t;
  }
  return { first_build: first, why: txt(input.why, 1200), keep: txt(input.keep, 800), next_step: next, next_step_at: at, price: txt(input.price, 120), plan: txt(input.plan, 200) };
}

export function parsePlanBody(s: string | null | undefined): PlanBody | null {
  try {
    const v = JSON.parse(String(s || ""));
    return v && typeof v === "object" && typeof v.first_build === "string" ? (v as PlanBody) : null;
  } catch {
    return null;
  }
}

// ── Token ────────────────────────────────────────────────────────────────────

function randomHex(bytes: number): string {
  const a = new Uint8Array(bytes);
  crypto.getRandomValues(a);
  return [...a].map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function tokenSig(rt: Runtime, nonce: string): Promise<string> {
  return (await hmacHex(await signingSecret(rt.env), `plan|${nonce}`)).slice(0, 20);
}

/** <24 hex random>.<20 hex HMAC>: unguessable and checked before any database read. */
export async function newPlanToken(rt: Runtime): Promise<string> {
  const nonce = randomHex(12);
  return `${nonce}.${await tokenSig(rt, nonce)}`;
}

export async function verifyPlanToken(rt: Runtime, token: string): Promise<boolean> {
  const m = /^([0-9a-f]{24})\.([0-9a-f]{20})$/.exec(String(token || ""));
  return !!m && safeEqual(await tokenSig(rt, m[1]), m[2]);
}

// ── Storage ──────────────────────────────────────────────────────────────────

export async function getPlan(rt: Runtime, leadId: string): Promise<PlanRow | null> {
  return (await rt.env.DB.prepare("SELECT * FROM call_plans WHERE lead_id = ? ORDER BY created_at DESC LIMIT 1").bind(leadId).first<PlanRow>()) || null;
}

/** Save (or update) the lead's plan, mirror first build and the next-step date onto the deal, and time the recap. */
export async function savePlan(rt: Runtime, lead: Lead, input: Record<string, unknown>, by: string): Promise<PlanRow> {
  const body = cleanPlan(input, rt.now());
  const now = rt.now();
  const existing = await getPlan(rt, lead.id);
  if (existing) {
    await rt.env.DB.prepare("UPDATE call_plans SET body = ?, updated_at = ? WHERE id = ?").bind(JSON.stringify(body), now, existing.id).run();
  } else {
    await rt.env.DB.prepare("INSERT INTO call_plans (id, lead_id, token, body, created_by, created_at, updated_at) VALUES (?,?,?,?,?,?,?)")
      .bind(newId("cp"), lead.id, await newPlanToken(rt), JSON.stringify(body), by.slice(0, 60), now, now).run();
  }
  // The deal fields closers already use: "First build" and the follow-up date (shows on Today on the day).
  const patch: Partial<Lead> = { target_business: clip(body.first_build, 120) };
  if (body.next_step_at && (!lead.follow_up_at || lead.follow_up_at > body.next_step_at || lead.follow_up_at < now)) patch.follow_up_at = body.next_step_at;
  await updateLead(rt, lead.id, patch);
  await scheduleRecap(rt, lead.id, lead.call_at, true);
  return (await getPlan(rt, lead.id)) as PlanRow;
}

/**
 * Time the post-call recap (fu_recap, post_call step 0): about 2 hours after the call once a plan exists,
 * otherwise 24 hours after the call (a neutral note). The next step moves with it so two emails never land
 * within 12 hours of each other.
 */
export async function scheduleRecap(rt: Runtime, leadId: string, callAt: number | null, hasPlan: boolean): Promise<void> {
  const now = rt.now();
  const base = callAt && callAt <= now ? callAt : now;
  const at = hasPlan ? Math.max(now + 10 * 60_000, base + 2 * H) : Math.max(now + 10 * 60_000, base + 24 * H);
  const db = rt.env.DB;
  await db.prepare("UPDATE emails SET send_at = ? WHERE lead_id = ? AND sequence = 'post_call' AND step = 0 AND status = 'pending'").bind(at, leadId).run();
  await db.prepare("UPDATE emails SET send_at = ? WHERE lead_id = ? AND sequence = 'post_call' AND step = 1 AND status = 'pending' AND send_at < ?")
    .bind(at + 12 * H, leadId, at + 12 * H).run();
}

// ── Page ─────────────────────────────────────────────────────────────────────

export interface PlanView {
  first_name: string; closer: string; call_date: string; first_build: string; why: string | null; keep: string | null;
  next_step: string; next_step_at: string | null; price: string | null; plan: string | null;
}

function fmtDate(ms: number | null, tz: string): string | null {
  if (!ms) return null;
  return new Intl.DateTimeFormat("en-GB", { timeZone: tz, weekday: "long", day: "numeric", month: "long", year: "numeric" }).format(new Date(ms));
}

/** Pure-ish: what the page shows (plain text; HTMLRewriter escapes it). */
export function planView(body: PlanBody, lead: Pick<Lead, "first_name" | "call_at" | "timezone">, closer: string | null, tz: string): PlanView {
  const zone = lead.timezone || tz;
  return {
    first_name: (lead.first_name || "").trim().split(/\s+/)[0] || "you",
    closer: closer || BRAND.founder,
    call_date: fmtDate(lead.call_at, zone) || "our call",
    first_build: body.first_build, why: body.why, keep: body.keep, next_step: body.next_step,
    // A date picked in a date field is stored as UTC midnight: show that calendar day, not a shifted one.
    next_step_at: fmtDate(body.next_step_at, "UTC"), price: body.price, plan: body.plan,
  };
}

/** Fill public/plan.html. Empty optional sections are removed, never left blank. */
export async function renderPlanPage(c: Ctx, v: PlanView | null, status = 200): Promise<Response> {
  const res = await c.env.ASSETS.fetch(new Request(new URL("/plan.html", c.req.url).toString()));
  if (!res.ok) return c.text("Not found", 404);
  const text: Record<string, string | null> = v ? {
    first_name: v.first_name, closer: v.closer, call_date: v.call_date, first_build: v.first_build, why: v.why, keep: v.keep,
    next_step: v.next_step, next_step_at: v.next_step_at, price: v.price, plan: v.plan, brand: BRAND.name,
  } : { brand: BRAND.name };
  const ver = assetVersion(c.env);
  const rw = new HTMLRewriter()
    .on('link[rel="stylesheet"][href^="/assets/"]', { element(el) { el.setAttribute("href", versioned(el.getAttribute("href") || "", ver)); } })
    .on("title", { element(el) { el.setInnerContent(v ? `Your plan · ${BRAND.name}` : `Plan · ${BRAND.name}`); } })
    .on("[data-slot]", {
      element(el) {
        const k = el.getAttribute("data-slot") || "";
        if (k in text) el.setInnerContent(text[k] || "");
      },
    })
    .on("[data-if]", {
      element(el) {
        const k = el.getAttribute("data-if") || "";
        const show = k === "missing" ? !v : k === "has_plan" ? !!v : !!(v && text[k]);
        if (!show) el.remove();
        else el.removeAttribute("data-if");
      },
    });
  return new Response(rw.transform(res).body, { status, headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store", "x-robots-tag": "noindex, nofollow" } });
}

/** GET /plan/:token */
export async function planPage(c: Ctx): Promise<Response> {
  const rt = c.get("rt");
  const token = c.req.param("token") || "";
  if (!(await verifyPlanToken(rt, token))) return renderPlanPage(c, null, 404);
  const row = await rt.env.DB.prepare("SELECT * FROM call_plans WHERE token = ?").bind(token).first<PlanRow>();
  const body = parsePlanBody(row?.body);
  const lead = row ? await getLead(rt, row.lead_id) : null;
  if (!row || !body || !lead) return renderPlanPage(c, null, 404);
  // Team members opening it from HQ are not the lead: no event, no "viewed".
  const team = !!getCookie(c, ADMIN_COOKIE);
  if (!team) {
    const now = rt.now();
    await rt.env.DB.prepare("UPDATE call_plans SET viewed_at = COALESCE(viewed_at, ?), last_viewed_at = ?, views = views + 1 WHERE id = ?").bind(now, now, row.id).run();
    if (!row.viewed_at || now - (row.last_viewed_at || 0) > 30 * 60_000) {
      await track(rt, { leadId: lead.id, path: "/plan" }, { name: "plan_view", source: "server", localOnly: true, props: { first: row.viewed_at ? 0 : 1 } });
    }
  }
  const rep = await getRep(rt, lead.closer_id);
  return renderPlanPage(c, planView(body, lead, rep?.name || null, salesTz(rt)));
}

/** GET /plan/for/:lead — from the recap email (signed click), straight to the plan; otherwise a polite dead end. */
export async function planForLead(c: Ctx): Promise<Response> {
  const rt = c.get("rt");
  const leadId = c.req.param("lead") || "";
  if (!/^l[0-9a-z]{19}$/.test(leadId)) return renderPlanPage(c, null, 404);
  const id = await resolveIdentity(c, { page: false });
  if (id.leadId !== leadId) return renderPlanPage(c, null, 404);
  const row = await getPlan(rt, leadId);
  if (!row) return renderPlanPage(c, null, 404);
  return c.redirect(`/plan/${row.token}`, 302);
}

/** Absolute link for the team (copy button in the drawer). */
export function planUrl(rt: Runtime, token: string): string {
  return `${rt.origin}/plan/${token}`;
}
