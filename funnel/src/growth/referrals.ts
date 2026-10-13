// Referral loop. Every lead already has a ref_code ("OP-7KQ2MX", not a secret); their personal link is
// /?r=<ref_code>. A visit through it is captured first-touch (visitor_referrals) plus a first-party
// functional cookie (same lifetime rule as the visitor id), and a D1 trigger stamps lead_referrals when that
// visitor becomes a lead. Referred visitors see "Referred by <first name>" and are never gated.

import type { Ctx, Runtime } from "../app";
import { COOKIE, functionalCookie, type Identity } from "../lib/identity";
import { getCookie } from "hono/cookie";
import { safeFirstName } from "../lib/text";

const REF_RE = /^OP-[A-Z0-9]{6}$/;

export function cleanRef(v: unknown): string | null {
  const s = String(v ?? "").trim().toUpperCase();
  return REF_RE.test(s) ? s : null;
}

export function referralLink(rt: Runtime, refCode: string): string {
  return `${rt.origin}/?r=${encodeURIComponent(refCode)}`;
}

/** REFERRAL_REWARD: optional, real reward text set by the owner. Empty means no reward line anywhere. */
export function referralReward(rt: Runtime): string {
  return rt.settings.get("REFERRAL_REWARD").replace(/\s+/g, " ").trim().slice(0, 200);
}

interface Referrer { id: string; first_name: string | null }

const cache = new Map<string, { at: number; r: Referrer | null }>();
async function referrerByCode(rt: Runtime, code: string): Promise<Referrer | null> {
  const hit = cache.get(code);
  if (hit && rt.now() - hit.at < 60_000) return hit.r;
  const r = await rt.env.DB.prepare("SELECT id, first_name FROM leads WHERE ref_code = ?").bind(code).first<Referrer>();
  cache.set(code, { at: rt.now(), r: r || null });
  if (cache.size > 200) cache.delete(cache.keys().next().value as string);
  return r || null;
}

export interface ReferralView { code: string; first: string }

/**
 * Page renders: read ?r= (or the cookie), check it belongs to a real lead other than this visitor, keep it
 * first-touch, and return what the chip shows (first name only, or "" when the name is not printable).
 */
export async function captureReferral(c: Ctx, id: Identity, opts: { preview?: boolean } = {}): Promise<ReferralView | null> {
  const rt = c.get("rt");
  const fromQuery = cleanRef(new URL(c.req.url).searchParams.get("r"));
  const fromCookie = cleanRef(getCookie(c, COOKIE.referral));
  // First touch: an earlier referral cookie wins over a later link.
  const code = fromCookie || fromQuery;
  if (!code) return null;
  let ref: Referrer | null = null;
  try { ref = await referrerByCode(rt, code); } catch { return null; }
  if (!ref || ref.id === id.leadId) return null;
  if (opts.preview || id.isPrefetch || id.isBot) return { code, first: safeFirstName(ref.first_name, "") };
  if (!fromCookie || fromQuery === code) functionalCookie(c, COOKIE.referral, code, id.adsAllowed);
  const visitorId = id.visitorId, refId = ref.id, now = rt.now();
  rt.waitUntil((async () => {
    if (id.pending) await id.pending;
    await rt.env.DB.prepare("INSERT OR IGNORE INTO visitor_referrals (visitor_id, ref_code, referrer_lead_id, first_at) VALUES (?,?,?,?)")
      .bind(visitorId, code, refId, now).run();
  })());
  return { code, first: safeFirstName(ref.first_name, "") };
}

/** Admin "Referrals": leaderboard and referred → applied → booked → won. */
export async function referralsReport(rt: Runtime) {
  const db = rt.env.DB;
  const [board, visits, totals] = await Promise.all([
    db.prepare(
      `SELECT r.referrer_lead_id AS id, p.first_name, p.last_name, p.ref_code, p.status,
         COUNT(*) AS referred, SUM(l.app_completed_at IS NOT NULL) AS applied,
         SUM(l.app_completed_at IS NOT NULL AND COALESCE(l.tier_override, l.tier) IN ('A','B')) AS qualified,
         SUM(l.booked_at IS NOT NULL) AS booked, SUM(l.status = 'won') AS won, COALESCE(SUM(l.cash_collected), 0) AS cash
       FROM lead_referrals r JOIN leads l ON l.id = r.lead_id LEFT JOIN leads p ON p.id = r.referrer_lead_id
       GROUP BY r.referrer_lead_id ORDER BY won DESC, booked DESC, referred DESC LIMIT 100`,
    ).all<{ id: string; first_name: string | null; last_name: string | null; ref_code: string | null; status: string | null; referred: number; applied: number; qualified: number; booked: number; won: number; cash: number }>(),
    db.prepare("SELECT referrer_lead_id AS id, COUNT(*) AS n FROM visitor_referrals GROUP BY referrer_lead_id").all<{ id: string; n: number }>(),
    db.prepare(
      `SELECT COUNT(*) AS referred, SUM(l.app_completed_at IS NOT NULL) AS applied, SUM(l.booked_at IS NOT NULL) AS booked,
         SUM(l.status = 'won') AS won, COALESCE(SUM(l.cash_collected), 0) AS cash FROM lead_referrals r JOIN leads l ON l.id = r.lead_id`,
    ).first<{ referred: number; applied: number | null; booked: number | null; won: number | null; cash: number | null }>(),
  ]);
  const visitsBy = new Map((visits.results || []).map((v) => [v.id, v.n]));
  const n = (v: number | null | undefined) => Number(v || 0);
  const rate = (a: number, b: number) => (b ? Math.round((a / b) * 1000) / 10 : null);
  const t = { visitors: [...visitsBy.values()].reduce((a, b) => a + b, 0), referred: n(totals?.referred), applied: n(totals?.applied), booked: n(totals?.booked), won: n(totals?.won), cash: n(totals?.cash) };
  return {
    reward: referralReward(rt),
    totals: { ...t, booked_rate: rate(t.booked, t.referred), won_rate: rate(t.won, t.booked) },
    leaderboard: (board.results || []).map((r) => ({
      id: r.id, name: [r.first_name, r.last_name].filter(Boolean).join(" ") || r.ref_code || "Erased", ref: r.ref_code, status: r.status,
      visitors: visitsBy.get(r.id) || 0, referred: r.referred, applied: n(r.applied), qualified: n(r.qualified), booked: n(r.booked), won: n(r.won), cash: n(r.cash),
      booked_rate: rate(n(r.booked), r.referred), won_rate: rate(n(r.won), n(r.booked)),
    })),
  };
}
