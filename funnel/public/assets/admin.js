/* Funnel HQ — single-page admin. No framework, no inline handlers or styles (strict CSP).
   Rules: every interpolation goes through esc(); attributes are always double-quoted; URLs built
   from data use encodeURIComponent; email previews render in <iframe sandbox="" srcdoc>. */
(() => {
  "use strict";

  // ── Basics ─────────────────────────────────────────────────────────────────
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
  const ESC = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
  const esc = (v) => String(v == null ? "" : v).replace(/[&<>"']/g, (c) => ESC[c]);
  const store = {
    get(k, fb) { try { const v = localStorage.getItem(k); return v == null ? fb : JSON.parse(v); } catch (e) { return fb; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* private mode */ } },
  };

  // Theme: system (default), light, dark.
  const THEMES = ["system", "light", "dark"];
  function applyTheme(t) {
    if (t === "light" || t === "dark") document.documentElement.setAttribute("data-theme", t);
    else document.documentElement.removeAttribute("data-theme");
    const l = $("#theme-label");
    if (l) l.textContent = "Theme: " + (t === "light" ? "Light" : t === "dark" ? "Dark" : "System");
  }
  applyTheme(store.get("hq-theme", "system"));

  // Login page: only the error state.
  if (document.body.dataset.page === "login") {
    const q = new URLSearchParams(location.search);
    const e = q.get("e");
    const box = $("#login-error");
    const ok = $("#login-ok"), mbox = $("#login-magic-error");
    if (q.get("m") === "sent" && ok) ok.hidden = false;
    if (e && e.startsWith("magic") && mbox) {
      mbox.textContent = e === "magic_locked" ? "Too many sign-in links. Try again in 15 minutes."
        : e === "magic_expired" ? "That sign-in link has expired or was already used. Ask for a new one."
        : "Enter your work email address.";
      mbox.hidden = false;
      return;
    }
    if (e && box) {
      box.textContent = e === "locked" ? "Too many attempts. Try again in 15 minutes."
        : e === "unset" ? "The admin password is not set on the server yet. Run: wrangler secret put ADMIN_PASSWORD"
        : "Wrong password. Try again.";
      box.hidden = false;
    }
    return;
  }

  // ── Formatting ─────────────────────────────────────────────────────────────
  const NF = new Intl.NumberFormat("en-US");
  const NF1 = new Intl.NumberFormat("en-US", { maximumFractionDigits: 1 });
  const isNum = (v) => typeof v === "number" && isFinite(v);
  const n = (v) => (isNum(v) ? NF.format(Math.round(v)) : "—");
  const n1 = (v) => (isNum(v) ? NF1.format(v) : "—");
  const pc = (v) => (isNum(v) ? NF1.format(v) + "%" : "—");
  const money = (v) => (isNum(v) ? (v < 0 ? "−$" : "$") + NF.format(Math.abs(Math.round(v))) : "—");
  function moneyShort(v) {
    if (!isNum(v)) return "—";
    const a = Math.abs(v), s = v < 0 ? "−$" : "$";
    if (a >= 1e6) return s + NF1.format(a / 1e6) + "M";
    if (a >= 1e4) return s + NF1.format(a / 1e3) + "k";
    return s + NF.format(Math.round(a));
  }
  const roas = (v) => (isNum(v) ? NF1.format(v) + "×" : "—");
  const pp = (v) => (isNum(v) ? NF1.format(v * 100) + "%" : "—");
  const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  function dt(ts, withYear) {
    if (!ts) return "—";
    const d = new Date(ts);
    const y = withYear || d.getFullYear() !== new Date().getFullYear() ? " " + d.getFullYear() : "";
    return d.getDate() + " " + MONTHS[d.getMonth()] + y + ", " + String(d.getHours()).padStart(2, "0") + ":" + String(d.getMinutes()).padStart(2, "0");
  }
  function day(ts) {
    if (!ts) return "—";
    const d = new Date(ts);
    return d.getDate() + " " + MONTHS[d.getMonth()] + (d.getFullYear() !== new Date().getFullYear() ? " " + d.getFullYear() : "");
  }
  function hm(ts) { const d = new Date(ts); return String(d.getHours()).padStart(2, "0") + ":" + String(d.getMinutes()).padStart(2, "0"); }
  function ago(ts) {
    if (!ts) return "—";
    const s = Math.round((Date.now() - ts) / 1000);
    const fut = s < 0, a = Math.abs(s);
    const t = a < 60 ? a + "s" : a < 3600 ? Math.round(a / 60) + "m" : a < 86400 ? Math.round(a / 3600) + "h" : Math.round(a / 86400) + "d";
    return fut ? "in " + t : t + " ago";
  }
  const clock = (sec) => { sec = Math.max(0, Math.round(sec || 0)); return Math.floor(sec / 60) + ":" + String(sec % 60).padStart(2, "0"); };
  function dur(ms) {
    if (!isNum(ms)) return "—";
    const m = Math.round(Math.abs(ms) / 60000);
    if (m < 60) return m + " min";
    if (m < 2880) return Math.round(m / 60) + " h";
    return Math.round(m / 1440) + " days";
  }
  const human = (s) => String(s == null ? "" : s).replace(/_/g, " ");
  const label = (s) => { const h = human(s); return h.charAt(0).toUpperCase() + h.slice(1); };
  const dayKeyLabel = (k) => { const p = String(k).split("-"); return p.length === 3 ? Number(p[2]) + " " + MONTHS[Number(p[1]) - 1] : k; };
  const dateInput = (ts) => { if (!ts) return ""; const d = new Date(ts); return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0"); };
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

  // ── API ────────────────────────────────────────────────────────────────────
  async function api(path, opts) {
    const o = opts || {};
    const url = "/admin/api" + path + (o.query ? (path.includes("?") ? "&" : "?") + o.query : "");
    const init = { method: o.method || "GET", credentials: "same-origin", headers: {} };
    if (o.body !== undefined) { init.headers["content-type"] = "application/json"; init.body = JSON.stringify(o.body); }
    const res = await fetch(url, init);
    if (res.status === 401) { location.href = "/admin/login"; throw new Error("Signed out"); }
    let data = null;
    try { data = await res.json(); } catch (e) { data = null; }
    if (!res.ok) throw new Error((data && data.error) || "Request failed (" + res.status + ")");
    return data;
  }

  // ── State ──────────────────────────────────────────────────────────────────
  const S = {
    tab: "overview",
    filters: Object.assign({ range: "30d", channel: "", campaign: "", variant: "", device: "" }, store.get("hq-filters", {})),
    options: null,
    leads: { q: "", status: "", tier: "", sort: "created", page: 1 },
    trafficDim: store.get("hq-traffic-dim", "channel"),
    trafficView: store.get("hq-traffic-view", "sources") === "spend" ? "spend" : "sources",
    spendLevel: ["campaign", "adset", "ad"].includes(store.get("hq-spend-level", "campaign")) ? store.get("hq-spend-level", "campaign") : "campaign",
    insightsView: "booked",
    video: "main",
    trend: "visitors",
    landerIndustry: "",
    data: null,
    drawer: null,
    metrics: null,
    includeTest: store.get("hq-include-test", false) === true,
  };
  if (!["today", "7d", "30d", "90d", "all"].includes(S.filters.range)) S.filters.range = "30d";

  function qs(extra) {
    const p = new URLSearchParams();
    const f = S.filters;
    p.set("range", f.range);
    if (S.includeTest) p.set("test", "1");
    for (const k of ["channel", "campaign", "variant", "device"]) if (f[k]) p.set(k, f[k]);
    if (extra) for (const [k, v] of Object.entries(extra)) if (v != null && v !== "") p.set(k, String(v));
    return p.toString();
  }

  // ── Small components ───────────────────────────────────────────────────────
  function toast(msg, kind) {
    const wrap = $("#toasts");
    const el = document.createElement("div");
    el.className = "toast" + (kind === "err" ? " err" : "");
    el.textContent = msg;
    wrap.appendChild(el);
    setTimeout(() => el.remove(), kind === "err" ? 6000 : 3200);
  }
  const fail = (e) => toast(e && e.message ? e.message : String(e), "err");

  function card(o) {
    const head = o.title || o.actions
      ? '<div class="card-head"><div>' + (o.title ? '<h2 class="card-title">' + esc(o.title) + "</h2>" : "") +
        (o.sub ? '<p class="card-sub">' + esc(o.sub) + "</p>" : "") + "</div>" +
        (o.actions ? '<div class="card-actions">' + o.actions + "</div>" : "") + "</div>"
      : "";
    return '<section class="card' + (o.cls ? " " + esc(o.cls) : "") + '"' + (o.id ? ' id="' + esc(o.id) + '"' : "") + ">" + head +
      '<div class="card-body' + (o.flush ? " flush" : "") + '">' + o.body + "</div>" + (o.foot ? '<div class="card-foot">' + o.foot + "</div>" : "") + "</section>";
  }

  function empty(title, body, compact) {
    return '<div class="empty' + (compact ? " compact" : "") + '"><div class="empty-title">' + esc(title) + '</div><p class="empty-body">' + esc(body) + "</p></div>";
  }

  function delta(cur, prev, kind) {
    if (!isNum(cur) || !isNum(prev)) return "";
    if (kind === "cost") {
      // Lower is better: a rising cost reads as bad.
      if (!prev) return '<span class="delta flat">new</span>';
      const d = Math.round(((cur - prev) / prev) * 100);
      if (!d) return '<span class="delta flat">no change</span>';
      return '<span class="delta ' + (d > 0 ? "down" : "up") + '">' + (d > 0 ? "+" : "−") + esc(Math.abs(d)) + "%</span>";
    }
    if (kind === "rate") {
      const d = Math.round((cur - prev) * 10) / 10;
      if (!d) return '<span class="delta flat">no change</span>';
      return '<span class="delta ' + (d > 0 ? "up" : "down") + '">' + (d > 0 ? "+" : "−") + esc(NF1.format(Math.abs(d))) + " pts</span>";
    }
    if (!prev) return cur ? '<span class="delta up">new</span>' : '<span class="delta flat">no change</span>';
    const d = Math.round(((cur - prev) / prev) * 100);
    if (!d) return '<span class="delta flat">no change</span>';
    return '<span class="delta ' + (d > 0 ? "up" : "down") + '">' + (d > 0 ? "+" : "−") + esc(Math.abs(d)) + "%</span>";
  }

  // ── Metric dictionary (src/admin/metrics.ts): one definition per number, behind a "?" ──────────────
  let tipSeq = 0;
  /** An accessible "?" with the metric's definition: a real button described by a role=tooltip element. */
  function help(id, label) {
    const m = S.metrics && S.metrics[id];
    if (!m) return "";
    const tid = "tip-" + (++tipSeq);
    return '<span class="mhelp"><button class="mhelp-btn" type="button" aria-label="' + esc("What is " + (label || m.label) + "?") + '" aria-describedby="' + tid + '">?</button>' +
      '<span class="mhelp-tip" role="tooltip" id="' + tid + '">' + esc(m.definition) + "</span></span>";
  }
  function kpi(label, value, sub, metricId) {
    return '<div class="kpi"><div class="kpi-label">' + esc(label) + (metricId ? help(metricId, label) : "") + '</div><div class="kpi-value tnum">' + value + "</div>" +
      (sub ? '<div class="kpi-sub">' + sub + "</div>" : "") + "</div>";
  }

  // ── Small samples: Wilson 90% interval; rates on fewer than SMALL_N are muted with n ────────────────
  const SMALL_N = () => (S.smallN || 20);
  function wilson(k, nn) {
    if (!(nn > 0) || k < 0 || k > nn) return null;
    const z = 1.645, p = k / nn, z2 = z * z, den = 1 + z2 / nn;
    const mid = (p + z2 / (2 * nn)) / den, half = (z * Math.sqrt((p * (1 - p)) / nn + z2 / (4 * nn * nn))) / den;
    return [Math.max(0, mid - half), Math.min(1, mid + half)];
  }
  /** A rate from its counts. Small denominators: muted, "n=7", and the interval on hover (title) and for screen readers. */
  function rate(k, nn, o) {
    o = o || {};
    if (!isNum(nn) || nn <= 0 || !isNum(k)) return '<span class="faint">—</span>';
    const v = (k / nn) * 100;
    const txt = NF1.format(v) + "%";
    if (nn >= SMALL_N()) return esc(txt);
    const ci = wilson(Math.min(k, nn), nn);
    const range = ci ? Math.round(ci[0] * 100) + "–" + Math.round(ci[1] * 100) + "%" : "";
    return '<span class="small-n" title="' + esc("Only " + nn + " in the sample. 90% interval: " + range) + '">' + esc(txt) + '<span class="n-tag">n=' + esc(nn) + '</span><span class="sr-only"> (90% interval ' + esc(range) + ")</span></span>";
  }
  /** A KPI value for a rate: big number, muted when the sample is small. */
  const rateValue = (k, nn) => (!isNum(nn) || nn <= 0 ? esc("—") : rate(k, nn));
  function kpis(items, cls) { return '<div class="kpis' + (cls ? " " + cls : "") + '">' + items.join("") + "</div>"; }

  /** width percentage set later via CSSOM (CSP forbids style attributes). */
  const w = (v) => ' data-w="' + esc(clamp(isNum(v) ? v : 0, 0, 100).toFixed(2)) + '"';

  function bars(items, o) {
    o = o || {};
    if (!items.length) return empty(o.emptyTitle || "Nothing yet", o.emptyBody || "This fills in as data arrives.", true);
    const max = Math.max(1, ...items.map((i) => i.value || 0));
    return '<div class="bar-list">' + items.map((i) =>
      '<div class="bar-row"><div class="bar-label"' + (i.title ? ' title="' + esc(i.title) + '"' : "") + ">" + esc(i.label) +
      (i.sub ? ' <span class="faint">' + esc(i.sub) + "</span>" : "") + '</div><div class="bar-value">' + esc(i.display != null ? i.display : n(i.value)) +
      (i.extra ? '<span class="faint">' + esc(i.extra) + "</span>" : "") + '</div><div class="bar-track"><div class="bar-fill' + (o.color ? " " + o.color : "") + '"' + w(((i.value || 0) / max) * 100) + "></div></div></div>").join("") + "</div>";
  }

  /** cols: [{label, num?, cls?, get(row) -> html (already escaped)}] */
  function table(cols, rows, o) {
    o = o || {};
    if (!rows.length) return o.empty || empty("Nothing here yet", "Rows appear as data comes in.", true);
    const head = "<thead><tr>" + cols.map((c) => "<th" + (c.num ? ' class="num"' : "") + ' scope="col">' + esc(c.label) + "</th>").join("") + "</tr></thead>";
    const body = "<tbody>" + rows.map((r) => {
      const click = o.rowAction ? o.rowAction(r) : null;
      return "<tr" + (click ? ' class="click" data-action="' + esc(click.action) + '" data-id="' + esc(click.id) + '" tabindex="0"' : "") + ">" +
        cols.map((c) => "<td" + (c.num || c.cls ? ' class="' + (c.num ? "num" : "") + (c.cls ? " " + c.cls : "") + '"' : "") + ">" + c.get(r) + "</td>").join("") + "</tr>";
    }).join("") + "</tbody>";
    const foot = o.foot ? "<tfoot><tr>" + cols.map((c, i) => "<td" + (c.num ? ' class="num"' : "") + ">" + (o.foot[i] == null ? "" : o.foot[i]) + "</td>").join("") + "</tr></tfoot>" : "";
    return '<div class="table-wrap' + (o.tall ? " tall" : o.mid ? " mid" : "") + '"><table class="t">' + head + body + foot + "</table></div>";
  }

  const STATUS_CLS = { partial: "b-grey", applied: "b-blue", booked: "b-blue", showed: "b-green", no_show: "b-amber", won: "b-green", lost: "b-red", nurture: "b-grey", disqualified: "b-red" };
  const STATUS_LABEL = { partial: "Partial", applied: "Applied", booked: "Booked", showed: "Showed", no_show: "No-show", won: "Won", lost: "Lost", nurture: "Nurture", disqualified: "Disqualified" };
  const statusBadge = (s) => '<span class="badge ' + (STATUS_CLS[s] || "b-grey") + '">' + esc(STATUS_LABEL[s] || human(s)) + "</span>";
  const tierBadge = (t) => (t ? '<span class="tier t-' + esc(t) + '" title="Tier ' + esc(t) + '">' + esc(t) + "</span>" : '<span class="faint">—</span>');
  const badge = (text, cls) => '<span class="badge ' + (cls || "b-grey") + '">' + esc(text) + "</span>";
  const sel = (name, options, value, o) => {
    o = o || {};
    return '<select class="select' + (o.sm ? " sm" : "") + '" name="' + esc(name) + '"' + (o.id ? ' id="' + esc(o.id) + '"' : "") + (o.change ? ' data-change="' + esc(o.change) + '"' : "") + (o.label ? ' aria-label="' + esc(o.label) + '"' : "") + (o.disabled ? " disabled" : "") + ">" +
      options.map((op) => { const v = typeof op === "object" ? op.value : op; const l = typeof op === "object" ? op.label : op; return '<option value="' + esc(v) + '"' + (String(v) === String(value == null ? "" : value) ? " selected" : "") + ">" + esc(l) + "</option>"; }).join("") + "</select>";
  };
  const copyBtn = (text, label) => '<button class="btn btn-sm" type="button" data-action="copy" data-copy="' + esc(text) + '">' + esc(label || "Copy") + "</button>";
  const leadLink = (id, label) => '<a href="#lead=' + encodeURIComponent(id) + '" class="t-name">' + esc(label) + "</a>";

  // ── Charts (drawn after mount, at the container's real width) ──────────────
  const charts = new Map();
  let chartSeq = 0;
  function chart(cfg) {
    const id = "c" + (++chartSeq);
    charts.set(id, cfg);
    return '<div class="chart" data-chart="' + id + '"></div>';
  }
  function niceMax(v) {
    if (v <= 0) return 1;
    const e = Math.pow(10, Math.floor(Math.log10(v)));
    for (const m of [1, 1.2, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10]) if (m * e >= v) return m * e;
    return 10 * e;
  }
  const svgNS = 'xmlns="http://www.w3.org/2000/svg"';

  function drawArea(el, c) {
    const W = Math.max(280, el.clientWidth), H = c.height || 240;
    const pad = { l: 44, r: 12, t: c.markers && c.markers.length ? 22 : 10, b: 26 };
    const vals = c.values.map((v) => (isNum(v) ? v : 0));
    const N = vals.length;
    const max = c.yMax || niceMax(Math.max(...vals, 0));
    const iw = W - pad.l - pad.r, ih = H - pad.t - pad.b;
    const x = (i) => pad.l + (N <= 1 ? iw / 2 : (i * iw) / (N - 1));
    const y = (v) => pad.t + ih - (v / max) * ih;
    let s = "<svg " + svgNS + ' width="' + W + '" height="' + H + '" viewBox="0 0 ' + W + " " + H + '" role="img" aria-label="' + esc(c.label || "Chart") + '">';
    for (let g = 0; g <= 4; g++) {
      const gv = (max / 4) * g, gy = y(gv);
      s += '<line class="' + (g ? "gridline" : "baseline") + '" x1="' + pad.l + '" x2="' + (W - pad.r) + '" y1="' + gy + '" y2="' + gy + '"/>';
      s += '<text class="tick" x="' + (pad.l - 8) + '" y="' + (gy + 4) + '" text-anchor="end">' + esc((c.yFmt || n)(gv)) + "</text>";
    }
    const ticks = Math.min(N, Math.max(2, Math.floor(iw / 90)));
    for (let t = 0; t < ticks; t++) {
      const i = ticks === 1 ? 0 : Math.round((t * (N - 1)) / (ticks - 1));
      s += '<text class="tick" x="' + x(i) + '" y="' + (H - 6) + '" text-anchor="' + (t === 0 ? "start" : t === ticks - 1 ? "end" : "middle") + '">' + esc((c.xFmt || String)(c.labels[i], i)) + "</text>";
    }
    for (const m of c.markers || []) {
      const mx = x(m.i);
      s += '<line class="' + (m.accent ? "accent-line" : "marker-line") + '" x1="' + mx + '" x2="' + mx + '" y1="' + (pad.t - 4) + '" y2="' + (pad.t + ih) + '"/>';
      if (m.label) s += '<text class="' + (m.accent ? "accent-label" : "marker-label") + '" x="' + (mx + 4) + '" y="' + (pad.t - 8) + '">' + esc(m.label) + "</text>";
    }
    if (N) {
      const pts = vals.map((v, i) => x(i).toFixed(1) + "," + y(v).toFixed(1));
      s += '<path class="series-area" d="M' + x(0) + "," + y(0) + " L" + pts.join(" L") + " L" + x(N - 1) + "," + y(0) + ' Z"/>';
      s += '<path class="series-line" d="M' + pts.join(" L") + '"/>';
    }
    s += '<line class="cross" x1="0" x2="0" y1="' + pad.t + '" y2="' + (pad.t + ih) + '" visibility="hidden"/><circle class="dot" r="4" cx="0" cy="0" visibility="hidden"/>';
    s += '<rect class="hit" x="' + pad.l + '" y="' + pad.t + '" width="' + iw + '" height="' + ih + '"/></svg><div class="tooltip" hidden></div>';
    el.innerHTML = s;
    const svg = el.querySelector("svg"), hit = el.querySelector(".hit"), cross = el.querySelector(".cross"), dot = el.querySelector(".dot"), tip = el.querySelector(".tooltip");
    const show = (ev) => {
      const r = svg.getBoundingClientRect();
      const px = ev.clientX - r.left;
      const i = clamp(Math.round(N <= 1 ? 0 : ((px - pad.l) / iw) * (N - 1)), 0, N - 1);
      const cx = x(i), cy = y(vals[i]);
      cross.setAttribute("x1", cx); cross.setAttribute("x2", cx); cross.setAttribute("visibility", "visible");
      dot.setAttribute("cx", cx); dot.setAttribute("cy", cy); dot.setAttribute("visibility", "visible");
      tip.innerHTML = '<div class="tt-title">' + esc((c.tipX || c.xFmt || String)(c.labels[i], i)) + '</div><div class="tt-value"><span class="swatch"></span>' + esc((c.fmt || n)(c.values[i])) + (c.unit ? ' <span class="faint">' + esc(c.unit) + "</span>" : "") + "</div>";
      tip.hidden = false;
      tip.style.left = clamp(cx, 70, W - 70) + "px";
      tip.style.top = cy + "px";
    };
    const hide = () => { cross.setAttribute("visibility", "hidden"); dot.setAttribute("visibility", "hidden"); tip.hidden = true; };
    hit.addEventListener("pointermove", show);
    hit.addEventListener("pointerdown", show);
    hit.addEventListener("pointerleave", hide);
  }

  function drawColumns(el, c) {
    const W = Math.max(240, el.clientWidth), H = c.height || 180;
    const pad = { l: 36, r: 8, t: 10, b: 24 };
    const N = c.values.length;
    const max = niceMax(Math.max(...c.values, 0));
    const iw = W - pad.l - pad.r, ih = H - pad.t - pad.b;
    const bw = iw / Math.max(1, N);
    const gap = Math.min(8, bw * 0.25);
    let s = "<svg " + svgNS + ' width="' + W + '" height="' + H + '" viewBox="0 0 ' + W + " " + H + '" role="img" aria-label="' + esc(c.label || "Chart") + '">';
    for (let g = 0; g <= 4; g++) {
      const gv = (max / 4) * g, gy = pad.t + ih - (gv / max) * ih;
      s += '<line class="' + (g ? "gridline" : "baseline") + '" x1="' + pad.l + '" x2="' + (W - pad.r) + '" y1="' + gy + '" y2="' + gy + '"/>';
      s += '<text class="tick" x="' + (pad.l - 6) + '" y="' + (gy + 4) + '" text-anchor="end">' + esc(n(gv)) + "</text>";
    }
    c.values.forEach((v, i) => {
      const h = (v / max) * ih;
      const bx = pad.l + i * bw + gap / 2;
      if (h > 0) {
        const r = Math.min(4, (bw - gap) / 2, h);
        const x0 = bx, x1 = bx + bw - gap, y0 = pad.t + ih, y1 = y0 - h;
        s += '<path class="col" data-i="' + i + '" d="M' + x0 + "," + y0 + " L" + x0 + "," + (y1 + r) + " Q" + x0 + "," + y1 + " " + (x0 + r) + "," + y1 + " L" + (x1 - r) + "," + y1 + " Q" + x1 + "," + y1 + " " + x1 + "," + (y1 + r) + " L" + x1 + "," + y0 + ' Z"/>';
      }
      if (N <= 12 || i % Math.ceil(N / 10) === 0) s += '<text class="tick" x="' + (bx + (bw - gap) / 2) + '" y="' + (H - 6) + '" text-anchor="middle">' + esc(c.labels[i]) + "</text>";
      s += '<rect class="hit" data-i="' + i + '" x="' + (pad.l + i * bw) + '" y="' + pad.t + '" width="' + bw + '" height="' + ih + '"/>';
    });
    s += '</svg><div class="tooltip" hidden></div>';
    el.innerHTML = s;
    const tip = el.querySelector(".tooltip");
    el.querySelectorAll(".hit").forEach((r) => {
      r.addEventListener("pointerenter", () => {
        const i = Number(r.getAttribute("data-i"));
        tip.innerHTML = '<div class="tt-title">' + esc(c.tipLabel ? c.tipLabel(i) : c.labels[i]) + '</div><div class="tt-value"><span class="swatch"></span>' + esc(n(c.values[i])) + (c.unit ? ' <span class="faint">' + esc(c.unit) + "</span>" : "") + "</div>";
        tip.hidden = false;
        tip.style.left = clamp(pad.l + i * bw + bw / 2, 70, W - 70) + "px";
        tip.style.top = (pad.t + ih - (c.values[i] / max) * ih) + "px";
      });
      r.addEventListener("pointerleave", () => { tip.hidden = true; });
    });
  }

  /** Stacked columns: c.series = [{label, values[]}], colours follow the swatch order (s1…s6). */
  function drawStacked(el, c) {
    const W = Math.max(240, el.clientWidth), H = c.height || 200;
    const pad = { l: 32, r: 8, t: 10, b: 24 };
    const N = c.labels.length;
    const totals = c.labels.map((_, i) => c.series.reduce((t, s) => t + (s.values[i] || 0), 0));
    const max = niceMax(Math.max(...totals, 0));
    const iw = W - pad.l - pad.r, ih = H - pad.t - pad.b;
    const bw = iw / Math.max(1, N), gap = Math.min(10, bw * 0.3);
    let s = "<svg " + svgNS + ' width="' + W + '" height="' + H + '" viewBox="0 0 ' + W + " " + H + '" role="img" aria-label="' + esc(c.label || "Chart") + '">';
    for (let g = 0; g <= 4; g++) {
      const gv = (max / 4) * g, gy = pad.t + ih - (gv / max) * ih;
      s += '<line class="' + (g ? "gridline" : "baseline") + '" x1="' + pad.l + '" x2="' + (W - pad.r) + '" y1="' + gy + '" y2="' + gy + '"/>';
      if (g % 2 === 0) s += '<text class="tick" x="' + (pad.l - 6) + '" y="' + (gy + 4) + '" text-anchor="end">' + esc(n(gv)) + "</text>";
    }
    c.labels.forEach((lab, i) => {
      let y0 = pad.t + ih;
      const bx = pad.l + i * bw + gap / 2;
      c.series.forEach((ser, j) => {
        const v = ser.values[i] || 0;
        if (!v) return;
        const h = (v / max) * ih;
        s += '<rect class="seg-col k' + ((j % 6) + 1) + '" x="' + bx + '" y="' + (y0 - h) + '" width="' + Math.max(1, bw - gap) + '" height="' + Math.max(0, h - 1) + '"/>';
        y0 -= h;
      });
      if (N <= 10 || i % Math.ceil(N / 8) === 0) s += '<text class="tick" x="' + (bx + (bw - gap) / 2) + '" y="' + (H - 6) + '" text-anchor="middle">' + esc(String(lab).replace(/^w\/c /, "")) + "</text>";
      s += '<rect class="hit" data-i="' + i + '" x="' + (pad.l + i * bw) + '" y="' + pad.t + '" width="' + bw + '" height="' + ih + '"/>';
    });
    s += '</svg><div class="tooltip" hidden></div>';
    el.innerHTML = s;
    const tip = el.querySelector(".tooltip");
    el.querySelectorAll(".hit").forEach((r) => {
      r.addEventListener("pointerenter", () => {
        const i = Number(r.getAttribute("data-i"));
        tip.innerHTML = '<div class="tt-title">' + esc(c.labels[i]) + "</div>" + c.series.filter((x) => x.values[i]).map((x) => '<div class="tt-value">' + esc(x.label) + " · " + esc(n(x.values[i])) + "</div>").join("") + (totals[i] ? "" : '<div class="tt-value faint">None</div>');
        tip.hidden = false;
        tip.style.left = clamp(pad.l + i * bw + bw / 2, 70, W - 70) + "px";
        tip.style.top = (pad.t + ih - (totals[i] / max) * ih) + "px";
      });
      r.addEventListener("pointerleave", () => { tip.hidden = true; });
    });
  }
  const DRAW = { columns: drawColumns, stacked: drawStacked };
  const drawChart = (el, cfg) => (DRAW[cfg.type] || drawArea)(el, cfg);

  const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver((entries) => {
    for (const e of entries) {
      const el = e.target, cfg = charts.get(el.getAttribute("data-chart"));
      if (!cfg) continue;
      const wNow = Math.round(e.contentRect.width);
      if (el._w === wNow) continue;
      el._w = wNow;
      drawChart(el, cfg);
    }
  }) : null;

  /** After any innerHTML render: widths, charts. */
  function hydrate(root) {
    $$("[data-w]", root).forEach((el) => { el.style.width = el.getAttribute("data-w") + "%"; });
    $$("[data-chart]", root).forEach((el) => {
      const cfg = charts.get(el.getAttribute("data-chart"));
      if (!cfg) return;
      drawChart(el, cfg);
      el._w = Math.round(el.clientWidth);
      if (ro) ro.observe(el);
    });
  }

  // ── Tabs ───────────────────────────────────────────────────────────────────
  const ICONS = {
    overview: '<rect x="2.5" y="2.5" width="4.5" height="4.5" rx="1"/><rect x="9" y="2.5" width="4.5" height="4.5" rx="1"/><rect x="2.5" y="9" width="4.5" height="4.5" rx="1"/><rect x="9" y="9" width="4.5" height="4.5" rx="1"/>',
    map: '<circle cx="3.5" cy="4" r="1.5"/><circle cx="12.5" cy="4" r="1.5"/><circle cx="8" cy="12" r="1.5"/><path d="M5 4h6M4.3 5.3l2.9 5.4M11.7 5.3l-2.9 5.4"/>',
    traffic: '<path d="M2.5 13.5h11M4 11V8M7 11V5M10 11V7M13 11V3"/>',
    landers: '<rect x="2.5" y="2.5" width="11" height="11" rx="1.5"/><path d="M2.5 6h11M8 6v7.5"/>',
    links: '<path d="M6.5 9.5l3-3M7 4.5l1-1a2.5 2.5 0 0 1 3.5 3.5l-1 1M9 11.5l-1 1A2.5 2.5 0 0 1 4.5 9l1-1"/>',
    vsl: '<rect x="2" y="3.5" width="12" height="9" rx="1.5"/><path d="M7 6.3v3.4L9.8 8z"/>',
    behaviour: '<path d="M4 2.5l8 5-3.5 1 2 4-1.5.8-2-4L4 12z"/>',
    application: '<rect x="3" y="2" width="10" height="12" rx="1.5"/><path d="M5.5 5.5h5M5.5 8h5M5.5 10.5h3"/>',
    leads: '<circle cx="6" cy="5.5" r="2.5"/><path d="M2 13.5c.5-2.3 2-3.5 4-3.5s3.5 1.2 4 3.5M10.5 3.2a2.5 2.5 0 0 1 0 4.6M12 10.3c1 .5 1.7 1.6 2 3.2"/>',
    sales: '<path d="M2.5 13.5h11M3.5 13.5V9l3-2.5 3 2 4-5"/><path d="M10.5 3.5h3v3"/>',
    insights: '<circle cx="8" cy="8" r="5.5"/><path d="M8 2.5V8l4 3.5"/>',
    team: '<circle cx="5.5" cy="6" r="2"/><circle cx="11" cy="6" r="2"/><path d="M2 13c.4-1.8 1.7-3 3.5-3S8.6 11.2 9 13M8.5 13c.4-1.8 1.2-3 2.5-3 1.8 0 3.1 1.2 3.5 3"/>',
    emails: '<rect x="2" y="3.5" width="12" height="9" rx="1.5"/><path d="M2.5 4.5L8 8.5l5.5-4"/>',
    voice: '<path d="M5.5 2.5l1.5 3-1.5 1.2a7 7 0 0 0 3.3 3.3l1.2-1.5 3 1.5-.6 2.4c-.2.6-.7 1-1.3 1A10 10 0 0 1 2.1 4.4c0-.6.4-1.1 1-1.3z"/>',
    tracking: '<circle cx="8" cy="8" r="5.5"/><circle cx="8" cy="8" r="2.5"/><path d="M8 1v2M8 13v2M1 8h2M13 8h2"/>',
    live: '<path d="M1.5 8h3l1.5-4 3 8 1.5-4h4"/>',
    alerts: '<path d="M8 2.5L14 13H2z"/><path d="M8 6.5v3M8 11.2v.1"/>',
    integrations: '<path d="M6 2.5v3M10 2.5v3M4.5 5.5h7v2.5a3.5 3.5 0 0 1-7 0zM8 11.5v2"/>',
    today: '<rect x="2.5" y="3.5" width="11" height="10" rx="1.5"/><path d="M2.5 6.5h11M5.5 2v3M10.5 2v3M5.5 9.5l1.5 1.5 3-3"/>',
    pipeline: '<rect x="2" y="3" width="3" height="10" rx="1"/><rect x="6.5" y="3" width="3" height="7" rx="1"/><rect x="11" y="3" width="3" height="4" rx="1"/>',
    attribution: '<circle cx="3.5" cy="8" r="1.5"/><circle cx="12.5" cy="3.5" r="1.5"/><circle cx="12.5" cy="12.5" r="1.5"/><path d="M5 8h3l3-3.7M8 8l3 3.7"/>',
    quality: '<path d="M8 2l5 2v4c0 3-2.2 5-5 6-2.8-1-5-3-5-6V4z"/><path d="M5.8 8.2l1.6 1.6 3-3.2"/>',
    activity: '<rect x="3" y="2" width="10" height="12" rx="1.5"/><path d="M5.5 5h5M5.5 8h5M5.5 11h3"/>',
    api: '<path d="M5.5 4.5L2 8l3.5 3.5M10.5 4.5L14 8l-3.5 3.5M9 3l-2 10"/>',
  };

  // KEEP the ids in sync with TAB_IDS in src/admin/map.ts.
  const TABS = [
    { id: "overview", group: "", title: "Overview", sub: "How the whole funnel is doing for the selected period, from first visit to cash." },
    { id: "today", group: "", title: "Today", sub: "Your calls with prep, new A and B leads nobody has called yet, follow-ups and instalments due.", noFilters: true },
    { id: "map", group: "", title: "Funnel map", sub: "Every page, decision and automation with live numbers. Drag to rearrange; changes are shared with your team." },
    { id: "traffic", group: "Acquisition", title: "Traffic & ads", sub: "Where visitors come from, and which sources turn into calls and cash." },
    { id: "attribution", group: "Acquisition", title: "Attribution & cohorts", sub: "Credit for leads, calls, wins and cash under five models, the paths people take, and how cohorts pay over time." },
    { id: "landers", group: "Acquisition", title: "Landing pages & tests", sub: "The headline test on the main page and the 100 industry landers the bandit is optimising." },
    { id: "links", group: "Acquisition", title: "Links & videos", sub: "Tracked links for YouTube, podcasts, newsletters and bios, and what each one produced." },
    { id: "vsl", group: "Conversion", title: "VSL", sub: "How far people watch the film, where they drop off and how many reach the pitch." },
    { id: "behaviour", group: "Conversion", title: "On-page behaviour", sub: "What people click, re-read and skip, and where the application form gets hard." },
    { id: "application", group: "Conversion", title: "Application", sub: "Where applicants drop off, what they answer and how they score." },
    { id: "leads", group: "Sales", title: "Leads", sub: "Everyone who left their details. Search looks across all time; open a lead to log the outcome." },
    { id: "pipeline", group: "Sales", title: "Pipeline & forecast", sub: "Every open deal by stage, weighted by how often that stage closes, and the cash forecast for this month and next.", noFilters: true },
    { id: "sales", group: "Sales", title: "Sales team", sub: "Calls, show rate, closes and cash by rep, plus the calls that still need an outcome." },
    { id: "insights", group: "Sales", title: "Insights", sub: "Everyone who booked, split by tier, and what your best leads have in common." },
    { id: "team", group: "Sales", title: "Team", sub: "Closers and setters, which tiers they take, and where their pings go.", noFilters: true },
    { id: "emails", group: "Automation", title: "Emails", sub: "Every sequence and step, what is queued next, and how emails are landing." },
    { id: "voice", group: "Automation", title: "Voice", sub: "AI calls that confirm, chase and rebook. Set up, switch on and listen back." },
    { id: "tracking", group: "System", title: "Tracking", sub: "Server-side forwarding to Meta, GA4, PostHog and your CRM, and how well Meta can match people." },
    { id: "live", group: "System", title: "Live", sub: "What is happening on the site right now. Updates every five seconds while this tab is open.", noFilters: true },
    { id: "alerts", group: "System", title: "Alerts", sub: "Automatic checks against the same hours of the last four weeks. Open alerts ping the team and show a red bar here.", noFilters: true },
    { id: "quality", group: "System", title: "Data quality", sub: "Duplicate leads to merge, and gaps in the data: missing phones, bookings with no lead, leads with no source.", noFilters: true },
    { id: "activity", group: "System", title: "Activity log", sub: "Who changed what: outcomes, payments, settings (names only), team and user changes, merges and erasures.", noFilters: true },
    { id: "api", group: "System", title: "API & webhooks", sub: "Keys for the read-only API, signed webhooks to your other systems, and CSV exports.", noFilters: true },
    { id: "integrations", group: "System", title: "Integrations", sub: "Keys and settings for every service. Keys go here, never into a chat.", noFilters: true },
  ];
  // Tabs by role (the server enforces the same rules; this only keeps the menu honest).
  const REP_TABS = ["today", "pipeline", "leads", "sales"];
  const VIEWER_HIDDEN = ["integrations", "activity", "api"];
  function roleAllows(id) {
    const r = S.me ? S.me.role : "viewer";
    if (r === "owner" || r === "manager") return true;
    if (r === "closer" || r === "setter") return REP_TABS.includes(id);
    return !VIEWER_HIDDEN.includes(id);
  }
  const tabAllowed = (id) => roleAllows(id) && simpleAllows(id);
  const canWrite = () => !!S.me && S.me.role !== "viewer";
  const isManager = () => !!S.me && (S.me.role === "owner" || S.me.role === "manager");
  // Showed / no-show open 10 minutes before the start (the server refuses earlier).
  const callNotYet = (at) => isNum(at) && at > Date.now() + 10 * 60000;
  const TAB = Object.fromEntries(TABS.map((t) => [t.id, t]));

  // ── Overview ───────────────────────────────────────────────────────────────
  const TREND_SERIES = [
    { id: "visitors", label: "Visitors" }, { id: "optins", label: "Opt-ins" }, { id: "applications", label: "Applications" },
    { id: "booked", label: "Booked" }, { id: "won", label: "Won" },
  ];
  TAB.overview.load = () => Promise.all([
    api("/overview", { query: qs() }),
    isManager() ? api("/readiness").catch(() => null) : Promise.resolve(null),
    isManager() ? api("/test-data").catch(() => null) : Promise.resolve(null),
  ]).then((r) => Object.assign(r[0], { _ready: r[1], _test: r[2] }));
  TAB.overview.render = (d) => {
    const k = d.kpis, p = d.prev || {};
    const c = d.counts, pc0 = d.prev_counts || {};
    const quiet = !c.visitors && !c.optins && !c.booked;
    const rateDelta = (cur, prev, a, b) => (isNum(cur) && isNum(prev) && a >= SMALL_N() && b >= SMALL_N() ? delta(cur, prev, "rate") : "");
    const tiles = kpis([
      kpi("Visitors", esc(n(k.visitors)), delta(k.visitors, p.visitors) || "Unique people, bots and test traffic excluded", "visitors"),
      kpi("Play rate", rateValue(c.plays, c.visitors), rateDelta(k.play_rate, p.play_rate, c.visitors, pc0.visitors) || esc(n(c.plays)) + " of " + esc(n(c.visitors)) + " pressed play", "play_rate"),
      kpi("Applications", esc(n(k.applications)), delta(k.applications, p.applications) || esc(n(c.qualified)) + " qualified (A/B)", "applied"),
      kpi("Booked calls", esc(n(k.booked)), delta(k.booked, p.booked) || "New bookings in the period", "booked"),
      kpi("Opt-in rate", rateValue(c.optins, c.visitors), rateDelta(k.optin_rate, p.optin_rate, c.visitors, pc0.visitors) || esc(n(c.optins)) + " left contact details", "optin_rate"),
      kpi("Pitch reached", rateValue(c.pitch, c.plays), rateDelta(k.pitch_rate, p.pitch_rate, c.plays, pc0.plays) || "Of plays, reached the offer", "pitch_rate"),
      kpi("Revenue", esc(moneyShort(k.revenue)), (delta(k.revenue, p.revenue) ? delta(k.revenue, p.revenue) + " · " : "") + esc(moneyShort(k.cash)) + " cash collected", "revenue"),
      kpi("WhatsApp clicks", esc(n(k.whatsapp)), delta(k.whatsapp, p.whatsapp) || "Taps on the WhatsApp button", "whatsapp"),
      kpi("Ad spend", esc(moneyShort(k.spend)), delta(k.spend, p.spend) || "All platforms, in the period", "spend"),
      kpi("CAC", esc(moneyShort(k.cac)), c.won && c.won < 5 ? '<span class="faint">Only ' + esc(n(c.won)) + " deal" + (c.won === 1 ? "" : "s") + "</span>" : delta(k.cac, p.cac, "cost") || "Spend ÷ deals won", "cac"),
      kpi("Cash ROAS", esc(roas(k.cash_roas)), delta(k.cash_roas, p.cash_roas) || "Cash collected ÷ spend", "cash_roas"),
      kpi("Cost per booked call", esc(moneyShort(k.cost_per_booked)), c.booked && c.booked < 5 ? '<span class="faint">Only ' + esc(n(c.booked)) + " booked</span>" : delta(k.cost_per_booked, p.cost_per_booked, "cost") || "Spend ÷ new bookings", "cost_per_booked"),
    ]);
    const series = d.trend.series[S.trend] || [];
    const total = series.reduce((a, b) => a + b, 0);
    const trend = card({
      title: "Daily trend",
      sub: (TREND_SERIES.find((s) => s.id === S.trend) || {}).label + " per day · " + n(total) + " in total" + (S.filters.range === "today" ? " · last 14 days" : ""),
      actions: '<div class="seg" role="group" aria-label="Series">' + TREND_SERIES.map((s) => '<button type="button" data-action="trend" data-series="' + esc(s.id) + '" aria-pressed="' + (S.trend === s.id) + '">' + esc(s.label) + "</button>").join("") + "</div>",
      body: d.trend.days.length > 1 ? chart({ type: "area", labels: d.trend.days, values: series, xFmt: dayKeyLabel, label: "Daily trend", height: 240 }) : empty("Not enough days yet", "The trend line appears once there are two days of data in the selected range."),
    });
    const maxN = Math.max(1, ...d.funnel.map((r) => r.n));
    const funnel = card({
      title: "Funnel",
      sub: "People active in the period and how far each has got so far. Each step counts everyone who reached it or a later step, so a step is never larger than the one above.",
      body: '<div class="funnel"><div class="funnel-row funnel-head"><span>Step</span><span></span><span class="f-n">People</span><span class="f-rate">From prev.</span></div>' +
        d.funnel.map((r, i) => '<div class="funnel-row"><span class="f-label">' + esc(r.label) + help(r.key, r.label) + '</span><div class="f-bar"><div class="f-fill"' + w((r.n / maxN) * 100) + '></div></div><span class="f-n">' + esc(n(r.n)) + '</span><span class="f-rate">' + (i ? rate(r.n, r.prev) : '<span class="faint">—</span>') + "</span></div>").join("") + "</div>",
      foot: "Tiles above count events dated in the period (an application submitted today from last week's visitor counts today); the funnel follows people.",
    });
    const tiers = c.tier_a + c.tier_b + c.tier_c;
    const money2 = card({
      title: "Quality and cash",
      sub: "Applications by tier and what closed",
      body: '<div class="stack gap16">' +
        (tiers ? '<div class="stack-bar" role="img" aria-label="Tier split"><span class="s1"' + w((c.tier_a / tiers) * 100) + '></span><span class="s2"' + w((c.tier_b / tiers) * 100) + '></span><span class="s3"' + w((c.tier_c / tiers) * 100) + "></span></div>" +
          '<div class="legend"><span><span class="swatch"></span>A ' + esc(n(c.tier_a)) + '</span><span><span class="swatch sw2"></span>B ' + esc(n(c.tier_b)) + '</span><span><span class="swatch sw3"></span>C ' + esc(n(c.tier_c)) + "</span></div>" : '<p class="faint small">No scored applications in this period.</p>') +
        '<dl class="kv"><dt>Show rate</dt><dd class="tnum">' + rate(c.showed, c.showed + c.no_show) + ' <span class="faint">' + esc(n(c.showed)) + " of " + esc(n(c.showed + c.no_show)) + '</span></dd><dt>Won</dt><dd class="tnum">' + esc(n(c.won)) + " · " + esc(money(c.revenue)) + '</dd><dt>Close rate</dt><dd class="tnum">' + rate(c.won, c.showed) + '</dd><dt>Lost</dt><dd class="tnum">' + esc(n(c.lost)) + '</dd><dt>Cash collected</dt><dd class="tnum">' + esc(money(c.cash)) + "</dd></dl></div>",
    });
    return readinessCard(d._ready) + (quiet ? '<div class="callout info"><span class="callout-dot"></span><div><strong>No activity in this period yet.</strong> Numbers fill in as soon as people visit the site. Try a longer range, or check Tracking if you expected traffic.</div></div>' : "") +
      tiles + trend + '<div class="grid g-2-1">' + funnel + money2 + "</div>" + testDataCard(d._test);
  };

  // ── Launch readiness (owners and managers) ─────────────────────────────────
  function readinessCard(r) {
    if (!r) return "";
    const failing = r.checks.filter((c) => c.required && !c.ok);
    const bar = r.red ? '<div class="callout bad" role="alert"><span class="callout-dot"></span><div><strong>Ads are spending (' + esc(moneyShort(r.spend_7d)) + " in 7 days) while " + esc(n(failing.length)) + " launch check" + (failing.length === 1 ? " fails" : "s fail") + ":</strong> " + esc(failing.map((c) => c.label).join(" · ")) + ".</div></div>" : "";
    const open = !(failing.length === 0 && S.readyCollapsed !== false);
    const row = (c) => '<li class="ready-row' + (c.ok ? " ok" : c.required ? " bad" : " opt") + '"><span class="ready-dot" aria-hidden="true"></span><div class="ready-main"><div class="t-name">' + esc(c.label) + (c.required ? "" : ' <span class="faint small">optional</span>') + '<span class="sr-only">' + (c.ok ? " — passing" : " — not done") + '</span></div><div class="small faint">' + esc(c.detail) + "</div></div>" +
      '<div class="ready-act">' + (c.confirm && S.me && S.me.role === "owner" ? '<label class="switch"><input type="checkbox" data-change="ready-confirm" data-key="' + esc(c.confirm) + '"' + (c.ok ? " checked" : "") + '><span class="switch-track"></span><span class="small">Confirmed</span></label>'
        : c.fix === "dns" ? '<button class="btn btn-sm" type="button" data-action="ready-dns">Check DNS</button>'
        : c.fix === "purge" && !c.ok ? '<a class="btn btn-sm" href="#overview" data-action="scroll-test">Review test data</a>'
        : c.fix && !c.ok ? '<a class="btn btn-sm btn-ghost" href="' + esc(c.fix) + '">Fix</a>' : "") + "</div></li>";
    const live = r.go_live ? '<span class="faint small">Went live ' + esc(dt(r.go_live.at)) + " · skipped " + esc(n(r.go_live.skipped)) + " stale emails</span>" : "";
    const goBtn = S.me && S.me.role === "owner" ? '<button class="btn btn-sm' + (failing.length ? "" : " btn-primary") + '" type="button" data-action="go-live">' + (r.go_live ? "Go live again" : "Go live") + "</button>" : "";
    return bar + '<section class="card ready-card' + (failing.length ? "" : " all-ok") + '"><details' + (open ? " open" : "") + '><summary class="card-head ready-head"><div><h2 class="card-title">Launch readiness</h2><p class="card-sub">' +
      esc(n(r.passed)) + " of " + esc(n(r.total)) + " checks pass" + (failing.length ? " · " + esc(n(failing.length)) + " required still open" : " · ready for paid traffic") + '</p></div><div class="ready-meter" role="img" aria-label="' + esc(r.passed + " of " + r.total) + '"><span' + w((r.passed / r.total) * 100) + "></span></div></summary>" +
      '<div class="card-body flush"><ul class="ready-list">' + r.checks.slice().sort((a, b) => (a.ok - b.ok) || (b.required - a.required)).map(row).join("") + "</ul></div>" +
      '<div class="card-foot row between wrap"><span class="small faint">Go live skips emails that queued up during testing (due more than an hour ago), so the first real lead does not set off a burst.</span><span class="row">' + live + goBtn + "</span></div></details></section>";
  }

  function testDataCard(t) {
    if (!t) return "";
    const reasons = { email: "test email address", query: "?test=1 link", admin_browser: "an admin's browser", internal_ip: "internal network", manual: "marked by hand" };
    return '<section class="card" id="test-data-card"><div class="card-head"><div><h2 class="card-title">Test data</h2><p class="card-sub">Leave out of every report, Today, the pipeline, calibration, no-show risk and alerts. Test leads get no emails or calls. Turn on "Include test data" in the filter bar to see them.</p></div>' +
      '<div class="card-actions">' + (isManager() ? '<button class="btn btn-sm" type="button" data-action="test-sweep">Re-scan</button>' : "") + (S.me && S.me.role === "owner" && t.test_leads ? '<button class="btn btn-sm btn-danger" type="button" data-action="test-purge">Purge ' + esc(n(t.test_leads)) + " test lead" + (t.test_leads === 1 ? "" : "s") + "</button>" : "") + "</div></div>" +
      '<div class="card-body"><dl class="kv"><dt>Test leads</dt><dd class="tnum">' + esc(n(t.test_leads)) + (t.by_reason.length ? ' <span class="faint">· ' + esc(t.by_reason.map((r) => n(r.n) + " " + (reasons[r.reason] || human(r.reason))).join(", ")) + "</span>" : "") + "</dd>" +
      '<dt>Our browsers</dt><dd class="tnum">' + esc(n(t.test_visitors)) + ' <span class="faint">admins, ?test=1, internal IPs</span></dd>' +
      "<dt>This network</dt><dd>" + (t.my_ip_internal ? badge("Internal", "b-green") : isManager() && t.my_ip_hash ? '<button class="btn btn-sm" type="button" data-action="test-add-ip">Mark this network as internal</button>' : '<span class="faint">Not marked</span>') + (t.my_ip_hash ? ' <code class="mono faint small">' + esc(t.my_ip_hash.slice(0, 12)) + "…</code>" : "") + "</dd></dl>" +
      '<p class="small faint mt8">Automatic: emails at example.com/.org/.net or with +test@, a first visit with ?test=1, a browser that has opened Funnel HQ, and visits from internal networks. Mark a single lead from its drawer.</p></div></section>';
  }
  // ── Funnel map ─────────────────────────────────────────────────────────────
  TAB.map.load = async () => null;
  TAB.map.render = () => '<div id="fm-host"></div>';
  TAB.map.after = (root) => {
    const host = $("#fm-host", root);
    if (!window.FunnelMap) { host.innerHTML = empty("Map not loaded", "The funnel map script did not load. Reload the page."); return; }
    window.FunnelMap.mount(host, {
      get: (p) => api(p),
      put: (p, b) => api(p, { method: "PUT", body: b }),
      stats: () => api("/funnel-map-stats", { query: qs() }),
      openTab: (id) => { location.hash = id; },
      toast, fail, esc,
      fmt: { n, pc, money: moneyShort },
    });
  };

  // ── Traffic ────────────────────────────────────────────────────────────────
  TAB.traffic.load = () => (S.trafficView === "spend"
    ? api("/spend", { query: qs({ level: S.spendLevel }) }).then((d) => Object.assign(d, { _view: "spend" }))
    : api("/traffic", { query: qs({ dim: S.trafficDim }) }));
  TAB.traffic.render = (d) => {
    const seg = '<div class="row between wrap"><div class="seg" role="group" aria-label="View">' +
      [["sources", "Visitors by source"], ["spend", "Spend, CAC & ROAS"]].map((v) => '<button type="button" data-action="traffic-view" data-view="' + v[0] + '" aria-pressed="' + (S.trafficView === v[0]) + '">' + v[1] + "</button>").join("") + "</div></div>";
    return seg + (d._view === "spend" ? renderSpend(d) : renderSources(d));
  };

  function renderSpend(d) {
    const t = d.totals || {};
    const LEVELS = { campaign: "Campaign", adset: "Ad set", ad: "Ad" };
    const sync = d.configured
      ? '<span class="faint small">' + (d.last_sync ? "Meta synced " + esc(ago(d.last_sync)) : "Meta not synced yet") + (d.last_error ? ' · <span class="bad-text">' + esc(d.last_error) + "</span>" : "") + "</span>"
      : '<span class="faint small">Connect Meta Ads in Integrations to pull spend hourly.</span>';
    const tiles = kpis([
      kpi("Spend", esc(moneyShort(t.spend)), esc(n(t.impressions)) + " impressions"),
      kpi("Cost per lead", esc(moneyShort(t.cpl)), esc(n(t.leads)) + " leads from ads"),
      kpi("Cost per booked call", esc(moneyShort(t.cost_per_booked)), esc(n(t.booked)) + " booked"),
      kpi("CAC", esc(moneyShort(t.cac)), esc(n(t.won)) + " won from ads"),
      kpi("Cash ROAS", esc(roas(t.cash_roas)), esc(moneyShort(t.cash)) + " cash collected"),
      kpi("Revenue ROAS", esc(roas(t.revenue_roas)), esc(moneyShort(t.revenue)) + " deal value"),
    ], "k6");
    const cost = (v) => (isNum(v) ? esc(moneyShort(v)) : '<span class="faint">—</span>');
    const tbl = table([
      { label: LEVELS[d.level], cls: "wrap", get: (r) => '<span class="t-name">' + esc(r.name) + "</span>" + '<span class="sub">' + esc([r.platform, r.parent].filter(Boolean).join(" · ")) + "</span>" + (r.zero_sessions ? " " + badge("Spend, no visits", "b-red") : "") },
      { label: "Spend", num: true, get: (r) => esc(money(r.spend)) },
      { label: "CTR", num: true, get: (r) => esc(pc(r.ctr)) },
      { label: "Sessions", num: true, get: (r) => esc(n(r.sessions)) },
      { label: "Leads", num: true, get: (r) => esc(n(r.leads)) },
      { label: "CPL", num: true, get: (r) => cost(r.cpl) },
      { label: "Applied", num: true, get: (r) => esc(n(r.applied)) },
      { label: "Per app.", num: true, get: (r) => cost(r.cost_per_app) },
      { label: "Qualified", num: true, get: (r) => esc(n(r.qualified)) },
      { label: "Per qual.", num: true, get: (r) => cost(r.cost_per_qualified) },
      { label: "Booked", num: true, get: (r) => esc(n(r.booked)) },
      { label: "Per booked", num: true, get: (r) => cost(r.cost_per_booked) },
      { label: "Showed", num: true, get: (r) => esc(n(r.showed)) },
      { label: "Per show", num: true, get: (r) => cost(r.cost_per_show) },
      { label: "Won", num: true, get: (r) => esc(n(r.won)) },
      { label: "CAC", num: true, get: (r) => cost(r.cac) },
      { label: "Cash ROAS", num: true, get: (r) => esc(roas(r.cash_roas)) },
      { label: "Rev. ROAS", num: true, get: (r) => esc(roas(r.revenue_roas)) },
    ], d.rows, {
      tall: true,
      empty: empty("No spend in this period", d.configured ? "Spend appears after the next hourly sync, or press Sync now." : "Connect Meta Ads in Integrations, or import a CSV below for other platforms."),
    });
    const main = card({
      title: "By " + LEVELS[d.level].toLowerCase(),
      sub: "Leads are credited to the ad they first arrived from (ad_id in the URL). Counts are things that happened in the period.",
      actions: '<div class="seg" role="group" aria-label="Level">' + d.levels.map((l) => '<button type="button" data-action="spend-level" data-level="' + esc(l) + '" aria-pressed="' + (d.level === l) + '">' + esc(LEVELS[l]) + "</button>").join("") + "</div>" +
        (d.configured ? '<button class="btn btn-sm" type="button" data-action="spend-sync">Sync now</button>' : ""),
      body: tbl, flush: true, foot: sync,
    });
    const zero = d.zero_session_ads.length ? card({
      title: "Ads spending with no visits", sub: "These ads spent money but no session arrived with their ad id. Check the URL parameters (ad_id={{ad.id}}) and the landing page.", flush: true,
      body: table([
        { label: "Ad", cls: "wrap", get: (r) => '<span class="t-name">' + esc(r.name) + '</span><span class="sub mono">' + esc(r.ad_id) + "</span>" },
        { label: "Platform", get: (r) => esc(r.platform) },
        { label: "Spend", num: true, get: (r) => esc(money(r.spend)) },
      ], d.zero_session_ads),
    }) : "";
    const imp = card({
      title: "Import spend for other platforms", sub: "CSV with date, spend and an ad_id or campaign column (impressions, clicks, ad set and names optional). Re-importing a day replaces it.",
      body: '<form data-submit="spend-import" class="form-grid g3"><label class="field"><span class="field-label">Platform</span><input class="input" name="platform" value="google" maxlength="30" required></label>' +
        '<label class="field span2"><span class="field-label">CSV file</span><input class="input" type="file" name="file" accept=".csv,text/csv" required></label>' +
        '<div class="form-actions span-all"><button class="btn btn-primary" type="submit">Import</button><span class="faint small" id="spend-import-out"></span></div></form>',
    });
    return tiles + main + zero + imp;
  }

  function renderSources(d) {
    const maxV = Math.max(1, ...d.rows.map((r) => r.visitors));
    const t = d.totals || {};
    const dimLabel = (d.dims.find((x) => x.id === d.dim) || {}).label || d.dim;
    const best = d.best;
    const summary = kpis([
      kpi("Visitors", esc(n(t.visitors)), esc(n(t.sessions)) + " sessions", "visitors"),
      kpi("Played the film", esc(n(t.plays)), rate(t.plays, t.visitors) + " of visitors", "plays"),
      kpi("Applications", esc(n(t.applied)), esc(n(t.qualified)) + " qualified · same count as Overview", "applied"),
      kpi("Best " + dimLabel.toLowerCase(), best ? esc(best.key) : '<span class="faint">Too early to call</span>',
        best ? esc(n(best.booked)) + " booked calls · " + esc(moneyShort(best.cash)) + " cash" : "Needs 5+ booked calls from one " + esc(dimLabel.toLowerCase()), "best_source"),
    ]);
    const tbl = table([
      { label: dimLabel, get: (r) => '<div class="cell-bar"><span class="ellipsis" title="' + esc(r.key) + '">' + esc(r.key) + '</span></div><div class="bar-track"><div class="bar-fill"' + w((r.visitors / maxV) * 100) + "></div></div>" },
      { label: "Visitors", num: true, get: (r) => esc(n(r.visitors)) },
      { label: "Engaged", num: true, get: (r) => esc(r.engaged_s ? r.engaged_s + "s" : "—") },
      { label: "Bounce", num: true, get: (r) => rate(r.bounced, r.sessions) },
      { label: "Play rate", num: true, get: (r) => rate(r.plays, r.visitors) },
      { label: "Leads", num: true, get: (r) => esc(n(r.leads)) },
      { label: "Applied", num: true, get: (r) => esc(n(r.applied)) },
      { label: "Apply rate", num: true, get: (r) => rate(r.applied, r.visitors) },
      { label: "Qualified", num: true, get: (r) => esc(n(r.qualified)) },
      { label: "Booked", num: true, get: (r) => esc(n(r.booked)) },
      { label: "Won", num: true, get: (r) => esc(n(r.won)) },
      { label: "Revenue", num: true, get: (r) => esc(moneyShort(r.revenue)) },
      { label: "Cash", num: true, get: (r) => esc(moneyShort(r.cash)) },
    ], d.rows, {
      tall: true,
      foot: ["Total", n(t.visitors), "", "", "", n(t.leads), n(t.applied), "", n(t.qualified), n(t.booked), n(t.won), moneyShort(t.revenue), moneyShort(t.cash)].map(esc),
      empty: empty("No visitors in this period", "Each " + dimLabel.toLowerCase() + " gets a row once people arrive. UTM tags on your ads fill source, campaign, ad and ad set."),
    });
    return summary + card({
      title: "By " + dimLabel.toLowerCase(),
      sub: "Visitors and plays: sessions in the period with that value. Leads, applications, bookings, wins and cash: dated in the period and credited to the lead's first touch, so the totals match Overview.",
      actions: sel("dim", d.dims.map((x) => ({ value: x.id, label: x.label })), d.dim, { change: "traffic-dim", sm: true, label: "Break down by" }),
      body: tbl, flush: true,
    });
  }

  // ── Landing pages & tests ──────────────────────────────────────────────────
  TAB.landers.load = () => api("/landers", { query: qs() });
  TAB.landers.render = (d) => {
    const x = d.experiment;
    const exp = '<section class="card"><div class="card-head"><div><h2 class="card-title">Main page headline test</h2><p class="card-sub">Visitors who saw the main page (not a lander) and applied, by headline. Two-sided two-proportion z-test.</p></div>' +
      (x.significant ? badge("Significant", "b-green") : x.enough_data ? badge("No clear winner", "b-grey") : badge("Collecting data", "b-amber")) + "</div>" +
      '<div class="variants">' + x.variants.map((v) =>
        '<div class="variant"><div class="row">' + badge("Variant " + v.id.toUpperCase(), x.leader === v.id ? "b-blue" : "b-grey") + "</div>" +
        '<div class="variant-h">' + esc(v.headline) + '</div><div class="variant-rate">' + esc(pc(v.rate)) + '</div><div class="faint small">applied · ' + esc(n(v.applications)) + " of " + esc(n(v.visitors)) + " visitors</div>" +
        '<dl class="kv mt16"><dt>Leads</dt><dd class="tnum">' + esc(n(v.leads)) + '</dd><dt>Qualified</dt><dd class="tnum">' + esc(n(v.qualified)) + " · " + esc(pc(v.qualified_rate)) + '</dd><dt>Booked</dt><dd class="tnum">' + esc(n(v.booked)) + "</dd></dl></div>").join("") + "</div>" +
      '<div class="verdict"><span>' + esc(x.note) + "</span><span>z = " + esc(x.z == null ? "—" : x.z) + "</span><span>p = " + esc(x.p == null ? "—" : x.p) + "</span></div></section>";

    const angleRows = d.angles;
    const angles = card({
      title: "By angle", sub: "All 20 industries combined",
      body: table([
        { label: "Angle", get: (r) => '<span class="t-name">' + esc(r.label) + "</span>" },
        { label: "Visitors", num: true, get: (r) => esc(n(r.visitors)) },
        { label: "Leads", num: true, get: (r) => esc(n(r.leads)) },
        { label: "Lead rate", num: true, get: (r) => esc(pc(r.lead_rate)) },
        { label: "Qualified", num: true, get: (r) => esc(n(r.qualified)) },
        { label: "Booked", num: true, get: (r) => esc(n(r.booked)) },
        { label: "Won", num: true, get: (r) => esc(n(r.won)) },
        { label: "Revenue", num: true, get: (r) => esc(moneyShort(r.revenue)) },
      ], angleRows), flush: true,
    });

    const ANG = angleRows.map((a) => a.id);
    const shareBar = (ind) => {
      const rows = d.landers.filter((l) => l.industry === ind);
      return '<div class="stack-bar" title="Bandit traffic share by angle">' + ANG.map((a, i) => {
        const r = rows.find((l) => l.angle === a);
        return '<span class="s' + (i + 1) + '"' + w(r ? r.share : 0) + ' title="' + esc((angleRows[i] || {}).label + " " + (r ? r.share : 0) + "%") + '"></span>';
      }).join("") + "</div>";
    };
    const industries = card({
      title: "Industries",
      sub: "Each industry runs its own bandit across five angles. Every angle gets " + d.bandit.min_visitors + " visitors before it starts favouring winners.",
      body: table([
        { label: "Industry", get: (r) => '<span class="t-name">' + esc(r.label) + '</span><span class="sub">' + (r.explored ? "Optimising" : "Exploring") + (r.leader ? (r.explored ? " · favouring " : " · next up: ") + esc((angleRows.find((a) => a.id === r.leader) || {}).label || r.leader) : "") + "</span>" },
        { label: "Visitors", num: true, get: (r) => esc(n(r.visitors)) },
        { label: "Leads", num: true, get: (r) => esc(n(r.leads)) },
        { label: "Qualified", num: true, get: (r) => esc(n(r.qualified)) },
        { label: "Booked", num: true, get: (r) => esc(n(r.booked)) },
        { label: "Won", num: true, get: (r) => esc(n(r.won)) },
        { label: "Revenue", num: true, get: (r) => esc(moneyShort(r.revenue)) },
        { label: "Traffic share by angle", get: (r) => shareBar(r.id) },
        { label: "Ad URLs", get: (r) => '<div class="row">' + copyBtn(r.ad_urls.lander, "/for/" + r.id) + copyBtn(r.ad_urls.smart, "Smart /m") + "</div>" },
      ], d.industries, { tall: true }),
      flush: true,
      foot: '<div class="legend">' + angleRows.map((a, i) => '<span><span class="swatch sw' + (i + 1) + '"></span>' + esc(a.label) + "</span>").join("") + "</div>",
    });

    const filtered = S.landerIndustry ? d.landers.filter((l) => l.industry === S.landerIndustry) : d.landers;
    const all100 = card({
      title: "All landers",
      sub: filtered.length + " pages · preview opens the page without counting a visit",
      actions: sel("industry", [{ value: "", label: "All industries" }].concat(d.industries.map((i) => ({ value: i.id, label: i.label }))), S.landerIndustry, { change: "lander-industry", sm: true, label: "Industry" }),
      body: table([
        { label: "Lander", cls: "wrap", get: (r) => '<span class="t-name">' + esc(r.headline) + '</span><span class="sub mono">/for/' + esc(r.key) + "</span>" },
        { label: "Angle", cls: "nowrap", get: (r) => esc(r.angle_label) },
        { label: "Visitors", num: true, get: (r) => esc(n(r.visitors)) },
        { label: "Plays", num: true, get: (r) => esc(n(r.plays)) },
        { label: "Leads", num: true, get: (r) => esc(n(r.leads)) },
        { label: "Qualified", num: true, get: (r) => esc(n(r.qualified)) },
        { label: "A tier", num: true, get: (r) => esc(n(r.a_tier)) },
        { label: "Booked", num: true, get: (r) => esc(n(r.booked)) },
        { label: "Won", num: true, get: (r) => esc(n(r.won)) },
        { label: "Revenue", num: true, get: (r) => esc(moneyShort(r.revenue)) },
        { label: "Cash", num: true, get: (r) => esc(moneyShort(r.cash)) },
        { label: "Share", num: true, get: (r) => esc(pc(r.share)) },
        { label: "", get: (r) => '<a class="btn btn-sm" href="' + esc(r.preview_url) + '" target="_blank" rel="noopener noreferrer">Preview</a>' },
      ], filtered, { tall: true }),
      flush: true,
    });
    return exp + angles + industries + all100;
  };

  // ── Links & videos ─────────────────────────────────────────────────────────
  TAB.links.load = () => api("/links", { query: qs() });
  TAB.links.render = (d) => {
    const active = d.links.filter((l) => !l.archived), archived = d.links.filter((l) => l.archived);
    const form = card({
      title: "New tracked link", sub: "Short links like /l/yt-oct-film send people to a page on your site with the right UTM tags.",
      body: '<form data-submit="create-link" class="form-grid g3">' +
        '<label class="field"><span class="field-label">Code</span><input class="input" name="code" required pattern="[a-z0-9][a-z0-9-]{1,39}" placeholder="yt-oct-film" autocomplete="off"></label>' +
        '<label class="field"><span class="field-label">Label</span><input class="input" name="label" placeholder="October film, description link" maxlength="80"></label>' +
        '<label class="field"><span class="field-label">Kind</span>' + sel("kind", d.kinds.map((k) => ({ value: k, label: human(k) })), "youtube") + "</label>" +
        '<label class="field"><span class="field-label">Destination</span><input class="input" name="dest_path" value="/" placeholder="/ or /for/dental" maxlength="200"></label>' +
        '<label class="field"><span class="field-label">Video title (optional)</span><input class="input" name="video_title" maxlength="120"></label>' +
        '<label class="field"><span class="field-label">Placement (optional)</span><input class="input" name="placement" placeholder="description, pinned comment" maxlength="40"></label>' +
        '<label class="field"><span class="field-label">Campaign (optional)</span><input class="input" name="utm_campaign" maxlength="100"></label>' +
        '<div class="field span2"><span class="field-label">&nbsp;</span><div class="row"><button class="btn btn-primary" type="submit">Create link</button><span class="faint small">Codes use lowercase letters, numbers and dashes.</span></div></div>' +
        "</form>",
    });
    const cols = (arch) => [
      { label: "Link", cls: "wrap", get: (r) => '<span class="t-name">' + esc(r.label) + '</span><span class="sub">' + esc(human(r.kind)) + (r.placement ? " · " + esc(r.placement) : "") + (r.video_title ? " · " + esc(r.video_title) : "") + "</span>" },
      { label: "URL", get: (r) => '<div class="copy-row"><code>/l/' + esc(r.code) + "</code>" + copyBtn(d.origin + "/l/" + r.code, "Copy") + "</div>" },
      { label: "Goes to", get: (r) => '<code class="mono faint">' + esc(r.dest_path) + "</code>" },
      { label: "Clicks", num: true, get: (r) => esc(n(r.clicks)) },
      { label: "Visitors", num: true, get: (r) => esc(n(r.visitors)) },
      { label: "Leads", num: true, get: (r) => esc(n(r.leads)) },
      { label: "Booked", num: true, get: (r) => esc(n(r.booked)) },
      { label: "Won", num: true, get: (r) => esc(n(r.won)) },
      { label: "Revenue", num: true, get: (r) => esc(moneyShort(r.revenue)) },
      { label: "", get: (r) => '<button class="btn btn-sm btn-ghost" type="button" data-action="archive-link" data-code="' + esc(r.code) + '" data-archived="' + (arch ? "0" : "1") + '">' + (arch ? "Restore" : "Archive") + "</button>" },
    ];
    return form + card({
      title: "Links", sub: "Clicks are all-time; visitors and outcomes follow the selected period.", flush: true,
      body: table(cols(false), active, { empty: empty("No tracked links yet", "Create one above and paste it into a YouTube description, a podcast show note or your bio. Every visit, lead and sale is credited to it.") }),
    }) + (archived.length ? card({ title: "Archived", flush: true, body: table(cols(true), archived) }) : "");
  };

  // ── VSL ────────────────────────────────────────────────────────────────────
  TAB.vsl.load = () => api("/vsl", { query: qs({ video: S.video }) });
  TAB.vsl.render = (d) => {
    const k = d.kpis;
    const head = '<div class="row between wrap"><div class="seg" role="group" aria-label="Video">' + d.videos.map((v) => '<button type="button" data-action="video" data-video="' + esc(v.id) + '" aria-pressed="' + (v.id === d.video) + '">' + esc(v.title) + "</button>").join("") + '</div><span class="faint small">' + esc(clock(d.duration)) + " long" + (d.cta_reveal_at ? " · pitch at " + esc(clock(d.cta_reveal_at)) : "") + "</span></div>";
    const tiles = kpis([
      kpi("Plays", esc(n(k.plays)), esc(n(k.viewers)) + " unmuted · " + rate(k.viewers, k.plays)),
      kpi("Average watched", k.viewers && k.viewers < SMALL_N() ? '<span class="small-n">' + esc(pc(k.avg_watched_pct)) + '<span class="n-tag">n=' + esc(k.viewers) + "</span></span>" : esc(pc(k.avg_watched_pct)), "Of the film, per viewer"),
      kpi("Reached the pitch", rateValue(k.pitch, k.plays), esc(n(k.pitch)) + " people", "pitch_rate"),
      kpi("Finished", rateValue(k.completed, k.viewers), esc(n(k.completed)) + " people"),
      kpi("Clicked apply", rateValue(k.cta_clicks, k.pitch), esc(n(k.cta_clicks)) + " of those who saw the button"),
      kpi("Became leads", esc(n(k.became_leads)), "Viewers who left details"),
    ], "k6");
    const N = d.retention.length;
    const markers = d.chapters.slice(1).map((ch) => ({ i: Math.round((ch.at / d.duration) * (N - 1)), label: "" }));
    if (d.cta_reveal_at) markers.push({ i: Math.round((d.cta_reveal_at / d.duration) * (N - 1)), label: "Pitch", accent: true });
    const labels = d.retention.map((_, i) => (i / (N - 1)) * d.duration);
    const ret = card({
      title: "Retention", sub: "Share of unmuted viewers who watched each moment. Dashed lines mark chapters.",
      body: k.viewers ? chart({ type: "area", labels, values: d.retention, xFmt: clock, tipX: (s) => clock(s) + " · " + ((d.chapters.slice().reverse().find((c) => c.at <= s) || {}).label || ""), fmt: pc, yFmt: (v) => Math.round(v) + "%", yMax: 100, markers, height: 260, label: "Retention curve" })
        : empty("No viewers in this period", "The curve appears once people unmute the film. Plays without sound are counted but not charted."),
      foot: d.biggest_drop && k.viewers ? "Steepest drop at " + esc(clock(d.biggest_drop.at)) + " (−" + esc(n1(d.biggest_drop.drop)) + " pts). Look at what is on screen there." : "",
    });
    const chapters = card({
      title: "Chapters", flush: true,
      body: table([
        { label: "Chapter", get: (r) => '<span class="t-name">' + esc(r.label) + "</span>" },
        { label: "Starts", num: true, get: (r) => esc(clock(r.at)) },
        { label: "Watching at start", num: true, get: (r) => esc(pc(r.start_retention)) },
        { label: "At end", num: true, get: (r) => esc(pc(r.end_retention)) },
        { label: "Lost in chapter", num: true, get: (r) => esc(isNum(r.start_retention) ? n1(Math.max(0, r.start_retention - r.end_retention)) + " pts" : "—") },
      ], d.chapters),
    });
    const dist = card({
      title: "How much each viewer watched", sub: "Viewers by share of the film watched",
      body: k.viewers ? chart({ type: "columns", labels: d.watched_distribution.map((b) => b.from + "%"), values: d.watched_distribution.map((b) => b.viewers), tipLabel: (i) => d.watched_distribution[i].from + "–" + d.watched_distribution[i].to + "% watched", unit: "viewers", height: 200 }) : empty("No viewers yet", "Fills in with the first unmuted plays.", true),
    });
    const ms = card({ title: "Milestones", sub: "Unmuted viewers who passed each mark", body: bars(d.milestones.map((m) => ({ label: m.pct + "% watched", value: m.viewers, extra: pc(k.viewers ? (m.viewers / k.viewers) * 100 : null) }))) });
    return head + tiles + ret + '<div class="grid g2">' + chapters + '<div class="stack gap16">' + dist + ms + "</div></div>";
  };

  // ── On-page behaviour ──────────────────────────────────────────────────────
  TAB.behaviour.load = () => api("/behaviour", { query: qs() });
  TAB.behaviour.render = (d) => {
    const s = d.summary || {};
    const v = (k) => (s[k] ? s[k].n : 0);
    const tiles = kpis([
      kpi("FAQ opens", esc(n(v("faq_open"))), esc(n(s.faq_open ? s.faq_open.visitors : 0)) + " people"),
      kpi("Re-reads", esc(n(v("section_revisit"))), "Scrolled back to a section"),
      kpi("Highlights", esc(n(v("text_select"))), esc(n(v("text_copy"))) + " copies"),
      kpi("Came back to the tab", esc(n(v("tab_return"))), "After switching away"),
      kpi("Moved to leave", esc(n(v("exit_intent"))), "Cursor left toward the tab bar"),
      kpi("Rage clicks", esc(n(v("rage_click"))), "Fast repeated clicks"),
    ], "k6");
    const clicks = card({
      title: "Top click targets", flush: true,
      body: table([
        { label: "Target", get: (r) => '<span class="t-name">' + esc(r.target) + "</span>" },
        { label: "Page", get: (r) => '<code class="mono faint">' + esc(r.path) + "</code>" },
        { label: "Clicks", num: true, get: (r) => esc(n(r.n)) },
        { label: "People", num: true, get: (r) => esc(n(r.visitors)) },
      ], d.clicks, { mid: true, empty: empty("No clicks recorded", "Buttons and links people click on your pages show up here, most-clicked first.", true) }),
    });
    const fields = card({
      title: "Form friction", sub: "Per application field. Counters only; what people type is never collected.", flush: true,
      body: table([
        { label: "Field", cls: "wrap", get: (r) => '<span class="t-name">' + esc(r.label) + '</span><span class="sub mono">' + esc(r.field) + "</span>" },
        { label: "Uses", num: true, get: (r) => esc(n(r.interactions)) },
        { label: "Avg time", num: true, get: (r) => esc(n1(r.avg_seconds) + "s") },
        { label: "Corrections", num: true, get: (r) => esc(n1(r.avg_corrections)) },
        { label: "Pasted", num: true, get: (r) => esc(n(r.pasted)) },
        { label: "Left empty", num: true, get: (r) => esc(n(r.left_empty)) + ' <span class="faint">' + esc(pc(r.empty_rate)) + "</span>" },
      ], d.fields, { mid: true, empty: empty("No form data yet", "Once people use the application, each field shows time spent, corrections, pastes and how often it is left empty.", true) }),
    });
    const exits = card({ title: "Exits by section", sub: "Where people were when they left the page", body: bars(d.exits.map((r) => ({ label: label(r.section), value: r.n, extra: pc(r.pct) })), { color: "c2", emptyBody: "Each page exit is credited to the section on screen at the time." }) });
    const rereads = card({ title: "Re-reads", sub: "Sections people scrolled back up to", body: bars(d.revisits.map((r) => ({ label: label(r.section), value: r.n, extra: n(r.visitors) + " people" })), { emptyBody: "Sections people return to are often where the doubt is." }) });
    const dwell = card({ title: "Time on section", sub: "Average seconds while the section was on screen", body: bars(d.dwell.map((r) => ({ label: label(r.section), value: r.avg_seconds, display: n1(r.avg_seconds) + "s" })), { color: "c3", emptyBody: "Fills in as people scroll through your pages." }) });
    const hl = card({
      title: "Highlights and copies", sub: "Counted by section. The text itself is never shown here.", flush: true,
      body: table([
        { label: "Section", get: (r) => '<span class="t-name">' + esc(label(r.section)) + "</span>" },
        { label: "Highlights", num: true, get: (r) => esc(n(r.selects)) },
        { label: "Copies", num: true, get: (r) => esc(n(r.copies)) },
      ], d.highlights, { empty: empty("Nothing highlighted yet", "When people select or copy text, the section gets a count.", true) }),
    });
    const faqs = card({ title: "FAQ opens", sub: "Which questions people open on the page", body: bars(d.faqs.map((f) => ({ label: f.question, value: f.opens, extra: n(f.visitors) + " people" })), { color: "c5" }) });
    const rage = d.rage_clicks.length ? card({ title: "Rage clicks", sub: "Something looked clickable and wasn't, or was slow", body: bars(d.rage_clicks.map((r) => ({ label: r.target, value: r.n })), { color: "c2" }) }) : "";
    return tiles + '<div class="grid g2">' + clicks + fields + exits + rereads + dwell + hl + "</div>" + faqs + rage;
  };

  // ── Application ────────────────────────────────────────────────────────────
  TAB.application.load = () => api("/application", { query: qs() });
  TAB.application.render = (d) => {
    const k = d.kpis;
    const secs = k.median_seconds;
    const medTime = secs == null ? esc("—") : secs < 1 ? esc("<1") + '<span class="unit">s</span>' : secs < 60 ? esc(n(secs)) + '<span class="unit">s</span>' : esc(n1(secs / 60)) + '<span class="unit">min</span>';
    const tiles = kpis([
      kpi("Saw the form", esc(n(k.saw_form != null ? k.saw_form : k.apply_starts)), "Form in view or /apply", "saw_form"),
      kpi("Left contact details", esc(n(k.contacts)), rate(k.contacts, k.saw_form != null ? k.saw_form : k.apply_starts) + " of people who saw the form", "contact_rate"),
      kpi("Completed", esc(n(k.completed)), rate(k.completed, k.contacts) + " of contacts", "completion_rate"),
      kpi("Median time", medTime, "First step to submit", "median_time"),
      kpi("Average score", esc(n(k.avg_score)), "Out of 100", "avg_score"),
      kpi("Qualified", esc(n(d.tiers.A + d.tiers.B)), "A " + esc(n(d.tiers.A)) + " · B " + esc(n(d.tiers.B)) + " · C " + esc(n(d.tiers.C))),
    ], "k6");
    const maxR = Math.max(1, ...d.steps.map((s) => s.reached));
    const steps = card({
      title: "Drop-off by question", sub: "People who reached each question, and how many of the previous question's people that is.",
      body: '<div class="funnel"><div class="funnel-row funnel-head"><span>Question</span><span></span><span class="f-n">Reached</span><span class="f-rate">Kept</span></div>' + d.steps.map((s, i) =>
        '<div class="funnel-row"><span class="f-label ellipsis" title="' + esc(s.title) + '">' + esc(s.step + ". " + label(s.id)) + '</span><div class="f-bar"><div class="f-fill"' + w((s.reached / maxR) * 100) + '></div></div><span class="f-n">' + esc(n(s.reached)) + '</span><span class="f-rate">' + (i ? esc(pc(s.kept)) : '<span class="faint">—</span>') + "</span></div>").join("") + "</div>",
      foot: d.steps.some((s) => s.backs) ? "Went back to change an answer: " + d.steps.filter((s) => s.backs).map((s) => esc(human(s.id)) + " " + esc(n(s.backs))).join(" · ") : "",
    });
    const opt = (d.optional || []).length ? card({
      title: "After submitting (optional)", sub: "Questions asked once the application is in. Not part of the drop-off: skipping them loses nothing.", flush: true,
      body: table([
        { label: "Question", cls: "wrap", get: (r) => '<span class="t-name">' + esc(label(r.id)) + '</span><span class="sub">' + esc(r.title) + "</span>" },
        { label: "Answered", num: true, get: (r) => esc(n(r.answered)) + ' <span class="faint">of ' + esc(n(r.finished)) + "</span>" },
        { label: "Rate", num: true, get: (r) => rate(r.answered, r.finished) },
      ], d.optional),
    }) : "";
    const hist = card({
      title: "Scores", sub: "Completed applications by score. A from 70, B from 40.",
      body: k.completed ? chart({ type: "columns", labels: d.score_histogram.map((b) => String(b.from)), values: d.score_histogram.map((b) => b.n), tipLabel: (i) => "Score " + d.score_histogram[i].from + "–" + d.score_histogram[i].to, unit: "applications", height: 200 }) : empty("No completed applications", "Scores appear once applications are submitted.", true),
    });
    const flags = card({ title: "Flags", sub: "Signals that capped a tier or need a closer's eye", body: bars(d.flags.map((f) => ({ label: f.label || label(f.flag), value: f.n, extra: pc(k.completed ? (f.n / k.completed) * 100 : null) })), { color: "c4", emptyBody: "Flags like under $1M, not the owner or personal email show here." }) });
    const qs2 = d.questions.map((q) => card({ title: q.title, sub: n(q.answered) + " answered" + (q.type === "multi" ? " · pick any" : ""), body: bars(q.options.map((o) => ({ label: o.label, value: o.n, extra: pc(o.pct) })), { emptyBody: "Answers appear with the first completed application." }) }));
    const text = d.text.length ? card({ title: "Written answers", flush: true, body: table([
      { label: "Question", cls: "wrap", get: (r) => esc(r.title) },
      { label: "Answered", num: true, get: (r) => esc(n(r.answered)) },
      { label: "Avg length", num: true, get: (r) => esc(n(r.avg_length)) + " chars" },
    ], d.text) }) : "";
    return tiles + '<div class="grid g-2-1">' + '<div class="stack gap16">' + steps + opt + "</div>" + '<div class="stack gap16">' + hist + flags + "</div></div>" + '<h2 class="section-title">Answers</h2><div class="grid g3">' + qs2.join("") + "</div>" + text;
  };

  // ── Sales team ─────────────────────────────────────────────────────────────
  TAB.sales.load = () => api("/sales", { query: qs() });
  const callCols = () => [
    { label: "Lead", get: (r) => leadLink(r.id, r.name) + '<span class="sub mono">' + esc(r.ref_code) + "</span>" },
    { label: "Tier", get: (r) => tierBadge(r.tier) },
    { label: "Call", get: (r) => esc(dt(r.call_at)) + '<span class="sub">' + esc(ago(r.call_at)) + "</span>" },
    { label: "Closer", get: (r) => esc(r.closer || "Unassigned") },
    { label: "Status", get: (r) => statusBadge(r.status) + (r.booking_source === "calendly-direct" ? ' <span class="badge plain b-grey">Direct</span>' : "") },
    { label: "Value", num: true, get: (r) => (r.revenue ? esc(money(r.revenue)) : '<span class="faint">—</span>') },
  ];
  TAB.sales.render = (d) => {
    if (d.linked === false) return unlinkedCallout();
    const k = d.kpis, tk = d.team_kpi || {};
    const tiles = kpis([
      kpi("Show rate", rateValue(k.showed, k.showed + k.no_show), esc(n(k.showed)) + " held · " + esc(n(k.no_show)) + " no-show", "show_rate"),
      kpi("Offer %", rateValue(tk.offers, tk.reviewed), esc(n(tk.offers)) + " offers on " + esc(n(tk.reviewed)) + " reviewed calls", "offer_rate"),
      kpi("Close % of offers", rateValue(tk.won_of_offers, tk.offers), esc(n(tk.won_of_offers)) + " won", "close_of_offers"),
      kpi("Close rate", rateValue(k.won, k.showed), "Won ÷ calls held · avg deal " + esc(moneyShort(k.avg_deal)), "close_rate"),
      kpi("Cash on call", esc(moneyShort(tk.cash_on_call)), "Paid within 24 h of the call", "cash_on_call"),
      kpi("$ per call held", esc(moneyShort(tk.per_call_held)), esc(moneyShort(k.cash)) + " collected in the period", "per_call_held"),
    ], "k6");
    const needs = card({
      title: "Needs an outcome", sub: "Calls in the last 30 days that still say booked. Logging the outcome starts the right follow-up.", flush: true,
      body: table(callCols().slice(0, 4).concat([{ label: "", get: (r) => (canWrite() ? '<div class="row"><button class="btn btn-sm" type="button" data-action="held-open" data-id="' + esc(r.id) + '" data-name="' + esc(r.name) + '">Showed…</button><button class="btn btn-sm" type="button" data-action="quick-outcome" data-id="' + esc(r.id) + '" data-status="no_show">No-show</button><a class="btn btn-sm btn-ghost" href="#lead=' + encodeURIComponent(r.id) + '">Won or lost…</a></div>' : "") }]), d.needs_outcome, {
        empty: empty("All caught up", "Every call that has happened has an outcome. Calls show up here 30 minutes after their start time."),
      }),
    });
    const K = (r) => r.kpi || {};
    const reps = card({
      title: "Scoreboard", sub: "By closer, for calls dated in the period. Offer and QA come from the review in the Showed form. Cash counts payments recorded in the period.", flush: true,
      body: table([
        { label: "Rep", cls: "nowrap", get: (r) => '<span class="t-name">' + esc(r.name) + '</span><span class="sub">' + esc(label(r.role)) + (r.upcoming ? " · " + esc(n(r.upcoming)) + " upcoming" : "") + "</span>" },
        { label: "Calls", num: true, get: (r) => esc(n(r.calls)) },
        { label: "Held", num: true, get: (r) => esc(n(K(r).held != null ? K(r).held : r.showed)) },
        { label: "Show rate", num: true, get: (r) => rate(r.showed, r.showed + r.no_show) },
        { label: "Offer %", num: true, get: (r) => rate(K(r).offers, K(r).reviewed) },
        { label: "Close % of offers", num: true, get: (r) => rate(K(r).won_of_offers, K(r).offers) },
        { label: "Won", num: true, get: (r) => esc(n(r.won)) },
        { label: "Cash on call", num: true, get: (r) => esc(moneyShort(K(r).cash_on_call || 0)) },
        { label: "Cycle", num: true, get: (r) => (isNum(K(r).cycle_days) ? esc(n1(K(r).cycle_days)) + " d" + (K(r).cycle_n < 5 ? '<span class="sub">n=' + esc(K(r).cycle_n) + "</span>" : "") : '<span class="faint">—</span>') },
        { label: "$ per call held", num: true, get: (r) => esc(moneyShort(K(r).per_call_held)) },
        { label: "QA", num: true, get: (r) => (isNum(K(r).qa_avg) ? esc(n1(K(r).qa_avg)) + '<span class="faint">/5</span>' : '<span class="faint">—</span>') },
        { label: "Cash", num: true, get: (r) => esc(moneyShort(r.cash)) },
        { label: "Commission", num: true, get: (r) => esc(r.commission ? money(r.commission) : "—") },
        { label: "Target", get: (r) => (r.target ? '<div class="cell-bar"><div class="bar-track"><div class="bar-fill c3"' + w(r.target_pct || 0) + '></div></div><span class="faint small tnum">' + esc(pc(r.target_pct)) + "</span></div>" : '<span class="faint">—</span>') },
      ], d.reps, { empty: empty("No reps yet", "Add closers and setters on the Team tab. Until then, calls go to the founder.") }),
    });
    const ob = d.objections || { weeks: [], series: [] };
    const objections = card({
      title: "Objections by week", sub: "Objections logged on held deals that are still open (by call week) and on lost deals (by close week, with the lost reason when no objection was logged). Last 8 weeks.",
      body: ob.total ? chart({ type: "stacked", labels: ob.weeks.map((x) => "w/c " + dayKeyLabel(x)), series: ob.series.map((s) => ({ label: s.objection, values: s.counts })), height: 220, label: "Objections by week" }) +
        '<div class="legend mt8">' + ob.series.map((s, i) => '<span><span class="swatch sw' + (i + 1) + '"></span>' + esc(s.objection) + ' <span class="faint">' + esc(n(s.total)) + "</span></span>").join("") + (ob.other ? '<span class="faint">+' + esc(n(ob.other)) + " other</span>" : "") + "</div>"
        : empty("No objections logged yet", "Pick an objection in the Showed form or on the lead's Pipeline tab; lost reasons count too.", true),
    });
    const log = card({ title: "Call log", sub: "Calls in the period and the next 14 days", flush: true, body: table(callCols(), d.call_log, { tall: true, rowAction: (r) => ({ action: "open-lead", id: r.id }), empty: empty("No calls in this period", "Booked calls appear here with their outcome.") }) });
    const ur = d.upcoming_risk || { rows: [], labels: {}, model: {} };
    const riskBadge = (v) => (isNum(v) ? badge(Math.round(v * 100) + "%", v > ur.model.threshold ? "b-red" : v > 0.25 ? "b-amber" : "b-green") : '<span class="faint">Not scored</span>');
    const risk = card({
      title: "Upcoming calls by no-show risk",
      sub: "Booked calls in the next 72 hours. " + (ur.model.fitted ? "Fitted on " + n(ur.model.n) + " past calls." : "Rules-based until " + n(ur.model.min_outcomes) + " past calls have an outcome.") + " Above " + Math.round((ur.model.threshold || 0.4) * 100) + "% the team gets a ping with the reasons.",
      actions: '<button class="btn btn-sm" type="button" data-action="noshow-score">Rescore now</button>', flush: true,
      body: table([
        { label: "Lead", get: (r) => leadLink(r.id, r.name) + '<span class="sub mono">' + esc(r.ref_code) + "</span>" },
        { label: "Tier", get: (r) => tierBadge(r.tier) },
        { label: "Call", get: (r) => esc(dt(r.call_at)) + '<span class="sub">' + esc(ago(r.call_at)) + "</span>" },
        { label: "Closer", get: (r) => esc(r.closer || "Unassigned") },
        { label: "Risk", get: (r) => riskBadge(r.risk) },
        { label: "Why", cls: "wrap", get: (r) => (r.reasons.length ? '<span class="small">' + esc(r.reasons.map((x) => ur.labels[x] || human(x)).join(" · ")) + "</span>" : '<span class="faint">—</span>') },
        { label: "Win prob.", num: true, get: (r) => esc(pp(r.p_win)) },
      ], ur.rows, { mid: true, empty: empty("No calls in the next 72 hours", "Booked calls show here with their risk, scored every hour.", true) }),
    });
    const dueCols = (dateLabel) => [
      { label: "Lead", get: (r) => leadLink(r.id, r.name) + '<span class="sub mono">' + esc(r.ref_code) + "</span>" },
      { label: "Tier", get: (r) => tierBadge(r.tier) },
      { label: dateLabel, get: (r) => esc(day(r.due_at)) + " " + (r.overdue ? badge("Overdue", "b-red") : badge("Due", "b-amber")) },
      { label: "Closer", get: (r) => esc(r.closer || "Unassigned") },
    ];
    const fu = card({
      title: "Follow-ups due", sub: "Follow-up dates set on the Deal tab, due today or overdue. Each closer gets their list at " + "9:00 (sales time).", flush: true,
      body: table(dueCols("Follow up").concat([{ label: "Status", get: (r) => statusBadge(r.status) }]), d.follow_ups || [], { mid: true, empty: empty("No follow-ups due", "Set a follow-up date on a lead's Deal tab and it shows here on the day.", true) }),
    });
    const pay = card({
      title: "Payments due / overdue", sub: "Instalments due within 7 days or overdue. Closers get theirs in the morning ping.", flush: true,
      body: dueTable(d.payments_due || []),
    });
    return (d.scoped ? "" : tiles) + needs + risk + '<div class="grid g2">' + fu + pay + "</div>" + activityCard(d.activity) + reps + objections + log;
  };
  TAB.sales.actions = () => '<button class="btn" type="button" data-action="digest-send">Send digest now</button>';

  // ── Insights ───────────────────────────────────────────────────────────────
  TAB.insights.load = () => (S.insightsView === "scoring"
    ? api("/calibration").then((d) => Object.assign(d, { _view: "scoring" }))
    : api("/insights", { query: qs() }));
  TAB.insights.render = (d) => {
    const seg = '<div class="row between wrap"><div class="seg" role="group" aria-label="View">' +
      [["booked", "Bookings by tier"], ["scoring", "Scoring calibration"]].map((v) => '<button type="button" data-action="insights-view" data-view="' + v[0] + '" aria-pressed="' + (S.insightsView === v[0]) + '">' + v[1] + "</button>").join("") + "</div></div>";
    return seg + (d._view === "scoring" ? learnedCard(d.learned) + renderCalibration(d) : aiCard(d) + renderBookings(d));
  };

  function aiCard(d) {
    const r = d.ai_report;
    const run = d.ai_enabled ? '<button class="btn btn-sm" type="button" data-action="ai-run">' + (r ? "Run again" : "Run now") + "</button>" : "";
    if (!r) {
      return card({ title: "AI summary", sub: "Every Monday Claude reads the week's numbers and posts a short summary here and to Slack.", actions: run,
        body: empty(d.ai_enabled ? "No weekly summary yet" : "Needs the Anthropic key", d.ai_enabled ? "The first one arrives on Monday, or press Run now." : "Add the Anthropic API key in Integrations to turn on the weekly analyst.", true) });
    }
    const list = (title, items, cls) => (items && items.length ? '<div><div class="ai-h">' + esc(title) + '</div><ul class="ai-list' + (cls ? " " + cls : "") + '">' + items.map((x) => "<li>" + esc(x) + "</li>").join("") + "</ul></div>" : "");
    return card({
      title: "AI summary · " + r.week, sub: "Claude's read of the week, from aggregate numbers only. Written " + dt(r.created_at) + ".", actions: run, cls: "ai-card",
      body: '<p class="ai-headline">' + esc(r.headline) + '</p><p class="muted">' + esc(r.summary) + '</p><div class="grid g3 mt16">' + list("Working", r.wins) + list("Watch", r.concerns) + list("Do this week", r.actions, "act") + "</div>",
    });
  }

  function renderCalibration(d) {
    const m = d.model, rep = d.report;
    const actions = '<button class="btn btn-sm btn-primary" type="button" data-action="calibration-run">Recompute now</button>';
    const tiles = kpis([
      kpi("Outcomes to learn from", esc(n(d.n_terminal)), esc(n(d.n_won)) + " won · needs " + esc(n(d.min_train))),
      kpi("Model AUC", esc(m && isNum(m.auc) ? m.auc.toFixed(2) : "—"), rep ? (rep.auc_kind === "holdout" ? "On " + esc(n(rep.n_test)) + " held-out leads" : "In-sample (too few for a hold-out)") : "0.5 is a coin flip, 1 is perfect"),
      kpi("Brier score", esc(m && isNum(m.brier) ? m.brier.toFixed(3) : "—"), "Lower is better"),
      kpi("Open leads scored", esc(n(d.p_win.n)), "Average win probability " + esc(pp(d.p_win.avg))),
    ]);
    if (!m) {
      return tiles + card({ title: "Scoring calibration", actions, body: empty("Not enough outcomes yet", "The model needs at least " + d.min_train + " completed applications that ended won, lost, no-show or disqualified, with a few of each. It retrains every night.") });
    }
    const newer = d.newer_inactive ? '<div class="callout warn"><span class="callout-dot"></span><div><strong>A newer model is not in use</strong> (AUC ' + esc(isNum(d.newer_inactive.auc) ? d.newer_inactive.auc.toFixed(2) : "—") + ", trained " + esc(dt(d.newer_inactive.created_at)) + '). It scored worse than the active one. <button class="link-btn" type="button" data-action="model-activate" data-id="' + esc(d.newer_inactive.id) + '">Use it anyway</button></div></div>' : "";
    const relRows = (rep && rep.reliability) || [];
    const rel = card({
      title: "Reliability by decile", sub: "Leads sorted by predicted win probability, in ten equal groups. A calibrated model's predicted and actual rates match.", flush: true,
      body: table([
        { label: "Decile", get: (r) => esc(r.bin) },
        { label: "Leads", num: true, get: (r) => esc(n(r.n)) },
        { label: "Predicted", num: true, get: (r) => esc(pp(r.predicted)) },
        { label: "Actual", num: true, get: (r) => esc(pp(r.actual)) },
        { label: "", get: (r) => '<div class="rel"><div class="bar-track"><div class="bar-fill"' + w((r.predicted || 0) * 100) + '></div></div><div class="bar-track"><div class="bar-fill c3"' + w((r.actual || 0) * 100) + "></div></div></div>" },
      ], relRows),
      foot: '<div class="legend"><span><span class="swatch"></span>Predicted</span><span><span class="swatch sw3"></span>Actual</span></div>',
    });
    const tiers = card({
      title: "By tier", sub: "Booked calls in the training window: show rate, close rate and deal value per booked call.", flush: true,
      body: table([
        { label: "Tier", get: (r) => tierBadge(r.tier) },
        { label: "Booked", num: true, get: (r) => esc(n(r.booked)) },
        { label: "Show rate", num: true, get: (r) => esc(pp(r.show_rate)) },
        { label: "Close rate", num: true, get: (r) => esc(pp(r.close_rate)) },
        { label: "$ per booked call", num: true, get: (r) => esc(moneyShort(r.per_booked_call)) },
      ], (rep && rep.tiers) || []),
    });
    const byQ = {};
    for (const o of (rep && rep.options) || []) (byQ[o.question] = byQ[o.question] || []).push(o);
    const optCards = Object.keys(byQ).map((q) => card({
      title: byQ[q][0].title, flush: true,
      body: table([
        { label: "Answer", cls: "wrap", get: (r) => esc(r.label) },
        { label: "n", num: true, get: (r) => esc(n(r.n)) },
        { label: "Win rate", num: true, get: (r) => esc(pp(r.smoothed)) + (r.n < 10 ? ' <span class="faint">few</span>' : "") },
        { label: "Lift", num: true, get: (r) => (isNum(r.lift) ? '<span class="' + (r.lift >= 1.2 ? "good-text" : r.lift <= 0.8 ? "bad-text" : "") + '">' + esc(NF1.format(r.lift)) + "×</span>" : "—") },
        { label: "Points now", num: true, get: (r) => esc(r.points) },
        { label: "Suggested", num: true, get: (r) => '<span class="t-name">' + esc(r.suggested) + "</span>" + (r.suggested !== r.points ? ' <span class="faint">(' + (r.suggested > r.points ? "+" : "−") + esc(Math.abs(r.suggested - r.points)) + ")</span>" : "") },
      ], byQ[q]),
    }));
    const weights = card({
      title: "Strongest signals", sub: "Log-odds weights in the win model (positive raises P(won)).", flush: true,
      body: table([
        { label: "Signal", get: (r) => '<code class="mono">' + esc(r.feature) + "</code>" },
        { label: "Weight", num: true, get: (r) => '<span class="' + (r.weight > 0 ? "good-text" : "bad-text") + '">' + esc((r.weight > 0 ? "+" : "") + r.weight.toFixed(2)) + "</span>" },
      ], d.top_weights),
    });
    const hist = card({
      title: "Models", sub: "Win models (P(won)) and no-show models. The active win model sets each open lead's win probability.", flush: true,
      body: table([
        { label: "Trained", get: (r) => esc(dt(r.created_at)) },
        { label: "Kind", get: (r) => esc(r.kind === "win" ? "Win" : "No-show") },
        { label: "Leads", num: true, get: (r) => esc(n(r.n_train)) },
        { label: "AUC", num: true, get: (r) => esc(isNum(r.auc) ? r.auc.toFixed(3) : "—") },
        { label: "Brier", num: true, get: (r) => esc(isNum(r.brier) ? r.brier.toFixed(3) : "—") },
        { label: "", get: (r) => (r.active ? badge("Active", "b-green") : r.kind === "win" ? '<button class="btn btn-sm btn-ghost" type="button" data-action="model-activate" data-id="' + esc(r.id) + '">Use</button>' : "") },
      ], d.history),
    });
    const note = '<div class="callout info"><span class="callout-dot"></span><div><strong>Suggested points are advice.</strong> Routing still uses the points in <code class="mono">src/config.ts</code>. Copy a suggestion there when its n is large enough; win probabilities and ad values already use the model.</div></div>';
    return tiles + newer + '<div class="row between"><span></span>' + actions + "</div>" + '<div class="grid g2">' + rel + '<div class="stack gap16">' + tiers + weights + "</div></div>" +
      note + '<h2 class="section-title">Answers: current vs suggested points</h2><div class="grid g2">' + optCards.join("") + "</div>" + hist;
  }

  function renderBookings(d) {
    const tiers = card({
      title: "Everyone who booked, by tier", sub: n(d.total) + " people booked in the period, from the funnel and straight through Calendly.", flush: true,
      body: table([
        { label: "Tier", get: (r) => (r.tier === "unscored" ? '<span class="faint">Unscored</span>' : tierBadge(r.tier)) },
        { label: "Booked", num: true, get: (r) => esc(n(r.booked)) },
        { label: "Funnel", num: true, get: (r) => esc(n(r.funnel)) },
        { label: "Direct", num: true, get: (r) => esc(n(r.direct)) },
        { label: "Show rate", num: true, get: (r) => esc(pc(r.show_rate)) },
        { label: "Won", num: true, get: (r) => esc(n(r.won)) },
        { label: "Close rate", num: true, get: (r) => esc(pc(r.close_rate)) },
        { label: "Revenue", num: true, get: (r) => esc(moneyShort(r.revenue)) },
        { label: "Cash", num: true, get: (r) => esc(moneyShort(r.cash)) },
      ], d.tiers.filter((t) => t.booked || t.tier !== "unscored")),
    });
    const a = d.a_tier;
    const tb = (items) => bars(items.map((x) => ({ label: human(x.key), value: x.n, extra: pc(x.pct) })), { emptyBody: "Appears once A-tier leads book." });
    const unpacked = a.n ? '<h2 class="section-title">A tier, unpacked <span class="faint">· ' + esc(n(a.n)) + " booked</span></h2>" + '<div class="grid g2">' +
      card({ title: "Revenue band", body: tb(a.revenue_bands) }) + card({ title: "Spend on agencies and software", body: tb(a.spend_bands) }) +
      card({ title: "Industry", body: tb(a.industries) }) + card({ title: "Source", sub: "First touch", body: tb(a.sources) }) + "</div>"
      : card({ title: "A tier, unpacked", body: empty("No A-tier bookings in this period", "When A-tier leads book, this breaks them down by revenue, spend, industry and source, so you can buy more of them.") });
    const maxM = Math.max(1, ...d.calendly_months.map((m) => m.total));
    const months = card({
      title: "Calendly bookings by month", sub: "Every booking Calendly knows about, including imported history", flush: true,
      body: table([
        { label: "Month", get: (r) => { const p = String(r.month).split("-"); return '<span class="t-name">' + esc(p.length === 2 ? MONTHS[Number(p[1]) - 1] + " " + p[0] : r.month) + "</span>"; } },
        { label: "Bookings", get: (r) => '<div class="cell-bar"><span class="tnum">' + esc(n(r.total)) + '</span><div class="bar-track"><div class="bar-fill"' + w((r.total / maxM) * 100) + "></div></div></div>" },
        { label: "Active", num: true, get: (r) => esc(n(r.active)) },
        { label: "Cancelled", num: true, get: (r) => esc(n(r.canceled)) },
        { label: "No-show", num: true, get: (r) => esc(n(r.no_show)) },
        { label: "From funnel", num: true, get: (r) => esc(n(r.funnel)) },
        { label: "Direct", num: true, get: (r) => esc(n(r.direct)) },
      ], d.calendly_months, { empty: empty("No Calendly bookings yet", "Connect Calendly in Integrations, then import history to see past months here.") }),
    });
    return tiers + unpacked + months;
  }

  // ── Team ───────────────────────────────────────────────────────────────────
  TAB.team.load = () => api("/team");
  TAB.team.actions = () => '<button class="btn" type="button" data-action="test-ping">Send test ping</button><button class="btn btn-primary" type="button" data-action="rep-new">Add rep</button>';
  TAB.team.render = (d) => {
    S.reps = d.reps;
    const active = d.reps.filter((r) => r.active), inactive = d.reps.filter((r) => !r.active);
    const cols = [
      { label: "Name", get: (r) => '<span class="t-name">' + esc(r.name) + '</span><span class="sub">' + esc(r.email || "No email") + "</span>" },
      { label: "Role", get: (r) => esc(label(r.role)) },
      { label: "Tiers", get: (r) => (r.tiers || "").split(",").filter(Boolean).map(tierBadge).join(" ") || '<span class="faint">—</span>' },
      { label: "Weight", num: true, get: (r) => esc(n(r.weight)) },
      { label: "Commission", num: true, get: (r) => esc(r.commission_pct ? n1(r.commission_pct) + "%" : "—") },
      { label: "Monthly target", num: true, get: (r) => esc(r.monthly_target ? money(r.monthly_target) : "—") },
      { label: "Pings", get: (r) => [r.slack_user_id ? "Slack" : "", r.discord_user_id ? "Discord" : ""].filter(Boolean).map((x) => badge(x, "b-grey")).join(" ") || '<span class="faint">—</span>' },
      { label: "", get: (r) => '<button class="btn btn-sm" type="button" data-action="rep-edit" data-id="' + esc(r.id) + '">Edit</button>' },
    ];
    return '<div class="callout"><span class="callout-dot"></span><div>New applications are shared between active closers who take that tier, in proportion to their weight. Weight 0 pauses a rep without removing their history.</div></div>' +
      card({ title: "Active", flush: true, body: table(cols, active, { empty: empty("No reps yet", "Add your closers and setters. Until you do, every call goes to the founder's calendar.") }) }) +
      (inactive.length ? card({ title: "Inactive", flush: true, body: table(cols, inactive) }) : "");
  };
  function repForm(r) {
    r = r || { role: "closer", tiers: "A,B", weight: 1, active: 1 };
    const t = (r.tiers || "").split(",");
    return '<form data-submit="rep-save" data-id="' + esc(r.id || "") + '" class="form-grid">' +
      '<label class="field"><span class="field-label">Name</span><input class="input" name="name" required maxlength="80" value="' + esc(r.name || "") + '"></label>' +
      '<label class="field"><span class="field-label">Email</span><input class="input" type="email" name="email" maxlength="120" value="' + esc(r.email || "") + '"></label>' +
      '<label class="field"><span class="field-label">Role</span>' + sel("role", [{ value: "closer", label: "Closer" }, { value: "setter", label: "Setter" }], r.role) + "</label>" +
      '<div class="field"><span class="field-label">Tiers</span><div class="row">' + ["A", "B", "C"].map((x) => '<label class="row small"><input type="checkbox" name="tier_' + x + '"' + (t.includes(x) ? " checked" : "") + "> " + x + "</label>").join("") + "</div></div>" +
      '<label class="field"><span class="field-label">Weight</span><input class="input" type="number" name="weight" min="0" max="100" value="' + esc(r.weight) + '"></label>' +
      '<label class="field"><span class="field-label">Commission %</span><input class="input" type="number" step="0.1" name="commission_pct" min="0" max="100" value="' + esc(r.commission_pct || 0) + '"></label>' +
      '<label class="field"><span class="field-label">Monthly cash target</span><input class="input" type="number" name="monthly_target" min="0" value="' + esc(r.monthly_target || 0) + '"></label>' +
      '<label class="field"><span class="field-label">Calendar URL</span><input class="input" type="url" name="calendar_url" placeholder="https://calendly.com/…" value="' + esc(r.calendar_url || "") + '"></label>' +
      '<label class="field"><span class="field-label">Slack user id</span><input class="input" name="slack_user_id" placeholder="U0123ABCD" value="' + esc(r.slack_user_id || "") + '"></label>' +
      '<label class="field"><span class="field-label">Discord user id</span><input class="input" name="discord_user_id" value="' + esc(r.discord_user_id || "") + '"></label>' +
      '<label class="field span-all"><span class="switch"><input type="checkbox" name="active"' + (r.active ? " checked" : "") + '><span class="switch-track"></span><span>Active</span></span></label>' +
      '<div class="form-actions span-all">' + (r.id ? '<button class="btn btn-danger" type="button" data-action="rep-delete" data-id="' + esc(r.id) + '">Deactivate</button><span class="spacer"></span>' : "") + '<button class="btn" type="button" data-action="modal-close">Cancel</button><button class="btn btn-primary" type="submit">Save</button></div></form>';
  }

  // ── Leads ──────────────────────────────────────────────────────────────────
  const STATUSES = ["partial", "applied", "booked", "showed", "no_show", "won", "lost", "nurture", "disqualified"];
  TAB.leads.load = () => api("/leads", { query: qs(S.leads) });
  TAB.leads.actions = () => '<a class="btn" href="/admin/api/leads.csv?' + esc(qs(Object.assign({}, S.leads, { page: "" }))) + '" download>Export CSV</a>';
  TAB.leads.render = (d) => {
    const L = S.leads;
    const bar = '<div class="row wrap">' +
      '<input class="input" type="search" placeholder="Search name, email, phone or ref" aria-label="Search leads" data-input="lead-q" value="' + esc(L.q) + '" autocomplete="off">' +
      sel("status", [{ value: "", label: "All statuses" }].concat(STATUSES.map((s) => ({ value: s, label: STATUS_LABEL[s] }))), L.status, { change: "lead-filter", label: "Status" }) +
      sel("tier", [{ value: "", label: "All tiers" }, { value: "A", label: "Tier A" }, { value: "B", label: "Tier B" }, { value: "C", label: "Tier C" }, { value: "none", label: "Unscored" }], L.tier, { change: "lead-filter", label: "Tier" }) +
      sel("sort", [{ value: "created", label: "Newest" }, { value: "updated", label: "Recently updated" }, { value: "score", label: "Highest score" }, { value: "call", label: "Call date" }, { value: "value", label: "Deal value" }, { value: "name", label: "Name" }], L.sort, { change: "lead-filter", label: "Sort" }) +
      '<span class="faint small">' + esc(n(d.total)) + " leads" + (L.q ? " · all time" : "") + "</span></div>";
    const tbl = table([
      { label: "Lead", get: (r) => '<span class="t-name">' + esc([r.first_name, r.last_name].filter(Boolean).join(" ") || r.email) + "</span>" + (r.is_test === 1 ? " " + badge("Test", "b-amber") : "") + '<span class="sub">' + esc(r.email) + "</span>" },
      { label: "Status", get: (r) => statusBadge(r.status) },
      { label: "Tier", get: (r) => tierBadge(r.tier) },
      { label: "Score", num: true, get: (r) => (r.score == null ? '<span class="faint">—</span>' : esc(n(r.score))) },
      { label: "Source", get: (r) => esc(r.channel || "direct") + (r.campaign ? '<span class="sub ellipsis">' + esc(r.campaign) + "</span>" : "") },
      { label: "Closer", get: (r) => esc(r.closer || "—") },
      { label: "Call", get: (r) => (r.call_at ? esc(dt(r.call_at)) : '<span class="faint">—</span>') },
      { label: "Value", num: true, get: (r) => (r.revenue ? esc(money(r.revenue)) : '<span class="faint">—</span>') },
      { label: "Created", num: true, get: (r) => esc(day(r.created_at)) },
    ], d.rows, {
      rowAction: (r) => ({ action: "open-lead", id: r.id }),
      empty: L.q || L.status || L.tier ? empty("No leads match", "Try a different search or clear the filters.") : empty("No leads in this period", "People appear here the moment they leave contact details on the application. Try a longer range."),
    });
    const pager = d.pages > 1 ? '<div class="pager"><span>Page ' + esc(d.page) + " of " + esc(d.pages) + '</span><div class="row"><button class="btn btn-sm" type="button" data-action="lead-page" data-page="' + esc(d.page - 1) + '"' + (d.page <= 1 ? " disabled" : "") + '>Previous</button><button class="btn btn-sm" type="button" data-action="lead-page" data-page="' + esc(d.page + 1) + '"' + (d.page >= d.pages ? " disabled" : "") + ">Next</button></div></div>" : "";
    return bar + '<section class="card">' + tbl + pager + "</section>";
  };

  // ── Emails ─────────────────────────────────────────────────────────────────
  TAB.emails.load = () => api("/emails", { query: qs() });
  TAB.emails.actions = () => '<button class="btn" type="button" data-action="run-queue">Send due emails now</button>';
  const seqName = (d, id) => ((d && d.sequence_names) || {})[id] || label(id);
  function offsetLabel(ms, anchor) {
    if (ms == null) return "Per lead";
    const a = Math.abs(ms);
    const t = a < 3600000 ? Math.round(a / 60000) + " min" : a < 172800000 ? Math.round(a / 3600000) + " h" : Math.round(a / 86400000) + " days";
    if (anchor === "call") return ms < 0 ? t + " before the call" : t + " after the call";
    return ms === 0 ? "Immediately" : t + " after";
  }
  TAB.emails.render = (d) => {
    d.subjects = Object.fromEntries((d.templates || []).map((t) => [t.id, t.subject]));
    const dv = d.deliverability;
    const tiles = kpis([
      kpi("Sent", esc(n(dv.sent)), esc(n(dv.simulated)) + " simulated"),
      kpi("Open rate", esc(pc(dv.open_rate)), esc(n(dv.opens)) + " opened"),
      kpi("Click rate", esc(pc(dv.click_rate)), esc(n(dv.clicks)) + " clicked"),
      kpi("Failed", esc(n(dv.failed)), esc(pc(dv.failure_rate)) + " of attempts"),
      kpi("Unsubscribes", esc(n(dv.unsubscribes)), "In the period"),
      kpi("Queued", esc(n(d.queue_total)), esc(n(d.queue_due)) + " due now"),
    ], "k6");
    const mode = d.mode === "simulated" ? '<div class="callout warn"><span class="callout-dot"></span><div><strong>Emails are simulated.</strong> Nothing is actually sent until a Resend API key and a From address are set in Integrations. Everything else (timing, personalisation, logging) runs as normal.</div></div>' : "";
    const seqs = '<section class="card"><div class="card-head"><div><h2 class="card-title">Sequences</h2><p class="card-sub">Open a sequence to see each step, its timing and how it performs. Preview shows any template with a sample lead.</p></div></div><div class="card-body flush">' +
      d.sequences.filter((s) => !s.dynamic || s.steps.length || s.id === "precall" || s.id === "behaviour").map((s) => {
        const tot = s.steps.reduce((t, x) => ({ sent: t.sent + x.sent + x.simulated, opened: t.opened + x.opened, clicked: t.clicked + x.clicked, pending: t.pending + x.pending }), { sent: 0, opened: 0, clicked: 0, pending: 0 });
        return '<details class="seq"><summary class="seq-head"><svg class="seq-chev" viewBox="0 0 16 16" aria-hidden="true"><path d="M6 4l4 4-4 4"/></svg><div><div class="seq-name">' + esc(s.label) + '</div><div class="seq-trigger">' + esc(s.trigger) + (s.dynamic ? " · steps chosen per lead" : " · " + s.steps.length + " steps") + '</div></div><div class="seq-stats"><span>' + esc(n(tot.sent)) + " sent</span><span>" + esc(pc(tot.sent ? (tot.opened / tot.sent) * 100 : null)) + " opened</span><span>" + esc(n(tot.pending)) + " queued</span></div></summary>" +
          table([
            { label: "#", num: true, get: (r) => esc(r.index + 1) },
            { label: "Email", cls: "wrap", get: (r) => '<span class="t-name">' + esc((d.subjects || {})[r.template] || r.template) + '</span><span class="sub mono">' + esc(r.template) + "</span>" },
            { label: "When", get: (r) => esc(offsetLabel(r.offset_ms, r.anchor)) },
            { label: "Sent", num: true, get: (r) => esc(n(r.sent + r.simulated)) },
            { label: "Opened", num: true, get: (r) => esc(pc(r.sent + r.simulated ? (r.opened / (r.sent + r.simulated)) * 100 : null)) },
            { label: "Clicked", num: true, get: (r) => esc(pc(r.sent + r.simulated ? (r.clicked / (r.sent + r.simulated)) * 100 : null)) },
            { label: "Queued", num: true, get: (r) => esc(n(r.pending)) },
            { label: "", get: (r) => '<button class="btn btn-sm" type="button" data-action="preview" data-template="' + esc(r.template) + '">Preview</button>' },
          ], s.steps, { empty: empty("No sends yet", "This sequence picks its emails per lead; they appear here after the first sends.", true) }) + "</details>";
      }).join("") + "</div></section>";
    const queue = card({
      title: "Queue", sub: "The next emails waiting to go out", flush: true,
      body: table([
        { label: "When", get: (r) => esc(dt(r.send_at)) + '<span class="sub">' + esc(ago(r.send_at)) + "</span>" },
        { label: "Lead", get: (r) => leadLink(r.lead_id, r.name || "Lead") + (r.count > 1 ? ' <span class="badge plain b-grey" title="Same person, same email, due within 10 minutes">×' + esc(r.count) + "</span>" : "") },
        { label: "Sequence", get: (r) => esc(r.sequence_name || seqName(d, r.sequence)) },
        { label: "Email", cls: "wrap", get: (r) => '<span class="small">' + esc(r.subject || r.template) + '</span><span class="sub mono">' + esc(r.template) + "</span>" },
      ], d.queue, { mid: true, empty: empty("Nothing queued", "Emails are queued when someone applies, books, misses a call or closes.", true) }),
    });
    const triggers = card({
      title: "Behaviour triggers", sub: "One-off emails when someone does something specific. Each fires at most once per lead.", flush: true,
      body: table([
        { label: "Rule", cls: "wrap", get: (r) => '<span class="t-name">' + esc(r.label) + '</span><span class="sub mono">' + esc(r.template) + "</span>" },
        { label: "When", get: (r) => esc(r.when || (r.delay_min ? r.delay_min + " min" : "Right away")) },
        { label: "Fired", num: true, get: (r) => esc(n(r.fired)) },
        { label: "", get: (r) => '<button class="btn btn-sm" type="button" data-action="preview" data-template="' + esc(r.template) + '">Preview</button>' },
      ], d.triggers),
    });
    const tpl = card({
      title: "All templates", sub: d.templates.length + " templates", flush: true,
      body: table([
        { label: "Subject", cls: "wrap", get: (r) => '<span class="t-name">' + esc(r.subject || r.id) + '</span><span class="sub mono">' + esc(r.id) + "</span>" },
        { label: "Topics", get: (r) => (r.topics || []).map((t) => '<span class="badge plain b-grey">' + esc(human(t)) + "</span>").join(" ") || '<span class="faint">—</span>' },
        { label: "", get: (r) => '<button class="btn btn-sm" type="button" data-action="preview" data-template="' + esc(r.id) + '">Preview</button>' },
      ], d.templates, { tall: true }),
    });
    const h = d.health || { by_sequence: [], paused: null, last_check: null };
    const paused = h.paused ? '<div class="callout bad"><span class="callout-dot"></span><div><strong>Marketing emails are paused</strong> since ' + esc(dt(h.paused.at)) + ". " + esc(h.paused.reason || "") + " Reminders, pre-call and post-call emails keep going. Fix the cause, then " +
      '<button class="link-btn" type="button" data-action="emails-resume">resume marketing</button>.</div></div>' : "";
    const hook = !h.webhook ? '<div class="callout warn"><span class="callout-dot"></span><div><strong>Bounces and complaints are not tracked yet.</strong> In Resend add a webhook to <code class="mono">' + esc(h.webhook_url || "/hooks/resend") + "</code> for delivered, delayed, bounced and complained events, then paste its signing secret in Integrations → Email.</div></div>" : "";
    const lc = h.last_check || {};
    const health = card({
      title: "Deliverability by sequence", sub: "Live sends in the period (up to 90 days). Hard bounces and spam complaints stop all email to that address. Over 7 days, more than 0.2% complaints or 3% bounces pauses marketing.", flush: true,
      body: table([
        { label: "Sequence", get: (r) => '<span class="t-name">' + esc(seqName(d, r.sequence)) + "</span>" + (h.pausable && h.pausable.includes(r.sequence) ? "" : '<span class="sub">never paused</span>') },
        { label: "Sent", num: true, get: (r) => esc(n(r.sent)) },
        { label: "Delivered", num: true, get: (r) => esc(n(r.delivered)) },
        { label: "Hard bounces", num: true, get: (r) => esc(n(r.bounced)) + ' <span class="' + (r.bounce_rate > 3 ? "bad-text" : "faint") + '">' + esc(pc(r.bounce_rate)) + "</span>" },
        { label: "Soft", num: true, get: (r) => esc(n(r.soft)) },
        { label: "Complaints", num: true, get: (r) => esc(n(r.complained)) + ' <span class="' + (r.complaint_rate > 0.2 ? "bad-text" : "faint") + '">' + esc(r.complaint_rate == null ? "—" : r.complaint_rate.toFixed(2) + "%") + "</span>" },
      ], h.by_sequence, { empty: empty("No live sends in this period", d.mode === "simulated" ? "Emails are simulated, so there is nothing to bounce yet." : "Rates appear with the first live sends.", true) }),
      foot: lc.detail ? "Last 7-day check: " + esc(lc.detail) : "",
    });
    return paused + mode + hook + tiles + health + seqs + '<div class="grid g2">' + queue + triggers + "</div>" + tpl;
  };

  function previewModal(title, p) {
    const html = '<div class="preview-meta"><span class="preview-subject">' + esc(p.subject) + "</span>" + badge(p.mode === "ai" ? "Personalised by Claude" : p.mode === "rules" ? "Personalised by rules" : "Not personalised", p.mode === "ai" ? "b-blue" : "b-grey") +
      (p.facts_used && p.facts_used.length ? '<span class="faint">Uses: ' + esc(p.facts_used.join(", ")) + "</span>" : "") + "</div>" +
      '<iframe class="preview-frame" sandbox="" referrerpolicy="no-referrer" title="Email preview" src="' + esc("/admin/preview?template=" + encodeURIComponent(title)) + '"></iframe>';
    openModal(title, html);
  }

  // ── Voice ──────────────────────────────────────────────────────────────────
  TAB.voice.load = () => api("/voice", { query: qs() });
  TAB.voice.render = (d) => {
    const s = d.setup;
    const st1 = s.api_key, st2 = s.agent && s.inbound_agent, st3 = s.phone_number, st4 = s.configured;
    const cur = !st1 ? 1 : !st2 ? 2 : !st3 ? 3 : 4;
    const step = (i, done, title, body, action) => '<div class="step' + (done ? " done" : i === cur ? " current" : "") + '"><span class="step-n">' + (done ? "✓" : i) + '</span><div><div class="step-title">' + esc(title) + '</div><div class="step-body">' + body + "</div>" + (action ? '<div class="step-action">' + action + "</div>" : "") + "</div></div>";
    const steps = card({
      title: "Set up AI calls", sub: "Four steps. Each one unlocks the next.", flush: true,
      body: '<div class="steps">' +
        step(1, st1, "Add your ElevenLabs API key", st1 ? "Key saved. It never leaves the server." : "Create a key at elevenlabs.io under Developers → API keys, then paste it here. Never paste keys into chat.",
          st1 ? "" : '<form class="inline-form" data-submit="set-setting" data-key="ELEVENLABS_API_KEY"><input class="input" type="password" name="value" placeholder="sk_…" autocomplete="off" required><button class="btn btn-primary" type="submit">Save key</button></form>') +
        step(2, st2, "Create the agents", st2 ? "Outbound and inbound agents are ready. Run it again after you change prompts or the voice." : "Creates Sam, the outbound caller, and the inbound callback agent in your ElevenLabs account, and points their webhooks here.",
          st1 ? '<button class="btn' + (st2 ? "" : " btn-primary") + '" type="button" data-action="voice-provision">' + (st2 ? "Re-provision agents" : "Create agents") + '</button><div class="small faint mt8" id="provision-out"></div>' : "") +
        step(3, st3, "Pick the phone number", st3 ? "Using number id " + '<code class="mono">' + esc(s.phone_number_id) + "</code>" + (s.phone_number_locked ? " " + '<span class="lock">locked (env)</span>' : "") : "Import a Twilio number into ElevenLabs (Phone numbers), then choose it here.",
          st1 && !s.phone_number_locked ? '<div class="inline-form" id="numbers-box"><button class="btn" type="button" data-action="voice-numbers">' + (st3 ? "Change number" : "Load my numbers") + "</button></div>" : "") +
        step(4, false, "Make a test call to your phone", "Rings your phone with the outbound agent so you can hear exactly what leads hear." + (s.test_number ? " Last used: " + esc(s.test_number) : ""),
          st3 ? '<form class="inline-form" data-submit="test-call"><input class="input" type="tel" name="to" placeholder="+47 912 34 567" value="' + esc(s.test_number || "") + '" autocomplete="tel"><button class="btn btn-primary" type="submit"' + (st4 ? "" : " disabled") + ">Call me</button></form>" : "") +
        "</div>",
      foot: "Post-call webhook: " + '<code class="mono">' + esc(s.webhook_url) + "</code>" + (s.webhook_secret ? " · secret set" : " · add its secret in Integrations → AI calls"),
    });
    const toggles = card({
      title: "Which calls go out", sub: "Calls only go out during local calling hours, to people who consented, at most " + n(s.daily_cap) + " a day.",
      body: '<div class="stack gap16">' + d.toggles.map((t) => {
        const help = { AI_CALL_CONFIRM: "Confirms a new booking a couple of minutes after it is made.", AI_CALL_SPEED_TO_LEAD: "Calls A and B tier applicants within minutes if they have not booked.", AI_CALL_REBOOK: "Calls no-shows to find a new time." }[t.key] || "";
        return '<label class="switch"><input type="checkbox" data-change="voice-toggle" data-key="' + esc(t.key) + '"' + (t.on ? " checked" : "") + (t.locked ? " disabled" : "") + '><span class="switch-track"></span><span><span class="t-name">' + esc(t.label) + "</span>" + (t.locked ? ' <span class="lock">locked (env)</span>' : "") + '<span class="sub faint small">' + esc(help) + "</span></span></label>";
      }).join("") + "</div>",
    });
    const k = d.stats;
    const tiles = kpis([
      kpi("Calls placed", esc(n(k.placed)), esc(n(k.queued)) + " queued"),
      kpi("Answered", esc(n(k.answered)), esc(pc(k.placed ? (k.answered / k.placed) * 100 : null)) + " of placed"),
      kpi("Voicemail or no answer", esc(n(k.voicemail + k.no_answer)), esc(n(k.failed)) + " failed"),
      kpi("Inbound", esc(n(k.inbound)), esc(n(k.simulated)) + " simulated outbound"),
    ]);
    const out = card({
      title: "Outbound queue and history", flush: true,
      body: table([
        { label: "When", get: (r) => esc(dt(r.run_at)) },
        { label: "Lead", get: (r) => (r.lead_id ? leadLink(r.lead_id, r.name || "Lead") : '<span class="faint">Test</span>') },
        { label: "Call", get: (r) => esc(human(r.kind)) },
        { label: "Phone", get: (r) => '<span class="mono faint">' + esc(r.phone) + "</span>" },
        { label: "Status", get: (r) => badge(label(r.status), { queued: "b-blue", dialing: "b-blue", done: "b-green", failed: "b-red", cancelled: "b-grey" }[r.status]) + (r.outcome ? '<span class="sub">' + esc(label(r.outcome)) + "</span>" : "") },
        { label: "Attempts", num: true, get: (r) => esc(n(r.attempts)) },
      ], d.outbound, { mid: true, empty: empty("No AI calls yet", "Calls are queued when someone books, applies without booking, or misses a call, if the matching switch is on.") }),
    });
    const convs = card({
      title: "Conversations", sub: "Recordings stream through Funnel HQ; they are never stored here.", flush: true,
      body: table([
        { label: "When", get: (r) => esc(dt(r.started_at)) },
        { label: "Who", get: (r) => (r.lead_id ? leadLink(r.lead_id, r.name || "Lead") : '<span class="faint">Unknown caller</span>') + '<span class="sub">' + esc(r.direction === "inbound" ? "Inbound" : "Outbound") + "</span>" },
        { label: "Length", num: true, get: (r) => esc(r.duration_s ? clock(r.duration_s) : "—") },
        { label: "Summary", cls: "wrap", get: (r) => '<span class="small">' + esc(r.summary || "—") + "</span>" },
        { label: "", get: (r) => (r.audio ? '<button class="btn btn-sm" type="button" data-action="play" data-src="' + esc(r.audio) + '">Play</button>' : "") },
      ], d.calls, { mid: true, empty: empty("No conversations yet", "Every answered AI call and inbound call appears here with a summary and recording.") }),
    });
    return '<div class="grid g-2-1">' + steps + toggles + "</div>" + tiles + out + convs;
  };

  // ── Tracking ───────────────────────────────────────────────────────────────
  TAB.tracking.load = () => api("/tracking", { query: qs() });
  TAB.tracking.render = (d) => {
    const NAMES = { meta: "Meta Conversions API", ga4: "Google Analytics 4", posthog: "PostHog", crm: "CRM webhook" };
    const dests = '<div class="grid g4">' + d.destinations.map((x) => card({
      title: NAMES[x.id] || x.id,
      actions: x.configured ? badge("Connected", "b-green") : badge("Not set up", "b-grey"),
      body: '<div class="kpi-value tnum">' + esc(pc(x.success_rate)) + '</div><div class="kpi-sub">delivered</div><dl class="kv mt16"><dt>Sent</dt><dd class="tnum">' + esc(n(x.sent)) + '</dd><dt>Retrying</dt><dd class="tnum">' + esc(n(x.retry)) + '</dd><dt>Failed</dt><dd class="tnum">' + esc(n(x.failed)) + "</dd></dl>",
    })).join("") + "</div>";
    const LABELS = { em: "Email (hashed)", ph: "Phone (hashed)", fbp: "Browser id (fbp)", fbc: "Click id (fbc)", ip: "IP address", ua: "User agent", external_id: "External id" };
    const match = card({
      title: "Meta match keys", sub: n(d.meta_events) + " events sent to Meta in the period. More keys per event means better matching and cheaper results.",
      body: d.meta_events ? bars(d.match_keys.map((m) => ({ label: LABELS[m.key] || m.key, value: m.pct || 0, display: pc(m.pct), extra: n(m.n) })), { color: "c3" }) : empty("No Meta events yet", "Add the Pixel id and Conversions API token in Integrations. Coverage per key shows here once events flow.", true),
    });
    const ev = card({
      title: "Delivered events", flush: true,
      body: table([
        { label: "Event", get: (r) => '<code class="mono">' + esc(r.event_name) + "</code>" },
        { label: "Destination", get: (r) => esc(NAMES[r.destination] || r.destination) },
        { label: "Sent", num: true, get: (r) => esc(n(r.n)) },
      ], d.by_event, { mid: true, empty: empty("Nothing delivered yet", "Server-side events appear here as they are confirmed by each destination.", true) }),
    });
    const errs = card({
      title: "Recent errors", sub: "Failed or retrying deliveries. Retries back off automatically.", flush: true,
      body: table([
        { label: "When", get: (r) => esc(dt(r.updated_at)) },
        { label: "Destination", get: (r) => esc(NAMES[r.destination] || r.destination) },
        { label: "Event", get: (r) => '<code class="mono">' + esc(r.event_name) + "</code>" },
        { label: "Status", get: (r) => badge(r.status === "failed" ? "Failed" : "Retrying", r.status === "failed" ? "b-red" : "b-amber") + (r.http_status ? ' <span class="faint tnum">' + esc(r.http_status) + "</span>" : "") },
        { label: "Error", cls: "wrap", get: (r) => '<span class="small mono faint">' + esc(r.error || "—") + "</span>" },
      ], d.errors, { empty: empty("No errors", "Every forwarded event in this period was accepted.", true) }),
    });
    const META_LABEL = { lead_status_changed: "Disqualified", payment_recorded: "CashCollected / Refund", app_step: "StartApplication (first)" };
    const cell = (c, dest) => {
      if (!c) return '<span class="faint">—</span>';
      const tot = c.sent + c.failed;
      const cls = c.failed && c.failed / Math.max(1, tot) > 0.1 ? "bad-text" : "";
      return '<span class="tnum">' + esc(n(c.sent)) + "</span>" + (c.failed ? ' <span class="' + (cls || "faint") + '">· ' + esc(n(c.failed)) + " failed</span>" : "") + (c.retry ? ' <span class="faint">· ' + esc(n(c.retry)) + " retrying</span>" : "") +
        (dest === "meta" && isNum(c.match_rate) ? '<span class="sub">' + esc(pc(c.match_rate)) + " with email or phone</span>" : "");
    };
    const matrix = card({
      title: "Stages by destination", sub: "Sent, failed and retrying per funnel stage. CRM stages (show, no-show, won, lost, disqualified, payments) reach Meta as offline events (system_generated).", flush: true,
      body: table([
        { label: "Stage", get: (r) => '<code class="mono">' + esc(r.event) + "</code>" + ((META_LABEL[r.event] || r.meta) ? '<span class="sub">Meta: ' + esc(META_LABEL[r.event] || r.meta) + "</span>" : '<span class="sub">Not sent to Meta</span>') },
        { label: NAMES.meta, get: (r) => cell(r.cells.meta, "meta") },
        { label: NAMES.ga4, get: (r) => cell(r.cells.ga4, "ga4") },
        { label: NAMES.posthog, get: (r) => cell(r.cells.posthog, "posthog") },
        { label: NAMES.crm, get: (r) => cell(r.cells.crm, "crm") },
      ], d.stage_matrix || [], { mid: true }),
    });
    const sv = d.stage_values || { rows: [] };
    const values = card({
      title: "Conversion values sent to ad platforms", sub: "P(won | stage, tier) × average deal (" + (sv.avg_deal ? moneyShort(sv.avg_deal) : "not computed") + "), from " + n(sv.n_total) + " leads with an outcome in 365 days. Cells with fewer than 20 outcomes use the fixed value." + (sv.computed_at ? " Computed " + dt(sv.computed_at) + "." : ""),
      actions: sv.locked ? '<span class="lock">locked (env)</span>' : '<button class="btn btn-sm" type="button" data-action="stage-values">Recompute</button>', flush: true,
      body: table([{ label: "Stage", get: (r) => '<span class="t-name">' + esc(r.label) + "</span>" }].concat(["A", "B", "C"].map((t, i) => ({
        label: "Tier " + t, num: true,
        get: (r) => { const c = r.tiers[i]; return '<span class="t-name">' + esc(isNum(c.used) ? money(c.used) : "—") + "</span>" + '<span class="sub">' + (isNum(c.calibrated) ? esc(pp(c.p)) + " of " + esc(n(c.n)) : "fixed" + (c.n ? " · n " + esc(n(c.n)) : "")) + "</span>"; },
      }))), sv.rows),
    });
    return (d.test_event_code ? '<div class="callout warn"><span class="callout-dot"></span><div><strong>Meta test event code is set.</strong> Events go to Test Events in Events Manager. Clear it in Integrations when you are done testing.</div></div>' : "") +
      dests + matrix + '<div class="grid g2">' + match + values + "</div>" + '<div class="grid g2">' + ev + errs + "</div>";
  };

  // ── Live ───────────────────────────────────────────────────────────────────
  const LIVE = { timer: null, since: 0, rows: [], active: 0 };
  const LIVE_LABELS = { page_view: "Viewed", lead_captured: "Left contact details", app_step: "Answered a question", app_submitted: "Applied", lead_qualified: "Scored", booking_scheduled: "Booked a call", vsl_play: "Played the film", vsl_unmute: "Unmuted", vsl_50: "Watched half", vsl_complete: "Finished the film", vsl_cta_reveal: "Reached the pitch", vsl_cta_click: "Clicked apply", whatsapp_click: "Clicked WhatsApp", email_opened: "Opened an email", email_clicked: "Clicked an email", deal_won: "Won", call_showed: "Showed up", ai_call_completed: "Spoke with Sam" };
  TAB.live.load = async () => {
    LIVE.rows = []; LIVE.since = 0;
    const d = await api("/live");
    LIVE.rows = d.events; LIVE.active = d.active_visitors;
    LIVE.since = d.events.length ? d.events[0].ts : d.now - 3600000;
    return d;
  };
  function liveRow(e, fresh) {
    return '<div class="live-row' + (fresh ? " fresh" : "") + '"><span class="tnum faint">' + esc(hm(e.ts)) + '</span><span><span class="t-name">' + esc(LIVE_LABELS[e.name] || human(e.name)) + "</span>" + (e.path && e.name === "page_view" ? ' <code class="mono faint">' + esc(e.path) + "</code>" : "") + '</span><span class="lr-who">' +
      (e.lead_id ? leadLink(e.lead_id, e.first_name || "Lead") + " " + tierBadge(e.tier) : '<span class="faint">Visitor</span>') + '</span><span class="lr-place faint small">' + esc([e.country, e.device].filter(Boolean).join(" · ") || "—") + "</span></div>";
  }
  TAB.live.render = () => '<section class="card"><div class="card-head"><div class="row"><span class="pulse" id="live-pulse"></span><h2 class="card-title">' + '<span id="live-active">' + esc(n(LIVE.active)) + "</span> people on the site now</h2></div>" +
    '<span class="faint small">Last hour · page views, plays, applications, bookings</span></div><div class="card-body flush"><div class="live-list" id="live-list">' +
    (LIVE.rows.length ? LIVE.rows.map((e) => liveRow(e, false)).join("") : empty("Quiet right now", "Events appear here within five seconds of happening. Micro-signals like scrolling are left out.")) + "</div></div></section>";
  TAB.live.after = () => startLive();
  async function pollLive() {
    if (S.tab !== "live" || document.hidden) return;
    try {
      const d = await api("/live", { query: "since=" + encodeURIComponent(LIVE.since) });
      if (S.tab !== "live") return;
      const el = $("#live-active");
      if (el) el.textContent = n(d.active_visitors);
      const fresh = d.events.filter((e) => e.ts > LIVE.since);
      if (fresh.length) {
        LIVE.since = fresh[0].ts;
        LIVE.rows = fresh.concat(LIVE.rows).slice(0, 100);
        const list = $("#live-list");
        if (list) list.innerHTML = fresh.map((e) => liveRow(e, true)).join("") + LIVE.rows.slice(fresh.length).map((e) => liveRow(e, false)).join("");
      }
      const p = $("#live-pulse");
      if (p) p.classList.remove("off");
    } catch (e) {
      const p = $("#live-pulse");
      if (p) p.classList.add("off");
    }
  }
  function startLive() { stopLive(); LIVE.timer = setInterval(pollLive, 5000); }
  function stopLive() { if (LIVE.timer) clearInterval(LIVE.timer); LIVE.timer = null; }
  document.addEventListener("visibilitychange", () => { if (!document.hidden && S.tab === "live") pollLive(); });

  // ── Alerts ─────────────────────────────────────────────────────────────────
  TAB.alerts.load = () => api("/alerts");
  TAB.alerts.actions = () => '<button class="btn" type="button" data-action="alerts-check">Run checks now</button>';
  const SEV = (s) => badge(s === "crit" ? "Critical" : "Warning", s === "crit" ? "b-red" : "b-amber");
  const alertVal = (v) => (isNum(v) ? n1(v) : "—");
  TAB.alerts.render = (d) => {
    renderBanner(d);
    const hb = d.heartbeat_at
      ? (d.heartbeat_stale ? '<div class="callout bad"><span class="callout-dot"></span><div><strong>The cron has not run for ' + esc(dur(Date.now() - d.heartbeat_at)) + ".</strong> Emails, AI calls, syncs and these checks are waiting. Check the Worker's Cron Triggers in Cloudflare.</div></div>"
        : '<div class="callout info"><span class="callout-dot"></span><div>Scheduled jobs are running. Last beat ' + esc(ago(d.heartbeat_at)) + ". Checks run every 15 minutes" + (d.pings ? " and ping Slack/Discord when an alert opens or resolves." : ". Add a Slack or Discord webhook in Integrations to get pinged.") + "</div></div>")
      : '<div class="callout warn"><span class="callout-dot"></span><div>No cron heartbeat yet. It appears after the first scheduled run.</div></div>';
    const open = card({
      title: "Open", sub: d.open.length ? d.open.length + " open" : "Nothing needs attention", flush: true,
      body: table([
        { label: "Alert", cls: "wrap", get: (r) => '<span class="t-name">' + esc(r.label) + '</span><span class="sub">' + esc(r.detail || "") + "</span>" },
        { label: "Severity", get: (r) => SEV(r.severity) },
        { label: "Opened", get: (r) => esc(dt(r.opened_at)) + '<span class="sub">' + esc(ago(r.opened_at)) + "</span>" },
        { label: "Now", num: true, get: (r) => esc(alertVal(r.last_value)) },
        { label: "Usual", num: true, get: (r) => esc(alertVal(r.baseline)) },
        { label: "", get: (r) => '<button class="btn btn-sm btn-ghost" type="button" data-action="alert-resolve" data-id="' + esc(r.id) + '">Resolve</button>' },
      ], d.open, { empty: empty("All clear", "Every check is within its normal range.", true) }),
    });
    const recent = card({
      title: "History", sub: "Resolved alerts, newest first", flush: true,
      body: table([
        { label: "Alert", cls: "wrap", get: (r) => '<span class="t-name">' + esc(r.label) + '</span><span class="sub">' + esc(r.detail || "") + "</span>" },
        { label: "Severity", get: (r) => SEV(r.severity) },
        { label: "Opened", get: (r) => esc(dt(r.opened_at)) },
        { label: "Lasted", num: true, get: (r) => esc(dur(r.resolved_at - r.opened_at)) },
      ], d.recent, { mid: true, empty: empty("No alerts yet", "Resolved alerts are kept here.", true) }),
    });
    const rules = card({
      title: "What is checked", flush: true,
      body: table([
        { label: "Check", get: (r) => '<span class="t-name">' + esc(r.label) + "</span>" },
        { label: "Severity", get: (r) => SEV(r.severity) },
        { label: "When it fires", cls: "wrap", get: (r) => '<span class="small">' + esc(r.help) + "</span>" },
      ], d.rules),
    });
    return hb + open + '<div class="grid g2">' + recent + rules + "</div>";
  };

  /** Red bar above every view while alerts are open (or the cron has stalled). */
  function renderBanner(d) {
    const el = $("#alert-banner");
    if (!el) return;
    const crit = d.open.filter((a) => a.severity === "crit");
    const items = d.open.slice(0, 3).map((a) => a.label);
    if (d.heartbeat_stale) items.unshift("Scheduled jobs stalled");
    if (!items.length) { el.hidden = true; el.innerHTML = ""; return; }
    el.className = "alert-banner" + (crit.length || d.heartbeat_stale ? "" : " warn");
    el.innerHTML = '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M8 2.5L14 13H2z"/><path d="M8 6.5v3M8 11.2v.1"/></svg><span><strong>' + esc(d.open.length + (d.heartbeat_stale ? 1 : 0)) + " open alert" + (d.open.length + (d.heartbeat_stale ? 1 : 0) === 1 ? "" : "s") + ":</strong> " + esc(items.join(" · ")) + (d.open.length > 3 ? " …" : "") + '</span><a class="btn btn-sm" href="#alerts">View alerts</a>';
    el.hidden = false;
  }
  async function refreshBanner() {
    try { renderBanner(await api("/alerts/open")); } catch (e) { /* the banner is best effort */ }
  }

  // ── Integrations ───────────────────────────────────────────────────────────
  TAB.integrations.load = () => api("/integrations");
  const STATE_BADGE = { connected: ["Connected", "b-green"], partial: ["Partly set up", "b-amber"], off: ["Not connected", "b-grey"], defaults: ["Using defaults", "b-grey"] };
  function settingRow(x) {
    const val = x.set ? '<div class="setting-value">' + esc(x.value) + "</div>" : '<div class="setting-value unset">Not set</div>';
    const ownerLock = !x.locked && x.owner_only && !(S.me && S.me.role === "owner");
    if (ownerLock) x = Object.assign({}, x, { locked: true });
    const src = ownerLock ? '<span class="lock" title="Only the owner can change this setting.">owner only</span>' : x.locked ? '<span class="lock" title="Set as an environment variable. Change it with wrangler.">locked (env)</span>' : x.source === "default" ? '<span class="faint small">default</span>' : "";
    let input = "";
    if (!x.locked) {
      if (x.kind === "bool") input = sel("value", [{ value: "", label: "Default" }, { value: "true", label: "On" }, { value: "false", label: "Off" }], x.source === "db" ? x.value : "", { sm: true, label: x.label });
      else if (x.kind === "select") input = sel("value", (x.options || []).map((o) => ({ value: o, label: o || "Automatic" })), x.source === "db" ? x.value : "", { sm: true, label: x.label });
      else input = '<input class="input sm" name="value" aria-label="' + esc(x.label) + '" autocomplete="off" spellcheck="false" type="' + (x.secret ? "password" : x.kind === "number" ? "number" : "text") + '" placeholder="' + esc(x.secret ? (x.set ? "Replace key" : "Paste key") : x.set ? "Replace value" : "Enter value") + '"' + (!x.secret && x.source === "db" ? ' value="' + esc(x.value) + '"' : "") + ">";
      input = '<form class="setting-edit" data-submit="set-setting" data-key="' + esc(x.key) + '" hidden>' + input + '<button class="btn btn-sm btn-primary" type="submit">Save</button><button class="btn btn-sm btn-ghost" type="button" data-action="edit-setting">Cancel</button>' + (x.source === "db" ? '<button class="btn btn-sm btn-ghost btn-danger" type="button" data-action="clear-setting" data-key="' + esc(x.key) + '">Clear</button>' : "") + "</form>";
    }
    const edit = x.locked ? "" : '<button class="link-btn small" type="button" data-action="edit-setting">' + (x.set && x.source !== "default" ? (x.secret ? "Replace" : "Change") : "Set") + "</button>";
    return '<div class="setting"><div class="setting-head"><span class="setting-label">' + esc(x.label) + '</span><span class="row">' + src + edit + "</span></div>" +
      '<div class="setting-line">' + val + '<span class="setting-key">' + esc(x.key) + "</span></div>" + (x.help ? '<div class="setting-help">' + esc(x.help) + "</div>" : "") + input + "</div>";
  }
  function groupActions(id) {
    if (id === "email") return '<form class="inline-form" data-submit="test-email"><input class="input sm" type="email" name="to" placeholder="you@company.com" required><button class="btn btn-sm" type="submit">Send test email</button></form>' +
      '<div class="row mt8"><button class="btn btn-sm" type="button" data-action="dns-check">Check DNS (SPF, DKIM, DMARC)</button><span class="faint small">Webhook for bounces: <code class="mono">/hooks/resend</code></span></div><div id="dns-out"></div>';
    if (id === "ads") return '<div class="row"><button class="btn btn-sm" type="button" data-action="spend-sync">Sync spend now</button><a class="btn btn-sm btn-ghost" href="#traffic">Spend, CAC &amp; ROAS</a></div>';
    if (id === "notify") return '<div class="row"><button class="btn btn-sm" type="button" data-action="test-ping">Send test ping to Slack / Discord</button></div>';
    if (id === "calendly") return '<div class="row wrap">' + [["connect", "Connect"], ["sync", "Sync now"], ["import", "Import history"], ["requalify", "Requalify direct bookings"], ["link-orphans", "Link orphans"]].map((a) => '<button class="btn btn-sm" type="button" data-action="calendly" data-op="' + a[0] + '">' + a[1] + "</button>").join("") + '</div><div class="small faint" id="calendly-out"></div>';
    if (id === "voice") return '<div class="row"><a class="btn btn-sm" href="#voice">Open the guided voice setup</a></div>';
    return "";
  }
  TAB.integrations.render = (d) => '<div class="callout info"><span class="callout-dot"></span><div><strong>Keys go here, never into a chat.</strong> Paste each key into its field below. Secrets are stored on the server and only ever shown masked. Values marked locked (env) were set with wrangler and can only be changed there.</div></div>' +
    '<div class="int-grid">' + d.groups.map((g) => {
      const b = STATE_BADGE[g.state] || STATE_BADGE.off;
      const act = groupActions(g.id);
      return '<section class="card" id="int-' + esc(g.id) + '"><div class="card-head"><div><h2 class="card-title">' + esc(g.label) + '</h2><p class="card-sub">' + esc(g.description) + "</p></div>" + badge(b[0], b[1]) + '</div><div class="card-body flush">' + g.settings.map(settingRow).join("") + "</div>" + (act ? '<div class="int-actions">' + act + "</div>" : "") + "</section>";
    }).join("") + "</div>";


  /** The admin CSP is inherited by srcdoc frames and blocks inline styles (even parsing them with
      DOMParser reports violations), so styles are stripped as text first. Cosmetic only: safety comes
      from sandbox="" (no scripts, opaque origin). Hidden preheaders are dropped rather than shown. */
  function previewDoc(html) {
    return String(html || "")
      .replace(/<(div|span|p|td)\b[^>]*\sstyle\s*=\s*"[^"]*(display\s*:\s*none|max-height\s*:\s*0)[^"]*"[^>]*>[\s\S]*?<\/\1>/gi, "")
      .replace(/<style\b[\s\S]*?<\/style>/gi, "")
      .replace(/<script\b[\s\S]*?<\/script>/gi, "")
      .replace(/\sstyle\s*=\s*("[^"]*"|'[^']*')/gi, "");
  }

  // ── Modal ──────────────────────────────────────────────────────────────────
  function openModal(title, body, narrow) {
    const root = $("#modal-root");
    root.innerHTML = '<div class="scrim over-drawer" data-action="modal-close"></div><div class="modal' + (narrow ? " narrow" : "") + '" role="dialog" aria-modal="true" aria-label="' + esc(title) + '"><div class="modal-head"><h2 class="card-title">' + esc(title) + '</h2><button class="btn btn-ghost btn-icon" type="button" data-action="modal-close" aria-label="Close"><svg viewBox="0 0 16 16" aria-hidden="true"><path d="M4 4l8 8M12 4l-8 8"/></svg></button></div><div class="modal-body">' + body + "</div></div>";
    hydrate(root);
    const f = root.querySelector("input, select, textarea, button.btn-primary");
    if (f) f.focus();
  }
  function closeModal() { $("#modal-root").innerHTML = ""; }

  // ── Lead drawer ────────────────────────────────────────────────────────────
  const DRAWER_TABS = [["overview", "Overview"], ["pipeline", "Pipeline & deal"], ["journey", "Journey"], ["behaviour", "Behaviour & emails"], ["calls", "Calls & bookings"]];
  const REVENUE_BANDS = [["", "—"], ["under_1m", "Under $1M"], ["1m_3m", "$1M – $3M"], ["3m_10m", "$3M – $10M"], ["10m_plus", "$10M+"]];
  const SPEND_BANDS = [["", "—"], ["under_25k", "Under $25k"], ["25k_100k", "$25k – $100k"], ["100k_300k", "$100k – $300k"], ["300k_plus", "$300k+"]];
  const OFFERS = { build_day: "Build day", core: "Core", dwy: "Done with you", embedded: "Embedded", custom: "Custom" };
  const PLANS = { full: "Paid in full", split_2: "2 payments", split_3: "3 payments", monthly: "Monthly", custom: "Custom" };
  const opts = (pairs) => pairs.map((p) => ({ value: p[0], label: p[1] }));

  async function openLead(id, keepTab) {
    S.drawer = { id, tab: (S.drawer && S.drawer.id === id && S.drawer.tab) || "overview", data: null };
    renderDrawer();
    try {
      const d = await api("/leads/" + encodeURIComponent(id));
      if (!S.drawer || S.drawer.id !== id) return;
      if (d.moved_to) { toast("This lead was merged into another; showing that one."); location.hash = "lead=" + encodeURIComponent(d.moved_to); return; }
      if (d.gone) { S.drawer.error = "This lead was erased" + (d.erased_at ? " on " + dt(d.erased_at) : "") + ". Only the reference is kept, in the activity log."; S.drawer.gone = true; renderDrawer(); return; }
      S.drawer.data = d;
      renderDrawer();
    } catch (e) {
      if (S.drawer && S.drawer.id === id) { S.drawer.error = e.message; renderDrawer(); }
    }
  }
  function closeDrawer() {
    S.drawer = null;
    $("#drawer-root").innerHTML = "";
    document.body.classList.remove("drawer-open");
  }

  function renderDrawer() {
    const root = $("#drawer-root");
    const dr = S.drawer;
    if (!dr) { root.innerHTML = ""; return; }
    const d = dr.data;
    const L = d && d.lead;
    const name = L ? [L.first_name, L.last_name].filter(Boolean).join(" ") || L.email : "Loading";
    const head = '<div class="drawer-head"><div class="drawer-top"><div class="drawer-title"><h2 class="drawer-name">' + esc(name) + "</h2>" +
      (L ? '<div class="drawer-meta">' + statusBadge(L.status) + tierBadge(L.tier_override || L.tier) + '<span class="mono">' + esc(L.ref_code) + "</span><span>" + esc(L.email) + "</span>" + (L.phone ? "<span>" + esc(L.phone) + "</span>" : "") + (L.booking_source === "calendly-direct" ? badge("Booked directly in Calendly", "b-grey") : "") + (d.test && d.test.is_test ? badge("Test data", "b-amber") : "") + (d.plan && d.plan.viewed_at ? planSignal({ at: d.plan.last_viewed_at || d.plan.viewed_at, views: d.plan.views }) : "") + "</div>" : "") +
      '</div><span class="spacer"></span><button class="btn btn-ghost btn-icon" type="button" data-action="drawer-close" aria-label="Close lead"><svg viewBox="0 0 16 16" aria-hidden="true"><path d="M4 4l8 8M12 4l-8 8"/></svg></button></div>' +
      '<div class="drawer-tabs" role="tablist">' + DRAWER_TABS.map((t) => '<button type="button" role="tab" data-action="drawer-tab" data-tab="' + t[0] + '" aria-selected="' + (dr.tab === t[0]) + '">' + esc(t[1]) + "</button>").join("") + "</div></div>";
    let body;
    if (dr.error) body = empty(dr.gone ? "Lead erased" : "Could not load this lead", dr.error);
    else if (!d) body = '<div class="loading">Loading</div>';
    else body = ({ overview: drawerOverview, pipeline: drawerPipeline, journey: drawerJourney, behaviour: drawerBehaviour, calls: drawerCalls })[dr.tab](d);
    root.innerHTML = '<div class="scrim" data-action="drawer-close"></div><aside class="drawer" role="dialog" aria-modal="true" aria-label="Lead">' + head + '<div class="drawer-body" id="drawer-body">' + body + "</div></aside>";
    document.body.classList.add("drawer-open");
    hydrate(root);
  }

  function drawerOverview(d) {
    const L = d.lead;
    const sb = d.score_breakdown;
    const facts = '<dl class="kv">' +
      "<dt>Created</dt><dd>" + esc(dt(L.created_at)) + "</dd>" +
      "<dt>Call</dt><dd>" + (L.call_at ? esc(dt(L.call_at)) + ' <span class="faint">' + esc(ago(L.call_at)) + "</span>" : '<span class="faint">Not booked</span>') + "</dd>" +
      "<dt>Closer</dt><dd>" + esc(L.closer || "Unassigned") + (L.setter ? ' <span class="faint">· set by ' + esc(L.setter) + "</span>" : "") + "</dd>" +
      "<dt>Score</dt><dd>" + (L.score == null ? '<span class="faint">Not scored</span>' : esc(L.score) + " / 100" + (sb && sb.cappedBy ? ' <span class="faint">· capped by ' + esc(human(sb.cappedBy)) + "</span>" : "")) + "</dd>" +
      "<dt>First touch</dt><dd>" + esc([L.ft_channel, L.ft_source, L.ft_campaign].filter(Boolean).join(" · ") || "Direct") + "</dd>" +
      "<dt>Landed on</dt><dd>" + esc(L.ft_lander ? "/for/" + L.ft_lander : L.ft_landing || L.landing_path || "—") + (L.variant ? ' <span class="faint">· headline ' + esc(String(L.variant).toUpperCase()) + "</span>" : "") + "</dd>" +
      "<dt>Location</dt><dd>" + esc([L.city, L.country].filter(Boolean).join(", ") || "—") + (L.device ? ' <span class="faint">· ' + esc(L.device) + "</span>" : "") + "</dd>" +
      "<dt>Deal value</dt><dd>" + esc(L.revenue ? money(L.revenue) : "—") + (L.cash_collected ? ' <span class="faint">· ' + esc(money(L.cash_collected)) + " collected</span>" : "") + "</dd>" +
      "<dt>Calls</dt><dd>" + (L.do_not_call_at ? badge("Do not call", "b-red") : L.call_consent_at ? "Consented " + esc(day(L.call_consent_at)) : '<span class="faint">No consent</span>') + "</dd>" +
      "<dt>Emails</dt><dd>" + (d.revops && d.revops.email_status === "bounced" ? badge("Hard bounce", "b-red") : d.revops && d.revops.email_status === "complained" ? badge("Spam complaint", "b-red") : L.unsubscribed_at ? badge("Unsubscribed", "b-amber") : "Subscribed") + "</dd>" +
      (d.revops && isNum(d.revops.p_win) ? "<dt>Win probability</dt><dd>" + esc(pp(d.revops.p_win)) + ' <span class="faint">· calibrated model</span></dd>' : "") +
      (d.revops && isNum(d.revops.noshow_risk) && L.status === "booked" ? "<dt>No-show risk</dt><dd>" + badge(Math.round(d.revops.noshow_risk * 100) + "%", d.revops.noshow_risk > 0.4 ? "b-red" : d.revops.noshow_risk > 0.25 ? "b-amber" : "b-green") +
        (d.revops.noshow_reasons && d.revops.noshow_reasons.length ? ' <span class="faint">· ' + esc(d.revops.noshow_reasons.map(human).join(", ")) + "</span>" : "") + "</dd>" : "") +
      (d.revops && d.revops.ft_ad_id ? '<dt>First ad</dt><dd class="mono">' + esc(d.revops.ft_ad_id) + "</dd>" : "") + reviewLine(d.review) +
      "<dt>Data</dt><dd>" + testControls(d) + "</dd></dl>";
    const vsl = d.vsl.length ? '<div class="stack">' + d.vsl.map((v) => '<div class="bar-row"><span class="bar-label">' + esc(label(v.video)) + ' film</span><span class="bar-value">' + esc(v.watched_pct) + "%" + (v.completed ? '<span class="faint">finished</span>' : "") + '</span><div class="bar-track"><div class="bar-fill"' + w(v.watched_pct) + "></div></div></div>").join("") + "</div>" : '<p class="faint small">Has not played a film.</p>';
    const answers = d.answers.some((a) => a.answer) ? '<dl class="kv">' + d.answers.map((a) => '<dt title="' + esc(a.title) + '">' + esc(label(a.id)) + "</dt><dd>" + (a.answer ? esc(a.answer) : '<span class="faint">—</span>') + "</dd>").join("") + "</dl>" : '<p class="faint small">No application answers yet.</p>';
    const scoreLines = sb && sb.lines && sb.lines.length ? table([
      { label: "Answer", cls: "wrap", get: (r) => esc(r.label) },
      { label: "Points", num: true, get: (r) => esc(r.points) },
      { label: "Flags", get: (r) => (r.flags || []).map((f) => badge(human(f), "b-amber")).join(" ") },
    ], sb.lines) : "";
    const booking = d.booking_answers.length ? card({ title: "Calendly form answers", body: '<dl class="kv">' + d.booking_answers.map((x) => "<dt>" + esc(x.q) + "</dt><dd>" + esc(x.a) + "</dd>").join("") + "</dl>" }) : "";
    const visits = d.sessions.length ? card({
      title: "Visits", sub: d.sessions.length + " sessions", flush: true,
      body: table([
        { label: "When", get: (r) => esc(dt(r.started_at)) },
        { label: "Landed on", get: (r) => '<code class="mono">' + esc((r.landing_path || "/").split("?")[0]) + "</code>" },
        { label: "Source", get: (r) => esc([r.channel, r.utm_source].filter(Boolean).join(" · ") || "direct") },
        { label: "Device", get: (r) => esc([r.device, r.browser, r.os].filter(Boolean).join(" · ")) },
        { label: "Engaged", num: true, get: (r) => esc(Math.round((r.engaged_ms || 0) / 1000) + "s") },
      ], d.sessions),
    }) : "";
    return card({ title: "Summary", body: facts }) + card({ title: "Film", body: vsl }) +
      card({ title: "Application", sub: L.app_completed_at ? "Submitted " + dt(L.app_completed_at) : "Step " + (L.step_reached || 0) + " reached, not submitted", body: answers }) +
      (scoreLines ? card({ title: "How the score was built", flush: true, body: scoreLines }) : "") + booking + visits +
      (!isManager() ? "" : card({ title: "Records", sub: "Booking checks and erasure on request", body:
        '<div class="row-actions">' +
        (L.status === "booked" ? '<button class="btn btn-sm" type="button" data-action="confirm-booking" data-id="' + esc(L.id) + '">Confirm booking and start reminders</button>' : "") +
        '<button class="btn btn-sm btn-danger" type="button" data-action="erase-lead" data-id="' + esc(L.id) + '" data-ref="' + esc(L.ref_code) + '">Erase all data for this lead</button></div>' +
        '<p class="faint small">Confirm only a booking you trust, for example one matched by email alone. Erasure deletes the lead, their visits, emails, calls and bookings, and keeps payment amounts without any link to the person.</p>' }));
  }

  function field(label, inner, cls) { return '<label class="field' + (cls ? " " + cls : "") + '"><span class="field-label">' + esc(label) + "</span>" + inner + "</label>"; }
  const inp = (name, value, o) => { o = o || {}; return '<input class="input" name="' + esc(name) + '" type="' + (o.type || "text") + '"' + (o.step ? ' step="' + esc(o.step) + '"' : "") + (o.min != null ? ' min="' + esc(o.min) + '"' : "") + (o.max != null ? ' max="' + esc(o.max) + '"' : "") + (o.maxlength ? ' maxlength="' + esc(o.maxlength) + '"' : "") + (o.placeholder ? ' placeholder="' + esc(o.placeholder) + '"' : "") + ' value="' + esc(value == null ? "" : value) + '"' + (o.readonly ? " readonly" : "") + ">"; };

  function drawerPipeline(d) {
    const L = d.lead, O = d.options;
    const reps = [{ value: "", label: "Unassigned" }].concat(d.reps.filter((r) => r.active || r.id === L.closer_id || r.id === L.setter_id).map((r) => ({ value: r.id, label: r.name + (r.role === "setter" ? " (setter)" : "") })));
    const pipeline = card({
      title: "Pipeline", sub: "Changing the status runs the matching follow-up: emails, AI calls and team pings.",
      body: '<form data-submit="save-pipeline" class="form-grid">' +
        field("Status", sel("status", O.statuses.map((s) => ({ value: s, label: STATUS_LABEL[s] || human(s) })), L.status)) +
        field("Tier override", sel("tier_override", [{ value: "", label: "Use score" + (L.tier ? " (" + L.tier + ")" : "") }, { value: "A", label: "A" }, { value: "B", label: "B" }, { value: "C", label: "C" }], L.tier_override || "")) +
        field("Closer", sel("closer_id", reps, L.closer_id || "")) +
        field("Setter", sel("setter_id", reps, L.setter_id || "")) +
        field("Deal value (USD)", inp("revenue", L.revenue || "", { type: "number", min: 0, step: "1" })) +
        field("Cash collected", inp("cash", money(L.cash_collected || 0), { readonly: true })) +
        field("Lost reason", sel("lost_reason", [{ value: "", label: "—" }].concat(O.lost_reasons.map((x) => ({ value: x, label: x }))), L.lost_reason || "")) +
        field("Objection", sel("objection", [{ value: "", label: "—" }].concat(O.objections.map((x) => ({ value: x, label: x }))), L.objection || "")) +
        field("Notes", '<textarea class="textarea" name="notes" maxlength="5000" rows="4">' + esc(L.notes || "") + "</textarea>", "span-all") +
        '<div class="form-actions span-all"><label class="switch"><input type="checkbox" name="do_not_call"' + (L.do_not_call_at ? " checked" : "") + '><span class="switch-track"></span><span class="small">Do not call</span></label><span class="spacer"></span><button class="btn btn-primary" type="submit">Save pipeline</button></div></form>',
    });
    const deal = card({
      title: "Deal", sub: "Everything the closer learns on the call.",
      body: '<form data-submit="save-deal" class="form-grid g3">' +
        field("Industry", inp("industry", L.industry, { maxlength: 120 })) +
        field("Revenue band", sel("revenue_band", opts(REVENUE_BANDS.concat(L.revenue_band && !REVENUE_BANDS.some((x) => x[0] === L.revenue_band) ? [[L.revenue_band, L.revenue_band]] : [])), L.revenue_band || "")) +
        field("Budget band", sel("budget_band", opts(SPEND_BANDS.concat(L.budget_band && !SPEND_BANDS.some((x) => x[0] === L.budget_band) ? [[L.budget_band, L.budget_band]] : [])), L.budget_band || "")) +
        field("Willing to invest", sel("willing_to_invest", [{ value: "", label: "—" }].concat(O.willing.map((x) => ({ value: x, label: human(x) }))), L.willing_to_invest || "")) +
        field("Temperature", sel("temperature", [{ value: "", label: "—" }].concat(O.temperatures.map((x) => ({ value: x, label: human(x) }))), L.temperature || "")) +
        field("Decision maker", sel("decision_maker", [{ value: "", label: "—" }].concat(O.decision_maker.map((x) => ({ value: x, label: x === "shared" ? "Shared decision" : human(x) }))), L.decision_maker || "")) +
        field("Fit (1–5)", sel("fit_rating", [{ value: "", label: "—" }].concat([1, 2, 3, 4, 5].map((x) => ({ value: x, label: String(x) }))), L.fit_rating || "")) +
        field("Follow up on", inp("follow_up_at", dateInput(L.follow_up_at), { type: "date" })) +
        field("Offer", sel("offer", [{ value: "", label: "—" }].concat(O.offers.map((x) => ({ value: x, label: OFFERS[x] || x }))), L.offer || "")) +
        field("Payment plan", sel("payment_plan", [{ value: "", label: "—" }].concat(O.payment_plans.map((x) => ({ value: x, label: PLANS[x] || x }))), L.payment_plan || "")) +
        field("Installments", inp("installments_total", L.installments_total, { type: "number", min: 1, max: 60 })) +
        field("Next payment", inp("next_payment_at", dateInput(L.next_payment_at), { type: "date" })) +
        field("Contract signed", inp("contract_signed_at", dateInput(L.contract_signed_at), { type: "date" })) +
        field("Kickoff signed", inp("loi_signed_at", dateInput(L.loi_signed_at), { type: "date" })) +
        field("First build", inp("target_business", L.target_business, { maxlength: 120, placeholder: "e.g. quote follow-up tool" })) +
        field("Refunded on", inp("refunded_at", dateInput(L.refunded_at), { type: "date" })) +
        field("Refund amount", inp("refund_amount", L.refund_amount, { type: "number", min: 0, step: "1" })) +
        '<div class="form-actions span-all"><button class="btn btn-primary" type="submit">Save deal</button></div></form>',
    });
    const pays = card({
      title: "Payments", sub: "Cash collected is the sum of this ledger. Use a negative amount for a refund.", flush: true,
      body: table([
        { label: "Paid", get: (r) => esc(day(r.paid_at)) },
        { label: "Amount", num: true, get: (r) => esc(money(r.amount)) },
        { label: "Method", get: (r) => esc(r.method || "—") },
        { label: "Note", cls: "wrap", get: (r) => esc(r.note || "") },
        { label: "", get: (r) => '<button class="btn btn-sm btn-ghost btn-danger" type="button" data-action="delete-payment" data-id="' + esc(r.id) + '">Delete</button>' },
      ], d.payments, { empty: empty("No payments yet", "Record each payment as it lands. Cash by rep and the sales numbers use this ledger.", true) }) +
        '<form data-submit="add-payment" class="form-grid g3 card-body"><label class="field"><span class="field-label">Amount (USD)</span><input class="input" name="amount" type="number" step="1" required></label>' +
        '<label class="field"><span class="field-label">Paid on</span><input class="input" name="paid_at" type="date" value="' + esc(dateInput(Date.now())) + '"></label>' +
        '<label class="field"><span class="field-label">Method</span><input class="input" name="method" maxlength="40" placeholder="Stripe, bank transfer"></label>' +
        '<label class="field span2"><span class="field-label">Note</span><input class="input" name="note" maxlength="300"></label>' +
        '<div class="field"><span class="field-label">&nbsp;</span><button class="btn" type="submit">Add payment</button></div></form>',
    });
    const held = canWrite() && ["booked", "no_show", "showed"].includes(L.status) && L.call_at && !(L.status === "booked" && callNotYet(L.call_at)) ? '<div class="row mb12"><button class="btn btn-primary btn-sm" type="button" data-action="held-open" data-id="' + esc(L.id) + '" data-name="' + esc([L.first_name, L.last_name].filter(Boolean).join(" ")) + '">' + (L.status === "showed" ? "Add call review" : "Log showed: review and plan") + "</button></div>" : "";
    return held + planCard(d) + pipeline + deal + receivablesCard(d) + pays;
  }

  function drawerJourney(d) {
    if (!d.timeline.length) return empty("No activity yet", "Visits, emails, calls and payments appear here in order.");
    let last = "";
    const items = d.timeline.map((t) => {
      const k = day(t.ts);
      const head = k !== last ? '<div class="tl-day">' + esc(k) + "</div>" : "";
      last = k;
      const key = /Booked|Applied|Submitted|Won|Showed|Left contact/.test(t.title) ? " key" : "";
      return head + '<div class="tl-item"><span class="tl-dot ' + esc(t.type) + key + '"></span><div><div class="tl-title">' + esc(t.title) + "</div>" + (t.detail ? '<div class="tl-detail">' + esc(t.detail) + "</div>" : "") + '</div><span class="tl-time">' + esc(hm(t.ts)) + "</span></div>";
    }).join("");
    const pending = d.pending_emails.length ? card({ title: "Coming up", sub: "Emails queued for this lead", flush: true, body: table([
      { label: "When", get: (r) => esc(dt(r.send_at)) },
      { label: "Sequence", get: (r) => esc(r.sequence_name || label(r.sequence)) },
      { label: "Email", cls: "wrap", get: (r) => '<span class="small">' + esc(r.subject || r.template) + '</span><span class="sub mono">' + esc(r.template) + "</span>" },
    ], d.pending_emails) }) : "";
    return pending + card({ title: "Journey", sub: d.timeline.length + " moments, newest first", body: '<div class="tl">' + items + "</div>" });
  }

  function drawerBehaviour(d) {
    const sayable = d.facts.filter((f) => !f.background), bg = d.facts.filter((f) => f.background);
    const factRow = (f) => '<div class="fact' + (f.background ? " bg" : "") + '"><span class="fact-text">' + esc(f.text) + "</span>" + (f.background ? badge("background — never said back", "b-grey") : badge("weight " + f.weight, "b-blue")) + (f.you && !f.background ? '<span class="fact-you">' + esc(f.you) + "</span>" : "") + "</div>";
    const facts = card({
      title: "What we know from behaviour", sub: "Facts the email personaliser can use. Background facts help it understand the lead but are never said back to them.",
      body: d.facts.length ? '<div class="facts">' + sayable.concat(bg).map(factRow).join("") + "</div>" : empty("Nothing yet", "Facts appear as this person watches, reads and applies.", true),
    });
    const picker = card({
      title: "Preview an email for this lead", sub: "Rendered with their answers and behaviour. Nothing is sent.",
      actions: sel("template", [{ value: "", label: "Choose a template" }].concat(d.options.templates.map((t) => ({ value: t, label: t }))), S.drawer.template || "", { change: "lead-preview", sm: true, label: "Template" }),
      body: '<div id="lead-preview">' + (S.drawer.preview ? previewBody(S.drawer.preview) : '<p class="faint small">Pick a template to see exactly what this lead would receive.</p>') + "</div>",
    });
    return facts + picker;
  }
  function previewBody(p) {
    return '<div class="preview-meta"><span class="preview-subject">' + esc(p.subject) + "</span>" + badge(p.mode === "ai" ? "Personalised by Claude" : p.mode === "rules" ? "Personalised by rules" : human(p.mode || "off"), p.mode === "ai" ? "b-blue" : "b-grey") +
      (p.facts_used && p.facts_used.length ? '<span class="faint">Uses: ' + esc(p.facts_used.join(", ")) + "</span>" : "") + '</div><iframe class="preview-frame" sandbox="" referrerpolicy="no-referrer" title="Email preview" src="' + esc("/admin/preview?template=" + encodeURIComponent(S.drawer.template || "") + "&lead=" + encodeURIComponent(S.drawer.id || "")) + '"></iframe>';
  }

  function drawerCalls(d) {
    const bookings = card({
      title: "Calendly bookings", flush: true,
      body: table([
        { label: "Call", get: (r) => esc(dt(r.start_at)) + '<span class="sub">' + esc(r.event_name || "") + "</span>" },
        { label: "Status", get: (r) => badge(r.no_show ? "No-show" : label(r.status || "unknown"), r.no_show ? "b-amber" : r.status === "canceled" ? "b-red" : "b-green") + (r.rescheduled ? ' <span class="faint small">rescheduled</span>' : "") },
        { label: "Host", get: (r) => esc(r.host_email || "—") },
        { label: "Matched by", get: (r) => esc(human(r.match_kind || "—")) },
      ], d.bookings, { empty: empty("No Calendly bookings", "Bookings made through Calendly are matched to this lead by email or tracking link.", true) }),
    });
    const calls = d.voice_calls.length ? d.voice_calls.map((v) => card({
      title: (v.direction === "inbound" ? "Inbound call" : "AI call") + " · " + dt(v.started_at),
      sub: [v.duration_s ? clock(v.duration_s) + " long" : "", v.status ? human(v.status) : "", v.match_kind ? "matched by " + human(v.match_kind) : ""].filter(Boolean).join(" · "),
      body: (v.summary ? '<p class="muted">' + esc(v.summary) + "</p>" : "") +
        (Object.keys(v.structured || {}).length ? '<div class="row wrap mt8">' + Object.entries(v.structured).filter((e) => e[1] === true).map((e) => badge(human(e[0]), "b-blue")).join("") + "</div>" : "") +
        (v.transcript.length ? '<div class="transcript mt16">' + v.transcript.map((m) => '<div class="msg ' + (m.who === "agent" ? "agent" : "caller") + '"><span class="msg-who">' + (m.who === "agent" ? "Sam (AI)" : "Lead") + "</span>" + esc(m.text) + "</div>").join("") + "</div>" : '<p class="faint small">No transcript.</p>') +
        (v.audio ? '<audio controls preload="none" src="' + esc(v.audio) + '"></audio>' : ""),
    })).join("") : card({ title: "AI calls", body: empty("No AI calls with this lead", "Transcripts and recordings appear here after Sam speaks with them.", true) });
    const queued = d.outbound_calls.length ? card({ title: "Call attempts", flush: true, body: table([
      { label: "When", get: (r) => esc(dt(r.run_at)) },
      { label: "Call", get: (r) => esc(human(r.kind)) },
      { label: "Status", get: (r) => esc(human(r.status)) + (r.outcome ? '<span class="sub">' + esc(label(r.outcome)) + "</span>" : "") },
      { label: "Attempts", num: true, get: (r) => esc(r.attempts) },
    ], d.outbound_calls) }) : "";
    return touchesCard(d) + bookings + calls + queued;
  }

  function formObj(form) {
    const o = {};
    for (const el of form.elements) {
      if (!el.name) continue;
      if (el.type === "checkbox") o[el.name] = el.checked;
      else o[el.name] = el.value;
    }
    return o;
  }
  const orNull = (v) => (v === "" || v == null ? null : v);
  const numOrNull = (v) => (v === "" || v == null ? null : Number(v));

  async function patchLead(patch, msg) {
    const id = S.drawer.id;
    await api("/leads/" + encodeURIComponent(id), { method: "PATCH", body: patch });
    toast(msg || "Saved");
    await openLead(id);
    if (["leads", "sales"].includes(S.tab)) loadTab(true);
  }

  // ── Shell ──────────────────────────────────────────────────────────────────
  function renderNav() {
    let html = "", group = null;
    for (const t of TABS) {
      if (!tabAllowed(t.id)) continue;
      if (t.group !== group) { group = t.group; if (group) html += '<div class="nav-label">' + esc(group) + "</div>"; }
      html += '<a class="nav-item' + (t.id === S.tab ? " active" : "") + '" href="#' + esc(t.id) + '"' + (t.id === S.tab ? ' aria-current="page"' : "") + '><svg viewBox="0 0 16 16" aria-hidden="true">' + (ICONS[t.id] || "") + "</svg><span>" + esc(t.title) + "</span></a>";
    }
    $("#nav").innerHTML = html;
  }

  function renderFilters() {
    const t = TAB[S.tab];
    const box = $("#filters");
    if (t.noFilters) { box.hidden = true; box.innerHTML = ""; return; }
    box.hidden = false;
    const f = S.filters, o = S.options || { channels: [], campaigns: [], variants: [], devices: [] };
    const R = [["today", "Today"], ["7d", "7 days"], ["30d", "30 days"], ["90d", "90 days"], ["all", "All time"]];
    const withCur = (list, v) => (v && !list.includes(v) ? list.concat([v]) : list);
    const s = (name, all, list, label) => {
      const vals = withCur(list, f[name]);
      return '<select class="select sm' + (f[name] ? " active" : "") + '" data-change="filter" name="' + esc(name) + '" aria-label="' + esc(label) + '"><option value="">' + esc(all) + "</option>" + vals.map((v) => '<option value="' + esc(v) + '"' + (v === f[name] ? " selected" : "") + ">" + esc(name === "variant" ? "Headline " + String(v).toUpperCase() : v) + "</option>").join("") + "</select>";
    };
    const any = f.channel || f.campaign || f.variant || f.device;
    box.innerHTML = '<div class="seg" role="group" aria-label="Date range">' + R.map((r) => '<button type="button" data-action="range" data-range="' + r[0] + '" aria-pressed="' + (f.range === r[0]) + '">' + r[1] + "</button>").join("") + "</div>" +
      s("channel", "All channels", o.channels, "Channel") + s("campaign", "All campaigns", o.campaigns, "Campaign") + s("variant", "All headlines", o.variants, "Headline variant") + s("device", "All devices", o.devices, "Device") +
      (any ? '<button class="btn btn-ghost btn-sm" type="button" data-action="clear-filters">Clear</button>' : "") +
      '<span class="spacer"></span>' + testToggle() + '<button class="btn btn-ghost btn-sm" type="button" data-action="refresh" title="Reload this view"><svg viewBox="0 0 16 16" aria-hidden="true"><path d="M13 8a5 5 0 1 1-1.5-3.6M13 2.5v3h-3"/></svg>Refresh</button>';
  }

  function renderShell() {
    const t = TAB[S.tab];
    renderNav();
    $("#page-title").textContent = t.title;
    $("#page-sub").textContent = t.sub;
    $("#topbar-tab").textContent = t.title;
    document.title = t.title + " · Funnel HQ";
    $("#head-actions").innerHTML = t.actions ? t.actions() : "";
    renderFilters();
  }

  let loadSeq = 0;
  async function loadTab(quiet) {
    const seq = ++loadSeq;
    const t = TAB[S.tab];
    const view = $("#view");
    stopLive();
    if (!quiet) view.innerHTML = '<div class="loading">Loading</div>';
    try {
      const d = await t.load();
      if (seq !== loadSeq) return;
      S.data = d;
      if (ro) ro.disconnect();
      charts.clear();
      const y = window.scrollY;
      view.innerHTML = t.render(d);
      hydrate(view);
      if (t.after) t.after(view, d);
      if (quiet) window.scrollTo(0, y);
      if (t.actions) $("#head-actions").innerHTML = t.actions();
    } catch (e) {
      if (seq !== loadSeq) return;
      view.innerHTML = card({ body: empty("This view could not load", (e && e.message ? e.message : String(e)) + ". Try Refresh; if it keeps failing, check the Worker logs.") });
    }
  }

  function parseHash() {
    const h = decodeURIComponent(location.hash.replace(/^#/, ""));
    if (h.startsWith("lead=")) return { tab: null, lead: h.slice(5) };
    if (h.startsWith("reassign=")) return { tab: null, lead: null, reassign: h.slice(9) };
    const home = S.me && (S.me.role === "closer" || S.me.role === "setter") ? "today" : "overview";
    return { tab: TAB[h] && tabAllowed(h) ? h : home, lead: null };
  }
  let booted = false;
  function route() {
    const r = parseHash();
    if (r.reassign) {
      if (!booted) { S.tab = tabAllowed("today") ? "today" : "overview"; renderShell(); loadTab(); }
      booted = true;
      openReassign(r.reassign);
      return;
    }
    if (r.lead) {
      if (!booted) { S.tab = tabAllowed("leads") ? "leads" : "today"; renderShell(); loadTab(); }
      if (!S.drawer || S.drawer.id !== r.lead) openLead(r.lead);
    } else {
      if (S.drawer) closeDrawer();
      if (!booted || r.tab !== S.tab) { S.tab = r.tab; renderShell(); loadTab(); if (booted && r.tab !== "alerts") refreshBanner(); }
    }
    booted = true;
    document.body.classList.remove("nav-open");
    const tb = $('[data-action="toggle-nav"]');
    if (tb) tb.setAttribute("aria-expanded", "false");
  }
  function closeLeadRoute() {
    closeDrawer();
    history.replaceState(null, "", "#" + S.tab);
  }

  // ── Events ─────────────────────────────────────────────────────────────────
  const actions = {
    "toggle-nav": (el) => { const open = document.body.classList.toggle("nav-open"); el.setAttribute("aria-expanded", String(open)); },
    theme: () => {
      const cur = store.get("hq-theme", "system");
      const next = THEMES[(THEMES.indexOf(cur) + 1) % THEMES.length];
      store.set("hq-theme", next);
      applyTheme(next);
    },
    logout: async () => {
      if (isManager() && !confirm("Log out on every device? Everyone signed in to Funnel HQ will need to sign in again.")) return;
      try { await api("/logout", { method: "POST" }); } catch (e) { /* fall through */ }
      location.href = "/admin/login";
    },
    range: (el) => { S.filters.range = el.dataset.range; store.set("hq-filters", S.filters); renderFilters(); loadTab(); },
    "clear-filters": () => { Object.assign(S.filters, { channel: "", campaign: "", variant: "", device: "" }); store.set("hq-filters", S.filters); renderFilters(); loadTab(); },
    refresh: () => loadTab(),
    trend: (el) => { S.trend = el.dataset.series; loadTab(true); },
    video: (el) => { S.video = el.dataset.video; loadTab(); },
    copy: async (el) => {
      const v = el.dataset.copy || "";
      const text = v.startsWith("/") ? location.origin + v : v;
      try { await navigator.clipboard.writeText(text); toast("Copied " + text); } catch (e) { toast("Copy failed. Select and copy: " + text, "err"); }
    },
    "confirm-booking": async (el) => {
      try { await api("/leads/" + encodeURIComponent(el.dataset.id) + "/confirm-booking", { method: "POST" }); toast("Reminders and confirm call started"); } catch (e) { fail(e); }
    },
    "erase-lead": async (el) => {
      const ref = prompt("This permanently deletes everything about this lead. Type their reference (" + el.dataset.ref + ") to confirm.");
      if (ref !== el.dataset.ref) return;
      try { await api("/leads/" + encodeURIComponent(el.dataset.id), { method: "DELETE", body: { confirm: ref } }); toast("Erased"); closeDrawer(); loadTab(); } catch (e) { fail(e); }
    },
    "open-lead": (el) => { location.hash = "lead=" + encodeURIComponent(el.dataset.id); },
    "drawer-close": () => closeLeadRoute(),
    "drawer-tab": (el) => { if (S.drawer) { S.drawer.tab = el.dataset.tab; renderDrawer(); const b = $("#drawer-body"); if (b) b.scrollTop = 0; } },
    "modal-close": () => closeModal(),
    "edit-setting": (el) => {
      const row = el.closest(".setting");
      const form = row && row.querySelector(".setting-edit");
      if (!form) return;
      form.hidden = !form.hidden;
      if (!form.hidden) { const i = form.querySelector("input, select"); if (i) i.focus(); }
    },
    "lead-page": (el) => { S.leads.page = Math.max(1, Number(el.dataset.page) || 1); loadTab(); },
    "archive-link": async (el) => {
      try { await api("/links/" + encodeURIComponent(el.dataset.code) + "/archive", { method: "POST", body: { archived: el.dataset.archived === "1" } }); toast(el.dataset.archived === "1" ? "Link archived" : "Link restored"); loadTab(true); } catch (e) { fail(e); }
    },
    "quick-outcome": async (el) => {
      el.disabled = true;
      try { await api("/sales/outcome", { method: "POST", body: { lead_id: el.dataset.id, patch: { status: el.dataset.status } } }); toast(el.dataset.status === "no_show" ? "Logged as no-show. Rebook follow-up started." : "Logged as showed. Post-call follow-up started."); loadTab(true); } catch (e) { el.disabled = false; fail(e); }
    },
    "test-ping": async () => {
      try { const r = await api("/team/test-ping", { method: "POST" }); toast("Test ping: Slack " + (r.slack ? "sent" : "not sent") + ", Discord " + (r.discord ? "sent" : "not sent")); } catch (e) { fail(e); }
    },
    "rep-new": () => openModal("Add rep", repForm(null)),
    "rep-edit": (el) => { const r = (S.reps || []).find((x) => x.id === el.dataset.id); if (r) openModal("Edit " + r.name, repForm(r)); },
    "rep-delete": async (el) => {
      if (!confirm("Deactivate this rep? Their history stays; they stop getting new leads.")) return;
      try { await api("/team/" + encodeURIComponent(el.dataset.id), { method: "DELETE" }); closeModal(); toast("Rep deactivated"); loadTab(true); } catch (e) { fail(e); }
    },
    "run-queue": async (el) => {
      el.disabled = true;
      try { const r = await api("/emails/run-queue", { method: "POST" }); toast("Processed " + r.processed + ": " + r.sent + " sent, " + r.simulated + " simulated, " + r.failed + " failed"); loadTab(true); } catch (e) { fail(e); } finally { el.disabled = false; }
    },
    preview: async (el) => {
      try { const p = await api("/emails/preview", { query: "template=" + encodeURIComponent(el.dataset.template) }); previewModal(el.dataset.template, p); } catch (e) { fail(e); }
    },
    play: (el) => {
      const a = document.createElement("audio");
      a.controls = true; a.preload = "none"; a.src = el.dataset.src;
      el.replaceWith(a);
      a.play().catch(() => {});
    },
    "voice-provision": async (el) => {
      el.disabled = true;
      const out = $("#provision-out");
      if (out) out.textContent = "Working…";
      try {
        const r = await api("/voice/provision", { method: "POST" });
        if (out) out.textContent = (r.steps || []).join(" · ") + (r.error ? " · " + r.error : "");
        if (r.ok) { toast("Agents ready"); setTimeout(() => loadTab(true), 1200); } else fail(new Error(r.error || "Provisioning failed"));
      } catch (e) { fail(e); } finally { el.disabled = false; }
    },
    "voice-numbers": async () => {
      const box = $("#numbers-box");
      try {
        const r = await api("/voice/numbers");
        if (!r.numbers.length) { box.innerHTML = '<span class="faint small">No numbers in your ElevenLabs account yet. Import a Twilio number under Phone numbers, then try again.</span>'; return; }
        box.innerHTML = '<form class="inline-form" data-submit="voice-number">' + sel("phone_number_id", r.numbers.map((x) => ({ value: x.id, label: x.number + (x.label ? " · " + x.label : "") })), r.selected || "") + '<button class="btn btn-primary" type="submit">Use this number</button></form>';
      } catch (e) { fail(e); }
    },
    calendly: async (el) => {
      const op = el.dataset.op;
      const out = $("#calendly-out");
      el.disabled = true;
      try {
        const r = await api("/integrations/calendly/" + op, { method: "POST" });
        const msg = op === "connect" ? (r.ok ? "Connected. " : "Not connected. ") + (r.steps || []).join(" · ") + (r.error ? " · " + r.error : "")
          : op === "sync" ? "Synced " + r.events + " events, " + r.changes + " changes."
          : op === "import" ? "Imported " + r.imported + (r.done ? ". History is complete." : ". More to import: click again.")
          : op === "requalify" ? "Requalified " + r.requalified + " direct bookings."
          : "Linked " + r.linked + " bookings to leads.";
        if (out) out.textContent = msg;
        toast(msg.slice(0, 140));
        if (op === "connect") loadTab(true);
      } catch (e) { fail(e); } finally { el.disabled = false; }
    },
    "clear-setting": async (el) => {
      if (!confirm("Clear " + el.dataset.key + "? The default (or nothing) will be used.")) return;
      try { await api("/integrations", { method: "PUT", body: { key: el.dataset.key, value: "" } }); toast("Cleared"); loadTab(true); } catch (e) { fail(e); }
    },
    "traffic-view": (el) => { S.trafficView = el.dataset.view === "spend" ? "spend" : "sources"; store.set("hq-traffic-view", S.trafficView); loadTab(); },
    "spend-level": (el) => { S.spendLevel = el.dataset.level; store.set("hq-spend-level", S.spendLevel); loadTab(true); },
    "spend-sync": async (el) => {
      el.disabled = true;
      try { const r = await api("/spend/sync", { method: "POST" }); toast("Synced " + n(r.rows) + " rows of spend"); if (S.tab === "traffic") loadTab(true); } catch (e) { fail(e); } finally { el.disabled = false; }
    },
    "noshow-score": async (el) => {
      el.disabled = true;
      try { const r = await api("/sales/noshow/score", { method: "POST" }); toast("Scored " + n(r.scored) + " upcoming calls"); loadTab(true); } catch (e) { fail(e); } finally { el.disabled = false; }
    },
    "digest-send": async (el) => {
      el.disabled = true;
      try { await api("/digest/send", { method: "POST" }); toast("Digest and follow-up pings sent"); } catch (e) { fail(e); } finally { el.disabled = false; }
    },
    "insights-view": (el) => { S.insightsView = el.dataset.view === "scoring" ? "scoring" : "booked"; loadTab(); },
    "ai-run": async (el) => {
      el.disabled = true; el.textContent = "Running…";
      try { await api("/ai-report/run", { method: "POST" }); toast("Weekly summary written"); loadTab(true); } catch (e) { fail(e); el.disabled = false; el.textContent = "Run now"; }
    },
    "calibration-run": async (el) => {
      el.disabled = true; el.textContent = "Working…";
      try {
        const r = await api("/calibration/run", { method: "POST" });
        toast(r.model_id ? "Model trained on " + n(r.n) + " outcomes" + (r.activated ? " and activated" : " (kept the active model)") : "Not enough outcomes yet: " + n(r.n) + " so far");
        loadTab(true);
      } catch (e) { fail(e); el.disabled = false; el.textContent = "Recompute now"; }
    },
    "model-activate": async (el) => {
      try { await api("/calibration/activate", { method: "POST", body: { id: el.dataset.id } }); toast("Model activated; open leads rescored"); loadTab(true); } catch (e) { fail(e); }
    },
    "emails-resume": async () => {
      if (!confirm("Resume marketing sequences? Only do this once the cause of the bounces or complaints is fixed.")) return;
      try { await api("/emails/resume", { method: "POST" }); toast("Marketing emails resumed"); loadTab(true); } catch (e) { fail(e); }
    },
    "stage-values": async (el) => {
      el.disabled = true;
      try { const r = await api("/tracking/stage-values", { method: "POST" }); toast("Values recomputed from " + n(r.n_total) + " outcomes"); loadTab(true); } catch (e) { fail(e); } finally { el.disabled = false; }
    },
    "alerts-check": async (el) => {
      el.disabled = true;
      try { const r = await api("/alerts/check", { method: "POST" }); toast("Checks done: " + (r.opened || []).length + " opened, " + (r.resolved || []).length + " resolved"); if (S.tab === "alerts") loadTab(true); else refreshBanner(); } catch (e) { fail(e); } finally { el.disabled = false; }
    },
    "alert-resolve": async (el) => {
      try { await api("/alerts/" + encodeURIComponent(el.dataset.id) + "/resolve", { method: "POST" }); toast("Resolved. It reopens if the check still fails after the cooldown."); loadTab(true); } catch (e) { fail(e); }
    },
    "dns-check": async (el) => {
      const out = $("#dns-out");
      el.disabled = true;
      if (out) out.innerHTML = '<p class="faint small mt8">Looking up DNS…</p>';
      try {
        const r = await api("/integrations/email/dns-check", { method: "POST" });
        const ST = { pass: ["Pass", "b-green"], warn: ["Check", "b-amber"], fail: ["Fail", "b-red"] };
        if (out) out.innerHTML = r.error && !r.checks.length ? '<p class="small bad-text mt8">' + esc(r.error) + "</p>" : '<div class="dns-list">' + r.checks.map((c) =>
          '<div class="dns-row">' + badge(ST[c.state][0], ST[c.state][1]) + '<div><div class="t-name small">' + esc(c.label) + '</div><div class="small faint">' + esc(c.detail) + "</div>" + (c.records.length ? '<code class="mono small dns-rec">' + esc(c.records.join(" | ")) + "</code>" : "") + "</div></div>").join("") + "</div>";
      } catch (e) { fail(e); if (out) out.innerHTML = ""; } finally { el.disabled = false; }
    },
    "delete-payment": async (el) => {
      if (!confirm("Delete this payment? Cash collected will be recalculated.")) return;
      try { await api("/leads/" + encodeURIComponent(S.drawer.id) + "/payments/" + encodeURIComponent(el.dataset.id), { method: "DELETE" }); toast("Payment deleted"); openLead(S.drawer.id); } catch (e) { fail(e); }
    },
  };

  const changes = {
    filter: (el) => { S.filters[el.name] = el.value; store.set("hq-filters", S.filters); renderFilters(); loadTab(); },
    "traffic-dim": (el) => { S.trafficDim = el.value; store.set("hq-traffic-dim", el.value); loadTab(); },
    "lander-industry": (el) => { S.landerIndustry = el.value; loadTab(true); },
    "lead-filter": (el) => { S.leads[el.name] = el.value; S.leads.page = 1; loadTab(); },
    "voice-toggle": async (el) => {
      try { await api("/integrations", { method: "PUT", body: { key: el.dataset.key, value: el.checked ? "true" : "false" } }); toast("Saved"); } catch (e) { el.checked = !el.checked; fail(e); }
    },
    "lead-preview": async (el) => {
      if (!S.drawer) return;
      S.drawer.template = el.value;
      const box = $("#lead-preview");
      if (!el.value) { S.drawer.preview = null; box.innerHTML = '<p class="faint small">Pick a template to see exactly what this lead would receive.</p>'; return; }
      box.innerHTML = '<div class="loading">Rendering</div>';
      try {
        const p = await api("/leads/" + encodeURIComponent(S.drawer.id) + "/preview", { query: "template=" + encodeURIComponent(el.value) });
        S.drawer.preview = p;
        box.innerHTML = previewBody(p);
      } catch (e) { box.innerHTML = empty("Preview failed", e.message, true); }
    },
  };

  const submits = {
    "create-link": async (form) => {
      const b = formObj(form);
      try { await api("/links", { method: "POST", body: b }); toast("Link created"); loadTab(true); } catch (e) { fail(e); }
    },
    "rep-save": async (form) => {
      const b = formObj(form);
      const body = {
        name: b.name, email: b.email, role: b.role, tiers: ["A", "B", "C"].filter((x) => b["tier_" + x]).join(","), weight: Number(b.weight || 0),
        commission_pct: Number(b.commission_pct || 0), monthly_target: Number(b.monthly_target || 0), calendar_url: b.calendar_url,
        slack_user_id: b.slack_user_id, discord_user_id: b.discord_user_id, active: !!b.active,
      };
      const id = form.dataset.id;
      try {
        if (id) await api("/team/" + encodeURIComponent(id), { method: "PATCH", body });
        else await api("/team", { method: "POST", body });
        closeModal(); toast("Saved"); loadTab(true);
      } catch (e) { fail(e); }
    },
    "set-setting": async (form) => {
      const el = form.elements.value;
      const value = el ? el.value.trim() : "";
      if (!value && !(el && el.tagName === "SELECT")) { toast("Enter a value first, or use Clear.", "err"); return; }
      try {
        await api("/integrations", { method: "PUT", body: { key: form.dataset.key, value } });
        toast("Saved " + form.dataset.key);
        loadTab(true);
      } catch (e) { fail(e); }
    },
    "test-email": async (form) => {
      try { const r = await api("/integrations/test-email", { method: "POST", body: { to: form.elements.to.value } }); toast(r.simulated ? "Simulated: add a Resend key and From address to send for real." : "Test email sent"); } catch (e) { fail(e); }
    },
    "voice-number": async (form) => {
      try { await api("/voice/number", { method: "POST", body: { phone_number_id: form.elements.phone_number_id.value } }); toast("Number saved. Re-provision so the inbound agent answers it."); loadTab(true); } catch (e) { fail(e); }
    },
    "test-call": async (form) => {
      const btn = form.querySelector("button");
      btn.disabled = true;
      try { await api("/voice/test-call", { method: "POST", body: { to: form.elements.to.value } }); toast("Calling you now"); } catch (e) { fail(e); } finally { btn.disabled = false; }
    },
    "save-pipeline": async (form) => {
      const b = formObj(form);
      const patch = {
        status: b.status, tier_override: orNull(b.tier_override), closer_id: orNull(b.closer_id), setter_id: orNull(b.setter_id),
        revenue: b.revenue === "" ? 0 : Number(b.revenue), lost_reason: orNull(b.lost_reason), objection: orNull(b.objection), notes: b.notes,
        do_not_call: !!b.do_not_call,
      };
      if (patch.status === "lost" && !patch.lost_reason) { toast("Pick a lost reason first.", "err"); return; }
      try { await patchLead(patch, "Pipeline saved"); } catch (e) { fail(e); }
    },
    "save-deal": async (form) => {
      const b = formObj(form);
      const patch = {};
      for (const k of ["industry", "revenue_band", "budget_band", "willing_to_invest", "temperature", "decision_maker", "offer", "payment_plan", "target_business", "follow_up_at", "next_payment_at", "contract_signed_at", "refunded_at", "loi_signed_at"]) patch[k] = orNull(b[k]);
      for (const k of ["fit_rating", "installments_total", "refund_amount"]) patch[k] = numOrNull(b[k]);
      try { await patchLead(patch, "Deal saved"); } catch (e) { fail(e); }
    },
    "spend-import": async (form) => {
      const file = form.elements.file.files && form.elements.file.files[0];
      const out = $("#spend-import-out");
      if (!file) { toast("Choose a CSV file first.", "err"); return; }
      if (file.size > 2000000) { toast("The file is too large (2 MB max).", "err"); return; }
      try {
        const csv = await file.text();
        const r = await api("/spend/import", { method: "POST", body: { csv, platform: form.elements.platform.value } });
        const msg = "Imported " + n(r.imported) + " rows" + (r.errors.length ? ", skipped " + r.errors.length + ": " + r.errors.slice(0, 2).join(" ") : "");
        if (out) out.textContent = msg;
        toast(msg.slice(0, 140));
        loadTab(true);
      } catch (e) { fail(e); }
    },
    "add-payment": async (form) => {
      const b = formObj(form);
      try {
        await api("/leads/" + encodeURIComponent(S.drawer.id) + "/payments", { method: "POST", body: { amount: Number(b.amount), paid_at: b.paid_at || null, method: b.method, note: b.note } });
        toast("Payment recorded");
        openLead(S.drawer.id);
      } catch (e) { fail(e); }
    },
  };

  // ══ Sales ops (round 2): roles, Today, pipeline & forecast, receivables, touches, users, activity,
  //    data quality, learned routing, attribution & cohorts, API & webhooks ══════════════════════════

  function renderMe() {
    const box = $("#side-user");
    const lbl = $("#logout-label");
    if (!S.me) return;
    if (box) {
      box.hidden = false;
      box.innerHTML = '<span class="t-name ellipsis">' + esc(S.me.name) + '</span><span class="badge plain b-grey">' + esc(label(S.me.role)) + "</span>";
    }
    if (lbl) lbl.textContent = isManager() ? "Log out everywhere" : "Sign out";
  }
  function waitedMs(ms) {
    const s = Math.max(0, Math.floor((ms || 0) / 1000));
    if (s < 3600) return Math.floor(s / 60) + "m " + String(s % 60).padStart(2, "0") + "s";
    if (s < 86400) return Math.floor(s / 3600) + "h " + Math.floor((s % 3600) / 60) + "m";
    return Math.floor(s / 86400) + "d " + Math.floor((s % 86400) / 3600) + "h";
  }
  /** Buying signal: the lead opened their written plan. */
  const planSignal = (v) => '<span class="badge b-green signal" title="' + esc("Opened " + (v.views || 1) + "×, last " + dt(v.at)) + '">Viewed plan ' + esc(ago(v.at)) + "</span>";
  function waited(ts) {
    const s = Math.max(0, Math.floor((Date.now() - ts) / 1000));
    if (s < 3600) return Math.floor(s / 60) + "m " + String(s % 60).padStart(2, "0") + "s";
    if (s < 86400) return Math.floor(s / 3600) + "h " + Math.floor((s % 3600) / 60) + "m";
    return Math.floor(s / 86400) + "d " + Math.floor((s % 86400) / 3600) + "h";
  }
  const unlinkedCallout = () => '<div class="callout warn"><span class="callout-dot"></span><div><strong>Your account is not linked to a rep yet.</strong> Ask the owner to link it under Team → Users; then your calls and leads show here.</div></div>';
  const riskBadgeOf = (v) => (isNum(v) ? badge(Math.round(v * 100) + "% no-show", v > 0.4 ? "b-red" : v > 0.25 ? "b-amber" : "b-green") : "");
  const telBtn = (phone, primary) => (phone ? '<a class="btn btn-sm' + (primary ? " btn-primary" : "") + '" href="tel:' + esc(phone) + '">Call</a>' : '<span class="btn btn-sm" aria-disabled="true">No phone</span>');
  const TEMP_CLS = { hot: "b-red", warm: "b-amber", cold: "b-blue" };

  function dueTable(rows) {
    return table([
      { label: "Lead", get: (r) => leadLink(r.id, r.name) + '<span class="sub mono">' + esc(r.ref_code) + "</span>" },
      { label: "Due", get: (r) => esc(day(r.due_at)) + " " + (r.overdue ? badge((r.days_overdue ? r.days_overdue + "d " : "") + "overdue", "b-red") : badge("Due", "b-amber")) + (r.seq ? '<span class="sub">Instalment ' + esc(r.seq) + (r.of ? " of " + esc(r.of) : "") + "</span>" : "") },
      { label: "Amount", num: true, get: (r) => (isNum(r.amount) ? esc(money(r.amount)) : '<span class="faint">—</span>') + '<span class="sub">' + esc(money(r.cash_collected)) + " of " + esc(money(r.revenue)) + "</span>" },
      { label: "Closer", get: (r) => esc(r.closer || "Unassigned") },
      { label: "", get: (r) => (r.receivable_id && canWrite() ? '<button class="btn btn-sm" type="button" data-action="rv-paid" data-id="' + esc(r.receivable_id) + '" data-amount="' + esc(r.amount) + '" data-name="' + esc(r.name) + '">Mark paid</button>' : '<a class="btn btn-sm btn-ghost" href="#lead=' + encodeURIComponent(r.id) + '">Open</a>') },
    ], rows, { mid: true, empty: empty("No instalments due", "Win a deal on a payment plan with an instalment count and its schedule shows here a week before each date.", true) });
  }

  function activityCard(a) {
    if (!a) return "";
    const o = a.overall || {};
    return card({
      title: "Speed to lead & setter activity",
      sub: "Application to first human touch (dial, SMS, email or DM) in the period: median " + (isNum(o.median_min) ? n1(o.median_min) + " min" : "—") + ", " + (isNum(o.within5_pct) ? pc(o.within5_pct) : "—") + " within 5 minutes, over " + n(o.n || 0) + " leads. Log touches from Today or a lead's Calls tab.",
      flush: true,
      body: table([
        { label: "Rep", get: (r) => '<span class="t-name">' + esc(r.name) + "</span>" },
        { label: "Median to first touch", num: true, get: (r) => (isNum(r.speed.median_min) ? esc(n1(r.speed.median_min)) + " min" : '<span class="faint">—</span>') + '<span class="sub">' + esc(n(r.speed.n)) + " leads</span>" },
        { label: "Within 5 min", num: true, get: (r) => (isNum(r.speed.within5_pct) ? badge(pc(r.speed.within5_pct), r.speed.within5_pct >= 50 ? "b-green" : r.speed.within5_pct >= 20 ? "b-amber" : "b-red") : '<span class="faint">—</span>') },
        { label: "Dials", num: true, get: (r) => esc(n(r.dials)) },
        { label: "Connects", num: true, get: (r) => esc(n(r.connects)) + (r.dials ? '<span class="sub">' + esc(pc((r.connects / r.dials) * 100)) + "</span>" : "") },
        { label: "Sets", num: true, get: (r) => esc(n(r.sets)) },
        { label: "Set → show", num: true, get: (r) => esc(pc(r.set_show_pct)) },
      ], a.reps || [], { mid: true, empty: empty("No touches logged yet", "When setters and closers log dials and messages, speed to lead and activity show here.", true) }),
    });
  }

  // ── Today ──────────────────────────────────────────────────────────────────
  TAB.today.load = async () => {
    const d = await api("/today", { query: S.todayRep ? "rep=" + encodeURIComponent(S.todayRep) : "" });
    if (isManager() && !S.repList) { try { S.repList = (await api("/team")).reps.filter((r) => r.active); } catch (e) { S.repList = []; } }
    return d;
  };
  TAB.today.render = (d) => {
    S.today = d;
    if (d.linked === false) return unlinkedCallout();
    const picker = isManager() && S.repList && S.repList.length ? '<div class="row wrap mb12">' + sel("rep", [{ value: "", label: "Everyone" }].concat(S.repList.map((r) => ({ value: r.id, label: r.name }))), S.todayRep || "", { change: "today-rep", label: "Rep" }) + '<span class="faint small">Showing ' + esc(S.todayRep ? "one rep" : "the whole team") + "</span></div>" : "";
    const st = d.stats;
    const tiles = kpis([
      kpi("Calls today", esc(n(st.calls)), d.calls.filter((c) => c.needs_outcome).length ? esc(n(d.calls.filter((c) => c.needs_outcome).length)) + " need an outcome" : "In your time zone"),
      kpi("New A/B waiting", esc(n(st.fresh)), "Applied, nobody has called yet"),
      kpi("Follow-ups due", esc(n(st.follow_ups)), "Today or overdue"),
      kpi("Payments due", esc(n(st.payments_due)), "Instalments this week"),
    ], "today-kpis");
    const calls = d.calls.length ? '<div class="prep-list">' + d.calls.map(prepCard).join("") + "</div>" : empty("No calls today", "Booked calls for today show here with a prep card.", true);
    const SLA = ["sla-0", "sla-1", "sla-2", "sla-3"], SLA_TXT = ["Under 5 min", "Over 5 min: rep pinged", "Over 30 min: managers pinged", "Over 2 h: reassign offered"];
    const fresh = card({
      title: "New A/B leads not yet touched",
      sub: "The clock runs in sales hours (" + (d.sales_hours || "Mon–Fri 09:00–18:00") + ")" + (d.in_hours === false ? " and is paused now" : "") + ". Green under 5 min, amber past 5 (rep pinged), red past 30 (managers), dark past 2 h (reassign).", flush: true,
      body: d.fresh.length ? '<ul class="today-list">' + d.fresh.map((r) => {
        const lvl = Math.max(0, Math.min(3, r.sla_level || 0));
        return '<li class="today-row ' + SLA[lvl] + '"><span class="sla-bar" aria-hidden="true"></span><div class="today-main">' + leadLink(r.id, r.name) + " " + tierBadge(r.tier) +
          (r.also && r.also.length ? ' <span class="badge plain b-grey" title="' + esc("Applied " + (r.also.length + 1) + " times: " + r.also.map((a) => a.ref_code).join(", ")) + '">+' + esc(r.also.length) + " more</span>" : "") +
          '<span class="sub"><span class="sr-only">' + esc(SLA_TXT[lvl]) + '. </span>Waiting <span class="tnum"' + (d.in_hours === false ? "" : ' data-sla="' + esc(r.sla_ms) + '" data-loaded="' + esc(Date.now()) + '"') + ">" + esc(waitedMs(r.sla_ms)) + "</span>" + (d.in_hours === false ? " (paused)" : "") + (r.closer ? " · " + esc(r.closer) : " · unassigned") + "</span></div>" +
          '<div class="today-actions">' + telBtn(r.phone, true) + (canWrite() ? '<button class="btn btn-sm" type="button" data-action="today-touch" data-id="' + esc(r.id) + '" data-name="' + esc(r.name) + '">Log touch</button>' : "") + "</div></li>";
      }).join("") + "</ul>"
        : empty("Inbox zero", "Every new A and B lead from the last 7 days has been touched.", true),
    });
    const fu = card({
      title: "Follow-ups due", flush: true,
      body: d.follow_ups.length ? '<ul class="today-list">' + d.follow_ups.map((r) =>
        '<li class="today-row"><div class="today-main">' + leadLink(r.id, r.name) + " " + tierBadge(r.tier) + (r.plan_viewed ? " " + planSignal(r.plan_viewed) : "") + '<span class="sub">' + esc(day(r.due_at)) + " " + (r.overdue ? badge("Overdue", "b-red") : badge("Today", "b-amber")) + " " + statusBadge(r.status) + "</span></div>" +
        '<div class="today-actions">' + (canWrite() ? '<button class="btn btn-sm" type="button" data-action="today-touch" data-id="' + esc(r.id) + '" data-name="' + esc(r.name) + '">Log touch</button>' : "") + '<a class="btn btn-sm btn-ghost" href="#lead=' + encodeURIComponent(r.id) + '">Open</a></div></li>').join("") + "</ul>"
        : empty("No follow-ups due", "Set a follow-up date on a lead and it shows here on the day.", true),
    });
    const pay = card({ title: "Payments due", flush: true, body: dueTable(d.payments_due) });
    return picker + tiles + '<h2 class="section-title">' + (d.scoped ? "My calls today" : "Calls today") + "</h2>" + calls + '<div class="grid g2 mt16">' + fresh + fu + "</div>" + pay;
  };
  function prepCard(c) {
    const answers = c.key_answers || [];
    const top = answers.slice(0, 4), rest = answers.slice(4);
    const dl = (list) => '<dl class="prep-answers">' + list.map((a) => "<dt>" + esc(label(a.q)) + "</dt><dd>" + esc(a.a) + "</dd>").join("") + "</dl>";
    return '<article class="prep' + (c.needs_outcome ? " due" : "") + '">' +
      '<div class="prep-head"><div class="prep-time tnum">' + esc(hm(c.call_at)) + '</div><div class="prep-who">' + leadLink(c.id, c.name) + " " + tierBadge(c.tier) + " " + statusBadge(c.status) +
      '<div class="sub">' + esc([c.ref_code, c.closer, isNum(c.score) ? "score " + c.score : ""].filter(Boolean).join(" · ")) + "</div></div>" + (c.needs_outcome ? badge("Needs outcome", "b-red") : riskBadgeOf(c.noshow_risk)) + "</div>" +
      (c.plan_viewed ? '<div class="row mt8">' + planSignal(c.plan_viewed) + "</div>" : "") +
      '<div class="prep-facts"><span>Film ' + (isNum(c.watched_pct) ? "<strong>" + esc(c.watched_pct) + "%</strong>" : "not played") + "</span>" + (isNum(c.p_win) ? "<span>Win prob. <strong>" + esc(pp(c.p_win)) + "</strong></span>" : "") + "<span>" + esc(n(c.touches)) + " touches</span></div>" +
      (c.noshow_reasons && c.noshow_reasons.length && !c.needs_outcome ? '<p class="small faint">No-show signals: ' + esc(c.noshow_reasons.join(" · ")) + "</p>" : "") +
      (top.length ? dl(top) : "") + (rest.length ? '<details class="prep-more"><summary>More answers</summary>' + dl(rest) + "</details>" : "") +
      (c.objections && c.objections.length ? '<div class="prep-obj"><span class="field-label">Likely objections</span><div class="chips">' + c.objections.map((o) => '<span class="chip" title="' + esc(o.why) + '">' + esc(o.objection) + '<span class="chip-why">' + esc(o.why) + "</span></span>").join("") + "</div></div>" : "") +
      '<div class="prep-actions">' + telBtn(c.phone, true) + (c.join_url ? '<a class="btn btn-sm" href="' + esc(c.join_url) + '" target="_blank" rel="noopener noreferrer">Join</a>' : "") +
      (canWrite() ? '<button class="btn btn-sm" type="button" data-action="today-touch" data-id="' + esc(c.id) + '" data-name="' + esc(c.name) + '">Log touch</button><button class="btn btn-sm" type="button" data-action="today-outcome" data-id="' + esc(c.id) + '" data-name="' + esc(c.name) + '" data-status="' + esc(c.status) + '" data-call-at="' + esc(c.call_at || "") + '">Log outcome</button><button class="btn btn-sm" type="button" data-action="today-pay" data-id="' + esc(c.id) + '" data-name="' + esc(c.name) + '">Log payment</button>' : "") +
      "</div></article>";
  }
  function touchForm(id, kinds, outcomes) {
    kinds = kinds || ["dial", "connect", "voicemail", "sms", "email", "dm"];
    outcomes = outcomes || ["booked", "follow_up", "not_interested", "wrong_number", "no_answer", "left_message"];
    const K = { dial: "Dial (no answer)", connect: "Connected", voicemail: "Voicemail", sms: "SMS", email: "Email", dm: "DM" };
    return '<form data-submit="touch-save" data-id="' + esc(id) + '" class="form-grid"><div class="field span-all"><span class="field-label">What did you do?</span><div class="seg seg-wrap" role="radiogroup" aria-label="Touch">' +
      kinds.map((k, i) => '<label class="seg-radio"><input type="radio" name="kind" value="' + esc(k) + '"' + (i === 0 ? " checked" : "") + "><span>" + esc(K[k] || label(k)) + "</span></label>").join("") + "</div></div>" +
      field("Outcome", sel("outcome", [{ value: "", label: "—" }].concat(outcomes.map((o) => ({ value: o, label: label(o) }))), "")) +
      field("Note", '<input class="input" name="note" maxlength="500" placeholder="Optional">') +
      '<div class="form-actions span-all"><button class="btn" type="button" data-action="modal-close">Cancel</button><button class="btn btn-primary" type="submit">Log touch</button></div></form>';
  }
  function outcomeForm(id, status, callAt) {
    const reasons = (S.today && S.today.lost_reasons) || ["Price", "Timing", "Chose agency", "Built in-house", "No response", "Not a fit", "Trust", "Other"];
    return '<div class="stack gap16">' + (status === "booked" && callNotYet(callAt) ? '<p class="small faint">This call hasn\'t happened yet. Showed and no-show open 10 minutes before the start.</p>' : "") + (status === "booked" && !callNotYet(callAt) ? '<div class="row wrap"><button class="btn btn-primary" type="button" data-action="held-open" data-id="' + esc(id) + '">Showed: review and plan…</button><button class="btn" type="button" data-action="today-quick" data-id="' + esc(id) + '" data-status="no_show">No-show</button></div>' : "") +
      '<form data-submit="today-won" data-id="' + esc(id) + '" class="form-grid">' + field("Deal value (USD)", '<input class="input" name="revenue" type="number" min="1" step="1" required inputmode="numeric">') +
      field("Payment plan", sel("plan", [{ value: "full", label: "Paid in full" }, { value: "2", label: "2 instalments" }, { value: "3", label: "3 instalments" }, { value: "6", label: "6 instalments" }, { value: "12", label: "12 instalments" }], "full")) +
      '<div class="form-actions span-all"><button class="btn btn-primary" type="submit">Won</button></div></form>' +
      '<form data-submit="today-lost" data-id="' + esc(id) + '" class="form-grid">' + field("Lost reason", sel("lost_reason", [{ value: "", label: "Pick a reason" }].concat(reasons.map((r) => ({ value: r, label: r }))), "")) +
      '<div class="form-actions span-all"><button class="btn" type="submit">Lost</button></div></form></div>';
  }
  function paymentForm(id, amount) {
    return '<form data-submit="today-payment" data-id="' + esc(id) + '" class="form-grid">' + field("Amount (USD)", '<input class="input" name="amount" type="number" step="1" required inputmode="numeric" value="' + esc(amount || "") + '">') +
      field("Paid on", '<input class="input" name="paid_at" type="date" value="' + esc(dateInput(Date.now())) + '">') + field("Method", '<input class="input" name="method" maxlength="40" placeholder="Stripe, bank transfer">') +
      '<div class="form-actions span-all"><button class="btn" type="button" data-action="modal-close">Cancel</button><button class="btn btn-primary" type="submit">Record payment</button></div></form>';
  }

  // ── Pipeline & forecast ────────────────────────────────────────────────────
  const STAGE_LABEL = { booked: "Booked", held: "Held – follow-up", verbal: "Verbal – contract out", won_plan: "Won – payment plan", won_paid: "Won – paid in full" };
  TAB.pipeline.load = () => Promise.all([api("/pipeline"), api("/receivables", { query: "days=30" })]).then((r) => Object.assign(r[0], { receivables: r[1].rows || [] }));
  TAB.pipeline.render = (d) => {
    if (d.linked === false) return unlinkedCallout();
    S.pipeline = d;
    const f = d.forecast || [];
    const cur = f[0] || {}, nxt = f[1] || {};
    const open = d.stages.filter((s) => ["booked", "held", "verbal"].includes(s.id)).reduce((t, s) => t + s.count, 0);
    const pctOf = (a, b) => (b ? (a / b) * 100 : null);
    const tiles = kpis([
      kpi("Weighted pipeline", esc(moneyShort(d.weighted)), esc(n(open)) + " open deals × P(win | stage, tier)"),
      kpi("This month, expected", esc(moneyShort(cur.expected)), cur.target ? esc(pc(pctOf(cur.expected, cur.target))) + " of " + esc(moneyShort(cur.target)) + " target" : "No rep targets set"),
      kpi("Collected so far", esc(moneyShort(cur.collected)), esc(moneyShort(cur.scheduled)) + " more scheduled"),
      kpi("Next month, expected", esc(moneyShort(nxt.expected)), esc(n(nxt.calls)) + " calls booked"),
    ]);
    const monthName = (k) => { const p = String(k).split("-"); return p.length === 2 ? MONTHS[Number(p[1]) - 1] + " " + p[0] : k; };
    const fc = card({
      title: "Cash forecast", sub: "Commit = collected + instalments due + verbal deals. Expected weights held/verbal deals and booked calls by P(show) × P(close) × average deal. Best case assumes everyone who shows buys. New deals count at the share of a deal usually collected in the first month (" + esc(pc((d.probs.cash_share || 0) * 100)) + ").", flush: true,
      body: table([
        { label: "Month", get: (r) => '<span class="t-name">' + esc(monthName(r.key)) + "</span>" },
        { label: "Collected", num: true, get: (r) => esc(money(r.collected)) },
        { label: "Instalments due", num: true, get: (r) => esc(money(r.scheduled)) },
        { label: "Commit", num: true, get: (r) => esc(money(r.commit)) },
        { label: "Expected", num: true, get: (r) => "<strong>" + esc(money(r.expected)) + "</strong>" },
        { label: "Best case", num: true, get: (r) => esc(money(r.best)) },
        { label: "Target", num: true, get: (r) => (r.target ? esc(money(r.target)) : '<span class="faint">—</span>') },
        { label: "vs target", get: (r) => (r.target ? '<div class="cell-bar"><div class="bar-track"><div class="bar-fill ' + (r.expected >= r.target ? "c3" : "c2") + '"' + w(pctOf(r.expected, r.target)) + '></div></div><span class="faint small tnum">' + esc(pc(pctOf(r.expected, r.target))) + "</span></div>" : '<span class="faint small">Set monthly targets on Team</span>') },
      ], f),
    });
    const board = '<div class="board" role="list">' + d.stages.map((s) =>
      '<section class="pipe-col" data-stage="' + esc(s.id) + '" role="listitem" aria-label="' + esc(s.label) + '"><header class="pipe-col-head"><div><div class="pipe-col-title">' + esc(s.label) + '</div><div class="sub">' + esc(n(s.count)) + " · " + esc(moneyShort(s.value)) + (["booked", "held", "verbal"].includes(s.id) ? " · weighted " + esc(moneyShort(s.weighted)) : "") + "</div></div></header>" +
      '<div class="pipe-cards">' + (s.cards.length ? s.cards.map(pipeCard).join("") : '<p class="faint small pipe-empty">Nothing here</p>') + "</div></section>").join("") + "</div>";
    const P = d.probs;
    const probs = card({
      title: "Stage probabilities", sub: "P(won | stage, tier). From your last 365 days where a cell has 20+ outcomes, otherwise a fixed starting value. Average deal " + money(P.avg_deal) + ".", flush: true,
      body: table([{ label: "Stage", get: (r) => esc(STAGE_LABEL[r]) }].concat(["A", "B", "C"].map((t) => ({ label: "Tier " + t, num: true, get: (r) => esc(pp(P.p[r][t])) + (P.source[r][t] === "history" ? "" : '<span class="sub">starting value</span>') }))), ["booked", "held", "verbal"]),
    });
    const rv = card({ title: "Payments due / overdue", sub: "Pending instalments due within 30 days or overdue.", flush: true, body: dueTable(d.receivables || []) });
    return tiles + fc + '<h2 class="section-title">Board' + (canWrite() ? ' <span class="faint small">· drag a card to move it, or use its menu</span>' : "") + "</h2>" + board + '<div class="grid g2 mt16">' + rv + probs + "</div>";
  };
  function pipeCard(c) {
    const future = c.stage === "booked" && callNotYet(c.call_at);
    const moves = ["held", "verbal", "won_plan", "won_paid"].filter((s) => s !== c.stage && !(future && (s === "held" || s === "verbal")));
    return '<article class="pipe-card" draggable="' + (canWrite() ? "true" : "false") + '" data-id="' + esc(c.id) + '" data-stage="' + esc(c.stage) + '" data-name="' + esc(c.name) + '"' + (future ? ' data-future="1"' : "") + '>' +
      '<div class="pipe-card-top">' + leadLink(c.id, c.name) + tierBadge(c.tier) + "</div>" +
      '<div class="pipe-card-meta">' + esc(c.closer || "Unassigned") + (c.temperature ? " " + badge(label(c.temperature), TEMP_CLS[c.temperature] || "b-grey") : "") + "</div>" +
      '<div class="pipe-card-nums"><span class="tnum">' + esc(moneyShort(c.value)) + (c.value_is_estimate ? '<span class="faint" title="Average deal: no value set yet"> est.</span>' : "") + "</span>" +
      (isNum(c.p) ? '<span class="faint tnum">' + esc(pp(c.p)) + " → " + esc(moneyShort(c.expected)) + "</span>" : isNum(c.remaining) ? '<span class="faint tnum">' + esc(moneyShort(c.remaining)) + " to collect</span>" : "") + "</div>" +
      '<div class="pipe-card-foot"><span class="faint small">' + (c.stage === "booked" && c.call_at ? esc(dt(c.call_at)) : isNum(c.days_in_stage) ? esc(c.days_in_stage) + "d in stage" : "") + "</span>" +
      (c.needs_outcome ? badge("Needs outcome", "b-red") : c.stage === "booked" ? riskBadgeOf(c.noshow_risk) : "") + "</div>" +
      (canWrite() ? '<select class="select sm pipe-move" data-change="pipe-move" data-id="' + esc(c.id) + '" aria-label="Move ' + esc(c.name) + '"><option value="">Move to…</option>' + moves.map((s) => '<option value="' + s + '">' + esc(STAGE_LABEL[s]) + "</option>").join("") + "</select>" : "") +
      "</article>";
  }
  async function movePipeline(id, stage, name) {
    if (stage === "won_plan" || stage === "won_paid") {
      openModal("Won: " + (name || "deal"), '<form data-submit="pipe-won" data-id="' + esc(id) + '" data-stage="' + esc(stage) + '" class="form-grid">' +
        field("Deal value (USD)", '<input class="input" name="revenue" type="number" min="1" step="1" required inputmode="numeric">') +
        (stage === "won_plan" ? field("Instalments", '<input class="input" name="installments" type="number" min="2" max="60" step="1" value="3" required>') : "") +
        '<div class="form-actions span-all"><button class="btn" type="button" data-action="modal-close">Cancel</button><button class="btn btn-primary" type="submit">Mark won</button></div></form>', true);
      return;
    }
    try { await api("/pipeline/move", { method: "POST", body: { lead_id: id, stage } }); toast("Moved to " + STAGE_LABEL[stage]); loadTab(true); } catch (e) { fail(e); loadTab(true); }
  }
  let dragId = null;
  document.addEventListener("dragstart", (ev) => {
    const c = ev.target.closest && ev.target.closest(".pipe-card[draggable='true']");
    if (!c) return;
    dragId = c.dataset.id;
    c.classList.add("dragging");
    try { ev.dataTransfer.setData("text/plain", dragId); ev.dataTransfer.effectAllowed = "move"; } catch (e) { /* old browsers */ }
  });
  document.addEventListener("dragend", (ev) => { const c = ev.target.closest && ev.target.closest(".pipe-card"); if (c) c.classList.remove("dragging"); $$(".pipe-col.over").forEach((x) => x.classList.remove("over")); });
  document.addEventListener("dragover", (ev) => {
    const col = ev.target.closest && ev.target.closest(".pipe-col");
    if (!col || !dragId) return;
    ev.preventDefault();
    $$(".pipe-col.over").forEach((x) => { if (x !== col) x.classList.remove("over"); });
    col.classList.add("over");
  });
  document.addEventListener("drop", (ev) => {
    const col = ev.target.closest && ev.target.closest(".pipe-col");
    if (!col || !dragId) return;
    ev.preventDefault();
    col.classList.remove("over");
    const card = $('.pipe-card[data-id="' + CSS.escape(dragId) + '"]');
    const id = dragId; dragId = null;
    if (!card || card.dataset.stage === col.dataset.stage) return;
    if (col.dataset.stage === "booked") { toast("Calls move to Booked when they are booked.", "err"); return; }
    if (card.dataset.future && (col.dataset.stage === "held" || col.dataset.stage === "verbal")) { toast("This call hasn't happened yet.", "err"); return; }
    movePipeline(id, col.dataset.stage, card.dataset.name);
  });

  // Lead drawer: instalments and touches.
  function receivablesCard(d) {
    const rows = d.receivables || [];
    if (!rows.length) return "";
    const ST = { pending: ["Pending", "b-amber"], paid: ["Paid", "b-green"], cancelled: ["Cancelled", "b-grey"] };
    return card({
      title: "Instalments", sub: "Created when the deal is won on a plan with an instalment count. Payments recorded below pay the oldest pending one.", flush: true,
      body: table([
        { label: "#", num: true, get: (r) => esc(r.seq) },
        { label: "Due", get: (r) => esc(day(r.due_at)) + (r.status === "pending" && r.due_at < Date.now() ? " " + badge("Overdue", "b-red") : "") },
        { label: "Amount", num: true, get: (r) => esc(money(r.amount)) },
        { label: "Status", get: (r) => badge(ST[r.status][0], ST[r.status][1]) },
        { label: "", get: (r) => (r.status === "pending" && canWrite() ? '<button class="btn btn-sm" type="button" data-action="rv-paid" data-id="' + esc(r.id) + '" data-amount="' + esc(r.amount) + '" data-name="instalment ' + esc(r.seq) + '">Mark paid</button>' : "") },
      ], rows),
    });
  }
  function touchesCard(d) {
    const rows = d.touches || [];
    return card({
      title: "Touches", sub: "Dials, messages and connects by the team. The first one sets this lead's speed to lead.", flush: true,
      actions: canWrite() ? '<button class="btn btn-sm" type="button" data-action="today-touch" data-id="' + esc(d.lead.id) + '" data-name="' + esc([d.lead.first_name, d.lead.last_name].filter(Boolean).join(" ")) + '">Log touch</button>' + (d.lead.phone ? " " + telBtn(d.lead.phone) : "") : "",
      body: table([
        { label: "When", get: (r) => esc(dt(r.at)) + '<span class="sub">' + esc(ago(r.at)) + "</span>" },
        { label: "What", get: (r) => esc(label(r.kind)) + (r.outcome ? '<span class="sub">' + esc(label(r.outcome)) + "</span>" : "") },
        { label: "Who", get: (r) => esc(r.rep || "—") },
        { label: "Note", cls: "wrap", get: (r) => esc(r.note || "") },
      ], rows, { empty: empty("No touches yet", "Log each dial, voicemail, SMS, email or DM so speed to lead is measured.", true) }),
    });
  }

  // ── Team → Users ───────────────────────────────────────────────────────────
  S.teamView = "reps";
  const teamLoad = TAB.team.load, teamRender = TAB.team.render, teamActions = TAB.team.actions;
  TAB.team.load = () => (S.teamView === "users" ? api("/users").then((d) => Object.assign(d, { _view: "users" })) : teamLoad());
  TAB.team.actions = () => (S.teamView === "users" ? '<button class="btn btn-primary" type="button" data-action="user-new">Add user</button>' : isManager() ? teamActions() : "");
  TAB.team.render = (d) => {
    const seg = isManager() ? '<div class="row between wrap"><div class="seg" role="group" aria-label="View">' + [["reps", "Reps"], ["users", "Users & access"]].map((v) => '<button type="button" data-action="team-view" data-view="' + v[0] + '" aria-pressed="' + (S.teamView === v[0]) + '">' + v[1] + "</button>").join("") + "</div></div>" : "";
    if (d._view !== "users") return seg + teamRender(d);
    S.users = d.users; S.userReps = d.reps;
    const repName = (id) => (d.reps.find((r) => r.id === id) || {}).name || id || "—";
    const ROLE_CLS = { owner: "b-blue", manager: "b-blue", closer: "b-green", setter: "b-green", viewer: "b-grey" };
    return seg + '<div class="callout"><span class="callout-dot"></span><div>People sign in with a one-time link sent to their email (15 minutes, single use). Closers and setters see only their own leads and cannot open Integrations, Team, exports or erase; viewers can look but not change anything. The admin password still works as the owner\'s break-glass login.</div></div>' +
      card({ title: "Users", flush: true, body: table([
        { label: "Person", get: (r) => '<span class="t-name">' + esc(r.name || r.email) + '</span><span class="sub">' + esc(r.email) + "</span>" },
        { label: "Role", get: (r) => badge(label(r.role), ROLE_CLS[r.role]) },
        { label: "Rep", get: (r) => esc(r.rep_id ? repName(r.rep_id) : "—") },
        { label: "Last sign-in", get: (r) => (r.last_login_at ? esc(ago(r.last_login_at)) : '<span class="faint">Never</span>') },
        { label: "Status", get: (r) => (r.active ? badge("Active", "b-green") : badge("Off", "b-grey")) },
        { label: "", get: (r) => '<button class="btn btn-sm" type="button" data-action="user-edit" data-id="' + esc(r.id) + '">Edit</button>' },
      ], d.users, { empty: empty("No users yet", "Add your closers, setters and managers. Until then, sign in with the admin password.") }) });
  };
  function userForm(u) {
    u = u || { role: "closer", active: 1 };
    const reps = [{ value: "", label: "Not linked" }].concat((S.userReps || []).filter((r) => r.active || r.id === u.rep_id).map((r) => ({ value: r.id, label: r.name + " (" + r.role + ")" })));
    const roles = (S.me && S.me.role === "owner" ? ["owner"] : []).concat(["manager", "closer", "setter", "viewer"]);
    return '<form data-submit="user-save" data-id="' + esc(u.id || "") + '" class="form-grid">' +
      field("Email", '<input class="input" type="email" name="email" required maxlength="200" value="' + esc(u.email || "") + '">') +
      field("Name", '<input class="input" name="name" maxlength="80" value="' + esc(u.name || "") + '">') +
      field("Role", sel("role", roles.concat(u.role && !roles.includes(u.role) ? [u.role] : []).map((r) => ({ value: r, label: label(r) })), u.role)) +
      field("Rep (closers and setters)", sel("rep_id", reps, u.rep_id || "")) +
      '<label class="field span-all"><span class="switch"><input type="checkbox" name="active"' + (u.active ? " checked" : "") + '><span class="switch-track"></span><span>Can sign in</span></span></label>' +
      '<div class="form-actions span-all"><button class="btn" type="button" data-action="modal-close">Cancel</button><button class="btn btn-primary" type="submit">Save</button></div></form>';
  }

  // ── Activity log ───────────────────────────────────────────────────────────
  S.activity = { entity: "", page: 1 };
  TAB.activity.load = () => api("/audit", { query: new URLSearchParams({ entity: S.activity.entity, page: String(S.activity.page) }).toString() });
  TAB.activity.render = (d) => {
    const ents = [["", "Everything"], ["lead", "Leads"], ["payment", "Payments"], ["setting", "Settings"], ["user", "Users & sign-ins"], ["rep", "Reps"], ["map", "Funnel map"], ["api_key", "API keys"], ["webhook", "Webhooks"]];
    const short = (o) => (o && typeof o === "object" ? Object.entries(o).slice(0, 6).map((e) => e[0] + ": " + (typeof e[1] === "object" ? JSON.stringify(e[1]) : String(e[1]))).join(", ") : "");
    const bar = '<div class="row wrap mb12">' + sel("entity", ents.map((e) => ({ value: e[0], label: e[1] })), S.activity.entity, { change: "activity-entity", label: "Show" }) + "</div>";
    const tbl = table([
      { label: "When", get: (r) => esc(dt(r.ts)) + '<span class="sub">' + esc(ago(r.ts)) + "</span>" },
      { label: "Who", get: (r) => esc(r.who) },
      { label: "Action", get: (r) => esc(label(r.action)) },
      { label: "On", get: (r) => (r.entity === "lead" && r.lead_target && r.action !== "lead_erase" ? leadLink(r.lead_target, r.lead_state === "merged" ? "Lead (merged)" : "Lead") : r.entity === "lead" && r.lead_state === "erased" ? '<span class="faint">Lead (erased)</span>' : esc(label(r.entity))) + (r.entity_id && r.entity !== "lead" ? '<span class="sub mono">' + esc(r.entity_id) + "</span>" : "") },
      { label: "Change", cls: "wrap", get: (r) => (r.before ? '<span class="faint small">' + esc(short(r.before)) + "</span>" : "") + (r.before && r.after ? " → " : "") + (r.after ? '<span class="small">' + esc(short(r.after)) + "</span>" : "") },
    ], d.rows, { empty: empty("Nothing logged yet", "Changes in Funnel HQ are recorded here from now on.") });
    const pager = d.page > 1 || d.more ? '<div class="pager"><span>Page ' + esc(d.page) + '</span><div class="row"><button class="btn btn-sm" type="button" data-action="activity-page" data-page="' + esc(d.page - 1) + '"' + (d.page <= 1 ? " disabled" : "") + '>Newer</button><button class="btn btn-sm" type="button" data-action="activity-page" data-page="' + esc(d.page + 1) + '"' + (d.more ? "" : " disabled") + ">Older</button></div></div>" : "";
    return bar + '<section class="card">' + tbl + pager + "</section>";
  };

  // ── Data quality ───────────────────────────────────────────────────────────
  TAB.quality.load = () => Promise.all([api("/data-quality"), api("/duplicates")]).then((r) => ({ q: r[0], dups: r[1] }));
  TAB.quality.render = (d) => {
    const q = d.q;
    const tiles = kpis([
      kpi("Missing phone", esc(pc(q.missing_phone_pct)), esc(n(q.missing_phone)) + " of " + esc(n(q.applied)) + " applications, 90 days"),
      kpi("Unmatched bookings", esc(n(q.unmatched_bookings)), q.bookings ? esc(pc(q.unmatched_bookings_pct)) + " of Calendly bookings have no lead" : "No Calendly bookings in 90 days"),
      kpi("No source", esc(pc(q.no_source_pct)), esc(n(q.no_source)) + (q.no_source === 1 ? " lead" : " leads") + " with no channel or UTM"),
      kpi("Duplicate candidates", esc(n(q.duplicate_candidates)), "Same phone, browser, or name at a company domain"),
    ]);
    const who = (l) => leadLink(l.id, [l.first_name, l.last_name].filter(Boolean).join(" ") || l.email) + '<span class="sub">' + esc(l.email) + (l.phone ? " · " + esc(l.phone) : "") + "</span>";
    const dups = card({
      title: "Possible duplicates", sub: "Merging keeps the earlier lead, moves every visit, email, call, booking and payment onto it, keeps the further pipeline stage, cancels the duplicate's sequences, then erases the duplicate.", flush: true,
      body: table([
        { label: "Keep (earlier)", get: (p) => who(p.survivor) + '<span class="sub">' + esc(day(p.survivor.created_at)) + " · " + esc(STATUS_LABEL[p.survivor.status] || p.survivor.status) + "</span>" },
        { label: "Merge in", get: (p) => who(p.loser) + '<span class="sub">' + esc(day(p.loser.created_at)) + " · " + esc(STATUS_LABEL[p.loser.status] || p.loser.status) + "</span>" },
        { label: "Why", get: (p) => p.reasons.map((r) => badge(r, "b-blue")).join(" ") },
        { label: "", get: (p) => (isManager() ? '<button class="btn btn-sm" type="button" data-action="merge" data-id="' + esc(p.loser.id) + '" data-into="' + esc(p.survivor.id) + '" data-ref="' + esc(p.loser.ref_code) + '">Merge</button>' : "") },
      ], d.dups.pairs, { empty: empty("No duplicates found", "Leads that share a phone, a browser, or a name at a company domain show here.", true) }),
    });
    return tiles + dups;
  };

  // ── Learned routing card (Insights → Scoring) ──────────────────────────────
  function learnedCard(L) {
    if (!L) return "";
    const owner = S.me && S.me.role === "owner";
    const btn = owner && !L.locked ? (L.on ? '<button class="btn btn-sm" type="button" data-action="learned" data-on="0">Switch back to config points</button>' : '<button class="btn btn-sm btn-primary" type="button" data-action="learned" data-on="1"' + (L.available ? "" : " disabled") + ">Use learned points for routing</button>") : "";
    return card({
      title: "Learned points for routing", sub: "Off by default. When on, answer options with " + L.min_n + "+ outcomes score with the calibrated points; every flag and tier cap still comes from config. Each lead records which table scored it.",
      actions: (L.on ? badge("On · " + L.version, "b-green") : badge("Off", "b-grey")) + " " + btn,
      body: L.on ? table([{ label: "Answer", get: (r) => esc(r.key.replace("=", ": ").replace(/_/g, " ")) }, { label: "Points", num: true, get: (r) => esc(r.points) }, { label: "Outcomes", num: true, get: (r) => esc(n(r.n)) }], L.points, { mid: true })
        : '<p class="small faint">' + esc(n(L.available)) + " answer options have enough outcomes. " + (owner ? "" : "Only the owner can switch this on.") + "</p>",
    });
  }

  // ── Attribution & cohorts ──────────────────────────────────────────────────
  S.attr = { view: store.get("hq-attr-view", "models"), model: "last_non_direct", dim: "campaign", by: "month" };
  const MODELS = [["first", "First touch"], ["last_non_direct", "Last non-direct"], ["linear", "Linear"], ["position", "Position (40/20/40)"], ["time_decay", "Time decay (7-day half-life)"]];
  TAB.attribution.load = () => {
    const a = S.attr;
    if (a.view === "cohorts") return api("/cohorts", { query: "by=" + a.by }).then((d) => Object.assign(d, { _view: "cohorts" }));
    return api("/attribution", { query: qs({ model: a.model, dim: a.dim }) }).then((d) => Object.assign(d, { _view: a.view }));
  };
  TAB.attribution.actions = () => (isManager() ? '<a class="btn" href="/admin/api/exports/' + (S.attr.view === "cohorts" ? "cohorts.csv?by=" + esc(S.attr.by) : "attribution.csv?" + esc(qs({ model: S.attr.model, dim: S.attr.dim }))) + '" download>Export CSV</a>' : "");
  TAB.attribution.render = (d) => {
    const a = S.attr;
    const seg = '<div class="row between wrap"><div class="seg" role="group" aria-label="View">' + [["models", "Models"], ["paths", "Top paths"], ["cohorts", "Cohorts"]].map((v) => '<button type="button" data-action="attr-view" data-view="' + v[0] + '" aria-pressed="' + (a.view === v[0]) + '">' + v[1] + "</button>").join("") + "</div>" +
      (d._view === "cohorts" ? '<div class="seg" role="group" aria-label="Cohort size">' + [["week", "Weekly"], ["month", "Monthly"]].map((v) => '<button type="button" data-action="attr-by" data-by="' + v[0] + '" aria-pressed="' + (a.by === v[0]) + '">' + v[1] + "</button>").join("") + "</div>"
        : d._view === "models" ? '<div class="row wrap">' + sel("model", MODELS.map((m) => ({ value: m[0], label: m[1] })), a.model, { change: "attr-model", label: "Model" }) + sel("dim", [{ value: "campaign", label: "By campaign" }, { value: "ad_id", label: "By ad" }, { value: "channel", label: "By channel" }], a.dim, { change: "attr-dim", label: "Dimension" }) + "</div>" : "") + "</div>";
    const note = d.cached_at ? '<p class="faint small mt8">Computed ' + esc(ago(d.cached_at)) + " · refreshed every 10 minutes" + (isNum(d.n_leads) ? " · " + esc(n(d.n_leads)) + " leads" : "") + "</p>" : "";
    if (d._view === "cohorts") return seg + cohortsView(d) + note;
    if (d._view === "paths") {
      return seg + card({ title: "Top paths", sub: "The channels a lead touched before booking, in order (repeats collapsed). Leads created in the period.", flush: true, body: table([
        { label: "Path", cls: "wrap", get: (r) => r.path.map((x) => badge(label(x), "b-grey")).join(' <span class="faint">→</span> ') },
        { label: "Leads", num: true, get: (r) => esc(n(r.leads)) },
        { label: "Booked", num: true, get: (r) => esc(n(r.booked)) },
        { label: "Won", num: true, get: (r) => esc(n(r.wins)) },
        { label: "Cash", num: true, get: (r) => esc(moneyShort(r.cash)) },
      ], d.paths || [], { empty: empty("No paths yet", "Paths appear once leads have sessions before they book.") }) }) + note;
    }
    const t = d.totals || {};
    return seg + card({
      title: (MODELS.find((m) => m[0] === d.model) || [0, d.model])[1] + " credit", sub: "Fractional credit over each lead's non-bot sessions before the moment that counts: lead created, call booked, deal won (revenue and cash). ROAS ties credited cash to spend on the same campaign or ad.", flush: true,
      body: table([
        { label: d.dim === "ad_id" ? "Ad" : d.dim === "channel" ? "Channel" : "Campaign", cls: "wrap", get: (r) => '<span class="t-name">' + esc(r.key) + "</span>" },
        { label: "Leads", num: true, get: (r) => esc(n1(r.leads)) },
        { label: "Booked", num: true, get: (r) => esc(n1(r.booked)) },
        { label: "Won", num: true, get: (r) => esc(n1(r.wins)) },
        { label: "Revenue", num: true, get: (r) => esc(moneyShort(r.revenue)) },
        { label: "Cash", num: true, get: (r) => esc(moneyShort(r.cash)) },
        { label: "Spend", num: true, get: (r) => (r.spend ? esc(moneyShort(r.spend)) : '<span class="faint">—</span>') },
        { label: "Cash ROAS", num: true, get: (r) => esc(roas(r.roas)) },
        { label: "Per booked", num: true, get: (r) => esc(moneyShort(r.cost_per_booked)) },
      ], d.rows || [], { tall: true, foot: ["Total", n1(t.leads), n1(t.booked), n1(t.wins), moneyShort(t.revenue), moneyShort(t.cash), moneyShort(t.spend), roas(t.roas), ""].map(esc), empty: empty("No sessions to credit", "Credit appears once leads have tracked sessions in this period.") }),
    }) + note;
  };
  function cohortsView(d) {
    const DAYS = d.days || [0, 7, 14, 30, 60, 90, 180];
    return card({
      title: (d.by === "week" ? "Weekly" : "Monthly") + " cohorts", sub: "Applicants by the " + d.by + " they first left details. Cash is cumulative from that date; blank cells are cohorts too young for that age. Plan collection = paid instalments ÷ instalments due so far.", flush: true,
      body: table([
        { label: "Cohort", get: (r) => { const p = String(r.cohort).split("-"); return '<span class="t-name nowrap">' + esc(p.length === 2 && !p[1].startsWith("W") ? MONTHS[Number(p[1]) - 1] + " " + p[0] : r.cohort) + "</span>"; } },
        { label: "Leads", num: true, get: (r) => esc(n(r.leads)) },
        { label: "Booked", num: true, get: (r) => esc(n(r.booked)) },
        { label: "Won", num: true, get: (r) => esc(n(r.won)) },
      ].concat(DAYS.map((k) => ({ label: "Cash d" + k, num: true, get: (r) => (r.cash["d" + k] == null ? '<span class="faint">·</span>' : esc(moneyShort(r.cash["d" + k]))) }))).concat([
        { label: "Close p50 / p90", num: true, get: (r) => (isNum(r.ttc_p50_days) ? esc(n1(r.ttc_p50_days)) + " / " + esc(n1(r.ttc_p90_days)) + "d" : '<span class="faint">—</span>') },
        { label: "Plan collected", num: true, get: (r) => esc(pc(r.plan_collection_pct)) },
        { label: "Refunds", num: true, get: (r) => esc(pc(r.refund_pct)) },
        { label: "90-day value / lead", num: true, get: (r) => esc(money(r.value90_per_lead)) },
        { label: "/ booked call", num: true, get: (r) => esc(money(r.value90_per_booked)) },
      ]), d.rows || [], { tall: true, empty: empty("No cohorts yet", "Cohorts fill in as applicants arrive.") }),
    });
  }

  // ── API & webhooks ─────────────────────────────────────────────────────────
  TAB.api.load = () => Promise.all([api("/api-keys"), api("/webhooks")]).then((r) => ({ keys: r[0], hooks: r[1] }));
  TAB.api.render = (d) => {
    const K = d.keys, H = d.hooks;
    const keys = card({
      title: "API keys", sub: "Read-only REST API at /api/v1 (leads, deals, payments, calls, metrics/daily, spend) with Authorization: Bearer <key>. Paginate with ?updated_since=…&cursor=…. Keys are stored as a keyed hash and shown once.", flush: true,
      actions: isManager() ? '<button class="btn btn-sm btn-primary" type="button" data-action="key-new">New key</button>' : "",
      body: table([
        { label: "Name", get: (r) => '<span class="t-name">' + esc(r.name) + '</span><span class="sub mono">fk_' + esc(r.id) + "_…</span>" },
        { label: "Scopes", cls: "wrap", get: (r) => r.scopes.map((s) => badge(s, "b-grey")).join(" ") },
        { label: "Created", get: (r) => esc(day(r.created_at)) },
        { label: "Last used", get: (r) => (r.last_used_at ? esc(ago(r.last_used_at)) : '<span class="faint">Never</span>') },
        { label: "", get: (r) => (r.revoked_at ? badge("Revoked", "b-grey") : isManager() ? '<button class="btn btn-sm btn-ghost btn-danger" type="button" data-action="key-revoke" data-id="' + esc(r.id) + '">Revoke</button>' : badge("Active", "b-green")) },
      ], K.keys, { empty: empty("No API keys", "Create a key for each system that reads from Funnel HQ.", true) }),
    });
    const hooks = card({
      title: "Webhooks", sub: "Signed POSTs for lead events, retried with backoff through the forwarding log. Verify X-Funnel-Signature: t=<unix>,v1=HMAC-SHA256(secret, t + \".\" + body) and dedupe on X-Funnel-Event-Id.", flush: true,
      actions: isManager() ? '<button class="btn btn-sm btn-primary" type="button" data-action="hook-new">New webhook</button>' : "",
      body: table([
        { label: "URL", cls: "wrap", get: (r) => '<span class="mono small">' + esc(r.url) + "</span>" },
        { label: "Events", cls: "wrap", get: (r) => (r.events.includes("*") ? badge("All events", "b-blue") : r.events.map((e) => badge(e, "b-grey")).join(" ")) },
        { label: "Delivered", num: true, get: (r) => esc(n(r.sent)) + (r.failed ? '<span class="sub bad-text">' + esc(n(r.failed)) + " failed</span>" : "") },
        { label: "Status", get: (r) => (r.active ? badge("On", "b-green") : badge("Off", "b-grey")) },
        { label: "", get: (r) => (isManager() ? '<div class="row"><button class="btn btn-sm" type="button" data-action="hook-toggle" data-id="' + esc(r.id) + '" data-on="' + (r.active ? "0" : "1") + '">' + (r.active ? "Pause" : "Resume") + '</button><button class="btn btn-sm btn-ghost btn-danger" type="button" data-action="hook-delete" data-id="' + esc(r.id) + '">Delete</button></div>' : "") },
      ], H.subs, { empty: empty("No webhooks", "Add an https endpoint to receive signed lead events.", true) }),
    });
    const ex = isManager() ? card({ title: "CSV exports", sub: "Uses the date range from the other tabs (last 90 days by default).", body: '<div class="row wrap">' + [["payments", "Payments"], ["calls", "Calls"], ["emails", "Emails"], ["attribution", "Attribution"], ["cohorts", "Cohorts"]].map((x) => '<a class="btn btn-sm" href="/admin/api/exports/' + x[0] + ".csv?" + esc(qs()) + '" download>' + x[1] + "</a>").join("") + "</div>" }) : "";
    return keys + hooks + ex;
  };
  function keyForm(scopes) {
    return '<form data-submit="key-save" class="form-grid">' + field("Name", '<input class="input" name="name" required maxlength="60" placeholder="e.g. HubSpot sync">') +
      '<div class="field span-all"><span class="field-label">Scopes</span><div class="row wrap">' + scopes.map((s) => '<label class="row small"><input type="checkbox" name="scope_' + esc(s) + '" checked> ' + esc(s) + "</label>").join("") + "</div></div>" +
      '<div class="form-actions span-all"><button class="btn" type="button" data-action="modal-close">Cancel</button><button class="btn btn-primary" type="submit">Create key</button></div></form>';
  }
  function hookForm(events) {
    return '<form data-submit="hook-save" class="form-grid">' + field("Endpoint URL", '<input class="input" name="url" type="url" required placeholder="https://…" maxlength="500">', "span-all") +
      '<div class="field span-all"><span class="field-label">Events</span><label class="row small"><input type="checkbox" name="ev_all" checked> All events</label><div class="row wrap">' + events.map((e) => '<label class="row small"><input type="checkbox" name="ev_' + esc(e) + '"> ' + esc(e) + "</label>").join("") + "</div></div>" +
      '<div class="form-actions span-all"><button class="btn" type="button" data-action="modal-close">Cancel</button><button class="btn btn-primary" type="submit">Create webhook</button></div></form>';
  }
  const secretBox = (title, secret, note) => '<div class="stack gap16"><p>' + esc(note) + '</p><code class="mono secret-box">' + esc(secret) + '</code><div class="row">' + copyBtn(secret, "Copy") + '<span class="spacer"></span><button class="btn btn-primary" type="button" data-action="modal-close">Done</button></div></div>';

  TAB.sales.actions = () => (isManager() ? '<button class="btn" type="button" data-action="digest-send">Send digest now</button>' : "");
  TAB.leads.actions = (() => { const orig = TAB.leads.actions; return () => (isManager() ? orig() : ""); })();

  Object.assign(actions, {
    "team-view": (el) => { S.teamView = el.dataset.view === "users" ? "users" : "reps"; renderShell(); loadTab(); },
    "user-new": () => openModal("Add user", userForm(null), true),
    "user-edit": (el) => { const u = (S.users || []).find((x) => x.id === el.dataset.id); if (u) openModal("Edit " + (u.name || u.email), userForm(u), true); },
    "activity-page": (el) => { S.activity.page = Math.max(1, Number(el.dataset.page) || 1); loadTab(); },
    "today-touch": (el) => openModal("Log touch · " + (el.dataset.name || "lead"), touchForm(el.dataset.id, S.today && S.today.touch_kinds, S.today && S.today.touch_outcomes), true),
    "today-outcome": (el) => openModal("Log outcome · " + (el.dataset.name || "lead"), outcomeForm(el.dataset.id, el.dataset.status, Number(el.dataset.callAt) || null), true),
    "today-pay": (el) => openModal("Log payment · " + (el.dataset.name || "lead"), paymentForm(el.dataset.id), true),
    "today-quick": async (el) => {
      el.disabled = true;
      try { await api("/sales/outcome", { method: "POST", body: { lead_id: el.dataset.id, patch: { status: el.dataset.status } } }); closeModal(); toast(el.dataset.status === "no_show" ? "Logged as no-show" : "Logged as showed"); loadTab(true); } catch (e) { el.disabled = false; fail(e); }
    },
    "rv-paid": async (el) => {
      if (!confirm("Record " + money(Number(el.dataset.amount)) + " for " + (el.dataset.name || "this instalment") + " as paid today?")) return;
      el.disabled = true;
      try { await api("/receivables/" + encodeURIComponent(el.dataset.id) + "/paid", { method: "POST", body: {} }); toast("Payment recorded"); if (S.drawer) openLead(S.drawer.id); loadTab(true); } catch (e) { el.disabled = false; fail(e); }
    },
    merge: async (el) => {
      if (!confirm("Merge " + el.dataset.ref + " into the earlier lead? Its history moves over and the duplicate is erased. This cannot be undone.")) return;
      el.disabled = true;
      try { const r = await api("/leads/" + encodeURIComponent(el.dataset.id) + "/merge", { method: "POST", body: { into: el.dataset.into } }); toast("Merged " + r.merged + " into " + r.survivor.ref_code); loadTab(true); } catch (e) { el.disabled = false; fail(e); }
    },
    learned: async (el) => {
      const on = el.dataset.on === "1";
      if (!confirm(on ? "Route new applications with the learned points? Flags and tier caps stay as configured. You can switch back at any time." : "Switch routing back to the points in config?")) return;
      try { const r = await api("/calibration/learned", { method: "POST", body: { on } }); toast(on ? "Learned points on (" + r.options + " options)" : "Back to config points"); loadTab(true); } catch (e) { fail(e); }
    },
    "attr-view": (el) => { S.attr.view = el.dataset.view; store.set("hq-attr-view", S.attr.view); renderShell(); loadTab(); },
    "attr-by": (el) => { S.attr.by = el.dataset.by === "week" ? "week" : "month"; renderShell(); loadTab(); },
    "key-new": () => openModal("New API key", keyForm((S.data && S.data.keys && S.data.keys.scopes) || []), true),
    "key-revoke": async (el) => {
      if (!confirm("Revoke this key? Anything using it stops working at once.")) return;
      try { await api("/api-keys/" + encodeURIComponent(el.dataset.id) + "/revoke", { method: "POST" }); toast("Key revoked"); loadTab(true); } catch (e) { fail(e); }
    },
    "hook-new": () => openModal("New webhook", hookForm((S.data && S.data.hooks && S.data.hooks.events) || []), true),
    "hook-toggle": async (el) => {
      try { await api("/webhooks/" + encodeURIComponent(el.dataset.id), { method: "PATCH", body: { active: el.dataset.on === "1" } }); loadTab(true); } catch (e) { fail(e); }
    },
    "hook-delete": async (el) => {
      if (!confirm("Delete this webhook?")) return;
      try { await api("/webhooks/" + encodeURIComponent(el.dataset.id), { method: "DELETE" }); toast("Webhook deleted"); loadTab(true); } catch (e) { fail(e); }
    },
  });
  Object.assign(changes, {
    "today-rep": (el) => { S.todayRep = el.value; loadTab(); },
    "activity-entity": (el) => { S.activity.entity = el.value; S.activity.page = 1; loadTab(); },
    "pipe-move": (el) => { const v = el.value; el.value = ""; if (v) { const c = el.closest(".pipe-card"); movePipeline(el.dataset.id, v, c && c.dataset.name); } },
    "attr-model": (el) => { S.attr.model = el.value; renderShell(); loadTab(); },
    "attr-dim": (el) => { S.attr.dim = el.value; renderShell(); loadTab(); },
  });
  Object.assign(submits, {
    "touch-save": async (form) => {
      const b = formObj(form);
      const kind = (form.querySelector('input[name="kind"]:checked') || {}).value;
      try { await api("/leads/" + encodeURIComponent(form.dataset.id) + "/touches", { method: "POST", body: { kind, outcome: b.outcome, note: b.note } }); closeModal(); toast("Touch logged"); if (S.drawer) openLead(S.drawer.id); if (S.tab === "today") loadTab(true); } catch (e) { fail(e); }
    },
    "today-won": async (form) => {
      const b = formObj(form);
      const n = b.plan === "full" ? null : Number(b.plan);
      const patch = n ? { status: "won", revenue: Number(b.revenue), payment_plan: n === 2 ? "split_2" : n === 3 ? "split_3" : "monthly", installments_total: n } : { status: "won", revenue: Number(b.revenue), payment_plan: "full" };
      try { await api("/sales/outcome", { method: "POST", body: { lead_id: form.dataset.id, patch } }); closeModal(); toast("Won. Onboarding started."); loadTab(true); } catch (e) { fail(e); }
    },
    "today-lost": async (form) => {
      const b = formObj(form);
      if (!b.lost_reason) { toast("Pick a lost reason first.", "err"); return; }
      try { await api("/sales/outcome", { method: "POST", body: { lead_id: form.dataset.id, patch: { status: "lost", lost_reason: b.lost_reason } } }); closeModal(); toast("Logged as lost"); loadTab(true); } catch (e) { fail(e); }
    },
    "today-payment": async (form) => {
      const b = formObj(form);
      try { await api("/leads/" + encodeURIComponent(form.dataset.id) + "/payments", { method: "POST", body: { amount: Number(b.amount), paid_at: b.paid_at || null, method: b.method } }); closeModal(); toast("Payment recorded"); loadTab(true); } catch (e) { fail(e); }
    },
    "pipe-won": async (form) => {
      const b = formObj(form);
      try { await api("/pipeline/move", { method: "POST", body: { lead_id: form.dataset.id, stage: form.dataset.stage, revenue: Number(b.revenue), installments: b.installments ? Number(b.installments) : undefined } }); closeModal(); toast("Won"); loadTab(true); } catch (e) { fail(e); }
    },
    "user-save": async (form) => {
      const b = formObj(form);
      const body = { email: b.email, name: b.name, role: b.role, rep_id: b.rep_id || null, active: !!b.active };
      const id = form.dataset.id;
      try {
        if (id) await api("/users/" + encodeURIComponent(id), { method: "PATCH", body });
        else await api("/users", { method: "POST", body });
        closeModal(); toast(id ? "User saved" : "User added. They can sign in with their email on the login page."); loadTab(true);
      } catch (e) { fail(e); }
    },
    "key-save": async (form) => {
      const b = formObj(form);
      const scopes = Object.keys(b).filter((k) => k.startsWith("scope_") && b[k]).map((k) => k.slice(6));
      try { const r = await api("/api-keys", { method: "POST", body: { name: b.name, scopes } }); openModal("Your new API key", secretBox("API key", r.key, "Copy it now: it is stored as a hash and will not be shown again."), true); loadTab(true); } catch (e) { fail(e); }
    },
    "hook-save": async (form) => {
      const b = formObj(form);
      const events = b.ev_all ? ["*"] : Object.keys(b).filter((k) => k.startsWith("ev_") && k !== "ev_all" && b[k]).map((k) => k.slice(3));
      try { const r = await api("/webhooks", { method: "POST", body: { url: b.url, events } }); openModal("Webhook signing secret", secretBox("Secret", r.secret, "Use this secret to verify X-Funnel-Signature. It will not be shown again."), true); loadTab(true); } catch (e) { fail(e); }
    },
  });

  // ══ Round 3: held calls and written plans, test data, launch readiness, reassign links, simple mode ══

  // ── "Showed" form: review (offer made is required) + the written plan ──────────────────────────────
  function planFields(p) {
    p = p || {};
    return '<fieldset class="plan-fields span-all"><legend class="field-label">Written plan <span class="faint">(the lead gets a private link; first build and next step are required for a plan)</span></legend><div class="form-grid">' +
      field("First build", '<input class="input" name="first_build" maxlength="300" placeholder="e.g. Quote follow-up tool that replaces the agency CRM" value="' + esc(p.first_build || "") + '">', "span-all") +
      field("Why it pays back, in their words", '<textarea class="textarea" name="why" maxlength="1200" rows="2" placeholder="Quote what they said">' + esc(p.why || "") + "</textarea>", "span-all") +
      field("What they keep", '<input class="input" name="keep" maxlength="800" placeholder="Code, accounts, data, the dashboard" value="' + esc(p.keep || "") + '">', "span-all") +
      field("Next step", '<input class="input" name="next_step" maxlength="300" placeholder="e.g. Decide with your partner, then a 20-minute kickoff call" value="' + esc(p.next_step || "") + '">') +
      field("Next step date", '<input class="input" name="next_step_at" type="date" value="' + esc(p.next_step_at ? dateInput(p.next_step_at) : "") + '">') +
      field("Price (if offered)", '<input class="input" name="price" maxlength="120" placeholder="$24,000" value="' + esc(p.price || "") + '">') +
      field("Payment plan (if offered)", '<input class="input" name="plan" maxlength="200" placeholder="3 × $8,000, monthly" value="' + esc(p.plan || "") + '">') +
      "</div></fieldset>";
  }
  function heldForm(id, objections, plan) {
    const objs = objections || ["Price", "Timing", "Needs to think", "Partner/spouse", "Funding doubts", "Trust/proof", "Time to commit", "Not a fit"];
    return '<form data-submit="held-save" data-id="' + esc(id) + '" class="form-grid">' +
      '<div class="field span-all" role="radiogroup" aria-required="true" aria-labelledby="offer-l"><span class="field-label" id="offer-l">Offer made? <span class="req">required</span></span><div class="seg seg-wrap">' +
      '<label class="seg-radio"><input type="radio" name="offer_made" value="yes" required><span>Yes, offer made</span></label><label class="seg-radio"><input type="radio" name="offer_made" value="no"><span>No offer</span></label></div></div>' +
      field("Main objection", sel("objection", [{ value: "", label: "None / not yet" }].concat(objs.map((o) => ({ value: o, label: o }))), "")) +
      field("Call QA (1–5)", sel("qa_score", [{ value: "", label: "—" }].concat([5, 4, 3, 2, 1].map((x) => ({ value: x, label: x + (x === 5 ? " · excellent" : x === 1 ? " · poor" : "") }))), "")) +
      field("Recording link", '<input class="input" name="recording_url" type="url" inputmode="url" placeholder="https://… (optional)" maxlength="500">', "span-all") +
      planFields(plan) +
      '<div class="form-actions span-all"><button class="btn" type="button" data-action="modal-close">Cancel</button><button class="btn btn-primary" type="submit">Save: showed</button></div></form>';
  }
  const planFromForm = (b) => ({ first_build: b.first_build, why: b.why, keep: b.keep, next_step: b.next_step, next_step_at: b.next_step_at || null, price: b.price, plan: b.plan });
  function planCard(d) {
    const p = d.plan;
    const can = canWrite();
    if (!p) {
      return card({ title: "Written plan", sub: "Promised on /book: they leave with a written plan whether or not they buy. Fill it in the Showed form or here.",
        actions: can ? '<button class="btn btn-sm" type="button" data-action="plan-edit">Write plan</button>' : "",
        body: '<p class="faint small">No plan yet. The recap email goes 2 hours after the call with the plan link once one is saved, otherwise a neutral note after 24 hours.</p>' });
    }
    const b = p.body || {};
    return card({
      title: "Written plan", sub: (p.viewed_at ? "Opened " + p.views + "× · last " + dt(p.last_viewed_at || p.viewed_at) : "Not opened yet") + " · saved " + dt(p.updated_at || p.created_at),
      actions: (p.viewed_at ? planSignal({ at: p.last_viewed_at || p.viewed_at, views: p.views }) + " " : "") + copyBtn(p.url, "Copy link") + ' <a class="btn btn-sm btn-ghost" href="' + esc(p.url) + '" target="_blank" rel="noopener noreferrer">Open</a>' + (can ? ' <button class="btn btn-sm" type="button" data-action="plan-edit">Edit</button>' : ""),
      body: '<dl class="kv"><dt>First build</dt><dd>' + esc(b.first_build) + "</dd>" + (b.why ? "<dt>Why it pays back</dt><dd>" + esc(b.why) + "</dd>" : "") + (b.keep ? "<dt>What they keep</dt><dd>" + esc(b.keep) + "</dd>" : "") +
        "<dt>Next step</dt><dd>" + esc(b.next_step) + (b.next_step_at ? ' <span class="faint">· ' + esc(day(b.next_step_at)) + "</span>" : "") + "</dd>" + (b.price ? "<dt>Price</dt><dd>" + esc(b.price) + "</dd>" : "") + (b.plan ? "<dt>Payment plan</dt><dd>" + esc(b.plan) + "</dd>" : "") + "</dl>",
    });
  }
  function reviewLine(r) {
    if (!r) return "";
    return "<dt>Call review</dt><dd>" + (r.offer_made ? badge("Offer made", "b-blue") : badge("No offer", "b-grey")) + (isNum(r.qa_score) ? ' <span class="faint">QA ' + esc(r.qa_score) + "/5</span>" : "") + (r.objection ? ' <span class="faint">· ' + esc(r.objection) + "</span>" : "") +
      (r.recording_url ? ' · <a href="' + esc(r.recording_url) + '" target="_blank" rel="noopener noreferrer">Recording</a>' : "") + "</dd>";
  }
  function testControls(d) {
    const t = d.test || {};
    if (!isManager()) return t.is_test ? badge("Test data", "b-amber") : "";
    return t.is_test
      ? badge("Test data", "b-amber") + ' <span class="faint small">' + esc(t.reason ? "(" + human(String(t.reason).replace(/^manual:.*/, "marked by hand")) + ")" : "") + '</span> <button class="btn btn-sm" type="button" data-action="lead-test" data-on="0">Not test data</button>'
      : '<button class="btn btn-sm btn-ghost" type="button" data-action="lead-test" data-on="1">Mark as test data</button>' + (t.decided ? ' <span class="faint small">marked real by hand</span>' : "");
  }

  // ── Floating definition for the "?" buttons (inline tips would be clipped by cards and tables) ─────
  let floatTip = null;
  function showTip(btn) {
    const src = document.getElementById(btn.getAttribute("aria-describedby") || "");
    if (!src) return;
    if (!floatTip) { floatTip = document.createElement("div"); floatTip.className = "float-tip"; floatTip.setAttribute("aria-hidden", "true"); document.body.appendChild(floatTip); }
    floatTip.textContent = src.textContent;
    floatTip.hidden = false;
    const r = btn.getBoundingClientRect(), tw = Math.min(280, window.innerWidth - 24);
    floatTip.style.maxWidth = tw + "px";
    const left = clamp(r.left + r.width / 2 - tw / 2, 12, window.innerWidth - tw - 12);
    floatTip.style.left = left + "px";
    const h = floatTip.offsetHeight;
    floatTip.style.top = (r.top - h - 8 > 8 ? r.top - h - 8 : r.bottom + 8) + "px";
  }
  const hideTip = () => { if (floatTip) floatTip.hidden = true; };
  document.addEventListener("mouseover", (ev) => { const b = ev.target.closest && ev.target.closest(".mhelp-btn"); if (b) showTip(b); });
  document.addEventListener("mouseout", (ev) => { if (ev.target.closest && ev.target.closest(".mhelp-btn")) hideTip(); });
  document.addEventListener("focusin", (ev) => { const b = ev.target.closest && ev.target.closest(".mhelp-btn"); if (b) showTip(b); else hideTip(); });
  document.addEventListener("focusout", (ev) => { if (ev.target.closest && ev.target.closest(".mhelp-btn")) hideTip(); });
  document.addEventListener("keydown", (ev) => { if (ev.key === "Escape") hideTip(); });
  window.addEventListener("scroll", hideTip, { passive: true, capture: true });

  // ── Simple mode: fewer tabs for part-time operators ────────────────────────────────────────────────
  const SIMPLE_TABS = ["overview", "today", "leads", "pipeline", "emails"];
  const simpleKey = () => "hq-simple:" + (S.me ? S.me.id : "anon");
  function simpleOn() {
    const v = store.get(simpleKey(), null);
    return v === null ? !!S.me && S.me.role === "viewer" : v === true;
  }
  function simpleAllows(id) {
    if (!simpleOn()) return true;
    return SIMPLE_TABS.includes(id) || (id === "integrations" && S.me && S.me.role === "owner");
  }
  function renderSimpleToggle() {
    const box = $("#simple-toggle");
    if (!box || !S.me) return;
    const on = simpleOn();
    box.hidden = false;
    box.innerHTML = '<label class="switch simple-switch"><input type="checkbox" data-change="simple-mode"' + (on ? " checked" : "") + '><span class="switch-track"></span><span>Simple mode</span></label>';
    document.body.classList.toggle("simple-mode", on);
  }

  // ── Include test data (report tabs) ────────────────────────────────────────────────────────────────
  const testToggle = () => '<label class="switch test-switch" title="Show test leads and our own browsers in these numbers"><input type="checkbox" data-change="include-test"' + (S.includeTest ? " checked" : "") + '><span class="switch-track"></span><span class="small">Include test data</span></label>';

  // ── Reassign link (#reassign=<token>) ──────────────────────────────────────────────────────────────
  async function openReassign(token) {
    try {
      const r = await api("/reassign", { query: "token=" + encodeURIComponent(token) });
      const L = r.lead;
      const body = '<div class="stack gap16"><p><strong>' + esc(L.name) + "</strong> " + tierBadge(L.tier) + ' <span class="mono faint">' + esc(L.ref_code) + "</span><br>" +
        '<span class="faint">Applied ' + esc(ago(L.applied_at)) + " · now " + esc(STATUS_LABEL[L.status] || L.status) + "</span></p>" +
        (r.touched ? '<div class="callout info"><span class="callout-dot"></span><div>Someone has touched this lead since the ping. Reassign only if they are not working it.</div></div>' : "") +
        '<dl class="kv"><dt>Now</dt><dd>' + esc(r.current ? r.current.name : "Unassigned") + "</dd><dt>Next in rotation</dt><dd>" + esc(r.next ? r.next.name : "No other active rep for this tier") + "</dd></dl>" +
        '<div class="form-actions"><button class="btn" type="button" data-action="modal-close">Keep as is</button>' + (r.next && isManager() ? '<button class="btn btn-primary" type="button" data-action="reassign-go" data-token="' + esc(token) + '">Reassign to ' + esc(r.next.name) + "</button>" : "") + "</div></div>";
      openModal("Reassign lead", body, true);
    } catch (e) { fail(e); }
  }

  Object.assign(actions, {
    "held-open": async (el) => {
      const id = el.dataset.id;
      openModal("Showed · " + (el.dataset.name || "call"), '<div class="loading">Loading</div>');
      let plan = null;
      try { const d = await api("/leads/" + encodeURIComponent(id)); plan = d.plan && d.plan.body; if (!el.dataset.name) $(".modal .card-title").textContent = "Showed · " + [d.lead.first_name, d.lead.last_name].filter(Boolean).join(" "); } catch (e) { /* new plan */ }
      $(".modal-body").innerHTML = heldForm(id, (S.today && S.today.objections) || null, plan);
      const f = $(".modal-body input");
      if (f) f.focus();
    },
    "plan-edit": () => {
      if (!S.drawer || !S.drawer.data) return;
      const p = S.drawer.data.plan && S.drawer.data.plan.body;
      openModal("Written plan", '<form data-submit="plan-save" class="form-grid">' + planFields(p) + '<div class="form-actions span-all"><button class="btn" type="button" data-action="modal-close">Cancel</button><button class="btn btn-primary" type="submit">Save plan</button></div></form>');
    },
    "lead-test": async (el) => {
      if (!S.drawer) return;
      const on = el.dataset.on === "1";
      try { await api("/leads/" + encodeURIComponent(S.drawer.id) + "/test", { method: "POST", body: { is_test: on } }); toast(on ? "Marked as test data: left out of reports, no emails or calls." : "Marked as real data."); openLead(S.drawer.id); loadTab(true); } catch (e) { fail(e); }
    },
    "go-live": async (el) => {
      if (!confirm("Go live? Emails queued during testing that were due more than an hour ago are skipped, so real leads only get fresh emails.")) return;
      el.disabled = true;
      try { const r = await api("/readiness/go-live", { method: "POST" }); toast("Live. Skipped " + n(r.skipped) + " stale emails."); loadTab(true); } catch (e) { el.disabled = false; fail(e); }
    },
    "ready-dns": async (el) => {
      el.disabled = true; el.textContent = "Checking…";
      try { const r = await api("/readiness/dns", { method: "POST" }); toast(r.error ? r.error : "DNS checked for " + (r.domain || "your domain")); loadTab(true); } catch (e) { fail(e); el.disabled = false; el.textContent = "Check DNS"; }
    },
    "scroll-test": () => { const c = $("#test-data-card"); if (c) c.scrollIntoView({ behavior: "smooth", block: "start" }); },
    "test-sweep": async (el) => {
      el.disabled = true;
      try { const r = await api("/test-data/sweep", { method: "POST" }); toast("Re-scanned: " + n(r.marked) + " newly marked, " + n(r.test_leads) + " test leads in total"); loadTab(true); } catch (e) { fail(e); el.disabled = false; }
    },
    "test-add-ip": async (el) => {
      el.disabled = true;
      try { const r = await api("/test-data/add-my-ip", { method: "POST" }); toast("This network is internal. " + n(r.marked) + " leads marked as test."); loadTab(true); } catch (e) { fail(e); el.disabled = false; }
    },
    "test-purge": async (el) => {
      const v = prompt("This erases every test lead and everything linked to them (the normal erasure). Type PURGE to confirm.");
      if (v !== "PURGE") return;
      el.disabled = true;
      try { const r = await api("/test-data/purge", { method: "POST", body: { confirm: "PURGE" } }); toast("Erased " + n(r.erased) + " test leads" + (r.left ? ", " + n(r.left) + " left: run it again" : "")); loadTab(true); } catch (e) { fail(e); el.disabled = false; }
    },
    "reassign-go": async (el) => {
      el.disabled = true;
      try { const r = await api("/reassign", { method: "POST", body: { token: el.dataset.token } }); closeModal(); toast("Reassigned to " + r.closer.name + ". They have been pinged."); history.replaceState(null, "", "#" + S.tab); loadTab(true); } catch (e) { el.disabled = false; fail(e); }
    },
  });
  Object.assign(changes, {
    "include-test": (el) => { S.includeTest = !!el.checked; store.set("hq-include-test", S.includeTest); loadTab(); },
    "simple-mode": (el) => {
      store.set(simpleKey(), !!el.checked);
      renderSimpleToggle();
      if (!tabAllowed(S.tab)) location.hash = "overview"; else renderShell();
    },
    "ready-confirm": async (el) => {
      try { await api("/readiness/confirm", { method: "POST", body: { key: el.dataset.key, value: el.checked } }); toast("Saved"); loadTab(true); } catch (e) { el.checked = !el.checked; fail(e); }
    },
  });
  Object.assign(submits, {
    "held-save": async (form) => {
      const b = formObj(form);
      const offer = (form.querySelector('input[name="offer_made"]:checked') || {}).value;
      if (!offer) { toast("Say whether an offer was made.", "err"); return; }
      const plan = planFromForm(b);
      const anyPlan = ["first_build", "why", "keep", "next_step", "price", "plan"].some((k) => String(plan[k] || "").trim());
      if (anyPlan && (!String(plan.first_build || "").trim() || !String(plan.next_step || "").trim())) { toast("A plan needs the first build and the next step.", "err"); return; }
      const btn = form.querySelector('button[type="submit"]');
      if (btn) btn.disabled = true;
      try {
        const r = await api("/calls/held", { method: "POST", body: { lead_id: form.dataset.id, offer_made: offer, objection: b.objection || null, qa_score: b.qa_score || null, recording_url: b.recording_url || null, plan: anyPlan ? plan : null } });
        closeModal();
        toast(r.plan ? "Logged as showed. Plan saved: the recap with the link goes about 2 hours after the call." : "Logged as showed. Post-call follow-up started.");
        if (S.drawer) openLead(S.drawer.id);
        loadTab(true);
      } catch (e) { if (btn) btn.disabled = false; fail(e); }
    },
    "plan-save": async (form) => {
      const b = formObj(form);
      try { const r = await api("/leads/" + encodeURIComponent(S.drawer.id) + "/plan", { method: "PUT", body: planFromForm(b) }); closeModal(); toast("Plan saved"); openLead(S.drawer.id); if (r.url) S.lastPlanUrl = r.url; } catch (e) { fail(e); }
    },
  });

  document.addEventListener("click", (ev) => {
    const el = ev.target.closest("[data-action]");
    if (!el) return;
    const fn = actions[el.dataset.action];
    if (!fn) return;
    if (el.tagName === "A" && el.dataset.action !== "open-lead") return;
    ev.preventDefault();
    fn(el, ev);
  });
  document.addEventListener("keydown", (ev) => {
    if (ev.key === "Escape") {
      if ($("#modal-root").innerHTML) closeModal();
      else if (S.drawer) closeLeadRoute();
      else document.body.classList.remove("nav-open");
    }
    if ((ev.key === "Enter" || ev.key === " ") && ev.target.matches && ev.target.matches("tr[data-action]")) { ev.preventDefault(); actions[ev.target.dataset.action](ev.target, ev); }
  });
  document.addEventListener("change", (ev) => {
    const el = ev.target.closest("[data-change]");
    if (el && changes[el.dataset.change]) changes[el.dataset.change](el, ev);
  });
  let qTimer = null;
  document.addEventListener("input", (ev) => {
    const el = ev.target;
    if (el.dataset && el.dataset.input === "lead-q") {
      clearTimeout(qTimer);
      qTimer = setTimeout(async () => {
        S.leads.q = el.value; S.leads.page = 1;
        await loadTab(true);
        const again = $('[data-input="lead-q"]');
        if (again) { again.focus(); again.setSelectionRange(again.value.length, again.value.length); }
      }, 280);
    }
  });
  document.addEventListener("submit", (ev) => {
    const form = ev.target.closest("form[data-submit]");
    if (!form) return;
    ev.preventDefault();
    const fn = submits[form.dataset.submit];
    if (fn) fn(form, ev);
  });

  // ── Boot ───────────────────────────────────────────────────────────────────
  async function boot() {
    try { S.me = (await api("/me")).user; } catch (e) { S.me = null; }
    try { const m = await api("/metrics"); S.metrics = Object.fromEntries(m.metrics.map((x) => [x.id, x])); S.smallN = m.small_n; } catch (e) { S.metrics = {}; }
    renderMe();
    renderSimpleToggle();
    window.addEventListener("hashchange", route);
    api("/filters").then((o) => { S.options = o; if (!TAB[S.tab].noFilters) renderFilters(); }).catch(() => {});
    route();
    if (S.tab !== "alerts") refreshBanner();
    setInterval(() => { if (!document.hidden && S.tab !== "alerts") refreshBanner(); }, 60000);
    // Live "waiting" counters on the Today view.
    setInterval(() => {
      $$("[data-since]").forEach((el) => { el.textContent = waited(Number(el.getAttribute("data-since"))); });
      $$("[data-sla]").forEach((el) => { el.textContent = waitedMs(Number(el.getAttribute("data-sla")) + (Date.now() - Number(el.getAttribute("data-loaded")))); });
    }, 1000);
  }
  // Deferred scripts run in order before DOMContentLoaded; waiting for it means funnel-map.js is loaded.
  if (document.readyState === "loading" || document.readyState === "interactive") document.addEventListener("DOMContentLoaded", boot, { once: true });
  else boot();
})();
