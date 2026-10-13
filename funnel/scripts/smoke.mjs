#!/usr/bin/env node
// Smoke test a running funnel (local or live): pages, cookies, security headers, fail-closed endpoints.
// Usage: BASE=https://apply.example.com node scripts/smoke.mjs
const BASE = process.env.BASE || "http://127.0.0.1:8787";
const UA = { "user-agent": "Mozilla/5.0 (Macintosh) Chrome/129.0 Safari/537.36", "accept-language": "en-GB" };
let failed = 0;
const ok = (cond, msg) => { console.log(`${cond ? "ok  " : "FAIL"} ${msg}`); if (!cond) failed++; };
const get = (p, h = {}) => fetch(BASE + p, { headers: { ...UA, ...h }, redirect: "manual" });

const home = await get("/?utm_source=smoke&utm_medium=test");
const cookies = (home.headers.getSetCookie?.() || []).join("\n");
ok(home.status === 200, "/ renders");
ok(/_fv=[^;]+;[^\n]*HttpOnly/i.test(cookies), "visitor cookie is set, HttpOnly");
ok(/_fs=/.test(cookies), "session cookie is set");
ok(home.headers.get("x-content-type-options") === "nosniff", "nosniff");
ok(/noindex/.test(home.headers.get("x-robots-tag") || ""), "noindex");
ok(!!home.headers.get("content-security-policy"), "page CSP");
if (BASE.startsWith("https")) ok(!!home.headers.get("strict-transport-security"), "HSTS");
const html = await home.text();
ok(html.includes('id="op-cfg"') && !html.includes('id="op-cfg" type="application/json">{}<'), "config injected");

for (const p of ["/apply", "/privacy", "/for/dental", "/for/dental/tracking", "/m?ind=law"]) ok((await get(p)).status === 200, `${p} renders`);
ok((await get("/book")).status === 302, "/book redirects without a lead");
// Personal pages: a visitor without an application goes home (email links sign in through /r first).
for (const p of ["/breakout", "/resources"]) { const r = await get(p); ok(r.status === 302 && r.headers.get("location") === "/", `${p} redirects home without a lead`); }
ok((await (await get("/robots.txt")).text()).includes("Disallow: /"), "robots disallows all");
ok((await get("/health")).status === 200, "health");

const admin = await get("/admin");
ok(admin.status === 302, "/admin needs login");
ok(admin.headers.get("x-frame-options") === "DENY", "/admin frame DENY");
ok((await get("/admin/api/overview")).status === 401, "admin API needs login");
const login = await get("/admin/login");
ok(/script-src 'self'/.test(login.headers.get("content-security-policy") || ""), "admin strict CSP");

const post = (p, body, h = {}) => fetch(BASE + p, { method: "POST", headers: { ...UA, "content-type": "application/json", ...h }, body: JSON.stringify(body) });
ok((await post("/api/apply/contact", {}, { "sec-fetch-site": "cross-site" })).status === 403, "public API refuses cross-site");
for (const h of ["/hooks/calendly", "/hooks/booking", "/hooks/elevenlabs", "/hooks/elevenlabs/init", "/hooks/whatsapp", "/hooks/vapi"]) {
  const s = (await post(h, {})).status;
  ok(s === 501 || s === 401, `${h} fails closed (${s})`);
}
ok((await get("/l/%2F%2Fevil.com")).headers.get("location")?.startsWith("/") ?? true, "tracked link stays on site");
ok((await get("/r/mxxxxxxxxxxxxxxxxxxx/bad?u=//evil.com")).headers.get("location") === "/", "bad email redirect goes home");

console.log(failed ? `\n${failed} check(s) failed` : "\nall checks passed");
process.exit(failed ? 1 : 0);
