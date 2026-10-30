// Password login for the app. A signed cookie `nb_s=<exp>.<hmac>` lasts 12 hours.
// Fails closed: without APP_PASSWORD set, nobody can sign in.

const COOKIE = "nb_s";
const TTL_S = 12 * 3600;

async function hmac(secret: string, msg: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(msg));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export function safeEqual(a: string, b: string): boolean {
  const ea = new TextEncoder().encode(a);
  const eb = new TextEncoder().encode(b);
  let diff = ea.length ^ eb.length;
  const n = Math.max(ea.length, eb.length);
  for (let i = 0; i < n; i++) diff |= (ea[i] ?? 0) ^ (eb[i] ?? 0);
  return diff === 0;
}

function secretOf(env: { SESSION_SECRET?: string; APP_PASSWORD?: string }): string | null {
  if (!env.APP_PASSWORD) return null;
  // Changing the password signs everyone out.
  return (env.SESSION_SECRET || "") + "|" + env.APP_PASSWORD;
}

export async function makeSession(env: { SESSION_SECRET?: string; APP_PASSWORD?: string }, now = Date.now()): Promise<string | null> {
  const secret = secretOf(env);
  if (!secret) return null;
  const exp = Math.floor(now / 1000) + TTL_S;
  return `${exp}.${await hmac(secret, "nb." + exp)}`;
}

export async function checkSession(
  env: { SESSION_SECRET?: string; APP_PASSWORD?: string },
  token: string | undefined,
  now = Date.now(),
): Promise<boolean> {
  const secret = secretOf(env);
  if (!secret || !token) return false;
  const [expRaw, sig] = token.split(".");
  const exp = Number(expRaw);
  if (!Number.isFinite(exp) || !sig || exp < now / 1000) return false;
  return safeEqual(sig, await hmac(secret, "nb." + exp));
}

export function readCookie(req: Request, name = COOKIE): string | undefined {
  const raw = req.headers.get("cookie") || "";
  for (const part of raw.split(/;\s*/)) {
    const i = part.indexOf("=");
    if (i > 0 && part.slice(0, i) === name) return part.slice(i + 1);
  }
  return undefined;
}

export function sessionCookie(token: string, secure: boolean): string {
  return `${COOKIE}=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${TTL_S}${secure ? "; Secure" : ""}`;
}

export const clearCookie = `${COOKIE}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0`;
