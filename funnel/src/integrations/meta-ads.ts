// Ad spend: Meta Insights pulled hourly (last 7 days, ad level, daily rows) into ad_spend, plus a
// CSV import for every other platform. Also backfills each lead's first ad touch (lead_revops.ft_*).

import type { Runtime } from "../app";
import { BRAND } from "../config";
import { kvGate, kvSet } from "../lib/kv";
import { localParts, validTimezone } from "./sequences";

const DAY = 86_400_000;
const GRAPH = "https://graph.facebook.com/v21.0";
export const INSIGHT_FIELDS = "ad_id,ad_name,adset_id,adset_name,campaign_id,campaign_name,spend,impressions,clicks,inline_link_clicks,date_start";

export interface SpendRow {
  platform: string;
  date: string;
  ad_id: string;
  ad_name: string | null;
  adset_id: string | null;
  adset_name: string | null;
  campaign_id: string | null;
  campaign_name: string | null;
  spend: number;
  impressions: number;
  clicks: number;
  link_clicks: number;
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const ID_RE = /^[A-Za-z0-9_:.-]{1,120}$/;
const txt = (v: unknown, n = 200): string | null => {
  if (v == null) return null;
  const s = String(v).replace(/[\u0000-\u001f]/g, " ").trim().slice(0, n);
  return s || null;
};
const nonNeg = (v: unknown): number => {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : 0;
};

export function dayKey(ms: number, tz: string): string {
  const p = localParts(ms, validTimezone(tz) ? tz : "UTC");
  return `${p.y}-${String(p.mo).padStart(2, "0")}-${String(p.d).padStart(2, "0")}`;
}

/** One Insights row → a clean SpendRow, or null when it is unusable. */
export function parseInsightsRow(raw: unknown): SpendRow | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const adId = txt(r.ad_id, 120);
  const date = txt(r.date_start, 10);
  if (!adId || !ID_RE.test(adId) || !date || !DATE_RE.test(date)) return null;
  return {
    platform: "meta", date, ad_id: adId,
    ad_name: txt(r.ad_name), adset_id: txt(r.adset_id, 120), adset_name: txt(r.adset_name),
    campaign_id: txt(r.campaign_id, 120), campaign_name: txt(r.campaign_name),
    spend: Math.round(nonNeg(r.spend) * 100) / 100,
    impressions: Math.round(nonNeg(r.impressions)), clicks: Math.round(nonNeg(r.clicks)), link_clicks: Math.round(nonNeg(r.inline_link_clicks)),
  };
}

/** Only follow paging links back to the Graph API. */
export function safeNextUrl(next: unknown): string | null {
  if (typeof next !== "string") return null;
  try {
    const u = new URL(next);
    return u.protocol === "https:" && u.hostname === "graph.facebook.com" ? u.toString() : null;
  } catch {
    return null;
  }
}

export function insightsUrl(accountId: string, since: string, until: string): string {
  const p = new URLSearchParams({
    level: "ad", time_increment: "1", fields: INSIGHT_FIELDS, limit: "500",
    time_range: JSON.stringify({ since, until }),
  });
  return `${GRAPH}/act_${encodeURIComponent(accountId)}/insights?${p.toString()}`;
}

export async function upsertSpend(rt: Runtime, rows: SpendRow[], source: "api" | "csv"): Promise<number> {
  if (!rows.length) return 0;
  const now = rt.now();
  const stmt = rt.env.DB.prepare(
    `INSERT INTO ad_spend (platform, date, ad_id, ad_name, adset_id, adset_name, campaign_id, campaign_name, spend, impressions, clicks, link_clicks, source, updated_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)
     ON CONFLICT(platform, date, ad_id) DO UPDATE SET ad_name = excluded.ad_name, adset_id = excluded.adset_id, adset_name = excluded.adset_name,
       campaign_id = excluded.campaign_id, campaign_name = excluded.campaign_name, spend = excluded.spend, impressions = excluded.impressions,
       clicks = excluded.clicks, link_clicks = excluded.link_clicks, source = excluded.source, updated_at = excluded.updated_at`,
  );
  for (let i = 0; i < rows.length; i += 50) {
    await rt.env.DB.batch(rows.slice(i, i + 50).map((r) => stmt.bind(
      r.platform, r.date, r.ad_id, r.ad_name, r.adset_id, r.adset_name, r.campaign_id, r.campaign_name, r.spend, r.impressions, r.clicks, r.link_clicks, source, now,
    )));
  }
  return rows.length;
}

