// Public read-only API: /api/v1/{leads,deals,payments,calls,metrics/daily,spend}.
// Authorization: Bearer fk_<id>_<secret> with the matching scope. Keyset pagination: ?updated_since=<ms or ISO>
// &cursor=<from next_cursor>&limit=<1..200>. 120 requests a minute per key. No cookies, no CORS.

import { Hono } from "hono";
import type { AppEnv, Ctx, Runtime } from "../app";
import { authenticate, type ApiScope } from "../admin/api-keys";
import { kvIncr } from "../lib/kv";
import { periodNumbers } from "../sales/digest";
import { salesTz } from "../admin/stats";
import { zonedTime } from "../integrations/sequences";

export const v1 = new Hono<AppEnv>();
const DAY = 86_400_000;
const RATE_PER_MIN = 120;
// /metrics/daily runs four aggregate queries per day in the range: its own, tighter budget and range.
const METRICS_PER_MIN = 10;
export const METRICS_MAX_DAYS = 31;
const KEY_SCOPES = new WeakMap<Request, string[]>();
const KEY_IDS = new WeakMap<Request, string>();

v1.use("*", async (c, next) => {
  c.header("cache-control", "no-store");
  const rt = c.get("rt");
  const k = await authenticate(rt, c.req.header("authorization"));
  if (!k) return c.json({ error: "unauthorized" }, 401, { "www-authenticate": 'Bearer realm="funnel"' });
  if ((await kvIncr(rt.env, `apirl:${k.id}:${Math.floor(rt.now() / 60_000)}`)) > RATE_PER_MIN) return c.json({ error: "rate limited" }, 429, { "retry-after": "60" });
  KEY_SCOPES.set(c.req.raw, k.scopes);
  KEY_IDS.set(c.req.raw, k.id);
  await next();
});

function scoped(c: Ctx, scope: ApiScope): boolean {
  return (KEY_SCOPES.get(c.req.raw) || []).includes(scope);
}

export interface Page { since: number; afterTs: number; afterId: string; limit: number }

/** Pure: parse the paging parameters. Throws on a malformed cursor or date. */
export function parsePage(q: (k: string) => string | undefined): Page {
  const lim = Math.floor(Number(q("limit") || 100));
  const limit = Number.isFinite(lim) ? Math.max(1, Math.min(200, lim)) : 100;
  const s = q("updated_since");
  let since = 0;
  if (s) {
    since = /^\d{10,14}$/.test(s) ? Number(s) : Date.parse(s);
    if (!Number.isFinite(since)) throw new Error("updated_since must be epoch ms or an ISO date");
  }
  let afterTs = -1, afterId = "";
  const cur = q("cursor");
  if (cur) {
    let raw = "";
    try { raw = atob(cur.replace(/-/g, "+").replace(/_/g, "/")); } catch { throw new Error("bad cursor"); }
    const m = /^(\d{1,14}):([A-Za-z0-9|:._-]{1,120})$/.exec(raw);
    if (!m) throw new Error("bad cursor");
    afterTs = Number(m[1]); afterId = m[2];
  }
  return { since, afterTs, afterId, limit };
}

