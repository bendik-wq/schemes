import { Hono } from "hono";
import type { AppEnv } from "./app";
import { makeRuntime, quiet } from "./app";
import type { Env } from "./env";
import { requireAdmin, login, logoutEverywhere, sameOrigin } from "./admin/auth";
import { adminApi } from "./routes/admin";
import { adminGrowth } from "./routes/admin-growth";
import { api } from "./routes/api";
import { links } from "./routes/links";
import { hooks } from "./routes/hooks";
import { landingPage, smartRoute, applyPage, bookPage, breakoutPage, resourcesPage, privacyPage } from "./funnel/pages";
import { getAngle, getIndustry } from "./landers/catalog";
import { isDocumentNavigation } from "./lib/identity";
import { waLink } from "./integrations/whatsapp";
import { escHtml } from "./lib/text";
import { BRAND } from "./config";
import { processEmailQueue, previewTemplate } from "./integrations/email";
import { getLead } from "./funnel/leads";
import { retryForwards } from "./tracking/forward";
import { pingUpcomingCalls, maybeSendDigest } from "./sales/digest";
import { processCallQueue } from "./integrations/elevenlabs";
import { syncInbound } from "./integrations/elevenlabs-inbound";
import { syncCalendly } from "./integrations/calendly";
import { processTriggers } from "./personalize/triggers";
import { purgeOld } from "./lib/retention";
import { cronHeartbeat, runAlerts } from "./admin/alerts";
import { hourlyAdTouch, syncMetaSpend } from "./integrations/meta-ads";
import { checkDeliverability } from "./integrations/resend-webhook";
import { scoreUpcomingCalls } from "./sales/noshow";
import { runCalibration } from "./sales/calibration";
import { pingClosersFollowUps } from "./sales/followups";
import { maybeRunAnalyst } from "./sales/analyst";
import { sweepHotPartials } from "./funnel/application";
import { hqPublic } from "./routes/hq-public";
import { v1 } from "./routes/v1";

const app = new Hono<AppEnv>();

const STRICT_CSP =
  "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; font-src 'self'; connect-src 'self'; media-src 'self' https:; frame-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'; object-src 'none'";
// Funnel pages. connect-src carries https://*.cloudflarestream.com only so a Cloudflare Stream HLS film can be
// fetched by the self-hosted hls.js (media-src already allows https: and blob: for the MSE source buffer).
// Meta and Turnstile stay exactly as before; upgrade-insecure-requests and the report endpoint are added per request.
const PAGE_CSP =
  "default-src 'self'; script-src 'self' https://connect.facebook.net https://challenges.cloudflare.com; style-src 'self' 'unsafe-inline'; font-src 'self'; img-src 'self' data: https:; media-src 'self' https: blob:; connect-src 'self' https://*.facebook.com https://*.facebook.net https://*.cloudflarestream.com; frame-src https://calendly.com https://*.calendly.com https://challenges.cloudflare.com; frame-ancestors 'self'; base-uri 'self'; form-action 'self'; object-src 'none'";

// Email previews: framed by Funnel HQ only, sandboxed, no scripts, inline styles allowed.
const PREVIEW_CSP = "sandbox; default-src 'none'; style-src 'unsafe-inline'; img-src https: data:; frame-ancestors 'self'";

// Runtime per request.
app.use("*", async (c, next) => {
  c.set("rt", await makeRuntime(c.env, c.executionCtx, c.req.url));
  await next();
});

