// Funnel HQ JSON API. Mounted at /admin/api behind requireAdmin (session cookie + same-origin writes).
// Every handler reads the shared filters from the query. Secrets, raw IPs and full user agents never leave.

import { OUTBOUND_KEYS, validOutbound } from "../lib/outbound";
import { eraseLead } from "../sales/erase";
import { confirmBooking } from "../integrations/booking";
import { Hono } from "hono";
import type { AppEnv, Ctx, Runtime } from "../app";
import { APPLICATION, FAQS, LOST_REASONS, OBJECTIONS, STATUSES, VIDEOS } from "../config";
import { SETTINGS, loadSettings, maskValue, saveSetting, settingDef, type SettingDef } from "../settings";
import { logoutEverywhere } from "../admin/auth";
import { getLead, parseAnswers, type Lead } from "../funnel/leads";
import { LINK_KINDS, archiveLink, createLink, linkStats } from "../funnel/tracked-links";
import { createRep, deleteRep, listReps, updateRep } from "../sales/reps";
import { ValidationError, applyLeadUpdate, deletePayment, listPayments, recordPayment, type LeadPatch } from "../sales/outcomes";
import { requalifyCalendlyLeads } from "../sales/qualify";
import { previewTemplate, processEmailQueue, sendTestEmail } from "../integrations/email";
import { SEQUENCES } from "../integrations/sequences";
import { TEMPLATES, TEMPLATE_TOPICS } from "../integrations/all-templates";
import { listPhoneNumbers, provision, testCall, voiceConfigured } from "../integrations/elevenlabs";
import { connectCalendly, importCalendlyHistory, linkOrphans, syncCalendly } from "../integrations/calendly";
import { notifyTeam } from "../integrations/notify";
import { BACKGROUND, buildProfile } from "../personalize/profile";
import { RULES } from "../personalize/triggers";
import { popcount } from "../tracking/vsl";
import { normalizePhone } from "../lib/phone";
import {
  all, applicationReport, filterOptions, funnelMapStats, liveEvents, num, one, overview, parseFilters, pct, salesTz,
  trackingReport, trafficReport, vslReport, type Filters,
} from "../admin/stats";
import { csvCell, leadsCsv, listLeads, salesTeam } from "../admin/sales";
import { insightsReport } from "../admin/insights";
import { landersReport } from "../admin/landers";
import { behaviourReport, cleanName } from "../admin/behaviour";
import { MapError, loadMap, saveCustom, saveLayout } from "../admin/map";
import { spendReport } from "../admin/spend";
import { alertsReport, openAlerts, resolveAlert, runAlerts } from "../admin/alerts";
import { backfillAdTouch, parseSpendCsv, syncMetaSpend, upsertSpend } from "../integrations/meta-ads";
import { checkDeliverability, deliverabilityPayload, resumeMarketing } from "../integrations/resend-webhook";
import { checkEmailDns } from "../integrations/email-dns";
import { parseStageValues, recomputeStageValues, stageValueTable } from "../sales/values";
import { activateModel, calibrationReport, runCalibration, setLearnedRouting } from "../sales/calibration";
import { scoreUpcomingCalls, upcomingByRisk } from "../sales/noshow";
import { followUpsDue, paymentsDue, pingClosersFollowUps } from "../sales/followups";
import { latestAiReport, runAnalyst } from "../sales/analyst";
import { maybeSendDigest } from "../sales/digest";
import { currentUser, leadVisible, logoutHere, repScope, type AdminUser } from "../admin/auth";
import { audit, auditReport, diff } from "../admin/audit";
import { UserError, createUser, listUsers, updateUser } from "../admin/users";
import { MergeError, dataQuality, duplicatesReport, mergeLeads } from "../admin/dedupe";
import { movePatch, pipelineReport, setVerbal } from "../sales/pipeline";
import { getReceivable, listReceivables, receivablesDue } from "../sales/receivables";
import { TouchError, listTouches, logTouch, salesActivity, todayView, TOUCH_KINDS, TOUCH_OUTCOMES } from "../sales/today";
import { attributionReport, cohortsReport } from "../admin/attribution";
import { exportCsv } from "../admin/exports";
import { API_SCOPES, ApiKeyError, createKey, listKeys, revokeKey } from "../admin/api-keys";
import { WebhookError, createSub, deleteSub, setSubActive, subsPayload } from "../integrations/webhooks";
import { getCookie } from "hono/cookie";
import { COOKIE } from "../lib/identity";
import { notifyRep } from "../integrations/notify";
import { metricsPayload } from "../admin/metrics";
import { cacheDnsResult, goLive, readiness } from "../admin/readiness";
import { internalHashes, markTestVisitor, purgeTestData, sessionIpHash, setTestFlag, sweepTestData, testSummary } from "../admin/testdata";
import { CallError, latestReview, logHeldCall } from "../sales/calls";
import { PlanError, getPlan, parsePlanBody, planUrl, savePlan } from "../sales/plan";
import { nextRep, verifyReassignToken } from "../sales/escalation";
import { getRep } from "../sales/reps";
import { emailCatalog } from "../admin/email-catalog";

export { csvCell };

export const adminApi = new Hono<AppEnv>();

const rtOf = (c: Ctx): Runtime => c.get("rt");
/** The signed-in user (set by requireAdmin). Fails closed to a viewer with no leads if it is missing. */
const userOf = (c: Ctx): AdminUser => currentUser(c) || { id: "unknown", email: null, name: "Unknown", role: "viewer", rep_id: null, breakglass: false };
const ipOf = (c: Ctx) => c.req.header("cf-connecting-ip") || null;
const isRep = (u: AdminUser) => u.role === "closer" || u.role === "setter";
/** A lead the current user may see, or null (reps only see their own). */
async function visibleLead(c: Ctx, id: string): Promise<Lead | null> {
  const lead = await getLead(rtOf(c), id);
  return lead && leadVisible(userOf(c), lead) ? lead : null;
}
/** Owners and managers may look at one rep's view with ?rep=; reps always get their own. */
function scopeFor(c: Ctx): string | null | undefined {
  const u = userOf(c);
  const s = repScope(u);
  if (s !== undefined) return s;
  const q = c.req.query("rep");
  return q && /^[A-Za-z0-9_-]{1,40}$/.test(q) ? q : undefined;
}
const LEAD_AUDIT_KEYS = ["status", "tier_override", "closer_id", "setter_id", "revenue", "notes", "lost_reason", "objection", "industry", "revenue_band", "budget_band",
  "willing_to_invest", "temperature", "follow_up_at", "decision_maker", "fit_rating", "offer", "payment_plan", "installments_total", "next_payment_at",
  "contract_signed_at", "refunded_at", "refund_amount", "loi_signed_at", "target_business", "do_not_call_at"];
async function auditLead(c: Ctx, action: string, before: Lead, after: Lead) {
  const d = diff(before as unknown as Record<string, unknown>, after as unknown as Record<string, unknown>, LEAD_AUDIT_KEYS);
  if (Object.keys(d.after).length) await audit(rtOf(c), userOf(c), ipOf(c), { action, entity: "lead", entity_id: before.id, before: d.before, after: d.after });
}
const filters = (c: Ctx): Filters => parseFilters((k) => c.req.query(k), rtOf(c).now(), salesTz(rtOf(c)));
const body = async (c: Ctx): Promise<Record<string, unknown>> => {
  const b = await c.req.json().catch(() => ({}));
  return b && typeof b === "object" && !Array.isArray(b) ? (b as Record<string, unknown>) : {};
};
const bad = (c: Ctx, error: string, status: 400 | 404 | 409 | 422 = 400) => c.json({ error }, status);
const errMsg = (e: unknown) => (e instanceof Error ? e.message : String(e)).slice(0, 300);

// ── Reports ──────────────────────────────────────────────────────────────────

adminApi.get("/filters", async (c) => c.json(await filterOptions(rtOf(c))));
adminApi.get("/overview", async (c) => c.json(await overview(rtOf(c), filters(c))));
adminApi.get("/funnel-map-stats", async (c) => c.json(await funnelMapStats(rtOf(c), filters(c))));
adminApi.get("/vsl", async (c) => c.json(await vslReport(rtOf(c), filters(c), c.req.query("video"))));
adminApi.get("/traffic", async (c) => c.json(await trafficReport(rtOf(c), filters(c), c.req.query("dim"))));
adminApi.get("/landers", async (c) => c.json(await landersReport(rtOf(c), filters(c))));
adminApi.get("/behaviour", async (c) => c.json(await behaviourReport(rtOf(c), filters(c))));
adminApi.get("/application", async (c) => c.json(await applicationReport(rtOf(c), filters(c))));
adminApi.get("/insights", async (c) => {
  const rt = rtOf(c);
  const [r, ai] = await Promise.all([insightsReport(rt, filters(c)), latestAiReport(rt)]);
  return c.json({ ...r, ai_report: ai, ai_enabled: rt.settings.has("ANTHROPIC_API_KEY") });
});
adminApi.get("/tracking", async (c) => {
  const rt = rtOf(c);
  const sv = parseStageValues(rt.settings.get("STAGE_VALUES"));
  return c.json({ ...(await trackingReport(rt, filters(c))), stage_values: { computed_at: sv?.computed_at ?? null, avg_deal: sv?.avg_deal ?? null, n_total: sv?.n_total ?? 0, rows: stageValueTable(sv), locked: rt.settings.source("STAGE_VALUES") === "env" } });
});
adminApi.post("/tracking/stage-values", async (c) => {
  const r = await recomputeStageValues(rtOf(c));
  return r.ok ? c.json({ ok: true, rows: stageValueTable(r.values), n_total: r.values.n_total }) : bad(c, r.error || "Could not save", 409);
});

// ── Ad spend ─────────────────────────────────────────────────────────────────

adminApi.get("/spend", async (c) => c.json(await spendReport(rtOf(c), filters(c), c.req.query("level"))));
adminApi.post("/spend/sync", async (c) => {
  const rt = rtOf(c);
  const r = await syncMetaSpend(rt, true);
  if (!r) return bad(c, "Add the Meta Marketing API token and ad account id in Integrations first.", 422);
  await backfillAdTouch(rt, rt.now() - 365 * 86_400_000);
  return r.ok ? c.json(r) : bad(c, r.error || "Sync failed", 422);
});
adminApi.post("/spend/import", async (c) => {
  const rt = rtOf(c);
  const b = await body(c);
  const csv = typeof b.csv === "string" ? b.csv : "";
  if (!csv.trim()) return bad(c, "Paste or choose a CSV file.");
  if (csv.length > 2_000_000) return bad(c, "The file is too large (2 MB max). Split it by month.");
  const platform = typeof b.platform === "string" ? b.platform : "other";
  const { rows, errors } = parseSpendCsv(csv, platform);
  if (!rows.length) return bad(c, errors[0] || "No rows found.", 422);
  const n = await upsertSpend(rt, rows, "csv");
  await backfillAdTouch(rt, rt.now() - 365 * 86_400_000);
  return c.json({ ok: true, imported: n, errors });
});

