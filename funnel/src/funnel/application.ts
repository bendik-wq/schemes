// Application flow: contact (creates the lead), per-step answers, submit (score → tier → route).

import type { Runtime } from "../app";
import { APPLICATION, CALL_CONSENT, DISPOSABLE_DOMAINS, TIER_VALUE, type Tier } from "../config";
import type { Identity } from "../lib/identity";
import { linkVisitorToLead } from "../lib/identity";
import { newId, refCode } from "../lib/ids";
import { kvGate, kvGet, kvIncr } from "../lib/kv";
import { normalizePhone, countryTimezone } from "../lib/phone";
import { clip } from "../lib/text";
import { isSuppressed } from "../lib/suppress";
import { track, whoFromIdentity } from "../tracking/track";
import { getLead, getLeadByEmail, parseAnswers, updateLead, effectiveTier, type Answers, type Lead } from "./leads";
import { scoreApplication } from "./scoring";
import { pickCloser, routeFor } from "./routing";
import { enqueueSequence, cancelSequences, sendOneOff } from "../integrations/email";
import { queueCall } from "../integrations/elevenlabs";
import { notifyTeam } from "../integrations/notify";

// RFC 5322 atext, minus characters that have no business in a real address and break HTML contexts.
const EMAIL_RE = /^[A-Za-z0-9!#$%&'*+/=?^_{|}~-]+(\.[A-Za-z0-9!#$%&'*+/=?^_{|}~-]+)*@([A-Za-z0-9]([A-Za-z0-9-]{0,61}[A-Za-z0-9])?\.)+[A-Za-z]{2,24}$/;

export function validEmail(v: unknown): string | null {
  const e = String(v ?? "").trim().toLowerCase();
  if (e.length > 254 || !EMAIL_RE.test(e)) return null;
  if (/[<>"()[\]\\,;:\s`]/.test(e)) return null;
  return e;
}

export function isDisposable(email: string): boolean {
  const d = email.split("@")[1] || "";
  return DISPOSABLE_DOMAINS.some((x) => d === x || d.endsWith("." + x));
}

function validName(v: unknown, max = 60): string {
  const s = clip(v, max);
  // Letters, spaces, apostrophes, hyphens and dots only.
  return /^[\p{L}][\p{L}\p{M}' .-]*$/u.test(s) ? s : "";
}

export async function verifyTurnstile(rt: Runtime, token: unknown, ip: string | null): Promise<boolean> {
  const secret = rt.settings.get("TURNSTILE_SECRET_KEY");
  if (!secret) return true;
  if (typeof token !== "string" || !token) return false;
  try {
    const body = new FormData();
    body.set("secret", secret);
    body.set("response", token);
    if (ip) body.set("remoteip", ip);
    const r = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", { method: "POST", body });
    const j = (await r.json()) as { success?: boolean };
    return !!j.success;
  } catch {
    return false;
  }
}

export interface ContactInput {
  first_name?: unknown; last_name?: unknown; email?: unknown; phone?: unknown;
  call_consent?: unknown; whatsapp_opt_in?: unknown; turnstile?: unknown;
}

export type ContactResult =
  | { ok: true; leadId: string; ref: string; created: boolean }
  | { ok: false; status: 400 | 409 | 403; code: string; field?: string; message: string };

async function lastTouch(rt: Runtime, id: Identity) {
  // Last non-direct touch: the current session if it has a channel other than Direct, else the latest that does.
  const s = await rt.env.DB.prepare(
    `SELECT channel, utm_source, utm_medium, utm_campaign, utm_content, utm_term, click_id, click_type, referrer, landing_path, lander
     FROM sessions WHERE visitor_id = ? AND channel IS NOT NULL AND channel != 'Direct' ORDER BY started_at DESC LIMIT 1`,
  ).bind(id.visitorId).first<Record<string, string | null>>();
  const cur = await rt.env.DB.prepare("SELECT landing_path, lander, channel FROM sessions WHERE id = ?").bind(id.sessionId).first<Record<string, string | null>>();
  const v = await rt.env.DB.prepare("SELECT * FROM visitors WHERE id = ?").bind(id.visitorId).first<Record<string, string | null>>();
  const ftLander = await rt.env.DB.prepare("SELECT lander FROM sessions WHERE visitor_id = ? ORDER BY started_at ASC LIMIT 1").bind(id.visitorId).first<{ lander: string | null }>();
  return { s, cur, v, ftLander: ftLander?.lander ?? null };
}

export async function saveContact(rt: Runtime, id: Identity, input: ContactInput): Promise<ContactResult> {
  const email = validEmail(input.email);
  if (!email) return { ok: false, status: 400, code: "email", field: "email", message: "Please enter a valid email address." };
  if (isDisposable(email)) return { ok: false, status: 400, code: "email_disposable", field: "email", message: "Please use your work or personal email, not a temporary one." };
  const first = validName(input.first_name);
  if (!first) return { ok: false, status: 400, code: "first_name", field: "first_name", message: "Please enter your first name." };
  const last = validName(input.last_name);
  const phone = normalizePhone(input.phone, id.geo.country);
  if (!phone) return { ok: false, status: 400, code: "phone", field: "phone", message: "Please enter a mobile number with country code, e.g. +47 912 34 567." };
  if (!(await verifyTurnstile(rt, input.turnstile, id.ip))) return { ok: false, status: 403, code: "turnstile", message: "Please refresh the page and try again." };

  const consent = input.call_consent === true || input.call_consent === "true" || input.call_consent === "on";
  const now = rt.now();
  const who = whoFromIdentity(id, "/apply");

  // Browser already linked to a lead (created it here, or arrived via a signed email link).
  const linked = await getLead(rt, id.leadId);
  const existing = await getLeadByEmail(rt, email);

  if (existing && existing.id !== linked?.id) {
    // An email address is not identity. Change nothing; send that inbox a link to continue.
    // At most one link an hour and three a day per lead, never to an unsubscribed inbox.
    const day = `continue_day:${existing.id}:${new Date(now).toISOString().slice(0, 10)}`;
    if (!existing.unsubscribed_at && Number((await kvGet(rt.env, day)) || 0) < 3 && (await kvGate(rt.env, `continue:${existing.id}`, 60 * 60_000, now))) {
      await kvIncr(rt.env, day);
      await sendOneOff(rt, existing, "continue", "continue_link");
      await track(rt, { leadId: existing.id, visitorId: id.visitorId, sessionId: id.sessionId, isBot: id.isBot, path: "/apply" }, { name: "continue_link_sent", localOnly: true });
    }
    return { ok: false, status: 409, code: "continue_sent", message: "You have applied before with this email. We just sent you a link to pick up where you left off." };
  }

  if (linked) {
    const patch: Partial<Lead> = { first_name: first, last_name: last || null, email, whatsapp_opt_in: input.whatsapp_opt_in ? 1 : linked.whatsapp_opt_in };
    // An imported contact who proved their inbox (signed link) and is applying becomes a funnel lead.
    if (linked.booking_source === "calendly-direct") patch.booking_source = "funnel";
    if (phone !== linked.phone) {
      // Consent is per number: a new number needs a fresh tick.
      patch.phone = phone;
      patch.call_consent_at = consent ? now : null;
      patch.call_consent_text = consent ? `${CALL_CONSENT.version}: ${CALL_CONSENT.label}` : null;
    } else if (consent && !linked.call_consent_at) {
      patch.call_consent_at = now;
      patch.call_consent_text = `${CALL_CONSENT.version}: ${CALL_CONSENT.label}`;
    } else if (!consent && linked.call_consent_at) {
      // Unticking withdraws consent.
      patch.call_consent_at = null;
      patch.call_consent_text = null;
    }
    await updateLead(rt, linked.id, patch);
    return { ok: true, leadId: linked.id, ref: linked.ref_code, created: false };
  }

  const leadId = newId("l");
  const ref = refCode();
  const emailSuppressed = await isSuppressed(rt, "email", email);
  // Consent is per number and per person: a number already used by another lead this month cannot be
  // consented again from a fresh email (stops one person signing someone else up for calls).
  const shared = await rt.env.DB.prepare("SELECT 1 AS x FROM leads WHERE phone = ? AND created_at > ? LIMIT 1").bind(phone, now - 30 * 86_400_000).first();
  const consentOk = consent && !shared;
  const { s, cur, v, ftLander } = await lastTouch(rt, id);
  const lander = cur?.lander || id.lander || null;
  await rt.env.DB.prepare(
    `INSERT INTO leads (id, ref_code, created_at, updated_at, first_name, last_name, email, phone, whatsapp_opt_in, answers, step_reached,
      app_started_at, status, visitor_id, channel, utm_source, utm_medium, utm_campaign, utm_content, utm_term, click_id, click_type, referrer,
      ft_channel, ft_source, ft_medium, ft_campaign, ft_content, ft_term, ft_referrer, ft_landing, landing_path, variant, lander, ft_lander,
      country, region, city, device, fbp, fbc, call_consent_at, call_consent_text, timezone)
     VALUES (?,?,?,?,?,?,?,?,?,'{}',1,?,'partial',?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
  ).bind(
    leadId, ref, now, now, first, last || null, email, phone, input.whatsapp_opt_in ? 1 : 0, now, id.visitorId,
    s?.channel ?? id.channel ?? "Direct", s?.utm_source ?? null, s?.utm_medium ?? null, s?.utm_campaign ?? null, s?.utm_content ?? null,
    s?.utm_term ?? null, s?.click_id ?? null, s?.click_type ?? null, s?.referrer ?? null,
    v?.ft_channel ?? null, v?.ft_source ?? null, v?.ft_medium ?? null, v?.ft_campaign ?? null, v?.ft_content ?? null, v?.ft_term ?? null,
    v?.ft_referrer ?? null, v?.ft_landing ?? null, cur?.landing_path ?? null, id.variant, lander, ftLander,
    id.geo.country, id.geo.region, id.geo.city, id.device, id.fbp, id.fbc,
    consentOk ? now : null, consentOk ? `${CALL_CONSENT.version}: ${CALL_CONSENT.label}` : null, countryTimezone(id.geo.country),
  ).run();
  await linkVisitorToLead(rt, id.visitorId, leadId);
  id.leadId = leadId;
  if (emailSuppressed) await updateLead(rt, leadId, { unsubscribed_at: now });
  const lead = (await getLead(rt, leadId))!;
  await track(rt, { ...who, leadId }, { name: "lead_captured", props: { step: 1 } });
  await enqueueSequence(rt, lead, "abandoned");
  return { ok: true, leadId, ref, created: true };
}

/** Validate one answer against the question definition. Returns the clean value or null. */
export function cleanAnswer(qid: string, value: unknown): string | string[] | null {
  const q = APPLICATION.find((x) => x.id === qid);
  if (!q || q.type === "contact") return null;
  if (q.type === "text") {
    const s = String(value ?? "").replace(/\s+/g, " ").trim().slice(0, 1200);
    return s;
  }
  if (q.type === "single") {
    const v = String(value ?? "");
    return q.options?.some((o) => o.value === v) ? v : null;
  }
  const arr = Array.isArray(value) ? value.map(String) : String(value ?? "").split(",");
  const ok = arr.filter((v) => q.options?.some((o) => o.value === v));
  return [...new Set(ok)].slice(0, 10);
}

export async function saveAnswers(rt: Runtime, id: Identity, input: { answers?: Record<string, unknown>; step?: unknown }): Promise<{ ok: boolean; error?: string }> {
  const lead = await getLead(rt, id.leadId);
  if (!lead) return { ok: false, error: "no_lead" };
  const answers: Answers = parseAnswers(lead);
  let changed = 0;
  for (const [k, v] of Object.entries(input.answers || {}).slice(0, 12)) {
    const c = cleanAnswer(k, v);
    if (c === null) continue;
    answers[k] = c;
    changed++;
  }
  const step = Math.max(lead.step_reached, Math.min(APPLICATION.length + 1, Math.round(Number(input.step) || 0)));
  await updateLead(rt, lead.id, { answers: JSON.stringify(answers), step_reached: step });
  if (changed) {
    await track(rt, whoFromIdentity(id, "/apply"), { name: "app_step", props: { step, keys: Object.keys(input.answers || {}).slice(0, 5).join(",") } });
  }
  return { ok: true };
}

export interface SubmitResult { ok: boolean; route?: string; tier?: Tier; error?: string; }

export async function submitApplication(rt: Runtime, id: Identity): Promise<SubmitResult> {
  const lead = await getLead(rt, id.leadId);
  if (!lead) return { ok: false, error: "no_lead" };
  if (lead.app_completed_at && lead.route) {
    // Idempotent: a second submit returns the same route without re-firing anything.
    return { ok: true, route: lead.route, tier: effectiveTier(lead) || "C" };
  }
  const answers = parseAnswers(lead);
  for (const q of APPLICATION) {
    if (q.type === "contact" || q.optional) continue;
    const a = answers[q.id];
    const missing =
      a == null ||
      (q.type === "multi" ? !Array.isArray(a) || a.length === 0
        : q.type === "text" ? String(a).trim().length < Math.max(1, q.minLength || 1)
        : !a);
    if (missing) return { ok: false, error: `missing:${q.id}` };
  }
  const blocklist = rt.settings.get("BLOCKLIST").split(",").map((x) => x.trim()).filter(Boolean);
  const result = scoreApplication(answers, { email: lead.email, country: lead.country, blocklist });
  const tier = lead.tier_override || result.tier;
  const closer = await pickCloser(rt, tier);
  const route = routeFor(tier);
  const now = rt.now();
  const status = lead.status === "partial" ? (result.flags.includes("blocked") ? "disqualified" : "applied") : lead.status;
  await updateLead(rt, lead.id, {
    score: result.score,
    score_breakdown: JSON.stringify({ lines: result.breakdown, flags: result.flags, rawTier: result.rawTier, cappedBy: result.cappedBy }),
    tier: result.tier,
    route,
    closer_id: lead.closer_id || closer?.id || null,
    status,
    app_completed_at: now,
    step_reached: APPLICATION.length + 1,
    qual_source: "application",
    qual_flags: result.flags.join(","),
    revenue_band: typeof answers.revenue === "string" ? answers.revenue : null,
    budget_band: typeof answers.spend === "string" ? answers.spend : null,
  });
  const fresh = (await getLead(rt, lead.id))!;
  const who = whoFromIdentity(id, "/apply");

  await cancelSequences(rt, lead.id, ["abandoned"]);
  if (status !== "disqualified") {
    if (fresh.status === "applied") {
      await enqueueSequence(rt, fresh, tier === "A" ? "tier_a" : tier === "B" ? "tier_b" : "tier_c");
      await enqueueSequence(rt, fresh, "nurture");
    }
    if ((tier === "A" || tier === "B") && fresh.status === "applied") await queueCall(rt, fresh, "speed_to_lead");
    if (tier === "A" || tier === "B") rt.waitUntil(notifyTeam(rt, tier === "A" ? "hot_lead" : "qualified", fresh));
  }
  await track(rt, who, { name: "app_submitted", props: { tier, score: result.score } });
  await track(rt, who, { name: "lead_qualified", props: { tier, score: result.score }, value: TIER_VALUE[tier], currency: "USD" });
  return { ok: true, route, tier };
}
