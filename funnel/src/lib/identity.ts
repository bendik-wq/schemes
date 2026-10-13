// Visitor and session identity: first-party server-set cookies, geo, UA/bot parsing, attribution,
// consent state. Page routes call resolveIdentity({ page: true }) which writes visitor + session rows.

import { getCookie, setCookie, deleteCookie } from "hono/cookie";
import type { Ctx, Runtime } from "../app";
import { CONSENT_COUNTRIES } from "../config";
import { hmacHex } from "./crypto";
import { newId } from "./ids";
import { parseTouch, isCampaignTouch, type Touch } from "./attribution";
import { parseUA, botReason } from "./ua";
import { signingSecret } from "./secret";

export const COOKIE = {
  visitor: "_fv",
  session: "_fs",
  consent: "_fc",
  variant: "_ab",
  lander: "_ld",
  fbp: "_fbp",
  fbc: "_fbc",
  /** First referral link this browser arrived through (functional, first-party). */
  referral: "_rf",
  /** Sticky experiment variants, "expId.variant~…" (functional, first-party). */
  experiments: "_ex",
} as const;

const SESSION_IDLE = 30 * 60_000;
const VISITOR_TTL_S = 400 * 86_400;

export type Consent = "granted" | "denied" | "unknown";

export interface Geo {
  country: string | null;
  region: string | null;
  regionCode: string | null;
  city: string | null;
  postal: string | null;
  tz: string | null;
  lat: string | null;
  lon: string | null;
  isEU: boolean;
  asn: number | null;
  asOrg: string | null;
  colo: string | null;
  tls: string | null;
  httpProtocol: string | null;
}

export interface Identity {
  visitorId: string;
  sessionId: string;
  leadId: string | null;
  newVisitor: boolean;
  newSession: boolean;
  isBot: boolean;
  botReason: string | null;
  variant: string | null;
  lander: string | null;
  geo: Geo;
  ip: string | null;
  ua: string;
  device: string;
  consentRequired: boolean;
  consent: Consent;
  /** True when ad cookies, pixels and forwarding are allowed for this visitor. */
  adsAllowed: boolean;
  fbp: string | null;
  fbc: string | null;
  touch: Touch | null;
  channel: string | null;
  /** Prefetch/prerender, or (page routes) a non-document fetch such as an image probe or iframe: render, never count. */
  isPrefetch: boolean;
  /**
   * Page renders only: the visitor/session writes run after the response starts (waitUntil). Anything that
   * updates those rows during the same request (the page view) chains on this promise.
   */
  pending?: Promise<void>;
}

/**
 * Local development only (wrangler dev on localhost): a CF-IPCountry request header stands in for the edge's
 * geolocation, so the consent banner and market rules can be tested. Ignored on every other host.
 */
function localCountryOverride(req: Request): string | null {
  let host = "";
  try { host = new URL(req.url).hostname; } catch { return null; }
  if (host !== "localhost" && host !== "127.0.0.1") return null;
  const v = (req.headers.get("cf-ipcountry") || "").toUpperCase();
  return /^[A-Z]{2}$/.test(v) ? v : null;
}

export function readGeo(req: Request): Geo {
  const cf = ((req as unknown as { cf?: Record<string, unknown> }).cf || {}) as Record<string, unknown>;
  const s = (k: string) => (cf[k] == null ? null : String(cf[k]));
  return {
    country: localCountryOverride(req) || s("country"),
    region: s("region"),
    regionCode: s("regionCode"),
    city: s("city"),
    postal: s("postalCode"),
    tz: s("timezone"),
    lat: s("latitude"),
    lon: s("longitude"),
    isEU: cf.isEUCountry === "1" || cf.isEUCountry === true,
    asn: typeof cf.asn === "number" ? cf.asn : null,
    asOrg: s("asOrganization"),
    colo: s("colo"),
    tls: s("tlsVersion"),
    httpProtocol: s("httpProtocol"),
  };
}

export function consentRequiredFor(rt: Runtime, country: string | null): boolean {
  if (!rt.settings.bool("CONSENT_REQUIRED_EU")) return false;
  // Unknown country: be safe and ask.
  if (!country || country === "XX" || country === "T1") return true;
  return CONSENT_COUNTRIES.includes(country.toUpperCase());
}

function isPrefetch(req: Request): boolean {
  const h = req.headers;
  const p = (h.get("sec-purpose") || h.get("purpose") || h.get("x-moz") || "").toLowerCase();
  return p.includes("prefetch") || p.includes("prerender");
}