// ── Alerts ───────────────────────────────────────────────────────────────────

adminApi.get("/alerts", async (c) => c.json(await alertsReport(rtOf(c))));
adminApi.get("/alerts/open", async (c) => c.json(await openAlerts(rtOf(c))));
adminApi.post("/alerts/check", async (c) => {
  const rt = rtOf(c);
  await checkDeliverability(rt, true);
  return c.json({ ok: true, ...(await runAlerts(rt, true)) });
});
adminApi.post("/alerts/:id/resolve", async (c) => {
  const id = c.req.param("id");
  if (!/^a[0-9a-z]{19}$/.test(id)) return bad(c, "bad id");
  return (await resolveAlert(rtOf(c), id)) ? c.json({ ok: true }) : bad(c, "Alert not found or already resolved.", 404);
});

// ── Scoring calibration ──────────────────────────────────────────────────────

adminApi.get("/calibration", async (c) => c.json(await calibrationReport(rtOf(c))));
adminApi.post("/calibration/run", async (c) => c.json({ ok: true, ...(await runCalibration(rtOf(c), true)) }));
adminApi.post("/calibration/activate", async (c) => {
  const b = await body(c);
  const id = typeof b.id === "string" ? b.id : "";
  if (!/^sm[0-9a-z]{19}$/.test(id)) return bad(c, "bad id");
  return (await activateModel(rtOf(c), id)) ? c.json({ ok: true }) : bad(c, "Model not found.", 404);
});
// Learned points for routing: the owner's explicit switch (default off).
adminApi.post("/calibration/learned", async (c) => {
  const u = userOf(c);
  if (u.role !== "owner") return c.json({ error: "Only the owner can change how leads are routed." }, 403);
  const b = await body(c);
  const r = await setLearnedRouting(rtOf(c), b.on === true);
  if (!r.ok) return bad(c, r.error || "Could not save", 422);
  await audit(rtOf(c), u, ipOf(c), { action: b.on === true ? "learned_routing_on" : "learned_routing_off", entity: "setting", entity_id: "LEARNED_ROUTING", after: { on: b.on === true, version: r.version || null } });
  return c.json(r);
});

// ── Weekly analyst and digest ────────────────────────────────────────────────

adminApi.post("/ai-report/run", async (c) => {
  const r = await runAnalyst(rtOf(c));
  return r.ok ? c.json(r) : bad(c, r.error || "The analyst could not run.", 422);
});
adminApi.post("/digest/send", async (c) => {
  const rt = rtOf(c);
  if (!rt.settings.has("SLACK_WEBHOOK_URL") && !rt.settings.has("DISCORD_WEBHOOK_URL")) return bad(c, "Add a Slack or Discord webhook in Integrations first.", 422);
  await maybeSendDigest(rt, true);
  await pingClosersFollowUps(rt, true);
  return c.json({ ok: true });
});
adminApi.get("/live", async (c) => c.json(await liveEvents(rtOf(c), c.req.query("since"))));

// ── Links & videos ───────────────────────────────────────────────────────────

adminApi.get("/links", async (c) => {
  const rt = rtOf(c);
  const links = await linkStats(rt, filters(c).since);
  return c.json({ links, kinds: LINK_KINDS, videos: Object.values(VIDEOS).map((v) => ({ id: v.id, title: v.title })), origin: rt.origin });
});
adminApi.post("/links", async (c) => {
  try {
    return c.json({ link: await createLink(rtOf(c), await body(c)) });
  } catch (e) {
    const m = errMsg(e);
    return bad(c, /UNIQUE/i.test(m) ? "That code is already taken." : m);
  }
});
adminApi.post("/links/:code/archive", async (c) => {
  const b = await body(c);
  const code = c.req.param("code");
  if (!/^[a-z0-9][a-z0-9-]{1,39}$/.test(code)) return bad(c, "bad code");
  await archiveLink(rtOf(c), code, b.archived === false ? false : true);
  return c.json({ ok: true });
});

// ── Sales ────────────────────────────────────────────────────────────────────

adminApi.get("/sales", async (c) => {
  const rt = rtOf(c);
  const f = filters(c);
  const reps = await listReps(rt);
  const scope = scopeFor(c);
  if (scope === null) return c.json({ scoped: true, linked: false });
  const [team, risk, fu, pay, activity] = await Promise.all([salesTeam(rt, f), upcomingByRisk(rt), followUpsDue(rt, reps, scope), paymentsDue(rt, reps, scope), salesActivity(rt, f.since, scope)]);
  const closer = (id: string | null) => (id ? reps.find((r) => r.id === id)?.name || id : null);
  const mine = <T extends { closer_id: string | null }>(rows: T[]) => (scope ? rows.filter((r) => r.closer_id === scope) : rows);
  const riskRows = mine(risk.rows).map((r) => ({ ...r, closer: closer(r.closer_id) }));
  return c.json({
    ...team, call_log: mine(team.call_log), needs_outcome: mine(team.needs_outcome), reps: scope ? team.reps.filter((r) => r.id === scope) : team.reps,
    upcoming_risk: { ...risk, rows: riskRows }, follow_ups: fu, payments_due: pay, activity, scoped: !!scope,
  });
});
adminApi.post("/sales/noshow/score", async (c) => c.json({ ok: true, scored: await scoreUpcomingCalls(rtOf(c), true) }));
adminApi.post("/sales/outcome", async (c) => {
  const b = await body(c);
  const lead = await visibleLead(c, typeof b.lead_id === "string" ? b.lead_id : "");
  if (!lead) return bad(c, "lead not found", 404);
  const patch = b.patch && typeof b.patch === "object" && !Array.isArray(b.patch) ? ({ ...(b.patch as LeadPatch) }) : {};
  if (isRep(userOf(c))) { delete patch.closer_id; delete patch.setter_id; }
  try {
    const fresh = await applyLeadUpdate(rtOf(c), lead, patch, { source: "admin" });
    await auditLead(c, "outcome", lead, fresh);
    return c.json({ ok: true, lead: publicLead(fresh) });
  } catch (e) {
    if (e instanceof ValidationError) return bad(c, `Invalid ${e.message}`);
    throw e;
  }
});

// ── Pipeline, forecast and receivables ───────────────────────────────────────

adminApi.get("/pipeline", async (c) => {
  const scope = scopeFor(c);
  if (scope === null) return c.json({ scoped: true, linked: false, stages: [], forecast: [], weighted: 0 });
  return c.json(await pipelineReport(rtOf(c), scope));
});
adminApi.post("/pipeline/move", async (c) => {
  const rt = rtOf(c);
  const b = await body(c);
  const lead = await visibleLead(c, typeof b.lead_id === "string" ? b.lead_id : "");
  if (!lead) return bad(c, "lead not found", 404);
  let mv: ReturnType<typeof movePatch>;
  try {
    mv = movePatch(String(b.stage || ""), lead, { revenue: b.revenue, installments: b.installments });
  } catch (e) {
    return bad(c, errMsg(e), 422);
  }
  try {
    const fresh = await applyLeadUpdate(rt, lead, mv.patch as LeadPatch, { source: "admin" });
    if (mv.verbal !== null) await setVerbal(rt, lead.id, mv.verbal);
    await auditLead(c, "pipeline_move", lead, fresh);
    if (mv.verbal !== null) await audit(rt, userOf(c), ipOf(c), { action: "pipeline_move", entity: "lead", entity_id: lead.id, after: { stage: b.stage } });
    return c.json({ ok: true, lead: publicLead(fresh) });
  } catch (e) {
    if (e instanceof ValidationError) return bad(c, `Invalid ${e.message.replace(/_/g, " ")}`);
    throw e;
  }
});
adminApi.get("/receivables", async (c) => {
  const rt = rtOf(c);
  const scope = scopeFor(c);
  if (scope === null) return c.json({ rows: [] });
  const ahead = Math.max(0, Math.min(90, Number(c.req.query("days") || 30)));
  return c.json({ rows: await receivablesDue(rt, { aheadMs: ahead * 86_400_000, rep: scope, reps: await listReps(rt) }), days: ahead });
});
adminApi.post("/receivables/:id/paid", async (c) => {
  const rt = rtOf(c);
  const id = c.req.param("id");
  if (!/^rv[0-9a-z]{19}$/.test(id)) return bad(c, "bad id");
  const r = await getReceivable(rt, id);
  if (!r || r.status !== "pending") return bad(c, "This instalment is not pending.", 404);
  const lead = await visibleLead(c, r.lead_id);
  if (!lead) return bad(c, "lead not found", 404);
  const b = await body(c);
  try {
    const p = await recordPayment(rt, lead, { amount: r.amount, paid_at: b.paid_at, method: b.method, note: `Instalment ${r.seq}` }, { receivableId: r.id });
    await audit(rt, userOf(c), ipOf(c), { action: "payment_add", entity: "payment", entity_id: p.id, after: { lead_id: lead.id, amount: p.amount, receivable: r.id } });
    return c.json({ ok: true, payment: p });
  } catch (e) {
    if (e instanceof ValidationError) return bad(c, "Could not record the payment.");
    throw e;
  }
});

// ── Today ────────────────────────────────────────────────────────────────────

adminApi.get("/today", async (c) => c.json({ ...(await todayView(rtOf(c), scopeFor(c))), touch_kinds: TOUCH_KINDS, touch_outcomes: TOUCH_OUTCOMES.filter(Boolean), lost_reasons: LOST_REASONS, objections: OBJECTIONS }));
adminApi.post("/leads/:id/touches", async (c) => {
  const lead = await visibleLead(c, c.req.param("id"));
  if (!lead) return bad(c, "not found", 404);
  const u = userOf(c);
  const b = await body(c);
  // A rep's touch is theirs; an owner or manager logs it for the lead's setter/closer only when they have no rep of their own.
  const rep = u.rep_id || (typeof b.rep_id === "string" && /^[A-Za-z0-9_-]{1,40}$/.test(b.rep_id) ? b.rep_id : null);
  try {
    const t = await logTouch(rtOf(c), lead.id, rep, u.id, b);
    return c.json({ ok: true, touch: t });
  } catch (e) {
    if (e instanceof TouchError) return bad(c, e.message, 422);
    throw e;
  }
});

