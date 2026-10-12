/* Funnel HQ · Funnel map. A shared, editable map of the whole machine with live numbers.
   window.FunnelMap.mount(el, api). Everything from stored data is rendered with textContent. */
(() => {
  "use strict";

  const W = 184; // node width (matches .fm-node)
  const SNAP = 10;
  const KIND_LABEL = { traffic: "Traffic", page: "Page", decision: "Decision", auto: "Automation", people: "People", data: "Engine room" };
  const KINDS = Object.keys(KIND_LABEL);
  const TABS = [
    ["", "None"], ["overview", "Overview"], ["traffic", "Traffic & ads"], ["landers", "Landing pages & tests"], ["links", "Links & videos"], ["vsl", "VSL"],
    ["behaviour", "On-page behaviour"], ["application", "Application"], ["leads", "Leads"], ["sales", "Sales team"], ["insights", "Insights"], ["team", "Team"],
    ["emails", "Emails"], ["voice", "Voice"], ["tracking", "Tracking"], ["live", "Live"], ["integrations", "Integrations"],
  ];
  const TAB_LABEL = Object.fromEntries(TABS);

  const N = (k, label) => (c) => ({ v: c[k], l: label });
  const R = (k, label) => (c, r) => ({ v: r[k], l: label, pct: true });

  // KEEP the ids in sync with BUILTIN_NODE_IDS in src/admin/map.ts.
  const NODES = [
    // Traffic
    { id: "src_meta", kind: "traffic", x: 0, y: 60, title: "Meta ads", sub: "Paid social, paid search", tab: "traffic", stat: N("src_paid", "paid visitors"),
      how: "Ads point at /m (the smart route) or straight at an industry lander. Every click arrives with fbclid and UTM tags, which first-party tracking stores on the visitor." },
    { id: "src_youtube", kind: "traffic", x: 0, y: 190, title: "YouTube and tracked links", sub: "/l/<code> short links", tab: "links", stat: N("src_video", "visitors"),
      how: "Tracked links in descriptions, pinned comments, podcasts and bios. /l/<code> redirects to a page on the site with the link's UTMs, so every lead and sale is credited to the exact video." },
    { id: "src_organic", kind: "traffic", x: 0, y: 320, title: "Organic and referral", sub: "Search, social, AI assistants", tab: "traffic", stat: N("src_organic", "visitors"),
      how: "Unpaid visits. The channel is worked out from the referrer and UTMs the first time a visitor arrives and kept as first touch." },
    { id: "src_direct", kind: "traffic", x: 0, y: 450, title: "Direct and email", sub: "Typed in, bookmarks, newsletters", tab: "traffic", stat: N("src_direct", "visitors"),
      how: "Visits with no referrer or campaign, plus email and SMS clicks. Returning visitors keep their first-touch source." },

    // Routing and pages
    { id: "meta_route", kind: "decision", x: 260, y: 60, title: "Smart route /m", sub: "Picks the right lander", tab: "landers", stat: N("meta_route", "routed"),
      how: "Reads the ind parameter or infers the industry from campaign and ad names. Known industry → that industry's lander, angle chosen by the bandit. Unknown → the main page." },
    { id: "main_ab", kind: "decision", x: 260, y: 320, title: "Headline test", sub: "Variant A or B, sticky per visitor", tab: "landers", stat: N("main_page", "saw the main page"),
      how: "The server assigns each new visitor a headline and keeps it in a cookie. The Landing pages tab runs a two-proportion z-test on applications per visitor." },
    { id: "landers", kind: "page", x: 520, y: 60, title: "Industry landers", sub: "/for/<industry>/<angle> · 100 pages", tab: "landers", stat: N("landers", "visitors"),
      how: "20 industries × 5 angles. A Thompson-sampling bandit shares traffic between the angles of each industry after every angle has had its minimum visitors." },
    { id: "main_page", kind: "page", x: 520, y: 320, title: "Main VSL page", sub: "Home page, /", tab: "vsl", stat: N("visitors", "visitors"),
      how: "The film, then the rest of the page unlocks as the film reaches the offer. Returning visitors who already reached the pitch see everything at once." },
    { id: "vsl", kind: "page", x: 780, y: 190, title: "The film", sub: "Heartbeat every 10 seconds", tab: "vsl", stat: N("plays", "plays"),
      how: "The player posts a 100-bucket watched map. The server fires play, unmute, 25/50/75/95% and complete exactly once, and only counts a view after unmute." },
    { id: "pitch", kind: "decision", x: 1040, y: 190, title: "Reached the pitch", sub: "Apply button appears", tab: "vsl", stat: N("pitch", "reached"),
      how: "When the film reaches the offer chapter, the apply button and the rest of the page appear." },
    { id: "apply", kind: "page", x: 1300, y: 190, title: "Application", sub: "/apply · contact first", tab: "application", stat: N("optins", "left details"),
      how: "Contact details on step one create the lead, so abandoned applications can be followed up. Each answer is saved as it is given." },
    { id: "scoring", kind: "auto", x: 1560, y: 190, title: "Scoring", sub: "Points + hard caps", tab: "application", stat: N("applied", "applications"),
      how: "Answers add points. Flags cap the tier: under $1M, excluded industries and blocked emails cap at C; not the owner, low spend or not ready cap at B." },
    { id: "tier_split", kind: "decision", x: 1820, y: 190, title: "A / B / C", sub: "A ≥ 70 · B ≥ 40", tab: "insights", stat: N("qualified", "qualified"),
      how: "A goes straight to the closer's calendar, B watches the breakout video first, C gets resources and nurture. QualifiedLead goes to Meta with a value per tier." },
    { id: "book", kind: "page", x: 2080, y: 60, title: "Book a call", sub: "/book · A tier", tab: "sales", stat: N("book_page", "visitors"),
      how: "The closer's calendar with the lead's details prefilled. Bookings are verified with Calendly before anything is sent." },
    { id: "breakout", kind: "page", x: 2080, y: 190, title: "Breakout video", sub: "/breakout · B tier", tab: "vsl", stat: N("breakout_page", "visitors"),
      how: "A short video on cost and time, then the setter calendar." },
    { id: "resources", kind: "page", x: 2080, y: 320, title: "Resources", sub: "/resources · C tier", tab: "emails", stat: N("resources_page", "visitors"),
      how: "Free resources and the WhatsApp button. C tier is never pushed to book." },
    { id: "booked", kind: "decision", x: 2340, y: 120, title: "Call booked", sub: "Verified with Calendly", tab: "sales", stat: N("booked", "booked"),
      how: "A verified booking cancels the marketing sequences and starts confirmations, reminders and the pre-call emails. Cancellations and reschedules are caught by webhook and hourly sync." },
    { id: "call", kind: "people", x: 2600, y: 120, title: "Strategy call", sub: "Closer logs the outcome", tab: "sales", stat: N("showed", "held"),
      how: "The rep gets a ping 15 minutes before with how much of the film the lead watched. After the call they log showed, won or lost in the lead drawer." },
    { id: "no_show", kind: "people", x: 2600, y: 300, title: "No-show", sub: "Rebook flow starts", tab: "sales", stat: N("no_show", "no-shows"),
      how: "Logging a no-show starts the rebook emails and, if switched on, an AI rebook call." },
    { id: "won", kind: "people", x: 2860, y: 40, title: "Won", sub: "Purchase sent to Meta", tab: "sales", stat: (c) => ({ v: c.won, l: "won", extra: c.revenue }),
      how: "Deal value goes to Meta as a Purchase. Payments are recorded in the ledger and cash collected is their sum." },
    { id: "lost", kind: "people", x: 2860, y: 180, title: "Lost", sub: "Reason logged", tab: "sales", stat: N("lost", "lost"),
      how: "Lost reason drives which re-engagement emails go out over the next six months." },

    // Automations
    { id: "triggers", kind: "auto", x: 1040, y: 480, title: "Behaviour triggers", sub: "One-off emails", tab: "emails", stat: N("triggers", "fired"),
      how: "Rules like 'watched half the film and did not apply' or 'opened the booking page and did not book'. Each fires at most once per lead, eight a day overall." },
    { id: "em_abandoned", kind: "auto", x: 1300, y: 480, title: "Abandoned application", sub: "5 emails over 4 days", tab: "emails", stat: N("email_abandoned", "sent"),
      how: "Starts when contact details are saved; stops the moment the application is submitted." },
    { id: "em_tiers", kind: "auto", x: 1820, y: 480, title: "Tier emails", sub: "A, B and C sequences", tab: "emails", stat: (c) => ({ v: (c.email_tier_a || 0) + (c.email_tier_b || 0) + (c.email_tier_c || 0), l: "sent" }),
      how: "A: get booked. B: objections, then book. C: resources. Each quotes the lead's own answers." },
    { id: "ai_speed", kind: "auto", x: 1820, y: 600, title: "Speed-to-lead AI call", sub: "Within minutes, A and B", tab: "voice", stat: N("call_speed", "queued"),
      how: "Sam calls qualified applicants who have not booked, within calling hours and only with consent, and can email the booking link." },
    { id: "em_nurture", kind: "auto", x: 2080, y: 480, title: "Six-month nurture", sub: "9 emails", tab: "emails", stat: N("email_nurture", "sent"),
      how: "For anyone who applied and did not book. Stops when they book or the deal closes." },
    { id: "em_booked", kind: "auto", x: 2340, y: 480, title: "Booked reminders", sub: "Confirm, 48h, 24h, 3h, 1h, 10m", tab: "emails", stat: N("email_booked", "sent"),
      how: "Timed from the call, in the lead's time zone." },
    { id: "ai_confirm", kind: "auto", x: 2340, y: 600, title: "Confirm AI call", sub: "Minutes after booking", tab: "voice", stat: N("call_confirm", "queued"),
      how: "A short call to confirm the time and answer questions. Can reschedule by email." },
    { id: "em_precall", kind: "auto", x: 2340, y: 720, title: "Pre-call emails", sub: "Prep and proof, paced per day", tab: "emails", stat: N("email_precall", "sent"),
      how: "Lead-specific prep emails alternate with general ones, up to the daily pace set in Integrations." },
    { id: "em_noshow", kind: "auto", x: 2600, y: 480, title: "No-show emails", sub: "7 emails over 14 days", tab: "emails", stat: N("email_no_show", "sent"),
      how: "Rebook first, then the lead's goal, blocker and numbers." },
    { id: "ai_rebook", kind: "auto", x: 2600, y: 600, title: "Rebook AI call", sub: "After a no-show", tab: "voice", stat: N("call_rebook", "queued"),
      how: "Sam calls to find a new time and emails the reschedule link." },
    { id: "em_cancelled", kind: "auto", x: 2600, y: 720, title: "Cancelled emails", sub: "4 emails", tab: "emails", stat: N("email_cancelled", "sent"),
      how: "When a booking is cancelled in Calendly, these invite the lead to rebook." },
    { id: "em_postcall", kind: "auto", x: 2860, y: 320, title: "Post-call follow-up", sub: "Held, no decision yet", tab: "emails", stat: N("email_post_call", "sent"),
      how: "Recap, then the objection the closer logged, numbers, proof and risk reversal." },
    { id: "pings", kind: "auto", x: 2860, y: 600, title: "Team pings", sub: "Slack and Discord", tab: "team", stat: null,
      how: "Hot leads, bookings, calls in 15 minutes, no-shows and wins. Only the name, ref and tier are sent, never answers or contact details." },
    { id: "digest", kind: "auto", x: 2860, y: 720, title: "Daily digest", sub: "Yesterday in one message", tab: "team", stat: null,
      how: "Visitors, applications, bookings, calls held, wins and cash, at the hour set in Integrations." },
    { id: "em_won", kind: "auto", x: 3120, y: 40, title: "Won onboarding", sub: "6 emails over 30 days", tab: "emails", stat: N("email_won", "sent"),
      how: "Kickoff, what to prepare, first build. Stops if refunded." },
    { id: "em_lost", kind: "auto", x: 3120, y: 180, title: "Lost re-engagement", sub: "6 emails over 6 months", tab: "emails", stat: N("email_lost", "sent"),
      how: "Angles chosen by the lost reason the closer logged." },

    // Engine room
    { id: "tracking", kind: "data", x: 520, y: 900, title: "First-party tracking", sub: "Visitors, sessions, events", tab: "tracking", stat: N("visitors", "visitors"),
      how: "Server-side page views and first-party cookies. Bots are filtered. Consent is respected in the EU, UK and EEA." },
    { id: "forwarding", kind: "data", x: 780, y: 900, title: "Meta CAPI · GA4 · PostHog", sub: "Server-side forwarding", tab: "tracking", stat: N("forwards", "delivered"),
      how: "Each key event is forwarded with hashed match keys and a shared event id for deduplication. Failures retry with backoff." },
    { id: "profile", kind: "data", x: 1040, y: 900, title: "Behaviour profile", sub: "What each lead did, as facts", tab: "behaviour", stat: null,
      how: "Film chapters watched, FAQs opened, sections re-read, visits. Some facts can be said back to the lead; background facts never are." },
    { id: "reader", kind: "data", x: 1300, y: 900, title: "Application reader", sub: "Answers → safe dossier", tab: "application", stat: N("applied", "read"),
      how: "Turns answers into a dossier emails can quote. Everything a lead typed is escaped and stripped of links once, here." },
    { id: "claude", kind: "data", x: 1560, y: 900, title: "Claude personalisation", sub: "Rewrites with real facts", tab: "integrations", stat: null,
      how: "Rewrites each email around the lead's facts, validated against banned claims. Falls back to rules mode without a key." },
    { id: "inbound", kind: "data", x: 2340, y: 900, title: "Inbound callback agent", sub: "Answers your number", tab: "voice", stat: N("inbound_calls", "calls"),
      how: "Answers calls to your number, looks up the caller and can send booking or reschedule links." },
    { id: "hq", kind: "data", x: 2860, y: 900, title: "Funnel HQ", sub: "This dashboard", tab: "overview", stat: null,
      how: "Every number on this map comes from the same tables the funnel writes to." },
  ];

  /** [from, to, label | "r:<rateKey>", style] */
  const EDGES = [
    ["src_meta", "meta_route", "", ""],
    ["meta_route", "landers", "known", ""],
    ["meta_route", "main_ab", "unknown", "dash"],
    ["src_youtube", "main_ab", "", ""],
    ["src_organic", "main_ab", "", ""],
    ["src_direct", "main_ab", "", ""],
    ["main_ab", "main_page", "A / B", ""],
    ["landers", "vsl", "", ""],
    ["main_page", "vsl", "r:visit_play", ""],
    ["vsl", "pitch", "r:play_pitch", ""],
    ["pitch", "apply", "r:pitch_apply", ""],
    ["apply", "scoring", "r:optin_applied", ""],
    ["scoring", "tier_split", "", ""],
    ["tier_split", "book", "r:applied_a", ""],
    ["tier_split", "breakout", "r:applied_b", ""],
    ["tier_split", "resources", "r:applied_c", ""],
    ["book", "booked", "r:a_booked", ""],
    ["breakout", "booked", "", ""],
    ["booked", "call", "r:booked_showed", ""],
    ["booked", "no_show", "r:booked_noshow", ""],
    ["call", "won", "r:showed_won", ""],
    ["call", "lost", "r:showed_lost", ""],
    ["no_show", "booked", "rebook", "dash"],
    ["apply", "em_abandoned", "left early", "auto"],
    ["profile", "triggers", "", "data"],
    ["triggers", "book", "nudge", "auto"],
    ["tier_split", "em_tiers", "", "auto"],
    ["tier_split", "ai_speed", "A and B", "auto"],
    ["ai_speed", "book", "", "auto"],
    ["em_tiers", "book", "", "auto"],
    ["em_tiers", "em_nurture", "not booked", "auto"],
    ["booked", "em_booked", "", "auto"],
    ["booked", "ai_confirm", "", "auto"],
    ["booked", "em_precall", "", "auto"],
    ["no_show", "em_noshow", "", "auto"],
    ["no_show", "ai_rebook", "", "auto"],
    ["ai_rebook", "booked", "", "auto"],
    ["booked", "em_cancelled", "cancelled", "auto"],
    ["call", "em_postcall", "no decision", "auto"],
    ["em_postcall", "won", "", "auto"],
    ["won", "em_won", "", "auto"],
    ["lost", "em_lost", "", "auto"],
    ["booked", "pings", "", "auto"],
    ["hq", "digest", "", "data"],
    ["main_page", "tracking", "", "data"],
    ["tracking", "forwarding", "", "data"],
    ["tracking", "profile", "", "data"],
    ["apply", "reader", "", "data"],
    ["profile", "claude", "", "data"],
    ["reader", "claude", "", "data"],
    ["claude", "em_tiers", "", "data"],
    ["inbound", "booked", "callbacks", "data"],
    ["tracking", "hq", "", "data"],
  ];

  const BUILTIN = new Map(NODES.map((n) => [n.id, n]));

  function el(tag, cls, text) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }
  const svgEl = (tag, attrs) => {
    const e = document.createElementNS("http://www.w3.org/2000/svg", tag);
    for (const k in attrs) e.setAttribute(k, attrs[k]);
    return e;
  };
  const uid = () => {
    const a = new Uint8Array(8);
    crypto.getRandomValues(a);
    return "u_" + Array.from(a, (b) => "abcdefghijklmnopqrstuvwxyz0123456789"[b % 36]).join("");
  };
  const snap = (v) => Math.round(v / SNAP) * SNAP;
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

  function mount(host, api) {
    host.innerHTML = "";
    const st = {
      layout: {}, custom: { nodes: [], edges: [], edits: {} }, counts: {}, rates: {},
      tx: 40, ty: 40, k: 0.6, sel: null, sizes: new Map(), panel: null, hint: null,
    };

    // ── DOM ────────────────────────────────────────────────────────────────
    const root = el("div", "fm");
    const stage = el("div", "fm-stage");
    const world = el("div", "fm-world");
    const svg = svgEl("svg", { class: "fm-edges", width: "4000", height: "1200" });
    world.appendChild(svg);
    stage.appendChild(world);
    const toolbar = el("div", "fm-toolbar");
    const tools = el("div", "fm-tools");
    const btn = (label, title, fn, cls) => { const b = el("button", "btn btn-ghost btn-sm" + (cls ? " " + cls : ""), label); b.type = "button"; b.title = title; b.addEventListener("click", fn); return b; };
    tools.append(btn("−", "Zoom out", () => zoomBy(1 / 1.2)), btn("+", "Zoom in", () => zoomBy(1.2)), btn("Fit", "Fit everything in view", fit));
    const tools2 = el("div", "fm-tools");
    tools2.append(btn("+ Add step", "Add your own step to the map", () => showAddForm()), btn("Reset layout", "Put built-in steps back where they started", resetLayout), btn("How it works", "How to read and edit the map", () => { st.sel = null; for (const d of nodeEls.values()) d.classList.remove("sel"); drawEdges(); showIntro(); }));
    toolbar.append(tools, tools2);
    stage.appendChild(toolbar);
    const legend = el("div", "fm-legend");
    for (const k of KINDS) { const s = el("span"); s.appendChild(el("i", "k-" + k)); s.appendChild(document.createTextNode(KIND_LABEL[k])); legend.appendChild(s); }
    stage.appendChild(legend);
    const zoomEl = el("div", "fm-zoom");
    stage.appendChild(zoomEl);
    const panel = el("aside", "fm-panel");
    panel.hidden = true;
    const closePanel = () => { panel.hidden = true; };
    root.append(stage, panel);
    host.appendChild(root);

    // ── Model ──────────────────────────────────────────────────────────────
    function allNodes() {
      const out = NODES.map((n) => {
        const e = st.custom.edits[n.id] || {};
        const p = st.layout[n.id];
        return Object.assign({}, n, { title: e.title || n.title, sub: e.sub != null && e.sub !== "" ? e.sub : n.sub, note: e.note || "", x: p ? p.x : n.x, y: p ? p.y : n.y, builtin: true, edited: !!st.custom.edits[n.id] });
      });
      for (const c of st.custom.nodes) out.push(Object.assign({}, c, { builtin: false, stat: null, how: "" }));
      return out;
    }
    function allEdges() {
      const out = EDGES.map((e, i) => ({ id: "b" + i, from: e[0], to: e[1], label: e[2], style: e[3], builtin: true }));
      for (const c of st.custom.edges) out.push(Object.assign({}, c, { builtin: false }));
      return out;
    }
    const nodeById = (id) => allNodes().find((n) => n.id === id);

    function statOf(n) {
      if (!n.stat) return null;
      try { return n.stat(st.counts, st.rates); } catch (e) { return null; }
    }
    function statText(s) {
      if (!s || s.v == null) return null;
      return (s.pct ? api.fmt.pc(s.v) : api.fmt.n(s.v));
    }
    function edgeLabel(e) {
      if (!e.label) return "";
      if (e.label.startsWith("r:")) {
        const v = st.rates[e.label.slice(2)];
        return v == null || v > 100 ? "" : api.fmt.pc(v);
      }
      return e.label;
    }

    // ── Render ─────────────────────────────────────────────────────────────
    const nodeEls = new Map();
    function render() {
      for (const e of nodeEls.values()) e.remove();
      nodeEls.clear();
      for (const n of allNodes()) {
        const d = el("div", "fm-node k-" + n.kind + (n.builtin ? "" : " custom") + (st.sel === n.id ? " sel" : ""));
        d.dataset.id = n.id;
        d.tabIndex = 0;
        d.setAttribute("role", "button");
        d.setAttribute("aria-label", n.title);
        d.appendChild(el("div", "fm-node-kind", KIND_LABEL[n.kind] || n.kind));
        d.appendChild(el("div", "fm-node-title", n.title));
        if (n.sub) d.appendChild(el("div", "fm-node-sub", n.sub));
        const s = statOf(n);
        const t = statText(s);
        if (t != null) {
          const sd = el("div", "fm-node-stat", t + " ");
          sd.appendChild(el("span", "faint", s.l));
          if (s.extra) sd.appendChild(el("span", "faint", " · " + api.fmt.money(s.extra)));
          d.appendChild(sd);
        }
        const port = el("span", "fm-port");
        port.title = "Drag onto another step to draw an arrow";
        d.appendChild(port);
        d.style.left = n.x + "px";
        d.style.top = n.y + "px";
        world.appendChild(d);
        nodeEls.set(n.id, d);
      }
      for (const [id, d] of nodeEls) st.sizes.set(id, { w: d.offsetWidth || W, h: d.offsetHeight || 72 });
      drawEdges();
      applyTransform();
    }

    function pos(id) {
      const d = nodeEls.get(id);
      if (!d) return null;
      const sz = st.sizes.get(id) || { w: W, h: 72 };
      return { x: parseFloat(d.style.left), y: parseFloat(d.style.top), w: sz.w, h: sz.h };
    }

    function curve(a, b) {
      const x1 = a.x + a.w, y1 = a.y + a.h / 2, x2 = b.x, y2 = b.y + b.h / 2;
      let c1x, c2x, c1y = y1, c2y = y2;
      if (x2 >= x1 + 20) {
        const dx = Math.max(40, (x2 - x1) / 2);
        c1x = x1 + dx; c2x = x2 - dx;
      } else {
        const dx = Math.max(80, Math.abs(x2 - x1) / 3 + 60);
        c1x = x1 + dx; c2x = x2 - dx;
        if (Math.abs(y2 - y1) < 40) { c1y = y1 + 90; c2y = y2 + 90; }
      }
      return { x1, y1, c1x, c1y, c2x, c2y, x2, y2 };
    }
    const bez = (p, t) => {
      const u = 1 - t;
      return {
        x: u * u * u * p.x1 + 3 * u * u * t * p.c1x + 3 * u * t * t * p.c2x + t * t * t * p.x2,
        y: u * u * u * p.y1 + 3 * u * u * t * p.c1y + 3 * u * t * t * p.c2y + t * t * t * p.y2,
      };
    };

    function drawEdges() {
      while (svg.firstChild) svg.removeChild(svg.firstChild);
      let maxX = 0, maxY = 0;
      for (const id of nodeEls.keys()) { const p = pos(id); maxX = Math.max(maxX, p.x + p.w + 200); maxY = Math.max(maxY, p.y + p.h + 200); }
      svg.setAttribute("width", String(Math.max(400, maxX)));
      svg.setAttribute("height", String(Math.max(400, maxY)));
      const labels = [];
      for (const e of allEdges()) {
        const a = pos(e.from), b = pos(e.to);
        if (!a || !b) continue;
        const p = curve(a, b);
        const hl = st.sel && (e.from === st.sel || e.to === st.sel);
        const cls = "fm-edge" + (e.style ? " " + e.style : "") + (e.builtin ? "" : " custom") + (hl ? " hl" : "");
        svg.appendChild(svgEl("path", { class: cls, d: `M${p.x1},${p.y1} C${p.c1x},${p.c1y} ${p.c2x},${p.c2y} ${p.x2},${p.y2}` }));
        // Arrowhead along the end tangent.
        const ang = Math.atan2(p.y2 - p.c2y, p.x2 - p.c2x);
        const L = 7, Wd = 4;
        const bx = p.x2 - L * Math.cos(ang), by = p.y2 - L * Math.sin(ang);
        const pts = [[p.x2, p.y2], [bx + Wd * Math.sin(ang), by - Wd * Math.cos(ang)], [bx - Wd * Math.sin(ang), by + Wd * Math.cos(ang)]];
        const arrow = svgEl("polygon", { points: pts.map((q) => q.join(",")).join(" "), class: cls.replace("fm-edge", "fm-arrow") });
        svg.appendChild(arrow);
        const text = edgeLabel(e);
        if (text) labels.push({ text, at: bez(p, 0.5), rate: e.label.startsWith("r:") });
      }
      for (const lb of labels) {
        const t = svgEl("text", { class: "fm-label" + (lb.rate ? " rate" : ""), x: String(lb.at.x), y: String(lb.at.y + 4), "text-anchor": "middle" });
        t.textContent = lb.text;
        svg.appendChild(t);
        const w = Math.max(24, lb.text.length * 6.4 + 12);
        const r = svgEl("rect", { class: "fm-label-bg", x: String(lb.at.x - w / 2), y: String(lb.at.y - 9), width: String(w), height: "18", rx: "9" });
        svg.insertBefore(r, t);
      }
    }

    function applyTransform() {
      world.style.transform = `translate(${st.tx}px, ${st.ty}px) scale(${st.k})`;
      zoomEl.textContent = Math.round(st.k * 100) + "%";
    }
    function zoomAt(k, cx, cy) {
      const nk = clamp(k, 0.25, 1.75);
      st.tx = cx - ((cx - st.tx) * nk) / st.k;
      st.ty = cy - ((cy - st.ty) * nk) / st.k;
      st.k = nk;
      applyTransform();
    }
    function zoomBy(f) { const r = stage.getBoundingClientRect(); zoomAt(st.k * f, r.width / 2, r.height / 2); }
    function fit() {
      const r = stage.getBoundingClientRect();
      let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
      for (const id of nodeEls.keys()) { const p = pos(id); x0 = Math.min(x0, p.x); y0 = Math.min(y0, p.y); x1 = Math.max(x1, p.x + p.w); y1 = Math.max(y1, p.y + p.h); }
      if (!isFinite(x0)) return;
      const pad = 48, top = toolbar.offsetHeight + 24;
      const k = clamp(Math.min((r.width - pad * 2) / (x1 - x0), (r.height - pad - top) / (y1 - y0)), 0.2, 1.2);
      st.k = k;
      st.tx = (r.width - (x1 - x0) * k) / 2 - x0 * k;
      st.ty = top + (r.height - top - pad - (y1 - y0) * k) / 2 - y0 * k;
      applyTransform();
    }
    /** Fit when that stays readable; otherwise open at a readable zoom on the start of the funnel. */
    function start() {
      fit();
      if (st.k >= 0.6) return;
      let x0 = Infinity, y0 = Infinity;
      for (const id of nodeEls.keys()) { const p = pos(id); x0 = Math.min(x0, p.x); y0 = Math.min(y0, p.y); }
      st.k = stage.clientWidth < 600 ? 0.62 : 0.78;
      st.tx = 24 - x0 * st.k;
      st.ty = toolbar.offsetHeight + 28 - y0 * st.k;
      applyTransform();
    }
    function centerOn(id) {
      const p = pos(id);
      if (!p) return;
      const r = stage.getBoundingClientRect();
      st.k = Math.max(st.k, 0.7);
      st.tx = r.width / 2 - (p.x + p.w / 2) * st.k;
      st.ty = r.height / 2 - (p.y + p.h / 2) * st.k;
      applyTransform();
    }

    // ── Persistence ────────────────────────────────────────────────────────
    let layoutTimer = null, customTimer = null;
    function saveLayoutSoon() {
      clearTimeout(layoutTimer);
      layoutTimer = setTimeout(() => api.put("/map/layout", st.layout).catch(api.fail), 600);
    }
    function saveCustomSoon(now) {
      clearTimeout(customTimer);
      const go = () => api.put("/map/custom", st.custom).then((r) => { st.custom = r.custom; }).catch((e) => { api.fail(e); load(); });
      if (now) return go();
      customTimer = setTimeout(go, 600);
    }
    function resetLayout() {
      if (!confirm("Put every built-in step back where it started? Your own steps keep their positions. This changes the map for everyone.")) return;
      st.layout = {};
      api.put("/map/layout", {}).then(() => api.toast("Layout reset")).catch(api.fail);
      render();
      fit();
    }

    // ── Pointer: pan, drag, connect ────────────────────────────────────────
    let gesture = null;
    const toWorld = (cx, cy) => { const r = stage.getBoundingClientRect(); return { x: (cx - r.left - st.tx) / st.k, y: (cy - r.top - st.ty) / st.k }; };

    stage.addEventListener("pointerdown", (ev) => {
      if (ev.button !== 0) return;
      if (ev.target.closest(".fm-toolbar")) return;
      const port = ev.target.closest(".fm-port");
      const node = ev.target.closest(".fm-node");
      stage.setPointerCapture(ev.pointerId);
      if (port && node) {
        const from = node.dataset.id;
        const draft = svgEl("path", { class: "fm-edge draft" });
        svg.appendChild(draft);
        gesture = { type: "connect", from, draft };
        ev.preventDefault();
        return;
      }
      if (node) {
        gesture = { type: "node", id: node.dataset.id, el: node, sx: ev.clientX, sy: ev.clientY, ox: parseFloat(node.style.left), oy: parseFloat(node.style.top), moved: false };
        return;
      }
      gesture = { type: "pan", sx: ev.clientX, sy: ev.clientY, tx: st.tx, ty: st.ty, moved: false };
      stage.classList.add("panning");
    });
    stage.addEventListener("pointermove", (ev) => {
      if (!gesture) return;
      if (gesture.type === "pan") {
        const dx = ev.clientX - gesture.sx, dy = ev.clientY - gesture.sy;
        if (Math.abs(dx) + Math.abs(dy) > 3) gesture.moved = true;
        st.tx = gesture.tx + dx; st.ty = gesture.ty + dy;
        applyTransform();
      } else if (gesture.type === "node") {
        const dx = (ev.clientX - gesture.sx) / st.k, dy = (ev.clientY - gesture.sy) / st.k;
        if (!gesture.moved && Math.abs(dx) + Math.abs(dy) < 4) return;
        gesture.moved = true;
        gesture.el.classList.add("dragging");
        gesture.el.style.left = snap(gesture.ox + dx) + "px";
        gesture.el.style.top = snap(gesture.oy + dy) + "px";
        drawEdges();
      } else if (gesture.type === "connect") {
        const a = pos(gesture.from);
        const p = toWorld(ev.clientX, ev.clientY);
        const x1 = a.x + a.w, y1 = a.y + a.h / 2;
        const dx = Math.max(40, Math.abs(p.x - x1) / 2);
        gesture.draft.setAttribute("d", `M${x1},${y1} C${x1 + dx},${y1} ${p.x - dx},${p.y} ${p.x},${p.y}`);
        const over = document.elementFromPoint(ev.clientX, ev.clientY);
        const target = over && over.closest ? over.closest(".fm-node") : null;
        for (const d of nodeEls.values()) d.classList.toggle("drop", d === target && d.dataset.id !== gesture.from);
      }
    });
    function endGesture(ev) {
      if (!gesture) return;
      const g = gesture;
      gesture = null;
      stage.classList.remove("panning");
      if (g.type === "pan" && !g.moved && !ev.target.closest(".fm-node")) select(null);
      if (g.type === "node") {
        g.el.classList.remove("dragging");
        if (!g.moved) { select(g.id); return; }
        const x = parseFloat(g.el.style.left), y = parseFloat(g.el.style.top);
        if (BUILTIN.has(g.id)) { st.layout[g.id] = { x, y }; saveLayoutSoon(); }
        else { const c = st.custom.nodes.find((n) => n.id === g.id); if (c) { c.x = x; c.y = y; saveCustomSoon(); } }
      }
      if (g.type === "connect") {
        g.draft.remove();
        for (const d of nodeEls.values()) d.classList.remove("drop");
        const over = document.elementFromPoint(ev.clientX, ev.clientY);
        const target = over && over.closest ? over.closest(".fm-node") : null;
        if (target && target.dataset.id !== g.from) addEdge(g.from, target.dataset.id, "");
      }
    }
    stage.addEventListener("pointerup", endGesture);
    stage.addEventListener("pointercancel", endGesture);
    stage.addEventListener("wheel", (ev) => {
      ev.preventDefault();
      const r = stage.getBoundingClientRect();
      if (ev.ctrlKey || ev.metaKey) zoomAt(st.k * Math.exp(-ev.deltaY * 0.01), ev.clientX - r.left, ev.clientY - r.top);
      else { st.tx -= ev.deltaX; st.ty -= ev.deltaY; applyTransform(); }
    }, { passive: false });
    stage.addEventListener("keydown", (ev) => {
      const node = ev.target.closest && ev.target.closest(".fm-node");
      if (node && (ev.key === "Enter" || ev.key === " ")) { ev.preventDefault(); select(node.dataset.id); }
    });

    // ── Editing ────────────────────────────────────────────────────────────
    function addEdge(from, to, label) {
      if (st.custom.edges.length >= 400) { api.toast("That is the most arrows the map can hold.", "err"); return; }
      if (allEdges().some((e) => e.from === from && e.to === to && (e.label || "") === (label || ""))) { api.toast("That arrow already exists."); return; }
      st.custom.edges.push({ id: uid(), from, to, label: (label || "").slice(0, 30), style: "auto" });
      drawEdges();
      saveCustomSoon(true);
      api.toast("Arrow added");
      if (st.sel) showNode(st.sel);
    }
    function select(id) {
      st.sel = id;
      for (const [nid, d] of nodeEls) d.classList.toggle("sel", nid === id);
      drawEdges();
      if (id) showNode(id); else closePanel();
    }

    // ── Side panel ─────────────────────────────────────────────────────────
    function section(title, child) {
      const s = el("div");
      s.appendChild(el("h4", null, title));
      if (child) s.appendChild(child);
      return s;
    }
    function panelHead(h) {
      const x = el("button", "btn btn-ghost btn-icon btn-sm fm-panel-close", "×");
      x.type = "button";
      x.title = "Close";
      x.setAttribute("aria-label", "Close panel");
      x.addEventListener("click", () => { st.sel = null; for (const d of nodeEls.values()) d.classList.remove("sel"); drawEdges(); closePanel(); });
      h.appendChild(x);
    }
    function showIntro() {
      panel.hidden = false;
      panel.innerHTML = "";
      const h = el("div", "fm-panel-head");
      h.appendChild(el("div", "card-title", "How to read the map"));
      h.appendChild(el("p", "card-sub", "Left to right: traffic, pages, decisions, the call and the result. Automations sit underneath, the engine room at the bottom."));
      panelHead(h);
      panel.appendChild(h);
      const b = el("div", "fm-panel-body");
      const tips = [
        ["Live numbers", "Each step shows its count for the date range above; arrows show the conversion between steps."],
        ["Rearrange", "Drag a step to move it. Drag the background to pan; use − and + or pinch to zoom."],
        ["Draw an arrow", "Drag the dot on a step's right edge onto another step, or use Connect to… in the step's panel."],
        ["Add your own", "+ Add step puts a new step in the middle of the view. Your steps and arrows can be deleted; built-ins can be renamed."],
        ["Shared", "Positions and edits are saved for everyone on the team."],
      ];
      for (const t of tips) { const s = section(t[0]); s.appendChild(el("p", "how", t[1])); b.appendChild(s); }
      panel.appendChild(b);
    }

    function showNode(id) {
      const n = nodeById(id);
      if (!n) { closePanel(); return; }
      panel.hidden = false;
      panel.innerHTML = "";
      const h = el("div", "fm-panel-head");
      const kind = el("div", "fm-node-kind", KIND_LABEL[n.kind] + (n.builtin ? "" : " · your step"));
      h.appendChild(kind);
      h.appendChild(el("div", "drawer-name", n.title));
      if (n.sub) h.appendChild(el("p", "card-sub", n.sub));
      panelHead(h);
      panel.appendChild(h);
      const b = el("div", "fm-panel-body");
      const s = statOf(n);
      const t = statText(s);
      if (t != null) {
        const box = el("div");
        box.appendChild(el("div", "fm-stat-big", t));
        box.appendChild(el("div", "faint small", s.l + " in the selected period" + (s.extra ? " · " + api.fmt.money(s.extra) + " revenue" : "")));
        b.appendChild(box);
      }
      if (n.how) b.appendChild(section("How it works", el("p", "how", n.how)));
      if (n.note) b.appendChild(section("Notes", el("p", "how", n.note)));
      const edges = allEdges();
      const linkList = (list, dir) => {
        const box = el("div", "fm-links");
        for (const e of list) {
          const other = nodeById(dir === "in" ? e.from : e.to);
          if (!other) continue;
          const row = el("button", "fm-link");
          row.type = "button";
          const left = el("span", null, (dir === "in" ? "← " : "→ ") + other.title);
          row.appendChild(left);
          const lab = edgeLabel(e);
          if (lab) row.appendChild(el("span", "faint", lab));
          row.addEventListener("click", () => { select(other.id); centerOn(other.id); });
          box.appendChild(row);
          if (!e.builtin) {
            const del = el("button", "link-btn small", "Delete this arrow");
            del.type = "button";
            del.addEventListener("click", () => {
              st.custom.edges = st.custom.edges.filter((x) => x.id !== e.id);
              drawEdges(); saveCustomSoon(true); showNode(id);
            });
            box.appendChild(del);
          }
        }
        if (!box.childNodes.length) box.appendChild(el("p", "faint small", "Nothing yet."));
        return box;
      };
      b.appendChild(section("Comes from", linkList(edges.filter((e) => e.to === id), "in")));
      b.appendChild(section("Leads to", linkList(edges.filter((e) => e.from === id), "out")));

      const actions = el("div", "stack");
      if (n.tab) {
        const go = el("button", "btn btn-primary", "Open in Funnel HQ → " + (TAB_LABEL[n.tab] || n.tab));
        go.type = "button";
        go.addEventListener("click", () => api.openTab(n.tab));
        actions.appendChild(go);
      }
      const row = el("div", "row wrap");
      const connect = el("button", "btn btn-sm", "Connect to…");
      connect.type = "button";
      connect.addEventListener("click", () => showConnect(n));
      const edit = el("button", "btn btn-sm", n.builtin ? "Edit text" : "Edit step");
      edit.type = "button";
      edit.addEventListener("click", () => showEdit(n));
      row.append(connect, edit);
      if (!n.builtin) {
        const del = el("button", "btn btn-sm btn-danger", "Delete step");
        del.type = "button";
        del.addEventListener("click", () => {
          if (!confirm("Delete this step and its arrows? This changes the map for everyone.")) return;
          st.custom.nodes = st.custom.nodes.filter((x) => x.id !== n.id);
          st.custom.edges = st.custom.edges.filter((x) => x.from !== n.id && x.to !== n.id);
          st.sel = null;
          render(); saveCustomSoon(true); closePanel();
        });
        row.appendChild(del);
      }
      actions.appendChild(row);
      b.appendChild(actions);
      panel.appendChild(b);
    }

    function input(label, value, max, multiline) {
      const f = el("label", "field");
      f.appendChild(el("span", "field-label", label));
      const i = multiline ? el("textarea", "textarea") : el("input", "input");
      i.value = value || "";
      i.maxLength = max;
      f.appendChild(i);
      return { f, i };
    }
    function select_(label, options, value) {
      const f = el("label", "field");
      f.appendChild(el("span", "field-label", label));
      const s = el("select", "select");
      for (const [v, l] of options) { const o = el("option", null, l); o.value = v; if (v === value) o.selected = true; s.appendChild(o); }
      f.appendChild(s);
      return { f, i: s };
    }
    function formPanel(title, sub, fields, onSave, extra) {
      panel.hidden = false;
      panel.innerHTML = "";
      const h = el("div", "fm-panel-head");
      h.appendChild(el("div", "card-title", title));
      if (sub) h.appendChild(el("p", "card-sub", sub));
      panel.appendChild(h);
      const form = el("form", "fm-panel-body");
      for (const x of fields) form.appendChild(x.f);
      const row = el("div", "row");
      const cancel = el("button", "btn", "Cancel");
      cancel.type = "button";
      cancel.addEventListener("click", () => (st.sel ? showNode(st.sel) : closePanel()));
      const save = el("button", "btn btn-primary", "Save");
      save.type = "submit";
      row.append(cancel, save);
      if (extra) { const sp = el("span", "spacer"); row.append(sp, extra); }
      form.appendChild(row);
      form.addEventListener("submit", (ev) => { ev.preventDefault(); onSave(); });
      panel.appendChild(form);
      const first = form.querySelector("input, select, textarea");
      if (first) first.focus();
    }

    function showAddForm() {
      if (st.custom.nodes.length >= 200) { api.toast("That is the most steps the map can hold.", "err"); return; }
      const t = input("Title", "", 60), s = input("Subtitle", "", 90);
      const k = select_("Kind", KINDS.map((x) => [x, KIND_LABEL[x]]), "page");
      const tab = select_("Opens tab", TABS, "");
      const note = input("Notes", "", 2000, true);
      formPanel("Add a step", "It appears in the middle of the view. Drag it into place.", [t, s, k, tab, note], () => {
        const title = t.i.value.trim();
        if (!title) { api.toast("Give the step a title.", "err"); t.i.focus(); return; }
        const r = stage.getBoundingClientRect();
        const c = toWorld(r.left + r.width / 2, r.top + r.height / 2);
        const node = { id: uid(), kind: k.i.value, title, sub: s.i.value.trim(), note: note.i.value, tab: tab.i.value, x: snap(c.x - W / 2), y: snap(c.y - 36) };
        st.custom.nodes.push(node);
        st.sel = node.id;
        render();
        saveCustomSoon(true);
        showNode(node.id);
      });
    }

    function showEdit(n) {
      const base = BUILTIN.get(n.id);
      const t = input("Title", n.title, 60), s = input("Subtitle", n.sub, 90), note = input("Notes", n.note, 2000, true);
      const fields = [t, s];
      let k = null, tab = null;
      if (!n.builtin) { k = select_("Kind", KINDS.map((x) => [x, KIND_LABEL[x]]), n.kind); tab = select_("Opens tab", TABS, n.tab || ""); fields.push(k, tab); }
      fields.push(note);
      let reset = null;
      if (n.builtin && st.custom.edits[n.id]) {
        reset = el("button", "link-btn small", "Reset to default");
        reset.type = "button";
        reset.addEventListener("click", () => { delete st.custom.edits[n.id]; render(); saveCustomSoon(true); select(n.id); });
      }
      formPanel(n.builtin ? "Edit " + base.title : "Edit step", n.builtin ? "Built-in steps can be renamed and annotated, not deleted." : null, fields, () => {
        const title = t.i.value.trim();
        if (!title && !n.builtin) { api.toast("Give the step a title.", "err"); return; }
        if (n.builtin) {
          const e = {};
          if (title && title !== base.title) e.title = title;
          if (s.i.value.trim() !== base.sub) e.sub = s.i.value.trim();
          if (note.i.value.trim()) e.note = note.i.value;
          if (Object.keys(e).length) st.custom.edits[n.id] = e; else delete st.custom.edits[n.id];
        } else {
          const c = st.custom.nodes.find((x) => x.id === n.id);
          Object.assign(c, { title, sub: s.i.value.trim(), note: note.i.value, kind: k.i.value, tab: tab.i.value });
        }
        render();
        saveCustomSoon(true);
        select(n.id);
      }, reset);
    }

    function showConnect(n) {
      const others = allNodes().filter((x) => x.id !== n.id).sort((a, b) => a.title.localeCompare(b.title));
      const to = select_("To", others.map((x) => [x.id, x.title]), others[0] ? others[0].id : "");
      const label = input("Label (optional)", "", 30);
      formPanel("Connect " + n.title, "Draws an arrow from this step.", [to, label], () => { addEdge(n.id, to.i.value, label.i.value.trim()); select(n.id); });
    }

    // ── Load ───────────────────────────────────────────────────────────────
    async function load() {
      try {
        const [m, s] = await Promise.all([api.get("/map"), api.stats().catch(() => ({ counts: {}, rates: {} }))]);
        st.layout = m.layout || {};
        st.custom = m.custom || { nodes: [], edges: [], edits: {} };
        st.counts = s.counts || {};
        st.rates = s.rates || {};
      } catch (e) {
        api.fail(e);
      }
      render();
      if (st.sel && !nodeById(st.sel)) st.sel = null;
      if (st.sel) showNode(st.sel);
    }
    load().then(() => start());
  }

  window.FunnelMap = { mount, NODES, EDGES };
})();
