// Funnel HQ pages that work without a session:
//   POST /admin/login/email            ask for a magic sign-in link (same answer whether or not the address has access)
//   GET  /admin/login/magic?t=…        confirm page (a button, so link scanners cannot use up the link)
//   POST /admin/login/magic            consume the single-use link and start a session
//   GET/POST /admin/o/<lead>/<call>/<exp>/<sig>   one-tap outcome page from the Slack/Discord call ping:
//                                      signed, expires 48 h after the call, only logs that call's outcome.
// All under /admin/*, so they get the strict CSP (no scripts at all on these pages).

import { Hono } from "hono";
import type { AppEnv, Ctx, Runtime } from "../app";
import { LOST_REASONS } from "../config";
import { escHtml } from "../lib/text";
import { consumeMagicLink, createMagicLink, currentUser, logoutEverywhere, logoutHere, requireAdmin, sameOrigin, startUserSession } from "../admin/auth";
import { sendMagicEmail } from "../admin/users";
import { audit } from "../admin/audit";
import type { Lead } from "../funnel/leads";
import { ValidationError, applyLeadUpdate } from "../sales/outcomes";
import { verifyOutcomeLink } from "../sales/outcome-link";
import { salesTz } from "../admin/stats";

export const hqPublic = new Hono<AppEnv>();

/** This request's own origin (the Worker only answers on its configured routes and custom domains). */
export function requestOrigin(c: Ctx): string {
  return new URL(c.req.url).origin;
}

