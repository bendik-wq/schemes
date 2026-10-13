// Calendly: signed webhooks, the API (personal access token), hourly sync, history import.
// Imported people (booking_source = 'calendly-direct') only ever get field updates.

import type { Runtime } from "../app";
import { hmacHex, safeEqual, sha256Hex } from "../lib/crypto";
import { newId, randomToken, refCode } from "../lib/ids";
import { kvGate, kvGet, kvGetJson, kvSet } from "../lib/kv";
import { getLead, getLeadByEmail, type Lead } from "../funnel/leads";
import { saveSetting } from "../settings";
import { applyCalendlyQualification } from "../sales/qualify";
import { applyLeadUpdate } from "../sales/outcomes";
import { markBooked, markCancelled, type BookingInfo } from "./booking";
import { validEmail } from "../funnel/application";

const API = "https://api.calendly.com";
const ID_RE = /^l[0-9a-z]{19}$/;

// ── Signature ─────────────────────────────────────────────────────────────────

/** Calendly-Webhook-Signature: "t=<unix>,v1=<hex hmac sha256 of `${t}.${body}`>", 5-minute window. */
export async function verifyCalendly(key: string, header: string | null, rawBody: string, nowMs: number): Promise<boolean> {
  if (!key || !header) return false;
  const parts = Object.fromEntries(header.split(",").map((p) => p.trim().split("=", 2) as [string, string]));
  const t = Number(parts.t);
  const v1 = parts.v1 || "";
  if (!t || !v1) return false;
  if (Math.abs(nowMs / 1000 - t) > 5 * 60) return false;
  return safeEqual(await hmacHex(key, `${t}.${rawBody}`), v1);
}

// ── API ───────────────────────────────────────────────────────────────────────

async function api(rt: Runtime, pathOrUrl: string, init: RequestInit = {}): Promise<{ ok: boolean; status: number; json: Record<string, any> }> {
  const url = pathOrUrl.startsWith("https://api.calendly.com/") ? pathOrUrl : `${API}${pathOrUrl}`;
  const r = await fetch(url, {
    ...init,
    headers: { authorization: `Bearer ${rt.settings.get("CALENDLY_API_TOKEN")}`, "content-type": "application/json", ...(init.headers || {}) },
  });
  const json = (await r.json().catch(() => ({}))) as Record<string, any>;
  return { ok: r.ok, status: r.status, json };
}

function isApiUri(u: unknown): u is string {
  return typeof u === "string" && /^https:\/\/api\.calendly\.com\/[a-z_]+\/[A-Za-z0-9-]+(\/[a-z_]+\/[A-Za-z0-9-]+)?$/.test(u);
}

export async function connectCalendly(rt: Runtime): Promise<{ ok: boolean; steps: string[]; error?: string }> {
  const steps: string[] = [];
  if (!rt.settings.has("CALENDLY_API_TOKEN")) return { ok: false, steps, error: "Add your Calendly personal access token first." };
  const me = await api(rt, "/users/me");
  if (!me.ok) return { ok: false, steps, error: `Calendly said ${me.status}. Check the token.` };
  const user = String(me.json.resource?.uri || "");
  const org = String(me.json.resource?.current_organization || "");
  await saveSetting(rt.env, "CALENDLY_USER_URI", user);
  await saveSetting(rt.env, "CALENDLY_ORG_URI", org);
  steps.push(`Connected as ${String(me.json.resource?.name || "your account").slice(0, 60)}`);
  const sched = String(me.json.resource?.scheduling_url || "");
  if (sched) steps.push(`Your scheduling page: ${sched}`);

  // Remove the subscription we created before (never touch ones other tools created).
  const old = rt.settings.get("CALENDLY_WEBHOOK_URI");
  if (isApiUri(old)) {
    const del = await api(rt, old, { method: "DELETE" });
    steps.push(del.ok || del.status === 404 ? "Removed the previous webhook we created" : `Could not remove the previous webhook (${del.status})`);
  }
  const signingKey = randomToken(24);
  const body = {
    url: `${rt.origin}/hooks/calendly`,
    events: ["invitee.created", "invitee.canceled", "invitee_no_show.created"],
    organization: org,
    scope: "organization",
    signing_key: signingKey,
  };
  let sub = await api(rt, "/webhook_subscriptions", { method: "POST", body: JSON.stringify(body) });
  if (!sub.ok && (sub.status === 403 || sub.status === 400)) {
    sub = await api(rt, "/webhook_subscriptions", { method: "POST", body: JSON.stringify({ ...body, scope: "user", user }) });
  }
  if (!sub.ok) return { ok: false, steps, error: `Could not create the webhook (${sub.status}): ${JSON.stringify(sub.json).slice(0, 200)}` };
  await saveSetting(rt.env, "CALENDLY_WEBHOOK_URI", String(sub.json.resource?.uri || ""));
  await saveSetting(rt.env, "CALENDLY_SIGNING_KEY", signingKey);
  steps.push(`Webhook created → ${body.url}`);
  return { ok: true, steps };
}

