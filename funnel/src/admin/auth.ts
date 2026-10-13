// Admin auth: password login with per-IP lockout (the owner's break-glass account), magic-link login
// for users in the `users` table, HMAC-signed session cookies, roles, same-origin check on every
// non-GET, no-store on every admin response.
// Session payloads (signed with HMAC, compatible with the round-1 format):
//   admin.<exp>.<keyed fingerprint of the password>.<epoch>   password login → owner (break-glass)
//   user.<exp>.<user id>.<epoch>                              magic link → the user's role, re-read on every request
// Logout everywhere bumps the epoch, which revokes both kinds. Deactivating a user revokes theirs at once.

import type { MiddlewareHandler } from "hono";
import { getCookie, setCookie, deleteCookie } from "hono/cookie";
import type { AppEnv, Ctx } from "../app";
import type { Env } from "../env";
import { hmacHex, safeEqual, sha256Hex, signToken, verifyToken } from "../lib/crypto";
import { kvGet, kvSet, kvIncr } from "../lib/kv";
import { signingSecret } from "../lib/secret";
import { randomToken } from "../lib/ids";

export const ADMIN_COOKIE = "_fa";
const TTL_MS = 3 * 86_400_000;
const LOCK_WINDOW_MS = 15 * 60_000;
const LOCK_MAX = 10;

/** Keyed fingerprint of the password: revokes sessions on change, cannot be brute-forced from a cookie. */
async function fingerprint(env: Env, pw: string) {
  return (await hmacHex(await signingSecret(env), "admin-pw|" + pw)).slice(0, 16);
}

async function epoch(env: Env): Promise<string> {
  return (await kvGet(env, "admin:epoch")) || "0";
}

export async function makeSession(env: Env, now: number): Promise<string> {
  const pw = String(env.ADMIN_PASSWORD || "");
  return signToken(await signingSecret(env), `admin.${now + TTL_MS}.${await fingerprint(env, pw)}.${await epoch(env)}`);
}

export type Role = "owner" | "manager" | "closer" | "setter" | "viewer";
export const ROLES: Role[] = ["owner", "manager", "closer", "setter", "viewer"];

export interface AdminUser {
  /** users.id, or "owner" for the password (break-glass) login. */
  id: string;
  email: string | null;
  name: string;
  role: Role;
  rep_id: string | null;
  breakglass: boolean;
}

export const BREAKGLASS: AdminUser = { id: "owner", email: null, name: "Owner (password)", role: "owner", rep_id: null, breakglass: true };
export const USER_ID = /^u[0-9a-z]{19}$/;

export async function makeUserSession(env: Env, userId: string, now: number): Promise<string> {
  if (!USER_ID.test(userId)) throw new Error("bad user id");
  return signToken(await signingSecret(env), `user.${now + TTL_MS}.${userId}.${await epoch(env)}`);
}

/** The signed-in user for a session cookie, or null. Fails closed on any doubt. */
export async function sessionUser(env: Env, token: string | undefined, now: number): Promise<AdminUser | null> {
  if (!token) return null;
  const payload = await verifyToken(await signingSecret(env), token);
  if (!payload) return null;
  const [kind, exp, fp, ep, extra] = payload.split(".");
  if (extra !== undefined || !(Number(exp) > now)) return null;
  if (ep !== (await epoch(env))) return null; // logged out everywhere → revoked
  if (kind === "admin") {
    const pw = String(env.ADMIN_PASSWORD || "");
    if (!pw || !safeEqual(fp || "", await fingerprint(env, pw))) return null; // password changed → revoked
    return BREAKGLASS;
  }
  if (kind === "user") {
    if (!USER_ID.test(fp || "")) return null;
    const u = await env.DB.prepare("SELECT id, email, name, role, rep_id, active FROM users WHERE id = ?").bind(fp)
      .first<{ id: string; email: string; name: string | null; role: string; rep_id: string | null; active: number }>().catch(() => null);
    if (!u || !u.active || !ROLES.includes(u.role as Role)) return null;
    return { id: u.id, email: u.email, name: u.name || u.email, role: u.role as Role, rep_id: u.rep_id || null, breakglass: false };
  }
  return null;
}

