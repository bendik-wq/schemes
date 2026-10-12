// markBooked / markCancelled. Idempotent per booking ref. Side effects (emails, AI calls, pings,
// ad conversions) fire exactly once, and only for verified bookings of funnel leads.

import type { Runtime } from "../app";
import { TIER_VALUE } from "../config";
import { getLead, updateLead, effectiveTier, type Lead } from "../funnel/leads";
import { getRepByEmail } from "../sales/reps";
import { sha256Hex } from "../lib/crypto";
import { track } from "../tracking/track";
import { enqueueSequence, cancelSequences } from "./email";
import { CANCEL_ON_BOOKING } from "./sequences";
import { queueCall, cancelCalls } from "./elevenlabs";
import { notifyTeam } from "./notify";

const DAY = 86_400_000;

export interface BookingInfo {
  provider: string;
  ref: string;
  callAt: number | null;
  joinUrl?: string | null;
  rescheduleUrl?: string | null;
  cancelUrl?: string | null;
  hostEmail?: string | null;
  answers?: Array<{ q: string; a: string }> | null;
  /** "strong" = matched by our lead id (salesforce_uuid); "email" = email-only match; "none" = unverified browser claim. */
  verified: "strong" | "email" | "none";
}

const SAFE_HOSTS = /^(?:[a-z0-9-]+\.)*(zoom\.us|zoom\.com|meet\.google\.com|teams\.microsoft\.com|teams\.live\.com|calendly\.com|cal\.com|whereby\.com|webex\.com|around\.co|riverside\.fm)$/i;

/** Only https meeting/booking links on known hosts are stored and redirected to. */
export function safeExternalUrl(u: string | null | undefined): string | null {
  if (!u) return null;
  try {
    const x = new URL(u);
    if (x.protocol !== "https:" || !SAFE_HOSTS.test(x.hostname)) return null;
    return x.toString().slice(0, 500);
  } catch {
    return null;
  }
}

/** Imported or old bookings: field updates only, never side effects. */
export function isHistorical(lead: Pick<Lead, "booking_source" | "call_at">, now: number): boolean {
  return lead.booking_source === "calendly-direct" || (!!lead.call_at && now - lead.call_at > 14 * DAY);
}

