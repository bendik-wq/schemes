// Erasure on request: removes a lead and everything linked to it. Payments keep their amount and
// date for accounting, without any link to the person.

import type { Runtime } from "../app";
import { getLead } from "../funnel/leads";
import { suppress } from "../lib/suppress";
import { signedHeaders } from "../integrations/webhooks";

export async function eraseLead(rt: Runtime, leadId: string): Promise<{ ok: boolean; ref?: string }> {
  const lead = await getLead(rt, leadId);
  if (!lead) return { ok: false };
  const db = rt.env.DB;
  // Opt-outs outlive erasure, as HMACs only.
  if (lead.unsubscribed_at) await suppress(rt, "email", lead.email);
  if (lead.do_not_call_at) await suppress(rt, "phone", lead.phone);
  const visitors = ((await db.prepare("SELECT id FROM visitors WHERE lead_id = ? OR id = ?").bind(lead.id, lead.visitor_id || "").all<{ id: string }>()).results || []).map((v) => v.id);
  const stmts = [
    db.prepare("DELETE FROM emails WHERE lead_id = ?").bind(lead.id),
    db.prepare("DELETE FROM outbound_calls WHERE lead_id = ?").bind(lead.id),
    db.prepare("DELETE FROM voice_calls WHERE lead_id = ? OR (phone IS NOT NULL AND phone = ?)").bind(lead.id, lead.phone || "-"),
    db.prepare("DELETE FROM whatsapp_messages WHERE lead_id = ? OR (phone IS NOT NULL AND phone = ?)").bind(lead.id, lead.phone || "-"),
    db.prepare("DELETE FROM calendly_bookings WHERE lead_id = ? OR lower(email) = ?").bind(lead.id, lead.email.toLowerCase()),
    db.prepare("DELETE FROM forward_log WHERE lead_id = ?").bind(lead.id),
    db.prepare("DELETE FROM events WHERE lead_id = ?").bind(lead.id),
    db.prepare("DELETE FROM vsl_views WHERE lead_id = ?").bind(lead.id),
    db.prepare("DELETE FROM sessions WHERE lead_id = ?").bind(lead.id),
    db.prepare("UPDATE payments SET lead_id = 'erased', note = NULL, method = NULL WHERE lead_id = ?").bind(lead.id),
    db.prepare("DELETE FROM lead_revops WHERE lead_id = ?").bind(lead.id),
    db.prepare("DELETE FROM touches WHERE lead_id = ?").bind(lead.id),
    db.prepare("DELETE FROM receivables WHERE lead_id = ?").bind(lead.id),
    db.prepare("DELETE FROM leads WHERE id = ?").bind(lead.id),
  ];
  for (const v of visitors) {
    stmts.push(db.prepare("DELETE FROM events WHERE visitor_id = ?").bind(v));
    stmts.push(db.prepare("DELETE FROM sessions WHERE visitor_id = ?").bind(v));
    stmts.push(db.prepare("DELETE FROM vsl_views WHERE visitor_id = ?").bind(v));
    stmts.push(db.prepare("DELETE FROM visitors WHERE id = ?").bind(v));
  }
  await db.batch(stmts);
  // Tell the CRM so it can erase its copy too (id and ref only).
  const url = rt.settings.get("LEAD_WEBHOOK_URL");
  if (url && url.startsWith("https://")) {
    const body = JSON.stringify({ event: "lead_erased", event_id: `erased_${lead.id}`, lead: { id: lead.id, ref: lead.ref_code } });
    const headers = { "content-type": "application/json", ...(await signedHeaders(rt.settings.get("LEAD_WEBHOOK_SECRET"), body, `erased_${lead.id}`, rt.now())) };
    rt.waitUntil(fetch(url, { method: "POST", headers, body }).catch(() => undefined));
  }
  console.log("lead erased", lead.ref_code);
  return { ok: true, ref: lead.ref_code };
}