export async function validSession(env: Env, token: string | undefined, now: number): Promise<boolean> {
  return !!(await sessionUser(env, token, now));
}

// The user is kept per request without widening the app's context type.
const REQUEST_USER = new WeakMap<Request, AdminUser>();
export function currentUser(c: Ctx): AdminUser | null {
  return REQUEST_USER.get(c.req.raw) || null;
}
export function setCurrentUser(c: Ctx, u: AdminUser): void {
  REQUEST_USER.set(c.req.raw, u);
}

// ── Role gates ───────────────────────────────────────────────────────────────

const LID = "l[0-9a-z]{19}";
/** Paths (relative to /admin/api) a closer or setter may use. Lead-level scoping happens in the handlers.
 *  Deliberately manager-only: the test-data toggle, confirm-booking, reassign, merge, erase and every setting. */
const REP_ALLOW: Array<[string, RegExp]> = [
  ["GET", /^\/(me|filters|alerts\/open|today|pipeline|sales|leads|receivables|metrics)$/],
  ["GET", new RegExp(`^/leads/${LID}(/preview)?$`)],
  ["PATCH", new RegExp(`^/leads/${LID}$`)],
  ["POST", new RegExp(`^/leads/${LID}/(payments|touches)$`)],
  ["DELETE", new RegExp(`^/leads/${LID}/payments/p[0-9a-z]{19}$`)],
  ["PUT", new RegExp(`^/leads/${LID}/plan$`)],
  ["POST", /^\/(sales\/outcome|pipeline\/move|calls\/held|logout)$/],
  ["POST", /^\/receivables\/rv[0-9a-z]{19}\/paid$/],
];
/** Reads a viewer may not make: settings, people, keys, raw exports and recordings. */
const VIEWER_DENY = /^\/(integrations|users|audit|api-keys|webhooks|exports|voice\/recording|voice\/numbers)(\/|$)|\.csv$/;

/** Pure: may this role make this request? `path` is relative to /admin/api. Unknown roles get nothing. */
export function canAccess(role: string, method: string, path: string): boolean {
  const m = method === "HEAD" ? "GET" : method;
  if (role === "owner" || role === "manager") return true;
  if (role === "viewer") return (m === "GET" && !VIEWER_DENY.test(path)) || (m === "POST" && path === "/logout");
  if (role === "closer" || role === "setter") return REP_ALLOW.some(([mm, re]) => mm === m && re.test(path));
  return false;
}

/** Route guard for handlers that need specific roles. */
export function requireRole(...roles: Role[]): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    const u = currentUser(c);
    if (!u || !roles.includes(u.role)) return c.json({ error: "Your role does not allow this." }, 403);
    await next();
  };
}

/** undefined: sees every lead. A rep id: only leads where they are closer or setter. null: sees nothing. */
export function repScope(u: AdminUser | null): string | null | undefined {
  if (!u) return null;
  if (u.role === "closer" || u.role === "setter") return u.rep_id || null;
  return undefined;
}

export function leadVisible(u: AdminUser | null, lead: { closer_id: string | null; setter_id: string | null }): boolean {
  const scope = repScope(u);
  if (scope === undefined) return true;
  if (!scope) return false;
  return lead.closer_id === scope || lead.setter_id === scope;
}

const GLOBAL_MAX = 100;

function fnv(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
  return h.toString(36);
}

/** IPv6 addresses are keyed by their /64, so rotating within a block does not reset the count. */
export function ipKey(ip: string): string {
  if (!ip.includes(":")) return ip;
  // Expand "::" so every spelling of the same /64 gives the same key.
  const [head, tail = ""] = ip.toLowerCase().split("::");
  const h = head ? head.split(":") : [];
  const t = tail ? tail.split(":") : [];
  const full = ip.includes("::") ? [...h, ...Array(Math.max(0, 8 - h.length - t.length)).fill("0"), ...t] : h;
  return full.slice(0, 4).map((x) => x.replace(/^0+(?=.)/, "")).join(":") + "::/64";
}

function lockKey(ip: string, now: number) {
  // Plain prefix so the key is stable within a call; the IP itself is not readable from storage.
  return `login_fail:${fnv(ipKey(ip))}:${Math.floor(now / LOCK_WINDOW_MS)}`;
}

