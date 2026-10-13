// Speed-to-lead escalation ladder for new A/B leads nobody has touched (no `touches` row, still "applied"):
//   5 min  → ping the assigned rep
//   30 min → ping the managers
//   2 h    → ping with a signed one-tap "Reassign to next rep" link (round-robin over the tier's reps)
// The clock only runs inside sales hours (SALES_HOURS in the sales time zone, default Mon–Fri 09:00–18:00),
// so a lead who applies at 23:00 is "0 minutes old" until the morning. Test leads never escalate.
// The cron runs every 5 minutes (src/index.ts). Each rung fires once per lead (lead_escalations).

import type { Runtime } from "../app";
import { hmacHex, safeEqual } from "../lib/crypto";
import { signingSecret } from "../lib/secret";
import { localParts, zonedTime } from "../integrations/sequences";
import { notifyRep, notifyTeam } from "../integrations/notify";
import { rotation } from "../funnel/routing";
import { getLead, type Lead } from "../funnel/leads";
import { all, salesTz } from "../admin/stats";
import { getRep, repsForTier, type Rep } from "./reps";

const MIN = 60_000;
const DAY = 86_400_000;
export const LADDER = [
  { level: 1, after: 5 * MIN, label: "5 min: rep pinged" },
  { level: 2, after: 30 * MIN, label: "30 min: managers pinged" },
  { level: 3, after: 120 * MIN, label: "2 h: reassign offered" },
] as const;

// ── Sales hours ──────────────────────────────────────────────────────────────

export interface SalesHours { days: Set<number>; start: number; end: number; always: boolean }
const DAY_NAMES = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];

/** Pure: "Mon-Fri 09:00-18:00", "Mon-Sat 08:30-17:00", "09:00-18:00" (Mon–Fri) or "24/7". Minutes from midnight. */
export function parseSalesHours(raw: string | null | undefined): SalesHours {
  const s = String(raw || "").trim().toLowerCase();
  const def: SalesHours = { days: new Set([1, 2, 3, 4, 5]), start: 9 * 60, end: 18 * 60, always: false };
  if (!s) return def;
  if (s === "24/7" || s === "always") return { days: new Set([0, 1, 2, 3, 4, 5, 6]), start: 0, end: 24 * 60, always: true };
  const out: SalesHours = { ...def, days: new Set(def.days) };
  const dm = /\b(sun|mon|tue|wed|thu|fri|sat)[a-z]*\s*(?:-|–|to)\s*(sun|mon|tue|wed|thu|fri|sat)[a-z]*\b/.exec(s);
  if (dm) {
    const a = DAY_NAMES.indexOf(dm[1]), b = DAY_NAMES.indexOf(dm[2]);
    out.days = new Set();
    for (let i = a; ; i = (i + 1) % 7) { out.days.add(i); if (i === b) break; }
  }
  const tm = /(\d{1,2})[:.]?(\d{2})?\s*(?:-|–|to)\s*(\d{1,2})[:.]?(\d{2})?/.exec(s.replace(dm ? dm[0] : "", ""));
  if (tm) {
    const st = Number(tm[1]) * 60 + Number(tm[2] || 0), en = Number(tm[3]) * 60 + Number(tm[4] || 0);
    if (st >= 0 && en <= 24 * 60 && en > st) { out.start = st; out.end = en; }
  }
  return out;
}

/** Pure: milliseconds of sales hours between two instants (the clock pauses outside them). */
export function businessMs(from: number, to: number, tz: string, h: SalesHours): number {
  if (!(to > from)) return 0;
  if (h.always) return to - from;
  let total = 0;
  const p0 = localParts(from, tz);
  let y = p0.y, mo = p0.mo, d = p0.d;
  for (let i = 0; i < 400; i++) {
    const dow = new Date(Date.UTC(y, mo - 1, d)).getUTCDay();
    if (h.days.has(dow)) {
      const ws = zonedTime(y, mo, d, Math.floor(h.start / 60), h.start % 60, tz);
      const we = h.end >= 24 * 60 ? zonedTime(y, mo, d, 0, 0, tz) + DAY : zonedTime(y, mo, d, Math.floor(h.end / 60), h.end % 60, tz);
      total += Math.max(0, Math.min(we, to) - Math.max(ws, from));
    }
    const next = new Date(Date.UTC(y, mo - 1, d + 1));
    y = next.getUTCFullYear(); mo = next.getUTCMonth() + 1; d = next.getUTCDate();
    if (zonedTime(y, mo, d, 0, 0, tz) >= to) break;
  }
  return total;
}

