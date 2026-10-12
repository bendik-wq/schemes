// Behaviour profile: turns what a lead did into facts. A fact may carry a `you` line that is safe
// to say to their face; BACKGROUND facts help the model understand the lead but are never said back.

import type { Runtime } from "../app";
import { FAQS, VIDEOS } from "../config";
import { getIndustry, getAngle } from "../landers/catalog";
import { buildDossier } from "../followup/dossier";
import type { Lead } from "../funnel/leads";
import { bucketSet } from "../tracking/vsl";

export interface Fact {
  key: string;
  /** Description for the model (never quoted verbatim to the lead). */
  text: string;
  weight: number;
  topics: string[];
  /** A line that is safe to say to the lead, or undefined. */
  you?: string;
}

/** Facts that are never said back to the lead (would feel like surveillance). */
export const BACKGROUND = new Set([
  "lander", "tabs", "cta_hesitate", "selected", "exit_section", "field_struggle", "copied", "devices", "engaged",
  "speed", "e_silent", "exit", "skip", "pause", "a_slowest", "a_backs", "resources",
]);

/** Facts that restate application answers (skipped for templates that already quote the application). */
export const ANSWER_FACTS = new Set(["a_business", "a_goal", "a_timeline", "a_blockers", "a_spend", "a_revenue", "a_why", "a_readiness", "industry"]);

interface EventRow { name: string; ts: number; props: string | null; path: string | null; }

function props(r: EventRow): Record<string, unknown> {
  try { return r.props ? JSON.parse(r.props) : {}; } catch { return {}; }
}

