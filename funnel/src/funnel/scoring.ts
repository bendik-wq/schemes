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
      score += opt.points;
      for (const f of opt.flags || []) flags.add(f);
      if (opt.points || opt.flags?.length) breakdown.push({ id: q.id, label: `${q.id}: ${opt.label}`, points: opt.points, flags: opt.flags || [] });
    }
  }

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
