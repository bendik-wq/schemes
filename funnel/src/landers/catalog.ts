// Industry landers: 20 industries × 5 angles = 100 pages at /for/:industry[/:angle].
// Every headline must be unique across all 100 (a test checks it).

export interface Industry {
  id: string;
  label: string;
  /** "clinic owners" */
  owners: string;
  /** "clinic" */
  one: string;
  /** "clinics" */
  many: string;
  /** What they currently rent, in their words. */
  rent: string;
  /** The tool they'd build first. */
  tool: string;
  keywords: string[];
}

export const INDUSTRIES: Industry[] = [
  { id: "dental", label: "Dental", owners: "dental practice owners", one: "practice", many: "dental practices", rent: "the marketing agency and the booking widget", tool: "a treatment-plan follow-up tracker", keywords: ["dental", "dentist", "dentistry", "orthodontic", "orthodontist", "implant", "implants", "tannlege", "smile"] },
  { id: "aesthetics", label: "Aesthetics clinics", owners: "aesthetics clinic owners", one: "clinic", many: "aesthetics clinics", rent: "the lead-gen agency and three booking tools", tool: "a consult-to-treatment dashboard", keywords: ["aesthetic", "aesthetics", "botox", "filler", "cosmetic", "skin clinic", "medspa", "med spa", "laser"] },
  { id: "physio", label: "Physio and allied health", owners: "physio and allied-health owners", one: "clinic", many: "physio clinics", rent: "the website agency and the review tool", tool: "a rebooking and recall tool", keywords: ["physio", "physiotherapy", "chiro", "chiropractic", "osteopath", "allied health", "rehab", "fysio", "podiatry"] },
  { id: "law", label: "Law firms", owners: "law firm partners", one: "firm", many: "law firms", rent: "the SEO retainer and the intake software", tool: "an intake scoring tool", keywords: ["law", "lawyer", "lawyers", "legal", "attorney", "solicitor", "advokat", "firm of solicitors"] },
  { id: "accounting", label: "Accounting firms", owners: "accounting firm owners", one: "firm", many: "accounting firms", rent: "the marketing freelancer and a stack of client portals", tool: "a client onboarding tracker", keywords: ["accounting", "accountant", "accountants", "bookkeeping", "bookkeeper", "cpa", "regnskap", "tax advisory"] },
  { id: "financial-advice", label: "Financial advisers", owners: "advisory firm owners", one: "advisory firm", many: "advisory firms", rent: "the lead vendor and the compliance-heavy funnel tool", tool: "a prospect pipeline dashboard", keywords: ["financial adviser", "financial advisor", "wealth", "wealth management", "planner", "advisory", "ifa", "retirement planning"] },
  { id: "real-estate", label: "Real estate", owners: "agency principals", one: "agency", many: "real estate agencies", rent: "the property portals and the CRM add-ons", tool: "a vendor lead tracker", keywords: ["real estate", "realtor", "realty", "estate agent", "estate agency", "property", "eiendom", "brokerage", "lettings"] },
  { id: "construction", label: "Construction and trades", owners: "builders and trade owners", one: "company", many: "construction firms", rent: "the lead marketplace and the quoting software", tool: "a quote follow-up tool", keywords: ["construction", "builder", "builders", "contractor", "renovation", "roofing", "roofer", "plumbing", "plumber", "electrician", "electrical", "hvac", "bygg", "trades"] },
  { id: "home-services", label: "Home services", owners: "home-service owners", one: "company", many: "home-service companies", rent: "the call-tracking tool and the ads agency", tool: "a dispatch and callback dashboard", keywords: ["cleaning", "cleaners", "landscaping", "pest", "pest control", "pool", "solar", "home services", "garage doors", "moving", "movers"] },
  { id: "ecommerce", label: "E-commerce brands", owners: "e-commerce founders", one: "brand", many: "e-commerce brands", rent: "the performance agency and a dozen apps", tool: "a margin-by-product dashboard", keywords: ["ecommerce", "e-commerce", "dtc", "d2c", "shopify", "online store", "nettbutikk", "webshop", "brand"] },
  { id: "saas", label: "B2B software", owners: "software founders", one: "company", many: "software companies", rent: "the demand-gen agency and the attribution tool", tool: "a trial-to-paid pipeline view", keywords: ["saas", "software", "b2b software", "platform", "app", "startup", "subscription software"] },
  { id: "agencies", label: "Agencies", owners: "agency owners", one: "agency", many: "agencies", rent: "the white-label vendors and the reporting tools", tool: "an automated client reporting tool", keywords: ["agency", "marketing agency", "creative agency", "studio", "consultancy", "design agency", "byrå"] },
  { id: "coaching", label: "Coaches and educators", owners: "coaching business owners", one: "business", many: "coaching businesses", rent: "the funnel builder and the setter agency", tool: "an application scoring tool", keywords: ["coach", "coaching", "course", "courses", "mentor", "mentorship", "education", "training", "academy"] },
  { id: "recruitment", label: "Recruitment", owners: "recruitment firm owners", one: "firm", many: "recruitment firms", rent: "the job boards and the ATS add-ons", tool: "a candidate pipeline dashboard", keywords: ["recruitment", "recruiter", "recruiting", "staffing", "headhunter", "talent", "rekruttering", "executive search"] },
  { id: "hospitality", label: "Hospitality", owners: "hospitality owners", one: "venue", many: "hospitality groups", rent: "the booking platforms and the social agency", tool: "a direct-booking dashboard", keywords: ["restaurant", "restaurants", "hotel", "hotels", "cafe", "bar", "hospitality", "venue", "catering", "events"] },
  { id: "fitness", label: "Gyms and studios", owners: "gym and studio owners", one: "studio", many: "gyms and studios", rent: "the membership-app add-ons and the ads agency", tool: "a trial-to-member tracker", keywords: ["gym", "gyms", "fitness", "studio", "pilates", "yoga", "crossfit", "personal training", "trening"] },
  { id: "insurance", label: "Insurance brokers", owners: "brokerage owners", one: "brokerage", many: "insurance brokerages", rent: "the lead aggregators and the quoting portals", tool: "a renewal pipeline view", keywords: ["insurance", "broker", "brokers", "brokerage", "forsikring", "underwriting"] },
  { id: "logistics", label: "Logistics and transport", owners: "logistics company owners", one: "company", many: "logistics companies", rent: "the sales agency and the quoting tools", tool: "a quote-to-contract tracker", keywords: ["logistics", "freight", "transport", "trucking", "haulage", "courier", "shipping", "warehouse", "warehousing"] },
  { id: "manufacturing", label: "Manufacturers", owners: "manufacturing owners", one: "company", many: "manufacturers", rent: "the trade-show agency and the dealer portal", tool: "a dealer and distributor dashboard", keywords: ["manufacturing", "manufacturer", "factory", "fabrication", "industrial", "production", "oem", "produksjon"] },
  { id: "it-services", label: "IT and managed services", owners: "IT services owners", one: "MSP", many: "IT service providers", rent: "the lead-gen vendor and the PSA add-ons", tool: "a contract-renewal radar", keywords: ["it services", "msp", "managed services", "it support", "cybersecurity", "cyber", "cloud services", "network"] },
];

