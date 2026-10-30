// Rule-based RFQ reader. Runs with no API key and is the fallback when Claude is unavailable.
// It finds requirement sentences, the standards they cite, a category, and the closing date.

export type Category = "technical" | "commercial" | "hse" | "quality" | "documentation" | "legal" | "schedule";

export interface ExtractedReq {
  clause: string;
  text: string;
  category: Category;
  mandatory: boolean;
  standards: string[];
}

const STANDARD_RE =
  /\b(NORSOK\s+[A-Z]-\d{3}[A-Z]?|ISO\s?\d{3,5}(?:-\d+)?(?::\d{4})?|IEC\s?\d{4,5}(?:-\d+)*|EN\s?\d{3,5}(?:-\d+)?|API\s?(?:RP\s?|Spec\s?|STD\s?)?\d{1,4}[A-Z]?|DNV[\s-](?:ST|RP|OS|OS-[A-Z])-?[A-Z]?\d{2,3}|ASME\s(?:B\d+(?:\.\d+)?|Section\s[IVX]+)|PED\s2014\/68\/EU|ATEX|IECEx|IMCA\s[A-Z]\s?\d{3}|OGUK|GWO)\b/gi;

const MANDATORY_RE = /\b(shall|must|is required|are required|required to|as required|appl(?:y|ies)|mandatory|minimum|at least|no later than|skal|må|påkrevd|krav)\b/i;
const SOFT_RE = /\b(should|preferred|desirable|may|bør|ønskelig)\b/i;

// Order matters: the first match wins. Patterns are word-prefix matches.
const CATEGORY_RULES: [Category, RegExp][] = [
  ["hse", /\b(hse|hseq|safety|health|environment|s-006|s-002|h2s|permit to work|lti\b|trif\b|emission|hms\b)/i],
  ["legal", /\b(liabilit|insurance|indemn|governing law|confidential|transparency act|åpenhetsloven|sanction|anti[- ]?corruption|gdpr|human rights|code of conduct|subcontractor)/i],
  ["quality", /\b(iso 9001|quality|qa\/qc|qa\b|qc\b|itp\b|inspection and test|inspection|calibrat|traceab|ncr\b|welding procedure|wps\b|pqr\b|ndt\b|fat\b|sat\b)/i],
  ["commercial", /\b(price|pricing|rates?\b|payment|invoice|currency|nok\b|eur\b|usd\b|valid(ity)? for|validity|discount|incoterm|ddp\b|dap\b|fca\b|liquidated|bank guarantee|parent company guarantee|cost)/i],
  ["documentation", /\b(documentation|document|drawing|mdr\b|sdrl\b|vdrl\b|data ?book|manual|certificate of conformity|as[- ]built)/i],
  ["schedule", /\b(delivery|deliver(ed)? by|lead time|schedule|milestone|mobili[sz]|completion date|start[- ]?up|notice\b)/i],
];

export function categorise(text: string): Category {
  for (const [cat, re] of CATEGORY_RULES) if (re.test(text)) return cat;
  return "technical";
}

export function findStandards(text: string): string[] {
  const out = new Set<string>();
  for (const m of text.matchAll(STANDARD_RE)) out.add(m[1].replace(/\s+/g, " ").toUpperCase().replace(/^NORSOK /, "NORSOK "));
  return [...out];
}

const CLAUSE_RE = /^\s*((?:[A-Z]\.)?\d{1,2}(?:\.\d{1,3}){0,4}\.?|[a-z]\)|\([a-z0-9]{1,3}\)|[-•*])\s+/;

