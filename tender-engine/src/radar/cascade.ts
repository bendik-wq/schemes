// What happens after a public trigger: which subcontract RFQs usually follow, who issues them, and when.
// The pattern comes from news, job ads and award notices (research/2026-10-offshore-tender-engine.md):
//   FID / PDO approval → SURF, SPS, umbilicals, tie-in, vessel and ROV packages within ~0–9 months
//   FEED award        → equipment vendor RFQs during FEED, then a fabrication tender
//   EPCI award        → the tier-1 subcontracts fabrication, coating, NDT, rental, tooling within ~1–6 months
//   Frame agreement   → call-offs over the agreement period
//   Decommissioning   → cutting, lifting, waste handling, ROV, survey
//   Wind grant / CfD  → foundations, moorings, cables, marine operations

export type Kind = "fid" | "epci_award" | "feed_award" | "frame" | "decom" | "wind_grant" | "vessel" | "other";

export interface Cascade {
  kind: Kind;
  label: string;
  packages: string[];
  window: string;
  base: number; // how strongly this trigger predicts subcontract RFQs
}

export const CASCADES: Record<Kind, Cascade> = {
  fid: {
    kind: "fid", label: "Investment decision / PDO", base: 30, window: "RFQs typically within 0–9 months",
    packages: ["subsea production systems", "umbilicals", "SURF and flowlines", "tie-in and spools", "subsea tooling", "ROV services", "vessel time", "coating", "NDT and inspection", "hydraulic equipment", "valves", "engineering studies"],
  },
  epci_award: {
    kind: "epci_award", label: "EPC / EPCI award to a contractor", base: 28, window: "Subcontract RFQs typically within 1–6 months",
    packages: ["fabrication", "structural steel", "piping", "coating", "NDT and inspection", "scaffolding", "rental equipment", "tooling", "electrical and instrumentation", "valves", "lifting equipment", "transport and logistics"],
  },
  feed_award: {
    kind: "feed_award", label: "FEED award", base: 22, window: "Vendor RFQs during FEED (3–12 months), fabrication tender later",
    packages: ["equipment vendor data", "engineering studies", "budget quotes", "valves", "electrical and instrumentation", "rotating equipment", "fabrication (later)"],
  },
  frame: {
    kind: "frame", label: "Frame agreement / MMO contract", base: 20, window: "Call-offs over the agreement period",
    packages: ["maintenance and modifications", "scaffolding", "insulation", "coating", "rental equipment", "spare parts", "inspection", "hook-up and commissioning"],
  },
  decom: {
    kind: "decom", label: "Decommissioning award", base: 22, window: "Subcontracts typically within 1–6 months",
    packages: ["cutting and removal", "heavy lift", "waste handling and recycling", "ROV services", "survey", "plugging and abandonment", "transport and logistics"],
  },
  wind_grant: {
    kind: "wind_grant", label: "Offshore wind award / grant", base: 22, window: "EPCI procurement typically within 6–18 months",
    packages: ["foundations", "moorings and anchors", "inter-array cables", "marine operations", "survey", "turbine installation", "port and logistics", "O&M vessels"],
  },
  vessel: {
    kind: "vessel", label: "Vessel or rig contract", base: 12, window: "Equipment and service RFQs around mobilisation",
    packages: ["vessel equipment", "ROV services", "deck equipment", "catering and crew services", "spare parts", "inspection"],
  },
  other: { kind: "other", label: "Industry news", base: 0, window: "", packages: [] },
};

