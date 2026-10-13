import { describe, it, expect } from "vitest";
import { auc, brier, fitLogistic, isHoldout, median, poissonCdf, predict, reliability, robustZ, smoothedRate, type Sample } from "../src/sales/model";
import { dropCheck, rateCheck, transition, weekBackWindows, zeroCheck, type AlertRow } from "../src/admin/alerts";
import { classifyResend, deliverabilityVerdict, svixSign, verifySvix } from "../src/integrations/resend-webhook";
import { assessEmailDns, fromDomain } from "../src/integrations/email-dns";
import { computeStageValues, parseStageValues, stageValue, type OutcomeFact } from "../src/sales/values";
import { aggregateSpend, type LeadFact } from "../src/admin/spend";
import { dayKey, parseCsv, parseInsightsRow, parseSpendCsv, safeNextUrl, type SpendRow } from "../src/integrations/meta-ads";
import { metaEventId, metaEventName } from "../src/tracking/forward";
import { EVENTS } from "../src/tracking/catalog";
import { NOSHOW_PRIOR, noShowFeatures, scoreNoShow, type NoShowInput } from "../src/sales/noshow";
import { encode, featureSpace, optionStats, trainWinModel, type TrainRow } from "../src/sales/calibration";
import { digestLines, fmtDelta, type PeriodNumbers } from "../src/sales/digest";
import { isoWeek, validateAnalyst } from "../src/sales/analyst";
import { endOfLocalDay } from "../src/sales/followups";
import { zonedTime } from "../src/integrations/sequences";

// Deterministic pseudo-random numbers for synthetic data.
function rng(seed: number) {
  let s = seed >>> 0;
  return () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 2 ** 32);
}

describe("logistic regression and metrics", () => {
  it("learns the sign and size of real effects and stays calibrated", () => {
    const r = rng(7);
    const data: Sample[] = [];
    for (let i = 0; i < 2000; i++) {
      const x = [r() < 0.5 ? 1 : 0, r() < 0.5 ? 1 : 0, r() < 0.5 ? 1 : 0];
      const p = 1 / (1 + Math.exp(-(-1 + 2 * x[0] - 1.5 * x[1])));
      data.push({ x, y: r() < p ? 1 : 0 });
    }
    const m = fitLogistic(["a", "b", "noise"], data, { l2: 1, iterations: 2000, lr: 1 });
    expect(m.weights[0]).toBeGreaterThan(1.4);
    expect(m.weights[1]).toBeLessThan(-1);
    expect(Math.abs(m.weights[2])).toBeLessThan(0.3);
    expect(m.bias).toBeGreaterThan(-1.5);
    expect(m.bias).toBeLessThan(-0.5);
    const probs = data.map((d) => predict(m, d.x));
    const a = auc(probs, data.map((d) => d.y))!;
    expect(a).toBeGreaterThan(0.7);
    const rel = reliability(probs, data.map((d) => d.y), 5);
    for (const b of rel) expect(Math.abs((b.predicted as number) - (b.actual as number))).toBeLessThan(0.08);
  });
  it("L2 shrinks towards the prior with little data", () => {
    const data: Sample[] = [{ x: [1], y: 1 }, { x: [0], y: 0 }];
    const free = fitLogistic(["a"], data, { l2: 0.01 });
    const tight = fitLogistic(["a"], data, { l2: 50, priorWeights: [0.5] });
    expect(free.weights[0]).toBeGreaterThan(tight.weights[0]);
    expect(Math.abs(tight.weights[0] - 0.5)).toBeLessThan(0.3);
  });
  it("AUC handles perfect, inverted, ties and one class", () => {
    expect(auc([0.1, 0.2, 0.8, 0.9], [0, 0, 1, 1])).toBe(1);
    expect(auc([0.9, 0.8, 0.2, 0.1], [0, 0, 1, 1])).toBe(0);
    expect(auc([0.5, 0.5, 0.5, 0.5], [0, 1, 0, 1])).toBe(0.5);
    expect(auc([0.1, 0.2], [1, 1])).toBeNull();
  });
  it("Brier score and smoothing", () => {
    expect(brier([1, 0], [1, 0])).toBe(0);
    expect(brier([0.5, 0.5], [1, 0])).toBe(0.25);
    expect(smoothedRate(0, 0, 0.2)).toBeCloseTo(0.2);
    expect(smoothedRate(10, 10, 0.2, 5)).toBeCloseTo(11 / 15);
  });
  it("hold-out split is stable and roughly the share asked for", () => {
    const ids = Array.from({ length: 2000 }, (_, i) => `l${i}`);
    const share = ids.filter((i) => isHoldout(i)).length / ids.length;
    expect(share).toBeGreaterThan(0.15);
    expect(share).toBeLessThan(0.25);
    expect(isHoldout("labc")).toBe(isHoldout("labc"));
  });
});

