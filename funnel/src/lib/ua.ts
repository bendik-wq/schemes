export interface UAInfo {
  device: "mobile" | "tablet" | "desktop" | "bot";
  browser: string;
  os: string;
  inApp: string | null;
}

const BOT_RE =
  /bot|crawl|spider|slurp|facebookexternalhit|facebookcatalog|embedly|quora link|outbrain|pinterest|vkshare|w3c_validator|whatsapp|telegrambot|preview|headless|phantom|lighthouse|pagespeed|gtmetrix|curl|wget|python-requests|httpclient|go-http|node-fetch|axios|okhttp|java\/|libwww|scrapy|monitor|uptime|pingdom|datadog|ahrefs|semrush|mj12|dotbot|petalbot|bytespider|gptbot|claudebot|anthropic|perplexity|ccbot/i;

export function parseUA(ua: string | null | undefined): UAInfo {
  const s = ua || "";
  let inApp: string | null = null;
  if (/FBAN|FBAV|FB_IAB/.test(s)) inApp = "facebook";
  else if (/Instagram/.test(s)) inApp = "instagram";
  else if (/LinkedInApp/.test(s)) inApp = "linkedin";
  else if (/musical_ly|TikTok|BytedanceWebview/.test(s)) inApp = "tiktok";
  else if (/Snapchat/.test(s)) inApp = "snapchat";
  else if (/Twitter/.test(s)) inApp = "x";

  let os = "Other";
  if (/iPhone|iPad|iPod/.test(s)) os = "iOS";
  else if (/Android/.test(s)) os = "Android";
  else if (/Windows/.test(s)) os = "Windows";
  else if (/Mac OS X|Macintosh/.test(s)) os = "macOS";
  else if (/CrOS/.test(s)) os = "ChromeOS";
  else if (/Linux/.test(s)) os = "Linux";

  let browser = "Other";
  if (inApp) browser = "In-app";
  else if (/Edg\//.test(s)) browser = "Edge";
  else if (/OPR\/|Opera/.test(s)) browser = "Opera";
  else if (/SamsungBrowser/.test(s)) browser = "Samsung";
  else if (/Firefox\/|FxiOS/.test(s)) browser = "Firefox";
  else if (/Chrome\/|CriOS/.test(s)) browser = "Chrome";
  else if (/Safari\//.test(s)) browser = "Safari";

  let device: UAInfo["device"] = "desktop";
  if (BOT_RE.test(s) || !s) device = "bot";
  else if (/iPad|Tablet/.test(s) || (/Android/.test(s) && !/Mobile/.test(s))) device = "tablet";
  else if (/Mobi|iPhone|iPod|Android/.test(s)) device = "mobile";

  return { device, browser, os, inApp };
}

/** Returns a reason string when the request looks automated, otherwise null. */
export function botReason(ua: string | null | undefined, headers: Headers, cf?: Record<string, unknown>): string | null {
  const s = ua || "";
  if (!s) return "no_ua";
  if (BOT_RE.test(s)) return "ua";
  const score = (cf?.botManagement as { score?: number } | undefined)?.score;
  if (typeof score === "number" && score < 10) return "cf_score";
  if ((cf?.verifiedBotCategory as string | undefined)) return "verified_bot";
  if (!headers.get("accept-language")) return "no_lang";
  return null;
}