const RULES: [Kind, RegExp][] = [
  ["decom", /\b(decommission\w*|plug(ging)? and abandon\w*|removal of (the )?(platform|topside|jacket|substructure))/i],
  ["wind_grant", /\b(offshore wind|floating wind|wind farm|vindkraft|havvind)\b.*\b(award\w*|grant\w*|support\w*|fund\w*|backs?|subsid\w*|contract\w*|tildel\w*|selected|cfd|enova)\b|\b(enova|cfd)\b.*\bwind/i],
  ["fid", /\b(fid|final investment decision|sanction(s|ed)?|pdo|plan for development|pud|investeringsbeslutning|approved the development)\b/i],
  ["feed_award", /\bfeed\b/i],
  ["frame", /\b(frame agreement|framework agreement|rammeavtale|mmo contract|maintenance and modifications|long-term (maintenance|service) (contract|deal|agreement)|call-off)\b/i],
  ["epci_award", /\b(epci|epc|epcic|epcm|topside(s)? contract|fabrication contract|subsea (contract|award)|awarded .{0,40}contract|contract .{0,30}award\w*|wins? .{0,30}contract|lands? .{0,30}(contract|deal)|secures? .{0,30}contract|letter of intent|loi\b|tildelt|kontrakt)/i],
  ["vessel", /\b(rig|vessel|csv|psv|ahts|drillship|semi-submersible)\b.*\b(contract|charter|extension|award)/i],
];

export function classify(title: string, text = ""): Kind {
  const hay = `${title} ${text}`;
  for (const [k, re] of RULES) if (re.test(hay)) return k;
  return "other";
}

// Contractors and operators whose wins cascade into supplier RFQs on the NCS / North Sea.
export const BUYER_NAMES = [
  "Equinor", "Aker BP", "Vår Energi", "Var Energi", "ConocoPhillips", "OKEA", "DNO", "Harbour Energy", "TotalEnergies", "Shell", "bp", "Wintershall Dea", "Neptune Energy",
  "Petoro", "Gassco", "Ørsted", "Orsted", "RWE", "Vattenfall", "Statkraft", "Deep Wind Offshore", "Source Galileo",
  "Aker Solutions", "Aibel", "Subsea7", "Subsea 7", "TechnipFMC", "Saipem", "Worley", "Wood", "Kvaerner", "Kværner", "Moreld", "Apply", "Archer",
  "Baker Hughes", "SLB", "OneSubsea", "Halliburton", "Oceaneering", "DeepOcean", "DOF", "Solstad", "Havila", "Island Offshore", "Seaway7",
  "Nexans", "NKT", "Prysmian", "DEME", "Van Oord", "Heerema", "Allseas", "Boskalis", "McDermott", "Odfjell", "Transocean", "Noble", "Northern Ocean",
  "Rosenberg", "Westcon", "Kongsberg", "Aker Carbon Capture", "Ocean Installer", "IKM", "Beerenberg", "Bilfinger", "Altrad", "Semco Maritime",
];

// "Fulkrum wins…", "Worley Rosenberg awarded…": the winner becomes the next buyer of subcontracts.
const WINNER_RE = /^((?:[A-Z][\p{L}\d&.'-]*)(?: (?:[A-Z][\p{L}\d&.'-]*|&|and)){0,3}) (?:wins|win|lands|secures|nets|bags|scoops|clinches|awarded|selected|picked|gets|receives|books)\b/u;
const NOT_A_COMPANY = new Set(["Norway", "UK", "Big", "New", "First", "Major", "Contract", "Equinor and Aker BP"]);

export function findBuyers(text: string): string[] {
  const out: string[] = [];
  const w = text.match(WINNER_RE)?.[1]?.trim();
  if (w && !NOT_A_COMPANY.has(w) && w.length <= 40) out.push(w);
  for (const n of BUYER_NAMES) {
    const esc = n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const re = new RegExp(`(^|[^\\p{L}])${esc}([^\\p{L}]|$)`, "u");
    const norm = (x: string) => x.toLowerCase().replace(/ø/g, "o").replace(/\s+/g, "");
    if (re.test(text) && !out.some((o) => norm(o) === norm(n) || norm(o).includes(norm(n)))) out.push(n);
  }
  return out.slice(0, 6);
}