export function makeCursor(ts: number, id: string): string {
  return btoa(`${ts}:${id}`).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function pageOf(rt: Runtime, p: Page, sql: { from: string; where?: string; cols: string; ts: string; id: string }, binds: unknown[] = []) {
  const where = [`${sql.ts} >= ?`, `(${sql.ts} > ? OR (${sql.ts} = ? AND ${sql.id} > ?))`].concat(sql.where ? [sql.where] : []).join(" AND ");
  const rows = ((await rt.env.DB.prepare(`SELECT ${sql.cols}, ${sql.ts} AS _ts, ${sql.id} AS _id FROM ${sql.from} WHERE ${where} ORDER BY ${sql.ts}, ${sql.id} LIMIT ?`)
    .bind(p.since, p.afterTs, p.afterTs, sql.id === "rowid" ? Number(p.afterId) || 0 : p.afterId, ...binds, p.limit + 1).all<Record<string, unknown>>()).results) || [];
  const more = rows.length > p.limit;
  const data = rows.slice(0, p.limit);
  const last = data[data.length - 1];
  return {
    data: data.map(({ _ts: _a, _id: _b, ...r }) => r),
    has_more: more, next_cursor: more && last ? makeCursor(Number(last._ts), String(last._id)) : null,
  };
}

function list(scope: ApiScope, sql: { from: string; where?: string; cols: string; ts: string; id: string }) {
  return async (c: Ctx) => {
    if (!scoped(c, scope)) return c.json({ error: `this key lacks ${scope}` }, 403);
    let p: Page;
    try { p = parsePage((k) => c.req.query(k)); } catch (e) { return c.json({ error: e instanceof Error ? e.message : "bad request" }, 400); }
    return c.json(await pageOf(c.get("rt"), p, sql));
  };
}

const LEAD_COLS = `id, ref_code, created_at, updated_at, first_name, last_name, email, phone, status, score, COALESCE(tier_override, tier) AS tier,
  closer_id, setter_id, app_completed_at, booked_at, call_at, revenue, cash_collected, ft_channel, ft_source, ft_campaign, ft_content,
  utm_source, utm_campaign, country, industry, booking_source, unsubscribed_at`;

v1.get("/leads", list("leads:read", { from: "leads", cols: LEAD_COLS, ts: "updated_at", id: "id" }));
v1.get("/deals", list("deals:read", {
  from: "leads", where: "(status IN ('showed','won','lost') OR revenue > 0)", ts: "updated_at", id: "id",
  cols: `id, ref_code, updated_at, status, COALESCE(tier_override, tier) AS tier, closer_id, setter_id, revenue, cash_collected, offer, payment_plan,
    installments_total, next_payment_at, showed_at, closed_at, contract_signed_at, refunded_at, refund_amount, lost_reason, objection, temperature`,
}));
v1.get("/payments", list("payments:read", { from: "payments", cols: "id, lead_id, amount, paid_at, method, created_at", ts: "created_at", id: "id" }));
v1.get("/calls", list("calls:read", {
  from: "leads", where: "call_at IS NOT NULL", ts: "updated_at", id: "id",
  cols: "id AS lead_id, ref_code, updated_at, booked_at, call_at, status, closer_id, showed_at, booking_provider, booking_cancelled_at, booking_source",
}));
v1.get("/spend", list("spend:read", { from: "ad_spend", cols: "platform, date, ad_id, ad_name, adset_id, adset_name, campaign_id, campaign_name, spend, impressions, clicks, link_clicks, updated_at", ts: "updated_at", id: "rowid" }));

/** Daily funnel numbers in the sales time zone: ?from=YYYY-MM-DD&to=YYYY-MM-DD (at most 31 days, 10 calls a minute per key). */
v1.get("/metrics/daily", async (c) => {
  if (!scoped(c, "metrics:read")) return c.json({ error: "this key lacks metrics:read" }, 403);
  const rt = c.get("rt");
  const keyId = KEY_IDS.get(c.req.raw) || "";
  if ((await kvIncr(rt.env, `apirl:m:${keyId}:${Math.floor(rt.now() / 60_000)}`)) > METRICS_PER_MIN) return c.json({ error: "rate limited" }, 429, { "retry-after": "60" });
  const tz = salesTz(rt);
  const re = /^(\d{4})-(\d{2})-(\d{2})$/;
  const today = new Date(rt.now()).toISOString().slice(0, 10);
  const to = c.req.query("to") || today;
  const from = c.req.query("from") || new Date(rt.now() - 29 * DAY).toISOString().slice(0, 10);
  const a = re.exec(from), b = re.exec(to);
  if (!a || !b) return c.json({ error: "from and to must be YYYY-MM-DD" }, 400);
  const start = zonedTime(+a[1], +a[2], +a[3], 0, 0, tz), end = zonedTime(+b[1], +b[2], +b[3], 0, 0, tz) + DAY;
  // (+2 h: a daylight-saving change inside the range makes it an hour longer.)
  if (!(end > start) || end - start > METRICS_MAX_DAYS * DAY + 2 * 3_600_000) return c.json({ error: `range must be 1 to ${METRICS_MAX_DAYS} days` }, 400);
  const spend = ((await rt.env.DB.prepare("SELECT date, SUM(spend) AS s FROM ad_spend WHERE date >= ? AND date <= ? GROUP BY date").bind(from, to).all<{ date: string; s: number }>().catch(() => ({ results: [] }))).results) || [];
  const data = [];
  for (let t = start; t < end; t += DAY) {
    const day = new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(t + 12 * 3_600_000));
    const n = await periodNumbers(rt, t, Math.min(t + DAY, end));
    data.push({ date: day, ...n, spend: Number(spend.find((s) => s.date === day)?.s) || 0 });
  }
  return c.json({ timezone: tz, data });
});

v1.all("*", (c) => c.json({ error: "not found" }, 404));
