import { Hono } from "hono";
import type { Context, Next } from "hono";
import { type Env, clean, parseList, sha256Hex, csvCell } from "./util";
import { checkSession, clearCookie, makeSession, readCookie, safeEqual, sessionCookie } from "./auth";
import { loadProfile, rescoreAll, runFeeds } from "./feeds";
import { analyseRfq } from "./rfq";
import { runRadar, rerankSignals } from "./radar";
import { tierOf, validateApplication } from "./apply";
import { SAMPLE_LIBRARY, SAMPLE_PROFILE, SAMPLE_RFQ } from "./sample";

const app = new Hono<{ Bindings: Env }>();

const STAGES = ["reviewing", "bidding", "no_bid", "submitted", "won", "lost"];
const REQ_STATUS = ["open", "comply", "partial", "deviation", "clarify", "n/a"];
const CATS = ["technical", "commercial", "hse", "quality", "documentation", "legal", "schedule"];
const TENDER_STATUS = ["new", "watching", "pursuing", "dismissed"];

app.use("*", async (c, next) => {
  await next();
  const h = c.res.headers;
  h.set("x-content-type-options", "nosniff");
  h.set("referrer-policy", "strict-origin-when-cross-origin");
  h.set("x-frame-options", "DENY");
  if (c.req.path.startsWith("/app")) h.set("cache-control", "no-store");
});

app.get("/health", (c) => c.json({ ok: true }));

// ---------- Offer page application ----------

const recentApply = new Map<string, number[]>();

app.post("/api/apply", async (c) => {
  const ip = c.req.header("cf-connecting-ip") || "local";
  const now = Date.now();
  const hits = (recentApply.get(ip) ?? []).filter((t) => now - t < 3600_000);
  if (hits.length >= 8) return c.json({ ok: false, error: "Too many attempts. Try again later." }, 429);
  recentApply.set(ip, [...hits, now]);

  let body: Record<string, unknown>;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ ok: false, error: "Bad request" }, 400);
  }
  if (clean(body.website)) return c.json({ ok: true, tier: "C" }); // honeypot
  const v = validateApplication(body);
  if (!v.ok) return c.json({ ok: false, error: v.error }, 400);
  const tier = tierOf(v.app.answers);
  const ipHash = (await sha256Hex("nb-ip|" + ip)).slice(0, 24);
  await c.env.DB.prepare("INSERT INTO applications (name, email, phone, company, answers, tier, ip_hash) VALUES (?,?,?,?,?,?,?)")
    .bind(v.app.name, v.app.email, v.app.phone, v.app.company, JSON.stringify(v.app.answers), tier, ipHash)
    .run();
  if (c.env.LEAD_WEBHOOK_URL) {
    c.executionCtx.waitUntil(
      fetch(c.env.LEAD_WEBHOOK_URL, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ type: "application", offer: "Northbid", tier, ...v.app, at: new Date().toISOString() }),
      }).catch(() => undefined),
    );
  }
  const booking = tier !== "C" && c.env.BOOKING_URL ? c.env.BOOKING_URL : null;
  return c.json({ ok: true, tier, booking });
});

// ---------- App: login ----------

const loginTries = new Map<string, number[]>();

app.post("/app/login", async (c) => {
  const ip = c.req.header("cf-connecting-ip") || "local";
  const now = Date.now();
  const tries = (loginTries.get(ip) ?? []).filter((t) => now - t < 900_000);
  if (tries.length >= 10) return c.json({ ok: false, error: "Too many attempts. Wait 15 minutes." }, 429);
  loginTries.set(ip, [...tries, now]);
  if (!c.env.APP_PASSWORD) return c.json({ ok: false, error: "APP_PASSWORD is not set on this deployment." }, 503);
  const { password } = await c.req.json<{ password?: string }>().catch(() => ({ password: "" }));
  if (!safeEqual(String(password ?? ""), c.env.APP_PASSWORD)) return c.json({ ok: false, error: "Wrong password." }, 401);
  const token = await makeSession(c.env);
  const secure = new URL(c.req.url).protocol === "https:";
  return new Response(JSON.stringify({ ok: true }), { headers: { "content-type": "application/json", "set-cookie": sessionCookie(token!, secure) } });
});