// ── Me, users and the activity log ───────────────────────────────────────────

adminApi.get("/me", async (c) => {
  const u = userOf(c);
  // This browser is ours: its first-party visitor id (if it has visited the funnel) is test traffic.
  await markTestVisitor(rtOf(c), getCookie(c, COOKIE.visitor), "admin").catch(() => undefined);
  return c.json({ user: { id: u.id, name: u.name, email: u.email, role: u.role, rep_id: u.rep_id, breakglass: u.breakglass } });
});
adminApi.get("/users", async (c) => c.json({ users: await listUsers(rtOf(c)), reps: (await listReps(rtOf(c))).map((r) => ({ id: r.id, name: r.name, role: r.role, active: !!r.active })) }));
adminApi.post("/users", async (c) => {
  try {
    const u = await createUser(rtOf(c), userOf(c), await body(c));
    await audit(rtOf(c), userOf(c), ipOf(c), { action: "user_create", entity: "user", entity_id: u.id, after: { email: u.email, role: u.role, rep_id: u.rep_id } });
    return c.json({ user: u });
  } catch (e) {
    if (e instanceof UserError) return bad(c, e.message, 422);
    throw e;
  }
});
adminApi.patch("/users/:id", async (c) => {
  try {
    const r = await updateUser(rtOf(c), userOf(c), c.req.param("id"), await body(c));
    const d = diff(r.before as unknown as Record<string, unknown>, r.after as unknown as Record<string, unknown>, ["email", "name", "role", "rep_id", "active"]);
    await audit(rtOf(c), userOf(c), ipOf(c), { action: "user_update", entity: "user", entity_id: r.after.id, before: d.before, after: d.after });
    return c.json({ ok: true, user: r.after });
  } catch (e) {
    if (e instanceof UserError) return bad(c, e.message, 422);
    throw e;
  }
});
adminApi.get("/audit", async (c) => c.json(await auditReport(rtOf(c), { entity: c.req.query("entity"), user: c.req.query("user"), page: Number(c.req.query("page") || 1) })));

// ── Attribution, cohorts and exports ─────────────────────────────────────────