/** Pure: is this instant inside sales hours? */
export function inSalesHours(at: number, tz: string, h: SalesHours): boolean {
  if (h.always) return true;
  const p = localParts(at, tz);
  const m = p.hh * 60 + p.mm;
  return h.days.has(p.dow) && m >= h.start && m < h.end;
}

/** Pure: the ladder level reached after `elapsed` business ms (0 = none). */
export function slaLevel(elapsed: number): number {
  let lvl = 0;
  for (const r of LADDER) if (elapsed >= r.after) lvl = r.level;
  return lvl;
}

export function salesHours(rt: Runtime): SalesHours {
  return parseSalesHours(rt.settings.get("SALES_HOURS"));
}

// ── Reassign link ────────────────────────────────────────────────────────────

const LEAD_ID = /^l[0-9a-z]{19}$/;
export const REASSIGN_TTL = DAY;

async function reassignSig(rt: Runtime, leadId: string, exp: number): Promise<string> {
  return (await hmacHex(await signingSecret(rt.env), `reassign|${leadId}|${exp}`)).slice(0, 32);
}

/** Token for the "Reassign to next rep" link: <lead>.<exp>.<sig>. Opens Funnel HQ at #reassign=<token>. */
export async function reassignToken(rt: Runtime, leadId: string): Promise<string> {
  const exp = rt.now() + REASSIGN_TTL;
  return `${leadId}.${exp}.${await reassignSig(rt, leadId, exp)}`;
}

export async function verifyReassignToken(rt: Runtime, token: string): Promise<string | null> {
  const m = /^(l[0-9a-z]{19})\.(\d{10,14})\.([0-9a-f]{32})$/.exec(String(token || ""));
  if (!m || !LEAD_ID.test(m[1])) return null;
  const exp = Number(m[2]);
  if (!(exp > rt.now()) || exp > rt.now() + REASSIGN_TTL + MIN) return null;
  return safeEqual(await reassignSig(rt, m[1], exp), m[3]) ? m[1] : null;
}

/** The next rep in the tier's weighted rotation after the current one (never the current one). */
export async function nextRep(rt: Runtime, lead: Pick<Lead, "closer_id" | "tier" | "tier_override">): Promise<Rep | null> {
  const tier = (lead.tier_override || lead.tier || "B") as "A" | "B" | "C";
  const reps = (await repsForTier(rt, tier === "C" ? "B" : tier)).filter((r) => r.active);
  const rot = rotation(reps);
  if (!rot.length) return null;
  const cur = lead.closer_id ? rot.indexOf(lead.closer_id) : -1;
  for (let i = 1; i <= rot.length; i++) {
    const id = rot[(cur + i + rot.length) % rot.length];
    if (id !== lead.closer_id) return reps.find((r) => r.id === id) || null;
  }
  return null;
}

// ── The cron ─────────────────────────────────────────────────────────────────

const NT = "l.id NOT IN (SELECT lead_id FROM lead_revops WHERE is_test = 1)";

interface Untouched { id: string; ref_code: string; first_name: string | null; last_name: string | null; tier: string | null; closer_id: string | null; setter_id: string | null; app_completed_at: number; level: number | null }