/** Split a document into candidate sentences, carrying the nearest clause number. */
export function sentences(text: string): { clause: string; text: string }[] {
  const out: { clause: string; text: string }[] = [];
  let clause = "";
  for (const rawLine of text.replace(/\r/g, "").split("\n")) {
    let line = rawLine.trim();
    if (!line) continue;
    const m = line.match(CLAUSE_RE);
    if (m && /\d/.test(m[1])) {
      clause = m[1].replace(/\.$/, "");
      line = line.slice(m[0].length);
    } else if (m) {
      line = line.slice(m[0].length);
    }
    for (const s of line.split(/(?<=[.;!?])\s+(?=[A-ZÆØÅ(])/)) {
      const t = s.trim();
      if (t.length >= 12) out.push({ clause, text: t });
    }
  }
  return out;
}

export function extractRequirements(text: string, max = 250): ExtractedReq[] {
  const seen = new Set<string>();
  const out: ExtractedReq[] = [];
  for (const s of sentences(text)) {
    const standards = findStandards(s.text);
    const hard = MANDATORY_RE.test(s.text);
    const soft = !hard && SOFT_RE.test(s.text);
    if (!hard && !soft && standards.length === 0) continue;
    const key = s.text.toLowerCase().replace(/\W+/g, " ").trim();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ clause: s.clause, text: s.text.slice(0, 1200), category: categorise(s.text), mandatory: !soft, standards });
    if (out.length >= max) break;
  }
  return out;
}

const MONTHS: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, mai: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, okt: 10, nov: 11, dec: 12, des: 12,
};