// Security headers on every response.
app.use("*", async (c, next) => {
  await next();
  const res = new Response(c.res.body, c.res);
  const h = res.headers;
  const path = c.req.path;
  h.set("x-content-type-options", "nosniff");
  h.set("referrer-policy", "strict-origin-when-cross-origin");
  h.set("x-robots-tag", "noindex, nofollow");
  h.set("permissions-policy", PERMISSIONS_POLICY);
  const https = new URL(c.req.url).protocol === "https:";
  if (https) h.set("strict-transport-security", "max-age=31536000; includeSubDomains");
  const preview = path === "/admin/preview";
  const strict = !preview && (path === "/admin" || path.startsWith("/admin/") || path.startsWith("/u/"));
  h.set("x-frame-options", strict ? "DENY" : "SAMEORIGIN");
  h.set("cross-origin-resource-policy", "same-origin");
  const type = h.get("content-type") || "";
  if (type.includes("text/html")) {
    // Popups (Calendly, WhatsApp, Meta login) keep working; nothing else can script this window.
    h.set("cross-origin-opener-policy", "same-origin-allow-popups");
  }
  if (preview) h.set("content-security-policy", PREVIEW_CSP);
  else if (strict) h.set("content-security-policy", STRICT_CSP + (https ? "; upgrade-insecure-requests" : ""));
  else if (type.includes("text/html")) {
    // upgrade-insecure-requests only over https (on http://localhost it would upgrade our own assets).
    const origin = new URL(c.req.url).origin;
    h.set("reporting-endpoints", `csp="${origin}/api/csp"`);
    h.set("content-security-policy", PAGE_CSP + (https ? "; upgrade-insecure-requests" : "") + "; report-uri /api/csp; report-to csp");
  }
  if (path.startsWith("/admin")) h.set("cache-control", "no-store");
  c.res = res;
});

const PERMISSIONS_POLICY =
  "camera=(), microphone=(), geolocation=(), payment=(), usb=(), serial=(), hid=(), midi=(), magnetometer=(), gyroscope=(), accelerometer=(), display-capture=(), browsing-topics=()";

/** A page route (not an API, webhook or admin JSON endpoint) that a person opened in a browser tab. */
function isApiPath(path: string): boolean {
  return path.startsWith("/api/") || path.startsWith("/admin/api/") || path.startsWith("/hooks/") || path.startsWith("/ph/");
}

app.onError((err, c) => {
  console.error("unhandled", err);
  if (isApiPath(c.req.path)) return c.json({ error: "server error" }, 500);
  let wa: string | null = null, mail = "";
  try {
    const rt = c.get("rt");
    if (rt) {
      wa = waLink(rt, null, "question") ? "/go/wa?c=question" : null;
      const m = rt.settings.get("EMAIL_REPLY_TO") || "";
      mail = /^[^\s@<>"]+@[^\s@<>"]+\.[a-z]{2,}$/i.test(m) ? m : "";
    }
  } catch { /* settings unavailable: plain page */ }
  return c.html(errorPage(wa, mail), 500, { "cache-control": "no-store" });
});

app.get("/health", (c) => c.json({ ok: true, ts: Date.now() }));
// Unfurlers (Slack, LinkedIn, X, Facebook) may read the pages for link previews; everyone else is asked not to.
app.get("/robots.txt", async (c) => {
  const r = await c.env.ASSETS.fetch(new Request(new URL("/robots.txt", c.req.url).toString()));
  return new Response(r.ok ? r.body : "User-agent: *\nDisallow: /\n", { headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "public, max-age=3600" } });
});
// Icon probes: real files, never a redirect or a page view.
for (const [route, file, type] of [
  ["/favicon.ico", "/favicon.ico", "image/x-icon"],
  ["/apple-touch-icon.png", "/apple-touch-icon.png", "image/png"],
  ["/apple-touch-icon-precomposed.png", "/apple-touch-icon.png", "image/png"],
] as const) {
  app.get(route, async (c) => {
    const r = await c.env.ASSETS.fetch(new Request(new URL(file, c.req.url).toString()));
    if (!r.ok) return c.body(null, 404);
    return new Response(r.body, { headers: { "content-type": type, "cache-control": "public, max-age=604800" } });
  });
}

