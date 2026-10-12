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
  return { events: e.meta?.changes ?? 0, sessions: s.meta?.changes ?? 0 };
}
