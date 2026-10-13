// Signed one-tap outcome links for the call pings: /admin/o/<lead>/<call_at>/<exp>/<sig>.
// The signature binds the lead, the call time and the expiry (48 hours after the call), so a link only
// ever logs the outcome of that one call and dies when the call is moved.

import type { Runtime } from "../app";
import { hmacHex, safeEqual } from "../lib/crypto";
import { signingSecret } from "../lib/secret";
import { getLead, type Lead } from "../funnel/leads";

const LEAD_ID = /^l[0-9a-z]{19}$/;
export const OUTCOME_LINK_TTL = 48 * 3_600_000;

async function outcomeSig(rt: Runtime, leadId: string, callAt: number, exp: number): Promise<string> {
  return (await hmacHex(await signingSecret(rt.env), `outcome|${leadId}|${callAt}|${exp}`)).slice(0, 32);
}

/** Absolute link for a lead's booked call. */
export async function outcomeLink(rt: Runtime, lead: Pick<Lead, "id" | "call_at">): Promise<string | null> {
  if (!lead.call_at || !LEAD_ID.test(lead.id)) return null;
  const exp = lead.call_at + OUTCOME_LINK_TTL;
  return `${rt.origin}/admin/o/${lead.id}/${lead.call_at}/${exp}/${await outcomeSig(rt, lead.id, lead.call_at, exp)}`;
}

/** The lead, only when the signature, expiry and call time all match. */
export async function verifyOutcomeLink(rt: Runtime, leadId: string, callAt: string, exp: string, sig: string): Promise<Lead | null> {
  if (!LEAD_ID.test(leadId || "") || !/^\d{10,14}$/.test(callAt || "") || !/^\d{10,14}$/.test(exp || "") || !/^[0-9a-f]{32}$/.test(sig || "")) return null;
  if (Number(exp) !== Number(callAt) + OUTCOME_LINK_TTL) return null;
  if (!safeEqual(await outcomeSig(rt, leadId, Number(callAt), Number(exp)), sig)) return null;
  if (!(Number(exp) > rt.now())) return null;
  const lead = await getLead(rt, leadId);
  if (!lead || lead.call_at !== Number(callAt)) return null;
  return lead;
}