function page(title: string, inner: string, status = 200): Response {
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow"><meta name="color-scheme" content="light dark"><title>${escHtml(title)} · Funnel HQ</title>
<link rel="stylesheet" href="/assets/admin.css"></head><body data-page="login"><main class="login"><div class="login-card">
<span class="brand-mark" aria-hidden="true">A</span>${inner}<p class="login-foot">Asymmetrical AI Solutions · Funnel HQ</p></div></main></body></html>`;
  return new Response(html, { status, headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" } });
}

// The sign-out form: owners and managers sign everyone out (round-1 behaviour), other roles only themselves.
hqPublic.post("/admin/logout", requireAdmin, async (c) => {
  const u = currentUser(c);
  const everywhere = u?.role === "owner" || u?.role === "manager";
  if (everywhere) await logoutEverywhere(c);
  else logoutHere(c);
  if (u) await audit(c.get("rt"), u, c.req.header("cf-connecting-ip"), { action: everywhere ? "logout_everywhere" : "logout", entity: "user", entity_id: u.id });
  return c.redirect("/admin/login", 303);
});

// ── Magic links ──────────────────────────────────────────────────────────────

hqPublic.post("/admin/login/email", async (c) => {
  if (!sameOrigin(c)) return c.text("Cross-site request refused", 403);
  const rt = c.get("rt");
  const form = await c.req.parseBody().catch(() => ({} as Record<string, unknown>));
  const ip = c.req.header("cf-connecting-ip") || "unknown";
  // The link goes back to the host this request reached, never to the DB-editable PUBLIC_URL: a sign-in
  // link on someone else's domain would hand them the session (account takeover).
  const origin = requestOrigin(c);
  const r = await createMagicLink(c.env, origin, form.email, ip, Date.now());
  if (!r.ok) return c.redirect(r.status === 429 ? "/admin/login?e=magic_locked" : "/admin/login?e=magic_bad", 303);
  if (r.url && r.user) {
    await sendMagicEmail({ ...rt, origin }, r.user.email, r.user.name, r.url);
    await audit(rt, r.user.id, ip, { action: "login_link_sent", entity: "user", entity_id: r.user.id });
  }
  return c.redirect("/admin/login?m=sent", 303);
});

hqPublic.get("/admin/login/magic", (c) => {
  const t = c.req.query("t") || "";
  if (!t || t.length > 300) return c.redirect("/admin/login?e=magic_expired", 302);
  return page("Sign in", `<h1 class="login-title">Sign in to Funnel HQ</h1><p class="login-sub">Press the button to finish signing in. The link works once.</p>
<form class="login-form" method="post" action="/admin/login/magic"><input type="hidden" name="t" value="${escHtml(t)}"><button class="btn btn-primary" type="submit">Sign in</button></form>`);
});

hqPublic.post("/admin/login/magic", async (c) => {
  if (!sameOrigin(c)) return c.text("Cross-site request refused", 403);
  const form = await c.req.parseBody().catch(() => ({} as Record<string, unknown>));
  const uid = await consumeMagicLink(c.env, form.t, Date.now());
  if (!uid) return c.redirect("/admin/login?e=magic_expired", 303);
  await startUserSession(c, uid);
  await audit(c.get("rt"), uid, c.req.header("cf-connecting-ip"), { action: "login", entity: "user", entity_id: uid });
  return c.redirect("/admin", 303);
});

// ── One-tap outcome link ─────────────────────────────────────────────────────

const NEXT: Record<string, string[]> = { booked: ["showed", "no_show", "won", "lost"], showed: ["won", "lost"] };
const LABEL: Record<string, string> = { showed: "Showed – follow up", no_show: "No-show", won: "Won", lost: "Lost" };

function callTime(rt: Runtime, ms: number): string {
  return new Intl.DateTimeFormat("en-GB", { timeZone: salesTz(rt), weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date(ms));
}

function outcomeForm(rt: Runtime, lead: Lead, action: string, msg?: string): string {
  const who = escHtml([lead.first_name, lead.last_name ? lead.last_name[0] + "." : ""].filter(Boolean).join(" ") || "Lead");
  const options = NEXT[lead.status] || [];
  const head = `<h1 class="login-title">${who} · ${escHtml(lead.ref_code)}</h1><p class="login-sub">Call ${escHtml(callTime(rt, lead.call_at as number))} · now <strong>${escHtml(lead.status.replace("_", "-"))}</strong></p>`;
  if (!options.length) return head + `<p class="login-sub">${msg ? escHtml(msg) + " " : ""}Nothing more to log from this link. Open Funnel HQ for anything else.</p>`;
  const quick = options.filter((s) => s === "showed" || s === "no_show").map((s) =>
    `<button class="btn${s === "showed" ? " btn-primary" : ""}" type="submit" name="status" value="${s}">${escHtml(LABEL[s])}</button>`).join("");
  const note = !msg ? "" : msg.startsWith("Logged") ? `<p class="login-sub" role="status"><strong>${escHtml(msg)}</strong></p>` : `<div class="login-error" role="alert">${escHtml(msg)}</div>`;
  return head + note +
    `<form class="login-form" method="post" action="${escHtml(action)}">${quick}
<label class="field"><span class="field-label">Deal value (USD), if won</span><input class="input" name="revenue" type="number" min="1" step="1" inputmode="numeric"></label>
<button class="btn btn-primary" type="submit" name="status" value="won">Won</button>
<label class="field"><span class="field-label">Lost reason, if lost</span><select class="select" name="lost_reason"><option value="">Pick a reason</option>${LOST_REASONS.map((r) => `<option value="${escHtml(r)}">${escHtml(r)}</option>`).join("")}</select></label>
<button class="btn" type="submit" name="status" value="lost">Lost</button></form>`;
}

async function outcomeRoute(c: Ctx) {
  const rt = c.get("rt");
  const p = c.req.param() as Record<string, string>;
  const lead = await verifyOutcomeLink(rt, p.lead, p.call, p.exp, p.sig);
  if (!lead) return { rt, lead: null, action: "" };
  return { rt, lead, action: `/admin/o/${p.lead}/${p.call}/${p.exp}/${p.sig}` };
}

hqPublic.get("/admin/o/:lead/:call/:exp/:sig", async (c) => {
  const { rt, lead, action } = await outcomeRoute(c);
  if (!lead) return page("Link expired", `<h1 class="login-title">This link has expired</h1><p class="login-sub">Outcome links work until 48 hours after the call, and stop when the call is moved. Log it in Funnel HQ instead.</p>`, 404);
  return page("Log the outcome", outcomeForm(rt, lead, action));
});

hqPublic.post("/admin/o/:lead/:call/:exp/:sig", async (c) => {
  if (!sameOrigin(c)) return c.text("Cross-site request refused", 403);
  const { rt, lead, action } = await outcomeRoute(c);
  if (!lead) return page("Link expired", `<h1 class="login-title">This link has expired</h1><p class="login-sub">Log the outcome in Funnel HQ instead.</p>`, 404);
  const form = await c.req.parseBody().catch(() => ({} as Record<string, unknown>));
  const status = typeof form.status === "string" ? form.status : "";
  if (!(NEXT[lead.status] || []).includes(status)) return page("Log the outcome", outcomeForm(rt, lead, action, "That outcome cannot be logged from this link."), 400);
  const patch: Record<string, unknown> = { status };
  if (status === "lost") {
    if (!(LOST_REASONS as readonly string[]).includes(String(form.lost_reason || ""))) return page("Log the outcome", outcomeForm(rt, lead, action, "Pick a lost reason first."), 400);
    patch.lost_reason = form.lost_reason;
  }
  if (status === "won" && form.revenue) patch.revenue = Number(form.revenue);
  try {
    const fresh = await applyLeadUpdate(rt, lead, patch, { source: "admin" });
    await audit(rt, `link:${lead.closer_id || "unassigned"}`, c.req.header("cf-connecting-ip"), { action: "outcome_link", entity: "lead", entity_id: lead.id, before: { status: lead.status }, after: patch });
    return page("Logged", outcomeForm(rt, fresh, action, `Logged: ${LABEL[status]}.`));
  } catch (e) {
    if (e instanceof ValidationError) return page("Log the outcome", outcomeForm(rt, lead, action, `Check the ${e.message.replace(/_/g, " ")}.`), 400);
    throw e;
  }
});
