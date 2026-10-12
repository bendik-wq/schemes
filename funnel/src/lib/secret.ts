import type { Env } from "../env";
import { sha256Hex } from "./crypto";
import { randomToken } from "./ids";

let cached: { key: string; value: string } | null = null;

/**
 * The signing secret for links, unsubscribe tokens, admin sessions and IP hashes.
 * SESSION_SECRET when set; otherwise a random secret generated once and kept in kv_state.
 */
export async function signingSecret(env: Env): Promise<string> {
  const fromEnv = typeof env.SESSION_SECRET === "string" ? env.SESSION_SECRET : "";
  if (fromEnv) {
    if (cached?.key !== "env:" + fromEnv) cached = { key: "env:" + fromEnv, value: await sha256Hex("op-signing|" + fromEnv) };
    return cached.value;
  }
  if (cached?.key === "kv") return cached.value;
  const row = await env.DB.prepare("SELECT value FROM kv_state WHERE key = 'secret:signing'").first<{ value: string }>();
  let value = row?.value;
  if (!value) {
    value = randomToken(32);
    await env.DB.prepare(
      "INSERT INTO kv_state (key, value, updated_at) VALUES ('secret:signing', ?, ?) ON CONFLICT(key) DO NOTHING",
    ).bind(value, Date.now()).run();
    const again = await env.DB.prepare("SELECT value FROM kv_state WHERE key = 'secret:signing'").first<{ value: string }>();
    value = again?.value || value;
  }
  cached = { key: "kv", value };
  return value;
}

export function resetSecretCache() {
  cached = null;
}
