import type { Runtime } from "../app";
import { TIER_ROUTES, type Tier } from "../config";
import { kvIncr } from "../lib/kv";
import { repsForTier, type Rep } from "../sales/reps";

/** Expand reps by weight into a deterministic rotation: weights {a:2,b:1} → a,b,a. */
export function rotation(reps: Pick<Rep, "id" | "weight">[]): string[] {
  const out: string[] = [];
  const left = new Map(reps.map((r) => [r.id, Math.max(0, r.weight)]));
  let any = true;
  while (any) {
    any = false;
    for (const r of reps) {
      const n = left.get(r.id) || 0;
      if (n > 0) { out.push(r.id); left.set(r.id, n - 1); any = true; }
    }
  }
  return out;
}

export async function pickCloser(rt: Runtime, tier: Tier): Promise<Rep | null> {
  if (tier === "C") return null;
  const reps = await repsForTier(rt, tier);
  if (!reps.length) return null;
  const rot = rotation(reps);
  if (!rot.length) return null;
  const n = await kvIncr(rt.env, `rr:${tier}`);
  const id = rot[(n - 1) % rot.length];
  return reps.find((r) => r.id === id) || reps[0];
}

export function routeFor(tier: Tier): string {
  return TIER_ROUTES[tier];
}

/** Booking URL for a lead: the rep's own calendar, else the tier default. */
export function bookingUrlFor(rt: Runtime, tier: Tier | null, rep: Rep | null): string {
  if (rep?.calendar_url) return rep.calendar_url;
  if (tier === "A") return rt.settings.get("BOOKING_URL_A") || rt.settings.get("BOOKING_URL_B");
  return rt.settings.get("BOOKING_URL_B") || rt.settings.get("BOOKING_URL_A");
}
