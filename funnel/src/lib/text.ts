// Helpers for text that strangers typed. Everything a lead, a beacon, a booking form or a caller
// provides is hostile until it passes through here.

const HTML_ESC: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };

export function escHtml(v: unknown): string {
  return String(v ?? "").replace(/[&<>"']/g, (c) => HTML_ESC[c]);
}

const NAMED: Record<string, string> = {
  lt: "<", gt: ">", quot: '"', "#39": "'", "#x27": "'", amp: "&",
  ldquo: "\u201c", rdquo: "\u201d", lsquo: "\u2018", rsquo: "\u2019", mdash: "\u2014", ndash: "\u2013", hellip: "\u2026", nbsp: " ",
};

/** Decode the entities our own templates and escHtml produce, in one pass (so "&amp;lt;" stays "&lt;"). */
export function unescHtml(v: string): string {
  return v.replace(/&(#39|#x27|lt|gt|quot|amp|ldquo|rdquo|lsquo|rsquo|mdash|ndash|hellip|nbsp);/g, (_m, k: string) => NAMED[k]);
}

const URL_RE = /\b(?:https?:\/\/|ftp:\/\/|www\.)[^\s<>"']+/gi;
const EMAIL_RE = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
// Bare domains like "evil-site.com" or "pay.me/x". TLD 2-24 letters.
const DOMAIN_RE = /\b(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+(?:[a-z]{2,24})(?:\/[^\s<>"']*)?/gi;
// Phone-ish: 7+ digits with optional separators and leading +.
const PHONE_RE = /(?:\+|\b)\d[\d\s().-]{6,}\d\b/g;

/** Replace links, bare domains, email addresses and phone numbers with […]. */
export function defang(v: unknown): string {
  return String(v ?? "")
    .replace(URL_RE, "[…]")
    .replace(EMAIL_RE, "[…]")
    .replace(DOMAIN_RE, (m) => (/^\d+(\.\d+)+$/.test(m) ? m : looksLikeDomain(m) ? "[…]" : m))
    .replace(PHONE_RE, "[…]");
}

function looksLikeDomain(m: string): boolean {
  // Avoid eating ordinary abbreviations like "e.g" or "i.e" or "U.S" and decimal numbers.
  const host = m.split("/")[0].toLowerCase();
  const parts = host.split(".");
  const tld = parts[parts.length - 1];
  if (parts.length < 2) return false;
  if (tld.length < 2) return false;
  if (["eg", "ie", "us", "uk", "vs", "etc"].includes(host.replace(/\./g, ""))) return false;
  if (parts.some((p) => p.length === 0)) return false;
  // Single-letter labels like "e.g" are not domains.
  if (parts.every((p) => p.length <= 1)) return false;
  return true;
}

export function hasContactBait(v: unknown): boolean {
  const s = String(v ?? "");
  return defang(s) !== s;
}

/** Collapse whitespace and cap length. */
export function clip(v: unknown, max: number): string {
  const s = String(v ?? "").replace(/\s+/g, " ").trim();
  return s.length > max ? s.slice(0, max - 1).trimEnd() + "…" : s;
}

/** Escape + defang + clip: the one call for quoting stranger text into HTML. */
export function quoteSafe(v: unknown, max = 280): string {
  return escHtml(defang(clip(v, max)));
}

/** Sanitise text for Slack/Discord: strip markup characters, break up links, no mentions. */
export function chatSafe(v: unknown, max = 120): string {
  return clip(defang(v), max)
    .replace(/[<>\[\]|`*_~@#]/g, "")
    .replace(/:\/\//g, ": //")
    .replace(/\bwww\./gi, "www .");
}

/** A first name that is safe to say aloud or print: letters, spaces, hyphen, apostrophe. */
export function safeFirstName(v: unknown, fallback = "there"): string {
  const s = clip(v, 40);
  if (!s) return fallback;
  if (!/^[\p{L}][\p{L}' -]{0,39}$/u.test(s)) return fallback;
  return s.split(" ")[0];
}

/** Business description safe for a voice prompt: no links or numbers, 120 chars. */
export function safeBusiness(v: unknown): string {
  // Clean first, then check the cleaned text, so stripped characters cannot hide a link or number.
  const clean = clip(v, 120).replace(/[^\p{L}\p{N} ,.&/-]/gu, "").replace(/\s+/g, " ").trim();
  if (!clean || hasContactBait(clean) || /\d{3,}/.test(clean.replace(/[^\d]/g, ""))) return "";
  return clean.length >= 3 ? clean : "";
}
