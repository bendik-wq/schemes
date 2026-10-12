import type { Runtime } from "../app";
import { CLOSERS, type Tier } from "../config";
import { newId } from "../lib/ids";

export interface Rep {
  id: string;
  name: string;
  email: string | null;
  role: "closer" | "setter";
  tiers: string;
  weight: number;
  calendar_url: string | null;
  commission_pct: number;
  monthly_target: number;
  slack_user_id: string | null;
  discord_user_id: string | null;
  active: number;
  created_at: number;
}

export async function listReps(rt: Runtime, activeOnly = false): Promise<Rep[]> {
  const r = await rt.env.DB.prepare(`SELECT * FROM reps ${activeOnly ? "WHERE active = 1" : ""} ORDER BY created_at`).all<Rep>();
  return r.results || [];
}

/** Reps from D1, falling back to CLOSERS in config when the table is empty. */
export async function repsForTier(rt: Runtime, tier: Tier): Promise<Rep[]> {
  const db = await listReps(rt, true);
  const pool: Rep[] = db.length
    ? db
    : CLOSERS.map((c) => ({
        id: c.id, name: c.name, email: null, role: "closer", tiers: c.tiers.join(","), weight: c.weight,
        calendar_url: c.calendar_url || null, commission_pct: 0, monthly_target: 0, slack_user_id: null, discord_user_id: null,
        active: 1, created_at: 0,
      }));
  return pool.filter((r) => r.tiers.split(",").map((t) => t.trim()).includes(tier) && r.weight > 0);
}

export async function getRep(rt: Runtime, id: string | null | undefined): Promise<Rep | null> {
  if (!id) return null;
  const r = await rt.env.DB.prepare("SELECT * FROM reps WHERE id = ?").bind(id).first<Rep>();
  if (r) return r;
  const c = CLOSERS.find((x) => x.id === id);
  return c ? { id: c.id, name: c.name, email: null, role: "closer", tiers: c.tiers.join(","), weight: c.weight, calendar_url: c.calendar_url || null, commission_pct: 0, monthly_target: 0, slack_user_id: null, discord_user_id: null, active: 1, created_at: 0 } : null;
}

export async function getRepByEmail(rt: Runtime, email: string | null | undefined): Promise<Rep | null> {
  if (!email) return null;
  return (await rt.env.DB.prepare("SELECT * FROM reps WHERE lower(email) = ?").bind(email.toLowerCase()).first<Rep>()) || null;
}

export interface RepInput {
  name?: string; email?: string; role?: string; tiers?: string; weight?: number; calendar_url?: string; commission_pct?: number;
  monthly_target?: number; slack_user_id?: string; discord_user_id?: string; active?: boolean | number;
}

function cleanRep(input: RepInput): Partial<Rep> {
  const out: Partial<Rep> = {};
  if (input.name !== undefined) out.name = String(input.name).trim().slice(0, 80);
  if (input.email !== undefined) out.email = String(input.email).trim().toLowerCase().slice(0, 120) || null;
  if (input.role !== undefined) out.role = input.role === "setter" ? "setter" : "closer";
  if (input.tiers !== undefined) out.tiers = String(input.tiers).toUpperCase().split(/[\s,]+/).filter((t) => ["A", "B", "C"].includes(t)).join(",");
  if (input.weight !== undefined) out.weight = Math.max(0, Math.min(100, Math.round(Number(input.weight) || 0)));
  if (input.calendar_url !== undefined) {
    const u = String(input.calendar_url).trim();
    out.calendar_url = /^https:\/\/[^\s"'<>]+$/.test(u) ? u.slice(0, 300) : null;
  }
  if (input.commission_pct !== undefined) out.commission_pct = Math.max(0, Math.min(100, Number(input.commission_pct) || 0));
  if (input.monthly_target !== undefined) out.monthly_target = Math.max(0, Number(input.monthly_target) || 0);
  if (input.slack_user_id !== undefined) out.slack_user_id = String(input.slack_user_id).replace(/[^A-Z0-9]/gi, "").slice(0, 20) || null;
  if (input.discord_user_id !== undefined) out.discord_user_id = String(input.discord_user_id).replace(/\D/g, "").slice(0, 24) || null;
  if (input.active !== undefined) out.active = input.active ? 1 : 0;
  return out;
}

export async function createRep(rt: Runtime, input: RepInput): Promise<Rep> {
  const r = cleanRep(input);
  if (!r.name) throw new Error("name required");
  const rep: Rep = {
    id: newId("r"), name: r.name, email: r.email ?? null, role: r.role || "closer", tiers: r.tiers || "A,B", weight: r.weight ?? 1,
    calendar_url: r.calendar_url ?? null, commission_pct: r.commission_pct ?? 0, monthly_target: r.monthly_target ?? 0,
    slack_user_id: r.slack_user_id ?? null, discord_user_id: r.discord_user_id ?? null, active: r.active ?? 1, created_at: rt.now(),
  };
  await rt.env.DB.prepare(
    `INSERT INTO reps (id, name, email, role, tiers, weight, calendar_url, commission_pct, monthly_target, slack_user_id, discord_user_id, active, created_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
  ).bind(rep.id, rep.name, rep.email, rep.role, rep.tiers, rep.weight, rep.calendar_url, rep.commission_pct, rep.monthly_target, rep.slack_user_id, rep.discord_user_id, rep.active, rep.created_at).run();
  return rep;
}

export async function updateRep(rt: Runtime, id: string, input: RepInput): Promise<void> {
  const r = cleanRep(input);
  const keys = Object.keys(r);
  if (!keys.length) return;
  await rt.env.DB.prepare(`UPDATE reps SET ${keys.map((k) => `${k} = ?`).join(", ")} WHERE id = ?`)
    .bind(...keys.map((k) => (r as Record<string, unknown>)[k] ?? null), id).run();
}

export async function deleteRep(rt: Runtime, id: string): Promise<void> {
  // Soft delete keeps history intact.
  await rt.env.DB.prepare("UPDATE reps SET active = 0, weight = 0 WHERE id = ?").bind(id).run();
}