function toIso(y: number, m: number, d: number): string | null {
  if (y < 100) y += 2000;
  if (m < 1 || m > 12 || d < 1 || d > 31) return null;
  return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

/** Find the submission deadline: the first date near "closing", "deadline", "due" or "frist". */
export function findDeadline(text: string): string | null {
  const re = /(closing date|closing time|deadline|due date|submission date|submitted (?:no later than|by)|tender due|frist|tilbudsfrist)[^\n]{0,60}/gi;
  for (const m of text.matchAll(re)) {
    const s = m[0];
    let d = s.match(/(\d{4})-(\d{2})-(\d{2})/);
    if (d) return toIso(+d[1], +d[2], +d[3]);
    d = s.match(/(\d{1,2})[./](\d{1,2})[./](\d{2,4})/);
    if (d) return toIso(+d[3], +d[2], +d[1]);
    d = s.match(/(\d{1,2})(?:st|nd|rd|th)?\.?\s+([A-Za-z]{3})[a-z]*\.?\s+(\d{4})/);
    if (d && MONTHS[d[2].toLowerCase()]) return toIso(+d[3], MONTHS[d[2].toLowerCase()], +d[1]);
    d = s.match(/([A-Za-z]{3})[a-z]*\.?\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(\d{4})/);
    if (d && MONTHS[d[1].toLowerCase()]) return toIso(+d[3], MONTHS[d[1].toLowerCase()], +d[2]);
  }
  return null;
}

export function findReference(text: string): string {
  const m = text.match(/\b(?:RFQ|ITT|RFP|ITB|Inquiry|Enquiry|Tender|Ref(?:erence)?)\s*(?:no\.?|number|#|:)?\s*:?\s*([A-Z0-9][A-Z0-9/_.-]{3,30})/i);
  return m ? m[1] : "";
}

// ---- Evidence matching against the answer library ----

export interface LibraryItem {
  id: number;
  title: string;
  category: string;
  tags: string[];
  body: string;
  expires_at: string | null;
}

const STOP = new Set("the a an and or of to in for on with by be is are shall must will as at from this that all any our your contractor supplier company".split(" "));

export function tokens(s: string): Set<string> {
  return new Set(
    s.toLowerCase().replace(/[^a-z0-9æøå:.-]+/g, " ").split(" ").filter((w) => w.length > 2 && !STOP.has(w)),
  );
}

export function bestEvidence(req: ExtractedReq, lib: LibraryItem[]): { item: LibraryItem; score: number } | null {
  const rt = tokens(req.text);
  let best: { item: LibraryItem; score: number } | null = null;
  for (const item of lib) {
    let score = 0;
    const it = tokens(`${item.title} ${item.tags.join(" ")} ${item.body.slice(0, 600)}`);
    for (const w of rt) if (it.has(w)) score += 1;
    const itemStd = findStandards(`${item.title} ${item.tags.join(" ")} ${item.body}`);
    for (const s of req.standards) if (itemStd.includes(s)) score += 6;
    if (item.category === req.category) score += 1;
    if (!best || score > best.score) best = { item, score };
  }
  return best && best.score >= 4 ? best : null;
}

// ---- Bid / no-bid scorecard ----

export interface Scorecard {
  fit: number;
  capability: number;
  compliance: number;
  timing: number;
  overall: number;
  recommendation: "bid" | "consider" | "no_bid";
  reasons: string[];
  missing_certifications: string[];
}

export function scorecard(
  reqs: ExtractedReq[],
  matched: number,
  profile: { keywords: string[]; certifications: string[]; evidencedStandards?: string[] },
  text: string,
  deadline: string | null,
  now = Date.now(),
): Scorecard {
  const reasons: string[] = [];
  const lower = text.toLowerCase();

  const kwHits = profile.keywords.filter((k) => k && lower.includes(k.toLowerCase()));
  const fit = profile.keywords.length ? Math.min(100, Math.round((kwHits.length / Math.min(profile.keywords.length, 5)) * 100)) : 50;
  reasons.push(kwHits.length ? `Scope matches ${kwHits.slice(0, 4).join(", ")}` : "Scope does not mention your core keywords");

  // Held = certifications on the profile plus standards your library already evidences.
  const held = [...profile.certifications, ...(profile.evidencedStandards ?? [])].map((c) => c.toUpperCase());
  const required = [...new Set(reqs.flatMap((r) => (r.mandatory ? r.standards : [])))];
  const missing = required.filter((s) => !held.some((h) => h.includes(s) || s.includes(h.split(":")[0])));
  const capability = required.length ? Math.round(((required.length - missing.length) / required.length) * 100) : 70;
  if (missing.length) reasons.push(`Not on your profile: ${missing.slice(0, 5).join(", ")}`);

  const mand = reqs.filter((r) => r.mandatory).length;
  const compliance = reqs.length ? Math.round((matched / reqs.length) * 100) : 50;
  reasons.push(`${mand} mandatory requirements, ${matched} with library evidence`);

  let timing = 70;
  if (deadline) {
    const days = (Date.parse(deadline) - now) / 86_400_000;
    timing = days < 0 ? 0 : days < 5 ? 20 : days < 10 ? 55 : days < 21 ? 80 : 100;
    reasons.push(days < 0 ? "Deadline has passed" : `${Math.round(days)} days to deadline`);
  } else {
    reasons.push("No deadline found: confirm it");
  }

  const overall = Math.round(fit * 0.35 + capability * 0.3 + compliance * 0.15 + timing * 0.2);
  const recommendation = timing === 0 ? "no_bid" : overall >= 65 ? "bid" : overall >= 45 ? "consider" : "no_bid";
  return { fit, capability, compliance, timing, overall, recommendation, reasons, missing_certifications: missing };
}

export function clarifications(reqs: ExtractedReq[], deadline: string | null): string[] {
  const out: string[] = [];
  if (!deadline) out.push("Please confirm the submission deadline and time zone.");
  const vague = reqs.filter((r) => /\b(as required|as necessary|tbd|tba|to be agreed|where applicable|etc\.?)\b/i.test(r.text));
  for (const r of vague.slice(0, 5)) out.push(`Clause ${r.clause || "?"}: please define "${r.text.slice(0, 90)}${r.text.length > 90 ? "…" : ""}"`);
  if (/\bliquidated damages\b/i.test(reqs.map((r) => r.text).join(" ")) && !/\bcap(ped)?\b/i.test(reqs.map((r) => r.text).join(" ")))
    out.push("Please confirm the cap on liquidated damages.");
  return out;
}
