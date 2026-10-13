// Redirects and email endpoints: /l (tracked links), /r (signed email clicks), /o (open pixel),
// /u (one-click unsubscribe), /go/wa, /go/join, /go/reschedule, /go/confirm (attendance), /go/requalify (C tier).

import { Hono } from "hono";
import type { AppEnv, Ctx } from "../app";
import { BRAND } from "../config";
import { linkVisitorToLead, resolveIdentity } from "../lib/identity";
import { escHtml } from "../lib/text";
import { signShort, verifyShort } from "../lib/crypto";
import { signingSecret } from "../lib/secret";
import { getLead, updateLead, effectiveTier, type Lead } from "../funnel/leads";
import { sameOrigin } from "../admin/auth";
import { assetVersion, attendanceConfirmed } from "../funnel/pages";
import { RESOURCES_PAGE } from "../config";
import { notifyText } from "../integrations/notify";
import { chatSafe } from "../lib/text";
import { formatCallTime, leadTimezone } from "../integrations/email";
import type { Runtime } from "../app";
import { buildDestination, getLink } from "../funnel/tracked-links";
import { track, whoFromIdentity } from "../tracking/track";
import { cancelAllEmails, isSafePath, unsubSig } from "../integrations/email";
import { cancelCalls } from "../integrations/elevenlabs";
import { safeExternalUrl } from "../integrations/booking";
import { waLink } from "../integrations/whatsapp";
import { suppress } from "../lib/suppress";
import { kvGate } from "../lib/kv";
import { parseAnswers } from "../funnel/leads";
import { inferIndustry } from "../landers/catalog";
import { referralLink, referralReward } from "../growth/referrals";
import { CONSENT_SCOPES, parseScope, saveProof } from "../growth/proof";
import { planForLead, planPage } from "../sales/plan";

/** Signature for a client's proof link: /proof/submit?ref=<lead id>&sig=<this>. */
export async function proofSig(rt: Runtime, leadId: string): Promise<string> {
  return signShort(await signingSecret(rt.env), `p|${leadId}`);
}

export const links = new Hono<AppEnv>();

// site.css is cached for a year by version (public/_headers): plain pages reference the deployed version too.
links.use("*", async (c, next) => { cssVersion = assetVersion(c.env); await next(); });

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

let cssVersion = "";
function unsubPage(title: string, body: string, form: string | null): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex, nofollow"><title>${escHtml(title)}</title>
<link rel="icon" href="/assets/mark.svg" type="image/svg+xml"><link rel="stylesheet" href="/assets/site.css${cssVersion ? `?v=${encodeURIComponent(cssVersion)}` : ""}"></head><body class="plain"><main class="plain-card"><p class="brand-mark">${escHtml(BRAND.name)}</p><h1>${escHtml(title)}</h1><p>${body}</p>${form || ""}</main></body></html>`;
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
    await suppress(rt, "email", lead.email);
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

// ── Attendance: "I'll be there" ──────────────────────────────────────────────
// Email security scanners open links before people do, so a GET only records the confirmation when the browser
// says a person started the navigation (Sec-Fetch-User: ?1); otherwise it shows the same one-tap button (POST).

type ConfirmLead = Lead & { attendance_confirmed_at?: number | null; attendance_call_at?: number | null };

export async function confirmSig(rt: Runtime, leadId: string): Promise<string> {
  return signShort(await signingSecret(rt.env), `c|${leadId}`);
}

function isBooked(lead: Lead | null): lead is Lead {
  return !!lead && lead.status === "booked" && !!lead.call_at && !lead.booking_cancelled_at;
}

function userNavigation(c: { req: { header(k: string): string | undefined } }): boolean {
  return c.req.header("sec-fetch-user") === "?1" && (c.req.header("sec-fetch-dest") || "document") === "document";
}

async function markAttendance(rt: Runtime, lead: Lead): Promise<void> {
  if (attendanceConfirmed(lead as ConfirmLead)) return;
  await rt.env.DB.prepare("UPDATE leads SET attendance_confirmed_at = ?, attendance_call_at = ?, updated_at = ? WHERE id = ?")
    .bind(rt.now(), lead.call_at, rt.now(), lead.id).run();
  await track(rt, { leadId: lead.id }, { name: "attendance_confirmed", source: "server", localOnly: true, props: { call_at: lead.call_at } });
}

async function confirmedPage(rt: Runtime, lead: Lead): Promise<string> {
  const when = lead.call_at ? formatCallTime(lead.call_at, await leadTimezone(rt, lead)) : "";
  const first = lead.first_name ? `, ${escHtml(lead.first_name)}` : "";
  return unsubPage("You're confirmed", `Thank you${first}. We'll see you${when ? ` on ${escHtml(when)}` : ""}. If anything changes, you can <a href="/go/reschedule">reschedule here</a>.</p><p><a class="btn" href="/breakout">Open the pre-call page</a>`, null);
}

