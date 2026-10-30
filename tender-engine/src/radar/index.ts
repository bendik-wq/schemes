// Project radar: pull public signals that come before RFQs, classify them, rank them for this supplier.
// Sources (no API keys): Google News RSS for award / FID / frame news, and TED contract-award notices.

import type { Env } from "../util";
import { parseList } from "../util";
import { loadProfile } from "../feeds";
import { CASCADES, classify, findBuyers, rankSignal, type Kind } from "./cascade";

const UA = "Northbid/1.0 (project radar)";

// Searches tuned to the moments that create supplier RFQs on the North Sea.
export function newsQueries(keywords: string[]): string[] {
  const base = [
    '"contract" (Equinor OR "Aker BP" OR "Vår Energi" OR ConocoPhillips OR OKEA OR DNO) awarded',
    '(Aibel OR "Aker Solutions" OR Subsea7 OR TechnipFMC OR Saipem OR DeepOcean) awarded contract North Sea',
    '(PDO OR "final investment decision" OR sanction) Norway field development',
    '"frame agreement" OR "MMO contract" offshore Norway',
    'decommissioning contract "North Sea"',
    '"offshore wind" contract awarded (Norway OR Denmark OR Netherlands OR UK)',
    'kontrakt tildelt offshore leverandør',
  ];
  const own = keywords.filter((k) => k.length > 3).slice(0, 3).map((k) => `"${k.replace(/"/g, "")}" contract offshore`);
  return [...base, ...own];
}

// Trade-press and press-release feeds. Unlike Google News, these answer requests from Cloudflare.
export const FEEDS: [string, string][] = [
  ["Offshore Energy", "https://www.offshore-energy.biz/feed/"],
  ["offshoreWIND.biz", "https://www.offshorewind.biz/feed/"],
  ["Offshore Engineer", "https://www.oedigital.com/news/latest?format=feed"],
  ["Splash247", "https://splash247.com/feed/"],
  ["World Oil", "https://www.worldoil.com/rss?feed=news"],
  ["Offshore Technology", "https://www.offshore-technology.com/feed/"],
  ["NS Energy", "https://www.nsenergybusiness.com/feed/"],
  ["Rigzone", "https://www.rigzone.com/news/rss/rigzone_latest.aspx"],
  ["Aker BP", "https://akerbp.com/en/feed/"],
  ["Cision Norge", "https://news.cision.com/no/rss/index?q=kontrakt"],
  ["E24", "https://e24.no/rss2/"],
];

export async function fetchFeed(name: string, url: string, fetcher = fetch): Promise<NewsItem[]> {
  const res = await fetcher(url, { headers: { "user-agent": "Mozilla/5.0 (compatible; Northbid/1.0)", accept: "application/rss+xml, application/xml, text/xml" }, redirect: "follow" });
  if (!res.ok) throw new Error(`${name} ${res.status}`);
  return parseRss(await res.text()).map((i) => ({ ...i, outlet: i.outlet || name })).slice(0, 60);
}

export interface NewsItem { title: string; url: string; outlet: string; publishedAt: string | null }

const decode = (s: string) =>
  s.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/<[^>]+>/g, "").trim();