const REGION_RE = /\b(norway|norwegian|north sea|barents|norwegian sea|ncs|uk|united kingdom|scotland|aberdeen|denmark|danish|netherlands|dutch|utsira|troll|johan sverdrup|snorre|gjøa|gjoa|wisting|valhall|yggdrasil|hugin|munin|lyra|frigg|oseberg|kristin|heidrun|ormen lange|hywind|sørlige nordsjø|west of shetland)\b/i;

const ELSEWHERE_RE = /\b(saudi|aramco|egypt|t[uü]rkiye|turkey|azerbaijan|caspian|brazil|petrobras|guyana|suriname|asia pacific|australia|gulf of mexico|us gulf|india|malaysia|angola|nigeria|ghana|namibia|mozambique|middle east|qatar|uae|abu dhabi|adnoc|oman|mexico|taiwan|korea|japan|china|indonesia|vietnam|black sea|west africa|trinidad|argentina|cyprus|mediterranean|libya|israel|italy|canada|newfoundland)\b/i;

const SECTOR_RE = /\b(offshore|subsea|oil|gas|wind|energy|field|platform|fpso|rig|vessel|ccs|carbon|hydrogen|pipeline|decom\w*|norsok|lng|power|cable|marine|maritime|ship\w*|yard|riser|well\w*|drilling|seabed|survey|substation|turbine|olje|havvind|verft|skip)\b/i;

export interface RankInput { title: string; kind: Kind; buyers: string[]; packages: string[]; publishedAt: string | null }
export interface RankProfile { keywords: string[]; exclude_keywords: string[] }

/** Score 0–100: how likely this signal leads to an RFQ this supplier can bid on. */
export function rankSignal(s: RankInput, p: RankProfile, now = Date.now()): { score: number; reasons: string[]; matched: string[] } {
  const c = CASCADES[s.kind];
  const reasons: string[] = [];
  const lower = s.title.toLowerCase();
  if (p.exclude_keywords.some((k) => k && lower.includes(k.toLowerCase()))) return { score: 0, reasons: ["Excluded by your profile"], matched: [] };
  if (s.kind === "other") return { score: 0, reasons: ["No procurement trigger found"], matched: [] };
  let score = c.base;
  reasons.push(c.label);

  // Which likely packages fit what the supplier sells.
  const kws = p.keywords.map((k) => k.toLowerCase()).filter(Boolean);
  const matched = c.packages.filter((pkg) => { const pl = pkg.toLowerCase(); return kws.some((k) => pl.includes(k) || k.split(/\s+/).some((w) => w.length > 3 && pl.includes(w))); });
  const titleHit = kws.filter((k) => lower.includes(k));
  if (matched.length) { score += Math.min(30, 12 + 6 * matched.length); reasons.push(`Likely packages for you: ${matched.slice(0, 3).join(", ")}`); }
  if (titleHit.length) { score += 10; reasons.push(`Mentions ${titleHit.slice(0, 2).join(", ")}`); }

  if (!SECTOR_RE.test(s.title)) { score -= 30; reasons.push("Not clearly energy or offshore"); }
  if (REGION_RE.test(s.title)) { score += 15; reasons.push("North Sea / Nordic"); }
  else if (ELSEWHERE_RE.test(s.title)) { score -= 35; reasons.push("Outside your markets (the contractor may still buy from you)"); }
  if (s.buyers.length) { score += 8; reasons.push(`Next buyer: ${s.buyers.slice(0, 2).join(", ")}`); }

  if (s.publishedAt) {
    const days = (now - Date.parse(s.publishedAt)) / 86_400_000;
    if (days > 180) { score -= 40; reasons.push("Older than 6 months"); }
    else if (days > 60) score -= 8;
    else if (days <= 14) { score += 6; reasons.push("This fortnight"); }
  }
  return { score: Math.max(0, Math.min(100, Math.round(score))), reasons, matched };
}
