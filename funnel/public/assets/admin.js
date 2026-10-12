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
    const e = new URLSearchParams(location.search).get("e");
    const box = $("#login-error");
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
    video: "main",
    trend: "visitors",
    landerIndustry: "",
    data: null,
    drawer: null,
  };
  if (!["today", "7d", "30d", "90d", "all"].includes(S.filters.range)) S.filters.range = "30d";

  function qs(extra) {
    const p = new URLSearchParams();
    const f = S.filters;
    p.set("range", f.range);
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

  function kpi(label, value, sub) {
    return '<div class="kpi"><div class="kpi-label">' + esc(label) + '</div><div class="kpi-value tnum">' + value + "</div>" +
      (sub ? '<div class="kpi-sub">' + sub + "</div>" : "") + "</div>";
  }
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

  const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver((entries) => {
    for (const e of entries) {
      const el = e.target, cfg = charts.get(el.getAttribute("data-chart"));
      if (!cfg) continue;
      const wNow = Math.round(e.contentRect.width);
      if (el._w === wNow) continue;
      el._w = wNow;
      (cfg.type === "columns" ? drawColumns : drawArea)(el, cfg);
    }
  }) : null;

  /** After any innerHTML render: widths, charts. */
  function hydrate(root) {
    $$("[data-w]", root).forEach((el) => { el.style.width = el.getAttribute("data-w") + "%"; });
    $$("[data-chart]", root).forEach((el) => {
      const cfg = charts.get(el.getAttribute("data-chart"));
      if (!cfg) return;
      (cfg.type === "columns" ? drawColumns : drawArea)(el, cfg);
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
    integrations: '<path d="M6 2.5v3M10 2.5v3M4.5 5.5h7v2.5a3.5 3.5 0 0 1-7 0zM8 11.5v2"/>',
  };

  // KEEP the ids in sync with TAB_IDS in src/admin/map.ts.
  const TABS = [
    { id: "overview", group: "", title: "Overview", sub: "How the whole funnel is doing for the selected period, from first visit to cash." },
    { id: "map", group: "", title: "Funnel map", sub: "Every page, decision and automation with live numbers. Drag to rearrange; changes are shared with your team." },
    { id: "traffic", group: "Acquisition", title: "Traffic & ads", sub: "Where visitors come from, and which sources turn into calls and cash." },
    { id: "landers", group: "Acquisition", title: "Landing pages & tests", sub: "The headline test on the main page and the 100 industry landers the bandit is optimising." },
    { id: "links", group: "Acquisition", title: "Links & videos", sub: "Tracked links for YouTube, podcasts, newsletters and bios, and what each one produced." },
    { id: "vsl", group: "Conversion", title: "VSL", sub: "How far people watch the film, where they drop off and how many reach the pitch." },
    { id: "behaviour", group: "Conversion", title: "On-page behaviour", sub: "What people click, re-read and skip, and where the application form gets hard." },
    { id: "application", group: "Conversion", title: "Application", sub: "Where applicants drop off, what they answer and how they score." },
    { id: "leads", group: "Sales", title: "Leads", sub: "Everyone who left their details. Search looks across all time; open a lead to log the outcome." },
    { id: "sales", group: "Sales", title: "Sales team", sub: "Calls, show rate, closes and cash by rep, plus the calls that still need an outcome." },
    { id: "insights", group: "Sales", title: "Insights", sub: "Everyone who booked, split by tier, and what your best leads have in common." },
    { id: "team", group: "Sales", title: "Team", sub: "Closers and setters, which tiers they take, and where their pings go.", noFilters: true },
    { id: "emails", group: "Automation", title: "Emails", sub: "Every sequence and step, what is queued next, and how emails are landing." },
    { id: "voice", group: "Automation", title: "Voice", sub: "AI calls that confirm, chase and rebook. Set up, switch on and listen back." },
    { id: "tracking", group: "System", title: "Tracking", sub: "Server-side forwarding to Meta, GA4, PostHog and your CRM, and how well Meta can match people." },
    { id: "live", group: "System", title: "Live", sub: "What is happening on the site right now. Updates every five seconds while this tab is open.", noFilters: true },
    { id: "integrations", group: "System", title: "Integrations", sub: "Keys and settings for every service. Keys go here, never into a chat.", noFilters: true },
  ];
  const TAB = Object.fromEntries(TABS.map((t) => [t.id, t]));

  // ── Overview ───────────────────────────────────────────────────────────────
  const TREND_SERIES = [
    { id: "visitors", label: "Visitors" }, { id: "optins", label: "Opt-ins" }, { id: "applications", label: "Applications" },
    { id: "booked", label: "Booked" }, { id: "won", label: "Won" },
  ];
  TAB.overview.load = () => api("/overview", { query: qs() });
  TAB.overview.render = (d) => {
    const k = d.kpis, p = d.prev || {};
    const c = d.counts;
    const quiet = !c.visitors && !c.optins && !c.booked;
    const tiles = kpis([
      kpi("Visitors", esc(n(k.visitors)), delta(k.visitors, p.visitors) || "Unique people, bots excluded"),
      kpi("Play rate", esc(pc(k.play_rate)), delta(k.play_rate, p.play_rate, "rate") || "Visitors who pressed play"),
      kpi("Applications", esc(n(k.applications)), delta(k.applications, p.applications) || "Completed applications"),
      kpi("Booked calls", esc(n(k.booked)), delta(k.booked, p.booked) || "New bookings in the period"),
      kpi("Opt-in rate", esc(pc(k.optin_rate)), delta(k.optin_rate, p.optin_rate, "rate") || "Left contact details ÷ visitors"),
      kpi("Pitch reached", esc(pc(k.pitch_rate)), delta(k.pitch_rate, p.pitch_rate, "rate") || "Of plays, reached the offer"),
      kpi("Revenue", esc(moneyShort(k.revenue)), (delta(k.revenue, p.revenue) ? delta(k.revenue, p.revenue) + " · " : "") + esc(moneyShort(k.cash)) + " cash collected"),
      kpi("WhatsApp clicks", esc(n(k.whatsapp)), delta(k.whatsapp, p.whatsapp) || "Taps on the WhatsApp button"),
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
      sub: "Each step's count in the period, and its conversion from the step before. Rates over 100% are hidden because steps are dated by when they happened.",
      body: '<div class="funnel"><div class="funnel-row funnel-head"><span>Step</span><span></span><span class="f-n">People</span><span class="f-rate">From prev.</span></div>' +
        d.funnel.map((r, i) => '<div class="funnel-row"><span class="f-label">' + esc(r.label) + '</span><div class="f-bar"><div class="f-fill"' + w((r.n / maxN) * 100) + '></div></div><span class="f-n">' + esc(n(r.n)) + '</span><span class="f-rate">' + (i ? esc(pc(r.step)) : '<span class="faint">—</span>') + "</span></div>").join("") + "</div>",
    });
    const tiers = c.tier_a + c.tier_b + c.tier_c;
    const money2 = card({
      title: "Quality and cash",
      sub: "Applications by tier and what closed",
      body: '<div class="stack gap16">' +
        (tiers ? '<div class="stack-bar" role="img" aria-label="Tier split"><span class="s1"' + w((c.tier_a / tiers) * 100) + '></span><span class="s2"' + w((c.tier_b / tiers) * 100) + '></span><span class="s3"' + w((c.tier_c / tiers) * 100) + "></span></div>" +
          '<div class="legend"><span><span class="swatch"></span>A ' + esc(n(c.tier_a)) + '</span><span><span class="swatch sw2"></span>B ' + esc(n(c.tier_b)) + '</span><span><span class="swatch sw3"></span>C ' + esc(n(c.tier_c)) + "</span></div>" : '<p class="faint small">No scored applications in this period.</p>') +
        '<dl class="kv"><dt>Showed</dt><dd class="tnum">' + esc(n(c.showed)) + " of " + esc(n(c.showed + c.no_show)) + ' held or missed</dd><dt>Won</dt><dd class="tnum">' + esc(n(c.won)) + " · " + esc(money(c.revenue)) + '</dd><dt>Lost</dt><dd class="tnum">' + esc(n(c.lost)) + '</dd><dt>Cash collected</dt><dd class="tnum">' + esc(money(c.cash)) + "</dd></dl></div>",
    });
    return (quiet ? '<div class="callout info"><span class="callout-dot"></span><div><strong>No activity in this period yet.</strong> Numbers fill in as soon as people visit the site. Try a longer range, or check Tracking if you expected traffic.</div></div>' : "") +
      tiles + trend + '<div class="grid g-2-1">' + funnel + money2 + "</div>";
  };

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
  TAB.traffic.load = () => api("/traffic", { query: qs({ dim: S.trafficDim }) });
  TAB.traffic.render = (d) => {
    const maxV = Math.max(1, ...d.rows.map((r) => r.visitors));
    const t = d.totals || {};
    const dimLabel = (d.dims.find((x) => x.id === d.dim) || {}).label || d.dim;
    const top = d.rows.slice().sort((a, b) => b.applied - a.applied).filter((r) => r.applied)[0];
    const summary = kpis([
      kpi("Visitors", esc(n(t.visitors)), esc(n(t.sessions)) + " sessions"),
      kpi("Played the film", esc(n(t.plays)), esc(pc(t.visitors ? (t.plays / t.visitors) * 100 : null)) + " of visitors"),
      kpi("Applications", esc(n(t.applied)), esc(n(t.qualified)) + " qualified"),
      kpi("Best " + dimLabel.toLowerCase(), top ? esc(top.key) : "—", top ? esc(n(top.applied)) + " applications" : "Needs applications"),
    ]);
    const tbl = table([
      { label: dimLabel, get: (r) => '<div class="cell-bar"><span class="ellipsis" title="' + esc(r.key) + '">' + esc(r.key) + '</span></div><div class="bar-track"><div class="bar-fill"' + w((r.visitors / maxV) * 100) + "></div></div>" },
      { label: "Visitors", num: true, get: (r) => esc(n(r.visitors)) },
      { label: "Engaged", num: true, get: (r) => esc(r.engaged_s ? r.engaged_s + "s" : "—") },
      { label: "Bounce", num: true, get: (r) => esc(pc(r.bounce_rate)) },
      { label: "Play rate", num: true, get: (r) => esc(pc(r.play_rate)) },
      { label: "Leads", num: true, get: (r) => esc(n(r.leads)) },
      { label: "Applied", num: true, get: (r) => esc(n(r.applied)) },
      { label: "Apply rate", num: true, get: (r) => esc(pc(r.apply_rate)) },
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
      sub: "Leads and money are credited to every value a visitor arrived with in the period.",
      actions: sel("dim", d.dims.map((x) => ({ value: x.id, label: x.label })), d.dim, { change: "traffic-dim", sm: true, label: "Break down by" }),
      body: tbl, flush: true,
    });
  };

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
      kpi("Plays", esc(n(k.plays)), esc(n(k.viewers)) + " unmuted · " + esc(pc(k.unmute_rate))),
      kpi("Average watched", esc(pc(k.avg_watched_pct)), "Of the film, per viewer"),
      kpi("Reached the pitch", esc(pc(k.pitch_rate)), esc(n(k.pitch)) + " people"),
      kpi("Finished", esc(pc(k.completion_rate)), esc(n(k.completed)) + " people"),
      kpi("Clicked apply", esc(pc(k.cta_click_rate)), esc(n(k.cta_clicks)) + " of those who saw the button"),
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
    const tiles = kpis([
      kpi("Opened the form", esc(n(k.apply_starts)), "Visited /apply"),
      kpi("Left contact details", esc(n(k.contacts)), esc(pc(k.apply_starts ? (k.contacts / k.apply_starts) * 100 : null)) + " of form visitors"),
      kpi("Completed", esc(n(k.completed)), esc(pc(k.completion_rate)) + " of contacts"),
      kpi("Median time", esc(k.median_minutes == null ? "—" : n1(k.median_minutes)) + (k.median_minutes == null ? "" : '<span class="unit">min</span>'), "Contact to submit"),
      kpi("Average score", esc(n(k.avg_score)), "Out of 100"),
      kpi("Qualified", esc(n(d.tiers.A + d.tiers.B)), "A " + esc(n(d.tiers.A)) + " · B " + esc(n(d.tiers.B)) + " · C " + esc(n(d.tiers.C))),
    ], "k6");
    const maxR = Math.max(1, ...d.steps.map((s) => s.reached));
    const steps = card({
      title: "Drop-off by question", sub: "People who reached each question, and how many of the previous question's people that is.",
      body: '<div class="funnel"><div class="funnel-row funnel-head"><span>Question</span><span></span><span class="f-n">Reached</span><span class="f-rate">Kept</span></div>' + d.steps.map((s, i) =>
        '<div class="funnel-row"><span class="f-label ellipsis" title="' + esc(s.title) + '">' + esc(s.step + ". " + label(s.id)) + '</span><div class="f-bar"><div class="f-fill"' + w((s.reached / maxR) * 100) + '></div></div><span class="f-n">' + esc(n(s.reached)) + '</span><span class="f-rate">' + (i ? esc(pc(s.kept)) : '<span class="faint">—</span>') + "</span></div>").join("") + "</div>",
      foot: d.steps.some((s) => s.backs) ? "Went back to change an answer: " + d.steps.filter((s) => s.backs).map((s) => esc(human(s.id)) + " " + esc(n(s.backs))).join(" · ") : "",
    });
    const hist = card({
      title: "Scores", sub: "Completed applications by score. A from 70, B from 40.",
      body: k.completed ? chart({ type: "columns", labels: d.score_histogram.map((b) => String(b.from)), values: d.score_histogram.map((b) => b.n), tipLabel: (i) => "Score " + d.score_histogram[i].from + "–" + d.score_histogram[i].to, unit: "applications", height: 200 }) : empty("No completed applications", "Scores appear once applications are submitted.", true),
    });
    const flags = card({ title: "Flags", sub: "Signals that capped a tier or need a closer's eye", body: bars(d.flags.map((f) => ({ label: label(f.flag), value: f.n })), { color: "c4", emptyBody: "Flags like under $1M, not the owner or personal email show here." }) });
    const qs2 = d.questions.map((q) => card({ title: q.title, sub: n(q.answered) + " answered" + (q.type === "multi" ? " · pick any" : ""), body: bars(q.options.map((o) => ({ label: o.label, value: o.n, extra: pc(o.pct) })), { emptyBody: "Answers appear with the first completed application." }) }));
    const text = d.text.length ? card({ title: "Written answers", flush: true, body: table([
      { label: "Question", cls: "wrap", get: (r) => esc(r.title) },
      { label: "Answered", num: true, get: (r) => esc(n(r.answered)) },
      { label: "Avg length", num: true, get: (r) => esc(n(r.avg_length)) + " chars" },
    ], d.text) }) : "";
    return tiles + '<div class="grid g-2-1">' + steps + '<div class="stack gap16">' + hist + flags + "</div></div>" + '<h2 class="section-title">Answers</h2><div class="grid g3">' + qs2.join("") + "</div>" + text;
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
    const k = d.kpis;
    const tiles = kpis([
      kpi("Calls due", esc(n(k.calls)), "Call times already passed"),
      kpi("Show rate", esc(pc(k.show_rate)), esc(n(k.showed)) + " showed · " + esc(n(k.no_show)) + " no-show"),
      kpi("Close rate", esc(pc(k.close_rate)), "Won ÷ calls held"),
      kpi("Won", esc(n(k.won)), "Average deal " + esc(moneyShort(k.avg_deal))),
      kpi("Revenue", esc(moneyShort(k.revenue)), "Deal value of wins"),
      kpi("Cash collected", esc(moneyShort(k.cash)), "Payments in the period"),
    ], "k6");
    const needs = card({
      title: "Needs an outcome", sub: "Calls in the last 30 days that still say booked. Logging the outcome starts the right follow-up.", flush: true,
      body: table(callCols().slice(0, 4).concat([{ label: "", get: (r) => '<div class="row"><button class="btn btn-sm" type="button" data-action="quick-outcome" data-id="' + esc(r.id) + '" data-status="showed">Showed</button><button class="btn btn-sm" type="button" data-action="quick-outcome" data-id="' + esc(r.id) + '" data-status="no_show">No-show</button><a class="btn btn-sm btn-ghost" href="#lead=' + encodeURIComponent(r.id) + '">Won or lost…</a></div>' }]), d.needs_outcome, {
        empty: empty("All caught up", "Every call that has happened has an outcome. Calls show up here 30 minutes after their start time."),
      }),
    });
    const reps = card({
      title: "Scoreboard", sub: "By closer. Cash counts payments recorded in the period.", flush: true,
      body: table([
        { label: "Rep", get: (r) => '<span class="t-name">' + esc(r.name) + '</span><span class="sub">' + esc(label(r.role)) + (r.upcoming ? " · " + esc(n(r.upcoming)) + " upcoming" : "") + "</span>" },
        { label: "Calls", num: true, get: (r) => esc(n(r.calls)) },
        { label: "Showed", num: true, get: (r) => esc(n(r.showed)) },
        { label: "Show rate", num: true, get: (r) => esc(pc(r.show_rate)) },
        { label: "Won", num: true, get: (r) => esc(n(r.won)) },
        { label: "Close rate", num: true, get: (r) => esc(pc(r.close_rate)) },
        { label: "Revenue", num: true, get: (r) => esc(moneyShort(r.revenue)) },
        { label: "Cash", num: true, get: (r) => esc(moneyShort(r.cash)) },
        { label: "Commission", num: true, get: (r) => esc(r.commission ? money(r.commission) : "—") },
        { label: "Target", get: (r) => (r.target ? '<div class="cell-bar"><div class="bar-track"><div class="bar-fill c3"' + w(r.target_pct || 0) + '></div></div><span class="faint small tnum">' + esc(pc(r.target_pct)) + "</span></div>" : '<span class="faint">—</span>') },
      ], d.reps, { empty: empty("No reps yet", "Add closers and setters on the Team tab. Until then, calls go to the founder.") }),
    });
    const log = card({ title: "Call log", sub: "Calls in the period and the next 14 days", flush: true, body: table(callCols(), d.call_log, { tall: true, rowAction: (r) => ({ action: "open-lead", id: r.id }), empty: empty("No calls in this period", "Booked calls appear here with their outcome.") }) });
    return tiles + needs + reps + log;
  };

  // ── Insights ───────────────────────────────────────────────────────────────
  TAB.insights.load = () => api("/insights", { query: qs() });
  TAB.insights.render = (d) => {
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
  };

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
      { label: "Lead", get: (r) => '<span class="t-name">' + esc([r.first_name, r.last_name].filter(Boolean).join(" ") || r.email) + '</span><span class="sub">' + esc(r.email) + "</span>" },
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
  function offsetLabel(ms, anchor) {
    if (ms == null) return "Per lead";
    const a = Math.abs(ms);
    const t = a < 3600000 ? Math.round(a / 60000) + " min" : a < 172800000 ? Math.round(a / 3600000) + " h" : Math.round(a / 86400000) + " days";
    if (anchor === "call") return ms < 0 ? t + " before the call" : t + " after the call";
    return ms === 0 ? "Immediately" : t + " after";
  }
  TAB.emails.render = (d) => {
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
            { label: "Template", get: (r) => '<code class="mono">' + esc(r.template) + "</code>" },
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
        { label: "Lead", get: (r) => leadLink(r.lead_id, r.name || "Lead") },
        { label: "Sequence", get: (r) => esc(label(r.sequence)) },
        { label: "Template", get: (r) => '<code class="mono">' + esc(r.template) + "</code>" },
      ], d.queue, { mid: true, empty: empty("Nothing queued", "Emails are queued when someone applies, books, misses a call or closes.", true) }),
    });
    const triggers = card({
      title: "Behaviour triggers", sub: "One-off emails when someone does something specific. Each fires at most once per lead.", flush: true,
      body: table([
        { label: "Rule", cls: "wrap", get: (r) => '<span class="t-name">' + esc(r.label) + '</span><span class="sub mono">' + esc(r.template) + "</span>" },
        { label: "Delay", num: true, get: (r) => esc(r.delay_min ? r.delay_min + " min" : "None") },
        { label: "Fired", num: true, get: (r) => esc(n(r.fired)) },
        { label: "", get: (r) => '<button class="btn btn-sm" type="button" data-action="preview" data-template="' + esc(r.template) + '">Preview</button>' },
      ], d.triggers),
    });
    const tpl = card({
      title: "All templates", sub: d.templates.length + " templates", flush: true,
      body: table([
        { label: "Template", get: (r) => '<code class="mono">' + esc(r.id) + "</code>" },
        { label: "Topics", get: (r) => (r.topics || []).map((t) => '<span class="badge plain b-grey">' + esc(human(t)) + "</span>").join(" ") || '<span class="faint">—</span>' },
        { label: "", get: (r) => '<button class="btn btn-sm" type="button" data-action="preview" data-template="' + esc(r.id) + '">Preview</button>' },
      ], d.templates, { tall: true }),
    });
    return mode + tiles + seqs + '<div class="grid g2">' + queue + triggers + "</div>" + tpl;
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
    return (d.test_event_code ? '<div class="callout warn"><span class="callout-dot"></span><div><strong>Meta test event code is set.</strong> Events go to Test Events in Events Manager. Clear it in Integrations when you are done testing.</div></div>' : "") +
      dests + '<div class="grid g2">' + match + ev + "</div>" + errs;
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

  // ── Integrations ───────────────────────────────────────────────────────────
  TAB.integrations.load = () => api("/integrations");
  const STATE_BADGE = { connected: ["Connected", "b-green"], partial: ["Partly set up", "b-amber"], off: ["Not connected", "b-grey"], defaults: ["Using defaults", "b-grey"] };
  function settingRow(x) {
    const val = x.set ? '<div class="setting-value">' + esc(x.value) + "</div>" : '<div class="setting-value unset">Not set</div>';
    const src = x.locked ? '<span class="lock" title="Set as an environment variable. Change it with wrangler.">locked (env)</span>' : x.source === "default" ? '<span class="faint small">default</span>' : "";
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
    if (id === "email") return '<form class="inline-form" data-submit="test-email"><input class="input sm" type="email" name="to" placeholder="you@company.com" required><button class="btn btn-sm" type="submit">Send test email</button></form>';
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
      (L ? '<div class="drawer-meta">' + statusBadge(L.status) + tierBadge(L.tier_override || L.tier) + '<span class="mono">' + esc(L.ref_code) + "</span><span>" + esc(L.email) + "</span>" + (L.phone ? "<span>" + esc(L.phone) + "</span>" : "") + (L.booking_source === "calendly-direct" ? badge("Booked directly in Calendly", "b-grey") : "") + "</div>" : "") +
      '</div><span class="spacer"></span><button class="btn btn-ghost btn-icon" type="button" data-action="drawer-close" aria-label="Close lead"><svg viewBox="0 0 16 16" aria-hidden="true"><path d="M4 4l8 8M12 4l-8 8"/></svg></button></div>' +
      '<div class="drawer-tabs" role="tablist">' + DRAWER_TABS.map((t) => '<button type="button" role="tab" data-action="drawer-tab" data-tab="' + t[0] + '" aria-selected="' + (dr.tab === t[0]) + '">' + esc(t[1]) + "</button>").join("") + "</div></div>";
    let body;
    if (dr.error) body = empty("Could not load this lead", dr.error);
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
      "<dt>Emails</dt><dd>" + (L.unsubscribed_at ? badge("Unsubscribed", "b-amber") : "Subscribed") + "</dd></dl>";
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
      card({ title: "Records", sub: "Booking checks and erasure on request", body:
        '<div class="row-actions">' +
        (L.status === "booked" ? '<button class="btn btn-sm" type="button" data-action="confirm-booking" data-id="' + esc(L.id) + '">Confirm booking and start reminders</button>' : "") +
        '<button class="btn btn-sm btn-danger" type="button" data-action="erase-lead" data-id="' + esc(L.id) + '" data-ref="' + esc(L.ref_code) + '">Erase all data for this lead</button></div>' +
        '<p class="faint small">Confirm only a booking you trust, for example one matched by email alone. Erasure deletes the lead, their visits, emails, calls and bookings, and keeps payment amounts without any link to the person.</p>' });
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
    return pipeline + deal + pays;
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
      { label: "Sequence", get: (r) => esc(label(r.sequence)) },
      { label: "Template", get: (r) => '<code class="mono">' + esc(r.template) + "</code>" },
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
    return bookings + calls + queued;
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
      '<span class="spacer"></span><button class="btn btn-ghost btn-sm" type="button" data-action="refresh" title="Reload this view"><svg viewBox="0 0 16 16" aria-hidden="true"><path d="M13 8a5 5 0 1 1-1.5-3.6M13 2.5v3h-3"/></svg>Refresh</button>';
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
    return { tab: TAB[h] ? h : "overview", lead: null };
  }
  let booted = false;
  function route() {
    const r = parseHash();
    if (r.lead) {
      if (!booted) { S.tab = "leads"; renderShell(); loadTab(); }
      if (!S.drawer || S.drawer.id !== r.lead) openLead(r.lead);
    } else {
      if (S.drawer) closeDrawer();
      if (!booted || r.tab !== S.tab) { S.tab = r.tab; renderShell(); loadTab(); }
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
      if (!confirm("Log out on every device? Everyone signed in to Funnel HQ will need the password again.")) return;
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
    "add-payment": async (form) => {
      const b = formObj(form);
      try {
        await api("/leads/" + encodeURIComponent(S.drawer.id) + "/payments", { method: "POST", body: { amount: Number(b.amount), paid_at: b.paid_at || null, method: b.method, note: b.note } });
        toast("Payment recorded");
        openLead(S.drawer.id);
      } catch (e) { fail(e); }
    },
  };

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
  function boot() {
    window.addEventListener("hashchange", route);
    api("/filters").then((o) => { S.options = o; if (!TAB[S.tab].noFilters) renderFilters(); }).catch(() => {});
    route();
  }
  // Deferred scripts run in order before DOMContentLoaded; waiting for it means funnel-map.js is loaded.
  if (document.readyState === "loading" || document.readyState === "interactive") document.addEventListener("DOMContentLoaded", boot, { once: true });
  else boot();
})();
