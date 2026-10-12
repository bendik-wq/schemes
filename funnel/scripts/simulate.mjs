#!/usr/bin/env node
// Push N synthetic visitors through the REAL endpoints of a running funnel (wrangler dev or live).
// Usage: node scripts/simulate.mjs [N] — env: BASE (default http://127.0.0.1:8787),
//        BOOKING_WEBHOOK_SECRET (to simulate verified bookings), ADMIN_PASSWORD (to log outcomes).
// Synthetic visitors use example.com addresses and +1 555 numbers, which are never called.

const BASE = process.env.BASE || "http://127.0.0.1:8787";
const N = Number(process.argv[2] || 60);
const rnd = (a) => a[Math.floor(Math.random() * a.length)];
const chance = (p) => Math.random() < p;
const host = new URL(BASE).host;

const UAS = [
  "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_6) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Safari/537.36",
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Safari/537.36 Edg/129.0",
  "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Mobile Safari/537.36",
  "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 [FBAN/FBIOS;FBAV/480.0]",
];
const ENTRIES = [
  () => `/?utm_source=facebook&utm_medium=paid&utm_campaign=Operator%20%E2%80%93%20Founders&utm_content=Hook%20A&utm_term=LAL%202%25&fbclid=fb${Math.random().toString(36).slice(2)}`,
  () => `/?utm_source=facebook&utm_medium=paid&utm_campaign=Operator%20%E2%80%93%20Founders&utm_content=Hook%20B&fbclid=fb${Math.random().toString(36).slice(2)}`,
  () => `/m?utm_source=facebook&utm_medium=paid&utm_campaign=Dental%20%E2%80%93%20LAL%202%25&utm_content=Agency%20angle&fbclid=fb${Math.random().toString(36).slice(2)}`,
  () => `/for/${rnd(["dental", "law", "ecommerce", "agencies", "construction", "saas"])}`,
  () => `/?utm_source=youtube&utm_medium=video&utm_campaign=channel&lk=yt-desc`,
  () => `/?gclid=g${Math.random().toString(36).slice(2)}`,
  () => `/`,
  () => `/?utm_source=newsletter&utm_medium=email`,
];
const NAMES = ["Ingrid", "Lars", "Maja", "Henrik", "Sofie", "Jonas", "Emma", "Oliver", "Nora", "Elias", "Ava", "Liam"];
const BUSINESSES = ["Three dental clinics in Bergen", "A law firm with 40 staff", "E-commerce skincare brand", "Roofing company in Oslo",
  "B2B software for logistics", "Performance marketing agency", "Recruitment firm for engineers", "Gym chain, five studios"];

class Jar {
  constructor() { this.c = {}; }
  set(res) {
    const all = res.headers.getSetCookie ? res.headers.getSetCookie() : [];
    for (const line of all) {
      const [kv] = line.split(";");
      const i = kv.indexOf("=");
      const k = kv.slice(0, i).trim(), v = kv.slice(i + 1).trim();
      if (/max-age=0|expires=thu, 01 jan 1970/i.test(line)) delete this.c[k]; else this.c[k] = v;
    }
  }
  header() { return Object.entries(this.c).map(([k, v]) => `${k}=${v}`).join("; "); }
}