async function failures(env: Env, key: (t: number) => string, now: number): Promise<number> {
  return Number((await kvGet(env, key(now))) || 0) + Number((await kvGet(env, key(now - LOCK_WINDOW_MS))) || 0);
}

export async function isLockedOut(env: Env, ip: string, now: number): Promise<boolean> {
  return (await failures(env, (t) => lockKey(ip, t), now)) >= LOCK_MAX;
}

function cookieSecure(url: string): boolean {
  const u = new URL(url);
  return !(u.hostname === "localhost" || u.hostname === "127.0.0.1");
}

export async function login(c: Ctx, password: unknown): Promise<{ ok: boolean; status: number; error?: string }> {
  const env = c.env;
  const now = Date.now();
  const ip = c.req.header("cf-connecting-ip") || "unknown";
  const pw = String(env.ADMIN_PASSWORD || "");
  if (!pw) return { ok: false, status: 503, error: "ADMIN_PASSWORD is not set. Run `wrangler secret put ADMIN_PASSWORD`." };
  if (await isLockedOut(env, ip, now)) return { ok: false, status: 429, error: "Too many attempts. Try again in 15 minutes." };
  // Count the attempt BEFORE comparing, so parallel guesses cannot all slip past the check.
  const bucket = Math.floor(now / LOCK_WINDOW_MS);
  const mine = await kvIncr(env, lockKey(ip, now));
  const all = await kvIncr(env, `login_fail:all:${bucket}`);
  const prevMine = Number((await kvGet(env, lockKey(ip, now - LOCK_WINDOW_MS))) || 0);
  if (mine + prevMine > LOCK_MAX) return { ok: false, status: 429, error: "Too many attempts. Try again in 15 minutes." };
  // Many failures from many addresses: alert, but never lock the owner out (put Cloudflare Access on /admin*).
  if (all === GLOBAL_MAX) console.warn("admin login: unusual number of failed attempts across addresses");
  const given = typeof password === "string" ? password : "";
  const ok = given.length > 0 && safeEqual(await sha256Hex("cmp|" + given), await sha256Hex("cmp|" + pw));
  if (!ok) {
    console.warn("admin login failed", ipKey(ip));
    return { ok: false, status: 401, error: "Wrong password." };
  }
  // A successful login does not count against the limits.
  await kvIncr(env, lockKey(ip, now), -1);
  await kvIncr(env, `login_fail:all:${bucket}`, -1);
  setCookie(c, ADMIN_COOKIE, await makeSession(env, now), { path: "/", httpOnly: true, secure: cookieSecure(c.req.url), sameSite: "Strict", maxAge: TTL_MS / 1000 });
  return { ok: true, status: 200 };
}

export async function logoutEverywhere(c: Ctx): Promise<void> {
  await kvSet(c.env, "admin:epoch", String(Date.now()));
  deleteCookie(c, ADMIN_COOKIE, { path: "/" });
}

/** Sign out this browser only. */
export function logoutHere(c: Ctx): void {
  deleteCookie(c, ADMIN_COOKIE, { path: "/" });
}

/** Same-origin check for state-changing requests. SameSite alone does not stop sibling subdomains. */
export function sameOrigin(c: Ctx): boolean {
  const site = c.req.header("sec-fetch-site");
  if (site && site !== "same-origin") return false;
  const origin = c.req.header("origin");
  if (origin) {
    try {
      if (new URL(origin).host !== new URL(c.req.url).host) return false;
    } catch {
      return false;
    }
  } else if (!site) {
    // No browser provenance headers at all: refuse writes.
    return false;
  }
  return true;
}

export const requireAdmin: MiddlewareHandler<AppEnv> = async (c, next) => {
  c.header("cache-control", "no-store");
  const user = await sessionUser(c.env, getCookie(c, ADMIN_COOKIE), Date.now());
  const isApi = c.req.path.startsWith("/admin/api/");
  if (!user) {
    if (isApi) return c.json({ error: "unauthorized" }, 401);
    return c.redirect("/admin/login", 302);
  }
  if (c.req.method !== "GET" && c.req.method !== "HEAD" && !sameOrigin(c)) return c.json({ error: "cross-site request refused" }, 403);
  setCurrentUser(c, user);
  if (isApi && !canAccess(user.role, c.req.method, c.req.path.slice("/admin/api".length))) return c.json({ error: "Your role does not allow this." }, 403);
  // Email previews with a lead's data are for owners, managers and viewers.
  if (!isApi && c.req.path === "/admin/preview" && (user.role === "closer" || user.role === "setter")) return c.text("Not allowed", 403);
  await next();
  c.header("cache-control", "no-store");
};

