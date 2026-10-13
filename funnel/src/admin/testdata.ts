// Test data separation. A lead is test data when any rule matches, unless a person marked it "not test":
//   - email at example.com / example.org / example.net, or with +test@ (also marked by a trigger at insert)
//   - their first touch carried ?test=1
//   - their browser is one we know is ours: an admin opened Funnel HQ in it (recorded on /admin/api/me from
//     the first-party visitor cookie _fv, when the browser has one), or it visited from an internal IP
//     (INTERNAL_IP_HASHES: the sessions.ip_hash values, comma separated; Funnel HQ shows yours)
// Test leads are left out of every report, Today, the pipeline, calibration, the no-show model and alerts
// unless "Include test data" is on, and get no emails or calls: senders call isTestLead() before sending.
// Visitor-level counts leave out the browsers in test_visitors.

import type { Runtime } from "../app";
import { hmacHex } from "../lib/crypto";
import { signingSecret } from "../lib/secret";
import { eraseLead } from "../sales/erase";
import { all, one } from "./stats";

export const TEST_EMAIL_RE = /(@example\.(com|org|net)$)|(\+test@)/i;
const TEST_QUERY_RE = /(^|[?&])test=1(&|$)/;

export function isTestEmail(email: string | null | undefined): boolean {
  return !!email && TEST_EMAIL_RE.test(email.trim());
}
export function isTestQuery(q: string | null | undefined): boolean {
  return !!q && TEST_QUERY_RE.test(q);
}

/** The INTERNAL_IP_HASHES setting as a set. */
export function internalHashes(rt: Runtime): Set<string> {
  return new Set(rt.settings.get("INTERNAL_IP_HASHES").split(/[\s,]+/).map((x) => x.trim().toLowerCase()).filter((x) => /^[0-9a-f]{8,64}$/.test(x)));
}

/** The sessions.ip_hash value for an IP (same keyed hash identity.ts stores). */
export async function sessionIpHash(rt: Runtime, ip: string | null | undefined): Promise<string | null> {
  if (!ip) return null;
  return (await hmacHex(await signingSecret(rt.env), "ip|" + ip)).slice(0, 32);
}

export async function markTestVisitor(rt: Runtime, visitorId: string | null | undefined, reason: string): Promise<void> {
  if (!visitorId || !/^v[0-9a-z]{6,40}$/.test(visitorId)) return;
  await rt.env.DB.prepare("INSERT OR IGNORE INTO test_visitors (visitor_id, reason, created_at) VALUES (?,?,?)").bind(visitorId, reason.slice(0, 20), rt.now()).run();
}

type Why = "email" | "query" | "admin_browser" | "internal_ip" | null;

/** Which rule makes this lead test data, if any (ignores the stored flag). */
export async function testReason(rt: Runtime, lead: { id: string; email: string | null; visitor_id: string | null }): Promise<Why> {
  if (isTestEmail(lead.email)) return "email";
  const vid = lead.visitor_id || "";
  const sessions = await all<{ landing_query: string | null; ip_hash: string | null }>(rt,
    "SELECT landing_query, ip_hash FROM sessions WHERE lead_id = ? OR (visitor_id = ? AND visitor_id != '') ORDER BY started_at LIMIT 50", [lead.id, vid]);
  if (sessions.length && isTestQuery(sessions[0].landing_query)) return "query";
  if (vid) {
    const tv = await one<{ reason: string }>(rt, "SELECT reason FROM test_visitors WHERE visitor_id = ?", [vid]);
    if (tv && tv.reason === "admin") return "admin_browser";
  }
  const ips = internalHashes(rt);
  if (ips.size && sessions.some((s) => s.ip_hash && ips.has(s.ip_hash.toLowerCase()))) return "internal_ip";
  return null;
}

/**
 * True when this lead is test data: no emails, no calls, out of the reports. A person's "not test" (0) wins
 * over every rule. Cheap enough to call before each send.
 */
export async function isTestLead(rt: Runtime, leadId: string): Promise<boolean> {
  const row = await one<{ is_test: number | null; email: string | null; visitor_id: string | null }>(rt,
    "SELECT r.is_test, l.email, l.visitor_id FROM leads l LEFT JOIN lead_revops r ON r.lead_id = l.id WHERE l.id = ?", [leadId]);
  if (!row) return false;
  if (row.is_test === 1) return true;
  if (row.is_test === 0) return false;
  return (await testReason(rt, { id: leadId, email: row.email, visitor_id: row.visitor_id })) !== null;
}

/** A person marks a lead test / not test. That choice sticks over the rules. */
export async function setTestFlag(rt: Runtime, leadId: string, isTest: boolean, by: string): Promise<void> {
  const now = rt.now();
  await rt.env.DB.prepare(
    `INSERT INTO lead_revops (lead_id, is_test, test_reason, updated_at) VALUES (?,?,?,?)
     ON CONFLICT(lead_id) DO UPDATE SET is_test = excluded.is_test, test_reason = excluded.test_reason, updated_at = excluded.updated_at`,
  ).bind(leadId, isTest ? 1 : 0, `manual:${by}`.slice(0, 60), now).run();
  const lead = await one<{ visitor_id: string | null }>(rt, "SELECT visitor_id FROM leads WHERE id = ?", [leadId]);
  if (lead?.visitor_id) {
    if (isTest) await markTestVisitor(rt, lead.visitor_id, "test_lead");
    else await rt.env.DB.prepare("DELETE FROM test_visitors WHERE visitor_id = ? AND reason = 'test_lead'").bind(lead.visitor_id).run();
  }
}

