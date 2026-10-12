// Suppression list: unsubscribes and do-not-call requests outlive erasure. Only HMACs are stored.

import type { Runtime } from "../app";
import { hmacHex } from "./crypto";
import { signingSecret } from "./secret";

async function key(rt: Runtime, kind: "email" | "phone", value: string): Promise<string> {
  return (await hmacHex(await signingSecret(rt.env), `suppress|${kind}|${value.trim().toLowerCase()}`)).slice(0, 40);
}

export async function suppress(rt: Runtime, kind: "email" | "phone", value: string | null | undefined): Promise<void> {
  if (!value) return;
  await rt.env.DB.prepare("INSERT OR IGNORE INTO suppressions (hash, kind, created_at) VALUES (?,?,?)").bind(await key(rt, kind, value), kind, rt.now()).run();
}

export async function isSuppressed(rt: Runtime, kind: "email" | "phone", value: string | null | undefined): Promise<boolean> {
  if (!value) return false;
  return !!(await rt.env.DB.prepare("SELECT 1 AS x FROM suppressions WHERE hash = ?").bind(await key(rt, kind, value)).first());
}
