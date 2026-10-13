// API keys for the read-only public API (/api/v1). A key looks like fk_<id>_<secret>; only a keyed HMAC of
// the whole key is stored, the key is shown once, lookups go by the public id and the hash is compared in
// constant time. Revoked keys fail at once.

import type { Runtime } from "../app";
import { hmacHex, safeEqual } from "../lib/crypto";
import { randomToken } from "../lib/ids";
import { signingSecret } from "../lib/secret";

export const API_SCOPES = ["leads:read", "deals:read", "payments:read", "calls:read", "metrics:read", "spend:read"] as const;
export type ApiScope = (typeof API_SCOPES)[number];
export interface ApiKeyRow { id: string; name: string; hash: string; scopes: string; created_at: number; created_by: string | null; last_used_at: number | null; revoked_at: number | null }

const KEY_RE = /^fk_([0-9a-f]{12})_([0-9a-f]{48})$/;

export class ApiKeyError extends Error {}

async function keyHash(rt: Runtime, key: string): Promise<string> {
  return hmacHex(await signingSecret(rt.env), "apikey|" + key);
}

/** Pure: a key's public id, or null when it is not a well-formed key. */
export function keyId(key: string): string | null {
  const m = KEY_RE.exec(key);
  return m ? m[1] : null;
}

export async function createKey(rt: Runtime, input: { name?: unknown; scopes?: unknown }, userId: string | null): Promise<{ key: string; row: Omit<ApiKeyRow, "hash"> }> {
  const name = typeof input.name === "string" ? input.name.trim().slice(0, 60) : "";
  if (!name) throw new ApiKeyError("Give the key a name.");
  const scopes = (Array.isArray(input.scopes) ? input.scopes : []).map(String).filter((s) => (API_SCOPES as readonly string[]).includes(s));
  if (!scopes.length) throw new ApiKeyError("Pick at least one scope.");
  const id = randomToken(6);
  const key = `fk_${id}_${randomToken(24)}`;
  const row: ApiKeyRow = { id, name, hash: await keyHash(rt, key), scopes: [...new Set(scopes)].join(","), created_at: rt.now(), created_by: userId, last_used_at: null, revoked_at: null };
  await rt.env.DB.prepare("INSERT INTO api_keys (id, name, hash, scopes, created_at, created_by) VALUES (?,?,?,?,?,?)").bind(row.id, row.name, row.hash, row.scopes, row.created_at, row.created_by).run();
  const { hash: _h, ...pub } = row;
  return { key, row: pub };
}

export async function listKeys(rt: Runtime) {
  const rows = ((await rt.env.DB.prepare("SELECT id, name, scopes, created_at, last_used_at, revoked_at FROM api_keys ORDER BY revoked_at IS NOT NULL, created_at DESC").all<Omit<ApiKeyRow, "hash">>()).results) || [];
  return rows.map((r) => ({ ...r, scopes: r.scopes.split(",").filter(Boolean) }));
}

export async function revokeKey(rt: Runtime, id: string): Promise<boolean> {
  if (!/^[0-9a-f]{12}$/.test(id)) return false;
  return !!(await rt.env.DB.prepare("UPDATE api_keys SET revoked_at = ? WHERE id = ? AND revoked_at IS NULL").bind(rt.now(), id).run()).meta?.changes;
}

/** The key row for an Authorization header, or null. Fails closed on anything unexpected. */
export async function authenticate(rt: Runtime, header: string | undefined): Promise<{ id: string; scopes: string[] } | null> {
  const m = /^Bearer\s+(\S+)$/i.exec(header || "");
  if (!m) return null;
  const key = m[1];
  const id = keyId(key);
  if (!id) return null;
  const row = await rt.env.DB.prepare("SELECT id, hash, scopes, last_used_at, revoked_at FROM api_keys WHERE id = ?").bind(id).first<ApiKeyRow>().catch(() => null);
  const hash = await keyHash(rt, key); // computed either way, so a missing id costs the same
  if (!row || row.revoked_at || !safeEqual(hash, row.hash)) return null;
  const now = rt.now();
  if (!row.last_used_at || now - row.last_used_at > 60_000) await rt.env.DB.prepare("UPDATE api_keys SET last_used_at = ? WHERE id = ?").bind(now, id).run().catch(() => undefined);
  return { id: row.id, scopes: row.scopes.split(",") };
}