app.post("/app/logout", () => new Response('{"ok":true}', { headers: { "content-type": "application/json", "set-cookie": clearCookie } }));

app.get("/app", (c) => c.redirect("/app/", 301));

// ---------- App API (signed-in only) ----------

async function requireAuth(c: Context<{ Bindings: Env }>, next: Next) {
  if (!(await checkSession(c.env, readCookie(c.req.raw)))) return c.json({ error: "signin" }, 401);
  // CSRF: the session cookie is SameSite=Strict, and writes also need a custom header a cross-site form cannot send.
  if (c.req.method !== "GET" && c.req.header("x-nb") !== "1") return c.json({ error: "Missing header" }, 403);
  await next();
}
app.use("/app/api/*", requireAuth);

app.get("/app/api/me", (c) => c.json({ ok: true, claude: !!c.env.ANTHROPIC_API_KEY }));

app.get("/app/api/overview", async (c) => {
  const db = c.env.DB;
  const [tenders, rfqs, lib, runs, apps] = await Promise.all([
    db.prepare("SELECT COUNT(*) n, SUM(fit_score >= 50 AND status IN ('new','watching')) good FROM tenders WHERE deadline_at IS NULL OR deadline_at >= datetime('now')").first<{ n: number; good: number }>(),
    db.prepare("SELECT stage, COUNT(*) n, SUM(COALESCE(value_eur,0)) v FROM rfqs GROUP BY stage").all<{ stage: string; n: number; v: number }>(),
    db.prepare("SELECT COUNT(*) n, SUM(expires_at IS NOT NULL AND expires_at < date('now','+60 days')) expiring FROM library").first<{ n: number; expiring: number }>(),
    db.prepare("SELECT source, fetched, inserted, error, ran_at FROM feed_runs ORDER BY id DESC LIMIT 4").all(),
    db.prepare("SELECT COUNT(*) n FROM applications").first<{ n: number }>(),
  ]);
  const radar = await db.prepare("SELECT id, kind, title, url, published_at, relevance FROM signals WHERE status IN ('new','watching','acting') AND relevance >= 40 ORDER BY relevance DESC, published_at DESC LIMIT 5").all();
  const due = await db
    .prepare("SELECT id, title, client, deadline_at, stage FROM rfqs WHERE stage IN ('reviewing','bidding') ORDER BY deadline_at IS NULL, deadline_at LIMIT 6")
    .all();
  return c.json({ tenders, stages: rfqs.results, library: lib, runs: runs.results, due: due.results, applications: apps?.n ?? 0, radar: radar.results });
});

// Profile
app.get("/app/api/profile", async (c) => c.json(await loadProfile(c.env.DB)));
app.put("/app/api/profile", async (c) => {
  const b = await c.req.json<Record<string, unknown>>();
  const list = (v: unknown, max = 60) => JSON.stringify((Array.isArray(v) ? v : []).map((x) => clean(x, 80)).filter(Boolean).slice(0, max));
  await c.env.DB.prepare(
    "UPDATE profile SET company=?, summary=?, keywords=?, exclude_keywords=?, cpv=?, countries=?, certifications=?, min_value_eur=?, updated_at=datetime('now') WHERE id=1",
  )
    .bind(clean(b.company, 160), clean(b.summary, 2000), list(b.keywords), list(b.exclude_keywords), list(b.cpv), list((b.countries as unknown[]) ?? [], 30), list(b.certifications), Math.max(0, Number(b.min_value_eur) || 0))
    .run();
  const rescored = await rescoreAll(c.env.DB);
  await rerankSignals(c.env.DB);
  return c.json({ ok: true, rescored });
});

// Tenders
app.get("/app/api/tenders", async (c) => {
  const status = c.req.query("status") || "open";
  const min = Number(c.req.query("min") ?? 0) || 0;
  const q = clean(c.req.query("q"), 80);
  const where = [status === "open" ? "status IN ('new','watching','pursuing')" : "status = ?", "fit_score >= ?", "(deadline_at IS NULL OR deadline_at >= datetime('now'))"];
  const binds: unknown[] = status === "open" ? [] : [TENDER_STATUS.includes(status) ? status : "new"];
  binds.push(min);
  if (q) {
    where.push("(title LIKE ? OR buyer LIKE ? OR description LIKE ?)");
    binds.push(`%${q}%`, `%${q}%`, `%${q}%`);
  }
  const { results } = await c.env.DB.prepare(
    `SELECT id, source, title, buyer, country, deadline_at, published_at, value_eur, url, fit_score, fit_reasons, status, substr(description,1,600) description
     FROM tenders WHERE ${where.join(" AND ")} ORDER BY fit_score DESC, deadline_at LIMIT 200`,
  ).bind(...binds).all();
  return c.json(results.map((r) => ({ ...r, fit_reasons: parseList(r.fit_reasons as string) })));
});

