// Experiment framework. One running experiment per slot; each visitor gets a sticky variant: the
// functional cookie "_ex" remembers it, and without the cookie the variant is a deterministic hash of
// visitor id + experiment id, so the same browser lands in the same arm. Assignments are written per
// visitor (bots, prefetches and previews excluded); a D1 trigger copies them onto the lead at creation, and
// exposures that happen after the lead exists (/book) are stamped directly.
// The headline A/B test on "/" stays where it was (HEADLINES + the _ab cookie); it is not migrated.

import type { Ctx, Runtime } from "../app";
import { BANNED_PHRASES, LANDING, VIDEOS, type GateMode } from "../config";
import type { Lead } from "../funnel/leads";
import { COOKIE, functionalCookie, type Identity } from "../lib/identity";
import { getCookie } from "hono/cookie";
import { newId } from "../lib/ids";
import { twoProportionZ } from "../admin/landers";

export const SLOTS = {
  cta_label: { label: "Landing CTA text", where: "Main button under the film on / and /for/*", values: null, control: LANDING.ctaLabel },
  gate_mode: { label: "Film gate", where: "When the application opens on / and /for/*", values: ["hard", "soft", "open"], control: VIDEOS.main.gate.mode as string },
  inline_booking: { label: "Inline booking", where: "Native time picker after submit (tiers in INLINE_BOOKING_TIERS)", values: ["on", "off"], control: "on" },
  book_page_closer_card: { label: "Closer card on /book", where: "The closer's name, photo and bio above the calendar", values: ["on", "off"], control: "on" },
} as const;
export type Slot = keyof typeof SLOTS;
export const SLOT_IDS = Object.keys(SLOTS) as Slot[];

export interface Variant { id: string; value: string }
export interface Experiment {
  id: string;
  slot: Slot;
  name: string;
  variants: Variant[];
  weights: number[];
  status: "draft" | "running" | "stopped";
  started_at: number | null;
  ended_at: number | null;
  created_at: number;
}
interface ExperimentRow { id: string; slot: string; name: string; variants_json: string; weights: string; status: string; started_at: number | null; ended_at: number | null; created_at: number }

/** Minimum sample before a result is worth reading. */
export const MIN_VISITORS_PER_ARM = 200;
export const MIN_BOOKED_TOTAL = 10;

export function rowToExperiment(r: ExperimentRow): Experiment | null {
  if (!(r.slot in SLOTS)) return null;
  try {
    const variants = JSON.parse(r.variants_json) as Variant[];
    const weights = JSON.parse(r.weights) as number[];
    if (!Array.isArray(variants) || variants.length < 2 || !Array.isArray(weights) || weights.length !== variants.length) return null;
    return { id: r.id, slot: r.slot as Slot, name: r.name, variants, weights, status: r.status as Experiment["status"], started_at: r.started_at, ended_at: r.ended_at, created_at: r.created_at };
  } catch {
    return null;
  }
}

