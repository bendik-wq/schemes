// Server-rendered funnel pages: static templates in public/ filled with HTMLRewriter.
// The page view is written server-side before the HTML is returned.

import type { Ctx, Runtime } from "../app";
import {
  APPLICATION, BRAND, BREAKOUT, CALL_CONSENT, FAQS, HEADLINES, LANDING, RESOURCES, VIDEOS, type Faq, type VideoId,
} from "../config";
import { resolveIdentity, setLanderCookie, setVariantCookie, type Identity } from "../lib/identity";
import { escHtml } from "../lib/text";
import { track, whoFromIdentity } from "../tracking/track";
import { hasRevealed, resumePosition } from "../tracking/vsl";
import { getLead, effectiveTier, type Lead } from "./leads";
import { bookingUrlFor } from "./routing";
import { getRep } from "../sales/reps";
import { formatCallTime, leadTimezone } from "../integrations/email";
import { waLink } from "../integrations/whatsapp";
import { getAngle, getIndustry, inferIndustry, type Angle, type Industry } from "../landers/catalog";
import { armStats, chooseAngle } from "../landers/bandit";

export interface Fill {
  title?: string;
  text?: Record<string, string>;
  html?: Record<string, string>;
  attrs?: Array<{ sel: string; attr: string; value: string }>;
  remove?: string[];
  cfg?: Record<string, unknown>;
  bodyClass?: string;
}

export function safeJson(v: unknown): string {
  return JSON.stringify(v).replace(/</g, "\\u003c").replace(/>/g, "\\u003e").replace(/&/g, "\\u0026").replace(/\u2028/g, "\\u2028").replace(/\u2029/g, "\\u2029");
}

export async function renderTemplate(c: Ctx, file: string, fill: Fill, status = 200): Promise<Response> {
  const res = await c.env.ASSETS.fetch(new Request(new URL(`/${file}`, c.req.url).toString()));
  if (!res.ok) return c.text("Template missing", 500);
  const rw = new HTMLRewriter();
  if (fill.title) rw.on("title", { element(el) { el.setInnerContent(fill.title as string); } });
  if (fill.bodyClass) rw.on("body", { element(el) { el.setAttribute("class", `${el.getAttribute("class") || ""} ${fill.bodyClass}`.trim()); } });
  rw.on("[data-slot]", {
    element(el) {
      const k = el.getAttribute("data-slot") || "";
      if (fill.text && k in fill.text) el.setInnerContent(fill.text[k]);
      else if (fill.html && k in fill.html) el.setInnerContent(fill.html[k], { html: true });
    },
  });
  for (const a of fill.attrs || []) rw.on(a.sel, { element(el) { el.setAttribute(a.attr, a.value); } });
  for (const sel of fill.remove || []) rw.on(sel, { element(el) { el.remove(); } });
  if (fill.cfg) rw.on("script#op-cfg", { element(el) { el.setInnerContent(safeJson(fill.cfg), { html: true }); } });
  const out = rw.transform(new Response(res.body, { status, headers: { "content-type": "text/html; charset=utf-8" } }));
  // c.newResponse keeps the cookies queued on the context (visitor, session, variant, lander, fbp/fbc).
  return c.newResponse(out.body, status as 200, { "content-type": "text/html; charset=utf-8", "cache-control": "private, no-store" });
}

// ── Shared pieces ─────────────────────────────────────────────────────────────

function faqHtml(faqs: Faq[]): string {
  return faqs.map((f) => `<details class="faq" data-faq="${escHtml(f.id)}"><summary>${escHtml(f.q)}</summary><p>${escHtml(f.a)}</p></details>`).join("");
}

function figuresHtml(): string {
  return LANDING.figures.map((f) => `<div class="fig"><div class="fig-v">${escHtml(f.value)}<span>${escHtml(f.unit)}</span></div><p>${escHtml(f.label)}</p></div>`).join("");
}

