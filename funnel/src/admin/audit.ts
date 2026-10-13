// Audit log: who changed what in Funnel HQ. before/after hold only the fields that changed;
// integration changes record the key name and whether it was set or cleared, never the value.
// The IP is stored as a keyed hash, never in clear.

import type { Runtime } from "../app";
import { hmacHex } from "../lib/crypto";
import { newId } from "../lib/ids";
import { signingSecret } from "../lib/secret";
import { ipKey, type AdminUser } from "./auth";

export interface AuditEntry {
  action: string;
  entity: string;
  entity_id?: string | null;
  before?: unknown;
  after?: unknown;
}

const MAX_JSON = 4000;

function json(v: unknown): string | null {
  if (v === undefined || v === null) return null;
  const s = JSON.stringify(v);
  return s.length > MAX_JSON ? JSON.stringify({ truncated: true, keys: typeof v === "object" ? Object.keys(v as object).slice(0, 40) : [] }) : s;
}

/** Pure: the changed fields between two records, as {before, after} with only those keys. */
export function diff(before: Record<string, unknown> | null, after: Record<string, unknown> | null, keys?: string[]): { before: Record<string, unknown>; after: Record<string, unknown> } {
  const b = before || {}, a = after || {};
  const ks = keys || [...new Set([...Object.keys(b), ...Object.keys(a)])];
  const out = { before: {} as Record<string, unknown>, after: {} as Record<string, unknown> };
  for (const k of ks) {
    if (k === "updated_at") continue;
    const x = b[k] ?? null, y = a[k] ?? null;
    if (JSON.stringify(x) !== JSON.stringify(y)) { out.before[k] = x; out.after[k] = y; }
  }
  return out;
}

export async function ipHash(rt: Runtime, ip: string | null | undefined): Promise<string | null> {
  if (!ip) return null;
  return (await hmacHex(await signingSecret(rt.env), "audit-ip|" + ipKey(ip))).slice(0, 16);
}

export async function audit(rt: Runtime, user: Pick<AdminUser, "id"> | string | null, ip: string | null | undefined, e: AuditEntry): Promise<void> {
  const uid = typeof user === "string" ? user : user?.id || null;
  try {
    await rt.env.DB.prepare("INSERT INTO audit_log (id, ts, user_id, action, entity, entity_id, before, after, ip_hash) VALUES (?,?,?,?,?,?,?,?,?)")
      .bind(newId("au"), rt.now(), uid, e.action.slice(0, 60), e.entity.slice(0, 40), e.entity_id ? String(e.entity_id).slice(0, 80) : null, json(e.before), json(e.after), await ipHash(rt, ip))
      .run();
  } catch (err) {
    // Never block the change itself on the log; surface it in the Worker logs.
    console.error("audit write failed", err instanceof Error ? err.message : err);
  }
}

export async function auditReport(rt: Runtime, q: { entity?: string; user?: string; page?: number }) {
  const where: string[] = ["1=1"];
  const binds: unknown[] = [];
  if (q.entity && /^[a-z_]{2,40}$/.test(q.entity)) { where.push("a.entity = ?"); binds.push(q.entity); }
  if (q.user && /^[a-z0-9:_-]{2,60}$/i.test(q.user)) { where.push("a.user_id = ?"); binds.push(q.user); }
  const page = Math.max(1, Math.min(1000, Math.floor(Number(q.page) || 1)));
  const per = 100;
  const rows = ((await rt.env.DB.prepare(
    `SELECT a.id, a.ts, a.user_id, a.action, a.entity, a.entity_id, a.before, a.after, u.name AS user_name, u.email AS user_email
     FROM audit_log a LEFT JOIN users u ON u.id = a.user_id WHERE ${where.join(" AND ")} ORDER BY a.ts DESC LIMIT ? OFFSET ?`,
  ).bind(...binds, per + 1, (page - 1) * per).all<Record<string, unknown>>()).results) || [];
  const parse = (s: unknown) => { try { return s ? JSON.parse(String(s)) : null; } catch { return null; } };
  // Leads that were merged away or erased: link to the survivor, or show no link at all.
  const leadIds = [...new Set(rows.filter((r) => r.entity === "lead" && r.entity_id).map((r) => String(r.entity_id)))].slice(0, 100);
  const alive = new Set<string>(), moved = new Map<string, string>();
  if (leadIds.length) {
    const ph = leadIds.map(() => "?").join(",");
    for (const r of ((await rt.env.DB.prepare(`SELECT id FROM leads WHERE id IN (${ph})`).bind(...leadIds).all<{ id: string }>()).results || [])) alive.add(r.id);
    const red = await rt.env.DB.prepare(`SELECT from_id, to_id FROM lead_redirects WHERE from_id IN (${ph})`).bind(...leadIds).all<{ from_id: string; to_id: string }>().catch(() => ({ results: [] as Array<{ from_id: string; to_id: string }> }));
    for (const r of red.results || []) moved.set(r.from_id, r.to_id);
  }
  return {
    page, more: rows.length > per,
    rows: rows.slice(0, per).map((r) => {
      const eid = (r.entity_id as string) || null;
      const isLead = r.entity === "lead" && !!eid;
      return {
        id: String(r.id), ts: Number(r.ts), user_id: (r.user_id as string) || null,
        who: r.user_name ? String(r.user_name) : r.user_email ? String(r.user_email) : r.user_id === "owner" ? "Owner (password)" : String(r.user_id || "system").startsWith("link:") ? "Signed outcome link" : String(r.user_id || "system"),
        action: String(r.action), entity: String(r.entity), entity_id: eid, before: parse(r.before), after: parse(r.after),
        lead_state: !isLead ? null : alive.has(eid as string) ? "ok" : moved.has(eid as string) ? "merged" : "erased",
        lead_target: isLead ? (alive.has(eid as string) ? eid : moved.get(eid as string) || null) : null,
      };
    }),
  };
}