export interface SyncResult { ok: boolean; rows: number; pages: number; error?: string }

/** Hourly: the last 7 days of Meta spend by ad and day. Gated; `force` skips the gate (admin button). */
export async function syncMetaSpend(rt: Runtime, force = false): Promise<SyncResult | null> {
  const s = rt.settings;
  const token = s.get("META_ADS_TOKEN");
  const account = s.get("META_AD_ACCOUNT_ID").replace(/^act_/, "");
  if (!token || !account) return null;
  if (!/^\d{3,25}$/.test(account)) return { ok: false, rows: 0, pages: 0, error: "Ad account id should be digits only" };
  if (!force && !(await kvGate(rt.env, "gate:meta_ads", 55 * 60_000, rt.now()))) return null;
  const tz = validTimezone(s.get("SALES_TIMEZONE")) ? s.get("SALES_TIMEZONE") : BRAND.salesTimezone;
  const now = rt.now();
  let url: string | null = insightsUrl(account, dayKey(now - 6 * DAY, tz), dayKey(now, tz));
  let rows = 0, pages = 0;
  try {
    while (url && pages < 25) {
      const r = await fetch(url, { headers: { authorization: `Bearer ${token}` } });
      const j = (await r.json().catch(() => ({}))) as { data?: unknown[]; paging?: { next?: string }; error?: { message?: string } };
      if (!r.ok) throw new Error(`meta ${r.status}: ${(j.error?.message || "").slice(0, 200)}`);
      pages++;
      const parsed = (j.data || []).map(parseInsightsRow).filter((x): x is SpendRow => !!x);
      rows += await upsertSpend(rt, parsed, "api");
      url = safeNextUrl(j.paging?.next);
    }
    await kvSet(rt.env, "meta_ads:last_ok", String(now));
    await kvSet(rt.env, "meta_ads:last_error", "");
    return { ok: true, rows, pages };
  } catch (e) {
    const msg = (e instanceof Error ? e.message : String(e)).replace(/access_token=[^&\s"]+/g, "access_token=…").slice(0, 300);
    await kvSet(rt.env, "meta_ads:last_error", `${new Date(now).toISOString()} ${msg}`);
    return { ok: false, rows, pages, error: msg };
  }
}

// ── CSV import (other platforms) ─────────────────────────────────────────────

/** RFC 4180-ish: quoted fields, doubled quotes, commas or semicolons. */
export function parseCsv(text: string): string[][] {
  const out: string[][] = [];
  const firstLine = text.split(/\r?\n/, 1)[0] || "";
  const delim = (firstLine.match(/;/g) || []).length > (firstLine.match(/,/g) || []).length ? ";" : ",";
  let row: string[] = [], cell = "", q = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (q) {
      if (ch === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else q = false; }
      else cell += ch;
    } else if (ch === '"') q = true;
    else if (ch === delim) { row.push(cell); cell = ""; }
    else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      row.push(cell); cell = "";
      if (row.some((c) => c.trim() !== "")) out.push(row);
      row = [];
    } else cell += ch;
  }
  row.push(cell);
  if (row.some((c) => c.trim() !== "")) out.push(row);
  return out;
}

const ALIASES: Record<string, string> = {
  date: "date", day: "date", reporting_starts: "date", date_start: "date",
  platform: "platform", source: "platform", network: "platform",
  ad_id: "ad_id", ad: "ad_id", creative_id: "ad_id",
  ad_name: "ad_name", adset_id: "adset_id", ad_set_id: "adset_id", ad_group_id: "adset_id", adset_name: "adset_name", ad_set_name: "adset_name", ad_group: "adset_name", ad_group_name: "adset_name",
  campaign_id: "campaign_id", campaign: "campaign_name", campaign_name: "campaign_name",
  spend: "spend", cost: "spend", amount_spent: "spend", amount_spent_usd: "spend",
  impressions: "impressions", clicks: "clicks", link_clicks: "link_clicks",
};

