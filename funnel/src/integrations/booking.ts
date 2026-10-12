// markBooked / markCancelled. Idempotent per booking ref. Side effects (emails, AI calls, pings,
// ad conversions) fire exactly once, and only for verified bookings of funnel leads.

import type { Runtime } from "../app";
import { TIER_VALUE } from "../config";
import { getLead, updateLead, effectiveTier, type Lead } from "../funnel/leads";
import { getRepByEmail } from "../sales/reps";
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
  const timeChanged = !!b.callAt && b.callAt !== lead.call_at;

  if (sameRef && !timeChanged) {
    await updateLead(rt, lead.id, fields);
    return "noop";
  }

  const historical = lead.booking_source === "calendly-direct" || (!!b.callAt && now - b.callAt > 14 * DAY);
  const status = ["won", "lost", "showed"].includes(lead.status) ? lead.status : "booked";

  if (sameRef && timeChanged) {
    await updateLead(rt, lead.id, { ...fields, call_at: b.callAt });
    if (historical || b.verified === "none") return "updated";
    const fresh = (await getLead(rt, lead.id))!;
    await enqueueSequence(rt, fresh, "booked");
    await enqueueSequence(rt, fresh, "precall");
    await cancelCalls(rt, lead.id, ["confirm"]);
    if (b.verified === "strong") await queueCall(rt, fresh, "confirm");
    await track(rt, { leadId: lead.id }, { name: "booking_rescheduled", source: "webhook", props: { provider: b.provider } });
    rt.waitUntil(notifyTeam(rt, "rescheduled", fresh));
    return "rescheduled";
  }

  // A new booking (or a rebooking after a cancel / no-show).
  await updateLead(rt, lead.id, {
    ...fields,
    booking_ref: b.ref,
    call_at: b.callAt,
    booked_at: lead.booked_at && !lead.booking_cancelled_at ? lead.booked_at : now,
    booking_cancelled_at: null,
    status,
  });
  if (historical) return "updated";
  if (b.verified === "none") return "updated";
  const fresh = (await getLead(rt, lead.id))!;
  await cancelSequences(rt, lead.id, CANCEL_ON_BOOKING);
  await cancelCalls(rt, lead.id, ["speed_to_lead", "rebook"]);
  if (b.verified === "strong") await queueCall(rt, fresh, "confirm");
  rt.waitUntil(notifyTeam(rt, "booked", fresh));
  await enqueueSequence(rt, fresh, "booked");
  await enqueueSequence(rt, fresh, "precall");
  const tier = effectiveTier(fresh) || "B";
  await track(rt, { leadId: lead.id }, { name: "booking_scheduled", source: "webhook", props: { provider: b.provider, tier }, value: TIER_VALUE[tier], currency: "USD" });
  return "booked";
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
