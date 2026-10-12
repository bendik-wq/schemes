// Inbound webhooks. Every one fails closed: no secret configured → 501; bad signature → 401.
// HMAC over the raw body, constant-time compare, replay windows where the provider sends a time.

import { Hono } from "hono";
import type { AppEnv } from "../app";
import { hmacHex, safeEqual } from "../lib/crypto";
import { getLead, getLeadByEmail } from "../funnel/leads";
import { validEmail } from "../funnel/application";
import { verifyCalendly, handleCalendlyWebhook } from "../integrations/calendly";
import { markBooked, markCancelled } from "../integrations/booking";
import { verifyElevenLabs, handlePostCall } from "../integrations/elevenlabs";
import { initAuthorized, initVariables } from "../integrations/elevenlabs-inbound";
import { verifyWhatsApp, handleWhatsAppInbound } from "../integrations/whatsapp";
import { vapiAuthorized, handleVapi } from "../integrations/voice";

export const hooks = new Hono<AppEnv>();

const MAX = 256 * 1024;

async function raw(c: { req: { text(): Promise<string>; header(n: string): string | undefined } }): Promise<string | null> {
  if (Number(c.req.header("content-length") || 0) > MAX) return null;
  const t = await c.req.text();
  return t.length > MAX ? null : t;
}

function parse(t: string): Record<string, any> | null {
  try {
    const v = JSON.parse(t);
    return v && typeof v === "object" ? v : null;
  } catch {
    return null;
  }
}

hooks.post("/calendly", async (c) => {
  const rt = c.get("rt");
  const key = rt.settings.get("CALENDLY_SIGNING_KEY");
  if (!key) return c.json({ error: "not configured" }, 501);
  const body = await raw(c);
  if (body == null) return c.json({ error: "too large" }, 413);
  if (!(await verifyCalendly(key, c.req.header("calendly-webhook-signature") || null, body, rt.now()))) return c.json({ error: "bad signature" }, 401);
  const j = parse(body);
  if (!j) return c.json({ error: "bad json" }, 400);
  const r = await handleCalendlyWebhook(rt, j);
  return c.json({ ok: true, result: r });
});

/** Generic booking webhook: Cal.com (X-Cal-Signature-256) or a shared header secret (GHL / Zapier). */
hooks.post("/booking", async (c) => {
  const rt = c.get("rt");
  const secret = rt.settings.get("BOOKING_WEBHOOK_SECRET");
  if (!secret) return c.json({ error: "not configured" }, 501);
  const body = await raw(c);
  if (body == null) return c.json({ error: "too large" }, 413);
  const calSig = c.req.header("x-cal-signature-256");
  const headerSecret = c.req.header("x-funnel-secret");
  const ok = calSig ? safeEqual(await hmacHex(secret, body), calSig) : !!headerSecret && safeEqual(headerSecret, secret);
  if (!ok) return c.json({ error: "bad signature" }, 401);
  const j = parse(body);
  if (!j) return c.json({ error: "bad json" }, 400);
  // Cal.com shape or a flat shape {event, ref, email, lead_id, start_time, join_url, reschedule_url}.
  const p = j.payload || j;
  const trigger = String(j.triggerEvent || j.event || "").toUpperCase();
  const email = validEmail(p.attendees?.[0]?.email || p.email);
  const leadId = typeof p.metadata?.lead_id === "string" ? p.metadata.lead_id : typeof p.lead_id === "string" ? p.lead_id : null;
  let lead = leadId && /^l[0-9a-z]{19}$/.test(leadId) ? await getLead(rt, leadId) : null;
  const strong = !!lead;
  if (!lead && email) lead = await getLeadByEmail(rt, email);
  if (!lead) return c.json({ ok: true, result: "unmatched" });
  const ref = String(p.uid || p.ref || p.id || "").slice(0, 200);
  if (!ref) return c.json({ error: "missing ref" }, 400);
  if (/CANCEL/.test(trigger)) return c.json({ ok: true, result: await markCancelled(rt, lead, ref) });
  const start = Date.parse(p.startTime || p.start_time || "");
  const r = await markBooked(rt, lead, {
    provider: calSig ? "cal.com" : "webhook", ref, callAt: Number.isFinite(start) ? start : null,
    joinUrl: p.metadata?.videoCallUrl || p.join_url || null, rescheduleUrl: p.reschedule_url || null, cancelUrl: p.cancel_url || null,
    hostEmail: p.organizer?.email || p.host_email || null, verified: strong ? "strong" : "email",
  });
  return c.json({ ok: true, result: r });
});

hooks.post("/elevenlabs", async (c) => {
  const rt = c.get("rt");
  const secret = rt.settings.get("ELEVENLABS_WEBHOOK_SECRET");
  if (!secret) return c.json({ error: "not configured" }, 501);
  const body = await raw(c);
  if (body == null) return c.json({ error: "too large" }, 413);
  if (!(await verifyElevenLabs(secret, c.req.header("elevenlabs-signature") || null, body, rt.now()))) return c.json({ error: "bad signature" }, 401);
  const j = parse(body);
  if (!j) return c.json({ error: "bad json" }, 400);
  if (j.type !== "post_call_transcription") return c.json({ ok: true, ignored: true });
  const r = await handlePostCall(rt, j);
  return c.json(r);
});

hooks.post("/elevenlabs/init", async (c) => {
  const rt = c.get("rt");
  const auth = initAuthorized(rt, c.req.header("x-funnel-secret") || null);
  if (auth === "unconfigured") return c.json({ error: "not configured" }, 501);
  if (auth === "denied") return c.json({ error: "unauthorized" }, 401);
  const body = parse((await raw(c)) || "") || {};
  return c.json({ type: "conversation_initiation_client_data", dynamic_variables: await initVariables(rt, body) });
});

hooks.get("/whatsapp", async (c) => {
  const token = c.get("rt").settings.get("WHATSAPP_VERIFY_TOKEN");
  if (!token) return c.text("not configured", 501);
  if (c.req.query("hub.mode") === "subscribe" && safeEqual(c.req.query("hub.verify_token") || "", token)) {
    return c.text((c.req.query("hub.challenge") || "").replace(/[^\w-]/g, "").slice(0, 100));
  }
  return c.text("forbidden", 403);
});

hooks.post("/whatsapp", async (c) => {
  const rt = c.get("rt");
  if (!rt.settings.get("WHATSAPP_APP_SECRET")) return c.json({ error: "not configured" }, 501);
  const body = await raw(c);
  if (body == null) return c.json({ error: "too large" }, 413);
  if (!(await verifyWhatsApp(rt, c.req.header("x-hub-signature-256") || null, body))) return c.json({ error: "bad signature" }, 401);
  const j = parse(body);
  if (!j) return c.json({ error: "bad json" }, 400);
  return c.json({ ok: true, n: await handleWhatsAppInbound(rt, j) });
});

hooks.post("/vapi", async (c) => {
  const rt = c.get("rt");
  const auth = vapiAuthorized(rt, c.req.header("x-vapi-secret") || null);
  if (auth === "unconfigured") return c.json({ error: "not configured" }, 501);
  if (auth === "denied") return c.json({ error: "unauthorized" }, 401);
  const j = parse((await raw(c)) || "");
  if (!j) return c.json({ error: "bad json" }, 400);
  return c.json({ ok: true, result: await handleVapi(rt, j) });
});
