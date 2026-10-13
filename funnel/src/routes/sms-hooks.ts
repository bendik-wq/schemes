// Twilio webhooks for text reminders. Mounted in src/index.ts with:
//   app.route("/hooks/twilio-sms", smsHooks);
// POST /hooks/twilio-sms         incoming message (set as the number's / Messaging Service's incoming webhook)
// POST /hooks/twilio-sms/status  delivery receipts (sms.ts sets StatusCallback on every send)
// Both fail closed: 501 without TWILIO_AUTH_TOKEN, 403 unless X-Twilio-Signature matches.

import { Hono } from "hono";
import type { AppEnv, Ctx } from "../app";
import { escHtml } from "../lib/text";
import { handleInboundSms, handleSmsStatus, verifyTwilio } from "../integrations/sms";

export const smsHooks = new Hono<AppEnv>();

const MAX_BODY = 16_384;

/** Form params plus the signature check against the URL Twilio called (and the PUBLIC_URL form of it). */
async function verified(c: Ctx): Promise<{ ok: true; params: Record<string, string> } | { ok: false; res: Response }> {
  const rt = c.get("rt");
  const token = rt.settings.get("TWILIO_AUTH_TOKEN");
  if (!token) return { ok: false, res: c.text("not configured", 501) };
  if (Number(c.req.header("content-length") || 0) > MAX_BODY) return { ok: false, res: c.text("too large", 413) };
  const raw = await c.req.text();
  if (raw.length > MAX_BODY) return { ok: false, res: c.text("too large", 413) };
  const params: Record<string, string> = {};
  for (const [k, v] of new URLSearchParams(raw)) params[k] = v;
  const url = new URL(c.req.url);
  const urls = [url.toString(), `${rt.origin}${url.pathname}${url.search}`];
  if (!(await verifyTwilio(token, c.req.header("x-twilio-signature"), [...new Set(urls)], params))) return { ok: false, res: c.text("bad signature", 403) };
  return { ok: true, params };
}

function twiml(message: string): Response {
  const body = message ? `<Response><Message>${escHtml(message)}</Message></Response>` : "<Response/>";
  return new Response(`<?xml version="1.0" encoding="UTF-8"?>${body}`, { headers: { "content-type": "text/xml; charset=utf-8", "cache-control": "no-store" } });
}

smsHooks.post("/", async (c) => {
  const v = await verified(c);
  if (!v.ok) return v.res;
  const reply = await handleInboundSms(c.get("rt"), v.params.From || "", (v.params.Body || "").slice(0, 1000), v.params.MessageSid || "");
  return twiml(reply);
});

smsHooks.post("/status", async (c) => {
  const v = await verified(c);
  if (!v.ok) return v.res;
  await handleSmsStatus(c.get("rt"), v.params.MessageSid || v.params.SmsSid || "", v.params.MessageStatus || v.params.SmsStatus || "");
  return c.body(null, 204);
});
