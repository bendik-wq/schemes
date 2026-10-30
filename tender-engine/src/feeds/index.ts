// Public tender feeds. Neither needs an API key.
//  TED (EU + EEA, so Norway's above-threshold notices): POST https://api.ted.europa.eu/v3/notices/search
//  UK Find a Tender (OCDS):                             GET  https://www.find-tender.service.gov.uk/api/1.0/ocdsReleasePackages

import type { Env } from "../util";
import { parseList } from "../util";
import { scoreTender, STRONG_OFFSHORE_TERMS, type Profile, type TenderLike } from "../match";

export interface FeedTender extends TenderLike {
  source: "ted" | "fts";
  ext_id: string;
  published_at: string | null;
  url: string;
}

const pickLang = (v: unknown): string => {
  if (!v) return "";
  if (typeof v === "string") return v;
  if (Array.isArray(v)) return pickLang(v[0]);
  if (typeof v === "object") {
    const o = v as Record<string, unknown>;
    return pickLang(o.eng ?? o.nor ?? o.nob ?? o.dan ?? o.nld ?? Object.values(o)[0]);
  }
  return String(v);
};

const isoDate = (s: unknown): string | null => {
  const raw = pickLang(s);
  if (!raw) return null;
  // TED dates look like "2026-10-20+02:00" or "2026-11-30Z"; keep the calendar date.
  const m = raw.match(/^(\d{4}-\d{2}-\d{2})(T[\d:.]+)?/);
  return m ? m[1] + (m[2] ? m[2] + "Z" : "T23:59:00Z") : null;
};

// TED's expert query: one FT~ per term works; a parenthesised OR list inside FT~ silently returns nothing.
export function tedQuery(p: Profile, sinceYmd: string): string {
  const words = [...new Set([...p.keywords, "offshore", "subsea"])].filter(Boolean).slice(0, 14);
  const ft = words
    .map((w) => w.replace(/[^\p{L}\p{N} -]/gu, "").trim())
    .filter(Boolean)
    .map((w) => (/\s/.test(w) ? `FT~"${w}"` : `FT~${w}`));
  const cpv = p.cpv.map((c) => c.replace(/\D/g, "").slice(0, 8)).filter((c) => c.length >= 2).slice(0, 10).map((c) => (c.length === 8 ? `classification-cpv=${c}` : `classification-cpv=${c}*`));
  const countries = (p.countries.length ? p.countries : ["NOR"]).map((c) => c.toUpperCase().replace(/[^A-Z]/g, "")).filter((c) => c.length === 3);
  return `(${[...ft, ...cpv].join(" OR ")}) AND buyer-country IN (${countries.join(" ")}) AND publication-date>=${sinceYmd}`;
}

export function mapTed(n: Record<string, unknown>): FeedTender {
  const pub = String(n["publication-number"] ?? "");
  const cpv = [...new Set(((n["classification-cpv"] as string[]) ?? []).map(String))];
  const title = pickLang(n["notice-title"]).replace(/^[^–]*–[^–]*–\s*/, ""); // "Norway – Category – Title" → "Title"
  const value = Number(pickLang(n["estimated-value-lot"])) || null;
  return {
    source: "ted",
    ext_id: pub,
    title: title || pub,
    buyer: pickLang(n["buyer-name"]),
    country: pickLang(n["buyer-country"]),
    cpv,
    description: pickLang(n["description-lot"]).slice(0, 4000),
    published_at: isoDate(n["publication-date"]),
    // Open procedures carry a tender deadline; restricted ones a request-to-participate deadline.
    deadline_at: isoDate(n["deadline-receipt-tender-date-lot"]) ?? isoDate(n["deadline-receipt-request-date-lot"]) ?? isoDate(n["deadline"]),
    value_eur: value,
    url: `https://ted.europa.eu/en/notice/-/detail/${encodeURIComponent(pub)}`,
  };
}

export async function fetchTed(p: Profile, sinceYmd: string, fetcher = fetch): Promise<FeedTender[]> {
  const res = await fetcher("https://api.ted.europa.eu/v3/notices/search", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      query: tedQuery(p, sinceYmd),
      fields: [
        "publication-number", "notice-title", "buyer-name", "publication-date", "deadline-receipt-tender-date-lot",
        "deadline-receipt-request-date-lot", "deadline",
        "classification-cpv", "buyer-country", "estimated-value-lot", "description-lot",
      ],
      limit: 100,
      page: 1,
    }),
  });
  if (!res.ok) throw new Error(`TED ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const data = (await res.json()) as { notices?: Record<string, unknown>[] };
  return (data.notices ?? []).map(mapTed);
}

interface OcdsRelease {
  ocid: string;
  id: string;
  date?: string;
  buyer?: { name?: string };
  tender?: {
    title?: string;
    description?: string;
    classification?: { id?: string };
    items?: { additionalClassifications?: { id?: string }[] }[];
    tenderPeriod?: { endDate?: string };
    value?: { amount?: number; currency?: string };
  };
}

const GBP_EUR = 1.17; // rough, for size filtering only

export function mapFts(r: OcdsRelease): FeedTender {
  const t = r.tender ?? {};
  const cpv = [t.classification?.id, ...(t.items ?? []).flatMap((i) => (i.additionalClassifications ?? []).map((c) => c.id))]
    .filter((x): x is string => !!x);
  const amt = t.value?.amount;
  const value = amt == null ? null : Math.round(t.value?.currency === "GBP" ? amt * GBP_EUR : amt);
  const noticeId = r.id.split("-").slice(0, 2).join("-"); // "003512-2026-tender" style ids
  return {
    source: "fts",
    ext_id: r.ocid,
    title: t.title || r.ocid,
    buyer: r.buyer?.name ?? "",
    country: "GBR",
    cpv: [...new Set(cpv)],
    description: (t.description ?? "").slice(0, 4000),
    published_at: r.date ?? null,
    deadline_at: t.tenderPeriod?.endDate ?? null,
    value_eur: value,
    url: `https://www.find-tender.service.gov.uk/Notice/${encodeURIComponent(noticeId)}`,
  };
}