// Static mini interfaces that show each deliverable (trusted markup, no lead data).
const TILE_UI: Record<string, string> = {
  pages: `<div aria-hidden="true" class="tile-ui ui-browser"><div class="chrome"><i></i><i></i><i></i></div><div class="l h"></div><div class="l h2"></div><div class="l s"></div><div class="pill"></div></div>`,
  tracking: `<div aria-hidden="true" class="tile-ui ui-rows"><div><b>Lead</b><span class="ok">server · deduped</span></div><div><b>QualifiedLead</b><span class="val">value 3,000</span></div><div><b>Schedule</b><span class="ok">matched 8/9 keys</span></div><div><b>Purchase</b><span class="val">value 30,000</span></div></div>`,
  dashboard: `<div aria-hidden="true" class="tile-ui ui-dash"><div class="k"><span>Applied</span><b>48</b></div><div class="k"><span>Show rate</span><b>82%</b></div><div class="k"><span>Cash</span><b>$90k</b></div><div class="bars"><i style="height:30%"></i><i style="height:42%"></i><i style="height:38%"></i><i style="height:55%"></i><i style="height:48%"></i><i class="on" style="height:72%"></i><i class="on" style="height:88%"></i></div></div>`,
  followup: `<div aria-hidden="true" class="tile-ui ui-rows"><div><b>I read your application</b><span>2h</span></div><div><b>About the agency retainer</b><span>1d</span></div><div><b>What we would build first</b><span>2d</span></div><div><b>Your call is tomorrow</b><span>24h</span></div></div>`,
  tools: `<div aria-hidden="true" class="tile-ui ui-term"><div><span class="p">~/ops $</span> claude</div><div><span class="pr">›</span> build a quote tool from our price sheet</div><div class="ok">✓ quote.ts created</div><div class="ok">✓ deployed to tools.yourdomain.com</div></div>`,
  skills: `<div aria-hidden="true" class="tile-ui ui-team"><div class="row"><span class="av">AL</span><span class="meter"><i style="width:86%"></i></span></div><div class="row"><span class="av">JM</span><span class="meter"><i style="width:64%"></i></span></div><div class="row"><span class="av">SK</span><span class="meter"><i style="width:48%"></i></span></div></div>`,
};

function systemHtml(): string {
  return LANDING.system.map((s) => `<article class="tile" data-tile="${escHtml(s.key)}">${TILE_UI[s.key] || `<div class="tile-ui" aria-hidden="true"></div>`}<h3>${escHtml(s.title)}</h3><p>${escHtml(s.body)}</p></article>`).join("");
}

function weeksHtml(): string {
  return LANDING.weeks.map((w) => `<li><span class="wk">${escHtml(w.label)}</span><div><h3>${escHtml(w.title)}</h3><p>${escHtml(w.body)}</p></div></li>`).join("");
}

function fitHtml(): string {
  const li = (arr: string[]) => arr.map((x) => `<li>${escHtml(x)}</li>`).join("");
  return `<div class="fit-col yes"><h3>A fit if</h3><ul>${li(LANDING.fit.yes)}</ul></div><div class="fit-col no"><h3>Not a fit if</h3><ul>${li(LANDING.fit.no)}</ul></div>`;
}