export interface CalendlyInvitee {
  uri: string;
  email: string;
  name: string;
  status: string;
  rescheduled: boolean;
  cancel_url: string | null;
  reschedule_url: string | null;
  no_show: boolean;
  tracking: Record<string, string | null>;
  answers: Array<{ q: string; a: string }>;
}

export interface CalendlyEvent {
  uri: string;
  name: string;
  start: number | null;
  status: string;
  joinUrl: string | null;
  hostEmail: string | null;
}

export function parseEvent(e: Record<string, any>): CalendlyEvent {
  return {
    uri: String(e.uri || ""),
    name: String(e.name || "").slice(0, 120),
    start: e.start_time ? Date.parse(e.start_time) : null,
    status: String(e.status || "active"),
    joinUrl: typeof e.location?.join_url === "string" ? e.location.join_url : typeof e.location?.location === "string" && /^https:/.test(e.location.location) ? e.location.location : null,
    hostEmail: String(e.event_memberships?.[0]?.user_email || "") || null,
  };
}

export function parseInvitee(i: Record<string, any>): CalendlyInvitee {
  return {
    uri: String(i.uri || ""),
    email: String(i.email || "").toLowerCase().slice(0, 254),
    name: String(i.name || "").slice(0, 120),
    status: String(i.status || "active"),
    rescheduled: !!i.rescheduled,
    cancel_url: typeof i.cancel_url === "string" ? i.cancel_url : null,
    reschedule_url: typeof i.reschedule_url === "string" ? i.reschedule_url : null,
    no_show: !!i.no_show,
    tracking: (i.tracking && typeof i.tracking === "object" ? i.tracking : {}) as Record<string, string | null>,
    answers: Array.isArray(i.questions_and_answers)
      ? i.questions_and_answers.slice(0, 12).map((x: any) => ({ q: String(x?.question || "").slice(0, 200), a: String(x?.answer || "").slice(0, 1000) }))
      : [],
  };
}

export async function eventWithInvitees(rt: Runtime, eventUri: string): Promise<{ event: CalendlyEvent; invitees: CalendlyInvitee[] } | null> {
  if (!isApiUri(eventUri) || !rt.settings.has("CALENDLY_API_TOKEN")) return null;
  const ev = await api(rt, eventUri);
  if (!ev.ok) return null;
  const inv = await api(rt, `${eventUri}/invitees?count=100`);
  return { event: parseEvent(ev.json.resource || {}), invitees: (inv.json.collection || []).map(parseInvitee) };
}

// ── Matching ─────────────────────────────────────────────────────────────────

async function matchLead(rt: Runtime, inv: CalendlyInvitee): Promise<{ lead: Lead | null; kind: "uuid" | "email" | null }> {
  const uuid = inv.tracking?.salesforce_uuid || "";
  if (ID_RE.test(uuid)) {
    const l = await getLead(rt, uuid);
    if (l) return { lead: l, kind: "uuid" };
  }
  const email = validEmail(inv.email);
  if (email) {
    const l = await getLeadByEmail(rt, email);
    if (l) return { lead: l, kind: "email" };
  }
  return { lead: null, kind: null };
}

async function createDirectLead(rt: Runtime, inv: CalendlyInvitee): Promise<Lead | null> {
  const email = validEmail(inv.email);
  if (!email) return null;
  const [first, ...rest] = inv.name.split(" ");
  const now = rt.now();
  const id = newId("l");
  await rt.env.DB.prepare(
    `INSERT INTO leads (id, ref_code, created_at, updated_at, first_name, last_name, email, answers, status, booking_source, channel, utm_source, utm_medium, utm_campaign, utm_content)
     VALUES (?,?,?,?,?,?,?,'{}','booked','calendly-direct','Calendly',?,?,?,?) ON CONFLICT(email) DO NOTHING`,
  ).bind(id, refCode(), now, now, first?.slice(0, 60) || null, rest.join(" ").slice(0, 60) || null, email,
    inv.tracking?.utm_source ?? null, inv.tracking?.utm_medium ?? null, inv.tracking?.utm_campaign ?? null, inv.tracking?.utm_content ?? null).run();
  return getLeadByEmail(rt, email);
}

