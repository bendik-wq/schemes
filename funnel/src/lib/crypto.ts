const enc = new TextEncoder();

function toHex(buf: ArrayBuffer): string {
  const b = new Uint8Array(buf);
  let s = "";
  for (let i = 0; i < b.length; i++) s += b[i].toString(16).padStart(2, "0");
  return s;
}

export async function sha256Hex(input: string): Promise<string> {
  return toHex(await crypto.subtle.digest("SHA-256", enc.encode(input)));
}

const keyCache = new Map<string, Promise<CryptoKey>>();
function hmacKey(secret: string): Promise<CryptoKey> {
  let k = keyCache.get(secret);
  if (!k) {
    k = crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
    if (keyCache.size > 32) keyCache.clear();
    keyCache.set(secret, k);
  }
  return k;
}

export async function hmacHex(secret: string, message: string): Promise<string> {
  const key = await hmacKey(secret);
  return toHex(await crypto.subtle.sign("HMAC", key, enc.encode(message)));
}

export async function hmacBase64(secret: string, message: string): Promise<string> {
  const key = await hmacKey(secret);
  const sig = new Uint8Array(await crypto.subtle.sign("HMAC", key, enc.encode(message)));
  let bin = "";
  for (let i = 0; i < sig.length; i++) bin += String.fromCharCode(sig[i]);
  return btoa(bin);
}

/** Constant-time string comparison. Length differences still take the full loop. */
export function safeEqual(a: string, b: string): boolean {
  if (typeof a !== "string" || typeof b !== "string") return false;
  const len = Math.max(a.length, b.length);
  let diff = a.length ^ b.length;
  for (let i = 0; i < len; i++) diff |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  return diff === 0;
}

/** Short URL-safe signature for links: first 24 hex chars of HMAC. */
export async function signShort(secret: string, message: string): Promise<string> {
  return (await hmacHex(secret, message)).slice(0, 24);
}

export async function verifyShort(secret: string, message: string, sig: string): Promise<boolean> {
  if (!sig || sig.length !== 24) return false;
  return safeEqual(await signShort(secret, message), sig);
}

/** payload.sig where sig = HMAC(payload). Payload must not contain dots beyond its own fields. */
export async function signToken(secret: string, payload: string): Promise<string> {
  return `${payload}.${await hmacHex(secret, payload)}`;
}

export async function verifyToken(secret: string, token: string): Promise<string | null> {
  const i = token.lastIndexOf(".");
  if (i <= 0) return null;
  const payload = token.slice(0, i);
  const sig = token.slice(i + 1);
  return safeEqual(await hmacHex(secret, payload), sig) ? payload : null;
}