export async function fetchFts(p: Profile, sinceIso: string, fetcher = fetch, maxPages = 5): Promise<FeedTender[]> {
  let url: string | null = `https://www.find-tender.service.gov.uk/api/1.0/ocdsReleasePackages?stages=tender&limit=100&updatedFrom=${encodeURIComponent(sinceIso.slice(0, 19))}`;
  const out: FeedTender[] = [];
  const terms = [...p.keywords.filter((k) => k.length >= 4), ...STRONG_OFFSHORE_TERMS].map((s) => s.toLowerCase());
  for (let page = 0; url && page < maxPages; page++) {
    const res = await fetcher(url, { headers: { accept: "application/json" } });
    if (!res.ok) throw new Error(`Find a Tender ${res.status}`);
    const data = (await res.json()) as { releases?: OcdsRelease[]; links?: { next?: string } };
    for (const r of data.releases ?? []) {
      const m = mapFts(r);
      const hay = `${m.title} ${m.description}`.toLowerCase();
      // The UK feed has no keyword filter, so keep only notices with a sector term.
      const cpvHit = m.cpv.some((c) => p.cpv.some((pre) => pre && c.startsWith(pre)));
      if (cpvHit || terms.some((k) => new RegExp(`(^|[^a-z0-9])${k.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}([^a-z0-9]|$)`).test(hay))) out.push(m);
    }
    url = data.links?.next ?? null;
  }
  return out;
}

export async function loadProfile(db: D1Database): Promise<Profile & { company: string; summary: string }> {
  const r = await db.prepare("SELECT * FROM profile WHERE id = 1").first<Record<string, string | number>>();
  return {
    company: String(r?.company ?? ""),
    summary: String(r?.summary ?? ""),
    keywords: parseList(r?.keywords as string),
    exclude_keywords: parseList(r?.exclude_keywords as string),
    cpv: parseList(r?.cpv as string),
    countries: parseList(r?.countries as string),
    certifications: parseList(r?.certifications as string),
    min_value_eur: Number(r?.min_value_eur ?? 0),
  };
}

export async function storeTenders(db: D1Database, p: Profile, items: FeedTender[]): Promise<number> {
  let inserted = 0;
  for (const t of items) {
    if (!t.ext_id) continue;
    const { score, reasons } = scoreTender(t, p);
    const r = await db
      .prepare(
        `INSERT INTO tenders (source, ext_id, title, buyer, country, cpv, description, published_at, deadline_at, value_eur, url, fit_score, fit_reasons)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)
         ON CONFLICT (source, ext_id) DO UPDATE SET deadline_at = excluded.deadline_at, value_eur = excluded.value_eur,
           fit_score = excluded.fit_score, fit_reasons = excluded.fit_reasons`,
      )
      .bind(t.source, t.ext_id, t.title, t.buyer, t.country, JSON.stringify(t.cpv), t.description, t.published_at, t.deadline_at, t.value_eur, t.url, score, JSON.stringify(reasons))
      .run();
    if (r.meta.changes && r.meta.last_row_id) inserted++;
  }
  return inserted;
}

export async function rescoreAll(db: D1Database): Promise<number> {
  const p = await loadProfile(db);
  const { results } = await db.prepare("SELECT id, title, description, buyer, country, cpv, deadline_at, value_eur FROM tenders").all<Record<string, unknown>>();
  const stmts = results.map((r) => {
    const { score, reasons } = scoreTender(
      { title: String(r.title), description: String(r.description), buyer: String(r.buyer), country: String(r.country), cpv: parseList(r.cpv as string), deadline_at: (r.deadline_at as string) ?? null, value_eur: (r.value_eur as number) ?? null },
      p,
    );
    return db.prepare("UPDATE tenders SET fit_score = ?, fit_reasons = ? WHERE id = ?").bind(score, JSON.stringify(reasons), r.id);
  });
  for (let i = 0; i < stmts.length; i += 50) await db.batch(stmts.slice(i, i + 50));
  return results.length;
}

export async function runFeeds(env: Env, days = 30): Promise<{ source: string; fetched: number; inserted: number; error?: string }[]> {
  const p = await loadProfile(env.DB);
  const since = new Date(Date.now() - days * 86_400_000);
  const ymd = since.toISOString().slice(0, 10).replace(/-/g, "");
  const out = [];
  const jobs: [string, () => Promise<FeedTender[]>][] = [
    ["ted", () => fetchTed(p, ymd)],
    ["fts", () => (p.countries.includes("GBR") ? fetchFts(p, since.toISOString()) : Promise.resolve([]))],
  ];
  for (const [source, job] of jobs) {
    try {
      const items = await job();
      const inserted = await storeTenders(env.DB, p, items);
      await env.DB.prepare("INSERT INTO feed_runs (source, fetched, inserted) VALUES (?,?,?)").bind(source, items.length, inserted).run();
      out.push({ source, fetched: items.length, inserted });
    } catch (e) {
      const error = String((e as Error).message ?? e).slice(0, 300);
      await env.DB.prepare("INSERT INTO feed_runs (source, error) VALUES (?,?)").bind(source, error).run();
      out.push({ source, fetched: 0, inserted: 0, error });
    }
  }
  return out;
}
