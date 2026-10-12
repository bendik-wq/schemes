/* Operator first-party tracker. Browser-only signals; the server already logged the page view.
   Never records what anyone types. Each feature lives in its own IIFE so names never collide. */
(function () {
  "use strict";
  var d = document, w = window;
  var cfg = {};
  try { cfg = JSON.parse((d.getElementById("op-cfg") || {}).textContent || "{}") || {}; } catch (e) { cfg = {}; }
  w.OPCFG = cfg;

  var queue = [], sentCount = 0, MAX_EVENTS = 150, ctxSent = false;
  var path = location.pathname;

  function track(name, props) {
    if (sentCount >= MAX_EVENTS) return;
    sentCount++;
    queue.push({ n: name, p: props || {}, path: path });
    if (queue.length >= 20) flush();
  }

  function flush(useBeacon) {
    if (!queue.length && ctxSent) return;
    var body = { events: queue.splice(0, 25) };
    if (!ctxSent) {
      ctxSent = true;
      var c = navigator.connection || {};
      body.ctx = {
        tz: (Intl.DateTimeFormat().resolvedOptions() || {}).timeZone || "",
        screen: screen.width + "x" + screen.height,
        viewport: innerWidth + "x" + innerHeight,
        dpr: w.devicePixelRatio || 1,
        conn: c.effectiveType || ""
      };
    }
    var json = JSON.stringify(body);
    if (useBeacon && navigator.sendBeacon) {
      navigator.sendBeacon("/api/e", new Blob([json], { type: "application/json" }));
    } else {
      fetch("/api/e", { method: "POST", headers: { "content-type": "application/json" }, body: json, keepalive: true, credentials: "same-origin" }).catch(function () {});
    }
  }

  w.OP = { track: track, flush: flush, cfg: cfg };
  setInterval(function () { if (queue.length) flush(); }, 5000);
  setTimeout(function () { flush(); }, 1500);

  // Which section is on screen.
  var current = null;
  function sectionOf(el) {
    while (el && el !== d.body) {
      if (el.getAttribute && el.getAttribute("data-section")) return el.getAttribute("data-section");
      if (el.tagName === "SECTION" && el.id) return el.id;
      el = el.parentNode;
    }
    return null;
  }

  // Engaged time: visible and active within the last 30 s.
  (function () {
    var engaged = 0, last = Date.now(), lastActive = Date.now();
    function tick() {
      var now = Date.now();
      if (d.visibilityState === "visible" && now - lastActive < 30000) engaged += now - last;
      last = now;
    }
    ["mousemove", "keydown", "scroll", "touchstart", "click"].forEach(function (ev) {
      w.addEventListener(ev, function () { lastActive = Date.now(); }, { passive: true });
    });
    setInterval(tick, 1000);
    w.addEventListener("pagehide", function () { tick(); track("engaged", { ms: engaged }); });
  })();

  // Scroll depth milestones.
  (function () {
    var marks = [25, 50, 75, 100], hit = {}, max = 0, raf = 0;
    function measure() {
      raf = 0;
      var h = d.documentElement.scrollHeight - innerHeight;
      var pct = h <= 0 ? 100 : Math.round((scrollY / h) * 100);
      if (pct > max) max = pct;
      marks.forEach(function (m) { if (max >= m && !hit[m]) { hit[m] = 1; track("scroll", { pct: m }); } });
    }
    w.addEventListener("scroll", function () { if (!raf) raf = requestAnimationFrame(measure); }, { passive: true });
  })();

  // First interaction, clicks, rage clicks, CTA hover.
  (function () {
    var first = false, recent = [];
    function describe(el) {
      var t = el.closest ? el.closest("a,button,summary,[data-track],.opt") : null;
      if (!t) return null;
      // Never the text of application options or anything marked private.
      var priv = t.classList.contains("opt") || !!t.closest("[data-private], form");
      var label = priv ? "" : (t.getAttribute("data-track") || t.getAttribute("aria-label") || t.textContent || "").replace(/\s+/g, " ").trim().slice(0, 40);
      return { tag: t.tagName.toLowerCase(), label: label, href: t.tagName === "A" ? (t.getAttribute("href") || "").slice(0, 80) : "", apply: t.hasAttribute("data-apply") ? 1 : 0 };
    }
    d.addEventListener("click", function (e) {
      if (!first) { first = true; track("first_interaction", { kind: "click" }); }
      if (e.target.closest && e.target.closest("input,textarea,select")) return;
      var info = describe(e.target);
      if (info) {
        info.section = sectionOf(e.target) || "";
        track(info.apply ? "cta_click" : "click", info);
      }
      var now = Date.now();
      recent = recent.filter(function (r) { return now - r.t < 700 && Math.abs(r.x - e.clientX) < 30 && Math.abs(r.y - e.clientY) < 30; });
      recent.push({ t: now, x: e.clientX, y: e.clientY });
      if (recent.length >= 3) { track("rage_click", { section: sectionOf(e.target) || "" }); recent = []; }
    }, true);
    var hoverStart = 0;
    d.addEventListener("mouseover", function (e) {
      if (e.target.closest && e.target.closest("[data-apply]")) hoverStart = hoverStart || Date.now();
    });
    d.addEventListener("mouseout", function (e) {
      if (hoverStart && e.target.closest && e.target.closest("[data-apply]")) {
        var ms = Date.now() - hoverStart; hoverStart = 0;
        if (ms > 400) track("cta_hover", { ms: ms });
      }
    });
  })();

  // Form fields: focus, time, corrections, paste, left empty. Never the value.
  (function () {
    var state = {};
    function key(el) { return (el.name || el.id || el.type || "field").slice(0, 30); }
    d.addEventListener("focusin", function (e) {
      var el = e.target;
      if (!el.matches || !el.matches("input,textarea,select")) return;
      if (el.type === "checkbox" || el.type === "radio") return;
      state[key(el)] = { t: Date.now(), corr: 0, paste: 0 };
    });
    d.addEventListener("keydown", function (e) {
      var el = e.target;
      if (!el.matches || !el.matches("input,textarea")) return;
      var s = state[key(el)];
      if (s && (e.key === "Backspace" || e.key === "Delete")) s.corr++;
    });
    d.addEventListener("paste", function (e) {
      var el = e.target;
      if (el.matches && el.matches("input,textarea")) { var s = state[key(el)]; if (s) s.paste++; }
    }, true);
    d.addEventListener("focusout", function (e) {
      var el = e.target;
      if (!el.matches || !el.matches("input,textarea,select")) return;
      var k = key(el), s = state[k];
      if (!s) return;
      delete state[k];
      track("field_interaction", { field: k, ms: Date.now() - s.t, corrections: s.corr, paste: s.paste, empty: el.value ? 0 : 1 });
    });
  })();

  // Tab return, exit intent.
  (function () {
    var hiddenAt = 0, exitSent = false;
    d.addEventListener("visibilitychange", function () {
      if (d.visibilityState === "hidden") { hiddenAt = Date.now(); flush(true); }
      else if (hiddenAt) { track("tab_return", { away_ms: Date.now() - hiddenAt }); hiddenAt = 0; }
    });
    d.addEventListener("mouseout", function (e) {
      if (!exitSent && !e.relatedTarget && e.clientY <= 0) { exitSent = true; track("exit_intent", { section: current || "" }); }
    });
  })();

  // Section dwell and re-visits.
  (function () {
    if (!("IntersectionObserver" in w)) return;
    var seen = {}, since = {};
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (en) {
        var s = sectionOf(en.target);
        if (!s) return;
        if (en.isIntersecting) {
          since[s] = Date.now();
          current = s;
          if (seen[s]) track("section_revisit", { section: s, n: seen[s] });
        } else if (since[s]) {
          var ms = Date.now() - since[s];
          since[s] = 0;
          if (ms > 1500) { seen[s] = (seen[s] || 0) + 1; track("section_dwell", { section: s, ms: ms }); }
        }
      });
    }, { threshold: 0.45 });
    function observe() { d.querySelectorAll("[data-section], section[id]").forEach(function (el) { io.observe(el); }); }
    observe();
    w.addEventListener("pagehide", function () {
      Object.keys(since).forEach(function (s) { if (since[s]) { var ms = Date.now() - since[s]; if (ms > 1500) track("section_dwell", { section: s, ms: ms }); } });
      track("page_exit", { section: current || "" });
      flush(true);
    });
  })();

  // Sticky mobile CTA appears once the main CTA has scrolled away.
  (function () {
    var cta = d.querySelector(".cta-block");
    if (!cta || !("IntersectionObserver" in w)) return;
    new IntersectionObserver(function (en) {
      var e = en[0];
      d.body.classList.toggle("cta-out", !e.isIntersecting && e.boundingClientRect.top < 0);
    }).observe(cta);
  })();

  // FAQ opens (the server only trusts ids that exist).
  d.addEventListener("toggle", function (e) {
    var el = e.target;
    if (el.tagName === "DETAILS" && el.open && el.getAttribute("data-faq")) track("faq_open", { id: el.getAttribute("data-faq") });
  }, true);

  // Selected / copied text: never inside form fields or anything that looks personal.
  (function () {
    var PII = /@|\+?\d[\d\s().-]{6,}\d|https?:|www\./i, timer = 0, lastText = "";
    function inField(node) {
      var el = node && (node.nodeType === 1 ? node : node.parentElement);
      return !!(el && el.closest && el.closest("input,textarea,select,[contenteditable],[data-private],form"));
    }
    function grab() {
      var sel = w.getSelection && w.getSelection();
      if (!sel || sel.isCollapsed || !sel.rangeCount) return null;
      if (inField(sel.anchorNode) || inField(sel.focusNode)) return null;
      var a = d.activeElement;
      if (a && a.matches && a.matches("input,textarea")) return null;
      var t = String(sel).replace(/\s+/g, " ").trim();
      if (t.length < 3 || PII.test(t)) return null;
      return { text: t.slice(0, 120), section: sectionOf(sel.anchorNode && sel.anchorNode.parentElement) || "" };
    }
    d.addEventListener("selectionchange", function () {
      clearTimeout(timer);
      timer = setTimeout(function () {
        var g = grab();
        if (g && g.text !== lastText) { lastText = g.text; track("text_select", g); }
      }, 900);
    });
    d.addEventListener("copy", function () { var g = grab(); if (g) track("text_copy", g); });
  })();

  // Consent banner, Meta Pixel and optional session replay (only with consent where required).
  (function () {
    var KEY = "_fc";
    function readConsent() {
      var m = d.cookie.match(/(?:^|; )_fc=([01])/);
      return m ? (m[1] === "1" ? "granted" : "denied") : (cfg.consent || "unknown");
    }
    function allowed() { var c = readConsent(); return c !== "denied" && (!cfg.consentRequired || c === "granted"); }
    var loaded = false;
    function loadThirdParty() {
      if (loaded || !allowed()) return;
      loaded = true;
      if (cfg.pixel) {
        /* Meta Pixel; event id dedupes with the server-side PageView. */
        var f = w.fbq = function () { f.callMethod ? f.callMethod.apply(f, arguments) : f.queue.push(arguments); };
        if (!w._fbq) w._fbq = f;
        f.push = f; f.loaded = true; f.version = "2.0"; f.queue = [];
        var s = d.createElement("script"); s.async = true; s.src = "https://connect.facebook.net/en_US/fbevents.js";
        d.head.appendChild(s);
        w.fbq("init", String(cfg.pixel));
        w.fbq("track", "PageView", {}, cfg.pv ? { eventID: cfg.pv } : undefined);
      }
      if (cfg.replay && cfg.replay.key && readConsent() === "granted") {
        var p = d.createElement("script"); p.async = true; p.src = "/ph/static/array.js";
        p.onload = function () {
          if (!w.posthog || !w.posthog.init) return;
          w.posthog.init(cfg.replay.key, { api_host: "/ph", ui_host: "https://eu.posthog.com", autocapture: false, capture_pageview: false, disable_session_recording: false,
            persistence: "memory", session_recording: { maskAllInputs: true, maskTextSelector: "[data-private]" } });
        };
        d.head.appendChild(p);
      }
    }
    function clearAdCookies() {
      var parts = location.hostname.split("."), domains = [""];
      for (var i = parts.length - 2; i >= 0; i--) domains.push("; domain=." + parts.slice(i).join("."));
      ["_fbp", "_fbc"].forEach(function (n) { domains.forEach(function (dm) { d.cookie = n + "=; Max-Age=0; path=/" + dm; }); });
    }
    function send(v) {
      var wasLoaded = loaded;
      if (v === "denied") {
        try { if (w.fbq) w.fbq("consent", "revoke"); } catch (e) {}
        try { if (w.posthog && w.posthog.opt_out_capturing) w.posthog.opt_out_capturing(); } catch (e) {}
        clearAdCookies();
      }
      fetch("/api/consent", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ consent: v }), credentials: "same-origin" })
        .catch(function () {})
        .then(function () {
          cfg.consent = v;
          if (v === "granted") loadThirdParty();
          else if (wasLoaded) location.reload(); // unload anything already running
        });
    }
    var banner = null;
    function show() {
      if (banner) { banner.hidden = false; return; }
      banner = d.createElement("div");
      banner.className = "consent";
      banner.setAttribute("role", "dialog");
      banner.setAttribute("aria-label", "Cookie choices");
      var p = d.createElement("p");
      p.appendChild(d.createTextNode("We use our own cookies to run this site and to understand how it is used. With your permission we also remember your visit across days and use advertising cookies to measure our ads. "));
      var a = d.createElement("a"); a.href = "/privacy"; a.textContent = "Privacy policy"; p.appendChild(a);
      var row = d.createElement("div"); row.className = "row";
      var no = d.createElement("button"); no.type = "button"; no.className = "btn ghost"; no.textContent = "Decline";
      var yes = d.createElement("button"); yes.type = "button"; yes.className = "btn"; yes.textContent = "Accept";
      no.onclick = function () { banner.hidden = true; send("denied"); };
      yes.onclick = function () { banner.hidden = true; send("granted"); };
      row.appendChild(no); row.appendChild(yes);
      banner.appendChild(p); banner.appendChild(row);
      d.body.appendChild(banner);
    }
    function boot() {
      if (cfg.consentRequired && readConsent() === "unknown") show();
      else loadThirdParty();
      d.querySelectorAll("[data-cookie-settings]").forEach(function (b) { b.addEventListener("click", show); });
    }
    if (d.readyState === "loading") d.addEventListener("DOMContentLoaded", boot); else boot();
  })();
})();