/**
 * Fetch metadata on a page route: only a top-level document load is a page view. Icon probes (image), iframes,
 * fetch() and other sub-requests are rendered but never counted. No header (old browsers, curl, bots) still counts.
 */
export function isNonDocumentFetch(req: Request): boolean {
  const dest = (req.headers.get("sec-fetch-dest") || "").toLowerCase();
  return !!dest && dest !== "document";
}

/**
 * A browser tab navigating to a page: GET, no file extension, not an API/asset path, and a document
 * destination (or, without fetch metadata, an Accept header asking for HTML). Used by the 404 handler.
 */
export function isDocumentNavigation(req: Request): boolean {
  if (req.method !== "GET") return false;
  const path = new URL(req.url).pathname;
  if (/\.[a-z0-9]{1,8}$/i.test(path)) return false;
  if (/^\/(api|admin\/api|hooks|ph|assets)(\/|$)/.test(path)) return false;
  const dest = (req.headers.get("sec-fetch-dest") || "").toLowerCase();
  if (dest) return dest === "document";
  return (req.headers.get("accept") || "").includes("text/html");
}

function cookieOpts(c: Ctx, maxAge: number, httpOnly = true) {
  const secure = new URL(c.req.url).protocol === "https:";
  return { path: "/", maxAge, httpOnly, secure, sameSite: "Lax" as const };
}

export function setConsentCookies(c: Ctx, consent: "granted" | "denied") {
  setCookie(c, COOKIE.consent, consent === "granted" ? "1" : "0", cookieOpts(c, 180 * 86_400, false));
  if (consent === "denied") {
    deleteCookie(c, COOKIE.fbp, { path: "/" });
    deleteCookie(c, COOKIE.fbc, { path: "/" });
  }
}

function readConsent(c: Ctx): Consent {
  const v = getCookie(c, COOKIE.consent);
  return v === "1" ? "granted" : v === "0" ? "denied" : "unknown";
}

const ID_RE = /^[a-z0-9_-]{8,40}$/i;

/**
 * Resolve the visitor + session. With page=true, creates/updates the rows and sets cookies.
 * Without, only reads (beacons/API), creating rows only when cookies are missing.
 */
