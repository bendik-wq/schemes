// Suppression list: unsubscribes and do-not-call requests outlive erasure. Only HMACs are stored.
// Also: per-lead email status (hard bounce, spam complaint) and the deliverability pause on marketing.

import type { Runtime } from "../app";
import { hmacHex } from "./crypto";
import { kvGetJson } from "./kv";
import { signingSecret } from "./secret";

async function key(rt: Runtime, kind: "email" | "phone", value: string): Promise<string> {
  return (await hmacHex(await signingSecret(rt.env), `suppress|${kind}|${value.trim().toLowerCase()}`)).slice(0, 40);
}

export async function suppress(rt: Runtime, kind: "email" | "phone", value: string | null | undefined): Promise<void> {
  if (!value) return;
  await rt.env.DB.prepare("INSERT OR IGNORE INTO suppressions (hash, kind, created_at) VALUES (?,?,?)").bind(await key(rt, kind, value), kind, rt.now()).run();
}

export async function isSuppressed(rt: Runtime, kind: "email" | "phone", value: string | null | undefined): Promise<boolean> {
  if (!value) return false;
  return !!(await rt.env.DB.prepare("SELECT 1 AS x FROM suppressions WHERE hash = ?").bind(await key(rt, kind, value)).first());
}

export type EmailStatus = "bounced" | "complained";

/** Hard bounce or spam complaint recorded for this lead (nothing more is sent to them). */
export async function leadEmailStatus(rt: Runtime, leadId: string): Promise<EmailStatus | null> {
  const r = await rt.env.DB.prepare("SELECT email_status FROM lead_revops WHERE lead_id = ?").bind(leadId).first<{ email_status: string | null }>().catch(() => null);
  return r?.email_status === "bounced" || r?.email_status === "complained" ? r.email_status : null;
}

export async function setLeadEmailStatus(rt: Runtime, leadId: string, status: EmailStatus): Promise<void> {
  await rt.env.DB.prepare(
    `INSERT INTO lead_revops (lead_id, email_status, updated_at) VALUES (?,?,?)
     ON CONFLICT(lead_id) DO UPDATE SET email_status = CASE WHEN lead_revops.email_status = 'complained' THEN 'complained' ELSE excluded.email_status END, updated_at = excluded.updated_at`,
  ).bind(leadId, status, rt.now()).run();
}

/** Marketing sequences that the deliverability guard pauses. Reminders and post-call mail keep going. */
export const PAUSABLE_SEQUENCES = ["abandoned", "tier_a", "tier_b", "tier_c", "nurture", "lost", "cancelled", "behaviour"];

export interface EmailPause { at: number; reason: string }

export async function marketingPause(rt: Runtime): Promise<EmailPause | null> {
  const p = await kvGetJson<EmailPause | null>(rt.env, "email:paused", null);
  return p && typeof p.at === "number" ? p : null;
}
