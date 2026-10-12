// VSL heartbeats: the player posts every ~10 s with a 100-bucket watched bitmap (25 hex chars).
// The server ORs it in, fires each milestone exactly once, and counts a view only after unmute.

import type { Runtime } from "../app";
import { VIDEOS, type VideoId } from "../config";
import type { Who } from "./track";
import { track } from "./track";

export const BUCKETS = 100;
const HEX_LEN = BUCKETS / 4;

export function normBitmap(hex: unknown): string {
  const s = typeof hex === "string" ? hex.toLowerCase().replace(/[^0-9a-f]/g, "") : "";
  return s.slice(0, HEX_LEN).padEnd(HEX_LEN, "0");
}

export function orBitmaps(a: string, b: string): string {
  const x = normBitmap(a), y = normBitmap(b);
  let out = "";
  for (let i = 0; i < HEX_LEN; i++) out += (parseInt(x[i], 16) | parseInt(y[i], 16)).toString(16);
  return out;
}

export function popcount(hex: string): number {
  let n = 0;
  for (const ch of normBitmap(hex)) {
    let v = parseInt(ch, 16);
    while (v) { n += v & 1; v >>= 1; }
  }
  return n;
}

/** Bucket i (0..99) watched? Bit order: bucket i lives in hex char floor(i/4), bit (3 - i%4). */
export function bucketSet(hex: string, i: number): boolean {
  const v = parseInt(normBitmap(hex)[Math.floor(i / 4)], 16);
  return ((v >> (3 - (i % 4))) & 1) === 1;
}

export interface Heartbeat {
  video: string;
  duration: number;
  position: number;
  bitmap: string;
  played: boolean;
  unmuted: boolean;
  ctaClicked?: boolean;
}

const MILESTONES: Array<[string, number]> = [["vsl_25", 25], ["vsl_50", 50], ["vsl_75", 75], ["vsl_95", 95]];

export async function recordHeartbeat(rt: Runtime, who: Who, hb: Heartbeat): Promise<{ revealed: boolean; watched: number }> {
  if (!(hb.video in VIDEOS) || !who.visitorId) return { revealed: false, watched: 0 };
  const video = hb.video as VideoId;
  const cfg = VIDEOS[video];
  const now = rt.now();
  const duration = Math.max(0, Math.min(Number(hb.duration) || cfg.duration, 4 * 3600));
  const position = Math.max(0, Math.min(Number(hb.position) || 0, duration || 4 * 3600));
  const db = rt.env.DB;

  const row = await db.prepare("SELECT * FROM vsl_views WHERE visitor_id = ? AND video = ?").bind(who.visitorId, video)
    .first<{ buckets: string; milestones: string; played: number; unmuted: number; cta_revealed: number; cta_clicked: number; max_position: number }>();
  const buckets = orBitmaps(row?.buckets || "", hb.bitmap);
  const watched = popcount(buckets);
  const fired = new Set((row?.milestones || "").split(",").filter(Boolean));
  const played = !!(row?.played || hb.played);
  const unmuted = !!(row?.unmuted || hb.unmuted);
  const revealAt = cfg.ctaRevealAt;
  const revealed = !!row?.cta_revealed || (revealAt > 0 && (position >= revealAt || bucketSet(buckets, Math.min(99, Math.floor((revealAt / (duration || cfg.duration)) * 100)))));
  const completed = unmuted && (watched >= 95 || (duration > 0 && position >= duration - 2 && watched >= 60));

  const toFire: Array<{ name: string; props: Record<string, unknown> }> = [];
  const fire = (name: string, props: Record<string, unknown> = {}) => {
    if (fired.has(name)) return;
    fired.add(name);
    toFire.push({ name, props: { video, ...props } });
  };
  if (played) fire("vsl_play");
  if (unmuted) {
    fire("vsl_unmute");
    for (const [name, pct] of MILESTONES) if (watched >= pct) fire(name, { percent: pct });
    if (completed) fire("vsl_complete", { percent: 100 });
  }
  if (revealed && video === "main") fire("vsl_cta_reveal");
  if (hb.ctaClicked) fire("vsl_cta_click");

  await db.prepare(
    `INSERT INTO vsl_views (visitor_id, video, lead_id, first_at, last_at, duration, max_position, watched_seconds, buckets, played, unmuted, completed, cta_revealed, cta_clicked, milestones)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
     ON CONFLICT(visitor_id, video) DO UPDATE SET
       lead_id = COALESCE(vsl_views.lead_id, excluded.lead_id), last_at = excluded.last_at,
       duration = MAX(vsl_views.duration, excluded.duration), max_position = MAX(vsl_views.max_position, excluded.max_position),
       watched_seconds = excluded.watched_seconds, buckets = excluded.buckets, played = excluded.played, unmuted = excluded.unmuted,
       completed = excluded.completed, cta_revealed = excluded.cta_revealed, cta_clicked = MAX(vsl_views.cta_clicked, excluded.cta_clicked),
       milestones = excluded.milestones`,
  ).bind(
    who.visitorId, video, who.leadId ?? null, now, now, duration, position,
    Math.round((watched / BUCKETS) * (duration || cfg.duration)), buckets, played ? 1 : 0, unmuted ? 1 : 0, completed ? 1 : 0,
    revealed ? 1 : 0, hb.ctaClicked ? 1 : 0, [...fired].join(","),
  ).run();

  for (const f of toFire) await track(rt, who, { name: f.name, source: "client", props: f.props });
  return { revealed, watched };
}

/** Has this visitor already reached the pitch on the main VSL (returning visitors see the CTA at once)? */
export async function hasRevealed(rt: Runtime, visitorId: string): Promise<boolean> {
  const r = await rt.env.DB.prepare("SELECT cta_revealed FROM vsl_views WHERE visitor_id = ? AND video = 'main'").bind(visitorId).first<{ cta_revealed: number }>();
  return !!r?.cta_revealed;
}

export async function resumePosition(rt: Runtime, visitorId: string, video: VideoId): Promise<number> {
  const r = await rt.env.DB.prepare("SELECT max_position, completed FROM vsl_views WHERE visitor_id = ? AND video = ?").bind(visitorId, video).first<{ max_position: number; completed: number }>();
  if (!r || r.completed) return 0;
  return Math.max(0, Math.floor(r.max_position) - 3);
}
