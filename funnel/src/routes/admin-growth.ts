// Funnel HQ "Growth" API: proof, cohorts, referrals and experiments. A Hono sub-app mounted at
// /admin/api/growth; it sits under the same requireAdmin middleware as /admin/api/* (session cookie,
// same-origin writes, no-store). Mount: app.route("/admin/api/growth", adminGrowth) in src/index.ts.

import { Hono } from "hono";
import type { AppEnv, Ctx, Runtime } from "../app";
import { INDUSTRIES } from "../landers/catalog";
import { CONSENT_SCOPES, PROOF_KINDS, ProofError, deleteProof, getProof, listProof, saveProof } from "../growth/proof";
import { CohortError, assignMember, cohortsReport, deleteCohort, saveCohort, sendCohortNotices } from "../growth/cohorts";
import { referralsReport } from "../growth/referrals";
import { ExperimentError, createExperiment, deleteDraft, experimentsReport, startExperiment, stopExperiment } from "../growth/experiments";
import { proofSig } from "./links";
import { currentUser } from "../admin/auth";

export const adminGrowth = new Hono<AppEnv>();

const rtOf = (c: Ctx): Runtime => c.get("rt");
const body = async (c: Ctx): Promise<Record<string, unknown>> => {
  const b = await c.req.json().catch(() => ({}));
  return b && typeof b === "object" && !Array.isArray(b) ? (b as Record<string, unknown>) : {};
};
const ID = /^[a-z]{1,2}[0-9a-z]{19}$/;
const LEAD_ID = /^l[0-9a-z]{19}$/;

/** Known validation errors become 400s with the message; anything else is a 500 via the app's onError. */
function known(e: unknown): e is Error {
  return e instanceof ProofError || e instanceof CohortError || e instanceof ExperimentError;
}

adminGrowth.onError((e, c) => {
  if (known(e)) return c.json({ error: e.message }, 400);
  console.error("admin-growth", e);
  return c.json({ error: "server error" }, 500);
});

// ── Proof ────────────────────────────────────────────────────────────────────

adminGrowth.get("/proof", async (c) => {
  const rt = rtOf(c);
  const [items, clients] = await Promise.all([
    listProof(rt),
    rt.env.DB.prepare("SELECT id, first_name, last_name, ref_code, closed_at FROM leads WHERE status = 'won' AND refunded_at IS NULL ORDER BY closed_at DESC LIMIT 50")
      .all<{ id: string; first_name: string | null; last_name: string | null; ref_code: string; closed_at: number | null }>(),
  ]);
  // The signed submit link is a bearer credential for that client's proof form: owners and managers only.
  const role = currentUser(c)?.role;
  const mayLink = role === "owner" || role === "manager";
  const withLinks = await Promise.all((clients.results || []).map(async (l) => ({
    id: l.id, name: [l.first_name, l.last_name].filter(Boolean).join(" ") || l.ref_code, closed_at: l.closed_at,
    link: mayLink ? `${rt.origin}/proof/submit?ref=${encodeURIComponent(l.id)}&sig=${encodeURIComponent(await proofSig(rt, l.id))}` : null,
  })));
  return c.json({
    items,
    kinds: PROOF_KINDS,
    scopes: CONSENT_SCOPES,
    industries: INDUSTRIES.map((i) => ({ id: i.id, label: i.label })),
    clients: withLinks,
  });
});

adminGrowth.post("/proof", async (c) => c.json(await saveProof(rtOf(c), null, await body(c))));
adminGrowth.post("/proof/:id", async (c) => {
  const id = c.req.param("id");
  if (!ID.test(id)) return c.json({ error: "not found" }, 404);
  return c.json(await saveProof(rtOf(c), id, await body(c)));
});
adminGrowth.post("/proof/:id/approve", async (c) => {
  const id = c.req.param("id");
  if (!ID.test(id) || !(await getProof(rtOf(c), id))) return c.json({ error: "not found" }, 404);
  const b = await body(c);
  return c.json(await saveProof(rtOf(c), id, { approved: b.approved === true }));
});
adminGrowth.delete("/proof/:id", async (c) => {
  const id = c.req.param("id");
  if (!ID.test(id)) return c.json({ error: "not found" }, 404);
  await deleteProof(rtOf(c), id);
  return c.json({ ok: true });
});

// ── Cohorts ──────────────────────────────────────────────────────────────────

adminGrowth.get("/cohorts", async (c) => c.json(await cohortsReport(rtOf(c))));
adminGrowth.post("/cohorts", async (c) => c.json(await saveCohort(rtOf(c), null, await body(c))));
adminGrowth.post("/cohorts/assign", async (c) => {
  const b = await body(c);
  const leadId = String(b.lead_id || ""), cohortId = String(b.cohort_id || "");
  if (!LEAD_ID.test(leadId) || (cohortId && !ID.test(cohortId))) return c.json({ error: "bad request" }, 400);
  await assignMember(rtOf(c), leadId, cohortId);
  return c.json({ ok: true });
});
adminGrowth.post("/cohorts/notify", async (c) => c.json(await sendCohortNotices(rtOf(c))));
adminGrowth.post("/cohorts/:id", async (c) => {
  const id = c.req.param("id");
  if (!ID.test(id)) return c.json({ error: "not found" }, 404);
  return c.json(await saveCohort(rtOf(c), id, await body(c)));
});
adminGrowth.delete("/cohorts/:id", async (c) => {
  const id = c.req.param("id");
  if (!ID.test(id)) return c.json({ error: "not found" }, 404);
  await deleteCohort(rtOf(c), id);
  return c.json({ ok: true });
});

// ── Referrals ────────────────────────────────────────────────────────────────

adminGrowth.get("/referrals", async (c) => c.json(await referralsReport(rtOf(c))));

// ── Experiments ──────────────────────────────────────────────────────────────

adminGrowth.get("/experiments", async (c) => c.json(await experimentsReport(rtOf(c))));
adminGrowth.post("/experiments", async (c) => c.json(await createExperiment(rtOf(c), await body(c))));
adminGrowth.post("/experiments/:id/start", async (c) => {
  const id = c.req.param("id");
  if (!ID.test(id)) return c.json({ error: "not found" }, 404);
  await startExperiment(rtOf(c), id);
  return c.json({ ok: true });
});
adminGrowth.post("/experiments/:id/stop", async (c) => {
  const id = c.req.param("id");
  if (!ID.test(id)) return c.json({ error: "not found" }, 404);
  await stopExperiment(rtOf(c), id);
  return c.json({ ok: true });
});
adminGrowth.delete("/experiments/:id", async (c) => {
  const id = c.req.param("id");
  if (!ID.test(id)) return c.json({ error: "not found" }, 404);
  await deleteDraft(rtOf(c), id);
  return c.json({ ok: true });
});