async function upsertBookingRow(rt: Runtime, ev: CalendlyEvent, inv: CalendlyInvitee, leadId: string | null, kind: string | null) {
  const now = rt.now();
  await rt.env.DB.prepare(
    `INSERT INTO calendly_bookings (invitee_uri, event_uri, lead_id, match_kind, name, email, event_name, start_at, status, no_show, rescheduled, host_email, answers, tracking, created_at, updated_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
     ON CONFLICT(invitee_uri) DO UPDATE SET lead_id = COALESCE(calendly_bookings.lead_id, excluded.lead_id), match_kind = COALESCE(calendly_bookings.match_kind, excluded.match_kind),
       start_at = excluded.start_at, status = excluded.status, no_show = excluded.no_show, rescheduled = excluded.rescheduled,
       host_email = excluded.host_email, answers = excluded.answers, updated_at = excluded.updated_at`,
  ).bind(inv.uri, ev.uri, leadId, kind, inv.name, inv.email, ev.name, ev.start, inv.status === "canceled" || ev.status === "canceled" ? "canceled" : "active",
    inv.no_show ? 1 : 0, inv.rescheduled ? 1 : 0, ev.hostEmail, JSON.stringify(inv.answers), JSON.stringify(inv.tracking || {}), now, now).run();
}

/** Apply one invitee's state to the lead record (live webhook, sync or import). */
export async function applyInvitee(rt: Runtime, ev: CalendlyEvent, inv: CalendlyInvitee, opts: { createDirect: boolean; ownBrowserLeadId?: string }): Promise<string> {
  let { lead, kind } = await matchLead(rt, inv);
  // The lead's own linked browser reported this booking and Calendly confirms it: as good as the uuid.
  if (lead && kind === "email" && opts.ownBrowserLeadId === lead.id) kind = "uuid";
  if (!lead && opts.createDirect) {
    lead = await createDirectLead(rt, inv);
    kind = lead ? "email" : null;
  }
  await upsertBookingRow(rt, ev, inv, lead?.id ?? null, kind);
  if (!lead) return "unmatched";
  const canceled = inv.status === "canceled" || ev.status === "canceled";
  if (canceled) return (await markCancelled(rt, lead, inv.uri, { rescheduled: inv.rescheduled })) || "noop";
  const info: BookingInfo = {
    provider: "calendly",
    ref: inv.uri,
    callAt: ev.start,
    joinUrl: ev.joinUrl,
    rescheduleUrl: inv.reschedule_url,
    cancelUrl: inv.cancel_url,
    hostEmail: ev.hostEmail,
    answers: inv.answers,
    verified: kind === "uuid" ? "strong" : "email",
    replaces: await replacesPrevious(rt, lead, inv),
  };
  const r = await markBooked(rt, lead, info);
  const fresh = await getLead(rt, lead.id);
  if (fresh && !fresh.app_completed_at) await applyCalendlyQualification(rt, fresh);
  if (inv.no_show && fresh && fresh.status === "booked" && fresh.booking_ref === inv.uri && fresh.booking_verified) {
    await applyLeadUpdate(rt, fresh, { status: "no_show" }, { source: "calendly" });
  }
  return r;
}

/** A Calendly reschedule: the lead's current booking was cancelled with rescheduled=true by this same person. */
async function replacesPrevious(rt: Runtime, lead: Lead, inv: CalendlyInvitee): Promise<boolean> {
  if (!lead.booking_ref || lead.booking_ref === inv.uri) return false;
  const prev = await rt.env.DB.prepare("SELECT rescheduled, email FROM calendly_bookings WHERE invitee_uri = ?").bind(lead.booking_ref).first<{ rescheduled: number; email: string | null }>();
  return !!prev?.rescheduled && (prev.email || "").toLowerCase() === inv.email;
}

// ── Webhook ───────────────────────────────────────────────────────────────────

