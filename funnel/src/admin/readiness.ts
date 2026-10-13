// Launch readiness: the checks that must pass before money goes into ads, shown at the top of Overview
// for owners and managers, with a red bar when ads spent in the last 7 days while a required check fails.
// "Go live" clears the backlog of emails that queued up while testing (older than an hour), so the first
// real lead does not trigger a burst of stale sends.

import type { Runtime } from "../app";
import { RESOURCES, VIDEOS } from "../config";
import { kvGetJson, kvSet } from "../lib/kv";
import type { DnsCheck } from "../integrations/email-dns";
import { one, spendBetween } from "./stats";

const DAY = 86_400_000;

export interface Check {
  id: string;
  label: string;
  ok: boolean;
  required: boolean;
  detail: string;
  /** Where to fix it: an HQ hash ("#integrations") or a manual confirmation key. */
  fix?: string;
  confirm?: string;
}

export interface DnsCache { at: number; domain: string | null; pass: boolean; failing: string[]; error?: string }
export const DNS_CACHE_KEY = "hq:dns_check";

export async function cacheDnsResult(rt: Runtime, r: { domain: string | null; checks: DnsCheck[]; error?: string }): Promise<void> {
  const failing = r.checks.filter((c) => c.state === "fail").map((c) => c.label);
  const v: DnsCache = { at: rt.now(), domain: r.domain, pass: !r.error && r.checks.length > 0 && failing.length === 0, failing, error: r.error };
  await kvSet(rt.env, DNS_CACHE_KEY, JSON.stringify(v));
}

/** Pure: the cue-point check. Observed = the longest duration players reported for the main film. */
export function ctaCheck(ctaRevealAt: number, configured: number, observed: number | null): { ok: boolean; detail: string } {
  if (!(ctaRevealAt > 0)) return { ok: false, detail: "ctaRevealAt is 0: the offer never unlocks. Set it in src/config.ts to the second the offer starts." };
  if (ctaRevealAt >= configured) return { ok: false, detail: `ctaRevealAt (${ctaRevealAt}s) is after the end of the film (${configured}s in config).` };
  if (observed && observed > 30) {
    if (ctaRevealAt >= observed) return { ok: false, detail: `ctaRevealAt (${ctaRevealAt}s) is after the end of the uploaded film (${Math.round(observed)}s).` };
    if (Math.abs(observed - configured) / observed > 0.1) return { ok: false, detail: `The uploaded film is ${Math.round(observed)}s but config says ${configured}s. Update the duration and check ctaRevealAt (${ctaRevealAt}s).` };
    return { ok: true, detail: `Offer unlocks at ${ctaRevealAt}s of ${Math.round(observed)}s (${Math.round((ctaRevealAt / observed) * 100)}% in).` };
  }
  return { ok: true, detail: `Offer unlocks at ${ctaRevealAt}s of ${configured}s. Confirms against the real film once people watch it.` };
}

const has = (rt: Runtime, ...keys: string[]) => keys.every((k) => rt.settings.has(k));