app.patch("/app/api/tenders/:id", async (c) => {
  const { status } = await c.req.json<{ status: string }>();
  if (!TENDER_STATUS.includes(status)) return c.json({ error: "Bad status" }, 400);
  await c.env.DB.prepare("UPDATE tenders SET status = ? WHERE id = ?").bind(status, Number(c.req.param("id"))).run();
  return c.json({ ok: true });
});

app.post("/app/api/tenders/refresh", async (c) => c.json({ ok: true, runs: await runFeeds(c.env) }));

app.post("/app/api/tenders/:id/rfq", async (c) => {
  const t = await c.env.DB.prepare("SELECT * FROM tenders WHERE id = ?").bind(Number(c.req.param("id"))).first<Record<string, unknown>>();
  if (!t) return c.json({ error: "Not found" }, 404);
  const r = await c.env.DB.prepare("INSERT INTO rfqs (tender_id, title, client, reference, deadline_at, value_eur, source_text) VALUES (?,?,?,?,?,?,?)")
    .bind(t.id, t.title, t.buyer, t.ext_id, t.deadline_at, t.value_eur, String(t.description ?? ""))
    .run();
  await c.env.DB.prepare("UPDATE tenders SET status = 'pursuing' WHERE id = ?").bind(t.id).run();
  return c.json({ ok: true, id: r.meta.last_row_id });
});

// Project radar: signals that come before RFQs
const SIGNAL_STATUS = ["new", "watching", "acting", "dismissed"];
app.get("/app/api/radar", async (c) => {
  const status = c.req.query("status") || "open";
  const min = Number(c.req.query("min") ?? 0) || 0;
  const where = status === "open" ? "status IN ('new','watching','acting')" : "status = ?";
  const binds: unknown[] = status === "open" ? [] : [SIGNAL_STATUS.includes(status) ? status : "new"];
  const { results } = await c.env.DB.prepare(
    `SELECT id, kind, title, url, outlet, published_at, buyers, packages, window, relevance, reasons, status, note
     FROM signals WHERE ${where} AND relevance >= ? ORDER BY relevance DESC, published_at DESC LIMIT 150`,
  ).bind(...binds, min).all<Record<string, unknown>>();
  return c.json(results.map((r) => ({ ...r, buyers: parseList(r.buyers as string), packages: parseList(r.packages as string), reasons: parseList(r.reasons as string) })));
});
app.patch("/app/api/radar/:id", async (c) => {
  const b = await c.req.json<{ status?: string; note?: string }>();
  if (b.status !== undefined && !SIGNAL_STATUS.includes(b.status)) return c.json({ error: "Bad status" }, 400);
  await c.env.DB.prepare("UPDATE signals SET status = COALESCE(?, status), note = COALESCE(?, note) WHERE id = ?")
    .bind(b.status ?? null, b.note === undefined ? null : clean(b.note, 2000), Number(c.req.param("id"))).run();
  return c.json({ ok: true });
});
app.post("/app/api/radar/refresh", async (c) => c.json({ ok: true, ...(await runRadar(c.env)) }));

