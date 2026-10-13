// Public API used by the funnel pages. Same-origin only; bodies are capped and validated.

import { Hono } from "hono";
import { getCookie, setCookie } from "hono/cookie";
import type { AppEnv, Ctx } from "../app";
import { COOKIE, linkVisitorToLead, resolveIdentity, setConsentCookies } from "../lib/identity";
import { escHtml } from "../lib/text";
import { BRAND } from "../config";
import { kvGate, kvIncr } from "../lib/kv";
import { sha256Hex } from "../lib/crypto";
import { ipKey } from "../admin/auth";
import { whoFromIdentity, track } from "../tracking/track";
import { collectBeacon, BEACON_MAX_BYTES, type BeaconBody } from "../tracking/collect";
import { recordHeartbeat } from "../tracking/vsl";
import {
  saveContact, saveAnswers, submitApplication, bookInlineSlot, nojsContact, sweepHotPartials, confirmNojsLead, nojsUnverified, verifyNojsSig,
} from "../funnel/application";
import { getLead } from "../funnel/leads";
import { verifyClientBooking } from "../integrations/calendly";

export const api = new Hono<AppEnv>();

function sameOrigin(c: Ctx): boolean {
  const site = c.req.header("sec-fetch-site");
  if (site) return site === "same-origin";
  const origin = c.req.header("origin");
  if (!origin) return false;
  try {
    return new URL(origin).host === new URL(c.req.url).host;
  } catch {
    return false;
  }
}

async function readJson<T>(c: Ctx, max: number): Promise<T | null> {
  const len = Number(c.req.header("content-length") || 0);
  if (len > max) return null;
  const text = await c.req.text();
  if (text.length > max) return null;
  try {
    const v = JSON.parse(text);
    return v && typeof v === "object" ? (v as T) : null;
  } catch {
    return null;
  }
}

async function rateLimited(c: Ctx, bucket: string, max: number, windowMs: number): Promise<boolean> {
  const ip = c.req.header("cf-connecting-ip") || "unknown";
  const ipHash = (await sha256Hex("rl|" + ipKey(ip))).slice(0, 16); // never store the raw IP; IPv6 grouped by /64
  const n = await kvIncr(c.env, `rl:${bucket}:${ipHash}:${Math.floor(Date.now() / windowMs)}`);
  return n > max;
}

// ── No-JS email confirmation (registered before the POST-only guard below) ───
// GET /api/apply/nojs/confirm/<lead>/<sig>: the signed link in the one email an unconfirmed no-JS lead gets.
// Only a person's click confirms (Sec-Fetch-User, like /go/confirm); link scanners and prefetchers get a
// page with a button that POSTs back here.

