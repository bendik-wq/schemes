// WhatsApp: "Message Bendik" buttons open wa.me with a prefilled message carrying the lead's ref.
// Optional Cloud API: resources template for opted-in leads; inbound messages matched by ref or phone.

import type { Runtime } from "../app";
import { BRAND } from "../config";
import { hmacHex, safeEqual } from "../lib/crypto";
import { newId } from "../lib/ids";
import { normalizePhone } from "../lib/phone";
import { clip } from "../lib/text";
import type { Lead } from "../funnel/leads";
import { track } from "../tracking/track";

export function waLink(rt: Runtime, lead: Pick<Lead, "ref_code" | "first_name"> | null, context: string): string | null {
  const num = (rt.settings.get("FOUNDER_WHATSAPP") || "").replace(/\D/g, "");
  if (!num) return null;
  const ctx = context === "booked" ? "I'm booked in for a call" : context === "resources" ? "I'd like to stay in touch" : "I have a question about Asymmetrical";
  const text = `Hi ${BRAND.founder}, ${ctx}.${lead ? ` (ref ${lead.ref_code})` : ""}`;
  return `https://wa.me/${num}?text=${encodeURIComponent(text)}`;
}

export async function verifyWhatsApp(rt: Runtime, header: string | null, raw: string): Promise<boolean> {
  const secret = rt.settings.get("WHATSAPP_APP_SECRET");
  if (!secret || !header?.startsWith("sha256=")) return false;
  return safeEqual(await hmacHex(secret, raw), header.slice(7));
}

export async function handleWhatsAppInbound(rt: Runtime, body: Record<string, any>): Promise<number> {
  let n = 0;
  for (const entry of body.entry || []) {
    for (const change of entry.changes || []) {
      for (const m of change.value?.messages || []) {
        const from = normalizePhone("+" + String(m.from || ""), null);
        const text = clip(m.text?.body, 1000);
        let lead: Lead | null = null;
        const ref = text.match(/\bOP-[A-Z0-9]{6}\b/)?.[0];
        if (ref) lead = await rt.env.DB.prepare("SELECT * FROM leads WHERE ref_code = ?").bind(ref).first<Lead>();
        if (!lead && from) lead = await rt.env.DB.prepare("SELECT * FROM leads WHERE phone = ? ORDER BY updated_at DESC LIMIT 1").bind(from).first<Lead>();
        await rt.env.DB.prepare("INSERT INTO whatsapp_messages (id, lead_id, direction, phone, body, status, provider_id, created_at) VALUES (?,?, 'in', ?, ?, 'received', ?, ?)")
          .bind(newId("w"), lead?.id ?? null, from, text, String(m.id || "").slice(0, 100), rt.now()).run();
        if (lead) {
          await rt.env.DB.prepare("UPDATE leads SET whatsapp_last_in_at = ? WHERE id = ?").bind(rt.now(), lead.id).run();
          await track(rt, { leadId: lead.id }, { name: "whatsapp_in", source: "webhook", localOnly: true });
        }
        n++;
      }
    }
  }
  return n;
}

export async function sendResourcesTemplate(rt: Runtime, lead: Lead): Promise<boolean> {
  const s = rt.settings;
  if (!lead.whatsapp_opt_in || !lead.phone || !s.has("WHATSAPP_TOKEN") || !s.has("WHATSAPP_PHONE_NUMBER_ID") || !s.has("WHATSAPP_RESOURCES_TEMPLATE")) return false;
  const r = await fetch(`https://graph.facebook.com/v21.0/${encodeURIComponent(s.get("WHATSAPP_PHONE_NUMBER_ID"))}/messages`, {
    method: "POST",
    headers: { authorization: `Bearer ${s.get("WHATSAPP_TOKEN")}`, "content-type": "application/json" },
    body: JSON.stringify({ messaging_product: "whatsapp", to: lead.phone.replace("+", ""), type: "template", template: { name: s.get("WHATSAPP_RESOURCES_TEMPLATE"), language: { code: "en" } } }),
  });
  await rt.env.DB.prepare("INSERT INTO whatsapp_messages (id, lead_id, direction, phone, template, status, created_at) VALUES (?,?, 'out', ?, ?, ?, ?)")
    .bind(newId("w"), lead.id, lead.phone, s.get("WHATSAPP_RESOURCES_TEMPLATE"), r.ok ? "sent" : `failed ${r.status}`, rt.now()).run();
  return r.ok;
}