function confirmForm(action: string, lead: Lead, when: string): string {
  return unsubPage("Will you be there?", `Tap below so ${escHtml(BRAND.founder)} knows to expect you${when ? ` on ${escHtml(when)}` : ""}.`,
    `<form method="post" action="${escHtml(action)}"><button class="btn" type="submit">I'll be there</button></form><p class="muted"><a href="/go/reschedule">Need another time?</a></p>`);
}

links.get("/go/confirm", async (c) => {
  const rt = c.get("rt");
  const id = await resolveIdentity(c, { page: false });
  const lead = await getLead(rt, id.leadId);
  if (!isBooked(lead)) return c.redirect("/breakout", 302);
  if (attendanceConfirmed(lead as ConfirmLead)) return c.html(await confirmedPage(rt, lead));
  if (userNavigation(c)) { await markAttendance(rt, lead); return c.html(await confirmedPage(rt, lead)); }
  return c.html(confirmForm("/go/confirm", lead, formatCallTime(lead.call_at as number, await leadTimezone(rt, lead))));
});

links.post("/go/confirm", async (c) => {
  if (!sameOrigin(c)) return c.text("Cross-site request refused", 403);
  const rt = c.get("rt");
  const id = await resolveIdentity(c, { page: false });
  const lead = await getLead(rt, id.leadId);
  if (!isBooked(lead)) return c.redirect("/breakout", 303);
  await markAttendance(rt, lead);
  return c.redirect("/breakout", 303);
});

// Signed variant for channels without our cookie (SMS, WhatsApp, a forwarded email): /go/confirm/<lead>/<sig>.
links.get("/go/confirm/:lead/:sig", async (c) => {
  const rt = c.get("rt");
  const leadId = c.req.param("lead");
  if (!LEAD_ID.test(leadId) || !(await verifyShort(await signingSecret(rt.env), `c|${leadId}`, c.req.param("sig")))) return c.redirect("/", 302);
  const lead = await getLead(rt, leadId);
  if (!isBooked(lead)) return c.html(unsubPage("No call booked", "We can't find an upcoming call for this link. The latest email from us has the current details.", null), 404);
  if (attendanceConfirmed(lead as ConfirmLead)) return c.html(await confirmedPage(rt, lead));
  if (userNavigation(c)) { await markAttendance(rt, lead); return c.html(await confirmedPage(rt, lead)); }
  return c.html(confirmForm(`/go/confirm/${leadId}/${c.req.param("sig")}`, lead, formatCallTime(lead.call_at as number, await leadTimezone(rt, lead))));
});

links.post("/go/confirm/:lead/:sig", async (c) => {
  if (!sameOrigin(c)) return c.text("Cross-site request refused", 403);
  const rt = c.get("rt");
  const leadId = c.req.param("lead");
  if (!LEAD_ID.test(leadId) || !(await verifyShort(await signingSecret(rt.env), `c|${leadId}`, c.req.param("sig")))) return c.text("Invalid link", 400);
  const lead = await getLead(rt, leadId);
  if (!isBooked(lead)) return c.redirect("/breakout", 303);
  await markAttendance(rt, lead);
  return c.html(await confirmedPage(rt, lead));
});

