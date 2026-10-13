// Proof: client quotes, screenshots, logos, build logs and metrics. Nothing is invented here: a row only
// renders when it is approved by the team AND the person's consent is recorded with a scope that covers
// this website, AND its text passes the same banned-phrase and outcome-promise checks as all other copy.
// The section is removed from the page entirely when nothing qualifies.

import type { Runtime } from "../app";
import { BANNED_PHRASES, OUTCOME_PROMISES } from "../config";
import { getIndustry } from "../landers/catalog";
import { newId } from "../lib/ids";
import { clip, escHtml } from "../lib/text";

export const PROOF_KINDS = ["quote", "video", "screenshot", "logo", "build_log", "metric"] as const;
export type ProofKind = (typeof PROOF_KINDS)[number];

/**
 * What a person can agree to. "site" is required for anything to show on these pages; "name" and
 * "company" decide whether we may print those next to the quote; "email" and "ads" are recorded for the
 * team (nothing in this codebase uses proof in emails or ads yet).
 */
export const CONSENT_SCOPES = [
  { id: "site", label: "Show it on the Asymmetrical website" },
  { id: "name", label: "Show my name and role with it" },
  { id: "company", label: "Show my company name with it" },
  { id: "email", label: "Quote it in emails to people considering the program" },
  { id: "ads", label: "Use it in advertising" },
] as const;
export type ConsentScope = (typeof CONSENT_SCOPES)[number]["id"];

export interface ProofRow {
  id: string;
  kind: ProofKind;
  body: string;
  author_name: string | null;
  author_role: string | null;
  company: string | null;
  industry: string | null;
  media_url: string | null;
  consent_at: number | null;
  consent_scope: string | null;
  approved: number;
  lead_id: string | null;
  source: string;
  created_at: number;
  updated_at: number;
}

export function parseScope(s: string | null | undefined): Set<ConsentScope> {
  const ok = new Set<string>(CONSENT_SCOPES.map((c) => c.id));
  return new Set(String(s || "").split(/[\s,]+/).filter((x): x is ConsentScope => ok.has(x)));
}

export function cleanScope(v: unknown): string {
  const raw = Array.isArray(v) ? v.map(String).join(",") : String(v ?? "");
  return [...parseScope(raw)].join(",");
}

/** Why this text may not be published, or null when it may. Same rules as every other line of copy. */
export function proofTextProblem(text: string): string | null {
  const lower = text.toLowerCase();
  for (const p of BANNED_PHRASES) if (lower.includes(p)) return `contains the banned phrase "${p}"`;
  for (const re of OUTCOME_PROMISES) if (re.test(text)) return "reads as a promised outcome";
  if (/\bfree\s+(strategy\s+)?(call|consultation|session)\b/i.test(text)) return 'mentions a "free" call';
  return null;
}

const MEDIA_KINDS: ProofKind[] = ["video", "screenshot", "logo"];