/** Parse a spend CSV. Needs a date and spend column, plus an ad id or a campaign name. */
export function parseSpendCsv(text: string, defaultPlatform = "other"): { rows: SpendRow[]; errors: string[] } {
  const grid = parseCsv(text.replace(/^﻿/, ""));
  const errors: string[] = [];
  if (grid.length < 2) return { rows: [], errors: ["The file needs a header row and at least one data row."] };
  const head = grid[0].map((h) => ALIASES[h.trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "")] || "");
  const col = (k: string) => head.indexOf(k);
  if (col("date") < 0 || col("spend") < 0) return { rows: [], errors: ["Columns date and spend are required."] };
  if (col("ad_id") < 0 && col("campaign_name") < 0) return { rows: [], errors: ["Add an ad_id or a campaign column."] };
  const plat = (v: string | null) => (v || defaultPlatform).toLowerCase().replace(/[^a-z0-9_-]/g, "").slice(0, 30) || "other";
  const rows = new Map<string, SpendRow>();
  for (let i = 1; i < grid.length && i <= 20_000; i++) {
    const r = grid[i];
    const get = (k: string) => (col(k) >= 0 ? txt(r[col(k)]) : null);
    let date = get("date") || "";
    const m = date.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/);
    if (m) date = `${m[1]}-${m[2].padStart(2, "0")}-${m[3].padStart(2, "0")}`;
    if (!DATE_RE.test(date)) { errors.push(`Row ${i + 1}: date must be YYYY-MM-DD.`); continue; }
    const spend = Number(String(get("spend") || "").replace(/[^0-9.-]/g, ""));
    if (!Number.isFinite(spend) || spend < 0) { errors.push(`Row ${i + 1}: spend is not a number.`); continue; }
    const campaign = get("campaign_name");
    const adId = get("ad_id") || (campaign ? `campaign:${campaign.toLowerCase().slice(0, 100)}` : null);
    if (!adId || !ID_RE.test(adId.replace(/\s/g, "_"))) { errors.push(`Row ${i + 1}: missing ad id or campaign.`); continue; }
    const row: SpendRow = {
      platform: plat(get("platform")), date, ad_id: adId.replace(/\s/g, "_"),
      ad_name: get("ad_name"), adset_id: get("adset_id"), adset_name: get("adset_name"),
      campaign_id: get("campaign_id"), campaign_name: campaign,
      spend: Math.round(spend * 100) / 100, impressions: Math.round(nonNeg(get("impressions"))), clicks: Math.round(nonNeg(get("clicks"))), link_clicks: Math.round(nonNeg(get("link_clicks"))),
    };
    const k = `${row.platform}|${row.date}|${row.ad_id}`;
    const prev = rows.get(k);
    if (prev) { prev.spend = Math.round((prev.spend + row.spend) * 100) / 100; prev.impressions += row.impressions; prev.clicks += row.clicks; prev.link_clicks += row.link_clicks; }
    else rows.set(k, row);
  }
  return { rows: [...rows.values()], errors: errors.slice(0, 20) };
}

// ── First ad touch per lead ──────────────────────────────────────────────────

/** Leads linked to a visitor after insert (or before the trigger existed) get their first ad touch. */
export async function backfillAdTouch(rt: Runtime, sinceMs?: number): Promise<number> {
  const since = sinceMs ?? rt.now() - 3 * DAY;
  const r = await rt.env.DB.prepare(
    `INSERT INTO lead_revops (lead_id, ft_ad_id, ft_adset_id, ft_placement, updated_at)
     SELECT l.id, s.ad_id, s.adset_id, s.placement, ?1 FROM leads l
     JOIN sessions s ON s.id = (SELECT s2.id FROM sessions s2 WHERE (s2.visitor_id = l.visitor_id OR s2.lead_id = l.id) AND s2.ad_id IS NOT NULL AND s2.ad_id != '' ORDER BY s2.started_at LIMIT 1)
     WHERE l.created_at >= ?2
     ON CONFLICT(lead_id) DO UPDATE SET ft_ad_id = excluded.ft_ad_id, ft_adset_id = excluded.ft_adset_id, ft_placement = excluded.ft_placement, updated_at = excluded.updated_at
     WHERE lead_revops.ft_ad_id IS NULL`,
  ).bind(rt.now(), since).run();
  return r.meta?.changes ?? 0;
}

/** Cron: hourly backfill of first ad touch (gated). */
export async function hourlyAdTouch(rt: Runtime): Promise<number> {
  if (!(await kvGate(rt.env, "gate:adtouch", 55 * 60_000, rt.now()))) return 0;
  return backfillAdTouch(rt);
}