/**
 * At lead insert: apply the rules now (not only on the next cron sweep), so the browser behind a test lead is out
 * of visitor-level rates from its first application. Never throws: a failure leaves it to the sweep.
 */
export async function classifyNewLead(rt: Runtime, lead: { id: string; email: string | null; visitor_id: string | null }): Promise<boolean> {
  try {
    const why = await testReason(rt, lead);
    if (!why) return false;
    await rt.env.DB.prepare(
      `INSERT INTO lead_revops (lead_id, is_test, test_reason, updated_at) VALUES (?,1,?,?)
       ON CONFLICT(lead_id) DO UPDATE SET is_test = 1, test_reason = excluded.test_reason, updated_at = excluded.updated_at WHERE lead_revops.is_test IS NULL`,
    ).bind(lead.id, why, rt.now()).run();
    const r = await one<{ is_test: number | null }>(rt, "SELECT is_test FROM lead_revops WHERE lead_id = ?", [lead.id]);
    if (r?.is_test === 1) await markTestVisitor(rt, lead.visitor_id, "test_lead");
    return r?.is_test === 1;
  } catch (e) {
    console.error("classifyNewLead", e);
    return false;
  }
}

/**
 * Cron (every run, cheap): apply the rules to leads nobody has decided on yet, and keep test_visitors in
 * step (browsers of test leads, ?test=1 first touches, internal IPs). Returns how many leads it marked.
 */
export async function sweepTestData(rt: Runtime, sinceMs?: number): Promise<number> {
  const since = sinceMs ?? rt.now() - 3 * 86_400_000;
  const db = rt.env.DB;
  const now = rt.now();
  // Browsers: ?test=1 on a visitor's first session, and sessions from internal IPs.
  await db.prepare(
    `INSERT OR IGNORE INTO test_visitors (visitor_id, reason, created_at)
     SELECT s.visitor_id, 'query', ?1 FROM sessions s
     WHERE s.started_at >= ?2 AND (s.landing_query LIKE 'test=1%' OR s.landing_query LIKE '%&test=1%' OR s.landing_query LIKE '%?test=1%')
       AND s.started_at = (SELECT MIN(s2.started_at) FROM sessions s2 WHERE s2.visitor_id = s.visitor_id)`,
  ).bind(now, since).run();
  const ips = [...internalHashes(rt)].slice(0, 50);
  if (ips.length) {
    await db.prepare(
      `INSERT OR IGNORE INTO test_visitors (visitor_id, reason, created_at)
       SELECT DISTINCT visitor_id, 'internal_ip', ? FROM sessions WHERE started_at >= ? AND lower(ip_hash) IN (${ips.map(() => "?").join(",")})`,
    ).bind(now, since, ...ips).run();
  }
  // Leads with no decision yet.
  const rows = await all<{ id: string; email: string; visitor_id: string | null }>(rt,
    `SELECT l.id, l.email, l.visitor_id FROM leads l LEFT JOIN lead_revops r ON r.lead_id = l.id
     WHERE (l.created_at >= ? OR l.updated_at >= ?) AND r.is_test IS NULL LIMIT 2000`, [since, since]);
  let marked = 0;
  for (const l of rows) {
    const why = await testReason(rt, l);
    if (!why) continue;
    await db.prepare(
      `INSERT INTO lead_revops (lead_id, is_test, test_reason, updated_at) VALUES (?,1,?,?)
       ON CONFLICT(lead_id) DO UPDATE SET is_test = 1, test_reason = excluded.test_reason, updated_at = excluded.updated_at WHERE lead_revops.is_test IS NULL`,
    ).bind(l.id, why, now).run();
    marked++;
  }
  // Browsers of test leads.
  await db.prepare(
    `INSERT OR IGNORE INTO test_visitors (visitor_id, reason, created_at)
     SELECT l.visitor_id, 'test_lead', ? FROM leads l JOIN lead_revops r ON r.lead_id = l.id WHERE r.is_test = 1 AND l.visitor_id IS NOT NULL`,
  ).bind(now).run();
  return marked;
}

export async function testSummary(rt: Runtime) {
  const [leads, visitors, reasons] = await Promise.all([
    one<{ n: number }>(rt, "SELECT COUNT(*) AS n FROM lead_revops r JOIN leads l ON l.id = r.lead_id WHERE r.is_test = 1"),
    one<{ n: number }>(rt, "SELECT COUNT(*) AS n FROM test_visitors"),
    all<{ reason: string; n: number }>(rt, "SELECT COALESCE(r.test_reason, 'unknown') AS reason, COUNT(*) AS n FROM lead_revops r JOIN leads l ON l.id = r.lead_id WHERE r.is_test = 1 GROUP BY reason"),
  ]);
  return { test_leads: Number(leads?.n) || 0, test_visitors: Number(visitors?.n) || 0, by_reason: reasons.map((r) => ({ reason: r.reason.startsWith("manual") ? "manual" : r.reason, n: Number(r.n) || 0 })) };
}

/** Owner action: erase every test lead (the normal erasure, one lead at a time). */
export async function purgeTestData(rt: Runtime, max = 500): Promise<{ erased: number; left: number }> {
  const rows = await all<{ id: string }>(rt, "SELECT r.lead_id AS id FROM lead_revops r JOIN leads l ON l.id = r.lead_id WHERE r.is_test = 1 LIMIT ?", [max]);
  let erased = 0;
  for (const r of rows) if ((await eraseLead(rt, r.id)).ok) erased++;
  const left = await one<{ n: number }>(rt, "SELECT COUNT(*) AS n FROM lead_revops r JOIN leads l ON l.id = r.lead_id WHERE r.is_test = 1");
  return { erased, left: Number(left?.n) || 0 };
}
