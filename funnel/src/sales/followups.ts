// Follow-up queue: leads whose follow_up_at is due or overdue, and won deals whose next instalment
// is due, for the Sales tab and a once-a-day ping to each closer at CLOSER_PING_HOUR (sales tz).

import type { Runtime } from "../app";
import { BRAND } from "../config";
import { kvGate } from "../lib/kv";
import { notifyRep } from "../integrations/notify";
import { localParts, validTimezone, zonedTime } from "../integrations/sequences";
import { listReps, type Rep } from "./reps";

const DAY = 86_400_000;
const CLOSED = ["won", "lost", "disqualified"];

export interface DueRow {
  id: string; ref_code: string; name: string; tier: string | null; status: string; closer_id: string | null; closer: string | null;
  due_at: number; overdue: boolean; revenue: number; cash_collected: number; installments_total: number | null;
}

function tzOf(rt: Runtime): string {
  const tz = rt.settings.get("SALES_TIMEZONE");
  return validTimezone(tz) ? tz : BRAND.salesTimezone;
}

/** End of today in the sales time zone. */
export function endOfLocalDay(now: number, tz: string): number {
  const p = localParts(now, tz);
  return zonedTime(p.y, p.mo, p.d, 0, 0, tz) + DAY;
}

function shape(rows: Array<Record<string, unknown>>, col: string, now: number, reps: Rep[]): DueRow[] {
  return rows.map((r) => {
    const due = Number(r[col]);
    const closerId = (r.closer_id as string) || null;
    return {
      id: String(r.id), ref_code: String(r.ref_code), name: [r.first_name, r.last_name].filter(Boolean).join(" ") || String(r.email),
      tier: (r.tier as string) || null, status: String(r.status), closer_id: closerId, closer: closerId ? reps.find((x) => x.id === closerId)?.name || closerId : null,
      due_at: due, overdue: due < now, revenue: Number(r.revenue) || 0, cash_collected: Number(r.cash_collected) || 0,
      installments_total: r.installments_total == null ? null : Number(r.installments_total),
    };
  });
}

const COLS = "l.id, l.ref_code, l.first_name, l.last_name, l.email, COALESCE(l.tier_override, l.tier) AS tier, l.status, l.closer_id, l.revenue, l.cash_collected, l.installments_total, l.follow_up_at, l.next_payment_at";

/** Follow-ups due by the end of today (local) and anything overdue, oldest first. */
export async function followUpsDue(rt: Runtime, reps?: Rep[]): Promise<DueRow[]> {
  const now = rt.now();
  const rows = ((await rt.env.DB.prepare(
    `SELECT ${COLS} FROM leads l WHERE l.follow_up_at IS NOT NULL AND l.follow_up_at < ? AND l.status NOT IN (${CLOSED.map(() => "?").join(",")})
     ORDER BY l.follow_up_at LIMIT 200`,
  ).bind(endOfLocalDay(now, tzOf(rt)), ...CLOSED).all<Record<string, unknown>>()).results) || [];
  return shape(rows, "follow_up_at", now, reps || (await listReps(rt)));
}

/** Instalments due in the next 7 days or overdue, on won deals that are not fully paid. */
export async function paymentsDue(rt: Runtime, reps?: Rep[]): Promise<DueRow[]> {
  const now = rt.now();
  const rows = ((await rt.env.DB.prepare(
    `SELECT ${COLS} FROM leads l WHERE l.next_payment_at IS NOT NULL AND l.next_payment_at < ? AND l.status = 'won' AND l.refunded_at IS NULL
       AND (l.revenue <= 0 OR l.cash_collected < l.revenue)
     ORDER BY l.next_payment_at LIMIT 200`,
  ).bind(now + 7 * DAY).all<Record<string, unknown>>()).results) || [];
  return shape(rows, "next_payment_at", now, reps || (await listReps(rt)));
}

const short = (r: DueRow) => `${r.name.split(" ")[0]} ${r.name.split(" ")[1]?.[0] ? r.name.split(" ")[1][0] + "." : ""}`.trim();

/** Daily at CLOSER_PING_HOUR (sales tz): each closer gets their follow-ups and instalments due. */
export async function pingClosersFollowUps(rt: Runtime, force = false): Promise<number> {
  const s = rt.settings;
  if (!s.has("SLACK_WEBHOOK_URL") && !s.has("DISCORD_WEBHOOK_URL")) return 0;
  const tz = tzOf(rt);
  const now = rt.now();
  const p = localParts(now, tz);
  if (!force && p.hh !== s.num("CLOSER_PING_HOUR", 9)) return 0;
  if (!force && !(await kvGate(rt.env, `closerping:${p.y}-${p.mo}-${p.d}`, 365 * DAY, now))) return 0;
  const reps = await listReps(rt);
  const [fu, pay] = await Promise.all([followUpsDue(rt, reps), paymentsDue(rt, reps)]);
  const by = new Map<string, { fu: DueRow[]; pay: DueRow[] }>();
  for (const r of fu) { const k = r.closer_id || ""; if (!by.has(k)) by.set(k, { fu: [], pay: [] }); by.get(k)!.fu.push(r); }
  for (const r of pay.filter((x) => x.due_at < endOfLocalDay(now, tz))) { const k = r.closer_id || ""; if (!by.has(k)) by.set(k, { fu: [], pay: [] }); by.get(k)!.pay.push(r); }
  let n = 0;
  for (const [closerId, items] of by) {
    const rep = reps.find((r) => r.id === closerId) || null;
    const lines: string[] = [];
    if (items.fu.length) lines.push(`Follow-ups: ${items.fu.slice(0, 8).map((r) => `${short(r)} (${r.ref_code}${r.overdue ? ", overdue" : ""})`).join(", ")}${items.fu.length > 8 ? ` +${items.fu.length - 8} more` : ""}`);
    if (items.pay.length) lines.push(`Instalments due: ${items.pay.slice(0, 8).map((r) => `${short(r)} (${r.ref_code})`).join(", ")}`);
    if (!lines.length) continue;
    await notifyRep(rt, rep ? rep : closerId ? { name: closerId, slack_user_id: null, discord_user_id: null } : { name: "Unassigned", slack_user_id: null, discord_user_id: null }, "Your follow-ups today", lines);
    n++;
  }
  return n;
}
