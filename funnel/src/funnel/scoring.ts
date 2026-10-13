import {
  APPLICATION, EXCLUDED_INDUSTRIES, PERSONAL_EMAIL_DOMAINS, TARGET_COUNTRIES, TIER_RULES, TIER_THRESHOLDS,
  type Question, type Tier,
} from "../config";
import type { Answers } from "./leads";

export interface ScoreLine { id: string; label: string; points: number; flags: string[]; }
export interface ScoreResult {
  score: number;
  tier: Tier;
  rawTier: Tier;
  flags: string[];
  breakdown: ScoreLine[];
  cappedBy: string | null;
}

export interface ScoreContext {
  email?: string | null;
  country?: string | null;
  blocklist?: string[];
  /**
   * Learned points per option ("question=value" → points). undefined: use the table the owner activated
   * (registered from settings on every request), if any. null: config points only.
   */
  learned?: LearnedPoints | null;
}

/**
 * Optional learned-points hook. Off by default. When the owner turns on "use learned points for routing",
 * the points for options with enough outcomes (n ≥ 20, enforced when the table is built and here) replace the
 * config points; every flag and hard cap still comes from config, and points stay within the question's
 * config range. The version is recorded on the lead as a zero-point "model" line in the breakdown.
 */
export interface LearnedPoints { version: string; points: Record<string, number>; n?: Record<string, number> }
export const LEARNED_MIN_N = 20;

let registered: LearnedPoints | null = null;

/** Pure: a learned table, or null when it is malformed. Options under LEARNED_MIN_N are dropped. */
export function parseLearnedPoints(raw: unknown): LearnedPoints | null {
  let v: unknown = raw;
  if (typeof raw === "string") { try { v = JSON.parse(raw); } catch { return null; } }
  if (!v || typeof v !== "object") return null;
  const o = v as Record<string, unknown>;
  if (typeof o.version !== "string" || !/^[\w:.@-]{1,60}$/.test(o.version) || !o.points || typeof o.points !== "object") return null;
  const n = o.n && typeof o.n === "object" ? (o.n as Record<string, unknown>) : null;
  const points: Record<string, number> = {};
  for (const [k, p] of Object.entries(o.points as Record<string, unknown>)) {
    if (!/^[a-z_]+=[a-z0-9_]+$/.test(k) || typeof p !== "number" || !Number.isFinite(p)) continue;
    if (!n || !(Number(n[k]) >= LEARNED_MIN_N)) continue;
    points[k] = Math.round(p);
  }
  return Object.keys(points).length ? { version: o.version, points, n: n as Record<string, number> } : null;
}

/** Called from settings on every request: the activated table, or null to score with config only. */
export function useLearnedPoints(lp: LearnedPoints | null): void {
  registered = lp;
}

function optionPoints(q: Question, opt: { value: string; points: number }, learned: LearnedPoints | null): number {
  if (!learned) return opt.points;
  const key = `${q.id}=${opt.value}`;
  if (!Object.prototype.hasOwnProperty.call(learned.points, key)) return opt.points;
  const max = Math.max(0, ...(q.options || []).map((o) => o.points));
  return Math.max(0, Math.min(max, learned.points[key]));
}

function lengthPoints(q: Question, text: string): number {
  const len = text.trim().length;
  for (const lp of q.lengthPoints || []) if (len >= lp.min) return lp.points;
  return 0;
}

/** Whole-word match so "bet" does not match "better" and "adult" does not match "adulting". */
export function matchesExcludedIndustry(text: string): string | null {
  const t = ` ${text.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ")} `;
  for (const word of EXCLUDED_INDUSTRIES) {
    const w = word.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
    if (t.includes(` ${w} `) || t.includes(` ${w}s `)) return word;
  }
  return null;
}

export function emailDomain(email: string | null | undefined): string {
  return (email || "").toLowerCase().split("@")[1] || "";
}

export function isBlocked(email: string | null | undefined, blocklist: string[]): boolean {
  const e = (email || "").toLowerCase().trim();
  if (!e) return false;
  const d = emailDomain(e);
  return blocklist.some((b) => {
    const x = b.toLowerCase().trim();
    return !!x && (x === e || x === d || (x.startsWith("@") && x.slice(1) === d));
  });
}

export function scoreApplication(answers: Answers, ctx: ScoreContext = {}): ScoreResult {
  const breakdown: ScoreLine[] = [];
  const flags = new Set<string>();
  let score = 0;
  const learned = ctx.learned === undefined ? registered : ctx.learned;

  for (const q of APPLICATION) {
    const a = answers[q.id];
    if (q.type === "contact" || a == null) continue;
    if (q.type === "text") {
      const pts = lengthPoints(q, String(a));
      if (q.id === "business") {
        const hit = matchesExcludedIndustry(String(a));
        if (hit) flags.add("excluded_industry");
      }
      if (pts) { score += pts; breakdown.push({ id: q.id, label: `${q.id}: detail`, points: pts, flags: [] }); }
      continue;
    }
    const values = Array.isArray(a) ? a : [a];
    for (const v of values) {
      const opt = q.options?.find((o) => o.value === v);
      if (!opt) continue;
      const pts = optionPoints(q, opt, learned);
      score += pts;
      for (const f of opt.flags || []) flags.add(f);
      if (pts || opt.flags?.length) breakdown.push({ id: q.id, label: `${q.id}: ${opt.label}`, points: pts, flags: opt.flags || [] });
    }
  }
  if (learned) breakdown.push({ id: "model", label: learned.version, points: 0, flags: [] });

  const domain = emailDomain(ctx.email);
  if (domain && PERSONAL_EMAIL_DOMAINS.includes(domain)) {
    flags.add("personal_email");
    if (flags.has("small")) flags.add("personal_email_small");
  }
  if (ctx.country && !TARGET_COUNTRIES.includes(ctx.country.toUpperCase())) flags.add("out_of_market");
  if (isBlocked(ctx.email, ctx.blocklist || [])) flags.add("blocked");

  score = Math.max(0, Math.min(100, score));
  const rawTier: Tier = score >= TIER_THRESHOLDS.A ? "A" : score >= TIER_THRESHOLDS.B ? "B" : "C";
  let tier = rawTier;
  let cappedBy: string | null = null;
  const c = TIER_RULES.maxC.find((f) => flags.has(f));
  if (c && tier !== "C") { tier = "C"; cappedBy = c; }
  else if (!c) {
    const b = TIER_RULES.maxB.find((f) => flags.has(f));
    if (b && tier === "A") { tier = "B"; cappedBy = b; }
  }
  if (c) cappedBy = cappedBy || c;
  return { score, tier, rawTier, flags: [...flags], breakdown, cappedBy };
}