export function parseRss(xml: string): NewsItem[] {
  const out: NewsItem[] = [];
  for (const m of xml.matchAll(/<item>([\s\S]*?)<\/item>/g)) {
    const it = m[1];
    const get = (tag: string) => decode((it.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`)) ?? [])[1] ?? "");
    let title = get("title");
    const outlet = get("source");
    if (outlet && title.endsWith(` - ${outlet}`)) title = title.slice(0, -(outlet.length + 3));
    const url = get("link");
    const pd = get("pubDate");
    const t = Date.parse(pd);
    if (title && /^https:\/\//.test(url)) out.push({ title, url, outlet, publishedAt: Number.isFinite(t) ? new Date(t).toISOString() : null });
  }
  return out;
}

export async function fetchNews(q: string, fetcher = fetch): Promise<NewsItem[]> {
  const url = `https://news.google.com/rss/search?q=${encodeURIComponent(q + " when:60d")}&hl=en-GB&gl=GB&ceid=GB:en`;
  const res = await fetcher(url, { headers: { "user-agent": UA, accept: "application/rss+xml" } });
  if (!res.ok) throw new Error(`news ${res.status}`);
  return parseRss(await res.text()).slice(0, 40);
}

const COMMON = new Set("The A An And For Of In On To With By At From North Sea Norway Norwegian UK Offshore Subsea Contract Contracts Awarded Award Awards Wins Lands Secures Project Projects Field Development New Big FID Oil Gas Wind Farm Deal Agreement Frame Engineering".split(" "));
/** Distinctive capitalised words: company and project names ("Wisting", "Aibel", "Lyra"). */
export function nameTokens(title: string): Set<string> {
  return new Set((title.match(/\b[A-ZÆØÅ][\p{L}\d-]{2,}\b/gu) ?? []).filter((w) => !COMMON.has(w)).map((w) => w.toLowerCase()));
}

/** One story reported with different headlines: same kind, within 21 days, sharing two names. Keep the first. */
export function clusterStories<T extends NewsItem & { kind: string }>(items: T[]): T[] {
  const kept: (T & { _n: Set<string> })[] = [];
  for (const it of items) {
    const n = nameTokens(it.title);
    const t = it.publishedAt ? Date.parse(it.publishedAt) : 0;
    const dup = kept.some((k) => {
      if (k.kind !== it.kind) return false;
      const kt = k.publishedAt ? Date.parse(k.publishedAt) : 0;
      if (t && kt && Math.abs(t - kt) > 21 * 86_400_000) return false;
      let shared = 0;
      for (const w of n) if (k._n.has(w)) shared++;
      return shared >= 2 || (shared >= 1 && Math.min(n.size, k._n.size) === 1);
    });
    if (!dup) kept.push({ ...it, _n: n });
  }
  return kept.map(({ _n, ...rest }) => rest as unknown as T);
}

/** Same story syndicated by several outlets: keep one. */
export function dedupe(items: NewsItem[]): NewsItem[] {
  const seen = new Set<string>();
  return items.filter((i) => {
    const k = i.title.toLowerCase().replace(/[^a-z0-9æøå ]/g, "").split(" ").filter((w) => w.length > 3).slice(0, 7).sort().join(" ");
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

// ---------- TED contract awards: who wins, for how much, against how many ----------

const pick = (v: unknown): string => {
  if (!v) return "";
  if (typeof v === "string") return v;
  if (Array.isArray(v)) return pick(v[0]);
  if (typeof v === "object") { const o = v as Record<string, unknown>; return pick(o.eng ?? o.nor ?? o.dan ?? o.nld ?? Object.values(o)[0]); }
  return String(v);
};
const all = (v: unknown): string[] => {
  if (!v) return [];
  if (typeof v === "string") return [v];
  if (Array.isArray(v)) return v.flatMap(all);
  if (typeof v === "object") { const o = v as Record<string, unknown>; return all(o.eng ?? o.nor ?? o.dan ?? o.nld ?? Object.values(o)[0]); }
  return [String(v)];
};

export interface Award { ext_id: string; title: string; buyer: string; country: string; winners: string[]; winner_size: string[]; value_eur: number | null; bids_received: number | null; cpv: string[]; published_at: string | null; url: string }

export function mapAward(n: Record<string, unknown>): Award {
  const pub = String(n["publication-number"] ?? "");
  const value = Number(pick(n["result-value-notice"])) || null;
  const cur = pick(n["result-value-cur-notice"]);
  const toEur: Record<string, number> = { EUR: 1, NOK: 0.086, DKK: 0.134, SEK: 0.088, GBP: 1.17 };
  // Bid counts come per submission type ("tenders", "t-esubm"...); the largest is the number of bids. 0 means not stated.
  const bids = Math.max(0, ...all(n["received-submissions-type-val"]).map(Number).filter(Number.isFinite)) || null;
  return {
    ext_id: pub,
    title: pick(n["notice-title"]).replace(/^[^–]*–[^–]*–\s*/, "") || pub,
    buyer: pick(n["buyer-name"]),
    country: pick(n["buyer-country"]),
    winners: [...new Set(all(n["organisation-name-tenderer"]).concat(all(n["winner-name"])))].slice(0, 8),
    winner_size: [...new Set(all(n["winner-size"]))],
    value_eur: value == null ? null : Math.round(value * (toEur[cur] ?? 1)),
    bids_received: bids,
    cpv: [...new Set(all(n["classification-cpv"]))],
    published_at: (pick(n["publication-date"]).match(/^\d{4}-\d{2}-\d{2}/) ?? [null])[0],
    url: `https://ted.europa.eu/en/notice/-/detail/${encodeURIComponent(pub)}`,
  };
}

export async function fetchAwards(keywords: string[], cpv: string[], countries: string[], sinceYmd: string, fetcher = fetch): Promise<Award[]> {
  const ft = [...new Set([...keywords, "offshore", "subsea"])].map((w) => w.replace(/[^\p{L}\p{N} -]/gu, "").trim()).filter(Boolean).slice(0, 12).map((w) => (/\s/.test(w) ? `FT~"${w}"` : `FT~${w}`));
  const cp = cpv.map((c) => c.replace(/\D/g, "").slice(0, 8)).filter((c) => c.length >= 2).slice(0, 10).map((c) => `classification-cpv=${c}${c.length < 8 ? "*" : ""}`);
  const cc = (countries.length ? countries : ["NOR", "DNK", "NLD"]).filter((c) => /^[A-Z]{3}$/.test(c));
  const query = `notice-type IN (can-standard can-social can-desg can-tran) AND (${[...ft, ...cp].join(" OR ")}) AND buyer-country IN (${cc.join(" ")}) AND publication-date>=${sinceYmd}`;
  const res = await fetcher("https://api.ted.europa.eu/v3/notices/search", {
    method: "POST",
    headers: { "content-type": "application/json", "user-agent": UA },
    body: JSON.stringify({
      query, limit: 100, page: 1,
      fields: ["publication-number", "notice-title", "buyer-name", "buyer-country", "organisation-name-tenderer", "winner-name", "winner-size", "result-value-notice", "result-value-cur-notice", "received-submissions-type-val", "classification-cpv", "publication-date"],
    }),
  });
  if (!res.ok) throw new Error(`TED awards ${res.status}`);
  const d = (await res.json()) as { notices?: Record<string, unknown>[] };
  return (d.notices ?? []).map(mapAward);
}

// ---------- Run ----------

export async function runRadar(env: Env, fetcher = fetch): Promise<{ news: number; signals: number; awards: number; errors: string[] }> {
  const p = await loadProfile(env.DB);
  const errors: string[] = [];
  let items: NewsItem[] = [];
  const feedResults = await Promise.allSettled(FEEDS.map(([n, u]) => fetchFeed(n, u, fetcher)));
  feedResults.forEach((r, i) => (r.status === "fulfilled" ? items.push(...r.value) : errors.push(`${FEEDS[i][0]}: ${String(r.reason?.message ?? r.reason).slice(0, 80)}`)));
  // Google News adds breadth when it answers; it often refuses cloud IPs, so its failures are not reported.
  const gn = await Promise.allSettled(newsQueries(p.keywords).map((q) => fetchNews(q, fetcher)));
  for (const r of gn) if (r.status === "fulfilled") items.push(...r.value);
  const cutoff = Date.now() - 120 * 86_400_000;
  items = items.filter((i) => !i.publishedAt || Date.parse(i.publishedAt) >= cutoff);
  items = dedupe(items);
  // Newest first so the cluster keeps the latest report of each story.
  items.sort((a, b) => Date.parse(b.publishedAt ?? "0") - Date.parse(a.publishedAt ?? "0"));
  const classified = clusterStories(items.map((it) => ({ ...it, kind: classify(it.title) as Kind })).filter((it) => it.kind !== "other"));
  const stmts: D1PreparedStatement[] = [];
  let kept = 0;
  for (const it of classified) {
    const kind: Kind = it.kind;
    const buyers = findBuyers(it.title);
    const c = CASCADES[kind];
    const r = rankSignal({ title: it.title, kind, buyers, packages: c.packages, publishedAt: it.publishedAt }, p);
    kept++;
    stmts.push(env.DB.prepare(
      `INSERT INTO signals (source, ext_id, kind, title, url, outlet, published_at, buyers, packages, window, relevance, reasons)
       VALUES ('news',?,?,?,?,?,?,?,?,?,?,?)
       ON CONFLICT (source, ext_id) DO UPDATE SET relevance = excluded.relevance, reasons = excluded.reasons`,
    ).bind(it.url, kind, it.title, it.url, it.outlet, it.publishedAt, JSON.stringify(buyers), JSON.stringify(r.matched.length ? r.matched : c.packages.slice(0, 6)), c.window, r.score, JSON.stringify(r.reasons)));
  }

  let awards: Award[] = [];
  try {
    const since = new Date(Date.now() - 540 * 86_400_000).toISOString().slice(0, 10).replace(/-/g, "");
    awards = await fetchAwards(p.keywords, p.cpv, p.countries.filter((c) => c !== "GBR"), since, fetcher);
  } catch (e) { errors.push(String((e as Error).message)); }
  const kw = p.keywords.map((k) => k.toLowerCase());
  for (const a of awards) {
    if (!a.ext_id) continue;
    const hay = a.title.toLowerCase();
    const rel = Math.min(100, (kw.filter((k) => hay.includes(k)).length * 25) + (a.cpv.some((c) => p.cpv.some((pre) => pre && c.startsWith(pre))) ? 30 : 0) + (/offshore|subsea|wind|north sea/.test(hay) ? 20 : 0));
    stmts.push(env.DB.prepare(
      `INSERT INTO awards (ext_id, title, buyer, country, winners, winner_size, value_eur, bids_received, cpv, published_at, url, relevance)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT (ext_id) DO UPDATE SET relevance = excluded.relevance`,
    ).bind(a.ext_id, a.title, a.buyer, a.country, JSON.stringify(a.winners), JSON.stringify(a.winner_size), a.value_eur, a.bids_received, JSON.stringify(a.cpv), a.published_at, a.url, rel));
  }
  for (let i = 0; i < stmts.length; i += 60) await env.DB.batch(stmts.slice(i, i + 60));
  return { news: items.length, signals: kept, awards: awards.length, errors };
}

/** Re-rank stored news signals after a profile change. */
export async function rerankSignals(db: D1Database): Promise<void> {
  const p = await loadProfile(db);
  const { results } = await db.prepare("SELECT id, kind, title, buyers, published_at FROM signals").all<Record<string, string>>();
  const stmts = results.map((s) => {
    const kind = s.kind as Kind;
    const r = rankSignal({ title: s.title, kind, buyers: parseList(s.buyers), packages: CASCADES[kind]?.packages ?? [], publishedAt: s.published_at }, p);
    return db.prepare("UPDATE signals SET relevance = ?, reasons = ?, packages = ? WHERE id = ?")
      .bind(r.score, JSON.stringify(r.reasons), JSON.stringify(r.matched.length ? r.matched : (CASCADES[kind]?.packages ?? []).slice(0, 6)), s.id);
  });
  for (let i = 0; i < stmts.length; i += 60) await db.batch(stmts.slice(i, i + 60));
}
