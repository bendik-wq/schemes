// Tracked links for YouTube descriptions, pinned comments, end screens, bios, podcasts.
// /l/:code → same-site destination with the link's UTMs and lk=<code>.

import type { Runtime } from "../app";
import { clip } from "../lib/text";

export interface TrackedLink {
  code: string; label: string; kind: string; video_id: string | null; video_title: string | null; thumbnail: string | null;
  placement: string | null; dest_path: string; utm_source: string | null; utm_medium: string | null; utm_campaign: string | null;
  utm_content: string | null; clicks: number; created_at: number; archived: number;
}

export const LINK_KINDS = ["youtube", "podcast", "social", "newsletter", "partner", "other"] as const;
const CODE_RE = /^[a-z0-9][a-z0-9-]{1,39}$/;
/** Destinations must be same-site paths. "//host" and "/\host" are open redirects. */
export const DEST_RE = /^\/(?![/\\])[A-Za-z0-9\-._~/?=&%]*$/;

export function cleanDest(p: unknown): string | null {
  const s = String(p ?? "/").trim() || "/";
  return DEST_RE.test(s) ? s : null;
}

export function buildDestination(l: TrackedLink): string {
  const [path, q = ""] = l.dest_path.split("?");
  const params = new URLSearchParams(q);
  const set = (k: string, v: string | null) => { if (v && !params.has(k)) params.set(k, v); };
  set("utm_source", l.utm_source || (l.kind === "youtube" ? "youtube" : l.kind));
  set("utm_medium", l.utm_medium || (l.kind === "youtube" ? "video" : "referral"));
  set("utm_campaign", l.utm_campaign);
  set("utm_content", l.utm_content || l.code);
  params.set("lk", l.code);
  const qs = params.toString();
  return path + (qs ? `?${qs}` : "");
}

export interface LinkInput {
  code?: unknown; label?: unknown; kind?: unknown; video_id?: unknown; video_title?: unknown; thumbnail?: unknown; placement?: unknown;
  dest_path?: unknown; utm_source?: unknown; utm_medium?: unknown; utm_campaign?: unknown; utm_content?: unknown;
}

export async function createLink(rt: Runtime, input: LinkInput): Promise<TrackedLink> {
  const code = String(input.code || "").toLowerCase().trim();
  if (!CODE_RE.test(code)) throw new Error("Code: 2–40 lowercase letters, numbers or dashes.");
  const dest = cleanDest(input.dest_path);
  if (!dest) throw new Error("Destination must be a path on this site, like /?v=a or /for/dental.");
  const kind = (LINK_KINDS as readonly string[]).includes(String(input.kind)) ? String(input.kind) : "other";
  const opt = (v: unknown, n: number) => (v ? clip(v, n) : null);
  const thumb = typeof input.thumbnail === "string" && /^https:\/\/[^\s"'<>]+$/.test(input.thumbnail) ? input.thumbnail.slice(0, 300) : null;
  const link: TrackedLink = {
    code, label: clip(input.label || code, 80), kind, video_id: opt(input.video_id, 40), video_title: opt(input.video_title, 120), thumbnail: thumb,
    placement: opt(input.placement, 40), dest_path: dest, utm_source: opt(input.utm_source, 60), utm_medium: opt(input.utm_medium, 60),
    utm_campaign: opt(input.utm_campaign, 100), utm_content: opt(input.utm_content, 100), clicks: 0, created_at: rt.now(), archived: 0,
  };
  await rt.env.DB.prepare(
    `INSERT INTO tracked_links (code, label, kind, video_id, video_title, thumbnail, placement, dest_path, utm_source, utm_medium, utm_campaign, utm_content, clicks, created_at, archived)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,0,?,0)`,
  ).bind(link.code, link.label, link.kind, link.video_id, link.video_title, link.thumbnail, link.placement, link.dest_path,
    link.utm_source, link.utm_medium, link.utm_campaign, link.utm_content, link.created_at).run();
  return link;
}

export async function archiveLink(rt: Runtime, code: string, archived: boolean): Promise<void> {
  await rt.env.DB.prepare("UPDATE tracked_links SET archived = ? WHERE code = ?").bind(archived ? 1 : 0, code).run();
}

export async function getLink(rt: Runtime, code: string): Promise<TrackedLink | null> {
  if (!CODE_RE.test(code)) return null;
  return (await rt.env.DB.prepare("SELECT * FROM tracked_links WHERE code = ? AND archived = 0").bind(code).first<TrackedLink>()) || null;
}

export async function linkStats(rt: Runtime, since: number) {
  const links = (await rt.env.DB.prepare("SELECT * FROM tracked_links ORDER BY archived, created_at DESC").all<TrackedLink>()).results || [];
  const rows = (await rt.env.DB.prepare(
    `SELECT s.landing_query AS q, COUNT(DISTINCT s.visitor_id) AS visitors, COUNT(DISTINCT l.id) AS leads,
       COUNT(DISTINCT CASE WHEN l.booked_at IS NOT NULL THEN l.id END) AS booked,
       COUNT(DISTINCT CASE WHEN l.status = 'won' THEN l.id END) AS won,
       SUM(DISTINCT CASE WHEN l.status = 'won' THEN l.revenue END) AS revenue
     FROM sessions s LEFT JOIN leads l ON l.visitor_id = s.visitor_id
     WHERE s.landing_query LIKE '%lk=%' AND s.started_at >= ? AND s.is_bot = 0 GROUP BY s.landing_query`,
  ).bind(since).all<{ q: string; visitors: number; leads: number; booked: number; won: number; revenue: number | null }>()).results || [];
  return links.map((l) => {
    const mine = rows.filter((r) => new URLSearchParams(r.q.replace(/^\?/, "")).get("lk") === l.code);
    const sum = (k: "visitors" | "leads" | "booked" | "won" | "revenue") => mine.reduce((s, r) => s + (Number(r[k]) || 0), 0);
    return { ...l, url: `/l/${l.code}`, visitors: sum("visitors"), leads: sum("leads"), booked: sum("booked"), won: sum("won"), revenue: sum("revenue") };
  });
}
