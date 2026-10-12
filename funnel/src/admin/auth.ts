// Admin auth: password login with per-IP lockout, HMAC-signed session cookie
// `admin.<exp>.<sha256(password)[:16]>.<epoch>`, logout bumps the epoch (revokes every session),
// same-origin check on every non-GET, no-store on every admin response.

import type { MiddlewareHandler } from "hono";
import { getCookie, setCookie, deleteCookie } from "hono/cookie";
import type { AppEnv, Ctx } from "../app";
import type { Env } from "../env";
import { hmacHex, safeEqual, sha256Hex, signToken, verifyToken } from "../lib/crypto";
import { kvGet, kvSet, kvIncr } from "../lib/kv";
import { signingSecret } from "../lib/secret";

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

export async function validSession(env: Env, token: string | undefined, now: number): Promise<boolean> {
  const pw = String(env.ADMIN_PASSWORD || "");
  if (!token || !pw) return false;
  const payload = await verifyToken(await signingSecret(env), token);
  if (!payload) return false;
  const [kind, exp, fp, ep] = payload.split(".");
  if (kind !== "admin" || !(Number(exp) > now)) return false;
  if (!safeEqual(fp || "", await fingerprint(env, pw))) return false; // password changed → revoked
  if (ep !== (await epoch(env))) return false; // logged out everywhere → revoked
  return true;
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
  const ok = await validSession(c.env, getCookie(c, ADMIN_COOKIE), Date.now());
  const isApi = c.req.path.startsWith("/admin/api/");
  if (!ok) {
    if (isApi) return c.json({ error: "unauthorized" }, 401);
    return c.redirect("/admin/login", 302);
  }
  if (c.req.method !== "GET" && c.req.method !== "HEAD" && !sameOrigin(c)) return c.json({ error: "cross-site request refused" }, 403);
  await next();
  c.header("cache-control", "no-store");
};