export async function markBooked(rt: Runtime, lead: Lead, b: BookingInfo): Promise<"noop" | "updated" | "booked" | "rescheduled"> {
  const now = rt.now();
  const fields: Partial<Lead> = {
    booking_provider: b.provider,
    booking_join_url: safeExternalUrl(b.joinUrl) ?? lead.booking_join_url,
    booking_reschedule_url: safeExternalUrl(b.rescheduleUrl) ?? lead.booking_reschedule_url,
    booking_cancel_url: safeExternalUrl(b.cancelUrl) ?? lead.booking_cancel_url,
    booking_host_email: b.hostEmail ? b.hostEmail.toLowerCase().slice(0, 120) : lead.booking_host_email,
  };
  if (b.answers?.length) fields.booking_answers = JSON.stringify(b.answers.slice(0, 12).map((x) => ({ q: String(x.q).slice(0, 200), a: String(x.a).slice(0, 1000) })));
  const host = await getRepByEmail(rt, b.hostEmail);
  if (host) fields.closer_id = host.id;

  const sameRef = lead.booking_ref === b.ref && !lead.booking_cancelled_at;
  // A booking matched only by email never replaces a different live booking (it may not be them).
  const liveOther = !!lead.booking_ref && lead.booking_ref !== b.ref && !lead.booking_cancelled_at && !!lead.call_at && lead.call_at > now;
  if (b.verified !== "strong" && liveOther) return "noop";
  const timeChanged = !!b.callAt && b.callAt !== lead.call_at;

  if (sameRef && !timeChanged) {
    await updateLead(rt, lead.id, fields);
    return "noop";
  }

  const historical = lead.booking_source === "calendly-direct" || (!!b.callAt && now - b.callAt > 14 * DAY);
  const status = ["won", "lost", "showed"].includes(lead.status) ? lead.status : "booked";

  if (sameRef && timeChanged) {
    await updateLead(rt, lead.id, { ...fields, call_at: b.callAt });
    if (historical || b.verified !== "strong") return "updated";
    const fresh = (await getLead(rt, lead.id))!;
    await enqueueSequence(rt, fresh, "booked");
    await enqueueSequence(rt, fresh, "precall");
    await cancelCalls(rt, lead.id, ["confirm"]);
    await queueCall(rt, fresh, "confirm");
    await track(rt, { leadId: lead.id }, { name: "booking_rescheduled", source: "webhook", props: { provider: b.provider } });
    rt.waitUntil(notifyTeam(rt, "rescheduled", fresh));
    return "rescheduled";
  }

  // A new booking (or a rebooking after a cancel / no-show). Claim it atomically so the browser
  // report and the webhook, arriving together, fire the side effects exactly once.
  const claim = await rt.env.DB.prepare(
    "UPDATE leads SET booking_ref = ?, booking_cancelled_at = NULL, updated_at = ? WHERE id = ? AND (booking_ref IS NULL OR booking_ref != ? OR booking_cancelled_at IS NOT NULL)",
  ).bind(b.ref, now, lead.id, b.ref).run();
  if (!claim.meta?.changes) return "noop";
  await updateLead(rt, lead.id, {
    ...fields,
    call_at: b.callAt,
    booked_at: lead.booked_at && !lead.booking_cancelled_at ? lead.booked_at : now,
    status,
  });
  if (historical) return "updated";
  const fresh = (await getLead(rt, lead.id))!;
  if (b.verified !== "strong") {
    // An email typed into Calendly is not proof of identity: record the booking, tell the team,
    // but send nothing to the inbox, call no one and report nothing to ad platforms.
    if (b.verified === "email") rt.waitUntil(notifyTeam(rt, "booked", fresh, "Matched by email only. Confirm in Funnel HQ before reminders go out."));
    return "updated";
  }
  await cancelSequences(rt, lead.id, CANCEL_ON_BOOKING);
  await cancelCalls(rt, lead.id, ["speed_to_lead", "rebook"]);
  await queueCall(rt, fresh, "confirm");
  rt.waitUntil(notifyTeam(rt, "booked", fresh));
  await enqueueSequence(rt, fresh, "booked");
  await enqueueSequence(rt, fresh, "precall");
  const tier = effectiveTier(fresh) || "B";
  const eventId = "e" + (await sha256Hex("booking|" + b.ref)).slice(0, 19);
  await track(rt, { leadId: lead.id }, { name: "booking_scheduled", source: "webhook", props: { provider: b.provider, tier }, value: TIER_VALUE[tier], currency: "USD", eventId });
  return "booked";
}

/** Admin confirmed an email-only booking: run the side effects a verified booking gets. */
export async function confirmBooking(rt: Runtime, lead: Lead): Promise<boolean> {
  if (lead.status !== "booked" || !lead.call_at || lead.booking_cancelled_at || isHistorical(lead, rt.now())) return false;
  await cancelSequences(rt, lead.id, CANCEL_ON_BOOKING);
  await cancelCalls(rt, lead.id, ["speed_to_lead", "rebook"]);
  await queueCall(rt, lead, "confirm");
  await enqueueSequence(rt, lead, "booked");
  await enqueueSequence(rt, lead, "precall");
  return true;
}

export async function markCancelled(rt: Runtime, lead: Lead, ref: string, opts: { rescheduled?: boolean } = {}): Promise<"noop" | "cancelled"> {
  if (lead.booking_ref && ref && lead.booking_ref !== ref) return "noop";
  if (opts.rescheduled) return "noop"; // the new invitee.created carries the new time
  if (lead.booking_cancelled_at) return "noop";
  const now = rt.now();
  await updateLead(rt, lead.id, { booking_cancelled_at: now, status: lead.status === "booked" ? "applied" : lead.status });
  if (isHistorical(lead, now)) return "cancelled";
  await cancelSequences(rt, lead.id, ["booked", "precall"]);
  await cancelCalls(rt, lead.id, ["confirm"]);
  const fresh = (await getLead(rt, lead.id))!;
  await track(rt, { leadId: lead.id }, { name: "booking_cancelled", source: "webhook" });
  rt.waitUntil(notifyTeam(rt, "cancelled", fresh));
  await enqueueSequence(rt, fresh, "cancelled");
  return "cancelled";
}
