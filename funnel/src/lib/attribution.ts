// UTM + click-id capture and GA4-style default channel grouping.

export const CLICK_IDS = [
  "gclid", "gbraid", "wbraid", "fbclid", "ttclid", "msclkid", "li_fat_id", "twclid", "ScCid", "epik", "rdt_cid",
] as const;

const CLICK_PLATFORM: Record<string, string> = {
  gclid: "google", gbraid: "google", wbraid: "google", fbclid: "meta", ttclid: "tiktok", msclkid: "microsoft",
  li_fat_id: "linkedin", twclid: "x", ScCid: "snapchat", epik: "pinterest", rdt_cid: "reddit",
};

export interface Touch {
  utm_source: string | null;
  utm_medium: string | null;
  utm_campaign: string | null;
  utm_content: string | null;
  utm_term: string | null;
  click_id: string | null;
  click_type: string | null;
  ad_id: string | null;
  adset_id: string | null;
  placement: string | null;
  referrer: string | null;
  referrer_host: string | null;
  channel: string;
}

const P = (u: URL, k: string, max = 200) => {
  const v = u.searchParams.get(k);
  return v ? v.slice(0, max) : null;
};

export function parseTouch(url: URL, referrer: string | null, ownHost: string): Touch {
  let click_id: string | null = null;
  let click_type: string | null = null;
  for (const k of CLICK_IDS) {
    const v = P(url, k, 500);
    if (v) { click_id = v; click_type = k; break; }
  }
  let referrer_host: string | null = null;
  let ref: string | null = null;
  if (referrer) {
    try {
      const r = new URL(referrer);
      referrer_host = r.hostname.replace(/^www\./, "").toLowerCase();
      if (referrer_host === ownHost.replace(/^www\./, "").toLowerCase()) referrer_host = null;
      else ref = (r.origin + r.pathname).slice(0, 300);
    } catch { /* ignore */ }
  }
  const t: Omit<Touch, "channel"> = {
    utm_source: P(url, "utm_source"),
    utm_medium: P(url, "utm_medium"),
    utm_campaign: P(url, "utm_campaign"),
    utm_content: P(url, "utm_content"),
    utm_term: P(url, "utm_term"),
    click_id, click_type,
    ad_id: P(url, "ad_id", 64),
    adset_id: P(url, "adset_id", 64),
    placement: P(url, "placement", 64),
    referrer: ref,
    referrer_host,
  };
  // A client's personal referral link (/?r=OP-XXXXXX) with no campaign tags: medium "referral" → Referral channel.
  if (!click_id && !t.utm_source && !t.utm_medium && !t.utm_campaign && /^OP-[A-Z0-9]{6}$/i.test(url.searchParams.get("r") || "")) {
    t.utm_medium = "referral";
  }
  return { ...t, channel: channelFor(t) };
}

const SOCIAL = /facebook|instagram|fb|ig|meta|linkedin|lnkd|twitter|x\.com|t\.co|tiktok|snapchat|pinterest|reddit|youtube|threads|whatsapp|messenger/i;
const SEARCH = /google|bing|duckduckgo|yahoo|ecosia|baidu|yandex|brave|kagi|qwant|startpage/i;
const VIDEO = /youtube|youtu\.be|vimeo|wistia|twitch/i;
const AI = /chatgpt|openai|perplexity|claude|gemini|copilot|you\.com/i;
const EMAIL = /mail|newsletter|outlook|gmail|resend|beehiiv|substack|convertkit|kit/i;

export function channelFor(t: Omit<Touch, "channel">): string {
  const src = (t.utm_source || "").toLowerCase();
  const med = (t.utm_medium || "").toLowerCase();
  const host = (t.referrer_host || "").toLowerCase();
  const paidMedium = /^(.*cp.*|ppc|paid.*|retargeting|display|banner|cpm|cpc)$/.test(med);

  if (t.click_type) {
    const p = CLICK_PLATFORM[t.click_type];
    if (p === "google" || p === "microsoft") return "Paid Search";
    return "Paid Social";
  }
  if (med === "email" || med === "e-mail" || (src && EMAIL.test(src) && !SOCIAL.test(src))) return "Email";
  if (med === "affiliate") return "Affiliates";
  if (med === "referral" && !src) return "Referral";
  if (src || med) {
    if (paidMedium && SOCIAL.test(src)) return "Paid Social";
    if (paidMedium && SEARCH.test(src)) return "Paid Search";
    if (paidMedium && VIDEO.test(src)) return "Paid Video";
    if (paidMedium) return "Paid Other";
    if (VIDEO.test(src) || med === "video") return "Organic Video";
    if (SOCIAL.test(src) || /social|sm|social-network|social-media/.test(med)) return "Organic Social";
    if (SEARCH.test(src) || med === "organic") return "Organic Search";
    if (AI.test(src)) return "AI Assistant";
    if (/sms/.test(src + med)) return "SMS";
    return "Other Campaign";
  }
  if (host) {
    if (AI.test(host)) return "AI Assistant";
    if (VIDEO.test(host)) return "Organic Video";
    if (SOCIAL.test(host)) return "Organic Social";
    if (SEARCH.test(host)) return "Organic Search";
    if (EMAIL.test(host)) return "Email";
    return "Referral";
  }
  return "Direct";
}

/** A touch with a click id or any UTM counts as a new marketing touch (starts a new session). */
export function isCampaignTouch(t: Touch): boolean {
  return !!(t.click_id || t.utm_source || t.utm_medium || t.utm_campaign);
}

export function isDirect(t: Pick<Touch, "channel">): boolean {
  return t.channel === "Direct";
}