// Competitor intelligence from TED award notices
app.get("/app/api/awards", async (c) => {
  const { results } = await c.env.DB.prepare(
    "SELECT ext_id, title, buyer, country, winners, winner_size, value_eur, bids_received, published_at, url, relevance FROM awards WHERE relevance >= 20 ORDER BY published_at DESC LIMIT 200",
  ).all<Record<string, unknown>>();
  const rows: Record<string, unknown>[] = results.map((r) => ({ ...r, winners: parseList(r.winners as string), winner_size: parseList(r.winner_size as string) }));
  const tally = new Map<string, { wins: number; value: number }>();
  for (const r of rows) for (const w of r.winners as string[]) {
    const t = tally.get(w) ?? { wins: 0, value: 0 };
    t.wins++; t.value += Number(r.value_eur ?? 0) / Math.max(1, (r.winners as string[]).length);
    tally.set(w, t);
  }
  const winners = [...tally.entries()].map(([name, t]) => ({ name, ...t })).sort((a, b) => b.wins - a.wins || b.value - a.value).slice(0, 25);
  const counts = rows.map((r) => Number(r.bids_received)).filter((n) => n > 0);
  const medianBids = counts.length ? counts.sort((a, b) => a - b)[Math.floor(counts.length / 2)] : null;
  const sme = rows.filter((r) => (r.winner_size as string[]).some((s) => ["sme", "small", "micro", "medium"].includes(s))).length;
  return c.json({ awards: rows, winners, medianBids, smeShare: rows.length ? Math.round((sme / rows.length) * 100) : null });
});

// RFQs
app.get("/app/api/rfqs", async (c) => {
  const { results } = await c.env.DB.prepare(
    `SELECT r.id, r.title, r.client, r.reference, r.deadline_at, r.value_eur, r.stage, r.analysed_by, r.updated_at,
       json_extract(r.analysis,'$.scorecard.overall') score, json_extract(r.analysis,'$.scorecard.recommendation') rec,
       (SELECT COUNT(*) FROM requirements q WHERE q.rfq_id = r.id) reqs,
       (SELECT COUNT(*) FROM requirements q WHERE q.rfq_id = r.id AND q.status <> 'open') done
     FROM rfqs r ORDER BY CASE WHEN r.stage IN ('reviewing','bidding') THEN 0 ELSE 1 END, r.deadline_at IS NULL, r.deadline_at`,
  ).all();
  return c.json(results);
});

app.post("/app/api/rfqs", async (c) => {
  const b = await c.req.json<Record<string, unknown>>();
  const r = await c.env.DB.prepare("INSERT INTO rfqs (title, client, reference, deadline_at, value_eur, source_text) VALUES (?,?,?,?,?,?)")
    .bind(clean(b.title, 200) || "Untitled RFQ", clean(b.client, 160), clean(b.reference, 80), /^\d{4}-\d{2}-\d{2}/.test(String(b.deadline_at)) ? String(b.deadline_at).slice(0, 10) : null, Number(b.value_eur) || null, clean(b.text, 400_000))
    .run();
  return c.json({ ok: true, id: r.meta.last_row_id });
});

app.get("/app/api/rfqs/:id", async (c) => {
  const id = Number(c.req.param("id"));
  const rfq = await c.env.DB.prepare("SELECT * FROM rfqs WHERE id = ?").bind(id).first<Record<string, unknown>>();
  if (!rfq) return c.json({ error: "Not found" }, 404);
  const { results } = await c.env.DB.prepare(
    "SELECT q.*, l.title evidence_title FROM requirements q LEFT JOIN library l ON l.id = q.evidence_id WHERE rfq_id = ? ORDER BY seq",
  ).bind(id).all();
  return c.json({
    ...rfq,
    source_text: String(rfq.source_text ?? "").slice(0, 200_000),
    analysis: rfq.analysis ? JSON.parse(String(rfq.analysis)) : null,
    requirements: results.map((r) => ({ ...r, standards: parseList(r.standards as string) })),
  });
});

app.patch("/app/api/rfqs/:id", async (c) => {
  const b = await c.req.json<Record<string, unknown>>();
  const sets: string[] = [];
  const binds: unknown[] = [];
  if (b.stage !== undefined) {
    if (!STAGES.includes(String(b.stage))) return c.json({ error: "Bad stage" }, 400);
    sets.push("stage = ?"), binds.push(b.stage);
  }
  for (const k of ["title", "client", "reference"] as const) if (b[k] !== undefined) sets.push(`${k} = ?`), binds.push(clean(b[k], 200));
  if (b.deadline_at !== undefined) sets.push("deadline_at = ?"), binds.push(/^\d{4}-\d{2}-\d{2}/.test(String(b.deadline_at)) ? String(b.deadline_at).slice(0, 10) : null);
  if (b.value_eur !== undefined) sets.push("value_eur = ?"), binds.push(Number(b.value_eur) || null);
  if (b.text !== undefined) sets.push("source_text = ?"), binds.push(clean(b.text, 400_000));
  if (!sets.length) return c.json({ ok: true });
  await c.env.DB.prepare(`UPDATE rfqs SET ${sets.join(", ")}, updated_at = datetime('now') WHERE id = ?`).bind(...binds, Number(c.req.param("id"))).run();
  return c.json({ ok: true });
});