export async function resolveIdentity(c: Ctx, opts: { page: boolean }): Promise<Identity> {
  const rt = c.get("rt");
  const req = c.req.raw;
  const url = new URL(req.url);
  const now = rt.now();
  const geo = readGeo(req);
  const ua = (req.headers.get("user-agent") || "").slice(0, 400);
  const uaInfo = parseUA(ua);
  const cf = ((req as unknown as { cf?: Record<string, unknown> }).cf || {}) as Record<string, unknown>;
  const bot = botReason(ua, req.headers, cf);
  const prefetch = isPrefetch(req) || (opts.page && isNonDocumentFetch(req));

  let visitorId = getCookie(c, COOKIE.visitor) || "";
  let newVisitor = false;
  if (!ID_RE.test(visitorId)) {
    visitorId = newId("v");
    newVisitor = true;
  }

  // Session cookie: "<sid>.<lastSeenMs>"
  const rawSess = getCookie(c, COOKIE.session) || "";
  const [sid0, lastStr] = rawSess.split(".");
  const last = Number(lastStr) || 0;
  const touch = opts.page ? parseTouch(url, req.headers.get("referer"), url.hostname) : null;
  let sessionId = ID_RE.test(sid0 || "") ? sid0 : "";
  let newSession = !sessionId || now - last > SESSION_IDLE;
  // A new ad click (different click id or UTMs) starts a new session even inside the idle window.
  if (!newSession && !prefetch && touch && isCampaignTouch(touch) && (await sessionTouchDiffers(rt, sessionId, touch))) {
    newSession = true;
  }
  if (newSession) sessionId = newId("s");

  const consentRequired = consentRequiredFor(rt, geo.country);
  const consent = readConsent(c);
  // An explicit "no" is honoured everywhere; in consent countries only an explicit "yes" allows.
  const adsAllowed = consent !== "denied" && (!consentRequired || consent === "granted");

  const ipRaw = req.headers.get("cf-connecting-ip") || req.headers.get("x-real-ip") || null;

  // Meta browser ids: only with consent (or where none is needed). Set server-side for longevity.
  let fbp = getCookie(c, COOKIE.fbp) || null;
  let fbc = getCookie(c, COOKIE.fbc) || null;
  const fbclid = url.searchParams.get("fbclid");
  if (adsAllowed && opts.page && !prefetch && !bot) {
    if (!fbp || !/^fb\.\d\.\d+\.\d+$/.test(fbp)) {
      fbp = `fb.1.${now}.${Math.floor(Math.random() * 2 ** 31)}`;
      setCookie(c, COOKIE.fbp, fbp, cookieOpts(c, 90 * 86_400, false));
    }
    if (fbclid && !(fbc && fbc.endsWith("." + fbclid))) {
      fbc = `fb.1.${now}.${fbclid.slice(0, 300)}`;
      setCookie(c, COOKIE.fbc, fbc, cookieOpts(c, 90 * 86_400, false));
    }
  }
  if (!adsAllowed) {
    fbp = null;
    fbc = null;
  }

  let leadId: string | null = null;
  let variant = getCookie(c, COOKIE.variant) || null;
  if (variant && !/^[a-z0-9]{1,4}$/.test(variant)) variant = null;
  let lander = getCookie(c, COOKIE.lander) || null;
  if (lander && !/^[a-z0-9-]{2,40}(\/[a-z0-9-]{2,30})?$/.test(lander)) lander = null;

  const id: Identity = {
    visitorId, sessionId, leadId, newVisitor, newSession,
    isBot: !!bot, botReason: bot, variant, lander, geo,
    ip: ipRaw, ua, device: uaInfo.device,
    consentRequired, consent, adsAllowed, fbp, fbc, touch,
    channel: touch?.channel ?? null,
    isPrefetch: prefetch,
  };

  if (prefetch) return id;

  // Persist rows. The lookup is awaited (it gives us the lead); on page renders the inserts and counters
  // run after the response has started, chained in order, so the HTML is not held up by D1 writes.
  const db = rt.env.DB;
  const [v, sessRow] = await Promise.all([
    db.prepare("SELECT lead_id FROM visitors WHERE id = ?").bind(visitorId).first<{ lead_id: string | null }>(),
    !newSession && !id.channel
      ? db.prepare("SELECT channel FROM sessions WHERE id = ?").bind(sessionId).first<{ channel: string | null }>()
      : Promise.resolve(null),
  ]);
  const writes: Array<() => Promise<unknown>> = [];
  if (!v) {
    newVisitor = true;
    id.newVisitor = true;
    const t = touch || parseTouch(url, req.headers.get("referer"), url.hostname);
    writes.push(() => db.prepare(
      `INSERT INTO visitors (id, created_at, last_seen_at, ft_channel, ft_source, ft_medium, ft_campaign, ft_content, ft_term,
        ft_referrer, ft_landing, ft_click_id, ft_click_type, country, region, city, device, browser, os, is_bot, sessions_count, pageviews)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,0,0) ON CONFLICT(id) DO NOTHING`,
    ).bind(
      visitorId, now, now, t.channel, t.utm_source, t.utm_medium, t.utm_campaign, t.utm_content, t.utm_term,
      t.referrer, (url.pathname + url.search).slice(0, 300), t.click_id, t.click_type,
      geo.country, geo.region, geo.city, uaInfo.device, uaInfo.browser, uaInfo.os, bot ? 1 : 0,
    ).run());
  } else {
    id.leadId = v.lead_id;
  }

  if (newSession) {
    const t = touch || parseTouch(url, req.headers.get("referer"), url.hostname);
    const anonymize = rt.settings.bool("IP_ANONYMIZE");
    const leadAtStart = id.leadId;
    writes.push(async () => {
      const secret = await signingSecret(rt.env);
      const ipHash = ipRaw ? (await hmacHex(secret, "ip|" + ipRaw)).slice(0, 32) : null;
      await db.prepare(
        `INSERT INTO sessions (id, visitor_id, started_at, last_seen_at, landing_path, landing_query, referrer, referrer_host, channel,
          utm_source, utm_medium, utm_campaign, utm_content, utm_term, click_id, click_type, ad_id, adset_id, placement,
          country, region, region_code, city, postal, tz, lat, lon, is_eu, asn, as_org, colo, tls, http_protocol, ip, ip_hash,
          user_agent, device, browser, os, in_app, accept_language, is_bot, bot_reason, variant, lander, lead_id)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
         ON CONFLICT(id) DO NOTHING`,
      ).bind(
        sessionId, visitorId, now, now, url.pathname.slice(0, 200), url.search.slice(0, 500), t.referrer, t.referrer_host, t.channel,
        t.utm_source, t.utm_medium, t.utm_campaign, t.utm_content, t.utm_term, t.click_id, t.click_type, t.ad_id, t.adset_id, t.placement,
        geo.country, geo.region, geo.regionCode, geo.city, geo.postal, geo.tz, geo.lat, geo.lon, geo.isEU ? 1 : 0,
        geo.asn, geo.asOrg, geo.colo, geo.tls, geo.httpProtocol, anonymize ? null : ipRaw, ipHash,
        ua, uaInfo.device, uaInfo.browser, uaInfo.os, uaInfo.inApp, (req.headers.get("accept-language") || "").slice(0, 100),
        bot ? 1 : 0, bot, variant, lander, leadAtStart,
      ).run();
      await db.prepare("UPDATE visitors SET sessions_count = sessions_count + 1, last_seen_at = ? WHERE id = ?").bind(now, visitorId).run();
    });
    id.channel = t.channel;
  } else if (!id.channel) {
    id.channel = sessRow?.channel ?? null;
  }

  if (writes.length) {
    const run = async () => { for (const w of writes) await w(); };
    if (opts.page) {
      id.pending = run().catch((e) => console.error("identity writes", e));
      rt.waitUntil(id.pending);
    } else {
      await run();
    }
  }

  if (opts.page || newVisitor || newSession) {
    // Where consent is required and not given, the visitor id lives only for the browser session.
    if (adsAllowed) setCookie(c, COOKIE.visitor, visitorId, cookieOpts(c, VISITOR_TTL_S));
    else setCookie(c, COOKIE.visitor, visitorId, { path: "/", httpOnly: true, secure: new URL(c.req.url).protocol === "https:", sameSite: "Lax" });
  }
  setCookie(c, COOKIE.session, `${sessionId}.${now}`, cookieOpts(c, 2 * 3600));
  return id;
}

