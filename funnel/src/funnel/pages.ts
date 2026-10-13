// Server-rendered funnel pages: static templates in public/ filled with HTMLRewriter.
// The page view id is minted up front (the Pixel dedupes on it); the D1 writes run after the response
// has started (waitUntil), so the HTML never waits on them. Independent reads run in parallel.

import type { Ctx, Runtime } from "../app";
import {
  APPLICATION, BRAND, BREAKOUT, CALL_CONSENT, FAQS, HEADLINES, LANDING, OFFER, RESOURCES, VIDEOS,
  type Faq, type GateMode, type Resource, type VideoId,
} from "../config";
import { resolveIdentity, setLanderCookie, setVariantCookie, type Identity } from "../lib/identity";
import { newId } from "../lib/ids";
import { escHtml } from "../lib/text";
import { track, whoFromIdentity } from "../tracking/track";
import { hasRevealed, resumePosition } from "../tracking/vsl";
import { getLead, effectiveTier, parseAnswers, type Lead } from "./leads";
import { bookingUrlFor } from "./routing";
import { getRep, type Rep } from "../sales/reps";
import { formatCallTime, leadTimezone } from "../integrations/email";
import { waLink } from "../integrations/whatsapp";
import { getAngle, getIndustry, inferIndustry, type Angle, type Industry } from "../landers/catalog";
import { armStats, chooseAngle, type ArmStats } from "../landers/bandit";