async function visitor(i) {
  const jar = new Jar();
  const ua = rnd(UAS);
  const headers = (extra = {}) => ({ "user-agent": ua, "accept-language": "en-GB,en;q=0.9", cookie: jar.header(), ...extra });
  const api = async (path, body) => {
    const r = await fetch(BASE + path, { method: "POST", headers: headers({ "content-type": "application/json", "sec-fetch-site": "same-origin", origin: BASE }), body: JSON.stringify(body) });
    jar.set(r);
    return { status: r.status, json: await r.json().catch(() => ({})) };
  };
  const page = async (path) => {
    const r = await fetch(BASE + path, { headers: headers({ accept: "text/html" }), redirect: "manual" });
    jar.set(r);
    await r.text();
    return r;
  };

  await page(ENTRIES[i % ENTRIES.length]());
  const out = { applied: false, tier: null };
  await api("/api/e", { events: [{ n: "scroll", p: { pct: 25 } }, { n: "engaged", p: { ms: 20000 + Math.random() * 200000 } }], ctx: { tz: rnd(["Europe/Oslo", "Europe/London", "America/New_York"]), screen: "390x844", viewport: "390x700", dpr: 3 } });

  // Watch the film.
  if (chance(0.7)) {
    const watchPct = Math.random();
    const unmuted = chance(0.8);
    let hex = "";
    const buckets = Math.floor(watchPct * 100);
    for (let b = 0; b < 100; b += 4) {
      let v = 0;
      for (let k = 0; k < 4; k++) if (b + k < buckets) v |= 1 << (3 - k);
      hex += v.toString(16);
    }
    await api("/api/v", { video: "main", d: 540, p: watchPct * 540, b: unmuted ? hex : "0".repeat(25), played: true, unmuted });
    if (chance(0.3)) await api("/api/e", { events: [{ n: "faq_open", p: { id: rnd(["cost", "time", "guarantee", "tech", "agency"]) } }, { n: "section_dwell", p: { section: "guarantee", ms: 12000 } }] });
  }

  // Apply.
  if (chance(0.35)) {
    await page("/apply");
    const first = rnd(NAMES);
    const contact = await api("/api/apply/contact", {
      first_name: first, last_name: "Test", email: `${first.toLowerCase()}.${Date.now().toString(36)}${i}@example.com`,
      phone: `+1 555 01${String(10 + (i % 89)).padStart(2, "0")}`, call_consent: chance(0.6),
    });
    if (contact.status !== 200) return { ...out, error: contact.json };
    const answers = {
      business: rnd(BUSINESSES), role: rnd(["owner", "owner", "co_owner", "exec", "none"]), revenue: rnd(["under_1m", "1m_3m", "3m_10m", "10m_plus"]),
      spend: rnd(["under_25k", "25k_100k", "100k_300k", "300k_plus"]), goal: rnd(["own_growth", "cut_costs", "internal_tools", "unsure"]),
      timeline: rnd(["0_3", "3_6", "6_plus", "exploring"]), blockers: [rnd(["dev_capacity", "agency_lockin", "tracking", "tool_sprawl", "time", "ai_doubt"])],
      readiness: rnd(["yes", "yes", "partner", "not_now"]), why_now: chance(0.6) ? "We pay an agency every month and still cannot see which ads bring buyers. I want our team to own it." : "",
    };
    const abandon = chance(0.25);
    let step = 2;
    for (const [k, v] of Object.entries(answers)) {
      if (abandon && step > 5) break;
      await api("/api/apply/answers", { answers: { [k]: v }, step: step++ });
    }
    if (abandon) return { ...out, abandoned: true };
    const sub = await api("/api/apply/submit", {});
    out.applied = sub.status === 200;
    out.tier = sub.json.tier;
    if (sub.json.route) await page(sub.json.route);
  }
  return out;
}

async function main() {
  console.log(`Simulating ${N} visitors against ${BASE}`);
  const results = [];
  for (let i = 0; i < N; i += 6) {
    const batch = await Promise.all(Array.from({ length: Math.min(6, N - i) }, (_, k) => visitor(i + k).catch((e) => ({ error: String(e) }))));
    results.push(...batch);
  }
  const applied = results.filter((r) => r.applied);
  const tiers = applied.reduce((m, r) => ((m[r.tier] = (m[r.tier] || 0) + 1), m), {});
  const errors = results.filter((r) => r.error);
  console.log(`visitors ${N} · applied ${applied.length} · tiers ${JSON.stringify(tiers)} · abandoned ${results.filter((r) => r.abandoned).length} · errors ${errors.length}`);
  if (errors.length) console.log(errors.slice(0, 3));
}

main().catch((e) => { console.error(e); process.exit(1); });