// CSP violation reports (report-uri JSON and Reporting API batches). Logged to Workers observability only:
// the directive, the blocked origin and the page path. No query strings, no IPs, nothing stored. Capped per isolate.
let cspWindow = 0, cspCount = 0;
app.post("/api/csp", async (c) => {
  const now = Date.now();
  if (now - cspWindow > 60_000) { cspWindow = now; cspCount = 0; }
  if (++cspCount > 30) return c.body(null, 204);
  const len = Number(c.req.header("content-length") || 0);
  if (len > 16_384) return c.body(null, 204);
  try {
    const body = (await c.req.json()) as unknown;
    const list = Array.isArray(body) ? body.map((x) => (x as { body?: unknown })?.body) : [(body as { "csp-report"?: unknown })?.["csp-report"]];
    for (const r of list.slice(0, 5)) {
      if (!r || typeof r !== "object") continue;
      const o = r as Record<string, unknown>;
      const origin = (u: unknown) => { const s = String(u || ""); try { return new URL(s).origin; } catch { return s.slice(0, 40); } };
      const page = (u: unknown) => { try { return new URL(String(u || "")).pathname.slice(0, 80); } catch { return ""; } };
      console.warn("csp", JSON.stringify({
        directive: String(o.effectiveDirective || o["effective-directive"] || o["violated-directive"] || "").slice(0, 40),
        blocked: origin(o.blockedURL || o["blocked-uri"]),
        page: page(o.documentURL || o["document-uri"]),
      }));
    }
  } catch { /* malformed report */ }
  return c.body(null, 204);
});

// Funnel pages
app.get("/", (c) => landingPage(c));
app.get("/m", (c) => smartRoute(c));
app.get("/for/:industry", (c) => {
  const ind = getIndustry(c.req.param("industry"));
  return ind ? landingPage(c, { industry: ind }) : c.redirect("/", 302);
});
app.get("/for/:industry/:angle", (c) => {
  const ind = getIndustry(c.req.param("industry"));
  const angle = getAngle(c.req.param("angle"));
  return ind && angle ? landingPage(c, { industry: ind, angle }) : c.redirect(ind ? `/for/${ind.id}` : "/", 302);
});
app.get("/apply", (c) => applyPage(c));
app.get("/book", (c) => bookPage(c));
app.get("/breakout", (c) => breakoutPage(c));
app.get("/resources", (c) => resourcesPage(c));
app.get("/privacy", (c) => privacyPage(c));

app.route("/api/v1", v1);
app.route("/api", api);
app.route("/hooks", hooks);
app.route("/", links);