// ── Requalify: a C-tier lead whose business has changed reopens the application with every answer kept ──
// Reached through the signed email redirect (/r/…?u=/go/requalify), which ties this browser to the lead.

function canRequalify(lead: Lead | null): lead is Lead {
  return !!lead && !!lead.app_completed_at && effectiveTier(lead) === "C" && !lead.unsubscribed_at
    && !["booked", "showed", "won", "lost", "disqualified"].includes(lead.status);
}

async function reopen(rt: Runtime, lead: Lead): Promise<void> {
  // Clearing the completion lets /apply show the saved answers; submitting re-scores (and re-routes) as usual.
  await rt.env.DB.prepare("UPDATE leads SET app_completed_at = NULL, route = NULL, updated_at = ? WHERE id = ?").bind(rt.now(), lead.id).run();
  await track(rt, { leadId: lead.id }, { name: "requalify_started", source: "server", localOnly: true, props: { from_tier: effectiveTier(lead) } });
}

links.get("/go/requalify", async (c) => {
  const rt = c.get("rt");
  const id = await resolveIdentity(c, { page: false });
  const lead = await getLead(rt, id.leadId);
  if (!canRequalify(lead)) return c.redirect((lead as Lead | null)?.route || "/apply", 302);
  if (userNavigation(c)) { await reopen(rt, lead); return c.redirect("/apply", 302); }
  return c.html(unsubPage("Update your application", "Your earlier answers are kept. Change what is different now and send it again.",
    `<form method="post" action="/go/requalify"><button class="btn" type="submit">Update my answers</button></form>`));
});

// ── Growth: personal referral link and the client proof form ─────────────────

function plainPage(title: string, inner: string, wide = false): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex, nofollow"><title>${escHtml(title)} · ${escHtml(BRAND.name)}</title>
<link rel="icon" href="/assets/mark.svg" type="image/svg+xml"><link rel="stylesheet" href="/assets/site.css${cssVersion ? `?v=${encodeURIComponent(cssVersion)}` : ""}"></head><body class="plain"><main class="plain-card${wide ? " wide-card" : ""}"><p class="brand-mark">${escHtml(BRAND.name)}</p><h1>${escHtml(title)}</h1>${inner}</main></body></html>`;
}

// The lead's own browser only (cookie from a signed email link or the funnel). Never shows anyone else's link.
links.get("/refer", async (c) => {
  const rt = c.get("rt");
  const id = await resolveIdentity(c, { page: false });
  const lead = await getLead(rt, id.leadId);
  if (!lead) return c.redirect("/", 302);
  const url = referralLink(rt, lead.ref_code);
  const reward = referralReward(rt);
  const subject = "Worth a look: owning your growth setup";
  const bodyText = `I thought of you. ${BRAND.name} builds a VSL page, Meta tracking and a sales dashboard with your own team on Claude Code over eight weeks. It is for owners of businesses doing $1M+ a year: ${url}`;
  const mail = `mailto:?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(bodyText)}`;
  return c.html(plainPage("Know a founder it would suit?", `<p>If you know an owner doing $1M+ a year who rents their growth, send them your personal link. The page tells them you sent them, using your first name only, and their application opens straight away.</p>