adminApi.get("/attribution", async (c) => c.json(await attributionReport(rtOf(c), filters(c), c.req.query("model"), c.req.query("dim"))));
adminApi.get("/cohorts", async (c) => c.json(await cohortsReport(rtOf(c), c.req.query("by"))));
adminApi.get("/exports/:file", async (c) => {
  const u = userOf(c);
  if (u.role !== "owner" && u.role !== "manager") return c.json({ error: "Your role does not allow this." }, 403);
  const m = /^([a-z]+)\.csv$/.exec(c.req.param("file"));
  const csv = m ? await exportCsv(rtOf(c), m[1], filters(c), (k) => c.req.query(k)) : null;
  if (csv == null) return bad(c, "Unknown export.", 404);
  await audit(rtOf(c), u, ipOf(c), { action: "export", entity: "export", entity_id: m![1], after: { range: filters(c).range } });
  const day = new Date(rtOf(c).now()).toISOString().slice(0, 10);
  return new Response(csv, { headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": `attachment; filename="${m![1]}-${day}.csv"`, "cache-control": "no-store" } });
});

// ── API keys and webhooks (owners and managers) ──────────────────────────────

adminApi.get("/api-keys", async (c) => c.json({ keys: await listKeys(rtOf(c)), scopes: API_SCOPES }));
adminApi.post("/api-keys", async (c) => {
  try {
    const r = await createKey(rtOf(c), await body(c), userOf(c).id);
    await audit(rtOf(c), userOf(c), ipOf(c), { action: "api_key_create", entity: "api_key", entity_id: r.row.id, after: { name: r.row.name, scopes: r.row.scopes } });
    return c.json(r);
  } catch (e) {
    if (e instanceof ApiKeyError) return bad(c, e.message, 422);
    throw e;
  }
});
adminApi.post("/api-keys/:id/revoke", async (c) => {
  const id = c.req.param("id");
  if (!(await revokeKey(rtOf(c), id))) return bad(c, "Key not found or already revoked.", 404);
  await audit(rtOf(c), userOf(c), ipOf(c), { action: "api_key_revoke", entity: "api_key", entity_id: id });
  return c.json({ ok: true });
});
adminApi.get("/webhooks", async (c) => c.json(await subsPayload(rtOf(c))));
adminApi.post("/webhooks", async (c) => {
  try {
    const s = await createSub(rtOf(c), await body(c));
    await audit(rtOf(c), userOf(c), ipOf(c), { action: "webhook_create", entity: "webhook", entity_id: s.id, after: { host: new URL(s.url).host, events: s.events } });
    return c.json({ id: s.id, secret: s.secret });
  } catch (e) {
    if (e instanceof WebhookError) return bad(c, e.message, 422);
    throw e;
  }
});
adminApi.patch("/webhooks/:id", async (c) => {
  const b = await body(c);
  if (!(await setSubActive(rtOf(c), c.req.param("id"), b.active === true))) return bad(c, "Webhook not found.", 404);
  await audit(rtOf(c), userOf(c), ipOf(c), { action: b.active === true ? "webhook_resume" : "webhook_pause", entity: "webhook", entity_id: c.req.param("id") });
  return c.json({ ok: true });
});
adminApi.delete("/webhooks/:id", async (c) => {
  if (!(await deleteSub(rtOf(c), c.req.param("id")))) return bad(c, "Webhook not found.", 404);
  await audit(rtOf(c), userOf(c), ipOf(c), { action: "webhook_delete", entity: "webhook", entity_id: c.req.param("id") });
  return c.json({ ok: true });
});

// ── Duplicates and data quality ──────────────────────────────────────────────

adminApi.get("/duplicates", async (c) => c.json(await duplicatesReport(rtOf(c))));
adminApi.get("/data-quality", async (c) => c.json(await dataQuality(rtOf(c))));
adminApi.post("/leads/:id/merge", async (c) => {
  const u = userOf(c);
  if (u.role !== "owner" && u.role !== "manager") return c.json({ error: "Your role does not allow this." }, 403);
  const b = await body(c);
  const into = typeof b.into === "string" ? b.into : "";
  const id = c.req.param("id");
  if (!/^l[0-9a-z]{19}$/.test(id) || !/^l[0-9a-z]{19}$/.test(into)) return bad(c, "bad id");
  try {
    const r = await mergeLeads(rtOf(c), id, into);
    const loser = r.survivor.id === id ? into : id;
    await rtOf(c).env.DB.prepare("INSERT OR REPLACE INTO lead_redirects (from_id, to_id, at) VALUES (?,?,?)").bind(loser, r.survivor.id, rtOf(c).now()).run();
    await rtOf(c).env.DB.prepare("UPDATE lead_redirects SET to_id = ? WHERE to_id = ?").bind(r.survivor.id, loser).run();
    await audit(rtOf(c), u, ipOf(c), { action: "lead_merge", entity: "lead", entity_id: r.survivor.id, before: { merged: r.loser_ref }, after: { survivor: r.survivor.ref_code, tables: r.tables } });
    return c.json({ ok: true, survivor: publicLead(r.survivor), merged: r.loser_ref });
  } catch (e) {
    if (e instanceof MergeError) return bad(c, e.message, 422);
    throw e;
  }
});

// ── Team ─────────────────────────────────────────────────────────────────────

adminApi.get("/team", async (c) => c.json({ reps: await listReps(rtOf(c)) }));
adminApi.post("/team", async (c) => {
  try {
    const rep = await createRep(rtOf(c), await body(c));
    await audit(rtOf(c), userOf(c), ipOf(c), { action: "rep_create", entity: "rep", entity_id: rep.id, after: { name: rep.name, role: rep.role, tiers: rep.tiers, weight: rep.weight } });
    return c.json({ rep });
  } catch (e) {
    return bad(c, errMsg(e));
  }
});
const REP_AUDIT = ["name", "email", "role", "tiers", "weight", "calendar_url", "commission_pct", "monthly_target", "slack_user_id", "discord_user_id", "active"];
adminApi.patch("/team/:id", async (c) => {
  const rt = rtOf(c);
  const id = c.req.param("id");
  const before = (await listReps(rt)).find((r) => r.id === id) || null;
  await updateRep(rt, id, await body(c));
  const after = (await listReps(rt)).find((r) => r.id === id) || null;
  const d = diff(before as unknown as Record<string, unknown>, after as unknown as Record<string, unknown>, REP_AUDIT);
  if (Object.keys(d.after).length) await audit(rt, userOf(c), ipOf(c), { action: "rep_update", entity: "rep", entity_id: id, before: d.before, after: d.after });
  return c.json({ ok: true });
});
adminApi.delete("/team/:id", async (c) => {
  await deleteRep(rtOf(c), c.req.param("id"));
  await audit(rtOf(c), userOf(c), ipOf(c), { action: "rep_deactivate", entity: "rep", entity_id: c.req.param("id") });
  return c.json({ ok: true });
});
adminApi.post("/team/test-ping", async (c) => {
  const rt = rtOf(c);
  if (!rt.settings.has("SLACK_WEBHOOK_URL") && !rt.settings.has("DISCORD_WEBHOOK_URL")) return bad(c, "Add a Slack or Discord webhook in Integrations first.", 422);
  return c.json(await notifyTeam(rt, "test", null));
});

// ── Leads ────────────────────────────────────────────────────────────────────

const leadQuery = (c: Ctx) => ({ q: c.req.query("q"), status: c.req.query("status"), tier: c.req.query("tier"), sort: c.req.query("sort"), page: Number(c.req.query("page") || 1) });

adminApi.get("/leads", async (c) => {
  const scope = repScope(userOf(c));
  if (scope === null) return c.json({ rows: [], total: 0, page: 1, per_page: 50, pages: 1 });
  return c.json(await listLeads(rtOf(c), filters(c), { ...leadQuery(c), rep: scope }));
});
adminApi.get("/leads.csv", async (c) => {
  const csv = await leadsCsv(rtOf(c), filters(c), leadQuery(c));
  const day = new Date(rtOf(c).now()).toISOString().slice(0, 10);
  return new Response(csv, {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="leads-${day}.csv"`,
      "cache-control": "no-store",
    },
  });
});

/** The lead row without raw JSON blobs (those are returned parsed). */
function publicLead(l: Lead) {
  const { answers: _a, score_breakdown: _s, booking_answers: _b, ...rest } = l;
  return rest;
}

const parse = <T>(s: string | null | undefined, fb: T): T => {
  if (!s) return fb;
  try { return JSON.parse(s) as T; } catch { return fb; }
};

const QUIET_EVENTS = new Set(["scroll", "engaged", "first_interaction", "click", "field_interaction", "cta_hover", "section_dwell", "vsl_volume", "email_sent", "consent_set", "booking_page_ready"]);
const SAFE_PROPS = ["step", "tier", "score", "video", "percent", "from", "to", "kind", "rule", "reason", "amount", "simulated"];

const EVENT_LABELS: Record<string, string> = {
  page_view: "Viewed a page", lead_captured: "Left contact details", app_step: "Answered an application step", app_submitted: "Submitted the application",
  lead_qualified: "Scored", booking_scheduled: "Booked a call", booking_rescheduled: "Rescheduled", booking_cancelled: "Cancelled the booking",
  booking_claimed: "Booking claimed in browser", call_showed: "Showed up to the call", call_no_show: "No-show", deal_won: "Won", deal_lost: "Lost",
  payment_recorded: "Payment recorded", lead_status_changed: "Status changed", unsubscribed: "Unsubscribed", email_opened: "Opened an email",
  email_clicked: "Clicked an email link", whatsapp_click: "Clicked WhatsApp", whatsapp_in: "Messaged on WhatsApp", link_click: "Clicked a tracked link",
  ai_call_queued: "AI call queued", ai_call_started: "AI call started", ai_call_completed: "Spoke with the AI assistant", ai_call_unanswered: "AI call not answered",
  inbound_call: "Called in", trigger_fired: "Behaviour email triggered", vsl_play: "Played the film", vsl_unmute: "Unmuted the film",
  vsl_25: "Watched 25%", vsl_50: "Watched 50%", vsl_75: "Watched 75%", vsl_95: "Watched 95%", vsl_complete: "Finished the film",
  vsl_cta_reveal: "Reached the pitch", vsl_cta_click: "Clicked apply under the film", vsl_rewatch: "Rewatched part of the film", vsl_skip: "Skipped ahead",
  vsl_pause: "Paused the film", vsl_speed: "Changed playback speed", vsl_fullscreen: "Went full screen", vsl_restart: "Restarted the film",
  cta_click: "Clicked a call to action", tab_return: "Came back to the tab", text_select: "Highlighted text", text_copy: "Copied text",
  section_revisit: "Re-read a section", page_exit: "Left the page", rage_click: "Rage-clicked", exit_intent: "Moved to leave", faq_open: "Opened an FAQ",
  app_back: "Went back in the application", booking_date_selected: "Picked a date on the calendar", continue_link_sent: "Continue link sent",
};

function eventDetail(name: string, propsRaw: string | null, path: string | null): string {
  const p = parse<Record<string, unknown>>(propsRaw, {});
  const bits: string[] = [];
  if (name === "page_view" && path) bits.push(path.split("?")[0].slice(0, 80));
  if (name === "faq_open") {
    const f = FAQS.find((x) => x.id === p.id);
    if (f) bits.push(f.q);
  }
  if ((name === "section_revisit" || name === "page_exit" || name === "text_select" || name === "text_copy") && p.section) bits.push(cleanName(p.section));
  for (const k of SAFE_PROPS) {
    const v = p[k];
    if (v == null || v === "" || typeof v === "object") continue;
    bits.push(`${k} ${String(v).slice(0, 40)}`);
  }
  return bits.join(" · ");
}

const CONV_RE = /^[A-Za-z0-9_-]{6,80}$/;

adminApi.get("/leads/:id", async (c) => {
  const rt = rtOf(c);
  const lead = await visibleLead(c, c.req.param("id"));
  if (!lead) {
    // Merged into another lead: follow it. Erased: say so instead of "not found".
    const id = c.req.param("id");
    const moved = await one<{ to_id: string }>(rt, "SELECT to_id FROM lead_redirects WHERE from_id = ?", [id]);
    if (moved && (await visibleLead(c, moved.to_id))) return c.json({ moved_to: moved.to_id });
    const erased = await one<{ ts: number }>(rt, "SELECT ts FROM audit_log WHERE entity = 'lead' AND entity_id = ? AND action IN ('lead_erase','test_purge') ORDER BY ts DESC LIMIT 1", [id]);
    if (erased || moved) return c.json({ gone: true, erased_at: erased?.ts ?? null });
    return bad(c, "not found", 404);
  }
  const vid = lead.visitor_id || "";
  const [events, emails, calls, voice, payments, bookings, sessions, vsl, reps, facts] = await Promise.all([
    all<{ id: string; ts: number; name: string; path: string | null; source: string; props: string | null }>(rt,
      "SELECT id, ts, name, path, source, props FROM events WHERE lead_id = ? OR (visitor_id = ? AND visitor_id != '') ORDER BY ts DESC LIMIT 500", [lead.id, vid]),
    all<{ id: string; sequence: string; step: number; template: string; status: string; send_at: number; sent_at: number | null; subject: string | null; opens: number; clicks: number; error: string | null }>(rt,
      "SELECT id, sequence, step, template, status, send_at, sent_at, subject, opens, clicks, error FROM emails WHERE lead_id = ? ORDER BY send_at DESC LIMIT 300", [lead.id]),
    all<{ id: string; kind: string; status: string; run_at: number; outcome: string | null; attempts: number; created_at: number }>(rt,
      "SELECT id, kind, status, run_at, outcome, attempts, created_at FROM outbound_calls WHERE lead_id = ? ORDER BY created_at DESC LIMIT 50", [lead.id]),
    all<{ id: string; provider: string; direction: string; conversation_id: string | null; status: string | null; started_at: number | null; duration_s: number | null; transcript: string | null; summary: string | null; structured: string | null; match_kind: string | null; created_at: number }>(rt,
      "SELECT id, provider, direction, conversation_id, status, started_at, duration_s, transcript, summary, structured, match_kind, created_at FROM voice_calls WHERE lead_id = ? ORDER BY created_at DESC LIMIT 20", [lead.id]),
    listPayments(rt, lead.id),
    all<{ invitee_uri: string; event_name: string | null; start_at: number | null; status: string | null; no_show: number; rescheduled: number; host_email: string | null; answers: string | null; match_kind: string | null; created_at: number }>(rt,
      "SELECT invitee_uri, event_name, start_at, status, no_show, rescheduled, host_email, answers, match_kind, created_at FROM calendly_bookings WHERE lead_id = ? OR (email = ? AND lead_id IS NULL) ORDER BY start_at DESC LIMIT 20", [lead.id, lead.email]),
    all<{ started_at: number; landing_path: string | null; channel: string | null; utm_source: string | null; utm_campaign: string | null; utm_content: string | null; country: string | null; city: string | null; device: string | null; browser: string | null; os: string | null; engaged_ms: number; max_scroll: number; pageviews: number; variant: string | null; lander: string | null }>(rt,
      `SELECT started_at, landing_path, channel, utm_source, utm_campaign, utm_content, country, city, device, browser, os, engaged_ms, max_scroll, pageviews, variant, lander
       FROM sessions WHERE lead_id = ? OR (visitor_id = ? AND visitor_id != '') ORDER BY started_at DESC LIMIT 30`, [lead.id, vid]),
    all<{ video: string; buckets: string; completed: number; max_position: number; last_at: number }>(rt,
      "SELECT video, buckets, completed, max_position, last_at FROM vsl_views WHERE lead_id = ? OR (visitor_id = ? AND visitor_id != '')", [lead.id, vid]),
    listReps(rt),
    buildProfile(rt, lead).catch(() => []),
  ]);
  const revops = await one<{ ft_ad_id: string | null; p_win: number | null; noshow_risk: number | null; noshow_reasons: string | null; email_status: string | null; pipeline_stage: string | null; score_model: string | null }>(rt,
    "SELECT ft_ad_id, p_win, noshow_risk, noshow_reasons, email_status, pipeline_stage, score_model FROM lead_revops WHERE lead_id = ?", [lead.id]).catch(() => null);
  const [touches, receivables, plan, review, test] = await Promise.all([listTouches(rt, lead.id), listReceivables(rt, lead.id), getPlan(rt, lead.id), latestReview(rt, lead.id),
    one<{ is_test: number | null; test_reason: string | null }>(rt, "SELECT is_test, test_reason FROM lead_revops WHERE lead_id = ?", [lead.id])]);

  const answers = parseAnswers(lead);
  const answerRows = APPLICATION.filter((q) => q.type !== "contact").map((q) => {
    const v = answers[q.id];
    const vals = Array.isArray(v) ? v : v == null ? [] : [v];
    const labels = q.type === "text" ? vals.map(String) : vals.map((x) => q.options?.find((o) => o.value === x)?.label || String(x));
    return { id: q.id, title: q.title, type: q.type, answer: labels.join(q.type === "multi" ? ", " : " ") };
  });

  type T = { ts: number; type: string; title: string; detail: string };
  const timeline: T[] = [];
  for (const e of events) {
    if (QUIET_EVENTS.has(e.name)) continue;
    timeline.push({ ts: e.ts, type: "event", title: EVENT_LABELS[e.name] || e.name.replace(/_/g, " "), detail: eventDetail(e.name, e.props, e.path) });
  }
  for (const m of emails) {
    if (m.status === "pending" || m.status === "cancelled" || m.status === "skipped") continue;
    timeline.push({ ts: m.sent_at || m.send_at, type: "email", title: `Email ${m.status}: ${m.subject || m.template}`, detail: [m.template, m.opens ? `opened ${m.opens}×` : "", m.clicks ? `clicked ${m.clicks}×` : "", m.error ? (m.error || "").slice(0, 120) : ""].filter(Boolean).join(" · ") });
  }
  for (const k of calls) timeline.push({ ts: k.run_at, type: "call", title: `AI call (${k.kind.replace(/_/g, " ")}): ${k.status}`, detail: k.outcome || "" });
  for (const p of payments) timeline.push({ ts: p.paid_at, type: "payment", title: `Payment ${Math.round(p.amount).toLocaleString("en-US")}`, detail: [p.method, p.note].filter(Boolean).join(" · ") });
  for (const v of voice) timeline.push({ ts: v.started_at || v.created_at, type: "voice", title: `${v.direction === "inbound" ? "Inbound" : "Outbound"} call${v.duration_s ? ` · ${Math.round(v.duration_s / 60 * 10) / 10} min` : ""}`, detail: (v.summary || "").slice(0, 200) });
  for (const t of touches) timeline.push({ ts: Number(t.at), type: "call", title: `Touch: ${String(t.kind)}${t.outcome ? ` · ${String(t.outcome).replace(/_/g, " ")}` : ""}`, detail: [reps.find((r) => r.id === t.rep_id)?.name, t.note ? String(t.note).slice(0, 160) : ""].filter(Boolean).join(" · ") });
  timeline.sort((a, b) => b.ts - a.ts);

  const cat = emailCatalog();
  const pendingEmails = emails.filter((m) => m.status === "pending").map((m) => ({ id: m.id, sequence: m.sequence, sequence_name: cat.sequence_names[m.sequence] || m.sequence, template: m.template, subject: cat.subjects[m.template] || m.template, send_at: m.send_at }));

  return c.json({
    lead: { ...publicLead(lead), closer: reps.find((r) => r.id === lead.closer_id)?.name || null, setter: reps.find((r) => r.id === lead.setter_id)?.name || null },
    revops: revops ? { ft_ad_id: revops.ft_ad_id, p_win: revops.p_win, noshow_risk: revops.noshow_risk, noshow_reasons: parse<string[]>(revops.noshow_reasons, []), email_status: revops.email_status, pipeline_stage: revops.pipeline_stage, score_model: revops.score_model } : null,
    touches: touches.map((t) => ({ ...t, rep: reps.find((r) => r.id === t.rep_id)?.name || null })),
    test: { is_test: test?.is_test === 1, decided: test?.is_test != null, reason: test?.test_reason || null },
    plan: plan ? { url: planUrl(rt, plan.token), body: parsePlanBody(plan.body), created_at: plan.created_at, updated_at: plan.updated_at, viewed_at: plan.viewed_at, last_viewed_at: plan.last_viewed_at, views: plan.views } : null,
    review: review || null,
    receivables,
    touch_kinds: TOUCH_KINDS, touch_outcomes: TOUCH_OUTCOMES.filter(Boolean),
    answers: answerRows,
    score_breakdown: parse(lead.score_breakdown, null),
    booking_answers: parse<Array<{ q: string; a: string }>>(lead.booking_answers, []),
    timeline: timeline.slice(0, 400),
    pending_emails: pendingEmails,
    payments,
    facts: facts.map((f) => ({ key: f.key, text: f.text, you: f.you || null, weight: f.weight, topics: f.topics, background: BACKGROUND.has(f.key) })),
    bookings: bookings.map((b) => ({ ...b, answers: parse<Array<{ q: string; a: string }>>(b.answers, []) })),
    voice_calls: voice.map((v) => ({
      id: v.id, provider: v.provider, direction: v.direction, status: v.status, started_at: v.started_at || v.created_at, duration_s: v.duration_s,
      summary: v.summary, structured: parse<Record<string, unknown>>(v.structured, {}), match_kind: v.match_kind,
      transcript: (v.transcript || "").split("\n").filter(Boolean).slice(0, 200).map((line) => {
        const m = line.match(/^(Agent|Caller):\s?(.*)$/);
        return m ? { who: m[1].toLowerCase(), text: m[2] } : { who: "caller", text: line };
      }),
      audio: v.provider === "elevenlabs" && v.conversation_id && CONV_RE.test(v.conversation_id) ? `/admin/api/voice/recording/${encodeURIComponent(v.conversation_id)}` : null,
    })),
    outbound_calls: calls,
    sessions: sessions.map((s) => ({ ...s, landing_path: s.landing_path ? s.landing_path.slice(0, 120) : null })),
    vsl: vsl.map((v) => ({ video: v.video, watched_pct: popcount(v.buckets), completed: !!v.completed, max_position: Math.round(v.max_position), last_at: v.last_at })),
    reps: reps.map((r) => ({ id: r.id, name: r.name, role: r.role, active: !!r.active })),
    options: {
      statuses: STATUSES, lost_reasons: LOST_REASONS, objections: OBJECTIONS,
      offers: ["build_day", "core", "dwy", "embedded", "custom"], payment_plans: ["full", "split_2", "split_3", "monthly", "custom"],
      temperatures: ["hot", "warm", "cold"], decision_maker: ["yes", "no", "shared"], willing: ["yes", "no", "maybe"],
      templates: Object.keys(TEMPLATES).sort(),
    },
  });
});

adminApi.patch("/leads/:id", async (c) => {
  const rt = rtOf(c);
  const lead = await visibleLead(c, c.req.param("id"));
  if (!lead) return bad(c, "not found", 404);
  const patch = (await body(c)) as LeadPatch;
  // Reps cannot hand a lead to someone else (they would lose it from view).
  if (isRep(userOf(c))) { delete patch.closer_id; delete patch.setter_id; }
  try {
    const fresh = await applyLeadUpdate(rt, lead, patch, { source: "admin" });
    await auditLead(c, "lead_update", lead, fresh);
    return c.json({ ok: true, lead: publicLead(fresh) });
  } catch (e) {
    if (e instanceof ValidationError) return bad(c, `Invalid ${e.message.replace(/_/g, " ")}`);
    throw e;
  }
});

adminApi.post("/leads/:id/payments", async (c) => {
  const rt = rtOf(c);
  const lead = await visibleLead(c, c.req.param("id"));
  if (!lead) return bad(c, "not found", 404);
  const b = await body(c);
  try {
    const p = await recordPayment(rt, lead, { amount: b.amount, paid_at: b.paid_at, method: b.method, note: b.note });
    await audit(rt, userOf(c), ipOf(c), { action: "payment_add", entity: "payment", entity_id: p.id, after: { lead_id: lead.id, amount: p.amount, paid_at: p.paid_at, method: p.method } });
    return c.json({ payment: p, payments: await listPayments(rt, lead.id) });
  } catch (e) {
    if (e instanceof ValidationError) return bad(c, "Enter an amount (negative for a refund).");
    throw e;
  }
});

adminApi.delete("/leads/:id/payments/:pid", async (c) => {
  const rt = rtOf(c);
  const lead = await visibleLead(c, c.req.param("id"));
  if (!lead) return bad(c, "not found", 404);
  const pid = c.req.param("pid");
  const before = (await listPayments(rt, lead.id)).find((p) => p.id === pid);
  if (!before) return bad(c, "Payment not found.", 404);
  await deletePayment(rt, lead.id, pid);
  await audit(rt, userOf(c), ipOf(c), { action: "payment_delete", entity: "payment", entity_id: pid, before: { lead_id: lead.id, amount: before.amount, paid_at: before.paid_at, method: before.method } });
  return c.json({ ok: true, payments: await listPayments(rt, lead.id) });
});

adminApi.get("/leads/:id/preview", async (c) => {
  const rt = rtOf(c);
  const lead = await visibleLead(c, c.req.param("id"));
  if (!lead) return bad(c, "not found", 404);
  const t = c.req.query("template") || "";
  if (!TEMPLATES[t]) return bad(c, "unknown template");
  try {
    const r = await previewTemplate(rt, lead, t);
    return c.json({ subject: r.subject, html: r.html, text: r.text, mode: r.mode, facts_used: r.factsUsed });
  } catch (e) {
    return bad(c, errMsg(e), 422);
  }
});

// ── Emails ───────────────────────────────────────────────────────────────────

adminApi.get("/emails", async (c) => {
  const rt = rtOf(c);
  const f = filters(c);
  const [counts, queue, pendingTotal, deliv, unsubs, fired] = await Promise.all([
    all<{ sequence: string; step: number; template: string; status: string; n: number; opened: number; clicked: number }>(rt,
      "SELECT sequence, step, template, status, COUNT(*) AS n, SUM(opens > 0) AS opened, SUM(clicks > 0) AS clicked FROM emails WHERE created_at >= ? GROUP BY sequence, step, template, status", [f.since]),
    all<{ id: string; lead_id: string; sequence: string; step: number; template: string; send_at: number; first_name: string | null; last_name: string | null; email: string | null }>(rt,
      `SELECT e.id, e.lead_id, e.sequence, e.step, e.template, e.send_at, l.first_name, l.last_name, l.email FROM emails e LEFT JOIN leads l ON l.id = e.lead_id
       WHERE e.status = 'pending'${f.includeTest ? "" : " AND e.lead_id NOT IN (SELECT lead_id FROM lead_revops WHERE is_test = 1)"} ORDER BY e.send_at LIMIT 200`),
    one<{ n: number; due: number }>(rt, "SELECT COUNT(*) AS n, SUM(send_at <= ?) AS due FROM emails WHERE status = 'pending'", [rt.now()]),
    one<Record<string, number>>(rt,
      `SELECT SUM(status = 'sent') AS sent, SUM(status = 'simulated') AS simulated, SUM(status = 'failed') AS failed, SUM(status = 'skipped') AS skipped,
         SUM(status = 'cancelled') AS cancelled, SUM(opens > 0) AS opened, SUM(clicks > 0) AS clicked FROM emails WHERE COALESCE(sent_at, created_at) >= ?`, [f.since]),
    one<{ n: number }>(rt, "SELECT COUNT(*) AS n FROM leads WHERE unsubscribed_at >= ?", [f.since]),
    all<{ step: number; n: number }>(rt, "SELECT step, COUNT(*) AS n FROM emails WHERE sequence = 'behaviour' AND status IN ('sent','simulated') GROUP BY step"),
  ]);
  const stepStats = (seq: string, step: number | null, template: string | null) => {
    const rows = counts.filter((r) => r.sequence === seq && (step == null || r.step === step) && (template == null || r.template === template));
    const by = (s: string) => rows.filter((r) => r.status === s).reduce((t, r) => t + num(r.n), 0);
    const delivered = rows.filter((r) => r.status === "sent" || r.status === "simulated");
    return {
      sent: by("sent"), simulated: by("simulated"), failed: by("failed"), pending: by("pending"), cancelled: by("cancelled") + by("skipped"),
      opened: delivered.reduce((t, r) => t + num(r.opened), 0), clicked: delivered.reduce((t, r) => t + num(r.clicked), 0),
    };
  };
  const sequences = Object.values(SEQUENCES).map((s) => {
    const dynamic = s.steps.length === 0;
    const steps = dynamic
      ? [...new Set(counts.filter((r) => r.sequence === s.id).map((r) => r.template))].sort().map((t, i) => ({ index: i, template: t, offset_ms: null as number | null, anchor: null as string | null, ...stepStats(s.id, null, t) }))
      : s.steps.map((st, i) => ({ index: i, template: st.template, offset_ms: st.offset, anchor: st.anchor || "enqueue", ...stepStats(s.id, i, null) }));
    return { id: s.id, label: s.label, trigger: s.trigger, dynamic, steps };
  });
  const d = deliv || {};
  const delivered = num(d.sent) + num(d.simulated);
  const cat = emailCatalog();
  // The same person queued twice for the same email around the same time is one row with a count.
  const queueRows = groupQueue(queue.map((q) => ({ id: q.id, lead_id: q.lead_id, name: [q.first_name, q.last_name].filter(Boolean).join(" ") || q.email || "", email: q.email || "", sequence: q.sequence, step: q.step, template: q.template, send_at: q.send_at })))
    .slice(0, 100).map((q) => ({ ...q, sequence_name: cat.sequence_names[q.sequence] || q.sequence, subject: cat.subjects[q.template] || q.template }));
  return c.json({
    health: await deliverabilityPayload(rt, Math.max(f.since, rt.now() - 90 * 86_400_000)),
    mode: rt.settings.has("RESEND_API_KEY") && rt.settings.has("EMAIL_FROM") ? "live" : "simulated",
    sequences,
    queue: queueRows,
    sequence_names: cat.sequence_names,
    queue_total: num(pendingTotal?.n), queue_due: num(pendingTotal?.due),
    triggers: cat.triggers.map((t) => ({ ...t, fired: num(fired.find((x) => x.step === t.index)?.n) })),
    deliverability: {
      sent: num(d.sent), simulated: num(d.simulated), failed: num(d.failed), skipped: num(d.skipped), cancelled: num(d.cancelled),
      opens: num(d.opened), clicks: num(d.clicked), unsubscribes: num(unsubs?.n),
      open_rate: pct(num(d.opened), delivered), click_rate: pct(num(d.clicked), delivered), failure_rate: pct(num(d.failed), delivered + num(d.failed)),
    },
    templates: Object.keys(TEMPLATES).sort().map((id) => ({ id, subject: cat.subjects[id] || id, topics: TEMPLATE_TOPICS[id] || [] })),
  });
});
/** Pure: collapse queue rows for the same person (base email) and template due within 10 minutes of each other. */
export function groupQueue<T extends { email: string; name: string; template: string; send_at: number }>(rows: T[]): Array<T & { count: number }> {
  const out: Array<T & { count: number }> = [];
  const key = (r: T) => `${(r.email || r.name).toLowerCase().replace(/\+[^@]*@/, "@")}|${r.template}`;
  for (const r of rows) {
    const prev = out.find((o) => key(o) === key(r) && Math.abs(o.send_at - r.send_at) <= 10 * 60_000);
    if (prev) prev.count++;
    else out.push({ ...r, count: 1 });
  }
  return out;
}

adminApi.get("/emails/preview", async (c) => {
  const t = c.req.query("template") || "";
  if (!TEMPLATES[t]) return bad(c, "unknown template");
  try {
    const r = await previewTemplate(rtOf(c), null, t);
    return c.json({ subject: r.subject, html: r.html, text: r.text, mode: r.mode });
  } catch (e) {
    return bad(c, errMsg(e), 422);
  }
});
adminApi.post("/emails/run-queue", async (c) => c.json(await processEmailQueue(rtOf(c))));
adminApi.post("/emails/resume", async (c) => {
  await resumeMarketing(rtOf(c));
  return c.json({ ok: true });
});

// ── Voice ────────────────────────────────────────────────────────────────────

const VOICE_TOGGLES = ["AI_CALL_CONFIRM", "AI_CALL_SPEED_TO_LEAD", "AI_CALL_REBOOK"];

adminApi.get("/voice", async (c) => {
  const rt = rtOf(c);
  const s = rt.settings;
  const f = filters(c);
  const [outbound, voice, stats] = await Promise.all([
    all<{ id: string; lead_id: string | null; kind: string; phone: string; status: string; run_at: number; attempts: number; outcome: string | null; error: string | null; created_at: number; first_name: string | null; last_name: string | null }>(rt,
      `SELECT o.id, o.lead_id, o.kind, o.phone, o.status, o.run_at, o.attempts, o.outcome, o.error, o.created_at, l.first_name, l.last_name
       FROM outbound_calls o LEFT JOIN leads l ON l.id = o.lead_id WHERE o.created_at >= ? ORDER BY o.created_at DESC LIMIT 100`, [f.since]),
    all<{ id: string; lead_id: string | null; direction: string; provider: string; conversation_id: string | null; status: string | null; started_at: number | null; duration_s: number | null; summary: string | null; match_kind: string | null; created_at: number; first_name: string | null; last_name: string | null }>(rt,
      `SELECT v.id, v.lead_id, v.direction, v.provider, v.conversation_id, v.status, v.started_at, v.duration_s, v.summary, v.match_kind, v.created_at, l.first_name, l.last_name
       FROM voice_calls v LEFT JOIN leads l ON l.id = v.lead_id WHERE v.created_at >= ? ORDER BY v.created_at DESC LIMIT 100`, [f.since]),
    all<{ kind: string; outcome: string | null; status: string; n: number }>(rt, "SELECT kind, outcome, status, COUNT(*) AS n FROM outbound_calls WHERE created_at >= ? GROUP BY kind, outcome, status", [f.since]),
  ]);
  const mask = (p: string | null) => (p ? `•••• ${p.replace(/\D/g, "").slice(-4)}` : "");
  const name = (r: { first_name: string | null; last_name: string | null }) => [r.first_name, r.last_name].filter(Boolean).join(" ");
  const by = (k: (r: (typeof stats)[number]) => boolean) => stats.filter(k).reduce((t, r) => t + num(r.n), 0);
  return c.json({
    setup: {
      api_key: s.has("ELEVENLABS_API_KEY"),
      agent: s.has("ELEVENLABS_AGENT_ID"),
      inbound_agent: s.has("ELEVENLABS_INBOUND_AGENT_ID"),
      phone_number: s.has("ELEVENLABS_PHONE_NUMBER_ID"),
      phone_number_id: s.get("ELEVENLABS_PHONE_NUMBER_ID") || null,
      phone_number_locked: s.source("ELEVENLABS_PHONE_NUMBER_ID") === "env",
      webhook_secret: s.has("ELEVENLABS_WEBHOOK_SECRET"),
      init_secret: s.has("ELEVENLABS_INIT_SECRET"),
      configured: voiceConfigured(rt),
      test_number: s.get("AI_CALL_TEST_NUMBER") || null,
      callback_number: s.get("AI_CALL_CALLBACK_NUMBER") || null,
      daily_cap: s.num("AI_CALL_DAILY_CAP", 40),
      webhook_url: `${rt.origin}/hooks/elevenlabs`,
    },
    toggles: VOICE_TOGGLES.map((k) => ({ key: k, label: settingDef(k)?.label || k, on: s.bool(k), locked: s.source(k) === "env" })),
    stats: {
      queued: by((r) => r.status === "queued"), placed: by((r) => r.status === "done" && r.outcome !== "simulated"),
      answered: by((r) => r.outcome === "answered"), voicemail: by((r) => r.outcome === "voicemail"), no_answer: by((r) => r.outcome === "no_answer"),
      simulated: by((r) => r.outcome === "simulated"), failed: by((r) => r.status === "failed"), cancelled: by((r) => r.status === "cancelled"),
      inbound: voice.filter((v) => v.direction === "inbound").length,
    },
    outbound: outbound.map((o) => ({ id: o.id, lead_id: o.lead_id, name: name(o), kind: o.kind, phone: mask(o.phone), status: o.status, run_at: o.run_at, attempts: o.attempts, outcome: o.outcome, error: o.error ? o.error.slice(0, 160) : null, created_at: o.created_at })),
    calls: voice.map((v) => ({
      id: v.id, lead_id: v.lead_id, name: name(v), direction: v.direction, provider: v.provider, status: v.status, started_at: v.started_at || v.created_at,
      duration_s: v.duration_s, summary: v.summary ? v.summary.slice(0, 400) : null, match_kind: v.match_kind,
      audio: v.provider === "elevenlabs" && v.conversation_id && CONV_RE.test(v.conversation_id) ? `/admin/api/voice/recording/${encodeURIComponent(v.conversation_id)}` : null,
    })),
  });
});
adminApi.post("/voice/provision", async (c) => c.json(await provision(rtOf(c))));
adminApi.get("/voice/numbers", async (c) => {
  const rt = rtOf(c);
  if (!rt.settings.has("ELEVENLABS_API_KEY")) return bad(c, "Add the ElevenLabs API key first.", 422);
  try {
    return c.json({ numbers: await listPhoneNumbers(rt), selected: rt.settings.get("ELEVENLABS_PHONE_NUMBER_ID") || null });
  } catch (e) {
    return bad(c, errMsg(e), 422);
  }
});
adminApi.post("/voice/number", async (c) => {
  const rt = rtOf(c);
  const b = await body(c);
  const id = typeof b.phone_number_id === "string" ? b.phone_number_id.trim() : "";
  if (!/^[A-Za-z0-9_-]{4,80}$/.test(id)) return bad(c, "Pick a phone number.");
  if (rt.settings.source("ELEVENLABS_PHONE_NUMBER_ID") === "env") return bad(c, "This value is set as an environment variable and can only be changed there.", 409);
  await saveSetting(rt.env, "ELEVENLABS_PHONE_NUMBER_ID", id);
  return c.json({ ok: true });
});
adminApi.post("/voice/test-call", async (c) => {
  const rt = rtOf(c);
  const b = await body(c);
  const raw = typeof b.to === "string" && b.to.trim() ? b.to : rt.settings.get("AI_CALL_TEST_NUMBER");
  const to = normalizePhone(raw, null);
  if (!to) return bad(c, "Enter your phone number in international format, e.g. +47 912 34 567.");
  if (typeof b.to === "string" && b.to.trim() && rt.settings.source("AI_CALL_TEST_NUMBER") !== "env") await saveSetting(rt.env, "AI_CALL_TEST_NUMBER", to);
  const fresh: Runtime = { ...rt, settings: await loadSettings(rt.env) };
  const r = await testCall(fresh, to);
  return r.ok ? c.json({ ok: true }) : bad(c, r.error || "Call failed", 422);
});
adminApi.get("/voice/recording/:conversationId", async (c) => {
  const rt = rtOf(c);
  const id = c.req.param("conversationId");
  if (!CONV_RE.test(id)) return bad(c, "bad id");
  if (!rt.settings.has("ELEVENLABS_API_KEY")) return bad(c, "ElevenLabs is not configured.", 404);
  const up = await fetch(`https://api.elevenlabs.io/v1/convai/conversations/${encodeURIComponent(id)}/audio`, {
    headers: { "xi-api-key": rt.settings.get("ELEVENLABS_API_KEY") },
  });
  if (!up.ok || !up.body) return bad(c, up.status === 404 ? "Recording not found" : `Recording unavailable (${up.status})`, 404);
  const headers = new Headers({ "content-type": up.headers.get("content-type") || "audio/mpeg", "cache-control": "no-store" });
  const len = up.headers.get("content-length");
  if (len) headers.set("content-length", len);
  return new Response(up.body, { status: 200, headers });
});

// ── Integrations ─────────────────────────────────────────────────────────────

const GROUPS: Record<string, { label: string; description: string; required: string[][] }> = {
  site: { label: "Site", description: "Your public domain and name. Links in emails use the URL.", required: [["PUBLIC_URL"]] },
  email: { label: "Email (Resend)", description: "Sends every sequence. Without a key, emails are simulated and logged. Point a Resend webhook at /hooks/resend for bounces and complaints.", required: [["RESEND_API_KEY", "EMAIL_FROM", "BUSINESS_ADDRESS"]] },
  calendly: { label: "Calendly", description: "Verifies bookings, catches cancellations and no-shows, imports past calls.", required: [["CALENDLY_API_TOKEN", "CALENDLY_SIGNING_KEY"]] },
  booking: { label: "Booking calendars", description: "Where A and B tier leads book.", required: [["BOOKING_URL_A"]] },
  claude: { label: "Claude", description: "Personalises emails from what each lead did. Rules mode runs without a key.", required: [["ANTHROPIC_API_KEY"]] },
  voice: { label: "AI calls (ElevenLabs)", description: "Speed-to-lead, confirm and rebook calls, plus the inbound callback agent.", required: [["ELEVENLABS_API_KEY", "ELEVENLABS_AGENT_ID", "ELEVENLABS_PHONE_NUMBER_ID"]] },
  notify: { label: "Team pings", description: "Slack or Discord pings for hot leads, bookings, no-shows and wins, plus the daily digest.", required: [["SLACK_WEBHOOK_URL"], ["DISCORD_WEBHOOK_URL"]] },
  meta: { label: "Meta Conversions API", description: "Server-side events with qualified-lead values, deduplicated with the Pixel. CRM stages (show, no-show, won, lost, payments) go as offline events.", required: [["META_PIXEL_ID", "META_ACCESS_TOKEN"]] },
  ads: { label: "Meta Ads spend", description: "Pulls spend per ad every hour for CAC and ROAS on Traffic. Other platforms: import a CSV on the Traffic tab.", required: [["META_ADS_TOKEN", "META_AD_ACCOUNT_ID"]] },
  ga4: { label: "Google Analytics 4", description: "Measurement Protocol events from the server.", required: [["GA4_MEASUREMENT_ID", "GA4_API_SECRET"]] },
  posthog: { label: "PostHog", description: "Product analytics and optional session replay through a first-party proxy.", required: [["POSTHOG_KEY"]] },
  whatsapp: { label: "WhatsApp", description: "The founder number turns on the WhatsApp buttons. The Cloud API adds templates and inbound.", required: [["FOUNDER_WHATSAPP"]] },
  turnstile: { label: "Turnstile", description: "Bot protection on the application.", required: [["TURNSTILE_SITE_KEY", "TURNSTILE_SECRET_KEY"]] },
  crm: { label: "CRM webhook", description: "Posts every lead event to your CRM or Zapier.", required: [["LEAD_WEBHOOK_URL"]] },
  video: { label: "Video", description: "Where the films are hosted (MP4 or HLS).", required: [["VSL_MAIN_SRC"]] },
  privacy: { label: "Privacy", description: "Consent, IP handling and the blocklist. Safe defaults apply.", required: [] },
  pacing: { label: "Pacing", description: "How many pre-call emails a day and the sales time zone.", required: [] },
  vapi: { label: "Vapi (legacy voice)", description: "Optional web assistant. ElevenLabs is the main voice stack.", required: [["VAPI_API_KEY", "VAPI_ASSISTANT_ID"]] },
};

function integrationEntry(def: SettingDef, s: Runtime["settings"]) {
  const source = s.source(def.key);
  return {
    key: def.key, group: def.group, label: def.label, help: def.help || null, kind: def.kind || "text", options: def.options || null,
    secret: !!def.secret, source, locked: source === "env", set: s.has(def.key),
    // maskValue never returns a secret: "set" or the last 4 of a long one.
    value: maskValue(def, s.get(def.key)),
  };
}

function integrationsPayload(s: Runtime["settings"]) {
  const groups = Object.entries(GROUPS).map(([id, g]) => {
    const settings = SETTINGS.filter((d) => d.group === id).map((d) => integrationEntry(d, s));
    const ok = g.required.length === 0 ? null : g.required.some((set) => set.every((k) => s.has(k)));
    const any = settings.some((x) => x.set && x.source !== "default");
    return { id, label: g.label, description: g.description, state: ok === null ? "defaults" : ok ? "connected" : any ? "partial" : "off", settings };
  });
  return { groups };
}

adminApi.get("/integrations", async (c) => c.json(integrationsPayload(rtOf(c).settings)));
adminApi.put("/integrations", async (c) => {
  const rt = rtOf(c);
  const b = await body(c);
  const key = typeof b.key === "string" ? b.key : "";
  const def = settingDef(key);
  if (!def) return bad(c, "Unknown setting.");
  if (key === "LEARNED_ROUTING" || key === "LEARNED_POINTS") return bad(c, "The owner switches learned routing on Insights → Scoring calibration.", 409);
  if (rt.settings.source(key) === "env") return bad(c, "This value is set as an environment variable (wrangler secret or var). Change it there.", 409);
  const raw = b.value == null ? "" : typeof b.value === "string" || typeof b.value === "number" || typeof b.value === "boolean" ? String(b.value).trim() : null;
  if (raw == null) return bad(c, "Value must be text.");
  if (raw.length > 4000) return bad(c, "Value is too long.");
  if (raw) {
    if (def.kind === "bool" && !["true", "false"].includes(raw)) return bad(c, "Use true or false.");
    if (def.kind === "number" && !Number.isFinite(Number(raw))) return bad(c, "Enter a number.");
    if (def.kind === "select" && !(def.options || []).includes(raw)) return bad(c, "Pick one of the options.");
    if (def.kind === "url" && !/^https?:\/\/[^\s"'<>]+$/.test(raw)) return bad(c, "Enter a full URL starting with https://");
    if (OUTBOUND_KEYS.includes(key) && !validOutbound(key, raw)) {
      return bad(c, key.startsWith("SLACK") ? "Use a Slack incoming webhook (https://hooks.slack.com/…)." : key.startsWith("DISCORD") ? "Use a Discord webhook (https://discord.com/api/webhooks/…)." : key === "POSTHOG_HOST" ? "Use your PostHog host, e.g. https://eu.i.posthog.com." : "Use an https:// URL.");
    }
  }
  const had = rt.settings.source(key) === "db";
  await saveSetting(rt.env, key, raw);
  // Key names only, never values.
  await audit(rt, userOf(c), ipOf(c), { action: raw ? "setting_set" : "setting_clear", entity: "setting", entity_id: key, before: { set: had }, after: { set: !!raw } });
  const fresh = await loadSettings(rt.env);
  return c.json({ ok: true, setting: integrationEntry(def, fresh), ...integrationsPayload(fresh) });
});
adminApi.post("/integrations/test-email", async (c) => {
  const b = await body(c);
  const to = typeof b.to === "string" ? b.to.trim().toLowerCase() : "";
  if (!/^[^\s@<>"]+@[^\s@<>"]+\.[a-z]{2,}$/i.test(to) || to.length > 200) return bad(c, "Enter a valid email address.");
  const r = await sendTestEmail(rtOf(c), to);
  return r.ok ? c.json(r) : bad(c, r.error || "Send failed", 422);
});
adminApi.post("/integrations/email/dns-check", async (c) => {
  const r = await checkEmailDns(rtOf(c));
  await cacheDnsResult(rtOf(c), r);
  return c.json(r);
});
adminApi.post("/integrations/calendly/connect", async (c) => c.json(await connectCalendly(rtOf(c))));
adminApi.post("/integrations/calendly/sync", async (c) => {
  const r = await syncCalendly(rtOf(c), true);
  return r ? c.json({ ok: true, ...r }) : bad(c, "Connect Calendly first.", 422);
});
adminApi.post("/integrations/calendly/import", async (c) => c.json({ ok: true, ...(await importCalendlyHistory(rtOf(c))) }));
adminApi.post("/integrations/calendly/requalify", async (c) => c.json({ ok: true, requalified: await requalifyCalendlyLeads(rtOf(c)) }));
adminApi.post("/integrations/calendly/link-orphans", async (c) => c.json({ ok: true, linked: await linkOrphans(rtOf(c)) }));

// ── Funnel map ───────────────────────────────────────────────────────────────

adminApi.get("/map", async (c) => c.json(await loadMap(rtOf(c))));
adminApi.put("/map/layout", async (c) => {
  try {
    const layout = await saveLayout(rtOf(c), await c.req.json().catch(() => null));
    await audit(rtOf(c), userOf(c), ipOf(c), { action: "map_layout_save", entity: "map", entity_id: "layout" });
    return c.json({ ok: true, layout });
  } catch (e) {
    if (e instanceof MapError) return bad(c, e.message);
    throw e;
  }
});
adminApi.put("/map/custom", async (c) => {
  try {
    const custom = await saveCustom(rtOf(c), await c.req.json().catch(() => null));
    await audit(rtOf(c), userOf(c), ipOf(c), { action: "map_custom_save", entity: "map", entity_id: "custom", after: { nodes: (custom as { nodes?: unknown[] })?.nodes?.length ?? null } });
    return c.json({ ok: true, custom });
  } catch (e) {
    if (e instanceof MapError) return bad(c, e.message);
    throw e;
  }
});


// ── Round 3: metric dictionary, launch readiness, test data, held calls and plans, escalation ───────────

const isManagerRole = (u: AdminUser) => u.role === "owner" || u.role === "manager";
const forbid = (c: Ctx) => c.json({ error: "Your role does not allow this." }, 403);

adminApi.get("/metrics", (c) => c.json(metricsPayload()));

adminApi.get("/readiness", async (c) => {
  if (!isManagerRole(userOf(c))) return forbid(c);
  return c.json(await readiness(rtOf(c)));
});
adminApi.post("/readiness/dns", async (c) => {
  if (!isManagerRole(userOf(c))) return forbid(c);
  const rt = rtOf(c);
  const r = await checkEmailDns(rt);
  await cacheDnsResult(rt, r);
  return c.json({ ok: true, ...r });
});
/** Manual confirmations (lawyer review, Cloudflare Access): owners only. */
const CONFIRMABLE = new Set(["PRIVACY_REVIEWED", "CF_ACCESS_CONFIRMED"]);
adminApi.post("/readiness/confirm", async (c) => {
  const u = userOf(c);
  if (u.role !== "owner") return c.json({ error: "Only the owner can confirm launch checks." }, 403);
  const rt = rtOf(c);
  const b = await body(c);
  const key = typeof b.key === "string" ? b.key : "";
  if (!CONFIRMABLE.has(key)) return bad(c, "Unknown check.");
  if (rt.settings.source(key) === "env") return bad(c, "This value is set as an environment variable. Change it there.", 409);
  await saveSetting(rt.env, key, b.value === true ? "true" : "");
  await audit(rt, u, ipOf(c), { action: b.value === true ? "setting_set" : "setting_clear", entity: "setting", entity_id: key, after: { set: b.value === true } });
  return c.json({ ok: true });
});
adminApi.post("/readiness/go-live", async (c) => {
  const u = userOf(c);
  if (u.role !== "owner") return c.json({ error: "Only the owner can go live." }, 403);
  const r = await goLive(rtOf(c));
  await audit(rtOf(c), u, ipOf(c), { action: "go_live", entity: "setting", entity_id: "go_live", after: { skipped: r.skipped } });
  return c.json({ ok: true, ...r });
});

// Test data.
adminApi.get("/test-data", async (c) => {
  const rt = rtOf(c);
  const mine = await sessionIpHash(rt, ipOf(c));
  const internal = internalHashes(rt);
  return c.json({ ...(await testSummary(rt)), my_ip_hash: mine, my_ip_internal: !!mine && internal.has(mine), internal_count: internal.size });
});
adminApi.post("/test-data/add-my-ip", async (c) => {
  const u = userOf(c);
  if (!isManagerRole(u)) return forbid(c);
  const rt = rtOf(c);
  if (rt.settings.source("INTERNAL_IP_HASHES") === "env") return bad(c, "INTERNAL_IP_HASHES is set as an environment variable. Change it there.", 409);
  const mine = await sessionIpHash(rt, ipOf(c));
  if (!mine) return bad(c, "Could not read your IP address.", 422);
  const set = internalHashes(rt);
  set.add(mine);
  await saveSetting(rt.env, "INTERNAL_IP_HASHES", [...set].slice(-40).join(","));
  await audit(rt, u, ipOf(c), { action: "setting_set", entity: "setting", entity_id: "INTERNAL_IP_HASHES", after: { count: set.size } });
  const fresh: Runtime = { ...rt, settings: await loadSettings(rt.env) };
  const marked = await sweepTestData(fresh, fresh.now() - 90 * 86_400_000);
  return c.json({ ok: true, marked });
});
adminApi.post("/test-data/sweep", async (c) => {
  if (!isManagerRole(userOf(c))) return forbid(c);
  const rt = rtOf(c);
  return c.json({ ok: true, marked: await sweepTestData(rt, rt.now() - 365 * 86_400_000), ...(await testSummary(rt)) });
});
adminApi.post("/test-data/purge", async (c) => {
  const u = userOf(c);
  if (u.role !== "owner") return c.json({ error: "Only the owner can purge test data." }, 403);
  const b = await body(c);
  if (b.confirm !== "PURGE") return bad(c, "Type PURGE to confirm.");
  const r = await purgeTestData(rtOf(c));
  await audit(rtOf(c), u, ipOf(c), { action: "test_purge", entity: "lead", entity_id: "test", after: r });
  return c.json({ ok: true, ...r });
});
adminApi.post("/leads/:id/test", async (c) => {
  const u = userOf(c);
  if (u.role === "viewer") return forbid(c);
  const lead = await visibleLead(c, c.req.param("id"));
  if (!lead) return bad(c, "not found", 404);
  const b = await body(c);
  await setTestFlag(rtOf(c), lead.id, b.is_test === true, u.id);
  await audit(rtOf(c), u, ipOf(c), { action: b.is_test === true ? "mark_test" : "mark_not_test", entity: "lead", entity_id: lead.id });
  return c.json({ ok: true, is_test: b.is_test === true });
});

// Held calls (review + plan), plans and objections.
adminApi.post("/calls/held", async (c) => {
  const u = userOf(c);
  if (u.role === "viewer") return forbid(c);
  const b = await body(c);
  const lead = await visibleLead(c, typeof b.lead_id === "string" ? b.lead_id : "");
  if (!lead) return bad(c, "lead not found", 404);
  try {
    const r = await logHeldCall(rtOf(c), lead, b, u.id);
    await auditLead(c, "outcome", lead, r.lead);
    if (r.plan) await audit(rtOf(c), u, ipOf(c), { action: "plan_save", entity: "lead", entity_id: lead.id });
    return c.json({ ok: true, lead: publicLead(r.lead), plan: r.plan ? { url: planUrl(rtOf(c), r.plan.token) } : null });
  } catch (e) {
    if (e instanceof CallError) return bad(c, e.message, 422);
    throw e;
  }
});
adminApi.put("/leads/:id/plan", async (c) => {
  const u = userOf(c);
  if (u.role === "viewer") return forbid(c);
  const lead = await visibleLead(c, c.req.param("id"));
  if (!lead) return bad(c, "not found", 404);
  try {
    const p = await savePlan(rtOf(c), lead, await body(c), u.id);
    await audit(rtOf(c), u, ipOf(c), { action: "plan_save", entity: "lead", entity_id: lead.id });
    return c.json({ ok: true, url: planUrl(rtOf(c), p.token) });
  } catch (e) {
    if (e instanceof PlanError) return bad(c, e.message, 422);
    throw e;
  }
});

// Escalation: the signed "Reassign to next rep" link opens HQ at #reassign=<token>.
adminApi.get("/reassign", async (c) => {
  const rt = rtOf(c);
  const id = await verifyReassignToken(rt, c.req.query("token") || "");
  if (!id) return bad(c, "This reassign link has expired. Reassign from the lead's Pipeline tab instead.", 404);
  const lead = await visibleLead(c, id);
  if (!lead) return bad(c, "Lead not found.", 404);
  const [cur, next, touched] = await Promise.all([getRep(rt, lead.closer_id), nextRep(rt, lead), one<{ n: number }>(rt, "SELECT COUNT(*) AS n FROM touches WHERE lead_id = ?", [lead.id])]);
  return c.json({
    lead: { id: lead.id, name: [lead.first_name, lead.last_name].filter(Boolean).join(" ") || lead.ref_code, ref_code: lead.ref_code, tier: lead.tier_override || lead.tier, status: lead.status, applied_at: lead.app_completed_at },
    current: cur ? { id: cur.id, name: cur.name } : null, next: next ? { id: next.id, name: next.name } : null, touched: num(touched?.n) > 0,
  });
});
adminApi.post("/reassign", async (c) => {
  const u = userOf(c);
  if (!isManagerRole(u)) return c.json({ error: "Only owners and managers can reassign leads." }, 403);
  const rt = rtOf(c);
  const b = await body(c);
  const id = await verifyReassignToken(rt, typeof b.token === "string" ? b.token : "");
  if (!id) return bad(c, "This reassign link has expired.", 404);
  const lead = await visibleLead(c, id);
  if (!lead) return bad(c, "Lead not found.", 404);
  const next = await nextRep(rt, lead);
  if (!next) return bad(c, "There is no other active rep for this tier.", 422);
  const fresh = await applyLeadUpdate(rt, lead, { closer_id: next.id }, { source: "admin" });
  await auditLead(c, "reassign", lead, fresh);
  rt.waitUntil(notifyRep(rt, next, "Lead reassigned to you", [`${[lead.first_name, lead.last_name].filter(Boolean).join(" ") || "Lead"} · ${lead.ref_code} · tier ${lead.tier_override || lead.tier || "?"}`, "Untouched for 2 hours of sales time. Call now."], `${rt.origin}/admin#lead=${encodeURIComponent(lead.id)}`).then(() => undefined));
  return c.json({ ok: true, closer: { id: next.id, name: next.name } });
});

// ── Session ──────────────────────────────────────────────────────────────────

adminApi.post("/logout", async (c) => {
  const u = userOf(c);
  // Owners and managers sign everyone out (the round-1 behaviour); everyone else signs out this browser.
  const everywhere = (u.role === "owner" || u.role === "manager") && c.req.query("scope") !== "me";
  if (everywhere) await logoutEverywhere(c);
  else logoutHere(c);
  await audit(rtOf(c), u, ipOf(c), { action: everywhere ? "logout_everywhere" : "logout", entity: "user", entity_id: u.id });
  return c.json({ ok: true, everywhere });
});

// Erasure on request. The caller must echo the lead's ref code as confirmation.
adminApi.delete("/leads/:id", async (c) => {
  const rt = rtOf(c);
  const lead = await getLead(rt, c.req.param("id"));
  if (!lead) return bad(c, "Lead not found.", 404);
  const b = await body(c);
  if (b.confirm !== lead.ref_code) return bad(c, "Type the lead's reference to confirm.");
  const r = await eraseLead(rt, lead.id);
  // Only the reference survives in the log: the person is gone.
  await audit(rt, userOf(c), ipOf(c), { action: "lead_erase", entity: "lead", entity_id: lead.id, before: { ref: lead.ref_code, status: lead.status } });
  return c.json(r);
});

// Run the reminders and confirm call for a booking that was matched by email only.
adminApi.post("/leads/:id/confirm-booking", async (c) => {
  const rt = rtOf(c);
  const lead = await getLead(rt, c.req.param("id"));
  if (!lead) return bad(c, "Lead not found.", 404);
  const ok = await confirmBooking(rt, lead);
  return ok ? c.json({ ok: true }) : bad(c, "Only an upcoming booked call can be confirmed.");
});
