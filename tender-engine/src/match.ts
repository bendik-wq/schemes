// Tender fit score, 0–100, with the reasons shown next to every tender.
// Deliberately simple and explainable: a bid manager must see why something ranked high.

export interface Profile {
  keywords: string[];
  exclude_keywords: string[];
  cpv: string[];
  countries: string[];
  certifications: string[];
  min_value_eur: number;
}

export interface TenderLike {
  title: string;
  description: string;
  buyer: string;
  country: string;
  cpv: string[];
  deadline_at: string | null;
  value_eur: number | null;
}

// Offshore vocabulary that signals the sector even when the supplier's own keywords miss.
export const OFFSHORE_TERMS = [
  "offshore", "subsea", "platform", "fpso", "riser", "umbilical", "rov", "jacket", "topside", "drilling",
  "wellhead", "pipeline", "mooring", "wind farm", "turbine foundation", "monopile", "decommissioning",
  "norsok", "north sea", "continental shelf", "vessel", "marine", "hydraulic", "valve", "subsea distribution",
];

// Terms specific enough to keep a notice from a feed that has no keyword search (UK Find a Tender).
export const STRONG_OFFSHORE_TERMS = [
  "offshore", "subsea", "fpso", "riser", "umbilical", "rov", "topside", "drilling", "wellhead", "mooring", "wind farm",
  "monopile", "decommissioning", "norsok", "north sea", "continental shelf", "subsea distribution",
];

const norm = (s: string) => s.toLowerCase().normalize("NFKD").replace(/[\u0300-\u036f]/g, "");

function hasTerm(hay: string, term: string): boolean {
  const t = norm(term).trim();
  if (!t) return false;
  const esc = t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(^|[^a-z0-9])${esc}([^a-z0-9]|$)`).test(hay);
}

export function scoreTender(t: TenderLike, p: Profile, now = Date.now()): { score: number; reasons: string[] } {
  const hay = norm(`${t.title} ${t.description} ${t.buyer}`);
  const reasons: string[] = [];

  const excluded = p.exclude_keywords.filter((k) => hasTerm(hay, k));
  if (excluded.length) return { score: 0, reasons: [`Excluded: ${excluded.join(", ")}`] };

  if (t.deadline_at && Date.parse(t.deadline_at) < now) return { score: 0, reasons: ["Deadline passed"] };

  let score = 0;

  const kw = p.keywords.filter((k) => hasTerm(hay, k));
  if (kw.length) {
    score += Math.min(45, 20 + 9 * (kw.length - 1));
    reasons.push(`Matches ${kw.slice(0, 4).join(", ")}`);
  }

  const cpvHit = t.cpv.find((c) => p.cpv.some((pre) => pre && c.startsWith(pre)));
  if (cpvHit) {
    score += 20;
    reasons.push(`CPV ${cpvHit}`);
  }

  const off = OFFSHORE_TERMS.filter((k) => hasTerm(hay, k));
  if (off.length) {
    score += Math.min(15, 6 * off.length);
    reasons.push(`Offshore: ${off.slice(0, 3).join(", ")}`);
  }

  // Country and size only count once the notice is relevant at all.
  if (!kw.length && !cpvHit && !off.length) return { score: 0, reasons: ["No match with your profile"] };
  // One generic keyword with no sector signal is weak evidence.
  const weak = kw.length === 1 && !cpvHit && !off.length;

  if (p.countries.length && p.countries.includes(t.country)) {
    score += 10;
    reasons.push(`In ${t.country}`);
  }

  if (t.value_eur != null && p.min_value_eur > 0) {
    if (t.value_eur >= p.min_value_eur) {
      score += 5;
      reasons.push("Above minimum size");
    } else {
      score -= 15;
      reasons.push("Below minimum size");
    }
  }

  if (t.deadline_at) {
    const days = (Date.parse(t.deadline_at) - now) / 86_400_000;
    if (days < 7) {
      score -= 10;
      reasons.push(`${Math.max(0, Math.round(days))} days to deadline`);
    } else if (days >= 14) {
      score += 5;
    }
  }

  return { score: Math.max(0, Math.min(weak ? 20 : 100, Math.round(score))), reasons };
}
