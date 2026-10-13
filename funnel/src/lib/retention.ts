import type { Runtime } from "../app";
import { kvGate } from "./kv";

const DAY = 86_400_000;
export const EVENT_RETENTION_DAYS = 395; // ~13 months

/** Daily: delete raw events older than 13 months; strip IP, UA and precise location from old sessions. */
export async function purgeOld(rt: Runtime, force = false): Promise<{ events: number; sessions: number }> {
  if (!force && !(await kvGate(rt.env, "gate:purge", DAY))) return { events: 0, sessions: 0 };
  const cutoff = rt.now() - EVENT_RETENTION_DAYS * DAY;
  const e = await rt.env.DB.prepare("DELETE FROM events WHERE ts < ?").bind(cutoff).run();
  const s = await rt.env.DB.prepare(
    `UPDATE sessions SET ip = NULL, ip_hash = NULL, user_agent = NULL, lat = NULL, lon = NULL, postal = NULL, city = NULL
     WHERE started_at < ? AND (ip IS NOT NULL OR user_agent IS NOT NULL OR lat IS NOT NULL)`,
  ).bind(cutoff).run();
  await rt.env.DB.prepare("DELETE FROM forward_log WHERE created_at < ?").bind(rt.now() - 90 * DAY).run();
  // Older usage detail: drop query strings, referrers and coarse location as well.
  await rt.env.DB.prepare("UPDATE sessions SET landing_query = NULL, referrer = NULL, region = NULL, tz = NULL WHERE started_at < ? AND (landing_query IS NOT NULL OR referrer IS NOT NULL)").bind(cutoff).run();
  await rt.env.DB.prepare("UPDATE visitors SET city = NULL, region = NULL, ft_referrer = NULL WHERE last_seen_at < ?").bind(cutoff).run();
  // Call transcripts and WhatsApp bodies: 13 months. Whole records of people we never worked with: 6 years.
  await rt.env.DB.prepare("UPDATE voice_calls SET transcript = NULL, recording_url = NULL WHERE created_at < ?").bind(cutoff).run();
  await rt.env.DB.prepare("UPDATE whatsapp_messages SET body = NULL WHERE created_at < ?").bind(cutoff).run();
  // Short-lived counters (rate limits, login failures, gates) older than two days.
  await rt.env.DB.prepare(
    `DELETE FROM kv_state WHERE (key LIKE 'rl:%' OR key LIKE 'login_fail:%' OR key LIKE 'continue%' OR key LIKE 'triggers:%'
       OR key LIKE 'magic_ip:%' OR key LIKE 'magic_em:%' OR key LIKE 'apirl:%' OR key LIKE 'nojs_day:%' OR key LIKE 'nojs_mail:%') AND updated_at < ?`,
  ).bind(rt.now() - 2 * DAY).run();
  // Single-use sign-in nonces live 15 minutes; unused ones go after a day.
  await rt.env.DB.prepare("DELETE FROM kv_state WHERE key LIKE 'magic:%' AND updated_at < ?").bind(rt.now() - DAY).run();
  // MX verdicts are cached a week at most.
  await rt.env.DB.prepare("DELETE FROM kv_state WHERE key LIKE 'mx:%' AND updated_at < ?").bind(rt.now() - 8 * DAY).run();
  // Per-call no-show pings (the call is within 72 h of the ping), unconfirmed no-JS leads.
  await rt.env.DB.prepare("DELETE FROM kv_state WHERE (key LIKE 'noshowping:%' OR key LIKE 'nojs_unverified:%') AND updated_at < ?").bind(rt.now() - 30 * DAY).run();
  // Hot-partial marks: swept within minutes, kept a while so one partial is not pinged twice.
  await rt.env.DB.prepare("DELETE FROM kv_state WHERE key LIKE 'hotpartial:%' AND updated_at < ?").bind(rt.now() - 90 * DAY).run();
  // Audit log: who did what and when stays; the before/after detail (which can hold lead data) goes after 13 months.
  await rt.env.DB.prepare("UPDATE audit_log SET before = NULL, after = NULL WHERE ts < ? AND (before IS NOT NULL OR after IS NOT NULL)").bind(cutoff).run();
  await rt.env.DB.prepare("UPDATE visitors SET ft_landing = NULL, ft_click_id = NULL WHERE last_seen_at < ?").bind(cutoff).run();
  await rt.env.DB.prepare("UPDATE sessions SET click_id = NULL, landing_path = NULL WHERE started_at < ?").bind(cutoff).run();
  const sixYears = rt.now() - 6 * 365 * DAY;
  const old = ((await rt.env.DB.prepare("SELECT id FROM leads WHERE updated_at < ? AND status != 'won' LIMIT 50").bind(sixYears).all<{ id: string }>()).results) || [];
  const { eraseLead } = await import("../sales/erase");
  for (const l of old) await eraseLead(rt, l.id);
  return { events: e.meta?.changes ?? 0, sessions: s.meta?.changes ?? 0 };
}
