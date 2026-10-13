// Application flow: contact (creates the lead), per-step answers, submit (score → tier → route).

import type { Runtime } from "../app";
import {
  APPLICATION, APPLICATION_HOT_PARTIAL, BRAND, CALL_CONSENT, DISPOSABLE_DOMAINS, PERSONAL_EMAIL_DOMAINS, TIER_INLINE_BOOKING_DEFAULT, TIER_VALUE,
  type Tier,
} from "../config";
import type { Identity } from "../lib/identity";
import { linkVisitorToLead } from "../lib/identity";
import { newId, refCode } from "../lib/ids";
import { kvGate, kvGet, kvGetJson, kvIncr, kvSet } from "../lib/kv";
import { normalizePhone, countryTimezone, callableNumber } from "../lib/phone";
import { clip } from "../lib/text";
import { isSuppressed } from "../lib/suppress";
import { track, whoFromIdentity } from "../tracking/track";
import { getLead, getLeadByEmail, parseAnswers, updateLead, effectiveTier, type Answers, type Lead } from "./leads";
import { scoreApplication } from "./scoring";
import { pickCloser, routeFor, bookingUrlFor } from "./routing";
import { enqueueSequence, cancelSequences, sendOneOff } from "../integrations/email";
import { queueCall } from "../integrations/elevenlabs";
import { notifyTeam } from "../integrations/notify";
import { validTimezone } from "../integrations/sequences";
import { getRep, type Rep } from "../sales/reps";
import {
  applyInlineBooking, availableTimes, bookInvitee, pickSlots, resolveEventType, type EventTypeRef,
} from "../integrations/calendly";
import { inlineBookingOn } from "../growth/experiments";
import { recordSmsConsent } from "../integrations/sms";


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

/**
 * Pure: reading of a DNS-over-HTTPS MX answer. false = the domain clearly takes no mail (NXDOMAIN, no MX
 * records, or a null MX); true = it has MX records; null = unknown (fail open).
 */
export function mxVerdict(j: unknown): boolean | null {
  if (!j || typeof j !== "object") return null;
  const r = j as { Status?: unknown; Answer?: Array<{ type?: unknown; data?: unknown }> };
  if (typeof r.Status !== "number") return null;
  if (r.Status === 3) return false;
  if (r.Status !== 0) return null;
  const mx = (Array.isArray(r.Answer) ? r.Answer : []).filter((a) => a && a.type === 15);
  if (!mx.length) return false;
  if (mx.every((a) => /^\s*0\s+\.?\s*$/.test(String(a.data ?? "")))) return false; // RFC 7505 null MX
  return true;
}

/** Whether the email's domain can receive mail. Fails open on any lookup problem; cached (yes a week, no an hour). */
export async function emailDomainOk(rt: Runtime, email: string): Promise<boolean> {
  const domain = email.split("@")[1] || "";
  if (!domain || PERSONAL_EMAIL_DOMAINS.includes(domain)) return true;
  // Local simulations only: ALLOW_TEST_EMAILS=1 in .dev.vars lets the reserved example.* domains through.
  if (rt.settings.get("ALLOW_TEST_EMAILS") === "1" && /(^|\.)example\.(com|org|net)$/.test(domain)) return true;
  const key = `mx:${domain.slice(0, 200)}`;
  const c = await kvGetJson<{ ok: boolean; at: number } | null>(rt.env, key, null);
  if (c && rt.now() - c.at < (c.ok ? 7 * 86_400_000 : 3_600_000)) return c.ok;
  let verdict: boolean | null = null;
  try {
    const r = await fetch(`https://cloudflare-dns.com/dns-query?name=${encodeURIComponent(domain)}&type=MX`, {
      headers: { accept: "application/dns-json" },
      signal: AbortSignal.timeout(1500),
    });
    verdict = r.ok ? mxVerdict(await r.json()) : null;
  } catch {
    verdict = null;
  }
  if (verdict === null) return true;
  await kvSet(rt.env, key, JSON.stringify({ ok: verdict, at: rt.now() }));
  return verdict;
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
  /** Text reminders about a booked call: its own unticked box (SMS_CONSENT), stored per number in sms_consent. */
  sms_consent?: unknown;
  /** ISO country picked in the form's dial-code select; used for numbers typed without a prefix. */
  phone_country?: unknown;
}