export async function untouchedLeads(rt: Runtime, sinceMs = 3 * DAY): Promise<Untouched[]> {
  return all<Untouched>(rt,
    `SELECT l.id, l.ref_code, l.first_name, l.last_name, COALESCE(l.tier_override, l.tier) AS tier, l.closer_id, l.setter_id, l.app_completed_at,
       (SELECT MAX(e.level) FROM lead_escalations e WHERE e.lead_id = l.id) AS level
     FROM leads l
     WHERE l.app_completed_at >= ? AND COALESCE(l.tier_override, l.tier) IN ('A','B') AND l.status = 'applied' AND l.booking_source = 'funnel'
       AND NOT EXISTS (SELECT 1 FROM touches t WHERE t.lead_id = l.id) AND ${NT}
     ORDER BY l.app_completed_at LIMIT 200`, [rt.now() - sinceMs]);
}

export async function runEscalations(rt: Runtime): Promise<{ pinged: number }> {
  if (!rt.settings.bool("ESCALATIONS")) return { pinged: 0 };
  const tz = salesTz(rt);
  const hours = salesHours(rt);
  const now = rt.now();
  const rows = await untouchedLeads(rt);
  let pinged = 0;
  for (const r of rows) {
    const reached = slaLevel(businessMs(r.app_completed_at, now, tz, hours));
    const done = Number(r.level) || 0;
    if (reached <= done) continue;
    // Record every rung up to the one reached (claims the rung first, so two crons never ping twice).
    let claimed = false;
    for (let lvl = done + 1; lvl <= reached; lvl++) {
      const res = await rt.env.DB.prepare("INSERT OR IGNORE INTO lead_escalations (lead_id, level, at) VALUES (?,?,?)").bind(r.id, lvl, now).run();
      if (lvl === reached) claimed = (res.meta?.changes ?? 0) > 0;
    }
    if (!claimed) continue;
    await pingLevel(rt, r, reached);
    pinged++;
  }
  return { pinged };
}

async function pingLevel(rt: Runtime, r: Untouched, level: number) {
  const name = [r.first_name, r.last_name].filter(Boolean).join(" ") || "New lead";
  const head = `${name} · ${r.ref_code} · tier ${r.tier || "?"}`;
  const link = `${rt.origin}/admin#lead=${encodeURIComponent(r.id)}`;
  const rep = (await getRep(rt, r.setter_id)) || (await getRep(rt, r.closer_id));
  if (level === 1) {
    await notifyRep(rt, rep, "Untouched for 5 minutes", [head, "Applied and nobody has called yet. Call now while they are still on the page."], link);
  } else if (level === 2) {
    const managers = await all<{ name: string | null; email: string }>(rt, "SELECT name, email FROM users WHERE active = 1 AND role IN ('owner','manager') LIMIT 10");
    await notifyRep(rt, null, "Escalation: untouched for 30 minutes", [head, `Assigned to ${rep?.name || "nobody"}. Managers: ${managers.map((m) => m.name || m.email.split("@")[0]).join(", ") || "owner"}.`], link);
  } else {
    const lead = await getLead(rt, r.id);
    if (!lead) return;
    const next = await nextRep(rt, lead);
    const token = await reassignToken(rt, r.id);
    await notifyTeam(rt, lead.tier_override === "A" || lead.tier === "A" ? "hot_lead" : "qualified", lead,
      `Untouched for 2 hours of sales time${next ? `. Next rep: ${next.name}` : ""}`,
      { label: next ? `Reassign to ${next.name}` : "Reassign", url: `${rt.origin}/admin#reassign=${token}` });
  }
}

/** For Today: business-time waiting and the SLA level of each untouched lead. */
export function slaFor(rt: Runtime, appliedAt: number, now = rt.now()) {
  const tz = salesTz(rt);
  const h = salesHours(rt);
  const ms = businessMs(appliedAt, now, tz, h);
  return { sla_ms: ms, sla_level: slaLevel(ms) };
}

export async function escalationState(rt: Runtime, leadIds: string[]): Promise<Map<string, number>> {
  const ids = leadIds.slice(0, 200);
  if (!ids.length) return new Map();
  const rows = await all<{ lead_id: string; level: number }>(rt,
    `SELECT lead_id, MAX(level) AS level FROM lead_escalations WHERE lead_id IN (${ids.map(() => "?").join(",")}) GROUP BY lead_id`, ids);
  return new Map(rows.map((r) => [r.lead_id, Number(r.level) || 0]));
}