app.delete("/app/api/rfqs/:id", async (c) => {
  await c.env.DB.prepare("DELETE FROM rfqs WHERE id = ?").bind(Number(c.req.param("id"))).run();
  return c.json({ ok: true });
});

app.post("/app/api/rfqs/:id/analyse", async (c) => {
  const id = Number(c.req.param("id"));
  let pdfBase64: string | undefined;
  const ct = c.req.header("content-type") || "";
  if (ct.includes("multipart/form-data")) {
    const form = await c.req.formData();
    const f = form.get("file");
    if (f && typeof f !== "string") {
      if (f.size > 25 * 1024 * 1024) return c.json({ error: "File over 25 MB" }, 413);
      const buf = new Uint8Array(await f.arrayBuffer());
      const isPdf = buf[0] === 0x25 && buf[1] === 0x50 && buf[2] === 0x44 && buf[3] === 0x46; // %PDF
      if (isPdf) {
        let bin = "";
        for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode(...buf.subarray(i, i + 0x8000));
        pdfBase64 = btoa(bin);
      } else {
        const text = new TextDecoder().decode(buf);
        await c.env.DB.prepare("UPDATE rfqs SET source_text = ? WHERE id = ?").bind(clean(text, 400_000), id).run();
      }
    }
  }
  try {
    return c.json({ ok: true, ...(await analyseRfq(c.env, id, { pdfBase64 })) });
  } catch (e) {
    return c.json({ error: String((e as Error).message) }, 400);
  }
});

app.patch("/app/api/requirements/:id", async (c) => {
  const b = await c.req.json<Record<string, unknown>>();
  const sets: string[] = [];
  const binds: unknown[] = [];
  if (b.status !== undefined) {
    if (!REQ_STATUS.includes(String(b.status))) return c.json({ error: "Bad status" }, 400);
    sets.push("status = ?"), binds.push(b.status);
  }
  if (b.category !== undefined && CATS.includes(String(b.category))) sets.push("category = ?"), binds.push(b.category);
  if (b.response !== undefined) sets.push("response = ?"), binds.push(clean(b.response, 4000));
  if (b.evidence_id !== undefined) sets.push("evidence_id = ?"), binds.push(Number(b.evidence_id) || null);
  if (!sets.length) return c.json({ ok: true });
  await c.env.DB.prepare(`UPDATE requirements SET ${sets.join(", ")} WHERE id = ?`).bind(...binds, Number(c.req.param("id"))).run();
  return c.json({ ok: true });
});