// Admin: magic-link sign-in, role-aware sign-out and the signed outcome links (mounted first).
app.route("/", hqPublic);
async function asset(c: { env: Env; req: { url: string } }, path: string): Promise<Response> {
  const r = await c.env.ASSETS.fetch(new Request(new URL(path, c.req.url).toString()));
  return new Response(r.body, { status: r.status, headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" } });
}
app.get("/admin/login", (c) => asset(c, "/admin/login.html"));
app.post("/admin/login", async (c) => {
  if (!sameOrigin(c)) return c.text("Cross-site request refused", 403);
  const form = await c.req.parseBody().catch(() => ({} as Record<string, unknown>));
  const r = await login(c, form.password);
  if (r.ok) return c.redirect("/admin", 303);
  return c.redirect(r.status === 429 ? "/admin/login?e=locked" : r.status === 503 ? "/admin/login?e=unset" : "/admin/login?e=1", 303);
});
app.post("/admin/logout", requireAdmin, async (c) => {
  await logoutEverywhere(c);
  return c.redirect("/admin/login", 303);
});
app.use("/admin", requireAdmin);
app.get("/admin", (c) => asset(c, "/admin/index.html"));
app.get("/admin/preview", requireAdmin, async (c) => {
  const rt = c.get("rt");
  const template = c.req.query("template") || "";
  const leadId = c.req.query("lead") || "";
  const lead = /^l[0-9a-z]{19}$/.test(leadId) ? await getLead(rt, leadId) : null;
  try {
    const r = await previewTemplate(rt, lead, template);
    return c.html(r.html);
  } catch {
    return c.text("Unknown template", 404);
  }
});
app.use("/admin/api/*", requireAdmin);
app.route("/admin/api/growth", adminGrowth);
app.route("/admin/api", adminApi);

// First-party PostHog proxy (session replay). Allowlisted paths, methods and host; no cookies.
const PH_PATH = /^\/ph\/(static\/[A-Za-z0-9._/-]+|e\/?|i\/v0\/e\/?|decide\/?|flags\/?|s\/?|batch\/?|capture\/?|engage\/?)$/;
app.all("/ph/*", async (c) => {
  const host = c.get("rt").settings.get("POSTHOG_HOST");
  const m = c.req.path.match(PH_PATH);
  if (!m || !["GET", "POST", "OPTIONS"].includes(c.req.method)) return c.text("not found", 404);
  let upstream: URL;
  try { upstream = new URL(host); } catch { return c.text("not configured", 501); }
  if (!/(^|\.)posthog\.com$/.test(upstream.hostname)) return c.text("not configured", 501);
  const target = m[1].startsWith("static/") ? `https://${upstream.hostname.replace(/^([a-z]+)\.i\./, "$1-assets.i.")}/${m[1]}` : `${upstream.origin}/${m[1]}`;
  const url = new URL(target);
  url.search = new URL(c.req.url).search;
  const headers = new Headers();
  for (const k of ["content-type", "content-encoding", "user-agent", "accept"]) {
    const v = c.req.header(k);
    if (v) headers.set(k, v);
  }
  const r = await fetch(url.toString(), { method: c.req.method, headers, body: c.req.method === "POST" ? await c.req.arrayBuffer() : undefined });
  const out = new Response(r.body, r);
  out.headers.delete("set-cookie");
  return out;
});

// Unknown paths: a person who mistyped a page URL lands on the home page; everything else (icon probes,
// scanners, missing files, API calls, unfurlers asking for /something.png) gets a plain 404 and no page view.
app.notFound((c) => (isDocumentNavigation(c.req.raw) ? c.redirect("/", 302) : c.text("Not found", 404, { "cache-control": "no-store" })));

function errorPage(wa: string | null, mail: string): string {
  const contact = [
    wa ? `<a href="${wa}">message ${escHtml(BRAND.founder)} on WhatsApp</a>` : "",
    mail ? `<a href="mailto:${escHtml(mail)}">email us</a>` : "",
  ].filter(Boolean).join(" or ");
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex, nofollow">
<title>Something went wrong · ${escHtml(BRAND.name)}</title><link rel="icon" href="/assets/mark.svg" type="image/svg+xml"><link rel="stylesheet" href="/assets/site.css"></head>
<body class="plain"><main class="plain-card" role="main"><p class="brand-mark">${escHtml(BRAND.name)}</p><h1>Something went wrong on our side.</h1>
<p>Nothing you did caused it, and anything you already sent us is saved. Please try again in a moment.</p>
<p><a class="btn" href="">Try again</a></p>${contact ? `<p class="muted">If it keeps happening, ${contact}.</p>` : ""}</main></body></html>`;
}

export default {
  fetch: app.fetch,
  async scheduled(_ctrl: ScheduledController, env: Env, ctx: ExecutionContext) {
    const rt = await makeRuntime(env, ctx);
    await quiet("heartbeat", () => cronHeartbeat(rt));
    await quiet("emails", () => processEmailQueue(rt));
    await quiet("forwards", () => retryForwards(rt));
    await quiet("upcoming", () => pingUpcomingCalls(rt));
    await quiet("digest", () => maybeSendDigest(rt));
    await quiet("calls", () => processCallQueue(rt));
    await quiet("inbound", () => syncInbound(rt));
    await quiet("calendly", () => syncCalendly(rt));
    await quiet("triggers", () => processTriggers(rt));
    await quiet("purge", () => purgeOld(rt));
    await quiet("meta_ads", () => syncMetaSpend(rt));
    await quiet("ad_touch", () => hourlyAdTouch(rt));
    await quiet("noshow", () => scoreUpcomingCalls(rt));
    await quiet("deliverability", () => checkDeliverability(rt));
    await quiet("alerts", () => runAlerts(rt));
    await quiet("calibration", () => runCalibration(rt));
    await quiet("closer_pings", () => pingClosersFollowUps(rt));
    await quiet("analyst", () => maybeRunAnalyst(rt));
    await quiet("hot_partial", () => sweepHotPartials(rt));
  },
} satisfies ExportedHandler<Env>;