describe("anomaly checks", () => {
  const open: AlertRow = { id: "a1", rule: "traffic_zero", severity: "crit", opened_at: 0, resolved_at: null, last_value: 0, baseline: 10, detail: null, checked_at: 0 };
  it("median, robust z and the Poisson tail", () => {
    expect(median([3, 1, 2])).toBe(2);
    expect(median([4, 1, 2, 3])).toBe(2.5);
    expect(median([])).toBeNull();
    expect(robustZ(0, [100, 110, 90, 105])!).toBeLessThan(-3);
    expect(Math.abs(robustZ(100, [100, 110, 90, 105])!)).toBeLessThan(1);
    expect(poissonCdf(0, 10)).toBeCloseTo(Math.exp(-10), 10);
    expect(poissonCdf(10, 10)).toBeGreaterThan(0.5);
    expect(poissonCdf(5, 0)).toBe(1);
  });
  it("traffic collapse fires only in hours that normally have traffic", () => {
    expect(zeroCheck("traffic_zero", 0, [40, 35, 50, 42], 5, "page views").firing).toBe(true);
    expect(zeroCheck("traffic_zero", 3, [40, 35, 50, 42], 5, "page views").firing).toBe(false);
    const quiet = zeroCheck("traffic_zero", 0, [0, 1, 2, 0], 5, "page views");
    expect(quiet.firing).toBe(false);
    expect(quiet.skip).toBe(true);
  });
  it("drops beyond 3 sigma fire; normal variation does not", () => {
    expect(dropCheck("applications_drop", 0, [12, 15, 10, 14], 4, "applications").firing).toBe(true);
    expect(dropCheck("applications_drop", 9, [12, 15, 10, 14], 4, "applications").firing).toBe(false);
    expect(dropCheck("applications_drop", 0, [1, 2, 0, 1], 4, "applications").skip).toBe(true);
  });
  it("failure rates need volume", () => {
    expect(rateCheck("forward_failures", 5, 20, 0.1, 20, "events").firing).toBe(true);
    expect(rateCheck("forward_failures", 1, 20, 0.1, 20, "events").firing).toBe(false);
    expect(rateCheck("forward_failures", 5, 10, 0.1, 20, "events").firing).toBe(false);
  });
  it("open, update, resolve and cooldown", () => {
    const fire = { rule: "traffic_zero", firing: true, value: 0, baseline: 10, detail: "" };
    const ok = { ...fire, firing: false };
    expect(transition(null, fire, 1000, null)).toBe("open");
    expect(transition(open, fire, 1000, null)).toBe("update");
    expect(transition(open, ok, 1000, null)).toBe("resolve");
    expect(transition(null, ok, 1000, null)).toBe("none");
    expect(transition(null, fire, 1000, 1000 - 60_000)).toBe("none"); // inside the 2 h cooldown
    expect(transition(null, fire, 1000 + 3 * 3600_000, 1000)).toBe("open");
    expect(transition(open, { ...ok, skip: true }, 1000, null)).toBe("update"); // no data: keep it open
  });
  it("same hour of the week, four weeks back", () => {
    const w = weekBackWindows(10 * 604_800_000, 10 * 604_800_000 + 3600_000);
    expect(w).toHaveLength(4);
    expect(w[0]).toEqual([9 * 604_800_000, 9 * 604_800_000 + 3600_000]);
  });
});