function nojsPage(title: string, body: string, form: string | null, status: 200 | 400 | 404 = 200): Response {
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex, nofollow"><title>${escHtml(title)}</title>
<link rel="stylesheet" href="/assets/site.css"></head><body class="plain"><main class="plain-card"><p class="brand-mark">${escHtml(BRAND.name)}</p><h1>${escHtml(title)}</h1><p>${escHtml(body)}</p>${form || ""}</main></body></html>`;
  return new Response(html, { status, headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" } });
}

const userClick = (c: Ctx) => c.req.header("sec-fetch-user") === "?1" && (c.req.header("sec-fetch-dest") || "document") === "document";

async function nojsConfirmRoute(c: Ctx, viaPost: boolean): Promise<Response> {
  c.header("cache-control", "no-store");
  const rt = c.get("rt");
  const leadId = c.req.param("lead") || "";
  const sig = c.req.param("sig") || "";
  if (!(await verifyNojsSig(rt, leadId, sig))) return nojsPage("Link not valid", "This confirmation link is not valid. Please apply again.", null, 400);
  const lead = await getLead(rt, leadId);
  if (!lead) return nojsPage("Link not valid", "We can't find this application any more. Please apply again.", null, 404);
  if (!(await nojsUnverified(rt, lead.id))) return c.redirect("/apply", 303);
  if (!viaPost && !userClick(c)) {
    return nojsPage("Confirm your email", "Press the button to confirm your email and continue your application.",
      `<form method="post" action="/api/apply/nojs/confirm/${escHtml(leadId)}/${escHtml(sig)}"><button class="btn" type="submit">Confirm my email</button></form>`);
  }
  // A signed email link proves the inbox: this browser continues as that lead.
  const id = await resolveIdentity(c, { page: false });
  if (id.leadId !== lead.id) await linkVisitorToLead(rt, id.visitorId, lead.id);
  id.leadId = lead.id;
  await confirmNojsLead(rt, lead, id);
  return c.redirect("/apply", 303);
}

api.get("/apply/nojs/confirm/:lead/:sig", (c) => nojsConfirmRoute(c, false));

api.use("*", async (c, next) => {
  c.header("cache-control", "no-store");
  if (c.req.method !== "POST") return c.json({ error: "method" }, 405);
  if (!sameOrigin(c)) return c.json({ error: "cross-site request refused" }, 403);
  await next();
});

api.post("/e", async (c) => {
  if (await rateLimited(c, "e", 120, 60_000)) return c.json({ error: "rate" }, 429);
  const body = await readJson<BeaconBody>(c, BEACON_MAX_BYTES);
  if (!body) return c.json({ error: "bad body" }, 400);
  const id = await resolveIdentity(c, { page: false });
  const path = new URL(c.req.header("referer") || c.req.url).pathname;
  const n = await collectBeacon(c.get("rt"), whoFromIdentity(id, path), body);
  return c.json({ ok: true, n });
});

api.post("/v", async (c) => {
  if (await rateLimited(c, "v", 60, 60_000)) return c.json({ error: "rate" }, 429);
  const b = await readJson<Record<string, unknown>>(c, 4096);
  if (!b) return c.json({ error: "bad body" }, 400);
  const id = await resolveIdentity(c, { page: false });
  const path = new URL(c.req.header("referer") || c.req.url).pathname;
  const r = await recordHeartbeat(c.get("rt"), whoFromIdentity(id, path), {
    video: String(b.video || ""),
    duration: Number(b.d) || 0,
    position: Number(b.p) || 0,
    bitmap: String(b.b || ""),
    played: !!b.played,
    unmuted: !!b.unmuted,
    ctaClicked: !!b.cta,
  });
  return c.json({ ok: true, revealed: r.revealed });
});

api.post("/consent", async (c) => {
  if (await rateLimited(c, "consent", 30, 10 * 60_000)) return c.json({ error: "rate" }, 429);
  const b = await readJson<{ consent?: string }>(c, 512);
  const v = b?.consent === "granted" ? "granted" : "denied";
  setConsentCookies(c, v);
  const id = await resolveIdentity(c, { page: false });
  // With consent, the visitor id may persist across days.
  const secure = new URL(c.req.url).protocol === "https:";
  if (v === "granted") setCookie(c, "_fv", id.visitorId, { path: "/", httpOnly: true, secure, sameSite: "Lax", maxAge: 400 * 86_400 });
  else setCookie(c, "_fv", id.visitorId, { path: "/", httpOnly: true, secure, sameSite: "Lax" });
  await c.env.DB.prepare("UPDATE visitors SET consent = ? WHERE id = ?").bind(v, id.visitorId).run();
  await track(c.get("rt"), whoFromIdentity(id, "/"), { name: "consent_set", props: { consent: v }, localOnly: true });
  return c.json({ ok: true, consent: v });
});

// Strong partial applications: the team ping is due ~20 minutes after the mark. Swept on application
// traffic at most once a minute (the cron in src/index.ts may also call sweepHotPartials).
api.use("/apply/*", async (c, next) => {
  await next();
  const rt = c.get("rt");
  rt.waitUntil((async () => { if (await kvGate(c.env, "gate:hot_partial", 60_000)) await sweepHotPartials(rt); })());
});

// A lead created by the no-JS form (no bot check) cannot run the rest of the application (scoring, calls,
// pings, ad events) until its inbox confirms. Otherwise a script would post /nojs, then the JSON steps.
for (const p of ["/apply/answers", "/apply/submit", "/apply/book"]) {
  api.use(p, async (c, next) => {
    // Read-only lookup (resolveIdentity runs once, in the handler): the browser's visitor → its lead.
    const vid = getCookie(c, COOKIE.visitor) || "";
    const v = vid ? await c.env.DB.prepare("SELECT lead_id FROM visitors WHERE id = ?").bind(vid).first<{ lead_id: string | null }>().catch(() => null) : null;
    if (await nojsUnverified(c.get("rt"), v?.lead_id)) return c.json({ ok: false, code: "verify_email", error: "verify_email", message: "Please confirm your email first: we sent you a link." }, 403);
    await next();
  });
}

api.post("/apply/contact", async (c) => {
  if (await rateLimited(c, "contact", 20, 10 * 60_000)) return c.json({ ok: false, code: "rate", message: "Too many attempts. Please wait a few minutes." }, 429);
  const b = await readJson<Record<string, unknown>>(c, 4096);
  if (!b) return c.json({ ok: false, code: "bad", message: "Please try again." }, 400);
  const id = await resolveIdentity(c, { page: false });
  const r = await saveContact(c.get("rt"), id, b);
  if (!r.ok) return c.json(r, r.status);
  return c.json({ ok: true, ref: r.ref, phone_callable: r.phoneCallable, ...(r.consentDropped ? { call_consent_dropped: true } : {}) });
});

api.post("/apply/answers", async (c) => {
  if (await rateLimited(c, "answers", 80, 10 * 60_000)) return c.json({ ok: false, error: "rate" }, 429);
  const b = await readJson<{ answers?: Record<string, unknown>; step?: number; draft?: boolean }>(c, 8192);
  if (!b) return c.json({ ok: false }, 400);
  const id = await resolveIdentity(c, { page: false });
  const r = await saveAnswers(c.get("rt"), id, b);
  return c.json(r, r.ok ? 200 : 409);
});

api.post("/apply/submit", async (c) => {
  if (await rateLimited(c, "submit", 20, 10 * 60_000)) return c.json({ ok: false, error: "rate" }, 429);
  const b = await readJson<{ tz?: string }>(c, 512);
  const id = await resolveIdentity(c, { page: false });
  const r = await submitApplication(c.get("rt"), id, { tz: b?.tz });
  return c.json(r, r.ok ? 200 : 400);
});

/** Book one of the offered times from the form (A tier, or tiers in INLINE_BOOKING_TIERS). */
api.post("/apply/book", async (c) => {
  if (await rateLimited(c, "book", 5, 10 * 60_000)) return c.json({ ok: false, code: "rate", message: "Too many attempts. Please use the full calendar.", route: "/book" }, 429);
  const b = await readJson<{ start?: string; tz?: string }>(c, 512);
  if (!b) return c.json({ ok: false, code: "bad", message: "Please try again." }, 400);
  const id = await resolveIdentity(c, { page: false });
  const r = await bookInlineSlot(c.get("rt"), id, b);
  return c.json(r, r.ok ? 200 : r.status);
});

/**
 * No-JS fallback: a plain form post (name, email, phone) creates the lead like the contact step, then
 * 303 to /apply, where the rest needs JavaScript. Turnstile cannot run here, so the limits are tighter.
 */
api.post("/apply/nojs", async (c) => {
  const back = (q: string) => c.redirect(`/apply${q}`, 303);
  if (await rateLimited(c, "nojs", 3, 60 * 60_000)) return back("?nojs=rate");
  // The day-wide ceiling across all IPs (no bot challenge here) is counted in nojsContact, after validation.
  const len = Number(c.req.header("content-length") || 0);
  if (len > 4096) return back("?nojs=bad");
  const type = c.req.header("content-type") || "";
  if (!/application\/x-www-form-urlencoded|multipart\/form-data/.test(type)) return back("?nojs=bad");
  const form = (await c.req.parseBody().catch(() => ({}))) as Record<string, unknown>;
  const id = await resolveIdentity(c, { page: false });
  const r = await nojsContact(c.get("rt"), id, form);
  if (!r.ok) return back(`?nojs=${encodeURIComponent(r.code)}`);
  return back(r.created ? "?nojs=confirm" : "");
});

api.post("/apply/nojs/confirm/:lead/:sig", (c) => nojsConfirmRoute(c, true));

/** Calendly postMessage report from the browser. A claim: verified with the API when possible. */
api.post("/booking/client", async (c) => {
  if (await rateLimited(c, "booking", 10, 10 * 60_000)) return c.json({ ok: false, error: "rate" }, 429);
  const b = await readJson<{ event_uri?: string; invitee_uri?: string }>(c, 2048);
  const id = await resolveIdentity(c, { page: false });
  const rt = c.get("rt");
  const lead = await getLead(rt, id.leadId);
  if (!lead) return c.json({ ok: false }, 409);
  const status = await verifyClientBooking(rt, lead, b?.event_uri, b?.invitee_uri);
  await track(rt, whoFromIdentity(id, "/book"), { name: "booking_claimed", props: { verified: status === "verified" }, localOnly: true });
  return c.json({ ok: true, status, next: "/breakout" });
});