export async function handleCalendlyWebhook(rt: Runtime, body: Record<string, any>): Promise<string> {
  const event = String(body.event || "");
  const p = body.payload || {};
  if (event === "invitee_no_show.created") {
    const inviteeUri = String(p.invitee || "");
    const row = await rt.env.DB.prepare("SELECT lead_id FROM calendly_bookings WHERE invitee_uri = ?").bind(inviteeUri).first<{ lead_id: string | null }>();
    await rt.env.DB.prepare("UPDATE calendly_bookings SET no_show = 1, updated_at = ? WHERE invitee_uri = ?").bind(rt.now(), inviteeUri).run();
    const lead = await getLead(rt, row?.lead_id);
    if (lead && lead.booking_ref === inviteeUri && lead.status === "booked" && lead.booking_verified) await applyLeadUpdate(rt, lead, { status: "no_show" }, { source: "calendly" });
    return "no_show";
  }
  if (event !== "invitee.created" && event !== "invitee.canceled") return "ignored";
  const inv = parseInvitee(p);
  let ev = parseEvent(p.scheduled_event || {});
  // Prefer the API's view of the event (exact time, join URL, host) when we have a token.
  if (isApiUri(ev.uri)) {
    const full = await eventWithInvitees(rt, ev.uri);
    if (full) {
      ev = full.event;
      const fresh = full.invitees.find((x) => x.uri === inv.uri);
      if (fresh) Object.assign(inv, { answers: fresh.answers.length ? fresh.answers : inv.answers, reschedule_url: fresh.reschedule_url ?? inv.reschedule_url, cancel_url: fresh.cancel_url ?? inv.cancel_url });
    }
  }
  return applyInvitee(rt, ev, inv, { createDirect: true });
}

/** Browser postMessage report: verify with the API when we can; otherwise it only updates the page. */
export async function verifyClientBooking(rt: Runtime, lead: Lead, eventUri: unknown, inviteeUri: unknown): Promise<"verified" | "claimed"> {
  if (!isApiUri(eventUri) || !isApiUri(inviteeUri) || !rt.settings.has("CALENDLY_API_TOKEN")) return "claimed";
  const full = await eventWithInvitees(rt, eventUri);
  const inv = full?.invitees.find((x) => x.uri === inviteeUri);
  if (!full || !inv) return "claimed";
  const uuidOk = inv.tracking?.salesforce_uuid === lead.id;
  const emailOk = inv.email === lead.email;
  if (!uuidOk && !emailOk) return "claimed";
  await applyInvitee(rt, full.event, inv, { createDirect: false, ownBrowserLeadId: lead.id });
  return "verified";
}

// ── Sync and import ───────────────────────────────────────────────────────────

async function listEvents(rt: Runtime, minStart: string, maxStart: string | null, pageToken: string | null) {
  const owner = rt.settings.get("CALENDLY_ORG_URI") ? `organization=${encodeURIComponent(rt.settings.get("CALENDLY_ORG_URI"))}` : `user=${encodeURIComponent(rt.settings.get("CALENDLY_USER_URI"))}`;
  const q = [owner, `min_start_time=${encodeURIComponent(minStart)}`, "count=100", "sort=start_time:asc"];
  if (maxStart) q.push(`max_start_time=${encodeURIComponent(maxStart)}`);
  if (pageToken) q.push(`page_token=${encodeURIComponent(pageToken)}`);
  const r = await api(rt, `/scheduled_events?${q.join("&")}`);
  return { ok: r.ok, status: r.status, events: ((r.json.collection || []) as Record<string, any>[]).map(parseEvent), next: (r.json.pagination?.next_page_token as string | null) || null };
}

/** Hourly: catch anything the webhook missed, including cancellations and no-show marks. */
export async function syncCalendly(rt: Runtime, force = false): Promise<{ events: number; changes: number } | null> {
  const s = rt.settings;
  if (!s.has("CALENDLY_API_TOKEN") || (!s.has("CALENDLY_ORG_URI") && !s.has("CALENDLY_USER_URI"))) return null;
  if (!force && !(await kvGate(rt.env, "gate:calendly_sync", 55 * 60_000))) return null;
  const now = rt.now();
  let token: string | null = null;
  let events = 0, changes = 0;
  for (let page = 0; page < 5; page++) {
    const r = await listEvents(rt, new Date(now - 3 * 86_400_000).toISOString(), new Date(now + 60 * 86_400_000).toISOString(), token);
    if (!r.ok) break;
    for (const ev of r.events) {
      events++;
      const full = await eventWithInvitees(rt, ev.uri);
      for (const inv of full?.invitees || []) {
        const res = await applyInvitee(rt, full!.event, inv, { createDirect: true });
        if (res !== "noop" && res !== "unmatched") changes++;
      }
    }
    token = r.next;
    if (!token) break;
  }
  return { events, changes };
}

