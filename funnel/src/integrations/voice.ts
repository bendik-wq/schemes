// Optional Vapi inbound/web assistant. Only the end-of-call report is stored; nothing is acted on.

import type { Runtime } from "../app";
import { safeEqual } from "../lib/crypto";
import { newId } from "../lib/ids";
import { normalizePhone } from "../lib/phone";
import { clip } from "../lib/text";

export function vapiAuthorized(rt: Runtime, header: string | null): "ok" | "unconfigured" | "denied" {
  const secret = rt.settings.get("VOICE_WEBHOOK_SECRET");
  if (!secret) return "unconfigured";
  return header && safeEqual(header, secret) ? "ok" : "denied";
}

export async function handleVapi(rt: Runtime, body: Record<string, any>): Promise<string> {
  const m = body.message || {};
  if (m.type !== "end-of-call-report") return "ignored";
  const callId = String(m.call?.id || "").slice(0, 100);
  if (!callId) return "ignored";
  const phone = normalizePhone(m.call?.customer?.number, null);
  const lead = phone ? await rt.env.DB.prepare("SELECT id FROM leads WHERE phone = ? ORDER BY updated_at DESC LIMIT 1").bind(phone).first<{ id: string }>() : null;
  await rt.env.DB.prepare(
    `INSERT INTO voice_calls (id, provider, direction, conversation_id, lead_id, phone, status, started_at, duration_s, transcript, summary, recording_url, cost, match_kind, created_at)
     VALUES (?, 'vapi', 'inbound', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(conversation_id) DO NOTHING`,
  ).bind(newId("vc"), "vapi:" + callId, lead?.id ?? null, phone, String(m.endedReason || "ended").slice(0, 60), rt.now(),
    Math.round(Number(m.durationSeconds) || 0), clip(m.transcript, 60_000), clip(m.summary || m.analysis?.summary, 2000) || null,
    typeof m.recordingUrl === "string" && /^https:\/\//.test(m.recordingUrl) ? m.recordingUrl.slice(0, 500) : null,
    Number(m.cost) || null, lead ? "caller_id" : null, rt.now()).run();
  return "stored";
}
