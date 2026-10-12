import type { Context } from "hono";
import type { Env } from "./env";
import { loadSettings, type Settings } from "./settings";
import type { Identity } from "./lib/identity";

export interface Runtime {
  env: Env;
  settings: Settings;
  /** Public origin without trailing slash, used for links in emails and webhooks. */
  origin: string;
  waitUntil(p: Promise<unknown>): void;
  now(): number;
}

export type AppEnv = { Bindings: Env; Variables: { rt: Runtime; id: Identity } };
export type Ctx = Context<AppEnv>;

export async function makeRuntime(
  env: Env,
  ctx: { waitUntil(p: Promise<unknown>): void } | null,
  requestUrl?: string,
): Promise<Runtime> {
  const settings = await loadSettings(env);
  let origin = settings.get("PUBLIC_URL").replace(/\/+$/, "");
  if (!origin && requestUrl) origin = new URL(requestUrl).origin;
  if (!origin) origin = "https://operator.invalid";
  const pending: Promise<unknown>[] = [];
  return {
    env,
    settings,
    origin,
    waitUntil(p) {
      const safe = p.catch((e) => console.error("waitUntil", e));
      if (ctx) ctx.waitUntil(safe);
      else pending.push(safe);
    },
    now: () => Date.now(),
  };
}

/** Run a job and swallow its error, so one failing cron job never stops the others. */
export async function quiet<T>(name: string, fn: () => Promise<T>): Promise<T | undefined> {
  try {
    return await fn();
  } catch (e) {
    console.error(`[${name}]`, e instanceof Error ? e.stack || e.message : e);
    return undefined;
  }
}