/** FNV-1a 32-bit of the string, as a number in [0, 1). Pure and stable across isolates. */
export function hashUnit(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
  // Final avalanche so neighbouring ids spread out.
  h ^= h >>> 16; h = Math.imul(h, 0x85ebca6b) >>> 0; h ^= h >>> 13; h = Math.imul(h, 0xc2b2ae35) >>> 0; h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

/** Deterministic weighted pick for this visitor. Pure. */
export function pickVariant(unitId: string, exp: Pick<Experiment, "id" | "variants" | "weights">): Variant {
  const raw = exp.variants.map((_, i) => Math.max(0, Number(exp.weights[i]) || 0));
  const ws = raw.some((w) => w > 0) ? raw : raw.map(() => 1);
  let x = hashUnit(`${unitId}|${exp.id}`) * ws.reduce((a, b) => a + b, 0);
  for (let i = 0; i < exp.variants.length; i++) {
    x -= ws[i];
    if (x < 0) return exp.variants[i];
  }
  return exp.variants[exp.variants.length - 1];
}

const EXP_ID = /^x[0-9a-z]{19}$/;
const VAR_ID = /^[a-d]$/;

export function parseExpCookie(raw: string | undefined | null): Map<string, string> {
  const out = new Map<string, string>();
  for (const part of String(raw || "").split("~").slice(0, 12)) {
    const [e, v] = part.split(".");
    if (EXP_ID.test(e || "") && VAR_ID.test(v || "")) out.set(e, v);
  }
  return out;
}

export function formatExpCookie(m: Map<string, string>): string {
  return [...m.entries()].slice(-8).map(([e, v]) => `${e}.${v}`).join("~");
}

// ── Running experiments (cached per isolate) ─────────────────────────────────

let cache: { at: number; list: Experiment[] } | null = null;

export async function runningExperiments(rt: Runtime): Promise<Experiment[]> {
  if (cache && rt.now() - cache.at < 30_000) return cache.list;
  let list: Experiment[] = [];
  try {
    const rows = (await rt.env.DB.prepare("SELECT * FROM experiments WHERE status = 'running'").all<ExperimentRow>()).results || [];
    list = rows.map(rowToExperiment).filter((e): e is Experiment => !!e);
  } catch { list = []; /* before the migration */ }
  cache = { at: rt.now(), list };
  return list;
}

export function clearExperimentCache(): void { cache = null; }

export type Assigned = Partial<Record<Slot, { exp: string; variant: string; value: string }>>;

/**
 * Page renders: the variant per slot for this visitor (only slots with a running experiment are present).
 * Records the assignment (and the lead exposure when the visitor is already a lead) after the response.
 */
export async function assignSlots(c: Ctx, id: Identity, slots: Slot[], opts: { preview?: boolean } = {}): Promise<Assigned> {
  const rt = c.get("rt");
  const running = (await runningExperiments(rt)).filter((e) => slots.includes(e.slot));
  if (!running.length) return {};
  const jar = parseExpCookie(getCookie(c, COOKIE.experiments));
  const out: Assigned = {};
  const fresh: Array<{ exp: string; variant: string }> = [];
  let changed = false;
  for (const e of running) {
    const fromJar = jar.get(e.id);
    const v = e.variants.find((x) => x.id === fromJar) || pickVariant(id.visitorId, e);
    if (fromJar !== v.id) { jar.set(e.id, v.id); changed = true; }
    out[e.slot] = { exp: e.id, variant: v.id, value: v.value };
    fresh.push({ exp: e.id, variant: v.id });
  }
  const countable = !opts.preview && !id.isPrefetch && !id.isBot;
  if (countable) {
    if (changed) functionalCookie(c, COOKIE.experiments, formatExpCookie(jar), id.adsAllowed);
    const now = rt.now(), visitorId = id.visitorId, leadId = id.leadId;
    rt.waitUntil((async () => {
      if (id.pending) await id.pending;
      const db = rt.env.DB;
      const stmts = fresh.map((f) => db.prepare("INSERT OR IGNORE INTO assignments (visitor_id, exp_id, variant, assigned_at) VALUES (?,?,?,?)").bind(visitorId, f.exp, f.variant, now));
      if (leadId) for (const f of fresh) stmts.push(db.prepare("INSERT OR IGNORE INTO lead_exposures (lead_id, exp_id, variant, at) VALUES (?,?,?,?)").bind(leadId, f.exp, f.variant, now));
      await db.batch(stmts);
    })());
  }
  return out;
}

/** gate_mode value → a GateMode, or the configured default. */
export function gateFrom(a: Assigned, fallback: GateMode): GateMode {
  const v = a.gate_mode?.value;
  return v === "hard" || v === "soft" || v === "open" ? v : fallback;
}

/**
 * Server-side inline-booking check for a lead (application.ts): true unless a running inline_booking
 * experiment put this lead in an "off" arm. The lead's arm is its exposure, else its visitor's assignment,
 * else the deterministic hash (stamped so the report counts it).
 */
export async function inlineBookingOn(rt: Runtime, lead: Pick<Lead, "id" | "visitor_id">): Promise<boolean> {
  const exp = (await runningExperiments(rt)).find((e) => e.slot === "inline_booking");
  if (!exp) return true;
  const db = rt.env.DB;
  let vid = (await db.prepare("SELECT variant FROM lead_exposures WHERE lead_id = ? AND exp_id = ?").bind(lead.id, exp.id).first<{ variant: string }>())?.variant;
  if (!vid && lead.visitor_id) vid = (await db.prepare("SELECT variant FROM assignments WHERE visitor_id = ? AND exp_id = ?").bind(lead.visitor_id, exp.id).first<{ variant: string }>())?.variant;
  if (!vid) {
    vid = pickVariant(lead.visitor_id || lead.id, exp).id;
    await db.prepare("INSERT OR IGNORE INTO lead_exposures (lead_id, exp_id, variant, at) VALUES (?,?,?,?)").bind(lead.id, exp.id, vid, rt.now()).run();
  }
  return (exp.variants.find((v) => v.id === vid)?.value ?? "on") !== "off";
}

// ── Admin: create, start, stop ───────────────────────────────────────────────

export class ExperimentError extends Error {}

/** Validates a new experiment. Pure. The first variant is the control. */
export function cleanExperimentInput(b: { slot?: unknown; name?: unknown; values?: unknown; weights?: unknown }): { slot: Slot; name: string; variants: Variant[]; weights: number[] } {
  const slot = String(b.slot ?? "") as Slot;
  if (!(slot in SLOTS)) throw new ExperimentError("Pick a slot.");
  const def = SLOTS[slot];
  const raw = (Array.isArray(b.values) ? b.values : String(b.values ?? "").split("\n")).map((v) => String(v ?? "").replace(/\s+/g, " ").trim()).filter(Boolean);
  if (raw.length < 2 || raw.length > 4) throw new ExperimentError("Give two to four variants; the first is the control.");
  if (new Set(raw.map((v) => v.toLowerCase())).size !== raw.length) throw new ExperimentError("Variants must differ.");
  for (const v of raw) {
    if (def.values) {
      if (!(def.values as readonly string[]).includes(v)) throw new ExperimentError(`"${v}" is not a value for this slot (${def.values.join(", ")}).`);
    } else {
      if (v.length < 3 || v.length > 48) throw new ExperimentError("Button text must be 3 to 48 characters.");
      const lower = v.toLowerCase();
      for (const p of BANNED_PHRASES) if (lower.includes(p)) throw new ExperimentError(`"${v}" contains the banned phrase "${p}".`);
      if (/\bfree\b/.test(lower)) throw new ExperimentError("Never call the call free.");
      if (/[<>]/.test(v)) throw new ExperimentError("No markup in button text.");
    }
  }
  let weights = Array.isArray(b.weights) ? b.weights.map(Number) : String(b.weights ?? "").split(/[\s,]+/).filter(Boolean).map(Number);
  if (!weights.length) weights = raw.map(() => 1);
  if (weights.length !== raw.length || weights.some((w) => !Number.isFinite(w) || w <= 0 || w > 100)) throw new ExperimentError("Weights: one positive number per variant (e.g. 1, 1).");
  const name = String(b.name ?? "").replace(/\s+/g, " ").trim().slice(0, 80) || `${def.label} test`;
  return { slot, name, variants: raw.map((value, i) => ({ id: "abcd"[i], value })), weights };
}

export async function createExperiment(rt: Runtime, b: Parameters<typeof cleanExperimentInput>[0]): Promise<Experiment> {
  const x = cleanExperimentInput(b);
  const id = newId("x");
  await rt.env.DB.prepare("INSERT INTO experiments (id, slot, name, variants_json, weights, status, created_at) VALUES (?,?,?,?,?,'draft',?)")
    .bind(id, x.slot, x.name, JSON.stringify(x.variants), JSON.stringify(x.weights), rt.now()).run();
  return (await getExperiment(rt, id))!;
}

export async function getExperiment(rt: Runtime, id: string): Promise<Experiment | null> {
  const r = await rt.env.DB.prepare("SELECT * FROM experiments WHERE id = ?").bind(id).first<ExperimentRow>();
  return r ? rowToExperiment(r) : null;
}

export async function startExperiment(rt: Runtime, id: string): Promise<void> {
  const e = await getExperiment(rt, id);
  if (!e) throw new ExperimentError("Not found.");
  if (e.status !== "draft") throw new ExperimentError("Only a draft can start. Create a new experiment to test again.");
  const busy = await rt.env.DB.prepare("SELECT id FROM experiments WHERE slot = ? AND status = 'running'").bind(e.slot).first();
  if (busy) throw new ExperimentError("Another experiment is already running on this slot. Stop it first.");
  await rt.env.DB.prepare("UPDATE experiments SET status = 'running', started_at = ? WHERE id = ? AND status = 'draft'").bind(rt.now(), id).run();
  clearExperimentCache();
}

export async function stopExperiment(rt: Runtime, id: string): Promise<void> {
  await rt.env.DB.prepare("UPDATE experiments SET status = 'stopped', ended_at = ? WHERE id = ? AND status = 'running'").bind(rt.now(), id).run();
  clearExperimentCache();
}

export async function deleteDraft(rt: Runtime, id: string): Promise<void> {
  await rt.env.DB.prepare("DELETE FROM experiments WHERE id = ? AND status = 'draft'").bind(id).run();
}

// ── Report ───────────────────────────────────────────────────────────────────

export interface ArmCounts { visitors: number; leads: number; applications: number; qualified: number; booked: number; booked_qualified: number; showed: number; won: number; cash: number }

/** Pure: compares each arm with the control on booked-qualified calls per visitor. */
export function compareArms(arms: Array<{ id: string; counts: ArmCounts }>) {
  const control = arms[0];
  const totalBooked = arms.reduce((a, x) => a + x.counts.booked_qualified, 0);
  const small = arms.some((a) => a.counts.visitors < MIN_VISITORS_PER_ARM) || totalBooked < MIN_BOOKED_TOTAL;
  return {
    enough_data: !small,
    warning: small ? `Too early to read: needs at least ${MIN_VISITORS_PER_ARM} visitors per variant and ${MIN_BOOKED_TOTAL} booked qualified calls in total. Differences before that are mostly noise.` : null,
    arms: arms.map((a, i) => {
      const rate = a.counts.visitors ? a.counts.booked_qualified / a.counts.visitors : null;
      const t = i === 0 || !control ? { z: null, p: null } : twoProportionZ(a.counts.booked_qualified, a.counts.visitors, control.counts.booked_qualified, control.counts.visitors);
      return { id: a.id, ...a.counts, booked_rate: rate == null ? null : Math.round(rate * 10000) / 100, z: t.z, p: t.p, significant: !small && t.p != null && t.p < 0.05 };
    }),
  };
}

export async function experimentsReport(rt: Runtime) {
  const rows = (await rt.env.DB.prepare("SELECT * FROM experiments ORDER BY CASE status WHEN 'running' THEN 0 WHEN 'draft' THEN 1 ELSE 2 END, created_at DESC LIMIT 50").all<ExperimentRow>()).results || [];
  const list = rows.map(rowToExperiment).filter((e): e is Experiment => !!e);
  const out = [];
  for (const e of list) {
    const [vis, leads] = await Promise.all([
      rt.env.DB.prepare(
        `SELECT a.variant AS v, COUNT(*) AS n FROM assignments a JOIN visitors vi ON vi.id = a.visitor_id AND vi.is_bot = 0 WHERE a.exp_id = ? GROUP BY a.variant`,
      ).bind(e.id).all<{ v: string; n: number }>(),
      rt.env.DB.prepare(
        `SELECT x.variant AS v, COUNT(*) AS leads, SUM(l.app_completed_at IS NOT NULL) AS applications,
           SUM(l.app_completed_at IS NOT NULL AND COALESCE(l.tier_override, l.tier) IN ('A','B')) AS qualified,
           SUM(l.booked_at IS NOT NULL) AS booked,
           SUM(l.booked_at IS NOT NULL AND COALESCE(l.tier_override, l.tier) IN ('A','B')) AS booked_qualified,
           SUM(l.showed_at IS NOT NULL OR l.status IN ('showed','won','lost')) AS showed, SUM(l.status = 'won') AS won,
           COALESCE(SUM(l.cash_collected), 0) AS cash
         FROM lead_exposures x JOIN leads l ON l.id = x.lead_id WHERE x.exp_id = ? GROUP BY x.variant`,
      ).bind(e.id).all<{ v: string } & Record<string, number>>(),
    ]);
    const arms = e.variants.map((v) => {
      const l = (leads.results || []).find((r) => r.v === v.id);
      const n = (k: string) => Number(l?.[k] || 0);
      return {
        id: v.id,
        counts: {
          visitors: Number((vis.results || []).find((r) => r.v === v.id)?.n || 0),
          leads: n("leads"), applications: n("applications"), qualified: n("qualified"), booked: n("booked"),
          booked_qualified: n("booked_qualified"), showed: n("showed"), won: n("won"), cash: n("cash"),
        },
      };
    });
    const cmp = compareArms(arms);
    out.push({
      ...e, slot_label: SLOTS[e.slot].label, slot_where: SLOTS[e.slot].where,
      ...cmp,
      arms: cmp.arms.map((a, i) => ({ ...a, value: e.variants[i].value, weight: e.weights[i], control: i === 0 })),
    });
  }
  return { slots: SLOT_IDS.map((id) => ({ id, label: SLOTS[id].label, where: SLOTS[id].where, values: SLOTS[id].values, control: SLOTS[id].control })), experiments: out, min_visitors: MIN_VISITORS_PER_ARM, min_booked: MIN_BOOKED_TOTAL };
}