/** One-off pull of past bookings. Resumable: call again until done. Imported people are never marketed. */
export async function importCalendlyHistory(rt: Runtime): Promise<{ imported: number; done: boolean }> {
  if (!rt.settings.has("CALENDLY_API_TOKEN")) return { imported: 0, done: true };
  const token = await kvGet(rt.env, "calendly:import_token");
  const r = await listEvents(rt, new Date(rt.now() - 3 * 365 * 86_400_000).toISOString(), new Date(rt.now() - 60_000).toISOString(), token);
  if (!r.ok) return { imported: 0, done: true };
  let imported = 0;
  for (const ev of r.events) {
    const full = await eventWithInvitees(rt, ev.uri);
    for (const inv of full?.invitees || []) {
      const { lead, kind } = await matchLead(rt, inv);
      let l = lead;
      if (!l) l = await createDirectLead(rt, inv);
      await upsertBookingRow(rt, full!.event, inv, l?.id ?? null, lead ? kind : "import");
      // History never changes funnel leads' state; direct leads get their fields only.
      if (l && l.booking_source === "calendly-direct") {
        await rt.env.DB.prepare(
          "UPDATE leads SET call_at = COALESCE(?, call_at), booking_answers = COALESCE(?, booking_answers), booking_provider = 'calendly', booking_ref = COALESCE(booking_ref, ?), updated_at = ? WHERE id = ?",
        ).bind(full!.event.start, inv.answers.length ? JSON.stringify(inv.answers) : null, inv.uri, rt.now(), l.id).run();
        const fresh = await getLead(rt, l.id);
        if (fresh) await applyCalendlyQualification(rt, fresh);
      }
      imported++;
    }
  }
  if (r.next) await kvSet(rt.env, "calendly:import_token", r.next);
  else await rt.env.DB.prepare("DELETE FROM kv_state WHERE key = 'calendly:import_token'").run();
  return { imported, done: !r.next };
}

// ── Inline booking (Scheduling API) ───────────────────────────────────────────
// The form shows a few open times right after submit; the Worker books through the API, so the browser
// never talks to Calendly (CSP connect-src 'self'). The webhook for the same invitee arrives later and is
// a no-op: markBooked claims each booking ref once.

const MIN = 60_000;
const DAY = 86_400_000;

export interface EventTypeRef { uri: string; locations: Array<{ kind: string; location?: string }> }

function schedKey(u: string): string {
  try {
    const x = new URL(u);
    return (x.hostname.replace(/^www\./, "") + x.pathname).toLowerCase().replace(/\/+$/, "");
  } catch {
    return "";
  }
}

/** Pure: the active event type whose scheduling URL is the configured booking URL (query ignored). */
export function matchEventType(collection: Array<Record<string, any>>, bookingUrl: string): EventTypeRef | null {
  const want = schedKey(bookingUrl);
  if (!want) return null;
  const hit = collection.find((e) => e && e.active !== false && schedKey(String(e.scheduling_url || "")) === want);
  if (!hit || !isApiUri(hit.uri)) return null;
  const locations = Array.isArray(hit.locations)
    ? hit.locations.slice(0, 5).map((l: any) => ({ kind: String(l?.kind || "").slice(0, 40), location: typeof l?.location === "string" ? l.location.slice(0, 200) : undefined }))
    : [];
  return { uri: hit.uri, locations };
}

