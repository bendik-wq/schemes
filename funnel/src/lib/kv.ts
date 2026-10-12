import type { Env } from "../env";

export async function kvGet(env: Env, key: string): Promise<string | null> {
  const r = await env.DB.prepare("SELECT value FROM kv_state WHERE key = ?").bind(key).first<{ value: string }>();
  return r?.value ?? null;
}

export async function kvGetJson<T>(env: Env, key: string, fallback: T): Promise<T> {
  const v = await kvGet(env, key);
  if (!v) return fallback;
  try {
    return JSON.parse(v) as T;
  } catch {
    return fallback;
  }
}

export async function kvSet(env: Env, key: string, value: string): Promise<void> {
  await env.DB.prepare(
    "INSERT INTO kv_state (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at",
  ).bind(key, value, Date.now()).run();
}

export async function kvDelete(env: Env, key: string): Promise<void> {
  await env.DB.prepare("DELETE FROM kv_state WHERE key = ?").bind(key).run();
}

/** Returns true at most once per `everyMs` for a given gate key (cron gating). */
export async function kvGate(env: Env, key: string, everyMs: number, now = Date.now()): Promise<boolean> {
  const r = await env.DB.prepare(
    `INSERT INTO kv_state (key, value, updated_at) VALUES (?, ?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
     WHERE CAST(kv_state.value AS INTEGER) <= ?`,
  ).bind(key, String(now), now, now - everyMs).run();
  return (r.meta?.changes ?? 0) > 0;
}

/** Increment a counter stored in kv_state, returning the new value. */
export async function kvIncr(env: Env, key: string, by = 1): Promise<number> {
  const r = await env.DB.prepare(
    `INSERT INTO kv_state (key, value, updated_at) VALUES (?, ?, ?)
     ON CONFLICT(key) DO UPDATE SET value = CAST(CAST(kv_state.value AS INTEGER) + ? AS TEXT), updated_at = excluded.updated_at
     RETURNING value`,
  ).bind(key, String(by), Date.now(), by).first<{ value: string }>();
  return Number(r?.value || by);
}
