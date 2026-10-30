import type { Env } from "../util";
import { parseList } from "../util";
import { loadProfile } from "../feeds";
import { analyseWithClaude } from "./claude";
import {
  tokens,
  bestEvidence, clarifications, extractRequirements, findDeadline, findReference, findStandards, scorecard,
  type ExtractedReq, type LibraryItem, type Scorecard,
} from "./rules";

export interface Analysis {
  summary: string;
  scope: string[];
  risks: string[];
  clarifications: string[];
  scorecard: Omit<Scorecard, "missing_certifications">;
  missing_certifications: string[];
  cover_letter: string;
  note?: string;
}

export async function loadLibrary(db: D1Database): Promise<LibraryItem[]> {
  const { results } = await db.prepare("SELECT id, title, category, tags, body, expires_at FROM library").all<Record<string, unknown>>();
  return results.map((r) => ({
    id: Number(r.id), title: String(r.title), category: String(r.category), tags: parseList(r.tags as string),
    body: String(r.body), expires_at: (r.expires_at as string) ?? null,
  }));
}

/** Read an RFQ and (re)build its compliance matrix and bid pack. */
export async function analyseRfq(env: Env, rfqId: number, opts: { pdfBase64?: string } = {}): Promise<{ by: "claude" | "rules"; requirements: number }> {
  const rfq = await env.DB.prepare("SELECT * FROM rfqs WHERE id = ?").bind(rfqId).first<Record<string, unknown>>();
  if (!rfq) throw new Error("RFQ not found");
  const text = String(rfq.source_text ?? "");
  if (!text.trim() && !opts.pdfBase64) throw new Error("Paste the RFQ text or upload the PDF first");

  const profile = await loadProfile(env.DB);
  const lib = await loadLibrary(env.DB);
  const now = Date.now();
  const evidencedStandards = [...new Set(lib.flatMap((l) => findStandards(`${l.title} ${l.tags.join(" ")} ${l.body}`)))];
  const profileForCard = { ...profile, evidencedStandards };

  let by: "claude" | "rules" = "rules";
  let reqs: ExtractedReq[];
  let deadline: string | null;
  let analysis: Analysis;
  const meta: { title?: string; client?: string; reference?: string } = {};
  let note: string | undefined;
  let foundBy: string[] = [];

  if (env.ANTHROPIC_API_KEY) {
    try {
      const c = await analyseWithClaude(env.ANTHROPIC_API_KEY, {
        text, pdfBase64: opts.pdfBase64, profile, libraryTitles: lib.map((l) => l.title), today: new Date(now).toISOString().slice(0, 10),
      });
      by = "claude";
      reqs = c.requirements.map((r) => ({ ...r, standards: [...new Set([...r.standards.map((s) => s.toUpperCase()), ...findStandards(r.text)])] }));
      foundBy = reqs.map(() => "claude");
      // Second pass: the rule reader catches obligations a single model pass can miss.
      if (text.trim()) {
        const extra = missedByFirstPass(reqs, extractRequirements(text));
        for (const r of extra) { reqs.push(r); foundBy.push("rules-only"); }
        if (extra.length) note = `${extra.length} requirement(s) were found only by the second-pass rule reader. They are flagged in the matrix: check them.`;
      }
      deadline = c.deadline;
      Object.assign(meta, { title: c.title, client: c.client, reference: c.reference });
      const rulesCard = scorecard(reqs, 0, profileForCard, text || reqs.map((r) => r.text).join("\n"), deadline, now);
      analysis = {
        summary: c.summary, scope: c.scope, risks: c.risks, clarifications: c.clarifications,
        scorecard: c.scorecard as Analysis["scorecard"], missing_certifications: rulesCard.missing_certifications, cover_letter: c.cover_letter,
      };
    } catch (e) {
      note = `Claude reader unavailable (${String((e as Error).message).slice(0, 120)}); used the rule reader.`;
      if (!text.trim()) throw new Error("This PDF needs the Claude reader. Paste the text instead, or check the API key.");
    }
  } else if (!text.trim()) {
    throw new Error("PDF reading needs ANTHROPIC_API_KEY. Paste the RFQ text instead.");
  }

  // Evidence from the answer library, for both readers.
  if (by === "rules") {
    reqs = extractRequirements(text);
    foundBy = reqs.map(() => "rules");
    deadline = findDeadline(text);
    meta.reference = findReference(text);
  }
  const evidence = reqs!.map((r) => bestEvidence(r, lib));
  const matched = evidence.filter(Boolean).length;

  if (by === "rules") {
    const card = scorecard(reqs!, matched, profileForCard, text, deadline!, now);
    const { missing_certifications, ...sc } = card;
    analysis = {
      summary: `${reqs!.length} requirements found by the rule reader (${reqs!.filter((r) => r.mandatory).length} mandatory). Add an Anthropic key for a full summary, risks and a cover letter draft.`,
      scope: [], risks: [], clarifications: clarifications(reqs!, deadline!), scorecard: sc, missing_certifications, cover_letter: "",
    };
  } else {
    analysis!.scorecard.compliance = reqs!.length ? Math.round((matched / reqs!.length) * 100) : analysis!.scorecard.compliance;
  }
  if (note) analysis!.note = note;

  const stmts = [env.DB.prepare("DELETE FROM requirements WHERE rfq_id = ?").bind(rfqId)];
  reqs!.forEach((r, i) => {
    const ev = evidence[i];
    stmts.push(
      env.DB.prepare(
        "INSERT INTO requirements (rfq_id, seq, clause, text, category, mandatory, standards, evidence_id, response, found_by) VALUES (?,?,?,?,?,?,?,?,?,?)",
      ).bind(rfqId, i + 1, r.clause, r.text, r.category, r.mandatory ? 1 : 0, JSON.stringify(r.standards), ev?.item.id ?? null, ev ? `Draft from library: ${ev.item.title}` : "", foundBy[i] ?? "rules"),
    );
  });
  stmts.push(
    env.DB.prepare(
      `UPDATE rfqs SET analysis = ?, analysed_by = ?, deadline_at = COALESCE(deadline_at, ?),
         title = CASE WHEN title = 'Untitled RFQ' AND ? <> '' THEN ? ELSE title END,
         client = CASE WHEN client = '' THEN ? ELSE client END,
         reference = CASE WHEN reference = '' THEN ? ELSE reference END,
         updated_at = datetime('now') WHERE id = ?`,
    ).bind(JSON.stringify(analysis!), by, deadline!, meta.title ?? "", meta.title ?? "", meta.client ?? "", meta.reference ?? "", rfqId),
  );
  for (let i = 0; i < stmts.length; i += 80) await env.DB.batch(stmts.slice(i, i + 80));
  return { by, requirements: reqs!.length };
}

/** Rule-found requirements with no close match among the first pass (by shared words or standards). */
export function missedByFirstPass(first: ExtractedReq[], second: ExtractedReq[]): ExtractedReq[] {
  const firstTok = first.map((r) => tokens(r.text));
  return second.filter((r) => {
    const t = tokens(r.text);
    if (t.size < 3) return false;
    return !first.some((f, i) => {
      if (r.standards.length && r.standards.every((s) => f.standards.includes(s)) && (!r.clause || r.clause === f.clause)) return true;
      // Different standards cited means a different obligation, however similar the wording.
      if (r.standards.length && f.standards.length && !r.standards.some((s) => f.standards.includes(s))) return false;
      let shared = 0;
      for (const w of t) if (firstTok[i].has(w)) shared++;
      return shared / t.size >= 0.6;
    });
  });
}