describe("Resend webhook (Svix signatures)", () => {
  const secret = "whsec_" + btoa("0123456789abcdef0123456789abcdef");
  const body = JSON.stringify({ type: "email.bounced", data: { email_id: "e_1", to: ["a@b.com"], bounce: { type: "Permanent" } } });
  const now = 1_760_000_000_000;
  const ts = String(Math.floor(now / 1000));
  it("accepts a valid signature, including among several", async () => {
    const sig = await svixSign(secret, "msg_1", ts, body);
    expect(await verifySvix(secret, { id: "msg_1", timestamp: ts, signature: `v1,${sig}` }, body, now)).toBe(true);
    expect(await verifySvix(secret, { id: "msg_1", timestamp: ts, signature: `v1,AAAA v1,${sig}` }, body, now)).toBe(true);
  });
  it("fails closed on tampering, replay, wrong secret and missing parts", async () => {
    const sig = await svixSign(secret, "msg_1", ts, body);
    expect(await verifySvix(secret, { id: "msg_1", timestamp: ts, signature: `v1,${sig}` }, body + " ", now)).toBe(false);
    expect(await verifySvix(secret, { id: "msg_2", timestamp: ts, signature: `v1,${sig}` }, body, now)).toBe(false);
    expect(await verifySvix(secret, { id: "msg_1", timestamp: ts, signature: `v1,${sig}` }, body, now + 6 * 60_000)).toBe(false);
    expect(await verifySvix(secret, { id: "msg_1", timestamp: ts, signature: `v1,${sig}` }, body, now - 6 * 60_000)).toBe(false);
    expect(await verifySvix("whsec_" + btoa("another-secret-another-secret!!"), { id: "msg_1", timestamp: ts, signature: `v1,${sig}` }, body, now)).toBe(false);
    expect(await verifySvix(secret, { id: "msg_1", timestamp: ts, signature: `v2,${sig}` }, body, now)).toBe(false);
    expect(await verifySvix(secret, { id: null, timestamp: ts, signature: `v1,${sig}` }, body, now)).toBe(false);
    expect(await verifySvix("", { id: "msg_1", timestamp: ts, signature: `v1,${sig}` }, body, now)).toBe(false);
    expect(await verifySvix("whsec_!!notbase64", { id: "msg_1", timestamp: ts, signature: `v1,${sig}` }, body, now)).toBe(false);
  });
  it("classifies events; transient bounces are soft", () => {
    expect(classifyResend(JSON.parse(body)).kind).toBe("bounced");
    expect(classifyResend({ type: "email.bounced", data: { email_id: "x", bounce: { type: "Transient" } } }).kind).toBe("soft_bounce");
    expect(classifyResend({ type: "email.complained", data: { email_id: "x" } }).kind).toBe("complained");
    expect(classifyResend({ type: "email.delivered", data: { email_id: "x" } }).kind).toBe("delivered");
    expect(classifyResend({ type: "email.delivery_delayed", data: {} }).kind).toBe("delayed");
    expect(classifyResend({ type: "email.opened", data: {} }).kind).toBe("ignored");
    expect(classifyResend({ type: "email.delivered", data: { email_id: "bad id; drop" } }).emailId).toBeNull();
  });
  it("auto-pause thresholds need volume", () => {
    expect(deliverabilityVerdict(1000, 10, 3).firing).toBe(true); // complaints 0.3%
    expect(deliverabilityVerdict(1000, 40, 0).firing).toBe(true); // bounces 4%
    expect(deliverabilityVerdict(1000, 20, 1).firing).toBe(false);
    expect(deliverabilityVerdict(50, 10, 5).firing).toBe(false);
  });
});