export async function readiness(rt: Runtime) {
  const s = rt.settings;
  const now = rt.now();
  const [dns, observed, testLeads, spend7] = await Promise.all([
    kvGetJson<DnsCache | null>(rt.env, DNS_CACHE_KEY, null),
    one<{ d: number | null }>(rt, "SELECT MAX(duration) AS d FROM vsl_views WHERE video = 'main' AND duration > 0").catch(() => null),
    one<{ n: number }>(rt, "SELECT COUNT(*) AS n FROM lead_revops r JOIN leads l ON l.id = r.lead_id WHERE r.is_test = 1").catch(() => null),
    spendBetween(rt, now - 7 * DAY, now),
  ]);
  const main = VIDEOS.main;
  const cta = ctaCheck(main.ctaRevealAt, main.duration, observed?.d ? Number(observed.d) : null);
  const publicUrl = s.get("PUBLIC_URL");
  const resourcesOk = (RESOURCES as unknown as Array<Record<string, unknown>>).every((r) => typeof r.url === "string" && /^https?:\/\//.test(r.url as string))
    || ["RESOURCE_URLS", "RESOURCE_URL_1"].some((k) => s.has(k));
  const nTest = Number(testLeads?.n) || 0;
  const checks: Check[] = [
    { id: "address", label: "Postal address and contact on the privacy page", ok: has(rt, "BUSINESS_ADDRESS") && (has(rt, "EMAIL_REPLY_TO") || has(rt, "EMAIL_FROM")), required: true,
      detail: has(rt, "BUSINESS_ADDRESS") ? "No placeholders left on /privacy or in email footers." : "/privacy and every email footer still say [postal address]. Set BUSINESS_ADDRESS.", fix: "#integrations" },
    { id: "reply_to", label: "Reply-to address", ok: has(rt, "EMAIL_REPLY_TO"), required: true, detail: has(rt, "EMAIL_REPLY_TO") ? "Replies reach a person." : "Emails ask people to reply. Set EMAIL_REPLY_TO to an inbox someone reads.", fix: "#integrations" },
    { id: "film", label: "Film uploaded", ok: has(rt, "VSL_MAIN_SRC"), required: true, detail: has(rt, "VSL_MAIN_SRC") ? "VSL_MAIN_SRC is set." : "The landing page has no film. Set VSL_MAIN_SRC (MP4 or HLS).", fix: "#integrations" },
    { id: "cta", label: "Offer unlocks at the right second", ok: cta.ok, required: true, detail: cta.detail },
    { id: "turnstile", label: "Bot protection (Turnstile)", ok: has(rt, "TURNSTILE_SITE_KEY", "TURNSTILE_SECRET_KEY"), required: true, detail: has(rt, "TURNSTILE_SITE_KEY", "TURNSTILE_SECRET_KEY") ? "Scripts cannot mass-create applications." : "Add both Turnstile keys.", fix: "#integrations" },
    { id: "calendly", label: "Calendly connected", ok: has(rt, "CALENDLY_API_TOKEN", "CALENDLY_SIGNING_KEY"), required: true, detail: has(rt, "CALENDLY_API_TOKEN", "CALENDLY_SIGNING_KEY") ? "Bookings are verified by signed webhook." : "Paste the token and press Connect in Integrations → Calendly.", fix: "#integrations" },
    { id: "email", label: "Email sending (Resend) and DNS", ok: has(rt, "RESEND_API_KEY", "EMAIL_FROM") && !!dns?.pass, required: true,
      detail: !has(rt, "RESEND_API_KEY", "EMAIL_FROM") ? "Emails are simulated. Add the Resend key and From address."
        : !dns ? "Run the DNS check (SPF, DKIM, DMARC)." : dns.pass ? `DNS passes for ${dns.domain}.` : `DNS check failing: ${dns.error || dns.failing.join(", ")}.`,
      fix: "dns" },
    { id: "meta", label: "Meta Pixel and Conversions API", ok: has(rt, "META_PIXEL_ID", "META_ACCESS_TOKEN"), required: true, detail: has(rt, "META_PIXEL_ID", "META_ACCESS_TOKEN") ? (s.has("META_TEST_EVENT_CODE") ? "Connected, but the test event code is still set: clear it." : "Connected.") : "Ads cannot optimise for qualified leads without it.", fix: "#integrations" },
    { id: "resources", label: "Starter-kit links for C-tier leads", ok: resourcesOk, required: false, detail: resourcesOk ? "Every resource has a link." : "/resources lists resources without links yet.", fix: "#integrations" },
    { id: "photo", label: "Founder photo", ok: has(rt, "FOUNDER_PHOTO_URL"), required: false, detail: has(rt, "FOUNDER_PHOTO_URL") ? "Set." : "Optional: a face next to the founder's name builds trust." },
    { id: "privacy_reviewed", label: "Privacy policy reviewed by a lawyer", ok: s.bool("PRIVACY_REVIEWED"), required: true, detail: s.bool("PRIVACY_REVIEWED") ? "Confirmed." : "/privacy is a draft that matches the code. Tick this once a lawyer has reviewed it.", confirm: "PRIVACY_REVIEWED" },
    { id: "test_data", label: "Test data purged", ok: nTest === 0, required: true, detail: nTest ? `${nTest} test lead${nTest === 1 ? "" : "s"} still in the database. Purge them before launch.` : "No test leads left.", fix: "purge" },
    { id: "access", label: "Cloudflare Access in front of /admin", ok: s.bool("CF_ACCESS_CONFIRMED"), required: true, detail: s.bool("CF_ACCESS_CONFIRMED") ? "Confirmed." : "Funnel HQ cannot see this from inside. Add an Access application for /admin*, then tick this.", confirm: "CF_ACCESS_CONFIRMED" },
    { id: "domain", label: "Custom domain", ok: !!publicUrl && /^https:\/\//.test(publicUrl) && !/\.workers\.dev\b|localhost|127\.0\.0\.1/.test(publicUrl), required: true,
      detail: publicUrl ? (/workers\.dev|localhost|127\.0\.0\.1/.test(publicUrl) ? `PUBLIC_URL is ${publicUrl}: use your own domain.` : `Links in emails use ${publicUrl}.`) : "Set PUBLIC_URL to your live https domain.", fix: "#integrations" },
  ];
  const failing = checks.filter((c) => c.required && !c.ok);
  const goLive = await kvGetJson<{ at: number; skipped: number } | null>(rt.env, "hq:go_live", null);
  return {
    checks, passed: checks.filter((c) => c.ok).length, total: checks.length, required_failing: failing.length,
    spend_7d: spend7, red: spend7 > 0 && failing.length > 0, dns_checked_at: dns?.at ?? null, go_live: goLive,
  };
}

/**
 * Skip emails that queued up before launch: pending and due more than `olderThanMs` ago. Local stand-in for
 * skipBacklog() in src/integrations/sequences.ts (owned by the messaging work): swap the call when it lands.
 */
export async function skipBacklog(rt: Runtime, olderThanMs = 3_600_000): Promise<number> {
  const r = await rt.env.DB.prepare("UPDATE emails SET status = 'skipped', error = 'go-live: skipped backlog' WHERE status = 'pending' AND send_at < ?")
    .bind(rt.now() - olderThanMs).run();
  return r.meta?.changes ?? 0;
}

export async function goLive(rt: Runtime): Promise<{ skipped: number }> {
  const skipped = await skipBacklog(rt, 3_600_000);
  await kvSet(rt.env, "hq:go_live", JSON.stringify({ at: rt.now(), skipped }));
  return { skipped };
}