export interface Angle {
  id: string;
  label: string;
  pre: (i: Industry) => string;
  headline: (i: Industry) => string;
  sub: (i: Industry) => string;
}

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

export const ANGLES: Angle[] = [
  {
    id: "agency",
    label: "Replace the agency",
    pre: (i) => `For ${i.owners} doing $1M+`,
    headline: (i) => `${cap(i.owners)}: stop renting ${i.rent}. Own the machine in 56 days.`,
    // An agency's own supplier is a vendor, not "the agency" (never "the agency owns the machine, not the agency").
    sub: (i) => `In eight weeks your team builds and runs its own pages, ad tracking and sales dashboard on Claude Code. Your ${i.one} owns the machine, not ${i.one === "agency" ? "your vendors" : "an outside agency"}.`,
  },
  {
    id: "tracking",
    label: "Tracking you can trust",
    pre: (i) => `For ${i.many} running Meta ads`,
    headline: (i) => `${i.label}: in 56 days, Meta optimises for buyers, not clicks.`,
    sub: () => "Server-side Conversions API, deduplicated with the Pixel, with qualified-lead values so Meta optimises for buyers. Your team sets it up with us in eight weeks.",
  },
  {
    id: "funnel",
    label: "VSL page and application",
    pre: (i) => `For ${i.owners}`,
    // Matches the offer: pages and application are weeks 2–3.
    headline: (i) => `A VSL page and application for ${i.many}, live by week three.`,
    sub: () => "A page like this one, with an application that scores every lead and routes the best to your calendar. Your team edits it in plain English.",
  },
  {
    id: "dashboard",
    label: "Sales dashboard",
    pre: (i) => `For ${i.owners} who want the numbers`,
    headline: (i) => `Every lead, call and close for ${i.many}, on one screen in 56 days.`,
    sub: () => "A live dashboard from first click to cash collected: show rate, close rate and revenue by source and by rep. Yours, on your own accounts.",
  },
  {
    id: "tools",
    label: "Internal tools",
    pre: (i) => `For ${i.owners} with a list of tools to build`,
    headline: (i) => `Build ${i.tool} in 56 days, without a dev shop.`,
    sub: (i) => `Claude Code and one curious person on your team can build what your ${i.one} would otherwise pay a dev shop for. We sit beside you for eight weeks.`,
  },
];

export function getIndustry(id: string | null | undefined): Industry | null {
  return INDUSTRIES.find((i) => i.id === id) || null;
}

export function getAngle(id: string | null | undefined): Angle | null {
  return ANGLES.find((a) => a.id === id) || null;
}

function escRe(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Infer an industry from free text (business description, campaign/ad names, booking answers).
 * Exact id first, then keywords. Keywords of 4 chars or fewer must match on a word boundary
 * (with an optional plural "s"), so "pet" never matches inside "competitor".
 */
export function inferIndustry(...texts: Array<string | null | undefined>): Industry | null {
  const raw = texts.filter(Boolean).join(" ").toLowerCase();
  if (!raw.trim()) return null;
  const norm = raw.replace(/[_|/]+/g, " ");
  for (const i of INDUSTRIES) {
    if (new RegExp(`(^|[^a-z0-9-])${escRe(i.id)}([^a-z0-9-]|$)`).test(norm)) return i;
  }
  let best: { ind: Industry; score: number } | null = null;
  for (const i of INDUSTRIES) {
    let score = 0;
    for (const k of i.keywords) {
      const kw = k.toLowerCase();
      const re = kw.length <= 4 || kw.includes(" ")
        ? new RegExp(`(^|[^\\p{L}\\p{N}])${escRe(kw)}s?([^\\p{L}\\p{N}]|$)`, "u")
        : new RegExp(`${escRe(kw)}`, "u");
      if (re.test(norm)) score += kw.length;
    }
    if (score && (!best || score > best.score)) best = { ind: i, score };
  }
  return best?.ind ?? null;
}

export function landerKey(industry: string, angle: string): string {
  return `${industry}/${angle}`;
}

export function allLanders(): Array<{ industry: Industry; angle: Angle; key: string; headline: string }> {
  const out = [];
  for (const industry of INDUSTRIES) for (const angle of ANGLES) out.push({ industry, angle, key: landerKey(industry.id, angle.id), headline: angle.headline(industry) });
  return out;
}
