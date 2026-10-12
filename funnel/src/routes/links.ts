// Redirects and email endpoints: /l (tracked links), /r (signed email clicks), /o (open pixel),
// /u (one-click unsubscribe), /go/wa, /go/join, /go/reschedule.

import { Hono } from "hono";
import type { AppEnv } from "../app";
import { BRAND } from "../config";
import { linkVisitorToLead, resolveIdentity } from "../lib/identity";
import { escHtml } from "../lib/text";
import { verifyShort } from "../lib/crypto";
import { signingSecret } from "../lib/secret";
import { getLead, updateLead } from "../funnel/leads";
import { buildDestination, getLink } from "../funnel/tracked-links";
import { track, whoFromIdentity } from "../tracking/track";
import { cancelAllEmails, isSafePath, unsubSig } from "../integrations/email";
import { cancelCalls } from "../integrations/elevenlabs";
import { safeExternalUrl } from "../integrations/booking";
import { waLink } from "../integrations/whatsapp";

export const links = new Hono<AppEnv>();

const EMAIL_ID = /^m[0-9a-z]{19}$/;
const LEAD_ID = /^l[0-9a-z]{19}$/;
const GIF = Uint8Array.from(atob("R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7"), (ch) => ch.charCodeAt(0));

links.get("/l/:code", async (c) => {
  const link = await getLink(c.get("rt"), c.req.param("code").toLowerCase());
  if (!link) return c.redirect("/", 302);
  await c.env.DB.prepare("UPDATE tracked_links SET clicks = clicks + 1 WHERE code = ?").bind(link.code).run();
  const dest = buildDestination(link);
  return c.redirect(isSafePath(dest) ? dest : "/", 302);
});

links.get("/r/:id/:sig", async (c) => {
  const rt = c.get("rt");
  const emailId = c.req.param("id");
  const u = c.req.query("u") || "/";
  const path = isSafePath(u) ? u : "/";
  if (!EMAIL_ID.test(emailId) || !(await verifyShort(await signingSecret(rt.env), `r|${emailId}|${u}`, c.req.param("sig")))) return c.redirect(path, 302);
  const row = await rt.env.DB.prepare("SELECT lead_id, clicks FROM emails WHERE id = ?").bind(emailId).first<{ lead_id: string; clicks: number }>();
  if (row) {
    await rt.env.DB.prepare("UPDATE emails SET clicks = clicks + 1, clicked_at = COALESCE(clicked_at, ?), opens = MAX(opens, 1), opened_at = COALESCE(opened_at, ?) WHERE id = ?").bind(rt.now(), rt.now(), emailId).run();
    // Only a signed email link may link this browser to the lead.
    const id = await resolveIdentity(c, { page: false });
    if (id.leadId !== row.lead_id) await linkVisitorToLead(rt, id.visitorId, row.lead_id);
    id.leadId = row.lead_id;
    if (!row.clicks) await track(rt, whoFromIdentity(id, path), { name: "email_clicked", source: "server", props: { email: emailId } });
  }
  return c.redirect(path, 302);
});

links.get("/o/:file", async (c) => {
  const id = c.req.param("file").replace(/\.gif$/, "");
  if (EMAIL_ID.test(id)) {
    const rt = c.get("rt");
    const row = await rt.env.DB.prepare("SELECT lead_id, opens FROM emails WHERE id = ?").bind(id).first<{ lead_id: string; opens: number }>();
    if (row) {
      await rt.env.DB.prepare("UPDATE emails SET opens = opens + 1, opened_at = COALESCE(opened_at, ?) WHERE id = ?").bind(rt.now(), id).run();
      if (!row.opens) rt.waitUntil(track(rt, { leadId: row.lead_id }, { name: "email_opened", source: "server", props: { email: id }, localOnly: true }));
    }
  }
  return new Response(GIF, { headers: { "content-type": "image/gif", "cache-control": "no-store, max-age=0" } });
});

function unsubPage(title: string, body: string, form: string | null): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escHtml(title)}</title>
<link rel="stylesheet" href="/assets/site.css"></head><body class="plain"><main class="plain-card"><p class="brand-mark">${escHtml(BRAND.name)}</p><h1>${escHtml(title)}</h1><p>${body}</p>${form || ""}</main></body></html>`;
}

async function unsubValid(c: { get: (k: "rt") => import("../app").Runtime }, leadId: string, sig: string): Promise<boolean> {
  const rt = c.get("rt");
  if (!LEAD_ID.test(leadId)) return false;
  const secret = await signingSecret(rt.env);
  return verifyShort(secret, `u|${leadId}`, sig);
}

links.get("/u/:lead/:sig", async (c) => {
  const leadId = c.req.param("lead");
  const sig = c.req.param("sig");
  if (!(await unsubValid(c, leadId, sig))) return c.html(unsubPage("Link not valid", "This unsubscribe link is not valid. Reply to any of our emails and we will remove you by hand.", null), 400);
  const lead = await getLead(c.get("rt"), leadId);
  if (lead?.unsubscribed_at) return c.html(unsubPage("You are unsubscribed", "You will not get any more emails from us.", null));
  return c.html(unsubPage("Unsubscribe", "Click below and every email from us stops at once.",
    `<form method="post" action="/u/${escHtml(leadId)}/${escHtml(sig)}"><button class="btn" type="submit">Unsubscribe</button></form>`));
});

// RFC 8058 one-click: mail providers POST here directly, so no same-origin check; the signature is the auth.
links.post("/u/:lead/:sig", async (c) => {
  const rt = c.get("rt");
  const leadId = c.req.param("lead");
  if (!(await unsubValid(c, leadId, c.req.param("sig")))) return c.text("Invalid link", 400);
  const lead = await getLead(rt, leadId);
  if (lead && !lead.unsubscribed_at) {
    await updateLead(rt, lead.id, { unsubscribed_at: rt.now() });
    await cancelAllEmails(rt, lead.id);
    await cancelCalls(rt, lead.id, ["speed_to_lead", "rebook"]);
    await track(rt, { leadId: lead.id }, { name: "unsubscribed", source: "server" });
  }
  return c.html(unsubPage("You are unsubscribed", "You will not get any more emails from us. If that was a mistake, reply to an earlier email.", null));
});

export { unsubSig };

links.get("/go/wa", async (c) => {
  const rt = c.get("rt");
  const id = await resolveIdentity(c, { page: false });
  const lead = await getLead(rt, id.leadId);
  const ctx = ["question", "booked", "resources"].includes(c.req.query("c") || "") ? (c.req.query("c") as string) : "question";
  const href = waLink(rt, lead, ctx);
  if (!href) return c.redirect("/", 302);
  await track(rt, whoFromIdentity(id, "/go/wa"), { name: "whatsapp_click", props: { context: ctx } });
  return c.redirect(href, 302);
});

for (const [path, field] of [["/go/join", "booking_join_url"], ["/go/reschedule", "booking_reschedule_url"]] as const) {
  links.get(path, async (c) => {
    const rt = c.get("rt");
    const id = await resolveIdentity(c, { page: false });
    const lead = await getLead(rt, id.leadId);
    const url = safeExternalUrl(lead?.[field]);
    return c.redirect(url || "/breakout", 302);
  });
}