export type ContactResult =
  | { ok: true; leadId: string; ref: string; created: boolean; phoneCallable: boolean }
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

export async function saveContact(rt: Runtime, id: Identity, input: ContactInput, opts: { skipTurnstile?: boolean } = {}): Promise<ContactResult> {
  const email = validEmail(input.email);
  if (!email) return { ok: false, status: 400, code: "email", field: "email", message: "Please enter a valid email address." };
  if (isDisposable(email)) return { ok: false, status: 400, code: "email_disposable", field: "email", message: "Please use your work or personal email, not a temporary one." };
  const first = validName(input.first_name);
  if (!first) return { ok: false, status: 400, code: "first_name", field: "first_name", message: "Please enter your first name." };
  const last = validName(input.last_name);
  const phone = normalizePhone(input.phone, id.geo.country, input.phone_country);
  if (!phone) return { ok: false, status: 400, code: "phone", field: "phone", message: "Please enter a mobile number with country code, e.g. +47 912 34 567." };
  // Before Turnstile: a token is single-use, and a typo here should not cost the visitor a new challenge.
  if (!(await emailDomainOk(rt, email))) {
    return { ok: false, status: 400, code: "email_domain", field: "email", message: `We couldn't find a mail server for ${email.split("@")[1]}. Please check the spelling.` };
  }
  if (!opts.skipTurnstile && !(await verifyTurnstile(rt, input.turnstile, id.ip))) {
    return { ok: false, status: 403, code: "turnstile", message: "We couldn't confirm you're not a bot. Please try again." };
  }
  const phoneCallable = callableNumber(phone);

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
    if (input.sms_consent !== undefined) await recordSmsConsent(rt, linked.id, phone, input.sms_consent === true || input.sms_consent === "on");
    return { ok: true, leadId: linked.id, ref: linked.ref_code, created: false, phoneCallable };
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
  if (input.sms_consent === true || input.sms_consent === "on") await recordSmsConsent(rt, leadId, phone, true);
  await track(rt, { ...who, leadId }, { name: "lead_captured", props: { step: 1 } });
  await enqueueSequence(rt, lead, "abandoned");
  return { ok: true, leadId, ref, created: true, phoneCallable };
}