describe("email DNS check", () => {
  const good = {
    root: ["v=spf1 include:_spf.google.com ~all", "google-site-verification=abc"],
    send: ["v=spf1 include:amazonses.com ~all"],
    dkim: ["p=MIGfMA0GCSqGSIb3DQEBAQUAA4GNADCBiQKBgQC1234567890abcdef"],
    dmarc: ["v=DMARC1; p=quarantine; rua=mailto:d@example.com"],
  };
  const state = (checks: ReturnType<typeof assessEmailDns>, id: string) => checks.find((c) => c.id === id)?.state;
  it("passes a correct setup", () => {
    const c = assessEmailDns("example.com", good);
    for (const id of ["spf", "spf_send", "dkim", "dmarc", "alignment"]) expect(state(c, id)).toBe("pass");
  });
  it("flags two SPF records, missing DKIM, p=none and no DMARC", () => {
    const c = assessEmailDns("example.com", { ...good, root: ["v=spf1 a ~all", "v=spf1 mx ~all"], dkim: [], dmarc: ["v=DMARC1; p=none"] });
    expect(state(c, "spf")).toBe("fail");
    expect(state(c, "dkim")).toBe("fail");
    expect(state(c, "alignment")).toBe("fail");
    expect(state(c, "dmarc")).toBe("warn");
    expect(state(assessEmailDns("example.com", { ...good, dmarc: [] }), "dmarc")).toBe("fail");
    expect(state(assessEmailDns("example.com", { ...good, root: [] }), "spf")).toBe("warn");
  });
  it("reads the From domain", () => {
    expect(fromDomain("Bendik <bendik@mail.asym.ai>")).toBe("mail.asym.ai");
    expect(fromDomain("hi@example.com")).toBe("example.com");
    expect(fromDomain("not an address")).toBeNull();
  });
});

describe("calibrated stage values", () => {
  const facts: OutcomeFact[] = [];
  for (let i = 0; i < 40; i++) facts.push({ tier: "A", qualified: true, booked: true, showed: i < 30, won: i < 10, revenue: i < 10 ? 20000 : 0 });
  for (let i = 0; i < 10; i++) facts.push({ tier: "B", qualified: true, booked: i < 5, showed: false, won: false, revenue: 0 });
  it("P(won | stage, tier) × average deal, with a minimum per cell", () => {
    const v = computeStageValues(facts, 30000, 1);
    expect(v.avg_deal).toBe(20000);
    expect(v.cells.lead_qualified.A.value).toBe(5000); // 10/40 × 20000
    expect(v.cells.call_showed.A.p).toBeCloseTo(10 / 30);
    expect(v.cells.lead_qualified.B.value).toBeNull(); // only 10 outcomes
    expect(stageValue(v, "lead_qualified", "A", 3000)).toBe(5000);
    expect(stageValue(v, "lead_qualified", "B", 800)).toBe(800);
    expect(stageValue(null, "lead_qualified", "A", 3000)).toBe(3000);
  });
  it("ignores broken settings", () => {
    expect(parseStageValues("{bad")).toBeNull();
    expect(parseStageValues(JSON.stringify({ x: 1 }))).toBeNull();
  });
});