export async function buildProfile(rt: Runtime, lead: Lead): Promise<Fact[]> {
  const facts: Fact[] = [];
  const add = (f: Fact) => { if (!facts.some((x) => x.key === f.key)) facts.push(f); };
  const d = buildDossier(lead);
  const db = rt.env.DB;

  const evs = ((await db.prepare(
    "SELECT name, ts, props, path FROM events WHERE lead_id = ? OR (visitor_id = ? AND visitor_id IS NOT NULL) ORDER BY ts DESC LIMIT 800",
  ).bind(lead.id, lead.visitor_id || "").all<EventRow>()).results || []);
  const by = (n: string) => evs.filter((e) => e.name === n);

  // Where they came in.
  if (lead.lander) {
    const [ind, ang] = lead.lander.split("/");
    const i = getIndustry(ind), a = getAngle(ang);
    add({ key: "lander", text: `Arrived on the ${i?.label || ind} page${a ? ` (${a.label} angle)` : ""}.`, weight: 2, topics: ["industry"] });
  }
  if (d.industry) add({ key: "industry", text: `Industry: ${d.industry.label}.`, weight: 3, topics: ["industry"], you: `I know how ${d.industry.many} tend to end up renting ${d.industry.rent}.` });

  // Visits.
  const sessions = await db.prepare("SELECT COUNT(*) AS n, COUNT(DISTINCT device) AS devices FROM sessions WHERE lead_id = ? OR visitor_id = ?").bind(lead.id, lead.visitor_id || "").first<{ n: number; devices: number }>();
  if ((sessions?.n || 0) >= 3) add({ key: "visits", text: `Visited ${sessions?.n} times.`, weight: 3, topics: ["call", "booking"] });
  if ((sessions?.devices || 0) >= 2) add({ key: "devices", text: "Used more than one device.", weight: 1, topics: [] });

  // VSL.
  const vv = await db.prepare("SELECT video, buckets, completed, unmuted, max_position FROM vsl_views WHERE lead_id = ? OR visitor_id = ?").bind(lead.id, lead.visitor_id || "")
    .all<{ video: string; buckets: string; completed: number; unmuted: number; max_position: number }>();
  for (const v of vv.results || []) {
    const cfg = VIDEOS[v.video as keyof typeof VIDEOS];
    if (!cfg) continue;
    const watched: string[] = [];
    cfg.chapters.forEach((ch, idx) => {
      const end = cfg.chapters[idx + 1]?.at ?? cfg.duration;
      if (end - ch.at < 5 || cfg.duration <= 0) return;
      const from = Math.floor((ch.at / cfg.duration) * 100), to = Math.min(99, Math.floor((end / cfg.duration) * 100));
      let hit = 0, total = 0;
      for (let b = from; b <= to; b++) { total++; if (bucketSet(v.buckets, b)) hit++; }
      if (total && hit / total >= 0.6) watched.push(ch.label);
    });
    if (v.video === "main" && watched.length) {
      add({ key: "vsl_chapters", text: `Watched these parts of the main film: ${watched.join("; ")}.`, weight: 3, topics: ["offer"] });
      if (watched.includes("The offer and guarantee")) add({ key: "vsl_offer", text: "Watched the offer and guarantee section.", weight: 3, topics: ["guarantee", "offer"] });
    }
    if (v.video === "breakout" && v.completed) add({ key: "breakout_done", text: "Finished the breakout video.", weight: 3, topics: ["price", "time", "call"] });
    if (v.video === "main" && !v.completed && v.unmuted && v.max_position > 30) add({ key: "vsl_stop", text: `Stopped the main film around ${Math.round(v.max_position / 60)} minutes.`, weight: 1, topics: [] });
  }
  if (by("vsl_rewatch").length) add({ key: "rewatch", text: "Rewatched part of the film.", weight: 2, topics: ["offer"] });
  if (by("vsl_skip").length) add({ key: "skip", text: "Skipped ahead in the film.", weight: 1, topics: [] });
  if (by("vsl_pause").length > 2) add({ key: "pause", text: "Paused the film several times.", weight: 1, topics: [] });
  if (by("vsl_speed").length) add({ key: "speed", text: "Changed playback speed.", weight: 1, topics: [] });

  // FAQ opens: only questions that really exist in FAQS (beacon text is never trusted).
  const faqIds = new Set(by("faq_open").map((e) => String(props(e).id || "")).filter(Boolean));
  for (const f of FAQS) {
    if (!faqIds.has(f.id)) continue;
    add({ key: `faq_${f.id}`, text: `Opened the FAQ "${f.q}".`, weight: 3, topics: f.topics, you: `A question founders often ask at this stage: ${f.q.replace(/\?$/, "").toLowerCase()}.` });
  }

  // Sections.
  const dwell = by("section_dwell").map(props);
  const guaranteeMs = dwell.filter((p) => p.section === "guarantee").reduce((s, p) => s + (Number(p.ms) || 0), 0);
  if (guaranteeMs > 8000 || by("section_revisit").some((e) => props(e).section === "guarantee")) add({ key: "guarantee_read", text: "Spent time on the guarantee section.", weight: 3, topics: ["guarantee"] });
  if (by("text_select").length) add({ key: "selected", text: "Highlighted text on the page.", weight: 1, topics: [] });
  if (by("text_copy").length) add({ key: "copied", text: "Copied text from the page.", weight: 1, topics: [] });
  const exit = by("page_exit")[0];
  if (exit && props(exit).section) add({ key: "exit_section", text: `Last left the page at the ${String(props(exit).section).replace(/[^a-z_]/gi, "")} section.`, weight: 1, topics: [] });
  if (by("cta_hover").length >= 3 && !lead.app_completed_at) add({ key: "cta_hesitate", text: "Hovered the apply button several times without clicking.", weight: 2, topics: [] });
  if (by("tab_return").length >= 2) add({ key: "tabs", text: "Switched away and came back several times.", weight: 1, topics: [] });
  const eng = await db.prepare("SELECT MAX(engaged_ms) AS ms FROM sessions WHERE lead_id = ? OR visitor_id = ?").bind(lead.id, lead.visitor_id || "").first<{ ms: number }>();
  if ((eng?.ms || 0) > 5 * 60_000) add({ key: "engaged", text: `Spent ${Math.round((eng?.ms || 0) / 60_000)} minutes engaged in one visit.`, weight: 1, topics: [] });

  // Application behaviour.
  const fields = by("field_interaction").map(props);
  if (fields.some((p) => Number(p.corrections) > 3 || Number(p.ms) > 60_000)) add({ key: "field_struggle", text: "Took a long time or many corrections on a form field.", weight: 1, topics: [] });
  if (by("app_back").length) add({ key: "a_backs", text: "Went back to change an answer.", weight: 1, topics: [] });
  if (d.business) add({ key: "a_business", text: "Business description given in the application.", weight: 2, topics: ["industry"] });
  if (d.goal) add({ key: "a_goal", text: `Goal: ${d.goal.label}.`, weight: 3, topics: ["goal"], you: `You said what matters most right now is ${d.goal.label.toLowerCase()}.` });
  if (d.timeline) add({ key: "a_timeline", text: `Timeline: ${d.timeline.label}.`, weight: 2, topics: ["time"] });
  if (d.blockers.length) add({ key: "a_blockers", text: `Blockers: ${d.blockers.map((b) => b.label).join(", ")}.`, weight: 3, topics: ["blocker"], you: `You mentioned ${d.blockers[0].label.toLowerCase()} as something that held you back.` });
  if (d.spend) add({ key: "a_spend", text: `Spends ${d.spend.label} a year on agencies, freelancers and software.`, weight: 2, topics: ["numbers", "agency"] });
  if (d.revenue) add({ key: "a_revenue", text: `Revenue band: ${d.revenue.label}.`, weight: 1, topics: ["numbers"] });
  if (d.readiness) add({ key: "a_readiness", text: `Readiness: ${d.readiness.label}.`, weight: 2, topics: ["call"] });
  if (d.whyNow) add({ key: "a_why", text: "Wrote a why-now answer in the application.", weight: 2, topics: ["why_now"] });

  // Booking behaviour.
  if (by("booking_date_selected").length && !lead.call_at) add({ key: "booking_picked", text: "Picked a date on the calendar but did not confirm.", weight: 3, topics: ["booking"], you: "If the calendar gave you trouble, reply and I will find a time with you." });

  // Email engagement.
  const em = await db.prepare("SELECT SUM(opens > 0) AS opened, SUM(clicks > 0) AS clicked, COUNT(*) AS n FROM emails WHERE lead_id = ? AND status IN ('sent','simulated')").bind(lead.id).first<{ opened: number; clicked: number; n: number }>();
  if ((em?.n || 0) >= 4 && !(em?.opened)) add({ key: "e_silent", text: "Has not opened recent emails.", weight: 1, topics: [] });
  if ((em?.clicked || 0) >= 2) add({ key: "e_clicks", text: "Clicked links in several emails.", weight: 2, topics: ["call"] });

  // AI calls.
  const call = await db.prepare("SELECT structured, summary FROM voice_calls WHERE lead_id = ? ORDER BY created_at DESC LIMIT 1").bind(lead.id).first<{ structured: string | null; summary: string | null }>();
  if (call?.structured) {
    try {
      const s = JSON.parse(call.structured);
      if (s.reached_voicemail) add({ key: "call_vm", text: "Our assistant reached voicemail.", weight: 1, topics: [] });
      else add({ key: "call_spoke", text: "Spoke briefly with our AI assistant.", weight: 2, topics: ["call"], you: "Thanks for taking the call from Sam, our assistant." });
    } catch { /* ignore */ }
  }
  return facts.sort((a, b) => b.weight - a.weight);
}