export interface Fill {
  title?: string;
  /** Meta description and link-preview text (Open Graph / Twitter). */
  description?: string;
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

/**
 * Splits a lander headline into an ink line and a short gradient payoff (at most seven words):
 * the last sentence, else the part after the last comma, else after the colon. A long payoff stays ink.
 */
export function splitHeadline(text: string): { h1: string; h1b: string } {
  const words = (t: string) => t.trim().split(/\s+/).length;
  const cuts = [text.search(/[.!?]\s+\S[^.!?]*[.!?]?$/), text.lastIndexOf(", "), text.indexOf(": ")];
  for (const i of cuts) {
    if (i <= 0) continue;
    const h1 = text.slice(0, i + 1).trim(), h1b = text.slice(i + 1).trim();
    if (h1b && words(h1b) <= 7 && words(h1) >= 2) return { h1, h1b };
  }
  return { h1: text, h1b: "" };
}

/** Escapes text and wraps hyphenated words, and short sentences ("No agency."), in no-wrap spans. */
export function nowrapHyphens(text: string): string {
  const parts = text.split(/(?<=[.!?])\s+/);
  if (parts.length > 1 && parts.every((p) => p.length <= 16)) return parts.map((p) => `<span class="nw">${escHtml(p)}</span>`).join(" ");
  return escHtml(text).replace(/(\S+-\S+)/g, '<span class="nw">$1</span>');
}

// ── Asset versions ────────────────────────────────────────────────────────────

/** Fallback when the version-metadata binding is missing (tests, older wrangler). Bump on asset changes. */
export const BUILD_VERSION = "r1-20261013";

/** Short, URL-safe version id of the deployed Worker (CF_VERSION_METADATA), or the build constant. */
export function assetVersion(env: unknown): string {
  const meta = (env as { CF_VERSION_METADATA?: { id?: unknown } } | null)?.CF_VERSION_METADATA;
  const id = typeof meta?.id === "string" ? meta.id.replace(/[^a-zA-Z0-9]/g, "").slice(0, 12) : "";
  return id || BUILD_VERSION;
}

/** "/assets/site.css" → "/assets/site.css?v=abc". Only same-site /assets/ URLs without a query are touched. */
export function versioned(url: string, v: string): string {
  return /^\/assets\/[^?#]+$/.test(url) ? `${url}?v=${encodeURIComponent(v)}` : url;
}

/** Meta description, Open Graph and Twitter tags for link previews. All values escaped. */
export function previewMeta(o: { title: string; description: string; url: string; image: string; siteName: string }): string {
  const m = (attr: "name" | "property", k: string, v: string) => `<meta ${attr}="${k}" content="${escHtml(v)}">`;
  return [
    m("name", "description", o.description),
    m("property", "og:type", "website"),
    m("property", "og:site_name", o.siteName),
    m("property", "og:title", o.title),
    m("property", "og:description", o.description),
    m("property", "og:url", o.url),
    m("property", "og:image", o.image),
    m("property", "og:image:width", "1200"),
    m("property", "og:image:height", "630"),
    m("property", "og:image:alt", o.siteName),
    m("name", "twitter:card", "summary_large_image"),
    m("name", "twitter:title", o.title),
    m("name", "twitter:description", o.description),
    m("name", "twitter:image", o.image),
  ].join("\n");
}

export async function renderTemplate(c: Ctx, file: string, fill: Fill, status = 200): Promise<Response> {
  const res = await c.env.ASSETS.fetch(new Request(new URL(`/${file}`, c.req.url).toString()));
  if (!res.ok) return c.text("Template missing", 500);
  const rt = c.get("rt");
  const v = assetVersion(c.env);
  const rw = new HTMLRewriter();
  if (fill.title) rw.on("title", { element(el) { el.setInnerContent(fill.title as string); } });
  if (fill.title || fill.description) {
    const url = new URL(c.req.url);
    const meta = previewMeta({
      title: fill.title || BRAND.name,
      description: fill.description || BRAND.promiseShort,
      url: `${rt.origin}${url.pathname}`,
      image: `${rt.origin}/assets/og.png`,
      siteName: BRAND.name,
    });
    rw.on("head", { element(el) { el.append(meta, { html: true }); } });
  }
  // Cache-busting: css/js get ?v=<deployed version>, so they can be cached for a year (see public/_headers).
  rw.on('link[rel="stylesheet"][href^="/assets/"]', { element(el) { el.setAttribute("href", versioned(el.getAttribute("href") || "", v)); } });
  rw.on('script[src^="/assets/"]', { element(el) { el.setAttribute("src", versioned(el.getAttribute("src") || "", v)); } });
  if (fill.bodyClass) rw.on("body", { element(el) { el.setAttribute("class", `${el.getAttribute("class") || ""} ${fill.bodyClass}`.trim()); } });
  rw.on("[data-slot]", {
    element(el) {
      const k = el.getAttribute("data-slot") || "";
      if (fill.text && k in fill.text) {
        // Headlines and the sub: keep hyphenated words ("hands-free") on one line.
        if ((k === "h1" || k === "h1b" || k === "sub") && /\S-\S|[.!?]\s/.test(fill.text[k])) el.setInnerContent(nowrapHyphens(fill.text[k]), { html: true });
        else el.setInnerContent(fill.text[k]);
      }
      else if (fill.html && k in fill.html) el.setInnerContent(fill.html[k], { html: true });
    },
  });
  for (const a of fill.attrs || []) rw.on(a.sel, { element(el) { el.setAttribute(a.attr, a.value); } });
  for (const sel of fill.remove || []) rw.on(sel, { element(el) { el.remove(); } });
  if (fill.cfg) {
    const cfg = { ...fill.cfg, v };
    rw.on("script#op-cfg", { element(el) { el.setInnerContent(safeJson(cfg), { html: true }); } });
  }
  const out = rw.transform(new Response(res.body, { status, headers: { "content-type": "text/html; charset=utf-8" } }));
  // c.newResponse keeps the cookies queued on the context (visitor, session, variant, lander, fbp/fbc).
  // private, no-cache: never stored by shared caches, always revalidated, but the back/forward cache still works.
  return c.newResponse(out.body, status as 200, { "content-type": "text/html; charset=utf-8", "cache-control": "private, no-cache" });
}

// ── Shared pieces ─────────────────────────────────────────────────────────────

export function faqHtml(faqs: Faq[]): string {
  return faqs.map((f) => `<details class="faq" data-faq="${escHtml(f.id)}"><summary>${escHtml(f.q)}</summary><p>${escHtml(f.a)}</p></details>`).join("");
}

const safeUrl = (u: string) => (/^(https:\/\/|\/(?!\/))[^\s"'<>]*$/.test(u) ? u : "");

export function videoCfg(rt: Runtime, id: VideoId, resume: number) {
  const key = id === "main" ? "VSL_MAIN" : id === "breakout" ? "VSL_BREAKOUT" : "VSL_PRECALL";
  const v = VIDEOS[id];
  const src = safeUrl(rt.settings.get(`${key}_SRC`));
  return {
    id,
    src,
    hls: /\.m3u8(\?|$)/i.test(src),
    poster: safeUrl(rt.settings.get(`${key}_POSTER`)),
    captions: safeUrl(rt.settings.get(`${key}_CAPTIONS`) || v.captions),
    label: v.label,
    ctaRevealAt: v.ctaRevealAt,
    duration: v.duration,
    resume,
    chapters: v.chapters.map((c) => ({ at: c.at, label: c.label })),
  };
}

function commonCfg(rt: Runtime, id: Identity, page: string, pv: string | null) {
  const s = rt.settings;
  return {
    page,
    pv,
    consentRequired: id.consentRequired,
    // Banner consent ("granted" | "denied" | "unknown"). Always a string; the AI-call consent is `callConsent`.
    consent: id.consent,
    // Ids only; f.js loads nothing until consent allows it (replay always needs an explicit yes).
    pixel: s.has("META_PIXEL_ID") ? s.get("META_PIXEL_ID") : null,
    replay: s.bool("POSTHOG_SESSION_REPLAY") && s.has("POSTHOG_KEY") ? { key: s.get("POSTHOG_KEY") } : null,
  };
}

/**
 * Records the page view without holding up the response: the event id is minted here (and handed to the
 * Pixel for deduplication), the insert and the visitor/session counters run in waitUntil, after the
 * identity rows they update.
 */
function pageView(c: Ctx, id: Identity, path: string, props: Record<string, unknown> = {}, preview = false): string | null {
  if (id.isPrefetch || preview) return null;
  const rt = c.get("rt");
  const pv = newId("e");
  const who = whoFromIdentity(id, path, c.req.url);
  const write = async () => {
    if (id.pending) await id.pending;
    await track(rt, who, { name: "page_view", props, eventId: pv });
    await rt.env.DB.batch([
      rt.env.DB.prepare("UPDATE sessions SET pageviews = pageviews + 1, last_seen_at = ?, variant = COALESCE(variant, ?), lander = COALESCE(lander, ?) WHERE id = ?")
        .bind(rt.now(), id.variant, id.lander, id.sessionId),
      rt.env.DB.prepare("UPDATE visitors SET pageviews = pageviews + 1, last_seen_at = ? WHERE id = ?").bind(rt.now(), id.visitorId),
    ]);
  };
  rt.waitUntil(write());
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

// Bandit arm stats: two aggregate queries per industry, cached per isolate for a minute.
const ARM_TTL = 60_000;
const armCache = new Map<string, { at: number; stats: ArmStats[] }>();
async function cachedArmStats(rt: Runtime, industry: string): Promise<ArmStats[]> {
  const hit = armCache.get(industry);
  if (hit && rt.now() - hit.at < ARM_TTL) return hit.stats;
  const stats = await armStats(rt, industry);
  armCache.set(industry, { at: rt.now(), stats });
  if (armCache.size > 64) armCache.delete(armCache.keys().next().value as string);
  return stats;
}

/** Attendance confirmed for the call that is booked now (a reschedule needs a fresh confirmation). */
export function attendanceConfirmed(lead: Pick<Lead, "call_at"> & { attendance_confirmed_at?: number | null; attendance_call_at?: number | null } | null): boolean {
  return !!lead?.attendance_confirmed_at && !!lead.call_at && lead.attendance_call_at === lead.call_at;
}

/** The label the lead picked for an application question, e.g. spend → "$100k – $300k". */
export function answerLabel(lead: Pick<Lead, "answers"> | null, questionId: string): string | null {
  const a = parseAnswers(lead)[questionId];
  if (typeof a !== "string") return null;
  return APPLICATION.find((q) => q.id === questionId)?.options?.find((o) => o.value === a)?.label || null;
}

// ── Landing (main + landers) ─────────────────────────────────────────────────

/**
 * Is the application gated behind the film for this visit? Never when there is no film, the gate is open,
 * the visitor already reached the pitch or applied, is a known lead, came from a retargeting ad
 * (utm_content "rt_…") or a referral link (?r=).
 */
export function gateState(o: { mode: GateMode; hasFilm: boolean; revealedBefore: boolean; knownLead: boolean; url: URL }): boolean {
  if (!o.hasFilm || o.mode === "open" || o.revealedBefore || o.knownLead) return false;
  const content = (o.url.searchParams.get("utm_content") || "").toLowerCase();
  if (content.startsWith("rt_") || o.url.searchParams.has("r")) return false;
  return true;
}

function weeksHtml(): string {
  return LANDING.weeks.map((w) => `<li><span class="wk">${escHtml(w.label)}</span><h3>${escHtml(w.title)}</h3><p>${escHtml(w.body)}</p></li>`).join("");
}

function systemHtml(): string {
  return LANDING.system.map((s) => `<li><h3>${escHtml(s.title)}</h3><p>${escHtml(s.body)}</p></li>`).join("");
}

export async function landingPage(c: Ctx, opts: { industry?: Industry | null; angle?: Angle | null; smart?: boolean } = {}): Promise<Response> {
  const rt = c.get("rt");
  const url = new URL(c.req.url);
  const preview = url.searchParams.get("preview") === "1";
  const id = await resolveIdentity(c, { page: true });
  let path = url.pathname;
  const videoSrc = videoCfg(rt, "main", 0).src;

  // Independent reads in parallel: the lead, the bandit stats (cached), the film position and the gate.
  const [lead, stats, resume, revealedBefore] = await Promise.all([
    getLead(rt, id.leadId),
    opts.industry && !opts.angle && !id.lander?.startsWith(opts.industry.id + "/") ? cachedArmStats(rt, opts.industry.id) : Promise.resolve(null),
    id.isBot || !videoSrc ? Promise.resolve(0) : resumePosition(rt, id.visitorId, "main"),
    videoSrc ? hasRevealed(rt, id.visitorId) : Promise.resolve(true),
  ]);

  let eyebrow: string, h1: string, h1b: string, sub: string;
  if (opts.industry) {
    let angle = opts.angle;
    if (!angle) {
      const sticky = id.lander?.startsWith(opts.industry.id + "/") ? getAngle(id.lander.split("/")[1]) : null;
      angle = sticky || (stats ? getAngle(chooseAngle(stats)) : null) || null;
    }
    if (!angle) angle = getAngle("agency");
    const key = `${opts.industry.id}/${angle!.id}`;
    if (!preview) { id.lander = key; setLanderCookie(c, key); }
    eyebrow = angle!.pre(opts.industry);
    ({ h1, h1b } = splitHeadline(angle!.headline(opts.industry)));
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

  const pv = pageView(c, id, path, { variant: id.variant, lander: id.lander }, preview);
  const video = videoCfg(rt, "main", resume);
  const gate = VIDEOS.main.gate;
  const gated = gateState({ mode: gate.mode, hasFilm: !!video.src, revealedBefore: !!revealedBefore || !!lead?.app_completed_at, knownLead: !!lead, url });
  const wa = waLink(rt, lead, "question");
  const remove: string[] = [];
  if (!wa) remove.push("[data-section=whatsapp]");
  remove.push("[data-section=testimonials]"); // hidden until real testimonials exist
  if (!h1b) remove.push("[data-slot=h1b]");
  // No film yet: a calm summary of what gets built stands in the film's place, and nothing is gated.
  if (video.src) remove.push("[data-when=nofilm]");
  else remove.push("[data-player]", "[data-when=film]");
  if (gate.mode !== "soft" || !gated) remove.push("[data-soft-cta]");
  const faqs = LANDING.below.faqIds.map((fid) => FAQS.find((f) => f.id === fid)).filter((f): f is Faq => !!f);
  const fullHeadline = [h1, h1b].filter(Boolean).join(" ");

  return renderTemplate(c, "index.html", {
    title: `${BRAND.name} · ${h1.replace(/[.:]$/, "")}`,
    description: `${fullHeadline} ${sub}`.slice(0, 300),
    bodyClass: [gated ? "gated" : "", h1.length + h1b.length > 48 ? "long-h1" : "", video.src ? "" : "no-film"].filter(Boolean).join(" "),
    text: {
      eyebrow, h1, h1b, sub,
      ctaSub: LANDING.ctaSub,
      locked: LANDING.lockedNote,
      softCta: LANDING.softCta,
      applyAssure: `${BRAND.guarantee} Price is covered on the call, once we know the scope.`,
      nofilmTitle: LANDING.noFilm.title,
      nofilmSub: LANDING.noFilm.sub,
      nofilmFoot: LANDING.noFilm.foot,
      guarantee: BRAND.guarantee,
      deliveryGuarantee: BRAND.deliveryGuarantee,
      weeksKicker: LANDING.below.weeksKicker,
      weeksTitle: LANDING.below.weeksTitle,
      faqKicker: LANDING.below.faqKicker,
      faqTitle: LANDING.below.faqTitle,
      disclaimer: BRAND.disclaimer,
      year: String(new Date().getFullYear()),
      company: BRAND.company,
    },
    html: { weeks: weeksHtml(), system: systemHtml(), faq: faqHtml(faqs) },
    attrs: [
      ...(wa ? [{ sel: "a[data-wa]", attr: "href", value: "/go/wa?c=question" }] : []),
      ...(lead?.app_completed_at && lead.route ? [{ sel: "a[data-apply]", attr: "href", value: lead.route }] : []),
      { sel: "[data-player] video", attr: "aria-label", value: video.label },
    ],
    remove,
    // The application lives on this page, under the film.
    cfg: {
      ...commonCfg(rt, id, "landing", pv), ...applicationCfg(rt, id, lead), embedded: true, video, revealed: !gated,
      gate: { mode: gate.mode, softAt: gate.softAt }, variant: id.variant, lander: id.lander,
    },
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

/** Everything apply.js needs: the questions, consent text, Turnstile key and any saved answers. */
export function applicationCfg(rt: Runtime, id: Identity, lead: Lead | null) {
  const questions = APPLICATION.map((q) => ({
    id: q.id, type: q.type, title: q.title, help: q.help || "", placeholder: q.placeholder || "", optional: !!q.optional, minLength: q.minLength || 0,
    options: (q.options || []).map((o) => ({ value: o.value, label: o.label })),
  }));
  const answers: Record<string, unknown> = {};
  if (lead) { try { Object.assign(answers, JSON.parse(lead.answers || "{}")); } catch { /* ignore */ } }
  return {
    questions,
    callConsent: { label: CALL_CONSENT.label, version: CALL_CONSENT.version },
    turnstile: rt.settings.get("TURNSTILE_SITE_KEY") || null,
    lead: lead ? { first: lead.first_name || "", last: lead.last_name || "", email: lead.email, phone: lead.phone || "", callConsent: !!lead.call_consent_at, step: lead.step_reached, answers } : null,
    done: lead?.app_completed_at && lead.route ? { route: lead.route } : null,
    country: id.geo.country,
  };
}

export async function applyPage(c: Ctx): Promise<Response> {
  const rt = c.get("rt");
  const id = await resolveIdentity(c, { page: true });
  const pv = pageView(c, id, "/apply");
  const lead = await getLead(rt, id.leadId);
  if (lead?.app_completed_at && lead.route) return c.redirect(lead.route, 302);
  return renderTemplate(c, "apply.html", {
    title: `Apply · ${BRAND.name}`,
    description: `${BRAND.promiseShort} Apply in about three minutes.`,
    cfg: { ...commonCfg(rt, id, "apply", pv), ...applicationCfg(rt, id, lead) },
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

/** The closer card: name always; photo and a short bio only when the reps data carries them. */
export function closerHtml(rep: (Rep & { photo_url?: string | null; bio?: string | null }) | null): string {
  const name = rep?.name || BRAND.founder;
  const photo = safeUrl(String(rep?.photo_url || ""));
  const bio = typeof rep?.bio === "string" ? rep.bio.trim().slice(0, 240) : "";
  const role = name === BRAND.founder ? `Founder, ${BRAND.company}` : BRAND.name;
  const avatar = photo
    ? `<img class="closer-photo" src="${escHtml(photo)}" alt="" width="56" height="56" loading="lazy">`
    : `<span class="closer-initial" aria-hidden="true">${escHtml(name.charAt(0).toUpperCase())}</span>`;
  return `${avatar}<div><p class="closer-name">${escHtml(name)}</p><p class="closer-role">${escHtml(role)}</p>${bio ? `<p class="closer-bio">${escHtml(bio)}</p>` : ""}</div>`;
}

function agendaHtml(): string {
  return OFFER.agenda.map((a) => `<li><h3>${escHtml(a.title)}</h3><p>${escHtml(a.body)}</p></li>`).join("");
}

/** "You told us you spend $100k – $300k a year on …" from the lead's own answer, or empty. */
export function spendLine(lead: Pick<Lead, "answers"> | null): string {
  const label = answerLabel(lead, "spend");
  if (!label) return "";
  return `You told us you spend ${label} a year on agencies, freelancers and software. On the call we look at which part of that you could own instead.`;
}

export async function bookPage(c: Ctx): Promise<Response> {
  const rt = c.get("rt");
  const id = await resolveIdentity(c, { page: true });
  const lead = await getLead(rt, id.leadId);
  if (!lead || !lead.app_completed_at) return c.redirect("/apply", 302);
  const tier = effectiveTier(lead);
  if (tier === "C") return c.redirect("/resources", 302);
  if (lead.status === "booked" && lead.call_at && !lead.booking_cancelled_at) return c.redirect("/breakout", 302);
  const pv = pageView(c, id, "/book");
  const [rep, lv] = await Promise.all([getRep(rt, lead.closer_id), leadView(rt, lead)]);
  const base = bookingUrlFor(rt, tier, rep);
  const embed = base ? calendlyEmbedUrl(base, lead, new URL(c.req.url).host, id.consentRequired) : null;
  const wa = waLink(rt, lead, "question");
  const spend = spendLine(lead);
  const remove = [...(embed ? ["[data-when=nocal]"] : ["[data-when=cal]"]), ...(wa ? [] : ["[data-section=whatsapp]", "[data-wa]"])];
  if (!spend) remove.push("[data-slot=spendLine]");
  return renderTemplate(c, "book.html", {
    title: `Pick a time · ${BRAND.name}`,
    text: {
      first: lead.first_name || "",
      closer: rep?.name || BRAND.founder,
      spendLine: spend,
      minutes: `In ${OFFER.callMinutes} minutes`,
      takeaway: OFFER.takeaway,
      guarantee: `${BRAND.guarantee} ${BRAND.deliveryGuarantee}`,
      disclaimer: BRAND.disclaimer,
      year: String(new Date().getFullYear()),
      company: BRAND.company,
    },
    html: { closerCard: closerHtml(rep), agenda: agendaHtml(), faq: faqHtml(OFFER.faqs) },
    remove,
    attrs: wa ? [{ sel: "a[data-wa]", attr: "href", value: "/go/wa?c=question" }] : [],
    cfg: { ...commonCfg(rt, id, "book", pv), embed, wa: wa ? "/go/wa?c=question" : null, lead: lv },
  });
}

// ── Breakout (B tier, and the pre-call page once booked) ─────────────────────

export async function breakoutPage(c: Ctx): Promise<Response> {
  const rt = c.get("rt");
  const id = await resolveIdentity(c, { page: true });
  const lead = await getLead(rt, id.leadId);
  const pv = pageView(c, id, "/breakout");
  const [lv, rep] = await Promise.all([leadView(rt, lead), lead ? getRep(rt, lead.closer_id) : Promise.resolve(null)]);
  const booked = !!lv?.booked;
  const confirmed = booked && attendanceConfirmed(lead as Lead & { attendance_confirmed_at?: number | null; attendance_call_at?: number | null });
  const video = videoCfg(rt, booked ? "precall" : "breakout", 0);
  const wa = waLink(rt, lead, booked ? "booked" : "question");
  // Open state: the calendar sits under the video, so a B lead books without another hop.
  const tier = lead ? effectiveTier(lead) : null;
  const base = !booked && lead?.app_completed_at && tier !== "C" ? bookingUrlFor(rt, tier, rep) : "";
  const embed = base && lead ? calendlyEmbedUrl(base, lead, new URL(c.req.url).host, id.consentRequired) : null;
  const objections = FAQS.filter((f) => ["cost", "time", "tech", "agency", "guarantee", "results"].includes(f.id));
  const remove: string[] = [booked ? "[data-when=open]" : "[data-when=booked]"];
  if (!wa) remove.push("[data-section=whatsapp]");
  if (!video.src) remove.push("[data-section=video]", ".cta-band h2");
  if (!lead?.booking_join_url) remove.push("[data-when=join]");
  remove.push(embed ? "[data-cal-fallback]" : "[data-cal-section]");
  remove.push(confirmed ? "[data-when=unconfirmed]" : "[data-when=confirmed]");
  return renderTemplate(c, "breakout.html", {
    bodyClass: [video.src ? "has-video" : "", embed ? "has-cal" : ""].filter(Boolean).join(" "),
    title: `${booked ? "Before your call" : "Next step"} · ${BRAND.name}`,
    text: {
      eyebrow: booked ? BREAKOUT.bookedEyebrow : BREAKOUT.eyebrow,
      h1: booked ? BREAKOUT.bookedH1 : BREAKOUT.h1,
      sub: booked ? `Your call is on ${lv?.callTime || "the time you picked"}. The confirmation email has the link.` : video.src ? BREAKOUT.sub : BREAKOUT.subNoVideo,
      first: lead?.first_name || "",
      disclaimer: BRAND.disclaimer,
      guarantee: BRAND.guarantee,
      takeaway: OFFER.takeaway,
      year: String(new Date().getFullYear()),
      company: BRAND.company,
    },
    html: {
      prep: BREAKOUT.prep.map((p) => `<li>${escHtml(p)}</li>`).join(""),
      faq: faqHtml(booked ? FAQS : objections),
    },
    attrs: [
      ...(wa ? [{ sel: "a[data-wa]", attr: "href", value: `/go/wa?c=${booked ? "booked" : "question"}` }] : []),
      ...(embed ? [{ sel: "a[data-book-link]", attr: "href", value: "#book" }] : []),
      { sel: "[data-player] video", attr: "aria-label", value: video.label },
    ],
    remove,
    cfg: { ...commonCfg(rt, id, "breakout", pv), video, lead: lv, revealed: true, embed, wa: wa ? `/go/wa?c=${booked ? "booked" : "question"}` : null },
  });
}

/** One resource row: a real link when the item has a URL, otherwise a quiet "Coming soon". */
export function resourceHtml(r: Resource, i: number): string {
  const url = safeUrl(r.url || "");
  const ext = url.startsWith("https://");
  const title = url
    ? `<h3><a href="${escHtml(url)}"${ext ? ' rel="noopener" target="_blank"' : ""} data-track="resource_${i + 1}">${escHtml(r.title)}${ext ? '<span class="sr-only"> (opens in a new tab)</span>' : ""}</a></h3>`
    : `<h3>${escHtml(r.title)} <span class="soon">Coming soon</span></h3>`;
  return `<li><span class="num" aria-hidden="true">${i + 1}</span><div>${title}<p>${escHtml(r.body)}</p></div></li>`;
}

export async function resourcesPage(c: Ctx): Promise<Response> {
  const rt = c.get("rt");
  const id = await resolveIdentity(c, { page: true });
  const lead = await getLead(rt, id.leadId);
  const pv = pageView(c, id, "/resources");
  const wa = waLink(rt, lead, "resources");
  const role = parseAnswers(lead).role;
  const notOwner = role === "exec";
  const forwardHref = `mailto:?subject=${encodeURIComponent(OFFER.forwardSubject)}&body=${encodeURIComponent(`${OFFER.forwardBody} ${rt.origin}/`)}`;
  const remove: string[] = wa ? [] : ["[data-section=whatsapp]"];
  if (!notOwner) remove.push("[data-section=forward]");
  return renderTemplate(c, "resources.html", {
    title: `Resources · ${BRAND.name}`,
    text: { first: lead?.first_name ? `${lead.first_name}, thank you for applying.` : "Thank you for applying.", disclaimer: BRAND.disclaimer, year: String(new Date().getFullYear()), company: BRAND.company },
    html: { resources: RESOURCES.map(resourceHtml).join("") },
    attrs: [
      ...(wa ? [{ sel: "a[data-wa]", attr: "href", value: "/go/wa?c=resources" }] : []),
      ...(notOwner ? [{ sel: "a[data-forward]", attr: "href", value: forwardHref }] : []),
    ],
    remove,
    cfg: { ...commonCfg(rt, id, "resources", pv) },
  });
}

export async function privacyPage(c: Ctx): Promise<Response> {
  const rt = c.get("rt");
  const id = await resolveIdentity(c, { page: true });
  const pv = pageView(c, id, "/privacy");
  return renderTemplate(c, "privacy.html", {
    title: `Privacy · ${BRAND.name}`,
    description: `How ${BRAND.name} handles your data.`,
    text: {
      company: `${BRAND.company}`,
      address: rt.settings.get("BUSINESS_ADDRESS") || "[postal address]",
      contact: rt.settings.get("EMAIL_REPLY_TO") || rt.settings.get("EMAIL_FROM") || "[contact email]",
      updated: "October 2026",
    },
    cfg: { ...commonCfg(rt, id, "privacy", pv) },
  });
}
