// On-page behaviour from the deep beacon: what people click, where the form gets hard, where they
// leave, what they re-read, highlight and copy (counts only, never the text), and which FAQs they open.

import type { Runtime } from "../app";
import { APPLICATION, FAQS } from "../config";
import { all, num, pct, visitorDims, type Filters } from "./stats";

/** Section / field / target names come from the browser: keep them short and boring. */
export function cleanName(v: unknown, max = 48): string {
  const s = String(v ?? "").replace(/[^\p{L}\p{N} _./#:-]/gu, "").replace(/\s+/g, " ").trim();
  return s.slice(0, max) || "(unknown)";
}

const J = (k: string) => `json_extract(e.props, '$.${k}')`;

export async function behaviourReport(rt: Runtime, f: Filters) {
  const vd = visitorDims(f, "e.visitor_id");
  const base = (names: string[]) => `FROM events e WHERE e.name IN (${names.map(() => "?").join(",")}) AND e.is_bot = 0 AND e.ts >= ?${vd.sql}`;
  const b = (names: string[]) => [...names, f.since, ...vd.binds];
  const section = `COALESCE(${J("section")}, ${J("s")})`;
  const [clicks, rage, fields, exits, revisits, dwell, highlights, faqs, summary] = await Promise.all([
    all<{ target: string; page: string; n: number; visitors: number }>(rt,
      `SELECT COALESCE(${J("target")}, ${J("id")}, ${J("label")}, ${J("el")}, e.name) AS target, COALESCE(e.path, '/') AS page, COUNT(*) AS n, COUNT(DISTINCT e.visitor_id) AS visitors
       ${base(["click", "cta_click"])} GROUP BY target, page ORDER BY n DESC LIMIT 40`, b(["click", "cta_click"])),
    all<{ target: string; n: number }>(rt,
      `SELECT COALESCE(${J("target")}, ${J("id")}, ${J("el")}, '(unknown)') AS target, COUNT(*) AS n ${base(["rage_click"])} GROUP BY target ORDER BY n DESC LIMIT 15`, b(["rage_click"])),
    all<{ field: string; n: number; ms: number; corrections: number; pasted: number; empty: number }>(rt,
      `SELECT COALESCE(${J("field")}, ${J("name")}, ${J("id")}) AS field, COUNT(*) AS n,
         AVG(COALESCE(${J("ms")}, ${J("time_ms")}, 0)) AS ms,
         AVG(COALESCE(${J("corrections")}, ${J("backspaces")}, 0)) AS corrections,
         SUM(COALESCE(${J("pasted")}, ${J("paste")}, 0) > 0) AS pasted,
         SUM(COALESCE(${J("empty")}, ${J("left_empty")}, 0) > 0) AS empty
       ${base(["field_interaction"])} GROUP BY field ORDER BY n DESC LIMIT 40`, b(["field_interaction"])),
    all<{ section: string; n: number }>(rt, `SELECT ${section} AS section, COUNT(*) AS n ${base(["page_exit"])} GROUP BY section ORDER BY n DESC LIMIT 30`, b(["page_exit"])),
    all<{ section: string; n: number; visitors: number }>(rt, `SELECT ${section} AS section, COUNT(*) AS n, COUNT(DISTINCT e.visitor_id) AS visitors ${base(["section_revisit"])} GROUP BY section ORDER BY n DESC LIMIT 30`, b(["section_revisit"])),
    all<{ section: string; n: number; ms: number }>(rt, `SELECT ${section} AS section, COUNT(*) AS n, AVG(COALESCE(${J("ms")}, 0)) AS ms ${base(["section_dwell"])} GROUP BY section ORDER BY ms DESC LIMIT 30`, b(["section_dwell"])),
    all<{ section: string; name: string; n: number }>(rt, `SELECT ${section} AS section, e.name AS name, COUNT(*) AS n ${base(["text_select", "text_copy"])} GROUP BY section, e.name`, b(["text_select", "text_copy"])),
    all<{ faq_id: string; n: number; visitors: number }>(rt, `SELECT ${J("id")} AS faq_id, COUNT(*) AS n, COUNT(DISTINCT e.visitor_id) AS visitors ${base(["faq_open"])} GROUP BY faq_id`, b(["faq_open"])),
    all<{ name: string; n: number; visitors: number }>(rt,
      `SELECT e.name, COUNT(*) AS n, COUNT(DISTINCT e.visitor_id) AS visitors ${base(["cta_hover", "tab_return", "exit_intent", "rage_click", "text_select", "text_copy", "section_revisit", "faq_open", "app_back"])} GROUP BY e.name`,
      b(["cta_hover", "tab_return", "exit_intent", "rage_click", "text_select", "text_copy", "section_revisit", "faq_open", "app_back"])),
  ]);
  const fieldLabel = (id: string) => {
    const q = APPLICATION.find((x) => x.id === id);
    if (q) return q.title;
    const contact: Record<string, string> = { first_name: "First name", last_name: "Last name", name: "Name", email: "Email", phone: "Phone" };
    return contact[id] || id;
  };
  const hl = new Map<string, { section: string; selects: number; copies: number }>();
  for (const r of highlights) {
    const s = cleanName(r.section);
    const cur = hl.get(s) || { section: s, selects: 0, copies: 0 };
    if (r.name === "text_select") cur.selects += num(r.n);
    else cur.copies += num(r.n);
    hl.set(s, cur);
  }
  const faqRows = FAQS.map((fq) => {
    const r = faqs.find((x) => String(x.faq_id) === fq.id);
    return { id: fq.id, question: fq.q, opens: num(r?.n), visitors: num(r?.visitors) };
  }).sort((a, b2) => b2.opens - a.opens);
  const totalExits = exits.reduce((s, r) => s + num(r.n), 0);
  const S = Object.fromEntries(summary.map((r) => [r.name, { n: num(r.n), visitors: num(r.visitors) }]));
  return {
    summary: S,
    clicks: clicks.map((r) => ({ target: cleanName(r.target, 60), path: cleanName(r.page, 60), n: num(r.n), visitors: num(r.visitors) })),
    rage_clicks: rage.map((r) => ({ target: cleanName(r.target, 60), n: num(r.n) })),
    fields: fields.filter((r) => r.field != null).map((r) => {
      const id = cleanName(r.field, 40);
      return {
        field: id, label: fieldLabel(id), interactions: num(r.n), avg_seconds: Math.round(num(r.ms) / 100) / 10,
        avg_corrections: Math.round(num(r.corrections) * 10) / 10, pasted: num(r.pasted), left_empty: num(r.empty),
        empty_rate: pct(num(r.empty), num(r.n)),
      };
    }),
    exits: exits.map((r) => ({ section: cleanName(r.section), n: num(r.n), pct: pct(num(r.n), totalExits) })),
    revisits: revisits.map((r) => ({ section: cleanName(r.section), n: num(r.n), visitors: num(r.visitors) })),
    dwell: dwell.map((r) => ({ section: cleanName(r.section), n: num(r.n), avg_seconds: Math.round(num(r.ms) / 100) / 10 })),
    highlights: [...hl.values()].sort((a, b2) => b2.selects + b2.copies - (a.selects + a.copies)),
    faqs: faqRows,
  };
}