<label class="sr-only" for="ref-link">Your personal link</label><input class="ref-link" id="ref-link" type="text" readonly value="${escHtml(url)}">
${reward ? `<p class="takeaway">${escHtml(reward)}</p>` : ""}
<p><a class="btn" href="${escHtml(mail)}">Email it to someone</a></p>
<p class="fine">We never share anything about your application or your call with the people you refer.</p>`));
});

async function proofLead(c: Ctx, ref: string | undefined, sig: string | undefined): Promise<Lead | null> {
  const rt = c.get("rt");
  if (ref && sig && LEAD_ID.test(ref) && (await verifyShort(await signingSecret(rt.env), `p|${ref}`, sig))) return getLead(rt, ref);
  const id = await resolveIdentity(c, { page: false });
  return getLead(rt, id.leadId);
}

function proofForm(lead: Lead, ref: string, sig: string, error = "", values: Record<string, string> = {}, scopes: Set<string> = new Set(["site", "name"])): string {
  const v = (k: string, fb = "") => escHtml(values[k] ?? fb);
  const boxes = CONSENT_SCOPES.map((s) => `<label class="check"><input type="checkbox" name="scope" value="${s.id}"${scopes.has(s.id) ? " checked" : ""}> <span>${escHtml(s.label)}</span></label>`).join("");
  return plainPage("A few words about the build?", `<p>If the last eight weeks were useful, a sentence or two in your own words helps other founders decide. Only what you tick below is allowed, and nothing is published until we have checked the wording with you.</p>
${error ? `<p class="notice err" role="alert">${escHtml(error)}</p>` : ""}
<form class="plain-form" method="post" action="/proof/submit">
<input type="hidden" name="ref" value="${escHtml(ref)}"><input type="hidden" name="sig" value="${escHtml(sig)}">
<label>What would you tell a founder in your position? <textarea name="body" required minlength="20" maxlength="600">${v("body")}</textarea></label>
<div class="row2"><label>Name <input type="text" name="name" maxlength="60" autocomplete="name" value="${v("name", lead.first_name || "")}"></label>
<label>Role <input type="text" name="role" maxlength="60" autocomplete="organization-title" value="${v("role")}"></label></div>
<label>Company (optional) <input type="text" name="company" maxlength="80" autocomplete="organization" value="${v("company")}"></label>
<fieldset><legend>You agree that we may:</legend>${boxes}</fieldset>
<p class="fine">You can withdraw this at any time by replying to any of our emails, and we will take it down.</p>
<button class="btn" type="submit">Send</button></form>`, true);
}

links.get("/proof/submit", async (c) => {
  const ref = c.req.query("ref"), sig = c.req.query("sig");
  const lead = await proofLead(c, ref, sig);
  if (!lead || lead.status !== "won") return c.html(plainPage("This link is for clients", "<p>It asks clients for a few words about their build. If you think you should have access, reply to our last email.</p>"), 404);
  return c.html(proofForm(lead, ref && sig ? ref : "", ref && sig ? sig : ""));
});

links.post("/proof/submit", async (c) => {
  if (!sameOrigin(c)) return c.text("Cross-site request refused", 403);
  const rt = c.get("rt");
  const form = await c.req.parseBody({ all: true }).catch(() => ({} as Record<string, unknown>));
  const one = (k: string) => String((Array.isArray(form[k]) ? (form[k] as unknown[])[0] : form[k]) ?? "");
  const ref = one("ref"), sig = one("sig");
  const lead = await proofLead(c, ref || undefined, sig || undefined);
  if (!lead || lead.status !== "won") return c.html(plainPage("This link is for clients", "<p>Reply to our last email and we will sort it out.</p>"), 404);
  const body = one("body").replace(/\r\n/g, "\n").trim();
  const values = { body, name: one("name"), role: one("role"), company: one("company") };
  const scopes = parseScope((Array.isArray(form.scope) ? (form.scope as unknown[]) : [form.scope]).map(String).join(","));
  if (body.length < 20 || body.length > 600) return c.html(proofForm(lead, ref, sig, "Please write between 20 and 600 characters.", values, scopes), 400);
  if (!(await kvGate(rt.env, `proof_submit:${lead.id}`, 10 * 60_000, rt.now()))) return c.html(plainPage("Thank you", "<p>We already have your words from a moment ago. Reply to any of our emails if you want to change them.</p>"));
  const industry = (lead.ft_lander || lead.lander || "").split("/")[0] || inferIndustry(String(parseAnswers(lead).business || ""))?.id || null;
  await saveProof(rt, null, {
    kind: "quote", body, author_name: values.name, author_role: values.role, company: values.company, industry,
    consent_at: scopes.size ? rt.now() : null, consent_scope: [...scopes].join(","), approved: 0, lead_id: lead.id,
  }, "form");
  return c.html(plainPage("Thank you", "<p>Thank you for taking the time. Nothing is published until we have checked the wording with you, and only in the ways you ticked.</p><p><a class=\"btn\" href=\"/\">Done</a></p>"));
});

// ── C tier: "Think we got this wrong? Ask for a review" ──────────────────────
// Signed per lead (the /resources page signs it for the lead's own browser). Like /go/confirm, a GET records the
// request only when a person started the navigation (Sec-Fetch-User: ?1); scanners and prefetchers get a button.

async function reviewLead(c: Ctx): Promise<Lead | null> {
  const rt = c.get("rt");
  const leadId = c.req.param("lead") || "";
  if (!LEAD_ID.test(leadId) || !(await verifyShort(await signingSecret(rt.env), `rv|${leadId}`, c.req.param("sig") || ""))) return null;
  const lead = await getLead(rt, leadId);
  return lead && lead.app_completed_at && effectiveTier(lead) === "C" ? lead : null;
}

/** Records the request once (lead_revops.review_requested_at) and pings the team the first time only. */
export async function requestReview(rt: Runtime, lead: Lead): Promise<boolean> {
  const now = rt.now();
  const r = await rt.env.DB.prepare(
    `INSERT INTO lead_revops (lead_id, review_requested_at, updated_at) VALUES (?,?,?)
     ON CONFLICT(lead_id) DO UPDATE SET review_requested_at = excluded.review_requested_at, updated_at = excluded.updated_at
     WHERE lead_revops.review_requested_at IS NULL`,
  ).bind(lead.id, now, now).run();
  if (!r.meta?.changes) return false;
  await track(rt, { leadId: lead.id }, { name: "review_requested", source: "server", localOnly: true });
  const name = chatSafe([lead.first_name, lead.last_name].filter(Boolean).join(" ") || "Lead", 60);
  rt.waitUntil(notifyText(rt, "Review requested (C tier)", [`${name} · ${chatSafe(lead.ref_code, 20)} thinks the routing got it wrong.`, `${rt.origin}/admin#lead=${encodeURIComponent(lead.id)}`]));
  return true;
}