/** Validate one answer against the question definition. Returns the clean value or null. */
export function cleanAnswer(qid: string, value: unknown): string | string[] | null {
  const q = APPLICATION.find((x) => x.id === qid);
  if (!q || q.type === "contact") return null;
  if (q.type === "text") {
    const s = String(value ?? "").replace(/\s+/g, " ").trim().slice(0, 1200);
    if (q.format === "url") return s ? cleanWebsite(s) : "";
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

/**
 * Pure: a company website typed by a person ("acme.no", "www.acme.no/en", "https://acme.no") as
 * "https://host/path", or null when it is not a plausible public web address (no scheme other than http(s), no
 * credentials, no IP literals, no localhost, a dotted host with a 2–24 letter TLD).
 */
export function cleanWebsite(v: unknown): string | null {
  const s = String(v ?? "").trim();
  if (!s || s.length > 200 || /\s/.test(s)) return null;
  const withScheme = /^[a-z][a-z0-9+.-]*:/i.test(s) ? s : `https://${s}`;
  let u: URL;
  try { u = new URL(withScheme); } catch { return null; }
  if (u.protocol !== "https:" && u.protocol !== "http:") return null;
  if (u.username || u.password || u.port) return null;
  const host = u.hostname.toLowerCase();
  if (!/^([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,24}$/.test(host)) return null;
  const path = u.pathname === "/" ? "" : u.pathname.replace(/\/+$/, "");
  return `https://${host}${path}`.slice(0, 200);
}

/** Pure: an incomplete application that already reads as a strong owner (see APPLICATION_HOT_PARTIAL). */
export function isHotPartial(answers: Answers): boolean {
  const role = typeof answers.role === "string" ? answers.role : "";
  const revenue = typeof answers.revenue === "string" ? answers.revenue : "";
  return APPLICATION_HOT_PARTIAL.role.includes(role) && APPLICATION_HOT_PARTIAL.revenue.includes(revenue);
}

const HOT_DONE = "9999999999999"; // a kv value no sweep or gate ever selects again

export async function saveAnswers(
  rt: Runtime, id: Identity, input: { answers?: Record<string, unknown>; step?: unknown; draft?: unknown },
): Promise<{ ok: boolean; error?: string }> {
  const lead = await getLead(rt, id.leadId);
  if (!lead) return { ok: false, error: "no_lead" };
  // A draft is long text saved while typing: stored, but it neither advances the step nor counts as an answer.
  const draft = input.draft === true;
  const answers: Answers = parseAnswers(lead);
  let changed = 0;
  for (const [k, v] of Object.entries(input.answers || {}).slice(0, 12)) {
    if (draft && APPLICATION.find((q) => q.id === k)?.type !== "text") continue;
    const c = cleanAnswer(k, v);
    if (c === null) continue;
    answers[k] = c;
    changed++;
  }
  if (draft) {
    if (changed) await updateLead(rt, lead.id, { answers: JSON.stringify(answers) });
    return { ok: true };
  }
  const step = Math.max(lead.step_reached, Math.min(APPLICATION.length + 1, Math.round(Number(input.step) || 0)));
  await updateLead(rt, lead.id, { answers: JSON.stringify(answers), step_reached: step });
  if (changed) {
    await track(rt, whoFromIdentity(id, "/apply"), { name: "app_step", props: { step, keys: Object.keys(input.answers || {}).slice(0, 5).join(",") } });
  }
  // Mark a strong partial once; the sweep pings the team if it is still incomplete later.
  if (!lead.app_completed_at && isHotPartial(answers)) await kvGate(rt.env, `hotpartial:${lead.id}`, 365 * 86_400_000, rt.now());
  return { ok: true };
}

/**
 * Ping the team about strong partial applications still incomplete APPLICATION_HOT_PARTIAL.afterMin
 * minutes after they were marked. A ping only: nobody is called because of it.
 */
export async function sweepHotPartials(rt: Runtime): Promise<number> {
  const due = rt.now() - APPLICATION_HOT_PARTIAL.afterMin * 60_000;
  const rows = await rt.env.DB.prepare(
    "SELECT key FROM kv_state WHERE key LIKE 'hotpartial:%' AND CAST(value AS INTEGER) <= ? LIMIT 10",
  ).bind(due).all<{ key: string }>();
  let n = 0;
  for (const r of rows.results || []) {
    // Claim first so two concurrent sweeps never ping twice.
    const claim = await rt.env.DB.prepare("UPDATE kv_state SET value = ?, updated_at = ? WHERE key = ? AND CAST(value AS INTEGER) <= ?")
      .bind(HOT_DONE, rt.now(), r.key, due).run();
    if (!claim.meta?.changes) continue;
    const lead = await getLead(rt, r.key.slice("hotpartial:".length));
    if (!lead || lead.app_completed_at || lead.status !== "partial") continue;
    const consent = lead.call_consent_at && !lead.do_not_call_at ? "call consent given" : "no call consent: email only";
    rt.waitUntil(notifyTeam(rt, "hot_lead", lead, `Partial application, idle ${APPLICATION_HOT_PARTIAL.afterMin}+ min: owner, 3M+ revenue (${consent}).`));
    n++;
  }
  return n;
}

// ── Inline booking ────────────────────────────────────────────────────────────

export interface SlotOffer { slots: string[]; closer: { name: string }; tz: string }
interface StoredOffer { et: EventTypeRef; slots: string[]; tz: string; at: number }

/** Tiers that get the native slot picker (setting INLINE_BOOKING_TIERS, default "A"). */
export function inlineTiers(rt: Runtime): Tier[] {
  const raw = rt.settings.get("INLINE_BOOKING_TIERS") || TIER_INLINE_BOOKING_DEFAULT;
  return raw.toUpperCase().split(/[\s,]+/).filter((t): t is Tier => t === "A" || t === "B");
}

function cleanTz(tz: unknown, lead: Lead): string {
  const t = typeof tz === "string" ? tz.slice(0, 64) : "";
  if (validTimezone(t)) return t;
  if (validTimezone(lead.timezone)) return lead.timezone as string;
  return BRAND.salesTimezone;
}

function liveBooking(lead: Lead, now: number): boolean {
  return lead.status === "booked" && !!lead.call_at && lead.call_at > now && !lead.booking_cancelled_at;
}

/** Resolve after `ms` with null if `p` has not settled (the slot picker is a bonus, never a delay). */
function withTimeout<T>(p: Promise<T>, ms: number): Promise<T | null> {
  return Promise.race([p.catch(() => null), new Promise<null>((r) => setTimeout(() => r(null), ms))]);
}

async function offerSlots(rt: Runtime, lead: Lead, tier: Tier, rep: Rep | null, tz: string, fresh = false): Promise<SlotOffer | null> {
  if (!rt.settings.has("CALENDLY_API_TOKEN") || !inlineTiers(rt).includes(tier)) return null;
  // Experiment slot inline_booking: an "off" arm gets the full calendar instead.
  if (!(await inlineBookingOn(rt, lead))) return null;
  const et = await resolveEventType(rt, bookingUrlFor(rt, tier, rep));
  if (!et) return null;
  const all = await availableTimes(rt, et.uri, 5, { fresh });
  if (!all?.length) return null;
  const slots = pickSlots(all, tz, 6, 5);
  const stored: StoredOffer = { et, slots, tz, at: rt.now() };
  await kvSet(rt.env, `offer:${lead.id}`, JSON.stringify(stored));
  return { slots, closer: { name: rep?.name || BRAND.founder }, tz };
}

export type BookInlineResult =
  | { ok: true; next: string; callAt: number | null }
  | { ok: false; status: 400 | 403 | 409 | 502; code: string; message: string; slots?: string[]; route?: string };

/**
 * POST /api/apply/book: book an offered time for the lead whose own browser this is. Only tiers in
 * INLINE_BOOKING_TIERS, only after the application is complete, only a time we offered.
 */
export async function bookInlineSlot(rt: Runtime, id: Identity, input: { start?: unknown; tz?: unknown }): Promise<BookInlineResult> {
  const lead = await getLead(rt, id.leadId);
  if (!lead) return { ok: false, status: 403, code: "no_lead", message: "Please start your application first." };
  const route = lead.route || "/book";
  if (!lead.app_completed_at) return { ok: false, status: 409, code: "not_ready", message: "Please finish your application first." };
  const tier = effectiveTier(lead);
  if (!tier || !inlineTiers(rt).includes(tier) || lead.status === "disqualified" || !(await inlineBookingOn(rt, lead))) return { ok: false, status: 403, code: "not_allowed", message: "Please pick a time on the calendar.", route };
  const now = rt.now();
  if (liveBooking(lead, now)) return { ok: true, next: "/breakout", callAt: lead.call_at };
  const t = Date.parse(String(input.start ?? ""));
  if (!Number.isFinite(t)) return { ok: false, status: 400, code: "bad_start", message: "Please pick a time." };
  const start = new Date(t).toISOString();
  const tz = cleanTz(input.tz, lead);
  const rep = await getRep(rt, lead.closer_id);
  let offer = await kvGetJson<StoredOffer | null>(rt.env, `offer:${lead.id}`, null);
  if (!offer || (!offer.slots.includes(start) && now - offer.at > 60_000)) {
    // Expired or stale list: refresh it once, then the time must be in it.
    await offerSlots(rt, lead, tier, rep, tz, true);
    offer = await kvGetJson<StoredOffer | null>(rt.env, `offer:${lead.id}`, null);
  }
  if (!offer) return { ok: false, status: 502, code: "failed", message: "The calendar is not reachable right now.", route };
  if (!offer.slots.includes(start)) return { ok: false, status: 409, code: "taken", message: "That time has just gone. Here are the times still open.", slots: offer.slots };
  // One booking attempt at a time per lead (double taps, two tabs).
  if (!(await kvGate(rt.env, `booking_lock:${lead.id}`, 20_000, now))) return { ok: false, status: 409, code: "busy", message: "Still booking your first pick. One moment." };
  const r = await bookInvitee(rt, lead, offer.et.uri, start, tz, offer.et.locations);
  if (!r.ok) {
    await rt.env.DB.prepare("DELETE FROM kv_state WHERE key = ?").bind(`booking_lock:${lead.id}`).run();
    if (r.taken) {
      const fresh = await offerSlots(rt, lead, tier, rep, tz, true);
      return { ok: false, status: 409, code: "taken", message: "That time has just gone. Here are the times still open.", slots: fresh?.slots || [] };
    }
    return { ok: false, status: 502, code: "failed", message: "We couldn't book that time here. Please pick it on the full calendar.", route };
  }
  await applyInlineBooking(rt, lead, r, start);
  if (!validTimezone(lead.timezone)) await updateLead(rt, lead.id, { timezone: tz });
  await rt.env.DB.prepare("DELETE FROM kv_state WHERE key = ?").bind(`offer:${lead.id}`).run();
  const after = await getLead(rt, lead.id);
  return { ok: true, next: "/breakout", callAt: after?.call_at ?? t };
}

export interface SubmitResult { ok: boolean; route?: string; tier?: Tier; error?: string; slots?: string[]; closer?: { name: string }; tz?: string; }

export async function submitApplication(rt: Runtime, id: Identity, input: { tz?: unknown } = {}): Promise<SubmitResult> {
  const lead = await getLead(rt, id.leadId);
  if (!lead) return { ok: false, error: "no_lead" };
  if (lead.app_completed_at && lead.route) {
    // Idempotent: a second submit returns the same route without re-firing anything (and the times again).
    const tier = effectiveTier(lead) || "C";
    const offer = lead.status === "applied" && !liveBooking(lead, rt.now())
      ? await withTimeout(offerSlots(rt, lead, tier, await getRep(rt, lead.closer_id), cleanTz(input.tz, lead)), 4000)
      : null;
    return { ok: true, route: lead.route, tier, ...(offer || {}) };
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
  // Open times are fetched while the rest of submit runs; the browser's "analysing" screen covers the wait.
  const offerP = status === "applied" && !liveBooking(lead, rt.now())
    ? withTimeout((async () => offerSlots(rt, lead, tier, (await getRep(rt, lead.closer_id)) || closer, cleanTz(input.tz, lead)))(), 4000)
    : Promise.resolve(null);
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
  const offer = await offerP;
  return { ok: true, route, tier, ...(offer || {}) };
}

/**
 * No-JS fallback (POST /api/apply/nojs, form-encoded): the same validation as the contact step. Turnstile
 * cannot run without JavaScript, so the route applies stricter rate limits and a honeypot instead.
 */
export async function nojsContact(rt: Runtime, id: Identity, form: Record<string, unknown>): Promise<ContactResult> {
  if (String(form.website ?? "").trim()) return { ok: false, status: 400, code: "bad", message: "Please try again." };
  const name = clip(form.name ?? form.first_name, 120);
  const [first, ...rest] = name.split(/\s+/);
  return saveContact(rt, id, {
    first_name: first || "",
    last_name: form.last_name ?? rest.join(" "),
    email: form.email,
    phone: form.phone,
    phone_country: form.phone_country,
    call_consent: form.call_consent === "on" || form.call_consent === "true",
  }, { skipTurnstile: true });
}