function videoCfg(rt: Runtime, id: VideoId, resume: number) {
  const key = id === "main" ? "VSL_MAIN" : id === "breakout" ? "VSL_BREAKOUT" : "VSL_PRECALL";
  const src = rt.settings.get(`${key}_SRC`);
  const poster = rt.settings.get(`${key}_POSTER`);
  const safe = (u: string) => (/^(https:\/\/|\/)[^\s"'<>]*$/.test(u) ? u : "");
  const v = VIDEOS[id];
  return { id, src: safe(src), poster: safe(poster), ctaRevealAt: v.ctaRevealAt, duration: v.duration, resume, chapters: v.chapters.map((c) => ({ at: c.at, label: c.label })) };
}

function commonCfg(rt: Runtime, id: Identity, page: string, pv: string | null) {
  const s = rt.settings;
  return {
    page,
    pv,
    consentRequired: id.consentRequired,
    consent: id.consent,
    // Ids only; f.js loads nothing until consent allows it (replay always needs an explicit yes).
    pixel: s.has("META_PIXEL_ID") ? s.get("META_PIXEL_ID") : null,
    replay: s.bool("POSTHOG_SESSION_REPLAY") && s.has("POSTHOG_KEY") ? { key: s.get("POSTHOG_KEY") } : null,
  };
}

async function pageView(c: Ctx, id: Identity, path: string, props: Record<string, unknown> = {}, preview = false): Promise<string | null> {
  if (id.isPrefetch || preview) return null;
  const rt = c.get("rt");
  const pv = await track(rt, whoFromIdentity(id, path, c.req.url), { name: "page_view", props });
  await rt.env.DB.batch([
    rt.env.DB.prepare("UPDATE sessions SET pageviews = pageviews + 1, last_seen_at = ?, variant = COALESCE(variant, ?), lander = COALESCE(lander, ?) WHERE id = ?")
      .bind(rt.now(), id.variant, id.lander, id.sessionId),
    rt.env.DB.prepare("UPDATE visitors SET pageviews = pageviews + 1, last_seen_at = ? WHERE id = ?").bind(rt.now(), id.visitorId),
  ]);
  return pv;
}

async function leadView(rt: Runtime, lead: Lead | null) {
  if (!lead) return null;
  const tz = await leadTimezone(rt, lead);
  return {
    first: lead.first_name || "",
    ref: lead.ref_code,
    tier: effectiveTier(lead),
    status: lead.status,
    booked: lead.status === "booked" && !!lead.call_at && !lead.booking_cancelled_at,
    callTime: lead.call_at ? formatCallTime(lead.call_at, tz) : null,
    completed: !!lead.app_completed_at,
  };
}

// ── Landing (main + landers) ─────────────────────────────────────────────────

export async function landingPage(c: Ctx, opts: { industry?: Industry | null; angle?: Angle | null; smart?: boolean } = {}): Promise<Response> {
  const rt = c.get("rt");
  const url = new URL(c.req.url);
  const preview = url.searchParams.get("preview") === "1";
  const id = await resolveIdentity(c, { page: true });
  let path = url.pathname;

  let eyebrow: string, h1: string, h1b: string, sub: string;
  if (opts.industry) {
    let angle = opts.angle;
    if (!angle) {
      const sticky = id.lander?.startsWith(opts.industry.id + "/") ? getAngle(id.lander.split("/")[1]) : null;
      angle = sticky || getAngle(chooseAngle(await armStats(rt, opts.industry.id))) || null;
    }
    if (!angle) angle = getAngle("agency");
    const key = `${opts.industry.id}/${angle!.id}`;
    if (!preview) { id.lander = key; setLanderCookie(c, key); }
    eyebrow = angle!.pre(opts.industry);
    h1 = angle!.headline(opts.industry);
    h1b = "";
    sub = angle!.sub(opts.industry);
    path = `/for/${key}`;
  } else {
    const forced = url.searchParams.get("v");
    let v = HEADLINES.find((h) => h.id === forced) ? forced! : id.variant && HEADLINES.find((h) => h.id === id.variant) ? id.variant : null;
    if (!v) {
      v = HEADLINES[Math.floor(Math.random() * HEADLINES.length)].id;
      if (!preview) setVariantCookie(c, v);
    }
    if (!forced && !preview) id.variant = v;
    const h = HEADLINES.find((x) => x.id === v)!;
    ({ eyebrow, h1, h1b, sub } = h);
    path = "/";
  }

  const pv = await pageView(c, id, path, { variant: id.variant, lander: id.lander }, preview);
  const lead = await getLead(rt, id.leadId);
  const video = videoCfg(rt, "main", id.isBot ? 0 : await resumePosition(rt, id.visitorId, "main"));
  const revealed = !video.src || (await hasRevealed(rt, id.visitorId)) || !!lead?.app_completed_at;
  const wa = waLink(rt, lead, "question");
  const remove: string[] = [];
  if (!wa) remove.push("[data-section=whatsapp]");
  remove.push("[data-section=testimonials]"); // hidden until real testimonials exist
  if (!h1b) remove.push("[data-slot=h1b]");

  return renderTemplate(c, "index.html", {
    title: `${BRAND.name} · ${h1.replace(/[.:]$/, "")}`,
    bodyClass: revealed ? "" : "gated",
    text: {
      eyebrow, h1, h1b, sub,
      cta: lead?.app_completed_at ? "See your next step" : LANDING.ctaLabel,
      ctaSub: LANDING.ctaSub,
      locked: LANDING.lockedNote,
      statement: LANDING.statement,
      guarantee: BRAND.guarantee,
      deliveryGuarantee: BRAND.deliveryGuarantee,
      disclaimer: BRAND.disclaimer,
      year: String(new Date().getFullYear()),
      company: BRAND.company,
    },
    html: { figures: figuresHtml(), system: systemHtml(), weeks: weeksHtml(), fit: fitHtml(), faq: faqHtml(FAQS) },
    attrs: [
      ...(wa ? [{ sel: "a[data-wa]", attr: "href", value: "/go/wa?c=question" }] : []),
      ...(lead?.app_completed_at && lead.route ? [{ sel: "a[data-apply]", attr: "href", value: lead.route }] : []),
    ],
    remove,
    cfg: { ...commonCfg(rt, id, "landing", pv), video, revealed, variant: id.variant, lander: id.lander },
  });
}

/** /m: Meta smart route. Industry from ?ind= or the campaign / ad set / ad names. */
export async function smartRoute(c: Ctx): Promise<Response> {
  const url = new URL(c.req.url);
  const q = (k: string) => url.searchParams.get(k);
  const ind = getIndustry(q("ind")) || inferIndustry(q("utm_campaign"), q("utm_term"), q("utm_content"));
  return landingPage(c, { industry: ind, angle: getAngle(q("angle")), smart: true });
}

// ── Apply ─────────────────────────────────────────────────────────────────────

export async function applyPage(c: Ctx): Promise<Response> {
  const rt = c.get("rt");
  const id = await resolveIdentity(c, { page: true });
  const pv = await pageView(c, id, "/apply");
  const lead = await getLead(rt, id.leadId);
  if (lead?.app_completed_at && lead.route) return c.redirect(lead.route, 302);
  const questions = APPLICATION.map((q) => ({
    id: q.id, type: q.type, title: q.title, help: q.help || "", placeholder: q.placeholder || "", optional: !!q.optional, minLength: q.minLength || 0,
    options: (q.options || []).map((o) => ({ value: o.value, label: o.label })),
  }));
  const answers: Record<string, unknown> = {};
  if (lead) { try { Object.assign(answers, JSON.parse(lead.answers || "{}")); } catch { /* ignore */ } }
  return renderTemplate(c, "apply.html", {
    title: `Apply · ${BRAND.name}`,
    cfg: {
      ...commonCfg(rt, id, "apply", pv),
      questions,
      consent: { label: CALL_CONSENT.label, version: CALL_CONSENT.version },
      turnstile: rt.settings.get("TURNSTILE_SITE_KEY") || null,
      lead: lead ? { first: lead.first_name || "", last: lead.last_name || "", email: lead.email, phone: lead.phone || "", callConsent: !!lead.call_consent_at, step: lead.step_reached, answers } : null,
      country: id.geo.country,
    },
  });
}

// ── Book ──────────────────────────────────────────────────────────────────────

export function calendlyEmbedUrl(base: string, lead: Lead, host: string, consentRequired: boolean): string | null {
  let u: URL;
  try { u = new URL(base); } catch { return null; }
  if (u.protocol !== "https:" || !/(^|\.)calendly\.com$/.test(u.hostname)) return null;
  u.searchParams.set("name", [lead.first_name, lead.last_name].filter(Boolean).join(" "));
  u.searchParams.set("email", lead.email);
  u.searchParams.set("salesforce_uuid", lead.id);
  u.searchParams.set("embed_domain", host);
  u.searchParams.set("embed_type", "Inline");
  u.searchParams.set("hide_event_type_details", "1");
  if (!consentRequired) u.searchParams.set("hide_gdpr_banner", "1");
  if (lead.utm_source) u.searchParams.set("utm_source", lead.utm_source);
  if (lead.utm_campaign) u.searchParams.set("utm_campaign", lead.utm_campaign);
  return u.toString();
}

export async function bookPage(c: Ctx): Promise<Response> {
  const rt = c.get("rt");
  const id = await resolveIdentity(c, { page: true });
  const lead = await getLead(rt, id.leadId);
  if (!lead || !lead.app_completed_at) return c.redirect("/apply", 302);
  const tier = effectiveTier(lead);
  if (tier === "C") return c.redirect("/resources", 302);
  if (lead.status === "booked" && lead.call_at && !lead.booking_cancelled_at) return c.redirect("/breakout", 302);
  const pv = await pageView(c, id, "/book");
  const rep = await getRep(rt, lead.closer_id);
  const base = bookingUrlFor(rt, tier, rep);
  const embed = base ? calendlyEmbedUrl(base, lead, new URL(c.req.url).host, id.consentRequired) : null;
  const wa = waLink(rt, lead, "question");
  return renderTemplate(c, "book.html", {
    title: `Pick a time · ${BRAND.name}`,
    text: { first: lead.first_name || "", closer: rep?.name || BRAND.founder },
    remove: [...(embed ? ["[data-when=nocal]"] : ["[data-when=cal]"]), ...(wa ? [] : ["[data-section=whatsapp]"])],
    attrs: wa ? [{ sel: "a[data-wa]", attr: "href", value: "/go/wa?c=question" }] : [],
    cfg: { ...commonCfg(rt, id, "book", pv), embed, lead: await leadView(rt, lead) },
  });
}

// ── Breakout (B tier, and the pre-call page once booked) ─────────────────────

export async function breakoutPage(c: Ctx): Promise<Response> {
  const rt = c.get("rt");
  const id = await resolveIdentity(c, { page: true });
  const lead = await getLead(rt, id.leadId);
  const pv = await pageView(c, id, "/breakout");
  const lv = await leadView(rt, lead);
  const booked = !!lv?.booked;
  const video = videoCfg(rt, booked ? "precall" : "breakout", 0);
  const wa = waLink(rt, lead, booked ? "booked" : "question");
  const objections = FAQS.filter((f) => ["cost", "time", "tech", "agency", "guarantee", "results"].includes(f.id));
  const remove: string[] = [booked ? "[data-when=open]" : "[data-when=booked]"];
  if (!wa) remove.push("[data-section=whatsapp]");
  if (!video.src) remove.push("[data-section=video]");
  if (!lead?.booking_join_url) remove.push("[data-when=join]");
  return renderTemplate(c, "breakout.html", {
    title: `${booked ? "Before your call" : "Next step"} · ${BRAND.name}`,
    text: {
      eyebrow: booked ? BREAKOUT.bookedEyebrow : BREAKOUT.eyebrow,
      h1: booked ? BREAKOUT.bookedH1 : BREAKOUT.h1,
      sub: booked ? `Your call is on ${lv?.callTime || "the time you picked"}. The confirmation email has the link.` : BREAKOUT.sub,
      first: lead?.first_name || "",
      disclaimer: BRAND.disclaimer,
      guarantee: BRAND.guarantee,
    },
    html: {
      prep: BREAKOUT.prep.map((p) => `<li>${escHtml(p)}</li>`).join(""),
      faq: faqHtml(booked ? FAQS : objections),
    },
    attrs: wa ? [{ sel: "a[data-wa]", attr: "href", value: `/go/wa?c=${booked ? "booked" : "question"}` }] : [],
    remove,
    cfg: { ...commonCfg(rt, id, "breakout", pv), video, lead: lv, revealed: true },
  });
}

export async function resourcesPage(c: Ctx): Promise<Response> {
  const rt = c.get("rt");
  const id = await resolveIdentity(c, { page: true });
  const lead = await getLead(rt, id.leadId);
  const pv = await pageView(c, id, "/resources");
  const wa = waLink(rt, lead, "resources");
  return renderTemplate(c, "resources.html", {
    title: `Resources · ${BRAND.name}`,
    text: { first: lead?.first_name ? `${lead.first_name}, thank you for applying.` : "Thank you for applying.", disclaimer: BRAND.disclaimer },
    html: { resources: RESOURCES.map((r, i) => `<li><span class="num">${i + 1}</span><div><h3>${escHtml(r.title)}</h3><p>${escHtml(r.body)}</p></div></li>`).join("") },
    attrs: wa ? [{ sel: "a[data-wa]", attr: "href", value: "/go/wa?c=resources" }] : [],
    remove: wa ? [] : ["[data-section=whatsapp]"],
    cfg: { ...commonCfg(rt, id, "resources", pv) },
  });
}

export async function privacyPage(c: Ctx): Promise<Response> {
  const rt = c.get("rt");
  const id = await resolveIdentity(c, { page: true });
  const pv = await pageView(c, id, "/privacy");
  return renderTemplate(c, "privacy.html", {
    title: `Privacy · ${BRAND.name}`,
    text: {
      company: `${BRAND.company}`,
      address: rt.settings.get("BUSINESS_ADDRESS") || "[postal address]",
      contact: rt.settings.get("EMAIL_REPLY_TO") || rt.settings.get("EMAIL_FROM") || "[contact email]",
      updated: "October 2026",
    },
    cfg: { ...commonCfg(rt, id, "privacy", pv) },
  });
}