const reviewDone = () => unsubPage("Thank you", escHtml(RESOURCES_PAGE.reviewDone), null);

links.get("/go/review/:lead/:sig", async (c) => {
  const lead = await reviewLead(c);
  if (!lead) return c.redirect("/resources", 302);
  if (userNavigation(c)) { await requestReview(c.get("rt"), lead); return c.html(reviewDone()); }
  return c.html(unsubPage("Ask for a review", "If your situation is different from what the application suggested, ask and the team will look at it again.",
    `<form method="post" action="/go/review/${escHtml(lead.id)}/${escHtml(c.req.param("sig"))}"><button class="btn" type="submit">Ask for a review</button></form>`));
});

links.post("/go/review/:lead/:sig", async (c) => {
  if (!sameOrigin(c)) return c.text("Cross-site request refused", 403);
  const lead = await reviewLead(c);
  if (!lead) return c.redirect("/resources", 303);
  await requestReview(c.get("rt"), lead);
  return c.html(reviewDone());
});


links.post("/go/requalify", async (c) => {

  if (!sameOrigin(c)) return c.text("Cross-site request refused", 403);
  const rt = c.get("rt");
  const id = await resolveIdentity(c, { page: false });
  const lead = await getLead(rt, id.leadId);
  if (!canRequalify(lead)) return c.redirect((lead as Lead | null)?.route || "/apply", 303);
  await reopen(rt, lead);
  return c.redirect("/apply", 303);
});

// Written call plan (src/sales/plan.ts): the signed page, and the email route that finds it for the lead.
links.get("/plan/for/:lead", (c) => planForLead(c));
links.get("/plan/:token", (c) => planPage(c));