describe("ad spend", () => {
  const row = (o: Partial<SpendRow>): SpendRow => ({ platform: "meta", date: "2026-10-10", ad_id: "1", ad_name: "Ad 1", adset_id: "s1", adset_name: "Set 1", campaign_id: "c1", campaign_name: "Founders", spend: 100, impressions: 1000, clicks: 30, link_clicks: 20, ...o });
  const lead = (o: Partial<LeadFact>): LeadFact => ({ ad_id: null, campaign: null, lead: 1, applied: 0, qualified: 0, booked: 0, showed: 0, won: 0, revenue: 0, cash: 0, ...o });
  const spend = [row({}), row({ date: "2026-10-11", spend: 50 }), row({ ad_id: "2", ad_name: "Ad 2", adset_id: "s2", adset_name: "Set 2", spend: 200 }), row({ ad_id: "3", ad_name: "Dead ad", spend: 30 })];
  const sessions = new Map([["1", 40], ["2", 60]]);
  const leads = [lead({ ad_id: "1", booked: 1, won: 1, revenue: 30000, cash: 15000 }), lead({ ad_id: "1" }), lead({ ad_id: "2", applied: 1 }), lead({ campaign: "founders" }), lead({ ad_id: "zzz" })];
  it("joins spend, sessions and outcomes by ad", () => {
    const ads = aggregateSpend(spend, sessions, leads, "ad");
    const a1 = ads.find((r) => r.key === "1")!;
    expect(a1.spend).toBe(150);
    expect(a1.sessions).toBe(40);
    expect(a1.leads).toBe(2);
    expect(a1.cpl).toBe(75);
    expect(a1.cac).toBe(150);
    expect(a1.cash_roas).toBe(100);
    expect(a1.revenue_roas).toBe(200);
    expect(ads.find((r) => r.key === "3")!.zero_sessions).toBe(true);
    expect(ads[0].key).toBe("2"); // sorted by spend
  });
  it("rolls up to ad sets and campaigns; campaign falls back to the campaign name", () => {
    expect(aggregateSpend(spend, sessions, leads, "adset")).toHaveLength(2);
    const c = aggregateSpend(spend, sessions, leads, "campaign");
    expect(c).toHaveLength(1);
    expect(c[0].spend).toBe(380);
    expect(c[0].leads).toBe(4); // three by ad id plus one by campaign name; unknown ad ignored
    expect(c[0].sessions).toBe(100);
  });
  it("parses Insights rows and refuses foreign paging links", () => {
    expect(parseInsightsRow({ ad_id: "123", date_start: "2026-10-10", spend: "12.345", impressions: "100", inline_link_clicks: "4" })).toMatchObject({ ad_id: "123", spend: 12.35, impressions: 100, link_clicks: 4 });
    expect(parseInsightsRow({ ad_id: "1; drop", date_start: "2026-10-10" })).toBeNull();
    expect(parseInsightsRow({ ad_id: "1", date_start: "yesterday" })).toBeNull();
    expect(safeNextUrl("https://graph.facebook.com/v21.0/act_1/insights?after=x")).toContain("graph.facebook.com");
    expect(safeNextUrl("https://evil.example/insights")).toBeNull();
    expect(safeNextUrl("http://graph.facebook.com/x")).toBeNull();
  });
  it("imports CSV with aliases, quotes and semicolons; reports bad rows", () => {
    const csv = 'Day,Campaign,Ad ID,Cost,Impressions\n2026-10-01,"Brand, search",g1,"12.50",100\n2026/10/02,Brand,g1,7,50\nbad,Brand,g1,1,1\n2026-10-03,,,3,1\n';
    const r = parseSpendCsv(csv, "google");
    expect(r.rows).toHaveLength(2);
    expect(r.rows[0]).toMatchObject({ platform: "google", date: "2026-10-01", ad_id: "g1", campaign_name: "Brand, search", spend: 12.5 });
    expect(r.rows[1].date).toBe("2026-10-02");
    expect(r.errors.length).toBe(2);
    expect(parseSpendCsv("date;campaign;spend\n2026-10-01;Brand;5\n").rows[0].ad_id).toBe("campaign:brand");
    expect(parseSpendCsv("foo,bar\n1,2\n").errors[0]).toMatch(/date and spend/);
    expect(parseCsv('a,"b ""q""",c')).toEqual([["a", 'b "q"', "c"]]);
  });
  it("day keys follow the sales time zone", () => {
    const t = Date.UTC(2026, 9, 10, 23, 30);
    expect(dayKey(t, "UTC")).toBe("2026-10-10");
    expect(dayKey(t, "Europe/Oslo")).toBe("2026-10-11");
  });
});

