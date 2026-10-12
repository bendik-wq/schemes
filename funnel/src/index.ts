import { Hono } from "hono";
import type { AppEnv } from "./app";
import { makeRuntime, quiet } from "./app";
import type { Env } from "./env";
import { requireAdmin, login, logoutEverywhere, sameOrigin } from "./admin/auth";
import { adminApi } from "./routes/admin";
import { api } from "./routes/api";
import { links } from "./routes/links";
import { hooks } from "./routes/hooks";
import { landingPage, smartRoute, applyPage, bookPage, breakoutPage, resourcesPage, privacyPage } from "./funnel/pages";
import { getAngle, getIndustry } from "./landers/catalog";
import { processEmailQueue, previewTemplate } from "./integrations/email";
import { getLead } from "./funnel/leads";
import { retryForwards } from "./tracking/forward";
import { pingUpcomingCalls, maybeSendDigest } from "./sales/digest";
import { processCallQueue } from "./integrations/elevenlabs";
import { syncInbound } from "./integrations/elevenlabs-inbound";
import { syncCalendly } from "./integrations/calendly";
import { processTriggers } from "./personalize/triggers";
import { purgeOld } from "./lib/retention";

const app = new Hono<AppEnv>();

const STRICT_CSP =
  "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; font-src 'self'; connect-src 'self'; media-src 'self' https:; frame-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'; object-src 'none'";
const PAGE_CSP =
  "default-src 'self'; script-src 'self' https://connect.facebook.net https://challenges.cloudflare.com; style-src 'self' 'unsafe-inline'; font-src 'self'; img-src 'self' data: https:; media-src 'self' https: blob:; connect-src 'self' https://*.facebook.com https://*.facebook.net; frame-src https://calendly.com https://*.calendly.com https://challenges.cloudflare.com; frame-ancestors 'self'; base-uri 'self'; form-action 'self'; object-src 'none'";

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
  h.set("permissions-policy", "camera=(), microphone=(), geolocation=(), payment=()");
  if (new URL(c.req.url).protocol === "https:") h.set("strict-transport-security", "max-age=31536000; includeSubDomains");
  const preview = path === "/admin/preview";
  const strict = !preview && (path === "/admin" || path.startsWith("/admin/") || path.startsWith("/u/"));
  h.set("x-frame-options", strict ? "DENY" : "SAMEORIGIN");
  const type = h.get("content-type") || "";
  if (preview) h.set("content-security-policy", PREVIEW_CSP);
  else if (strict) h.set("content-security-policy", STRICT_CSP);
  else if (type.includes("text/html")) h.set("content-security-policy", PAGE_CSP);
  if (path.startsWith("/admin")) h.set("cache-control", "no-store");
  c.res = res;
});

app.onError((err, c) => {
  console.error("unhandled", err);
  return c.req.path.startsWith("/api/") || c.req.path.startsWith("/admin/api/") || c.req.path.startsWith("/hooks/")
    ? c.json({ error: "server error" }, 500)
    : c.text("Something went wrong. Please try again.", 500);
});

app.get("/health", (c) => c.json({ ok: true, ts: Date.now() }));
app.get("/robots.txt", (c) => c.text("User-agent: *\nDisallow: /\n"));

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

app.route("/api", api);
app.route("/hooks", hooks);
app.route("/", links);

// Admin
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

app.notFound((c) => c.redirect("/", 302));

export default {
  fetch: app.fetch,
  async scheduled(_ctrl: ScheduledController, env: Env, ctx: ExecutionContext) {
    const rt = await makeRuntime(env, ctx);
    await quiet("emails", () => processEmailQueue(rt));
    await quiet("forwards", () => retryForwards(rt));
    await quiet("upcoming", () => pingUpcomingCalls(rt));
    await quiet("digest", () => maybeSendDigest(rt));
    await quiet("calls", () => processCallQueue(rt));
    await quiet("inbound", () => syncInbound(rt));
    await quiet("calendly", () => syncCalendly(rt));
    await quiet("triggers", () => processTriggers(rt));
    await quiet("purge", () => purgeOld(rt));
  },
} satisfies ExportedHandler<Env>;
