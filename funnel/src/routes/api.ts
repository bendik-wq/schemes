// Public API used by the funnel pages. Same-origin only; bodies are capped and validated.

import { Hono } from "hono";
import { setCookie } from "hono/cookie";
import type { AppEnv, Ctx } from "../app";
import { resolveIdentity, setConsentCookies } from "../lib/identity";
import { kvIncr } from "../lib/kv";
import { whoFromIdentity, track } from "../tracking/track";
import { collectBeacon, BEACON_MAX_BYTES, type BeaconBody } from "../tracking/collect";
import { recordHeartbeat } from "../tracking/vsl";
import { saveContact, saveAnswers, submitApplication } from "../funnel/application";
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
  const n = await kvIncr(c.env, `rl:${bucket}:${ip}:${Math.floor(Date.now() / windowMs)}`);
  return n > max;
}

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
  if (v === "granted") setCookie(c, "_fv", id.visitorId, { path: "/", httpOnly: true, secure: new URL(c.req.url).protocol === "https:", sameSite: "Lax", maxAge: 400 * 86_400 });
  await c.env.DB.prepare("UPDATE visitors SET consent = ? WHERE id = ?").bind(v, id.visitorId).run();
  await track(c.get("rt"), whoFromIdentity(id, "/"), { name: "consent_set", props: { consent: v }, localOnly: true });
  return c.json({ ok: true, consent: v });
});

api.post("/apply/contact", async (c) => {
  if (await rateLimited(c, "contact", 20, 10 * 60_000)) return c.json({ ok: false, code: "rate", message: "Too many attempts. Please wait a few minutes." }, 429);
  const b = await readJson<Record<string, unknown>>(c, 4096);
  if (!b) return c.json({ ok: false, code: "bad", message: "Please try again." }, 400);
  const id = await resolveIdentity(c, { page: false });
  const r = await saveContact(c.get("rt"), id, b);
  if (!r.ok) return c.json(r, r.status);
  return c.json({ ok: true, ref: r.ref });
});

api.post("/apply/answers", async (c) => {
  if (await rateLimited(c, "answers", 80, 10 * 60_000)) return c.json({ ok: false, error: "rate" }, 429);
  const b = await readJson<{ answers?: Record<string, unknown>; step?: number }>(c, 8192);
  if (!b) return c.json({ ok: false }, 400);
  const id = await resolveIdentity(c, { page: false });
  const r = await saveAnswers(c.get("rt"), id, b);
  return c.json(r, r.ok ? 200 : 409);
});

api.post("/apply/submit", async (c) => {
  if (await rateLimited(c, "submit", 20, 10 * 60_000)) return c.json({ ok: false, error: "rate" }, 429);
  const id = await resolveIdentity(c, { page: false });
  const r = await submitApplication(c.get("rt"), id);
  return c.json(r, r.ok ? 200 : 400);
});

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