// ── Magic links ──────────────────────────────────────────────────────────────

const MAGIC_TTL_MS = 15 * 60_000;
const MAGIC_PER_EMAIL = 3;
const MAGIC_PER_IP = 10;

export interface MagicRequest { ok: boolean; status: number; error?: string; url?: string; user?: { id: string; email: string; name: string | null } }

/**
 * Create a signed, single-use, 15-minute sign-in link for an active user. The caller answers the same
 * way whether or not the address has access (no account discovery). Rate-limited per address and per IP.
 */
export async function createMagicLink(env: Env, origin: string, emailRaw: unknown, ip: string, now: number): Promise<MagicRequest> {
  const email = typeof emailRaw === "string" ? emailRaw.trim().toLowerCase().slice(0, 200) : "";
  if (!/^[^\s@<>"]+@[^\s@<>"]+\.[a-z]{2,}$/i.test(email)) return { ok: false, status: 400, error: "Enter your email address." };
  const bucket = Math.floor(now / LOCK_WINDOW_MS);
  const secret = await signingSecret(env);
  const emailKey = (await hmacHex(secret, "magic-email|" + email)).slice(0, 24);
  const perIp = await kvIncr(env, `magic_ip:${fnv(ipKey(ip))}:${bucket}`);
  const perEmail = await kvIncr(env, `magic_em:${emailKey}:${bucket}`);
  if (perIp > MAGIC_PER_IP || perEmail > MAGIC_PER_EMAIL) return { ok: false, status: 429, error: "Too many sign-in links. Try again in 15 minutes." };
  const u = await env.DB.prepare("SELECT id, email, name FROM users WHERE email = ? AND active = 1").bind(email).first<{ id: string; email: string; name: string | null }>().catch(() => null);
  if (!u) return { ok: true, status: 200 };
  const nonce = randomToken(16);
  const token = await signToken(secret, `m.${u.id}.${now + MAGIC_TTL_MS}.${nonce}`);
  await kvSet(env, `magic:${nonce}`, u.id);
  return { ok: true, status: 200, url: `${origin}/admin/login/magic?t=${encodeURIComponent(token)}`, user: u };
}

/** Verify and consume a magic-link token. Returns the user id, or null (expired, reused, forged, inactive). */
export async function consumeMagicLink(env: Env, token: unknown, now: number): Promise<string | null> {
  if (typeof token !== "string" || token.length > 300) return null;
  const payload = await verifyToken(await signingSecret(env), token);
  if (!payload) return null;
  const [kind, uid, exp, nonce, extra] = payload.split(".");
  if (kind !== "m" || extra !== undefined || !USER_ID.test(uid || "") || !/^[0-9a-f]{32}$/.test(nonce || "")) return null;
  if (!(Number(exp) > now)) return null;
  // Single use: the nonce row is deleted by the first request that presents it.
  const row = await env.DB.prepare("DELETE FROM kv_state WHERE key = ? RETURNING value").bind(`magic:${nonce}`).first<{ value: string }>().catch(() => null);
  if (!row || !safeEqual(row.value, uid)) return null;
  const u = await env.DB.prepare("SELECT id FROM users WHERE id = ? AND active = 1").bind(uid).first<{ id: string }>().catch(() => null);
  return u ? u.id : null;
}

export async function startUserSession(c: Ctx, userId: string): Promise<void> {
  const now = Date.now();
  setCookie(c, ADMIN_COOKIE, await makeUserSession(c.env, userId, now), { path: "/", httpOnly: true, secure: cookieSecure(c.req.url), sameSite: "Strict", maxAge: TTL_MS / 1000 });
  await c.env.DB.prepare("UPDATE users SET last_login_at = ? WHERE id = ?").bind(now, userId).run();
}