/** The event type behind a booking URL (closer calendar or BOOKING_URL_A/B). Cached a day (misses 10 minutes). */
export async function resolveEventType(rt: Runtime, bookingUrl: string): Promise<EventTypeRef | null> {
  if (!rt.settings.has("CALENDLY_API_TOKEN") || !schedKey(bookingUrl)) return null;
  const key = `cal_et:${(await sha256Hex(schedKey(bookingUrl))).slice(0, 24)}`;
  const cached = await kvGetJson<{ at: number; et: EventTypeRef | null } | null>(rt.env, key, null);
  if (cached && rt.now() - cached.at < (cached.et ? DAY : 10 * MIN)) return cached.et;
  const owners: string[] = [];
  if (rt.settings.get("CALENDLY_ORG_URI")) owners.push(`organization=${encodeURIComponent(rt.settings.get("CALENDLY_ORG_URI"))}`);
  let user = rt.settings.get("CALENDLY_USER_URI");
  if (!user && !owners.length) {
    const me = await api(rt, "/users/me");
    user = me.ok ? String(me.json.resource?.uri || "") : "";
  }
  if (user) owners.push(`user=${encodeURIComponent(user)}`);
  let et: EventTypeRef | null = null;
  outer: for (const owner of owners) {
    let page: string | null = null;
    for (let i = 0; i < 3; i++) {
      const r = await api(rt, `/event_types?${owner}&count=100${page ? `&page_token=${encodeURIComponent(page)}` : ""}`);
      if (!r.ok) break;
      et = matchEventType(r.json.collection || [], bookingUrl);
      if (et) break outer;
      page = (r.json.pagination?.next_page_token as string | null) || null;
      if (!page) break;
    }
  }
  await kvSet(rt.env, key, JSON.stringify({ at: rt.now(), et }));
  return et;
}

/** Pure: open start times (ISO UTC) from an event_type_available_times response: sorted, unique, not too soon. */
export function parseAvailable(collection: unknown, now: number): string[] {
  if (!Array.isArray(collection)) return [];
  const out = new Set<string>();
  for (const x of collection.slice(0, 500)) {
    if (!x || (x as any).status !== "available") continue;
    const t = Date.parse(String((x as any).start_time || ""));
    if (Number.isFinite(t) && t > now + 10 * MIN) out.add(new Date(t).toISOString());
  }
  return [...out].sort();
}

/** Open times for an event type over the next `days` days (Calendly allows at most 7). Cached ~60 s. */
export async function availableTimes(rt: Runtime, eventTypeUri: string, days = 5, opts: { fresh?: boolean } = {}): Promise<string[] | null> {
  if (!isApiUri(eventTypeUri) || !rt.settings.has("CALENDLY_API_TOKEN")) return null;
  const span = Math.min(7, Math.max(1, Math.round(days)));
  const key = `cal_slots:${(await sha256Hex(eventTypeUri)).slice(0, 24)}:${span}`;
  if (!opts.fresh) {
    const c = await kvGetJson<{ at: number; slots: string[] } | null>(rt.env, key, null);
    if (c && rt.now() - c.at < 60_000) return c.slots.filter((s) => Date.parse(s) > rt.now() + 10 * MIN);
  }
  const start = rt.now() + 2 * MIN;
  const end = start + span * DAY - MIN;
  const q = `event_type=${encodeURIComponent(eventTypeUri)}&start_time=${encodeURIComponent(new Date(start).toISOString())}&end_time=${encodeURIComponent(new Date(end).toISOString())}`;
  const r = await api(rt, `/event_type_available_times?${q}`);
  if (!r.ok) return null;
  const slots = parseAvailable(r.json.collection, rt.now());
  await kvSet(rt.env, key, JSON.stringify({ at: rt.now(), slots }));
  return slots;
}

/** Pure: at most `perDay` times on each of the first `maxDays` local days, spread across the day. */
export function pickSlots(slots: string[], tz: string, perDay = 6, maxDays = 5): string[] {
  const opts: Intl.DateTimeFormatOptions = { year: "numeric", month: "2-digit", day: "2-digit" };
  let fmt: Intl.DateTimeFormat;
  try { fmt = new Intl.DateTimeFormat("en-CA", { ...opts, timeZone: tz }); }
  catch { fmt = new Intl.DateTimeFormat("en-CA", { ...opts, timeZone: "UTC" }); }
  const days = new Map<string, string[]>();
  for (const s of slots) {
    const k = fmt.format(new Date(s));
    if (!days.has(k)) {
      if (days.size >= maxDays) break;
      days.set(k, []);
    }
    days.get(k)!.push(s);
  }
  const out: string[] = [];
  for (const list of days.values()) {
    if (list.length <= perDay) { out.push(...list); continue; }
    const at = new Set<number>();
    for (let i = 0; i < perDay; i++) at.add(Math.round((i * (list.length - 1)) / (perDay - 1)));
    for (const i of [...at].sort((a, b) => a - b)) out.push(list[i]);
  }
  return out;
}

