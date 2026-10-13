// Erasure on request: removes a lead and everything linked to it. Payments keep their amount and
// date for accounting, without any link to the person.

import type { Runtime } from "../app";
import { getLead } from "../funnel/leads";
import { suppress } from "../lib/suppress";
import { allowedHosts, listSubs, signedHeaders, validWebhookUrl } from "../integrations/webhooks";

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
    // The audit trail keeps who did what and when, never the person's data: before/after can hold notes,
    // names and amounts typed about this lead (lead rows by id; payment rows name the lead in their JSON).
    db.prepare("UPDATE audit_log SET before = NULL, after = NULL WHERE entity = 'lead' AND entity_id = ?").bind(lead.id),
    db.prepare(
      `UPDATE audit_log SET before = NULL, after = NULL WHERE entity IN ('payment', 'receivable') AND (
         (before IS NOT NULL AND json_valid(before) AND json_extract(before, '$.lead_id') = ?1)
         OR (after IS NOT NULL AND json_valid(after) AND json_extract(after, '$.lead_id') = ?1))`,
    ).bind(lead.id),
    db.prepare("DELETE FROM leads WHERE id = ?").bind(lead.id),
  ];
  for (const v of visitors) {
    stmts.push(db.prepare("DELETE FROM events WHERE visitor_id = ?").bind(v));
    stmts.push(db.prepare("DELETE FROM sessions WHERE visitor_id = ?").bind(v));
    stmts.push(db.prepare("DELETE FROM vsl_views WHERE visitor_id = ?").bind(v));
    stmts.push(db.prepare("DELETE FROM visitors WHERE id = ?").bind(v));
  }
  await db.batch(stmts);
  // Tell the CRM and every active webhook subscription so they can erase their copies too (id and ref only).
  // Erasure goes to every subscription whatever events it picked: it is a legal duty, not a feed.
  const body = JSON.stringify({ event: "lead_erased", event_id: `erased_${lead.id}`, ts: new Date(rt.now()).toISOString(), lead: { id: lead.id, ref: lead.ref_code } });
  const targets: Array<{ url: string; secret: string | undefined }> = [];
  const url = rt.settings.get("LEAD_WEBHOOK_URL");
  if (url && url.startsWith("https://")) targets.push({ url, secret: rt.settings.get("LEAD_WEBHOOK_SECRET") || undefined });
  const hosts = allowedHosts(rt);
  for (const sub of await listSubs(rt)) if (sub.active && validWebhookUrl(sub.url, hosts)) targets.push({ url: sub.url, secret: sub.secret });
  for (const t of targets) {
    const headers = { "content-type": "application/json", ...(await signedHeaders(t.secret, body, `erased_${lead.id}`, rt.now())) };
    rt.waitUntil(fetch(t.url, { method: "POST", headers, body, redirect: "manual" }).catch(() => undefined));
  }
  console.log("lead erased", lead.ref_code);
  return { ok: true, ref: lead.ref_code };
}
