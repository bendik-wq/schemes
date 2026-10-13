/* Funnel HQ — Growth tabs (Proof, Cohorts, Referrals, Experiments). Self-contained: admin.js has no plugin
   hook, so this script adds a "Growth" group to the side nav at runtime (re-adding it whenever admin.js
   re-renders the nav), owns the hashes "#g/…", and renders into its own view next to #view.
   Same rules as admin.js: no inline handlers or styles (strict CSP), every interpolation through esc(),
   double-quoted attributes. Talks only to /admin/api/growth/*. */
(() => {
  "use strict";
  if (document.body.dataset.page !== "hq") return;

  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
  const ESC = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
  const esc = (v) => String(v == null ? "" : v).replace(/[&<>"']/g, (c) => ESC[c]);
  const NF = new Intl.NumberFormat("en-US");
  const NF1 = new Intl.NumberFormat("en-US", { maximumFractionDigits: 1 });
  const isNum = (v) => typeof v === "number" && isFinite(v);
  const n = (v) => (isNum(v) ? NF.format(Math.round(v)) : "—");
  const pc = (v) => (isNum(v) ? NF1.format(v) + "%" : "—");
  const money = (v) => (isNum(v) ? "$" + NF.format(Math.round(v)) : "—");
  const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const day = (ts) => { if (!ts) return "—"; const d = new Date(ts); return d.getDate() + " " + MONTHS[d.getMonth()] + " " + d.getFullYear(); };
  const ymd = (s) => { const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(s || "")); return m ? Number(m[3]) + " " + MONTHS[Number(m[2]) - 1] + " " + m[1] : "—"; };
  const dateInput = (ts) => { if (!ts) return ""; const d = new Date(ts); return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0"); };

  async function api(path, opts) {
    const o = opts || {};
    const init = { method: o.method || "GET", credentials: "same-origin", headers: {} };
    if (o.body !== undefined) { init.headers["content-type"] = "application/json"; init.body = JSON.stringify(o.body); }
    const res = await fetch("/admin/api/growth" + path, init);
    if (res.status === 401) { location.href = "/admin/login"; throw new Error("Signed out"); }
    let data = null;
    try { data = await res.json(); } catch (e) { data = null; }
    if (!res.ok) throw new Error((data && data.error) || "Request failed (" + res.status + ")");
    return data;
  }

  function toast(msg, kind) {
    const wrap = $("#toasts");
    if (!wrap) return;
    const el = document.createElement("div");
    el.className = "toast" + (kind === "err" ? " err" : "");
    el.textContent = msg;
    wrap.appendChild(el);
    setTimeout(() => el.remove(), kind === "err" ? 6000 : 3200);
  }
  const fail = (e) => toast(e && e.message ? e.message : String(e), "err");

  function card(o) {
    const head = o.title || o.actions
      ? '<div class="card-head"><div>' + (o.title ? '<h2 class="card-title">' + esc(o.title) + "</h2>" : "") + (o.sub ? '<p class="card-sub">' + esc(o.sub) + "</p>" : "") + "</div>" +
        (o.actions ? '<div class="card-actions">' + o.actions + "</div>" : "") + "</div>"
      : "";
    return '<section class="card">' + head + '<div class="card-body' + (o.flush ? " flush" : "") + '">' + o.body + "</div></section>";
  }
  const empty = (title, body) => '<div class="empty compact"><div class="empty-title">' + esc(title) + '</div><p class="empty-body">' + esc(body) + "</p></div>";
  const callout = (html, kind) => '<div class="callout' + (kind ? " " + kind : "") + '"><span class="callout-dot"></span><div>' + html + "</div></div>";
  const badge = (text, cls) => '<span class="badge ' + (cls || "b-grey") + '">' + esc(text) + "</span>";
  function table(cols, rows, emptyHtml) {
    if (!rows.length) return emptyHtml || empty("Nothing here yet", "Rows appear as data comes in.");
    return '<div class="table-wrap"><table class="t"><thead><tr>' + cols.map((c) => "<th" + (c.num ? ' class="num"' : "") + ' scope="col">' + esc(c.label) + "</th>").join("") +
      "</tr></thead><tbody>" + rows.map((r) => "<tr>" + cols.map((c) => "<td" + (c.num ? ' class="num"' : "") + ">" + c.get(r) + "</td>").join("") + "</tr>").join("") + "</tbody></table></div>";
  }
  function kpi(label, value, sub) {
    return '<div class="kpi"><div class="kpi-label">' + esc(label) + '</div><div class="kpi-value tnum">' + value + "</div>" + (sub ? '<div class="kpi-sub">' + sub + "</div>" : "") + "</div>";
  }
  const sel = (name, options, value, extra) => '<select class="select" name="' + esc(name) + '"' + (extra || "") + ">" +
    options.map((o) => '<option value="' + esc(o.value) + '"' + (String(o.value) === String(value == null ? "" : value) ? " selected" : "") + ">" + esc(o.label) + "</option>").join("") + "</select>";
  const field = (label, control, cls, help) => '<label class="field' + (cls ? " " + cls : "") + '"><span class="field-label">' + esc(label) + "</span>" + control + (help ? '<span class="field-help">' + esc(help) + "</span>" : "") + "</label>";

  function openModal(title, body) {
    const root = $("#modal-root");
    root.innerHTML = '<div class="scrim over-drawer" data-action="modal-close"></div><div class="modal" role="dialog" aria-modal="true" aria-label="' + esc(title) + '"><div class="modal-head"><h2 class="card-title">' + esc(title) +
      '</h2><button class="btn btn-ghost btn-icon" type="button" data-action="modal-close" aria-label="Close"><svg viewBox="0 0 16 16" aria-hidden="true"><path d="M4 4l8 8M12 4l-8 8"/></svg></button></div><div class="modal-body gx">' + body + "</div></div>";
    const f = root.querySelector("input, select, textarea");
    if (f) f.focus();
  }
  const closeModal = () => { $("#modal-root").innerHTML = ""; };

  // ── Tabs ───────────────────────────────────────────────────────────────────
  const TABS = [
    { id: "g/experiments", title: "Experiments", sub: "Tests on the CTA text, the film gate, inline booking and the closer card. One running test per slot; visitors keep their variant.",
      icon: '<path d="M6 2.5h4M6.8 2.5v4L3 12.8a.8.8 0 0 0 .7 1.2h8.6a.8.8 0 0 0 .7-1.2L9.2 6.5v-4"/><path d="M4.8 10h6.4"/>' },
    { id: "g/proof", title: "Proof", sub: "Client quotes, screenshots and numbers. Nothing shows on the site until it is approved and the client's consent is recorded.",
      icon: '<path d="M3 3.5h10v7H7l-3 2.5v-2.5H3z"/>' },
    { id: "g/referrals", title: "Referrals", sub: "Who sends you founders, and how those founders move through the funnel.",
      icon: '<circle cx="5" cy="5.5" r="2"/><circle cx="11" cy="5.5" r="2"/><path d="M1.8 13c.4-2 1.6-3 3.2-3s2.8 1 3 3M8 13c.2-2 1.4-3 3-3s2.8 1 3.2 3"/>' },
    { id: "g/cohorts", title: "Cohorts", sub: "Build cohorts and their places. The site shows a cohort only while it is open and has places; places are counted from won deals.",
      icon: '<rect x="2.5" y="3.5" width="11" height="10" rx="1.5"/><path d="M2.5 6.5h11M5.5 2v3M10.5 2v3"/>' },
  ];
  const TAB = Object.fromEntries(TABS.map((t) => [t.id, t]));
  let active = null;
  let snapshot = null;
  let data = null;

  function view() {
    let v = $("#growth-view");
    if (!v) {
      v = document.createElement("div");
      v.id = "growth-view";
      v.className = "view gx";
      v.setAttribute("aria-live", "polite");
      v.hidden = true;
      const main = $("#view");
      main.parentNode.insertBefore(v, main.nextSibling);
    }
    return v;
  }

  function injectNav() {
    const nav = $("#nav");
    if (!nav) return;
    if (!nav.querySelector("[data-growth-nav]")) {
      const html = '<div class="nav-label" data-growth-nav>Growth</div>' + TABS.map((t) => '<a class="nav-item" data-growth-tab="' + esc(t.id) + '" href="#' + esc(t.id) + '"><svg viewBox="0 0 16 16" aria-hidden="true">' + t.icon + "</svg><span>" + esc(t.title) + "</span></a>").join("");
      // After the Sales group (before Automation) when it exists, else at the end.
      const labels = $$(".nav-label", nav);
      const before = labels.find((l) => l.textContent.trim() === "Automation");
      if (before) before.insertAdjacentHTML("beforebegin", html);
      else nav.insertAdjacentHTML("beforeend", html);
    }
    syncNav();
  }
  function syncNav() {
    const nav = $("#nav");
    if (!nav) return;
    $$("[data-growth-tab]", nav).forEach((a) => {
      const on = a.dataset.growthTab === active;
      a.classList.toggle("active", on);
      if (on) a.setAttribute("aria-current", "page"); else a.removeAttribute("aria-current");
    });
    if (active) $$(".nav-item:not([data-growth-tab])", nav).forEach((a) => { if (a.classList.contains("active")) { a.classList.remove("active"); a.removeAttribute("aria-current"); } });
  }

  const growthHash = () => { const h = decodeURIComponent(location.hash.replace(/^#/, "")); return TAB[h] ? h : null; };

  function show(id) {
    if (!active) {
      snapshot = {
        title: $("#page-title").textContent, sub: $("#page-sub").textContent, tab: $("#topbar-tab").textContent,
        actions: $("#head-actions").innerHTML, filtersHidden: $("#filters").hidden, doc: document.title,
      };
    }
    active = id;
    document.body.classList.add("growth-on");
    const t = TAB[id];
    $("#view").hidden = true;
    $("#filters").hidden = true;
    view().hidden = false;
    $("#page-title").textContent = t.title;
    $("#page-sub").textContent = t.sub;
    $("#topbar-tab").textContent = t.title;
    document.title = t.title + " · Funnel HQ";
    $("#head-actions").innerHTML = "";
    document.body.classList.remove("nav-open");
    const tb = $('[data-action="toggle-nav"]');
    if (tb) tb.setAttribute("aria-expanded", "false");
    syncNav();
    load();
  }
  function hide() {
    if (!active) return;
    active = null;
    document.body.classList.remove("growth-on");
    view().hidden = true;
    $("#view").hidden = false;
    if (snapshot) {
      $("#page-title").textContent = snapshot.title;
      $("#page-sub").textContent = snapshot.sub;
      $("#topbar-tab").textContent = snapshot.tab;
      $("#head-actions").innerHTML = snapshot.actions;
      $("#filters").hidden = snapshot.filtersHidden;
      document.title = snapshot.doc;
    }
    syncNav();
  }

  let seq = 0;
  async function load(quiet) {
    const id = active;
    if (!id) return;
    const my = ++seq;
    const v = view();
    if (!quiet) v.innerHTML = '<div class="loading">Loading</div>';
    try {
      const d = await R[id].load();
      if (my !== seq || active !== id) return;
      data = d;
      v.innerHTML = R[id].render(d);
      $("#head-actions").innerHTML = R[id].actions ? R[id].actions(d) : "";
    } catch (e) {
      if (my !== seq) return;
      v.innerHTML = card({ body: empty("This view could not load", (e && e.message ? e.message : String(e)) + ". If the growth tables are missing, apply migration 0020_growth.sql.") });
    }
  }

  // ── Renderers ──────────────────────────────────────────────────────────────
  const R = {};

  // Proof
  const KIND_LABEL = { quote: "Quote", video: "Video", screenshot: "Screenshot", logo: "Logo", build_log: "Build log", metric: "Metric" };
  R["g/proof"] = {
    load: () => api("/proof"),
    actions: () => '<button class="btn btn-primary" type="button" data-gaction="proof-new">Add proof</button>',
    render: (d) => {
      const status = (p) => p.renderable ? badge("Live", "b-green")
        : p.approved ? badge("Approved, hidden", "b-amber") + (p.problem ? '<div class="small faint">Text ' + esc(p.problem) + "</div>" : '<div class="small faint">Needs consent for the website or media</div>')
        : badge("Not approved", "b-grey") + (p.problem ? '<div class="small bad-text">Text ' + esc(p.problem) + "</div>" : "");
      const consent = (p) => p.consent_at ? esc(day(p.consent_at)) + '<div class="small faint">' + esc((p.consent_scope || "").split(",").filter(Boolean).join(", ") || "no scope") + "</div>" : '<span class="faint">None recorded</span>';
      const who = (p) => esc([p.author_name, p.author_role].filter(Boolean).join(", ") || "—") + (p.company ? '<div class="small faint">' + esc(p.company) + "</div>" : "") + (p.source === "form" ? '<div class="small faint">Sent by the client' + (p.lead_name ? " (" + esc(p.lead_name) + ")" : "") + "</div>" : "");
      const rows = table([
        { label: "Kind", get: (p) => esc(KIND_LABEL[p.kind] || p.kind) },
        { label: "Text", get: (p) => '<div class="gx-clip">' + esc(p.body || p.media_url || "—") + "</div>" },
        { label: "Who", get: who },
        { label: "Consent", get: consent },
        { label: "Status", get: status },
        { label: "", get: (p) => '<div class="row"><button class="btn btn-sm" type="button" data-gaction="proof-approve" data-id="' + esc(p.id) + '" data-on="' + (p.approved ? "0" : "1") + '">' + (p.approved ? "Unapprove" : "Approve") + '</button><button class="btn btn-sm btn-ghost" type="button" data-gaction="proof-edit" data-id="' + esc(p.id) + '">Edit</button></div>' },
      ], d.items, empty("No proof yet", "Add what clients have actually said, with their consent, or send a won client the request link below. Nothing is shown on the site until you approve it."));
      const clients = table([
        { label: "Client", get: (l) => '<a class="t-name" href="#lead=' + encodeURIComponent(l.id) + '">' + esc(l.name) + "</a>" },
        { label: "Won", get: (l) => esc(day(l.closed_at)) },
        { label: "", get: (l) => '<button class="btn btn-sm" type="button" data-gaction="copy" data-copy="' + esc(l.link) + '">Copy request link</button>' },
      ], d.clients, empty("No won clients yet", "Clients get the request automatically in week eight of onboarding."));
      return callout("<strong>Shows only when all three are true:</strong> approved here, the client's consent recorded with the website scope, and text that passes the banned-phrase and outcome-promise checks. Live proof appears under the application on the landing pages (the visitor's industry first) and as one line on /book.", "info") +
        card({ title: "Proof", flush: true, body: rows }) +
        card({ title: "Ask a client", sub: "A personal, signed link to a short form: their words, optional name, role and company, and what they agree to. Submissions arrive here unapproved.", flush: true, body: clients });
    },
  };
  function proofForm(p) {
    p = p || { kind: "quote", consent_scope: "" };
    const d = data || {};
    const scopes = (p.consent_scope || "").split(",");
    return '<form data-gsubmit="proof-save" data-id="' + esc(p.id || "") + '" class="form-grid">' +
      field("Kind", sel("kind", (d.kinds || []).map((k) => ({ value: k, label: KIND_LABEL[k] || k })), p.kind)) +
      field("Industry", sel("industry", [{ value: "", label: "Any industry" }].concat((d.industries || []).map((i) => ({ value: i.id, label: i.label }))), p.industry || "")) +
      field("Text", '<textarea class="textarea" name="body" rows="4" maxlength="1200">' + esc(p.body || "") + "</textarea>", "span-all", "Exactly what the client said or wrote. Never paraphrase into a stronger claim.") +
      field("Name", '<input class="input" name="author_name" maxlength="60" value="' + esc(p.author_name || "") + '">') +
      field("Role", '<input class="input" name="author_role" maxlength="60" value="' + esc(p.author_role || "") + '">') +
      field("Company", '<input class="input" name="company" maxlength="80" value="' + esc(p.company || "") + '">') +
      field("Media URL", '<input class="input" name="media_url" maxlength="500" placeholder="https://…" value="' + esc(p.media_url || "") + '">', "", "Screenshots, logos and videos need one.") +
      field("Consent given on", '<input class="input" type="date" name="consent_at" value="' + esc(dateInput(p.consent_at)) + '">', "", "Leave empty until the client has agreed in writing.") +
      '<div class="field span-all"><span class="field-label">The client agreed to</span><div class="gx-checks">' + ((d.scopes || []).map((s) => '<label class="row small"><input type="checkbox" name="scope" value="' + esc(s.id) + '"' + (scopes.includes(s.id) ? " checked" : "") + "> " + esc(s.label) + "</label>").join("")) + "</div></div>" +
      '<label class="field span-all"><span class="switch"><input type="checkbox" name="approved"' + (p.approved ? " checked" : "") + '><span class="switch-track"></span><span>Approved for the site</span></span></label>' +
      '<div class="form-actions span-all">' + (p.id ? '<button class="btn btn-danger" type="button" data-gaction="proof-delete" data-id="' + esc(p.id) + '">Delete</button><span class="spacer"></span>' : "") +
      '<button class="btn" type="button" data-action="modal-close">Cancel</button><button class="btn btn-primary" type="submit">Save</button></div></form>';
  }

  // Cohorts
  R["g/cohorts"] = {
    load: () => api("/cohorts"),
    actions: () => '<button class="btn" type="button" data-gaction="cohort-notify">Send apply-by notes now</button><button class="btn btn-primary" type="button" data-gaction="cohort-new">New cohort</button>',
    render: (d) => {
      const STATUS = { draft: ["Draft", "b-grey"], open: ["Open", "b-green"], closed: ["Closed", "b-grey"] };
      const line = d.next ? callout("<strong>Shown on the site now:</strong> " + esc(d.next.line), "info")
        : callout("<strong>Nothing is shown on the site.</strong> There is no open cohort that is still taking applications and has places.", "warn");
      const rows = table([
        { label: "Starts", get: (c) => esc(ymd(c.starts_on)) },
        { label: "Applications close", get: (c) => esc(ymd(c.apply_by)) },
        { label: "Capacity", num: true, get: (c) => esc(n(c.capacity)) },
        { label: "Taken", num: true, get: (c) => esc(n(c.taken)) },
        { label: "Open", num: true, get: (c) => esc(n(c.open)) },
        { label: "Status", get: (c) => badge(STATUS[c.status][0], STATUS[c.status][1]) },
        { label: "", get: (c) => '<button class="btn btn-sm btn-ghost" type="button" data-gaction="cohort-edit" data-id="' + esc(c.id) + '">Edit</button>' },
      ], d.cohorts, empty("No cohorts yet", "Add the next cohort's start date, how many businesses you take and when applications close. The site shows it only while it has places."));
      const opts = [{ value: "", label: "By date" }].concat(d.cohorts.filter((c) => c.status !== "draft").map((c) => ({ value: c.id, label: "Starts " + ymd(c.starts_on) })));
      const clients = table([
        { label: "Client", get: (l) => '<a class="t-name" href="#lead=' + encodeURIComponent(l.id) + '">' + esc(l.name) + "</a>" },
        { label: "Won", get: (l) => esc(day(l.closed_at)) },
        { label: "Cohort", get: (l) => {
          const auto = !l.explicit && l.cohort_id ? d.cohorts.find((c) => c.id === l.cohort_id) : null;
          return sel("cohort", opts, l.explicit ? l.cohort_id : "", ' data-gchange="cohort-assign" data-lead="' + esc(l.id) + '" aria-label="Cohort for ' + esc(l.name) + '"') +
            (auto ? '<div class="small faint">By date: starts ' + esc(ymd(auto.starts_on)) + "</div>" : (!l.explicit ? '<div class="small faint">By date: no cohort</div>' : ""));
        } },
      ], d.clients, empty("No won clients yet", "Won deals count against the cohort whose window contains the close date, unless you assign them here."));
      return line + card({ title: "Cohorts", sub: "Dates are in " + d.timezone + ". Open A/B leads who have not booked get one note " + d.notice_days + " days before applications close (COHORT_NOTICE_DAYS).", flush: true, body: rows }) +
        card({ title: "Clients and cohorts", sub: "A won deal takes a place in the cohort whose window (after the previous cohort's close date, up to this one's) contains its close date. Assign one by hand to override.", flush: true, body: clients });
    },
  };
  function cohortForm(c) {
    c = c || { status: "open", capacity: 6 };
    return '<form data-gsubmit="cohort-save" data-id="' + esc(c.id || "") + '" class="form-grid">' +
      field("Starts on", '<input class="input" type="date" name="starts_on" required value="' + esc(c.starts_on || "") + '">') +
      field("Applications close", '<input class="input" type="date" name="apply_by" required value="' + esc(c.apply_by || "") + '">') +
      field("Businesses per cohort", '<input class="input" type="number" name="capacity" min="1" max="200" required value="' + esc(c.capacity) + '">', "", "Your real limit. Places open are counted from won deals, never typed.") +
      field("Status", sel("status", [{ value: "draft", label: "Draft (not shown)" }, { value: "open", label: "Open" }, { value: "closed", label: "Closed" }], c.status)) +
      '<div class="form-actions span-all">' + (c.id ? '<button class="btn btn-danger" type="button" data-gaction="cohort-delete" data-id="' + esc(c.id) + '">Delete</button><span class="spacer"></span>' : "") +
      '<button class="btn" type="button" data-action="modal-close">Cancel</button><button class="btn btn-primary" type="submit">Save</button></div></form>';
  }

  // Referrals
  R["g/referrals"] = {
    load: () => api("/referrals"),
    render: (d) => {
      const t = d.totals;
      const tiles = '<div class="kpis k6">' + [
        kpi("Visits via links", esc(n(t.visitors)), "First touch, people not visits"),
        kpi("Referred leads", esc(n(t.referred)), esc(n(t.applied)) + " finished the application"),
        kpi("Booked", esc(n(t.booked)), esc(pc(t.booked_rate)) + " of referred leads"),
        kpi("Won", esc(n(t.won)), esc(pc(t.won_rate)) + " of booked"),
        kpi("Cash", esc(money(t.cash)), "From referred clients"),
        kpi("Referrers", esc(n(d.leaderboard.length)), "With at least one lead"),
      ].join("") + "</div>";
      const reward = d.reward ? callout("<strong>Reward shown on the referral page:</strong> " + esc(d.reward), "info")
        : callout("<strong>No reward line.</strong> Set REFERRAL_REWARD only for a real reward you will honour; until then the referral page shows none.", "");
      const board = table([
        { label: "Referrer", get: (r) => (r.id ? '<a class="t-name" href="#lead=' + encodeURIComponent(r.id) + '">' + esc(r.name) + "</a>" : esc(r.name)) + '<div class="small faint mono">' + esc(r.ref || "") + "</div>" },
        { label: "Visits", num: true, get: (r) => esc(n(r.visitors)) },
        { label: "Leads", num: true, get: (r) => esc(n(r.referred)) },
        { label: "Applied", num: true, get: (r) => esc(n(r.applied)) },
        { label: "A/B", num: true, get: (r) => esc(n(r.qualified)) },
        { label: "Booked", num: true, get: (r) => esc(n(r.booked)) },
        { label: "Won", num: true, get: (r) => esc(n(r.won)) },
        { label: "Cash", num: true, get: (r) => esc(money(r.cash)) },
        { label: "Lead → booked", num: true, get: (r) => esc(pc(r.booked_rate)) },
        { label: "Booked → won", num: true, get: (r) => esc(pc(r.won_rate)) },
      ], d.leaderboard, empty("No referrals yet", "Every lead has a personal link (/?r=their reference). Won clients are asked a month in, lost leads once, and booked leads see a short note on the pre-call page."));
      return tiles + reward + card({ title: "Leaderboard", flush: true, body: board });
    },
  };

  // Experiments
  R["g/experiments"] = {
    load: () => api("/experiments"),
    actions: () => '<button class="btn btn-primary" type="button" data-gaction="exp-new">New experiment</button>',
    render: (d) => {
      const intro = callout("Each visitor keeps their variant (a first-party cookie, else a hash of their visitor id). Results compare booked A/B calls per visitor against the control with a two-proportion z-test. The headline test on the main page still lives in <a href=\"#landers\">Landing pages &amp; tests</a>.", "info");
      if (!d.experiments.length) return intro + card({ body: empty("No experiments yet", "Create one, check the variants, then start it. Only one experiment runs per slot.") });
      const ST = { draft: ["Draft", "b-grey"], running: ["Running", "b-green"], stopped: ["Stopped", "b-grey"] };
      return intro + d.experiments.map((e) => {
        const actions = e.status === "draft" ? '<button class="btn btn-sm btn-ghost btn-danger" type="button" data-gaction="exp-delete" data-id="' + esc(e.id) + '">Delete</button><button class="btn btn-sm btn-primary" type="button" data-gaction="exp-start" data-id="' + esc(e.id) + '">Start</button>'
          : e.status === "running" ? '<button class="btn btn-sm" type="button" data-gaction="exp-stop" data-id="' + esc(e.id) + '">Stop</button>' : "";
        const when = e.started_at ? "Started " + day(e.started_at) + (e.ended_at ? ", stopped " + day(e.ended_at) : "") : "Not started";
        const warn = e.status !== "draft" && e.warning ? callout(esc(e.warning), "warn") : "";
        const rows = table([
          { label: "Variant", get: (a) => '<span class="mono">' + esc(a.id.toUpperCase()) + "</span> " + esc(a.value) + (a.control ? " " + badge("Control", "b-blue") : "") },
          { label: "Weight", num: true, get: (a) => esc(n1(a.weight)) },
          { label: "Visitors", num: true, get: (a) => esc(n(a.visitors)) },
          { label: "Applications", num: true, get: (a) => esc(n(a.applications)) },
          { label: "A/B", num: true, get: (a) => esc(n(a.qualified)) },
          { label: "Booked", num: true, get: (a) => esc(n(a.booked)) },
          { label: "Showed", num: true, get: (a) => esc(n(a.showed)) },
          { label: "Won", num: true, get: (a) => esc(n(a.won)) },
          { label: "Cash", num: true, get: (a) => esc(money(a.cash)) },
          { label: "Booked A/B per 100", num: true, get: (a) => esc(isNum(a.booked_rate) ? NF1.format(a.booked_rate) : "—") },
          { label: "p vs control", num: true, get: (a) => a.control ? '<span class="faint">—</span>' : esc(isNum(a.p) ? a.p.toFixed(3) : "—") + (a.significant ? " " + badge("p < 0.05", "b-green") : "") },
        ], e.arms);
        return card({ title: e.name, sub: e.slot_label + " · " + e.slot_where + " · " + when, actions: badge(ST[e.status][0], ST[e.status][1]) + actions, flush: true, body: warn + rows });
      }).join("");
    },
  };
  const n1 = (v) => (isNum(v) ? NF1.format(v) : "—");
  function expForm() {
    const d = data || { slots: [] };
    const first = d.slots[0] || { id: "", values: null, control: "" };
    return '<form data-gsubmit="exp-save" class="form-grid">' +
      field("Slot", sel("slot", d.slots.map((s) => ({ value: s.id, label: s.label })), first.id, ' data-gchange="exp-slot"')) +
      field("Name", '<input class="input" name="name" maxlength="80" placeholder="e.g. Shorter CTA">') +
      field("Variants, one per line (the first is the control)", '<textarea class="textarea" name="values" rows="4" required>' + esc(slotDefault(first)) + "</textarea>", "span-all") +
      '<p class="field-help span-all" id="exp-help">' + esc(slotHelp(first)) + "</p>" +
      field("Weights", '<input class="input" name="weights" placeholder="1, 1">', "", "Optional. One number per variant; equal by default.") +
      '<div class="form-actions span-all"><button class="btn" type="button" data-action="modal-close">Cancel</button><button class="btn btn-primary" type="submit">Create as draft</button></div></form>';
  }
  function slotDefault(s) {
    if (!s) return "";
    if (!s.values) return s.control + "\n";
    return [s.control].concat(s.values.filter((v) => v !== s.control)).slice(0, 2).join("\n");
  }
  function slotHelp(s) {
    if (!s) return "";
    return s.where + ". " + (s.values ? "Allowed values: " + s.values.join(", ") + "." : "Button text, 3 to 48 characters. Never call the call free.") + " Current: " + s.control + ".";
  }

  // ── Events ─────────────────────────────────────────────────────────────────
  const findById = (list, id) => (list || []).find((x) => x.id === id);
  const gactions = {
    copy: async (el) => {
      const v = el.dataset.copy || "";
      try { await navigator.clipboard.writeText(v); toast("Copied the link"); } catch (e) { toast("Copy failed. Select and copy: " + v, "err"); }
    },
    "proof-new": () => openModal("Add proof", proofForm(null)),
    "proof-edit": (el) => openModal("Edit proof", proofForm(findById(data && data.items, el.dataset.id))),
    "proof-approve": async (el) => {
      try { await api("/proof/" + encodeURIComponent(el.dataset.id) + "/approve", { method: "POST", body: { approved: el.dataset.on === "1" } }); toast(el.dataset.on === "1" ? "Approved" : "Unapproved"); load(true); } catch (e) { fail(e); }
    },
    "proof-delete": async (el) => {
      if (!confirm("Delete this proof item? This cannot be undone.")) return;
      try { await api("/proof/" + encodeURIComponent(el.dataset.id), { method: "DELETE" }); closeModal(); toast("Deleted"); load(true); } catch (e) { fail(e); }
    },
    "cohort-new": () => openModal("New cohort", cohortForm(null)),
    "cohort-edit": (el) => openModal("Edit cohort", cohortForm(findById(data && data.cohorts, el.dataset.id))),
    "cohort-delete": async (el) => {
      if (!confirm("Delete this cohort? Clients assigned to it go back to the automatic rule.")) return;
      try { await api("/cohorts/" + encodeURIComponent(el.dataset.id), { method: "DELETE" }); closeModal(); toast("Deleted"); load(true); } catch (e) { fail(e); }
    },
    "cohort-notify": async () => {
      try { const r = await api("/cohorts/notify", { method: "POST" }); toast(r.sent ? "Sent " + r.sent + " notes" : "Nothing sent: " + (r.reason || "no one due")); } catch (e) { fail(e); }
    },
    "exp-new": () => openModal("New experiment", expForm()),
    "exp-start": async (el) => { try { await api("/experiments/" + encodeURIComponent(el.dataset.id) + "/start", { method: "POST" }); toast("Started"); load(true); } catch (e) { fail(e); } },
    "exp-stop": async (el) => {
      if (!confirm("Stop this experiment? Everyone gets the default again, and a stopped experiment cannot restart.")) return;
      try { await api("/experiments/" + encodeURIComponent(el.dataset.id) + "/stop", { method: "POST" }); toast("Stopped"); load(true); } catch (e) { fail(e); }
    },
    "exp-delete": async (el) => { try { await api("/experiments/" + encodeURIComponent(el.dataset.id), { method: "DELETE" }); toast("Deleted"); load(true); } catch (e) { fail(e); } },
  };
  const gsubmits = {
    "proof-save": async (form) => {
      const f = new FormData(form);
      const at = String(f.get("consent_at") || "");
      const b = {
        kind: f.get("kind"), industry: f.get("industry"), body: f.get("body"), author_name: f.get("author_name"), author_role: f.get("author_role"),
        company: f.get("company"), media_url: f.get("media_url"), consent_at: at ? at + "T12:00:00Z" : null, consent_scope: f.getAll("scope"), approved: f.get("approved") === "on",
      };
      const id = form.dataset.id;
      try { await api(id ? "/proof/" + encodeURIComponent(id) : "/proof", { method: "POST", body: b }); closeModal(); toast("Saved"); load(true); } catch (e) { fail(e); }
    },
    "cohort-save": async (form) => {
      const f = new FormData(form);
      const id = form.dataset.id;
      const b = { starts_on: f.get("starts_on"), apply_by: f.get("apply_by"), capacity: Number(f.get("capacity")), status: f.get("status") };
      try { await api(id ? "/cohorts/" + encodeURIComponent(id) : "/cohorts", { method: "POST", body: b }); closeModal(); toast("Saved"); load(true); } catch (e) { fail(e); }
    },
    "exp-save": async (form) => {
      const f = new FormData(form);
      const b = { slot: f.get("slot"), name: f.get("name"), values: String(f.get("values") || "").split("\n"), weights: f.get("weights") };
      try { await api("/experiments", { method: "POST", body: b }); closeModal(); toast("Created as a draft. Check it, then press Start."); load(true); } catch (e) { fail(e); }
    },
  };
  const gchanges = {
    "cohort-assign": async (el) => {
      try { await api("/cohorts/assign", { method: "POST", body: { lead_id: el.dataset.lead, cohort_id: el.value } }); toast("Saved"); load(true); } catch (e) { fail(e); }
    },
    "exp-slot": (el) => {
      const s = (data && data.slots || []).find((x) => x.id === el.value);
      const form = el.closest("form");
      const help = form && form.querySelector("#exp-help");
      const ta = form && form.querySelector('textarea[name="values"]');
      if (help) help.textContent = slotHelp(s);
      if (ta) ta.value = slotDefault(s);
    },
  };

  document.addEventListener("click", (ev) => {
    const el = ev.target.closest("[data-gaction]");
    if (!el) return;
    const fn = gactions[el.dataset.gaction];
    if (!fn) return;
    ev.preventDefault();
    fn(el, ev);
  });
  document.addEventListener("submit", (ev) => {
    const form = ev.target.closest("form[data-gsubmit]");
    if (!form) return;
    ev.preventDefault();
    const fn = gsubmits[form.dataset.gsubmit];
    if (fn) fn(form, ev);
  });
  document.addEventListener("change", (ev) => {
    const el = ev.target.closest("[data-gchange]");
    if (el && gchanges[el.dataset.gchange]) gchanges[el.dataset.gchange](el, ev);
  });

  // Registered before admin.js boots (it adds its own listener on DOMContentLoaded), so a growth hash never
  // reaches admin.js's router; any other hash hands the screen back to it.
  window.addEventListener("hashchange", (ev) => {
    const g = growthHash();
    if (g) { ev.stopImmediatePropagation(); show(g); return; }
    if (location.hash.startsWith("#lead=")) return; // the lead drawer opens over whatever is showing
    hide();
  });

  function boot() {
    const nav = $("#nav");
    if (nav) new MutationObserver(() => { if (!nav.querySelector("[data-growth-nav]")) injectNav(); else syncNav(); }).observe(nav, { childList: true });
    injectNav();
    view();
    const g = growthHash();
    if (g) show(g);
  }
  if (document.readyState === "loading" || document.readyState === "interactive") document.addEventListener("DOMContentLoaded", boot, { once: true });
  else boot();
})();