/** Pure: the location to send with a booking. Video kinds need nothing; an outbound phone call uses the lead's number. */
export function inviteeLocation(locs: EventTypeRef["locations"], phone: string | null): { kind: string; location?: string } | undefined {
  if (!locs.length) return undefined;
  const conf = locs.find((l) => /_conference$/.test(l.kind));
  if (conf) return { kind: conf.kind };
  const l = locs[0];
  if (l.kind === "outbound_call") return phone ? { kind: l.kind, location: phone } : undefined;
  if (l.location) return { kind: l.kind, location: l.location };
  return { kind: l.kind };
}

export type BookResult =
  | { ok: true; inviteeUri: string; eventUri: string; invitee: CalendlyInvitee }
  | { ok: false; status: number; taken: boolean };

/** POST /invitees for the lead at `startUtc`. Tracking carries the lead id so every later sync matches strongly. */
export async function bookInvitee(
  rt: Runtime, lead: Lead, eventTypeUri: string, startUtc: string, tz: string, locations: EventTypeRef["locations"] = [],
): Promise<BookResult> {
  if (!isApiUri(eventTypeUri) || !rt.settings.has("CALENDLY_API_TOKEN")) return { ok: false, status: 0, taken: false };
  const name = [lead.first_name, lead.last_name].filter(Boolean).join(" ") || lead.email;
  const body: Record<string, unknown> = {
    event_type: eventTypeUri,
    start_time: startUtc,
    invitee: { name, first_name: lead.first_name || undefined, last_name: lead.last_name || undefined, email: lead.email, timezone: tz },
    tracking: {
      salesforce_uuid: lead.id,
      utm_source: lead.utm_source || undefined, utm_medium: lead.utm_medium || undefined,
      utm_campaign: lead.utm_campaign || undefined, utm_content: lead.utm_content || undefined,
    },
  };
  const loc = inviteeLocation(locations, lead.phone);
  if (loc) body.location = loc;
  let r: Awaited<ReturnType<typeof api>>;
  try {
    r = await api(rt, "/invitees", { method: "POST", body: JSON.stringify(body) });
  } catch {
    return { ok: false, status: 0, taken: false };
  }
  if (!r.ok) {
    const msg = JSON.stringify(r.json).slice(0, 2000);
    const taken = r.status === 409 || ((r.status === 400 || r.status === 422) && /no longer available|not available|unavailable|already (been )?(booked|taken)|taken/i.test(msg));
    return { ok: false, status: r.status, taken };
  }
  const res = (r.json.resource || {}) as Record<string, any>;
  const invitee = parseInvitee(res);
  invitee.tracking = { ...invitee.tracking, salesforce_uuid: lead.id };
  const eventUri = String(res.event || "");
  if (!isApiUri(invitee.uri) || !isApiUri(eventUri)) return { ok: false, status: r.status, taken: false };
  return { ok: true, inviteeUri: invitee.uri, eventUri, invitee };
}

/**
 * Run the normal booking pipeline for a booking the Worker just made for the lead's own browser: read it
 * back from the API (exact time, join URL, host) and apply it as a strong match; if that read lags, apply
 * what POST /invitees returned. markBooked claims the ref once, so the webhook for this invitee is a no-op.
 */
export async function applyInlineBooking(rt: Runtime, lead: Lead, b: Extract<BookResult, { ok: true }>, startUtc: string): Promise<string> {
  const v = await verifyClientBooking(rt, lead, b.eventUri, b.inviteeUri);
  if (v === "verified") return "verified";
  const ev: CalendlyEvent = { uri: b.eventUri, name: "", start: Date.parse(startUtc) || null, status: "active", joinUrl: null, hostEmail: null };
  return applyInvitee(rt, ev, b.invitee, { createDirect: false, ownBrowserLeadId: lead.id });
}

/** Match bookings that arrived before their lead existed. */
export async function linkOrphans(rt: Runtime): Promise<number> {
  const r = await rt.env.DB.prepare(
    `UPDATE calendly_bookings SET lead_id = (SELECT id FROM leads WHERE leads.email = calendly_bookings.email), match_kind = 'email'
     WHERE lead_id IS NULL AND email IN (SELECT email FROM leads)`,
  ).run();
  return r.meta?.changes ?? 0;
}