describe("offline conversions to Meta", () => {
  it("maps CRM stages and retargeting events", () => {
    expect(EVENTS.call_no_show.meta).toBe("NoShow");
    expect(EVENTS.deal_lost.meta).toBe("DealLost");
    expect(EVENTS.vsl_cta_reveal.meta).toBe("VSLPitchReached");
    expect(EVENTS.vsl_25.meta).toBe("VideoView25");
    expect(metaEventName("payment_recorded", { amount: 5000 }, 5000)).toBe("CashCollected");
    expect(metaEventName("payment_recorded", { amount: -5000 }, -5000)).toBe("Refund");
    expect(metaEventName("payment_recorded", {}, 0)).toBeNull();
    expect(metaEventName("lead_status_changed", { to: "disqualified" })).toBe("Disqualified");
    expect(metaEventName("lead_status_changed", { to: "nurture" })).toBeNull();
    expect(metaEventName("app_step", { step: 2 })).toBe("StartApplication");
    expect(metaEventName("scroll", {})).toBeNull();
  });
  it("micro events stay local", () => {
    expect(EVENTS.booking_page_ready.micro).toBe(true);
  });
  it("one StartApplication per lead for Meta's dedupe", () => {
    expect(metaEventId({ id: "e1", name: "app_step", who: { leadId: "l1" } })).toBe("startapp_l1");
    expect(metaEventId({ id: "e1", name: "deal_won", who: { leadId: "l1" } })).toBe("e1");
  });
});

describe("no-show risk", () => {
  const base: NoShowInput = { booked_at: 0, call_at: 86_400_000, email: "a@clinic.no", tier: "A", emails_sent: 3, emails_opened: 2, confirm: "answered", watched_pct: 80 };
  it("low risk for an engaged A-tier lead, high with every warning sign", () => {
    const low = scoreNoShow(NOSHOW_PRIOR, noShowFeatures(base));
    expect(low.risk).toBeCloseTo(0.2, 2);
    expect(low.reasons).toEqual([]);
    const bad = { ...base, booked_at: 0, call_at: 7 * 86_400_000, email: "a@gmail.com", tier: "C", emails_opened: 0, confirm: "unanswered" as const, watched_pct: 10 };
    const high = scoreNoShow(NOSHOW_PRIOR, noShowFeatures(bad));
    expect(high.risk).toBeGreaterThan(0.4);
    expect(high.reasons[0]).toBe("no_email_open");
    expect(high.reasons).toContain("lead_time_5d");
  });
  it("no emails sent yet is not counted as unopened; never played counts as under 25%", () => {
    const x = noShowFeatures({ ...base, emails_sent: 0, emails_opened: 0, watched_pct: null });
    expect(x[1]).toBe(0);
    expect(x[3]).toBe(1);
  });
});

describe("scoring calibration", () => {
  const r = rng(11);
  const rows: TrainRow[] = [];
  for (let i = 0; i < 300; i++) {
    const owner = r() < 0.5;
    const big = r() < 0.5;
    const p = 0.05 + (owner ? 0.25 : 0) + (big ? 0.2 : 0);
    const won = r() < p;
    rows.push({
      id: `l${i}`, answers: { role: owner ? "owner" : "exec", revenue: big ? "10m_plus" : "1m_3m", blockers: ["time"] }, watched: Math.round(r() * 100),
      flags: owner ? [] : ["not_owner"], tier: owner ? "A" : "B", won, status: won ? "won" : r() < 0.3 ? "no_show" : "lost", revenue: won ? 25000 : 0, booked: true, showed: won || r() < 0.6,
    });
  }
  it("one-hot encodes answers, film share and flags", () => {
    const space = featureSpace();
    const x = encode(space, { role: "owner", blockers: ["time", "tracking"] }, 50, ["not_owner"]);
    expect(x[space.indexOf("role=owner")]).toBe(1);
    expect(x[space.indexOf("blockers=time")]).toBe(1);
    expect(x[space.indexOf("blockers=tracking")]).toBe(1);
    expect(x[space.indexOf("vsl_watched")]).toBe(0.5);
    expect(x[space.indexOf("flag:not_owner")]).toBe(1);
    expect(x.reduce((a, b) => a + b, 0)).toBe(4.5);
  });
  it("option stats rank options by win rate and rescale points within the question", () => {
    const st = optionStats(rows);
    const owner = st.find((s) => s.question === "role" && s.value === "owner")!;
    const exec = st.find((s) => s.question === "role" && s.value === "exec")!;
    expect(owner.smoothed).toBeGreaterThan(exec.smoothed);
    expect(owner.lift!).toBeGreaterThan(1);
    expect(owner.suggested).toBeGreaterThan(exec.suggested);
    expect(Math.max(...st.filter((s) => s.question === "role").map((s) => s.suggested))).toBe(20); // the question's max points
    expect(st.find((s) => s.question === "role" && s.value === "none")!.n).toBe(0);
  });
  it("trains a useful model with enough outcomes, refuses with too few", () => {
    const fit = trainWinModel(rows)!;
    expect(fit).not.toBeNull();
    expect(fit.auc!).toBeGreaterThan(0.6);
    expect(fit.report.reliability).toHaveLength(10);
    expect(fit.report.tiers.find((t) => t.tier === "A")!.close_rate!).toBeGreaterThan(fit.report.tiers.find((t) => t.tier === "B")!.close_rate!);
    expect(trainWinModel(rows.slice(0, 20))).toBeNull();
    expect(trainWinModel(rows.map((x) => ({ ...x, won: false })))).toBeNull();
  });
});