async function sessionTouchDiffers(rt: Runtime, sessionId: string, t: Touch): Promise<boolean> {
  const s = await rt.env.DB.prepare(
    "SELECT click_id, utm_source, utm_campaign, utm_content FROM sessions WHERE id = ?",
  ).bind(sessionId).first<{ click_id: string | null; utm_source: string | null; utm_campaign: string | null; utm_content: string | null }>();
  if (!s) return false;
  if (t.click_id && t.click_id !== s.click_id) return true;
  if ((t.utm_source || "") !== (s.utm_source || "") || (t.utm_campaign || "") !== (s.utm_campaign || "") || (t.utm_content || "") !== (s.utm_content || "")) return true;
  return false;
}

/**
 * Functional first-party cookie (referral, experiment variants). Same rule as the visitor id: kept for 90 days
 * only when ad/analytics storage is allowed for this visitor, otherwise it lasts until the browser closes.
 */
export function functionalCookie(c: Ctx, name: string, value: string, persistent: boolean) {
  if (persistent) setCookie(c, name, value, cookieOpts(c, 90 * 86_400));
  else setCookie(c, name, value, { path: "/", httpOnly: true, secure: new URL(c.req.url).protocol === "https:", sameSite: "Lax" });
}

export function setVariantCookie(c: Ctx, v: string) {
  setCookie(c, COOKIE.variant, v, cookieOpts(c, 90 * 86_400));
}

export function setLanderCookie(c: Ctx, v: string) {
  setCookie(c, COOKIE.lander, v, cookieOpts(c, 90 * 86_400));
}

/** Link this visitor (and its sessions) to a lead. Back-fills anonymous events. */
export async function linkVisitorToLead(rt: Runtime, visitorId: string, leadId: string): Promise<void> {
  const db = rt.env.DB;
  await db.batch([
    db.prepare("UPDATE visitors SET lead_id = ? WHERE id = ?").bind(leadId, visitorId),
    db.prepare("UPDATE sessions SET lead_id = ? WHERE visitor_id = ? AND lead_id IS NULL").bind(leadId, visitorId),
    db.prepare("UPDATE events SET lead_id = ? WHERE visitor_id = ? AND lead_id IS NULL").bind(leadId, visitorId),
    db.prepare("UPDATE vsl_views SET lead_id = ? WHERE visitor_id = ? AND lead_id IS NULL").bind(leadId, visitorId),
  ]);
}