app.get("/app/api/rfqs/:id/matrix.csv", async (c) => {
  const id = Number(c.req.param("id"));
  const rfq = await c.env.DB.prepare("SELECT title, reference FROM rfqs WHERE id = ?").bind(id).first<{ title: string; reference: string }>();
  if (!rfq) return c.json({ error: "Not found" }, 404);
  const { results } = await c.env.DB.prepare(
    "SELECT q.seq, q.clause, q.category, q.mandatory, q.text, q.standards, q.status, q.response, l.title ev FROM requirements q LEFT JOIN library l ON l.id = q.evidence_id WHERE rfq_id = ? ORDER BY seq",
  ).bind(id).all<Record<string, unknown>>();
  const head = ["#", "Clause", "Category", "Mandatory", "Requirement", "Standards", "Status", "Response / deviation", "Evidence"];
  const rows = results.map((r) => [r.seq, r.clause, r.category, r.mandatory ? "Yes" : "No", r.text, parseList(r.standards as string).join("; "), r.status, r.response, r.ev ?? ""]);
  const csv = "﻿" + [head, ...rows].map((row) => row.map(csvCell).join(",")).join("\r\n");
  const name = (rfq.reference || rfq.title || "rfq").replace(/[^\w.-]+/g, "_").slice(0, 60);
  return new Response(csv, { headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": `attachment; filename="compliance-matrix-${name}.csv"` } });
});

// Library
app.get("/app/api/library", async (c) => {
  const { results } = await c.env.DB.prepare("SELECT * FROM library ORDER BY category, title").all();
  return c.json(results.map((r) => ({ ...r, tags: parseList(r.tags as string) })));
});
const libBinds = (b: Record<string, unknown>) => [
  clean(b.title, 200), CATS.includes(String(b.category)) ? String(b.category) : "technical",
  JSON.stringify((Array.isArray(b.tags) ? b.tags : String(b.tags ?? "").split(",")).map((t) => clean(t, 60)).filter(Boolean).slice(0, 20)),
  clean(b.body, 20_000), /^\d{4}-\d{2}-\d{2}$/.test(String(b.expires_at)) ? String(b.expires_at) : null,
];
app.post("/app/api/library", async (c) => {
  const b = await c.req.json<Record<string, unknown>>();
  if (!clean(b.title) || !clean(b.body)) return c.json({ error: "Title and text are required" }, 400);
  const r = await c.env.DB.prepare("INSERT INTO library (title, category, tags, body, expires_at) VALUES (?,?,?,?,?)").bind(...libBinds(b)).run();
  return c.json({ ok: true, id: r.meta.last_row_id });
});
app.put("/app/api/library/:id", async (c) => {
  const b = await c.req.json<Record<string, unknown>>();
  await c.env.DB.prepare("UPDATE library SET title=?, category=?, tags=?, body=?, expires_at=?, updated_at=datetime('now') WHERE id=?").bind(...libBinds(b), Number(c.req.param("id"))).run();
  return c.json({ ok: true });
});
app.delete("/app/api/library/:id", async (c) => {
  await c.env.DB.prepare("DELETE FROM library WHERE id = ?").bind(Number(c.req.param("id"))).run();
  return c.json({ ok: true });
});

app.get("/app/api/applications", async (c) => {
  const { results } = await c.env.DB.prepare("SELECT id, name, email, phone, company, answers, tier, created_at FROM applications ORDER BY id DESC LIMIT 200").all();
  return c.json(results.map((r) => ({ ...r, answers: JSON.parse(String(r.answers || "{}")) })));
});

// Load the fictional sample workspace (profile, library, one ITT).
app.post("/app/api/demo", async (c) => {
  const db = c.env.DB;
  const p = SAMPLE_PROFILE;
  await db.prepare("UPDATE profile SET company=?, summary=?, keywords=?, exclude_keywords=?, cpv=?, countries=?, certifications=?, min_value_eur=? WHERE id=1")
    .bind(p.company, p.summary, JSON.stringify(p.keywords), JSON.stringify(p.exclude_keywords), JSON.stringify(p.cpv), JSON.stringify(p.countries), JSON.stringify(p.certifications), p.min_value_eur)
    .run();
  const n = await db.prepare("SELECT COUNT(*) n FROM library").first<{ n: number }>();
  if (!n?.n) {
    await db.batch(SAMPLE_LIBRARY.map((l) => db.prepare("INSERT INTO library (title, category, tags, body, expires_at) VALUES (?,?,?,?,?)").bind(l.title, l.category, JSON.stringify(l.tags), l.body, l.expires_at)));
  }
  const r = await db.prepare("INSERT INTO rfqs (title, client, source_text) VALUES (?,?,?)").bind("ROV tooling frame agreement (sample)", "North Shelf Energy AS (fictional)", SAMPLE_RFQ).run();
  const id = Number(r.meta.last_row_id);
  await analyseRfq(c.env, id).catch(() => undefined);
  await rescoreAll(db);
  return c.json({ ok: true, rfq: id });
});

app.notFound(async (c) => {
  if (c.req.path.startsWith("/app/api") || c.req.path.startsWith("/api")) return c.json({ error: "Not found" }, 404);
  const res = await c.env.ASSETS.fetch(c.req.raw);
  return new Response(res.body, res); // asset responses have immutable headers
});

export default {
  fetch: app.fetch,
  async scheduled(_e: ScheduledController, env: Env, ctx: ExecutionContext) {
    ctx.waitUntil(Promise.allSettled([runFeeds(env), runRadar(env)]).then(() => undefined));
  },
} satisfies ExportedHandler<Env>;

