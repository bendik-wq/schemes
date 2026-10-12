import type { Runtime } from "../app";
import type { Identity } from "../lib/identity";
import { newId } from "../lib/ids";
import { EVENTS, MICRO_EVENTS } from "./catalog";
import { forwardEvent } from "./forward";

export interface Who {
  visitorId?: string | null;
  sessionId?: string | null;
  leadId?: string | null;
  isBot?: boolean;
  variant?: string | null;
  path?: string | null;
  url?: string | null;
  ip?: string | null;
  ua?: string | null;
  fbp?: string | null;
  fbc?: string | null;
  /** Undefined = work it out from the lead's last session (server/webhook/cron events). */
  adsAllowed?: boolean;
  country?: string | null;
}

export interface TrackInput {
  name: string;
  source?: "server" | "client" | "webhook" | "cron" | "admin";
  props?: Record<string, unknown>;
  /** Store only; never forward (historical imports, previews, tests). */
  localOnly?: boolean;
  value?: number;
  currency?: string;
  eventId?: string;
}

export function whoFromIdentity(id: Identity, path: string, url?: string): Who {
  return {
    visitorId: id.visitorId,
    sessionId: id.sessionId,
    leadId: id.leadId,
    isBot: id.isBot,
    variant: id.variant,
    path,
    url: url || null,
    ip: id.ip,
    ua: id.ua,
    fbp: id.fbp,
    fbc: id.fbc,
    adsAllowed: id.adsAllowed,
    country: id.geo.country,
  };
}

function cleanProps(p: Record<string, unknown> | undefined): string | null {
  if (!p) return null;
  const out: Record<string, unknown> = {};
  let n = 0;
  for (const [k, v] of Object.entries(p)) {
    if (n++ >= 30) break;
    if (v === undefined) continue;
    out[k.slice(0, 40)] = typeof v === "string" ? v.slice(0, 500) : v;
  }
  const s = JSON.stringify(out);
  return s.length > 8000 ? s.slice(0, 8000) : s;
}

/** Write an event to D1 and fan it out to the configured destinations (unless local/micro/bot). */
export async function track(rt: Runtime, who: Who, input: TrackInput): Promise<string> {
  const id = input.eventId || newId("e");
  const ts = rt.now();
  const props = { ...(input.props || {}) };
  if (input.value != null) props.value = input.value;
  await rt.env.DB.prepare(
    "INSERT INTO events (id, ts, name, visitor_id, session_id, lead_id, path, source, variant, is_bot, props) VALUES (?,?,?,?,?,?,?,?,?,?,?)",
  ).bind(
    id, ts, input.name, who.visitorId ?? null, who.sessionId ?? null, who.leadId ?? null, (who.path || "").slice(0, 200) || null,
    input.source || "server", who.variant ?? null, who.isBot ? 1 : 0, cleanProps(props),
  ).run();

  const def = EVENTS[input.name];
  const forward = !input.localOnly && !who.isBot && !!def && !MICRO_EVENTS.has(input.name);
  if (forward) {
    rt.waitUntil(forwardEvent(rt, { id, ts, name: input.name, who, props, value: input.value, currency: input.currency }));
  }
  return id;
}