describe("digest v2 and the weekly analyst", () => {
  const z: PeriodNumbers = { visitors: 0, leads: 0, applied: 0, qualified: 0, booked: 0, showed: 0, won: 0, cash: 0 };
  it("deltas against the 7-day average", () => {
    expect(fmtDelta(12, 10)).toBe("▲ 20%");
    expect(fmtDelta(5, 10)).toBe("▼ 50%");
    expect(fmtDelta(10.2, 10)).toBe("= avg");
    expect(fmtDelta(3, 0)).toBe("▲ new");
    expect(fmtDelta(0, 0)).toBe("= avg");
  });
  it("lists calls by closer with tier and risk, and links into HQ", () => {
    const lines = digestLines({
      cur: { ...z, visitors: 120, booked: 3 }, avg: { ...z, visitors: 100, booked: 2 }, origin: "https://x.test",
      calls: [{ closer: "Bendik", time: "10:30", name: "Ingrid H.", tier: "A", risk: 0.45 }, { closer: "Bendik", time: "14:00", name: "Lars B.", tier: null, risk: null }],
      needs: ["Maja K."], needsTotal: 1, followUps: [], followUpsTotal: 0, payments: [], paymentsTotal: 0,
      spend: { yesterday: 250, cpl: 50, cac7: null }, alerts: ["Page views stopped"],
    });
    const text = lines.join("\n");
    expect(text).toContain("Visitors 120 (▲ 20%)");
    expect(text).toContain("Bendik: 10:30 Ingrid H. (tier A, no-show risk 45%) · 14:00 Lars B.");
    expect(text).toContain("Needs an outcome: 1 (Maja K.)");
    expect(text).toContain("CPL $50");
    expect(text).toContain("Open alerts: Page views stopped");
    expect(text).toContain("https://x.test/admin#sales");
  });
  it("validates the analyst's JSON hard", () => {
    const good = { headline: "Bookings up, show rate down", summary: "Applications rose 20%.", wins: ["Ad B halved cost per booked call."], concerns: [], actions: ["Call no-shows within the hour."] };
    expect(validateAnalyst(good).ok).toBe(true);
    expect(validateAnalyst({ ...good, actions: [] }).ok).toBe(false);
    expect(validateAnalyst({ ...good, summary: "See https://evil.example" }).ok).toBe(false);
    expect(validateAnalyst({ ...good, wins: ["<b>x</b>"] }).ok).toBe(false);
    expect(validateAnalyst({ ...good, wins: "x" }).ok).toBe(false);
    expect(validateAnalyst(null).ok).toBe(false);
  });
  it("ISO weeks", () => {
    expect(isoWeek(2026, 10, 12)).toBe("2026-W42");
    expect(isoWeek(2027, 1, 1)).toBe("2026-W53");
    expect(isoWeek(2026, 1, 1)).toBe("2026-W01");
  });
  it("end of the local day", () => {
    const t = zonedTime(2026, 10, 13, 15, 0, "Europe/Oslo");
    expect(endOfLocalDay(t, "Europe/Oslo")).toBe(zonedTime(2026, 10, 14, 0, 0, "Europe/Oslo"));
  });
});