/** https URLs or same-site paths only. */
export function safeMediaUrl(u: string | null | undefined): string {
  const s = String(u || "").trim();
  return /^(https:\/\/|\/(?!\/))[^\s"'<>]*$/.test(s) && s.length <= 500 ? s : "";
}

/** Approved, consented for this website, clean text, and the media it needs. Pure. */
export function isRenderable(p: Pick<ProofRow, "kind" | "body" | "approved" | "consent_at" | "consent_scope" | "media_url" | "company" | "author_role">): boolean {
  if (p.approved !== 1 || !p.consent_at || !parseScope(p.consent_scope).has("site")) return false;
  if (!PROOF_KINDS.includes(p.kind)) return false;
  if (proofTextProblem(`${p.body || ""} ${p.author_role || ""} ${p.company || ""}`)) return false;
  if (MEDIA_KINDS.includes(p.kind) && !safeMediaUrl(p.media_url)) return false;
  if (p.kind === "logo" && !(p.company && parseScope(p.consent_scope).has("company"))) return false;
  if (!MEDIA_KINDS.includes(p.kind) && !String(p.body || "").trim()) return false;
  return true;
}

/** "Kari, Founder · Bergen Dental" honouring the scope; "A client in dental" or "A client" otherwise. */
export function attribution(p: Pick<ProofRow, "author_name" | "author_role" | "company" | "industry" | "consent_scope">): string {
  const scope = parseScope(p.consent_scope);
  const name = scope.has("name") ? clip(p.author_name || "", 60) : "";
  const role = scope.has("name") ? clip(p.author_role || "", 60) : "";
  const company = scope.has("company") ? clip(p.company || "", 80) : "";
  const who = [name, role].filter(Boolean).join(", ");
  const line = [who, company].filter(Boolean).join(" · ");
  if (line) return line;
  const ind = getIndustry(p.industry);
  return ind ? `A client in ${ind.many}` : "A client";
}

export type ProofSlot = "landing" | "book";

/** Picks what to show: visitor's industry first, newest first. Pure. */
export function pickProof(items: ProofRow[], industry: string | null, slot: ProofSlot): ProofRow[] {
  const ok = items.filter(isRenderable);
  if (slot === "book") {
    // One short quote only: a calm line, never a wall.
    const quotes = ok.filter((p) => p.kind === "quote" && p.body.length <= 240);
    return sortFor(quotes, industry).slice(0, 1);
  }
  return sortFor(ok, industry).slice(0, 3);
}

function sortFor(items: ProofRow[], industry: string | null): ProofRow[] {
  return [...items].sort((a, b) => {
    const ia = industry && a.industry === industry ? 1 : 0, ib = industry && b.industry === industry ? 1 : 0;
    return ib - ia || b.updated_at - a.updated_at;
  });
}

function itemHtml(p: ProofRow): string {
  const by = `<figcaption>${escHtml(attribution(p))}</figcaption>`;
  const text = (s: string) => escHtml(clip(s, 600));
  switch (p.kind) {
    case "quote":
      return `<figure class="proof-item quote"><blockquote><p>${text(p.body)}</p></blockquote>${by}</figure>`;
    case "metric":
      return `<figure class="proof-item metric"><p class="proof-metric">${text(p.body)}</p>${by}<p class="proof-note">Reported by the client. Results depend on the business.</p></figure>`;
    case "build_log":
      return `<figure class="proof-item build"><p class="proof-kind">From a build log</p><p>${text(p.body)}</p>${by}</figure>`;
    case "screenshot": {
      const alt = p.body ? clip(p.body, 160) : `Screenshot from ${attribution(p)}`;
      return `<figure class="proof-item shot"><img src="${escHtml(safeMediaUrl(p.media_url))}" alt="${escHtml(alt)}" loading="lazy" decoding="async">${p.body ? `<p>${text(p.body)}</p>` : ""}${by}</figure>`;
    }
    case "logo":
      return `<figure class="proof-item logo"><img src="${escHtml(safeMediaUrl(p.media_url))}" alt="${escHtml(clip(p.company || "", 80))}" loading="lazy" decoding="async" height="28"></figure>`;
    case "video": {
      const url = safeMediaUrl(p.media_url);
      const ext = url.startsWith("https://");
      return `<figure class="proof-item video">${p.body ? `<p>${text(p.body)}</p>` : ""}<p><a href="${escHtml(url)}"${ext ? ' rel="noopener" target="_blank"' : ""}>Watch the video${ext ? '<span class="sr-only"> (opens in a new tab)</span>' : ""}</a></p>${by}</figure>`;
    }
  }
}

/**
 * HTML for the proof slot, or "" when nothing is approved and consented (the caller removes the section).
 * landing: up to three items in a calm row. book: one short quote as a single line.
 */
export function renderProof(items: ProofRow[], industry: string | null, slot: ProofSlot): string {
  const picked = pickProof(items, industry, slot);
  if (!picked.length) return "";
  if (slot === "book") {
    const p = picked[0];
    return `<span class="proof-q">&ldquo;${escHtml(clip(p.body, 240))}&rdquo;</span> <span class="proof-by">${escHtml(attribution(p))}</span>`;
  }
  return picked.map(itemHtml).join("");
}

// ── Data ─────────────────────────────────────────────────────────────────────

let cache: { at: number; rows: ProofRow[] } | null = null;

/** Approved rows with consent (cached per isolate for a minute). Rendering re-checks every rule. */
export async function liveProof(rt: Runtime): Promise<ProofRow[]> {
  if (cache && rt.now() - cache.at < 60_000) return cache.rows;
  let rows: ProofRow[] = [];
  try {
    rows = (await rt.env.DB.prepare("SELECT * FROM proof WHERE approved = 1 AND consent_at IS NOT NULL ORDER BY updated_at DESC LIMIT 50").all<ProofRow>()).results || [];
  } catch { rows = []; /* table missing before the migration: no proof */ }
  cache = { at: rt.now(), rows };
  return rows;
}

export function clearProofCache(): void { cache = null; }

export interface ProofInput {
  kind?: unknown; body?: unknown; author_name?: unknown; author_role?: unknown; company?: unknown; industry?: unknown;
  media_url?: unknown; consent_at?: unknown; consent_scope?: unknown; approved?: unknown; lead_id?: unknown;
}

export class ProofError extends Error {}

/** Validates admin input into a row patch. Throws ProofError with a message the admin can act on. */
export function cleanProofInput(b: ProofInput, existing: ProofRow | null, now: number): Omit<ProofRow, "id" | "created_at" | "source"> {
  const kind = String(b.kind ?? existing?.kind ?? "quote") as ProofKind;
  if (!PROOF_KINDS.includes(kind)) throw new ProofError("Unknown kind.");
  const str = (v: unknown, fb: string | null | undefined, max: number) => (v === undefined ? (fb ?? null) : clip(v, max) || null);
  const body = String(b.body === undefined ? existing?.body || "" : b.body).replace(/\r\n/g, "\n").trim().slice(0, 1200);
  const media = b.media_url === undefined ? existing?.media_url ?? null : safeMediaUrl(String(b.media_url || "")) || null;
  if (b.media_url !== undefined && String(b.media_url || "").trim() && !media) throw new ProofError("Media URL must start with https:// or /.");
  const industry = b.industry === undefined ? existing?.industry ?? null : (getIndustry(String(b.industry || ""))?.id ?? null);
  const scope = b.consent_scope === undefined ? existing?.consent_scope ?? null : cleanScope(b.consent_scope) || null;
  let consentAt = existing?.consent_at ?? null;
  if (b.consent_at !== undefined) {
    const v = b.consent_at;
    if (v === null || v === "" || v === false) consentAt = null;
    else {
      const t = typeof v === "number" ? v : Date.parse(String(v));
      if (!Number.isFinite(t) || t > now + 86_400_000) throw new ProofError("Consent date is not a valid date.");
      consentAt = t;
    }
  }
  const approved = b.approved === undefined ? existing?.approved ?? 0 : b.approved === true || b.approved === 1 || b.approved === "1" ? 1 : 0;
  if (approved && (!consentAt || !parseScope(scope).has("site"))) throw new ProofError("Record the person's consent (date and the website scope) before approving.");
  const problem = proofTextProblem(body);
  if (approved && problem) throw new ProofError(`This text ${problem}. Edit it with the client before approving.`);
  const leadId = b.lead_id === undefined ? existing?.lead_id ?? null : (/^l[0-9a-z]{19}$/.test(String(b.lead_id || "")) ? String(b.lead_id) : null);
  return {
    kind, body,
    author_name: str(b.author_name, existing?.author_name, 60),
    author_role: str(b.author_role, existing?.author_role, 60),
    company: str(b.company, existing?.company, 80),
    industry, media_url: media, consent_at: consentAt, consent_scope: scope, approved, lead_id: leadId, updated_at: now,
  };
}

export async function getProof(rt: Runtime, id: string): Promise<ProofRow | null> {
  return rt.env.DB.prepare("SELECT * FROM proof WHERE id = ?").bind(id).first<ProofRow>();
}

export async function saveProof(rt: Runtime, id: string | null, b: ProofInput, source = "admin"): Promise<ProofRow> {
  const now = rt.now();
  const existing = id ? await getProof(rt, id) : null;
  if (id && !existing) throw new ProofError("Not found.");
  const row = cleanProofInput(b, existing, now);
  const pid = existing?.id || newId("p");
  await rt.env.DB.prepare(
    `INSERT INTO proof (id, kind, body, author_name, author_role, company, industry, media_url, consent_at, consent_scope, approved, lead_id, source, created_at, updated_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
     ON CONFLICT(id) DO UPDATE SET kind=excluded.kind, body=excluded.body, author_name=excluded.author_name, author_role=excluded.author_role,
       company=excluded.company, industry=excluded.industry, media_url=excluded.media_url, consent_at=excluded.consent_at,
       consent_scope=excluded.consent_scope, approved=excluded.approved, lead_id=excluded.lead_id, updated_at=excluded.updated_at`,
  ).bind(pid, row.kind, row.body, row.author_name, row.author_role, row.company, row.industry, row.media_url, row.consent_at, row.consent_scope,
    row.approved, row.lead_id, existing?.source || source, existing?.created_at || now, now).run();
  clearProofCache();
  return (await getProof(rt, pid))!;
}

export async function listProof(rt: Runtime): Promise<Array<ProofRow & { renderable: boolean; problem: string | null; lead_name: string | null }>> {
  const rows = (await rt.env.DB.prepare(
    "SELECT p.*, l.first_name AS lead_name FROM proof p LEFT JOIN leads l ON l.id = p.lead_id ORDER BY p.approved ASC, p.updated_at DESC LIMIT 300",
  ).all<ProofRow & { lead_name: string | null }>()).results || [];
  return rows.map((r) => ({ ...r, renderable: isRenderable(r), problem: proofTextProblem(r.body || "") }));
}

export async function deleteProof(rt: Runtime, id: string): Promise<void> {
  await rt.env.DB.prepare("DELETE FROM proof WHERE id = ?").bind(id).run();
  clearProofCache();
}
