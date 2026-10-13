/* Application: one question per screen, contact first, keyboard shortcuts inside the form, every answer
   saved server-side as you go, an "analysing" step, then open times (A tier) or the route for your tier.
   Never sends what someone types before they submit it; contact fields wait in sessionStorage only. */
(function () {
  "use strict";
  var d = document, w = window;

  function el(tag, attrs, kids) {
    var n = d.createElement(tag);
    if (attrs) Object.keys(attrs).forEach(function (k) {
      if (k === "text") n.textContent = attrs[k];
      else if (k === "class") n.className = attrs[k];
      else if (k.slice(0, 2) === "on") n.addEventListener(k.slice(2), attrs[k]);
      else if (attrs[k] !== null && attrs[k] !== undefined && attrs[k] !== false) n.setAttribute(k, attrs[k] === true ? "" : attrs[k]);
    });
    (kids || []).forEach(function (k) { if (k) n.appendChild(typeof k === "string" ? d.createTextNode(k) : k); });
    return n;
  }
  function post(url, body) {
    return fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body || {}), credentials: "same-origin" })
      .then(function (r) { return r.json().catch(function () { return {}; }).then(function (j) { j._status = r.status; return j; }); });
  }
  function track(n, p) { if (w.OP) w.OP.track(n, p); }
  function store(k, v) { try { if (v == null) w.sessionStorage.removeItem(k); else w.sessionStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* private mode */ } }
  function load(k) { try { return JSON.parse(w.sessionStorage.getItem(k) || "null"); } catch (e) { return null; } }

  // ── phone: the same rule as src/lib/phone.ts (8–15 digits after the +) ──
  // [ISO, dial code]: keep in step with DIAL in src/lib/phone.ts.
  var DIAL = [["AE", "971"], ["AT", "43"], ["AU", "61"], ["BE", "32"], ["BR", "55"], ["CA", "1"], ["CH", "41"], ["CZ", "420"], ["DE", "49"], ["DK", "45"],
    ["EE", "372"], ["ES", "34"], ["FI", "358"], ["FR", "33"], ["GB", "44"], ["GR", "30"], ["HK", "852"], ["IE", "353"], ["IN", "91"], ["IS", "354"],
    ["IT", "39"], ["JP", "81"], ["LT", "370"], ["LU", "352"], ["LV", "371"], ["MX", "52"], ["NL", "31"], ["NO", "47"], ["NZ", "64"], ["PL", "48"],
    ["PT", "351"], ["SE", "46"], ["SG", "65"], ["US", "1"], ["ZA", "27"]];
  var DIALMAP = {}; DIAL.forEach(function (x) { DIALMAP[x[0]] = x[1]; });
  var PHONE_MIN = 8, PHONE_MAX = 15;
  function normPhone(raw, iso) {
    var s = String(raw || "").trim();
    if (!s) return null;
    if (/[a-z]/i.test(s.replace(/ext\.?\s*\d+$/i, ""))) return null;
    s = s.replace(/ext\.?\s*\d+$/i, "");
    var digits = s.replace(/[^\d+]/g, "");
    if (digits.indexOf("00") === 0) digits = "+" + digits.slice(2);
    if (digits.charAt(0) !== "+") {
      var cc = DIALMAP[iso];
      if (!cc) return null;
      var nat = digits.replace(/\D/g, "");
      if (cc === "1" && nat.length === 11 && nat.charAt(0) === "1") nat = nat.slice(1);
      else if (nat.charAt(0) === "0" && cc !== "39") nat = nat.slice(1);
      digits = "+" + cc + nat;
    }
    var dd = digits.slice(1).replace(/\D/g, "");
    if (dd.length < PHONE_MIN || dd.length > PHONE_MAX || dd.charAt(0) === "0") return null;
    return "+" + dd;
  }
  // The country whose dial code starts a "+…"/"00…" number (the codes above are prefix-free).
  function prefixCountry(v, current) {
    var m = String(v || "").replace(/[^\d+]/g, "").replace(/^00/, "+");
    if (m.charAt(0) !== "+") return null;
    var dd = m.slice(1);
    if (DIALMAP[current] && dd.indexOf(DIALMAP[current]) === 0) return current;
    for (var i = 0; i < DIAL.length; i++) if (dd.indexOf(DIAL[i][1]) === 0 && (DIAL[i][1] !== "1" || DIAL[i][0] === "US")) return DIAL[i][0];
    return null;
  }
  function groupDigits(n) {
    if (n.length <= 4) return n;
    if (n.length === 7) return n.slice(0, 3) + " " + n.slice(3);
    if (n.length === 8) return n.slice(0, 3) + " " + n.slice(3, 5) + " " + n.slice(5);
    if (n.length === 10) return n.slice(0, 3) + " " + n.slice(3, 6) + " " + n.slice(6);
    return n.replace(/(\d{3})(?=\d{2,})/g, "$1 ");
  }
  function prettyE164(e) {
    var dd = e.slice(1), best = "";
    DIAL.forEach(function (x) { if (dd.indexOf(x[1]) === 0 && x[1].length > best.length) best = x[1]; });
    return "+" + best + " " + groupDigits(dd.slice(best.length));
  }

  // ── company website: the same rule as cleanWebsite() in src/funnel/application.ts ──
  function cleanUrl(raw) {
    var s = String(raw || "").trim();
    if (!s) return "";
    if (/\s/.test(s) || s.length > 200) return null;
    var u;
    try { u = new URL(/^[a-z][a-z0-9+.-]*:/i.test(s) ? s : "https://" + s); } catch (e) { return null; }
    if ((u.protocol !== "https:" && u.protocol !== "http:") || u.username || u.password || u.port) return null;
    var host = u.hostname.toLowerCase();
    if (!/^([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,24}$/.test(host)) return null;
    return "https://" + host + (u.pathname === "/" ? "" : u.pathname.replace(/\/+$/, ""));
  }

  // ── email typos: suggest, never correct ──
  var MAIL_DOMAINS = ["gmail.com", "googlemail.com", "outlook.com", "hotmail.com", "live.com", "icloud.com", "yahoo.com", "proton.me", "protonmail.com", "online.no"];
  var TLD_FIX = { con: "com", cmo: "com", ocm: "com", vom: "com", xom: "com", comm: "com", coom: "com", cm: "com", om: "com", nte: "net", nett: "net", ner: "net", ogr: "org", orgg: "org", nno: "no", noo: "no", couk: "co.uk" };
  function dl(a, b) { // Damerau-Levenshtein (optimal string alignment)
    var i, j, m = a.length, n = b.length, D = [];
    for (i = 0; i <= m; i++) { D[i] = [i]; }
    for (j = 0; j <= n; j++) D[0][j] = j;
    for (i = 1; i <= m; i++) for (j = 1; j <= n; j++) {
      var c = a.charAt(i - 1) === b.charAt(j - 1) ? 0 : 1;
      D[i][j] = Math.min(D[i - 1][j] + 1, D[i][j - 1] + 1, D[i - 1][j - 1] + c);
      if (i > 1 && j > 1 && a.charAt(i - 1) === b.charAt(j - 2) && a.charAt(i - 2) === b.charAt(j - 1)) D[i][j] = Math.min(D[i][j], D[i - 2][j - 2] + 1);
    }
    return D[m][n];
  }
  function suggestEmail(v) {
    var at = v.lastIndexOf("@");
    if (at < 1) return null;
    var local = v.slice(0, at), dom = v.slice(at + 1).toLowerCase();
    if (!dom || MAIL_DOMAINS.indexOf(dom) >= 0) return null;
    var best = null, bestD = 99;
    MAIL_DOMAINS.forEach(function (m) { var x = dl(dom, m); if (x < bestD) { bestD = x; best = m; } });
    if (best && bestD > 0 && bestD <= (dom.length >= 10 ? 2 : 1)) return local + "@" + best;
    var dot = dom.lastIndexOf(".");
    var tld = dot > 0 ? dom.slice(dot + 1) : "";
    if (tld && TLD_FIX[tld]) return local + "@" + dom.slice(0, dot + 1) + TLD_FIX[tld];
    return null;
  }

  function boot() {
    var cfg = w.OPCFG || {};
    var all = cfg.questions || [];
    // After-submit questions (optional, multi) are asked under the result, never in the scored flow.
    // Inline questions (inlineWith) are extra fields on another question's screen, never a step of their own.
    function isPost(q) { return !!q.afterSubmit || (q.optional && q.type === "multi"); }
    function companion(q) { for (var i = 0; i < all.length; i++) if (all[i].inlineWith === q.id) return all[i]; return null; }
    var qs = all.filter(function (q) { return !isPost(q) && !q.inlineWith; });
    var postQs = all.filter(function (q) { return isPost(q) && !q.inlineWith; });
    var root = d.querySelector(".steps");
    var bar = d.querySelector(".progress i");
    // The inline bar reveals one full-width gradient (so its colour tracks progress); the width is the fallback.
    function setBar(pct) { if (!bar) return; bar.style.width = pct + "%"; bar.style.setProperty("--p", pct + "%"); }
    if (!root || !qs.length) return;
    var form = root.closest("form");
    // One small status region instead of a live .steps container (which re-read every step).
    root.removeAttribute("aria-live");
    var live = el("div", { class: "sr-only", role: "status" });
    form.appendChild(live);
    function say(t) { live.textContent = ""; setTimeout(function () { live.textContent = t; }, 40); }

    var lead = cfg.lead;
    var answers = (lead && lead.answers) || {};
    var keys = "ABCDEFGH";
    var idx = 0, busy = false, dir = 1, submitted = false;
    // Embedded under the film on the landing page: never steal focus or scroll on load.
    var embedded = !!cfg.embedded, firstRender = true;
    var titleTag = embedded ? "h2" : "h1";
    var touch = w.matchMedia && w.matchMedia("(hover: none)").matches;
    function focusSoon(node) { if (!node || (embedded && firstRender)) return; setTimeout(function () { node.focus({ preventScroll: embedded }); }, 60); }
    function toTop() {
      if (!embedded) { w.scrollTo({ top: 0, behavior: "smooth" }); return; }
      var sec = d.getElementById("apply");
      if (sec && sec.getBoundingClientRect().top < 0) sec.scrollIntoView({ behavior: "smooth", block: "start" });
    }
    function stepOf(q) { return all.indexOf(q) + 1; } // = APPLICATION index + 1, as the server counts

    // Resume at the first unanswered question for a returning applicant.
    if (lead) {
      idx = 1;
      for (var i = 1; i < qs.length; i++) {
        var a = answers[qs[i].id];
        var has = Array.isArray(a) ? a.length > 0 : a != null && String(a).trim() !== "";
        if (!has && !qs[i].optional) { idx = i; break; }
        idx = Math.min(i + 1, qs.length - 1);
      }
      // Reopened to update the answers (requalify): walk through them from the first question.
      if (lead.restart) idx = 1;
    }

    // ── analytics: time on step, hesitation, answer changes, abandonment (never values) ──
    var st = null;
    function stepStart(q) {
      st = { step: stepOf(q), id: q.id, t0: Date.now(), first: 0, changes: 0 };
      track("app_step_view", { step: st.step, id: q.id });
    }
    function touched() { if (st && !st.first) st.first = Date.now(); }
    function changed() { touched(); if (st) st.changes++; }
    function stepEnd(how) {
      if (!st) return;
      track("app_step_done", { step: st.step, id: st.id, ms: Date.now() - st.t0, ms_first: st.first ? st.first - st.t0 : null, changes: st.changes, abandoned: how === "abandoned" ? 1 : 0, back: how === "back" ? 1 : 0 });
      st = null;
    }
    function trackErr(field, code) { track("app_error", { step: st ? st.step : idx + 1, field: field, code: code }); }
    w.addEventListener("pagehide", function () {
      flushDraft(true);
      if (st && !submitted) { stepEnd("abandoned"); if (w.OP && w.OP.flush) w.OP.flush(true); }
    });

    // Embedded starts count once the form is half visible.
    if ("IntersectionObserver" in w) {
      var io = new IntersectionObserver(function (es) {
        es.forEach(function (e) { if (e.isIntersecting) { track("app_view", { embedded: embedded ? 1 : 0 }); io.disconnect(); } });
      }, { threshold: 0.5 });
      io.observe(form);
    }

    // ── browser Back = previous step ──
    var pushed = 0;
    function histSet(push) {
      if (!w.history || !history.replaceState) return;
      var s = {}; try { s = Object.assign({}, history.state || {}); } catch (e) { s = {}; }
      s.opStep = idx;
      try { if (push) { history.pushState(s, ""); pushed++; } else history.replaceState(s, ""); } catch (e) { /* ignore */ }
    }
    w.addEventListener("popstate", function (e) {
      if (submitted) return;
      var to = e.state && typeof e.state.opStep === "number" ? e.state.opStep : null;
      if (to === null || to === idx) return;
      pushed = Math.max(0, pushed - 1);
      if (to < idx) track("app_back", { step: idx + 1, id: qs[idx].id });
      stepEnd(to < idx ? "back" : "next");
      dir = to < idx ? -1 : 1;
      idx = Math.max(0, Math.min(qs.length - 1, to));
      render();
      toTop();
    });

    function progress() { setBar(Math.round(((idx + 1) / qs.length) * 100)); }

    // Heading gets focus on every step change after the first; the hidden prefix says where you are.
    function heading(text, prefix) {
      return el(titleTag, { id: "q-title", class: "q-title", tabindex: "-1" }, [prefix ? el("span", { class: "sr-only", text: prefix + " " }) : null, text]);
    }
    function stepLabel() {
      if (idx === 0) return "Takes about 3 minutes";
      if (idx >= qs.length - 2) return "Nearly done · " + (idx + 1) + " of " + qs.length;
      return (idx + 1) + " of " + qs.length;
    }

    var phoneNote = null;
    function frame(q, body, foot, opts) {
      opts = opts || {};
      var n = el("span", { class: "step-n", "aria-hidden": "true", text: stepLabel() }); // a span: legends take phrasing content
      var h = heading(q.title, "Step " + (idx + 1) + " of " + qs.length + ".");
      var help = q.help ? el("p", { class: "help", id: "q-help", text: q.help }) : null;
      var kids;
      if (opts.fieldset) {
        // Native radios/checkboxes: the question is the fieldset's legend.
        var fs = el("fieldset", { class: "choice" }, [el("legend", {}, [n, h]), help, body]);
        if (help) fs.setAttribute("aria-describedby", "q-help");
        kids = [fs];
      } else kids = [n, h, help, body];
      if (phoneNote) { kids.push(el("div", { class: "notice" }, [phoneNote])); phoneNote = null; }
      if (foot) kids.push(foot);
      var s = el("div", { class: "step" + (dir < 0 ? " back" : "") }, kids);
      if (!opts.fieldset) { s.setAttribute("role", "group"); s.setAttribute("aria-labelledby", "q-title"); }
      root.innerHTML = "";
      root.appendChild(s);
      progress();
      stepStart(q);
      if (!firstRender) focusSoon(h);
      return s;
    }

    function footer(opts) {
      var left = idx > 0 ? el("button", { type: "button", class: "back", text: "‹ Back", onclick: function () { back(); } }) : el("span");
      var right = el("div", { class: "foot-right" }, [
        opts.hint ? el("span", { class: "hint", "aria-hidden": "true", text: opts.hint }) : null,
        opts.button || null
      ]);
      return el("div", { class: "step-foot" }, [left, right]);
    }

    function notice(text, err) { return el("div", { class: "notice" + (err ? " err" : ""), role: err ? "alert" : "status", text: text }); }

    function save(id, value, step) {
      answers[id] = value;
      var o = {}; o[id] = value;
      return post("/api/apply/answers", { answers: o, step: step || idx + 1 });
    }

    function back() {
      if (idx <= 0) return;
      if (pushed > 0) { history.back(); return; } // popstate renders the previous step
      track("app_back", { step: idx + 1, id: qs[idx].id });
      stepEnd("back");
      dir = -1;
      idx = Math.max(0, idx - 1);
      render();
      histSet(false);
      toTop();
    }

    function go(delta) {
      dir = delta;
      stepEnd(delta < 0 ? "back" : "next");
      idx = Math.max(0, Math.min(qs.length - 1, idx + delta));
      render();
      histSet(delta > 0);
      toTop();
    }

    // Letter / number shortcuts only while focus is inside the form, never in a text field (WCAG 2.1.4).
    form.addEventListener("keydown", function (e) {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      var t = e.target;
      if (t && t.matches && t.matches("textarea,select,input:not([type=radio]):not([type=checkbox])")) return;
      if (root._keys && /^[a-h1-8]$/i.test(e.key)) { e.preventDefault(); root._keys(e.key); }
    });

    // ── Turnstile: loaded on first focus in the form, rendered explicitly, token tracked ──
    var ts = { id: null, token: "", exp: 0, box: null, loading: false };
    function tsLoad() {
      if (!cfg.turnstile || ts.loading || w.turnstile) { tsRender(); return; }
      ts.loading = true;
      var s = d.createElement("script");
      s.src = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
      s.async = true;
      s.onload = tsRender;
      d.head.appendChild(s);
    }
    function tsRender() {
      if (!w.turnstile || !ts.box || !d.body.contains(ts.box) || ts.box.getAttribute("data-rendered")) return;
      ts.box.setAttribute("data-rendered", "1");
      try {
        ts.id = w.turnstile.render(ts.box, {
          sitekey: cfg.turnstile, size: "flexible", appearance: "interaction-only", "refresh-expired": "auto",
          callback: function (t) { ts.token = t; ts.exp = Date.now() + 290000; },
          "expired-callback": function () { ts.token = ""; },
          "error-callback": function () { ts.token = ""; }
        });
      } catch (e) { ts.id = null; }
    }
    function tsFresh() { return !!ts.token && Date.now() < ts.exp; }
    function tsReset() { ts.token = ""; if (w.turnstile && ts.id != null) { try { w.turnstile.reset(ts.id); } catch (e) { /* ignore */ } } }
    // Resolves when a fresh token is there, or after 8 s (the server then says what is wrong).
    function tsWait() {
      return new Promise(function (resolve) {
        if (!cfg.turnstile || tsFresh()) return resolve();
        tsLoad();
        // Only an expired token is reset; an empty one may be a check still running.
        if (ts.id != null && ts.token && !tsFresh()) tsReset();
        var t0 = Date.now();
        (function poll() { if (tsFresh() || Date.now() - t0 > 8000) resolve(); else setTimeout(poll, 200); })();
      });
    }
    form.addEventListener("focusin", function () { if (idx === 0 && !submitted) tsLoad(); });

    // ── contact ──
    var CKEY = "op_apply_contact";
    function renderContact(q) {
      var f = {};
      var saved = !lead ? (load(CKEY) || {}) : {};
      function field(name, label, type, auto, full, value, extra) {
        var attrs = { id: "f-" + name, name: auto, type: type, autocomplete: auto, value: value || "", "aria-describedby": "m-" + name };
        Object.keys(extra || {}).forEach(function (k) { attrs[k] = extra[k]; });
        var input = el("input", attrs);
        var msg = el("p", { class: "msg", id: "m-" + name });
        var wrap = el("div", { class: "field" + (full ? " full" : "") }, [el("label", { for: "f-" + name, text: label }), input, msg]);
        f[name] = { input: input, msg: msg, wrap: wrap, shown: false };
        return wrap;
      }
      var L = lead || {};
      var cc = DIALMAP[cfg.country] ? cfg.country : "US";
      if (saved.cc && DIALMAP[saved.cc]) cc = saved.cc;
      var grid = el("div", { class: "fields" }, [
        field("first_name", "First name", "text", "given-name", false, L.first || saved.first, { required: true, autocapitalize: "words", autocorrect: "off", spellcheck: "false", enterkeyhint: "next" }),
        field("last_name", "Last name (optional)", "text", "family-name", false, L.last || saved.last, { autocapitalize: "words", autocorrect: "off", spellcheck: "false", enterkeyhint: "next" }),
        field("email", "Work email", "email", "email", true, L.email || saved.email, { required: true, inputmode: "email", autocapitalize: "none", autocorrect: "off", spellcheck: "false", enterkeyhint: "next" }),
        field("phone", "Mobile", "tel", "tel", true, L.phone ? prettyE164(L.phone) : saved.phone, { required: true, inputmode: "tel", enterkeyhint: "done" })
      ]);
      // Country code picker in front of the number.
      var sel = el("select", { class: "cc", "aria-label": "Country code", name: "phone_country" }, DIAL.map(function (x) {
        return el("option", { value: x[0], text: x[0] + " +" + x[1] });
      }));
      sel.value = L.phone ? (prefixCountry(L.phone, cc) || cc) : cc;
      var phoneRow = el("div", { class: "phone-row" }, [sel, f.phone.input]);
      f.phone.wrap.insertBefore(phoneRow, f.phone.msg);
      f.phone.input.placeholder = sel.value === "NO" ? "912 34 567" : sel.value === "GB" ? "7700 900123" : "415 555 0123";
      var emailHint = el("p", { class: "hint-line", id: "h-email" });
      f.email.wrap.appendChild(emailHint);
      f.email.input.setAttribute("aria-describedby", "m-email h-email");

      var consent = el("input", { type: "checkbox", name: "call_consent", id: "f-consent" });
      // Consent is per number: it is only shown as given while the number is unchanged.
      if (L.callConsent) consent.checked = true;
      function samePhone() { return !!L.phone && normPhone(f.phone.input.value, sel.value) === L.phone; }
      var consentRow = el("label", { class: "check", for: "f-consent" }, [consent, el("span", { text: (cfg.callConsent && cfg.callConsent.label) || "" })]);
      // Text reminders: their own unticked box, only while SMS reminders are on. Per number, like the call consent.
      var sms = cfg.smsConsent ? el("input", { type: "checkbox", name: "sms_consent", id: "f-sms" }) : null;
      if (sms && L.smsConsent) sms.checked = true;
      var smsRow = sms ? el("label", { class: "check sms-check", for: "f-sms" }, [sms, el("span", { text: cfg.smsConsent.label })]) : null;
      if (w.turnstile && ts.id != null) { try { w.turnstile.remove(ts.id); } catch (e) { /* gone with its old step */ } }
      ts.box = cfg.turnstile ? el("div", { class: "ts-box" }) : null;
      ts.id = null; ts.token = "";
      var status = el("div");
      var btn = el("button", { class: "btn lg", type: "submit", text: "Continue" });
      var body = el("div", {}, [grid, consentRow, smsRow, ts.box, status]);
      frame(q, body, footer({ button: btn, hint: "Enter ↵" }));
      if (w.turnstile) tsRender();
      if (firstRender && !embedded) focusSoon(L.first ? f.email.input : f.first_name.input);

      // Contact fields wait in this tab only (sessionStorage) until the first submit.
      var saveT = 0;
      function keep() {
        if (lead) return;
        clearTimeout(saveT);
        saveT = setTimeout(function () { store(CKEY, { first: f.first_name.input.value, last: f.last_name.input.value, email: f.email.input.value, phone: f.phone.input.value, cc: sel.value }); }, 300);
      }

      function check(name) {
        var v = f[name].input.value.trim();
        if (name === "first_name") return v ? null : ["Please enter your first name.", "required"];
        if (name === "last_name") return null;
        if (name === "email") {
          if (!v) return ["Please enter your email address.", "required"];
          return /^[^\s@<>()[\]"]+@[^\s@<>()[\]"]+\.[a-z]{2,}$/i.test(v) ? null : ["Please enter an email like name@company.com.", "invalid"];
        }
        if (name === "phone") {
          if (!v) return ["Please enter your mobile number.", "required"];
          return normPhone(v, sel.value) ? null : ["That number looks incomplete. Include the full mobile number (8–15 digits with the country code).", "invalid"];
        }
        return null;
      }
      function show(name, err) {
        var x = f[name];
        x.wrap.classList.toggle("bad", !!err);
        x.msg.classList.remove("ok");
        if (err) { x.input.setAttribute("aria-invalid", "true"); x.msg.textContent = err[0]; x.shown = true; }
        else { x.input.removeAttribute("aria-invalid"); x.msg.textContent = ""; }
      }
      function phoneOk() {
        var e = normPhone(f.phone.input.value, sel.value);
        if (!e) return;
        f.phone.msg.classList.add("ok");
        f.phone.msg.textContent = (consent.checked ? "We'll call " : "Your number: ") + prettyE164(e);
      }
      Object.keys(f).forEach(function (name) {
        var input = f[name].input;
        // Validate on blur once there is a value; after an error has shown, again on every input.
        input.addEventListener("blur", function () {
          if (!input.value.trim()) return;
          var err = check(name);
          show(name, err);
          if (err) trackErr(name, err[1]);
          if (name === "phone" && !err) {
            var p = normPhone(input.value, sel.value);
            if (/^\s*(\+|00)/.test(input.value) && p) input.value = groupDigits(p.slice(1 + DIALMAP[sel.value].length));
            phoneOk();
          }
          if (name === "email" && !err) emailSuggest();
        });
        input.addEventListener("input", function () {
          touched();
          keep();
          if (f[name].shown) { var err = check(name); show(name, err); if (!err && name === "phone") phoneOk(); }
        });
        input.addEventListener("change", changed);
      });
      // Enter moves through the fields; Enter in the number submits.
      ["first_name", "last_name", "email"].forEach(function (name, i, arr) {
        f[name].input.addEventListener("keydown", function (e) {
          if (e.key !== "Enter" || e.isComposing) return;
          e.preventDefault();
          (f[arr[i + 1]] || f.phone).input.focus();
        });
      });

      // Phone: switch the country for a typed +/00 prefix; group digits only while typing at the end.
      f.phone.input.addEventListener("input", function (e) {
        var inp = f.phone.input, v = inp.value;
        var c = prefixCountry(v, sel.value);
        if (c && c !== sel.value) sel.value = c;
        if (!samePhone() && consent.checked && L.phone) consent.checked = false;
        if (sms && !samePhone() && sms.checked && L.phone) sms.checked = false;
        if (/^\s*(\+|00)/.test(v) || !e.inputType || e.inputType.indexOf("delete") === 0) return;
        if (inp.selectionStart !== v.length) return;
        var digits = v.replace(/\D/g, "");
        if (digits.length > 15 || /[^\d\s().-]/.test(v)) return;
        var g = groupDigits(digits);
        if (g !== v) inp.value = g;
      });
      sel.addEventListener("change", function () {
        changed(); keep();
        if (f.phone.input.value.trim()) { var err = check("phone"); show("phone", err); if (!err) phoneOk(); }
        if (!samePhone() && L.phone) { consent.checked = false; if (sms) sms.checked = false; }
      });
      if (sms) sms.addEventListener("change", changed);
      consent.addEventListener("change", function () { changed(); if (!f.phone.wrap.classList.contains("bad")) phoneOk(); });

      function emailSuggest() {
        emailHint.innerHTML = "";
        var s = suggestEmail(f.email.input.value.trim());
        if (!s) return;
        var b = el("button", { type: "button", class: "linkish suggest", text: s, onclick: function () {
          f.email.input.value = s; emailHint.innerHTML = ""; keep(); show("email", check("email")); f.email.input.focus();
        } });
        emailHint.appendChild(d.createTextNode("Did you mean "));
        emailHint.appendChild(b);
        emailHint.appendChild(d.createTextNode("?"));
      }

      // Applied before with this email: the button comes back as soon as the email changes.
      var blockedEmail = null;
      f.email.input.addEventListener("input", function () {
        if (blockedEmail !== null && f.email.input.value.trim().toLowerCase() !== blockedEmail) {
          blockedEmail = null; btn.disabled = false; btn.textContent = "Continue"; status.innerHTML = "";
        }
      });

      function summary(errs) {
        status.innerHTML = "";
        var labels = errs.map(function (x) { return d.querySelector("label[for=f-" + x + "]").textContent.replace(" (optional)", ""); });
        status.appendChild(notice(errs.length === 1 ? "Please check " + labels[0].toLowerCase() + "." : "Please check " + errs.length + " fields: " + labels.join(", ") + ".", true));
      }

      function done() {
        busy = false; btn.classList.remove("busy");
        if (blockedEmail === null) { btn.textContent = "Continue"; btn.disabled = false; }
      }
      function send(v, retried) {
        post("/api/apply/contact", { first_name: v.first_name, last_name: v.last_name, email: v.email, phone: v.phone, phone_country: sel.value, call_consent: consent.checked, sms_consent: sms ? sms.checked : undefined, turnstile: ts.token || undefined })
          .then(function (r) {
            // Every post spends the token; the widget makes a new one.
            if (!r.ok) tsReset();
            if (r.ok) {
              busy = false; btn.classList.remove("busy");
              store(CKEY, null);
              var e164 = normPhone(v.phone, sel.value);
              // The server can decline a call consent (e.g. a number already on another recent application): never say "We'll call".
              var callOk = consent.checked && !r.call_consent_dropped;
              lead = { first: v.first_name, last: v.last_name, email: v.email, phone: e164 || v.phone, callConsent: callOk, smsConsent: sms ? sms.checked : false, answers: answers };
              if (consent.checked && !callOk) phoneNote = "Thanks. We'll follow up about your application by email.";
              else if (r.phone_callable === false && consent.checked) phoneNote = "Heads-up: that looks like a landline or service number, so our assistant won't ring it. You can change it with Back.";
              go(1);
              return;
            }
            if (r._status === 403 && r.code === "turnstile" && !retried) {
              // One silent retry with a fresh check before saying anything.
              return tsWait().then(function () { send(v, true); });
            }
            done();
            if (r._status === 409) {
              blockedEmail = v.email.toLowerCase();
              trackErr("email", "applied_before");
              status.appendChild(notice((r.message || "You have applied before with this email. We sent you a link to continue.") + " Not your email? Edit it above and press Continue.", false));
              btn.textContent = "Check your inbox"; btn.disabled = true;
              return;
            }
            trackErr(r.field || "form", "server_" + (r.code || r._status));
            if (r.field && f[r.field]) { show(r.field, [r.message || "Please check this field."]); summary([r.field]); f[r.field].input.focus(); return; }
            if (r.code === "turnstile") { status.appendChild(notice("We couldn't confirm you're not a bot. If a check box appeared above, tick it, then press Continue.", true)); return; }
            status.appendChild(notice(r.message || "Something went wrong. Please try again.", true));
          })
          .catch(function () { done(); trackErr("form", "network"); status.appendChild(notice("Network problem. Please check your connection and try again.", true)); });
      }
      function submit() {
        if (busy || btn.disabled) return;
        var v = {}; Object.keys(f).forEach(function (k) { v[k] = f[k].input.value.trim(); });
        var bad = [];
        ["first_name", "email", "phone"].forEach(function (k) { var err = check(k); show(k, err); if (err) { bad.push(k); trackErr(k, err[1]); } });
        if (bad.length) { summary(bad); f[bad[0]].input.focus(); return; }
        status.innerHTML = "";
        busy = true; btn.classList.add("busy"); btn.textContent = "Saving…";
        tsWait().then(function () { send(v, false); });
      }
      form.onsubmit = function (e) { e.preventDefault(); submit(); };
      root._keys = null;
    }

    // ── single choice: native radios styled as cards ──
    function optionCard(q, o, i, type, checked) {
      var input = el("input", { type: type, name: "q-" + q.id, value: o.value, class: "opt-input", id: "o-" + q.id + "-" + i });
      input.checked = !!checked;
      var lab = el("label", { class: "opt" + (checked ? " is-on" : ""), for: input.id, "data-value": o.value }, [input, el("kbd", { "aria-hidden": "true", text: keys[i] }), el("span", { text: o.label })]);
      return { input: input, label: lab };
    }

    function renderSingle(q) {
      var cur = answers[q.id], saving = false, pointerAt = 0;
      var cards = q.options.map(function (o, i) { return optionCard(q, o, i, "radio", cur === o.value); });
      var list = el("div", { class: "options" }, cards.map(function (c) { return c.label; }));
      var hint = touch ? null : "Press " + keys.charAt(0) + "–" + keys.charAt(q.options.length - 1) + " · Enter ↵";
      frame(q, list, footer({ hint: hint }), { fieldset: true });
      function mark(value) { cards.forEach(function (c) { var on = c.input.value === value; c.input.checked = on; c.label.classList.toggle("is-on", on); }); }
      // Save, then advance (options are ignored while a save is in flight, so a double tap can't skip a question).
      function commit(value) {
        if (saving) return;
        saving = true; list.setAttribute("aria-busy", "true");
        var t0 = Date.now();
        save(q.id, value).then(function (r) {
          if (r && r.ok === false && r._status !== 429) throw new Error("save");
          setTimeout(function () { saving = false; next(); }, Math.max(0, 220 - (Date.now() - t0)));
        }).catch(function () {
          saving = false; list.removeAttribute("aria-busy"); trackErr(q.id, "save_failed");
          say("Not saved. Please check your connection and try again.");
        });
      }
      function pick(value, advance) {
        if (saving) return;
        if (answers[q.id] !== value) changed();
        answers[q.id] = value;
        mark(value);
        if (advance) commit(value);
      }
      list.addEventListener("pointerdown", function () { pointerAt = Date.now(); touched(); });
      cards.forEach(function (c) {
        // Click / tap picks and moves on; arrow keys only pick (no pointer just before the change).
        c.input.addEventListener("change", function () { if (c.input.checked) pick(c.input.value, Date.now() - pointerAt < 1500); });
        c.input.addEventListener("click", function (e) { if (saving) { e.preventDefault(); return; } if (Date.now() - pointerAt < 1500 && answers[q.id] === c.input.value && c.input.checked) commit(c.input.value); });
        c.input.addEventListener("keydown", function (e) {
          if (e.key === "Enter" || e.key === " ") { e.preventDefault(); touched(); pick(c.input.value, true); }
        });
      });
      root._keys = function (k) { var i = keys.indexOf(k.toUpperCase()); if (i < 0) i = Number(k) - 1; if (i >= 0 && q.options[i]) { touched(); pick(q.options[i].value, true); } };
      form.onsubmit = function (e) { e.preventDefault(); if (answers[q.id]) commit(answers[q.id]); };
      if (firstRender && !embedded) focusSoon((cards.filter(function (c) { return c.input.checked; })[0] || cards[0]).input);
    }

    // ── multi choice: native checkboxes ──
    function renderMulti(q) {
      var sel = (Array.isArray(answers[q.id]) ? answers[q.id] : []).slice(), saving = false;
      var btn = el("button", { class: "btn lg", type: "submit", text: "Continue" });
      var cards = q.options.map(function (o, i) { return optionCard(q, o, i, "checkbox", sel.indexOf(o.value) >= 0); });
      var msg = el("div");
      frame(q, el("div", {}, [el("div", { class: "options" }, cards.map(function (c) { return c.label; })), msg]), footer({ button: btn, hint: touch ? null : "Pick any · Enter ↵" }), { fieldset: true });
      function sync() { sel = cards.filter(function (c) { return c.input.checked; }).map(function (c) { return c.input.value; }); cards.forEach(function (c) { c.label.classList.toggle("is-on", c.input.checked); }); }
      cards.forEach(function (c) {
        c.input.addEventListener("change", function () { changed(); sync(); });
        c.input.addEventListener("keydown", function (e) { if (e.key === "Enter") { e.preventDefault(); form.onsubmit(e); } });
      });
      root._keys = function (k) { var i = keys.indexOf(k.toUpperCase()); if (i < 0) i = Number(k) - 1; if (i >= 0 && cards[i]) { cards[i].input.checked = !cards[i].input.checked; changed(); sync(); } };
      form.onsubmit = function (e) {
        e.preventDefault();
        if (saving) return;
        if (!sel.length) { msg.innerHTML = ""; msg.appendChild(notice("Pick at least one.", true)); trackErr(q.id, "required"); cards[0].input.focus(); return; }
        saving = true; btn.classList.add("busy");
        save(q.id, sel.slice()).then(function () { saving = false; next(); }).catch(function () { saving = false; btn.classList.remove("busy"); trackErr(q.id, "save_failed"); msg.innerHTML = ""; msg.appendChild(notice("Not saved. Please check your connection and try again.", true)); });
      };
      if (firstRender && !embedded) focusSoon(cards[0].input);
    }

    // ── text ──
    var draft = null; // { id, value } waiting to be saved as a draft
    function flushDraft(beacon) {
      if (!draft) return;
      var body = { answers: {}, draft: true }; body.answers[draft.id] = draft.value;
      draft = null;
      if (beacon && navigator.sendBeacon) navigator.sendBeacon("/api/apply/answers", new Blob([JSON.stringify(body)], { type: "application/json" }));
      else post("/api/apply/answers", body).catch(function () {});
    }
    d.addEventListener("visibilitychange", function () { if (d.visibilityState === "hidden") flushDraft(true); });

    function renderText(q) {
      var long = q.id === "why_now";
      var input = el(long ? "textarea" : "input", { id: "f-" + q.id, name: q.id, placeholder: q.placeholder || "", "aria-labelledby": "q-title", "aria-describedby": "m-" + q.id + (q.help ? " q-help" : ""), "data-private": true,
        autocapitalize: "sentences", spellcheck: "true", enterkeyhint: long ? "enter" : "next" });
      if (!long) { input.setAttribute("type", "text"); input.setAttribute("autocomplete", "off"); }
      input.value = answers[q.id] || "";
      var msg = el("p", { class: "msg", id: "m-" + q.id });
      var wrap = el("div", { class: "field full" }, [input, msg]);
      // Optional companion field on the same screen (the company website under "What does your business sell").
      var cq = companion(q), cInput = null, cMsg = null, cWrap = null;
      if (cq) {
        cInput = el("input", { id: "f-" + cq.id, name: cq.id, type: cq.format === "url" ? "url" : "text", inputmode: cq.format === "url" ? "url" : null,
          autocomplete: cq.format === "url" ? "url" : "off", autocapitalize: "none", autocorrect: "off", spellcheck: "false", placeholder: cq.placeholder || "",
          "aria-describedby": "m-" + cq.id, enterkeyhint: "next" });
        cInput.value = answers[cq.id] || "";
        cMsg = el("p", { class: "msg", id: "m-" + cq.id });
        cWrap = el("div", { class: "field full companion" }, [el("label", { for: "f-" + cq.id, text: cq.label || cq.title }), cInput, cMsg]);
        cInput.addEventListener("input", function () { touched(); if (cWrap.classList.contains("bad")) cShow(cErr()); });
        cInput.addEventListener("blur", function () { if (cInput.value.trim()) cShow(cErr()); });
        cInput.addEventListener("change", changed);
      }
      function cErr() { return cInput && cleanUrl(cInput.value) === null ? "That doesn't look like a web address. Try something like yourcompany.com, or leave it empty." : null; }
      function cShow(e) { if (!cWrap) return; cWrap.classList.toggle("bad", !!e); cMsg.textContent = e || ""; if (e) cInput.setAttribute("aria-invalid", "true"); else cInput.removeAttribute("aria-invalid"); }
      var last = idx === qs.length - 1;
      var btn = el("button", { class: "btn lg", type: "submit", text: last ? "Submit application" : "Continue" });
      frame(q, el("div", { class: "fields" }, [wrap, cWrap]), footer({ button: btn, hint: touch ? null : long ? (q.optional ? "Optional · ⌘ Enter" : "⌘ Enter") : "Enter ↵" }));
      if (firstRender && !embedded) focusSoon(input);
      var min = Math.max(1, q.minLength || 1), shown = false, saving = false, dT = 0;
      function err() {
        var v = input.value.replace(/\s+/g, " ").trim();
        if (q.optional || v.length >= min) return null;
        if (q.id === "business") return v ? "A few more words, please: what you sell and who to, e.g. “Software to dental clinics in Norway”." : "Add what you sell and who to, e.g. “Software to dental clinics in Norway”.";
        return "A few more words, please.";
      }
      function show(e) { wrap.classList.toggle("bad", !!e); msg.textContent = e || ""; if (e) { input.setAttribute("aria-invalid", "true"); shown = true; } else input.removeAttribute("aria-invalid"); }
      input.addEventListener("blur", function () { if (input.value.trim()) { var e = err(); show(e); if (e) trackErr(q.id, "short"); } });
      input.addEventListener("input", function () {
        touched();
        if (shown) show(err());
        if (long) {
          // Long answers are saved as drafts while typing (not counted as answered until submit).
          draft = { id: q.id, value: input.value.slice(0, 1200) };
          clearTimeout(dT); dT = setTimeout(function () { flushDraft(false); }, 800);
        }
      });
      input.addEventListener("change", changed);
      if (long && touch) input.addEventListener("focus", function () { setTimeout(function () { input.scrollIntoView({ block: "center", behavior: "smooth" }); }, 300); });
      input.addEventListener("keydown", function (e) {
        if (long && e.key === "Enter" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); form.requestSubmit ? form.requestSubmit() : form.onsubmit(e); }
      });
      root._keys = null;
      form.onsubmit = function (e) {
        e.preventDefault();
        if (saving) return;
        var v = input.value.replace(/\s+/g, " ").trim();
        var bad = err();
        if (bad) { show(bad); trackErr(q.id, v ? "short" : "required"); input.focus(); return; }
        var cBad = cErr();
        if (cBad) { cShow(cBad); trackErr(cq.id, "invalid"); cInput.focus(); return; }
        clearTimeout(dT); draft = null;
        saving = true; btn.classList.add("busy");
        var send = {}; send[q.id] = v;
        if (cq) { send[cq.id] = cleanUrl(cInput.value) || ""; answers[cq.id] = send[cq.id]; }
        answers[q.id] = v;
        post("/api/apply/answers", { answers: send, step: idx + 1 }).then(function (r) {
          if (r && r.ok === false && r._status !== 429) throw new Error("save");
          saving = false; next();
        }).catch(function () { saving = false; btn.classList.remove("busy"); trackErr(q.id, "save_failed"); show("Not saved. Please check your connection and try again."); });
      };
    }

    function next() {
      if (idx >= qs.length - 1) return finish();
      go(1);
    }

    // ── after submit: optional prep questions (and "where did you hear about us"), open times ──
    function prepBlocks() {
      var box = el("div", { class: "prep-blocks" });
      postQs.forEach(function (q, i) { box.appendChild(prepBlock(q, i)); });
      return postQs.length ? box : null;
    }
    function prepBlock(q, n) {
      if (!q) return null;
      var other = companion(q), otherInput = null, otherWrap = null, ot = 0;
      var picked = (Array.isArray(answers[q.id]) ? answers[q.id] : []).slice(), t = 0;
      var cards = q.options.map(function (o, i) { return optionCard(q, o, i, "checkbox", picked.indexOf(o.value) >= 0); });
      cards.forEach(function (c) { var k = c.label.querySelector("kbd"); if (k) k.parentNode.removeChild(k); });
      function sync() {
        picked = cards.filter(function (c) { return c.input.checked; }).map(function (c) { return c.input.value; });
        cards.forEach(function (c) { c.label.classList.toggle("is-on", c.input.checked); });
        if (otherWrap) otherWrap.hidden = picked.indexOf("other") < 0;
        clearTimeout(t);
        t = setTimeout(function () { save(q.id, picked.slice(), stepOf(q)).then(function () { say("Saved."); }).catch(function () { say("Not saved. Please try again."); }); }, 600);
      }
      cards.forEach(function (c) { c.input.addEventListener("change", sync); });
      if (other) {
        // "Somewhere else": a short text field, saved as the person types (debounced), only once they pick it.
        otherInput = el("input", { type: "text", id: "f-" + other.id, name: other.id, maxlength: "120", autocomplete: "off", placeholder: other.placeholder || "", "data-private": true });
        otherInput.value = answers[other.id] || "";
        otherWrap = el("div", { class: "field full other-field" }, [el("label", { for: "f-" + other.id, text: other.label || other.title }), otherInput]);
        otherWrap.hidden = picked.indexOf("other") < 0;
        otherInput.addEventListener("input", function () {
          clearTimeout(ot);
          ot = setTimeout(function () { save(other.id, otherInput.value.replace(/\s+/g, " ").trim().slice(0, 120), stepOf(q)).then(function () { say("Saved."); }).catch(function () { say("Not saved. Please try again."); }); }, 800);
        });
      }
      var first = !n;
      return el("fieldset", { class: "choice prep" }, [
        el("legend", {}, [el("span", { class: "prep-title", text: first ? "Help " + ((cfg.founder) || "Bendik") + " prepare (optional)" : q.title + " (optional)" })]),
        first ? el("p", { class: "help", text: q.title }) : null,
        el("div", { class: "options compact" }, cards.map(function (c) { return c.label; })),
        otherWrap
      ]);
    }

    function resultScreen(r) {
      // A/B without open times: say it is in, offer the prep question, then the route.
      root.innerHTML = "";
      var h = heading("Thank you" + (lead && lead.first ? ", " + lead.first : "") + ". Your application is in.");
      var cta = el("a", { class: "btn lg", href: r.route, text: r.route === "/book" ? "Pick a time" : "See your next step" });
      root.appendChild(el("div", { class: "step result" }, [h, prepBlocks(), el("div", { class: "step-foot" }, [el("span"), cta])]));
      setTimeout(function () { h.focus({ preventScroll: embedded }); }, 60);
    }

    function slotScreen(r, note) {
      var tz = (Intl.DateTimeFormat().resolvedOptions() || {}).timeZone || r.tz;
      var dayFmt = new Intl.DateTimeFormat(undefined, { weekday: "short", day: "numeric", month: "short" });
      var timeFmt = new Intl.DateTimeFormat(undefined, { hour: "2-digit", minute: "2-digit" });
      var keyFmt = new Intl.DateTimeFormat("en-CA", { year: "numeric", month: "2-digit", day: "2-digit" });
      var days = [], byDay = {};
      r.slots.forEach(function (s) {
        var dt = new Date(s), k = keyFmt.format(dt);
        if (!byDay[k]) { byDay[k] = []; days.push({ key: k, label: dayFmt.format(dt) }); }
        if (byDay[k].length < 6) byDay[k].push(s);
      });
      var chosen = null, curDay = 0, booking = false;
      root.innerHTML = "";
      var who = (r.closer && r.closer.name) || "Bendik";
      var h = heading("Good news" + (lead && lead.first ? ", " + lead.first : "") + ". Pick a time for your strategy call with " + who + ".");
      var help = el("p", { class: "help", text: "Times are in your time zone" + (tz ? " (" + tz.replace(/_/g, " ") + ")" : "") + "." });
      var tablist = el("div", { class: "day-tabs", role: "tablist", "aria-label": "Days" });
      var panel = el("div", { class: "day-panel", role: "tabpanel", id: "slot-panel", tabindex: "-1" });
      var confirm = el("button", { class: "btn lg", type: "button", disabled: true, text: "Pick a time" });
      var msg = el("div");
      var full = el("a", { class: "full-cal", href: r.route, text: "None of these work? See the full calendar" });
      var tabs = days.map(function (dd, i) {
        return el("button", { type: "button", role: "tab", id: "day-" + i, "aria-controls": "slot-panel", "aria-selected": i === 0 ? "true" : "false", tabindex: i === 0 ? "0" : "-1", text: dd.label,
          onclick: function () { showDay(i, false); } });
      });
      tabs.forEach(function (t) { tablist.appendChild(t); });
      tablist.addEventListener("keydown", function (e) {
        var n = e.key === "ArrowRight" ? 1 : e.key === "ArrowLeft" ? -1 : 0;
        if (e.key === "Home") n = -curDay; else if (e.key === "End") n = days.length - 1 - curDay;
        if (!n) return;
        e.preventDefault();
        showDay((curDay + n + days.length) % days.length, true);
      });
      function label() { if (!chosen) return "Pick a time"; var dt = new Date(chosen); return "Confirm " + dayFmt.format(dt) + ", " + timeFmt.format(dt); }
      function showDay(i, focusTab) {
        curDay = i;
        tabs.forEach(function (t, j) { t.setAttribute("aria-selected", j === i ? "true" : "false"); t.tabIndex = j === i ? 0 : -1; });
        if (focusTab) tabs[i].focus();
        panel.setAttribute("aria-labelledby", "day-" + i);
        panel.innerHTML = "";
        var fs = el("fieldset", { class: "choice times" }, [el("legend", { class: "sr-only", text: "Times on " + days[i].label })]);
        byDay[days[i].key].forEach(function (s, j) {
          var input = el("input", { type: "radio", name: "slot", value: s, class: "opt-input", id: "slot-" + i + "-" + j });
          input.checked = chosen === s;
          var lab = el("label", { class: "opt time" + (input.checked ? " is-on" : ""), for: input.id }, [input, el("span", { text: timeFmt.format(new Date(s)) })]);
          input.addEventListener("change", function () {
            if (!input.checked) return;
            chosen = s;
            fs.querySelectorAll(".opt").forEach(function (x) { x.classList.toggle("is-on", x === lab); });
            confirm.disabled = false; confirm.textContent = label();
            track("slot_pick", { day: i, n: j });
          });
          fs.appendChild(lab);
        });
        panel.appendChild(fs);
      }
      confirm.addEventListener("click", function () {
        if (!chosen || booking) return;
        booking = true; confirm.classList.add("busy"); confirm.textContent = "Booking…";
        msg.innerHTML = "";
        post("/api/apply/book", { start: chosen, tz: tz }).then(function (b) {
          if (b.ok) { track("slot_booked", {}); say("Booked."); location.href = b.next || "/breakout"; return; }
          booking = false; confirm.classList.remove("busy");
          track("slot_failed", { code: b.code || String(b._status) });
          if (b.code === "taken" && b.slots && b.slots.length) { slotScreen({ slots: b.slots, closer: r.closer, tz: r.tz, route: r.route }, b.message || "That time has just gone. Here are the times still open."); return; }
          if (b.code === "busy") { confirm.textContent = label(); msg.appendChild(notice(b.message || "One moment, still booking.", false)); return; }
          // Anything else: the full calendar, as before.
          msg.appendChild(notice("We couldn't book that time here. Taking you to the full calendar…", true));
          setTimeout(function () { location.href = b.route || r.route; }, 1500);
        }).catch(function () {
          booking = false; confirm.classList.remove("busy"); confirm.textContent = label();
          track("slot_failed", { code: "network" });
          msg.appendChild(notice("Network problem. Please try again, or use the full calendar below.", true));
        });
      });
      var kids = [h, help];
      if (note) kids.push(notice(note, true));
      kids.push(tablist, panel, msg, el("div", { class: "step-foot slot-foot" }, [full, confirm]), prepBlocks());

      root.appendChild(el("div", { class: "step slots" }, kids));
      showDay(0, false);
      track("slot_view", { days: days.length, slots: r.slots.length });
      setTimeout(function () { h.focus({ preventScroll: embedded }); }, 60);
    }

    function finish() {
      stepEnd("next");
      submitted = true;
      setBar(100);
      var items = ["Reading your answers", "Checking fit with the program", "Finding the right next step"].map(function (t) { return el("li", { text: t }); });
      root.innerHTML = "";
      var h = el(titleTag, { class: "q-title", tabindex: "-1", text: "One moment." });
      root.appendChild(el("div", { class: "step analysing" }, [el("div", { class: "spinner", "aria-hidden": "true" }), h, el("ul", {}, items)]));
      focusSoon(h);
      items.forEach(function (li, i) { setTimeout(function () { li.classList.add("done"); }, 600 + i * 700); });
      var started = Date.now();
      var tz = (Intl.DateTimeFormat().resolvedOptions() || {}).timeZone || "";
      function fail(title, text) {
        submitted = false;
        root.innerHTML = "";
        var ht = el(titleTag, { class: "q-title", tabindex: "-1", text: title });
        root.appendChild(el("div", { class: "step" }, [ht, notice(text, true),
          el("div", { class: "step-foot" }, [el("span"), el("button", { class: "btn", type: "button", text: "Try again", onclick: finish })])]));
        focusSoon(ht);
      }
      post("/api/apply/submit", { tz: tz }).then(function (r) {
        var wait = Math.max(0, 2600 - (Date.now() - started));
        setTimeout(function () {
          if (r && r.ok && r.route) {
            store(CKEY, null);
            if (r.slots && r.slots.length) return slotScreen(r);
            if ((r.tier === "A" || r.tier === "B") && postQs.length) return resultScreen(r);
            location.href = r.route; return;
          }
          var missing = r && r.error && r.error.indexOf("missing:") === 0 ? r.error.slice(8) : null;
          var at = missing ? qs.map(function (q) { return q.id; }).indexOf(missing) : -1;
          if (at >= 0) { submitted = false; idx = at; render(); histSet(false); root.querySelector(".step").appendChild(notice("Please answer this one to finish.", true)); return; }
          fail("That did not go through.", "Please try again in a moment. Your answers are saved.");
        }, wait);
      }).catch(function () { fail("Network problem.", "Your answers are saved. Please try again."); });
    }

    function render() {
      var q = qs[idx];
      root._keys = null;
      if (cfg.done && cfg.done.route) {
        // Applied already: no form, just the way to the next step.
        root.innerHTML = "";
        root.appendChild(el("div", { class: "step" }, [
          el(titleTag, { class: "q-title", text: "Your application is in." }),
          el("p", { class: "help", text: "Thank you. Your next step is ready." }),
          el("div", { class: "step-foot" }, [el("span"), el("a", { class: "btn lg", href: cfg.done.route, text: "See your next step" })]),
        ]));
        setBar(100);
        return;
      }
      if (q.type === "contact") return renderContact(q);
      if (!lead) { idx = 0; return renderContact(qs[0]); }
      if (q.type === "single") return renderSingle(q);
      if (q.type === "multi") return renderMulti(q);
      return renderText(q);
    }

    render();
    histSet(false);
    firstRender = false;
  }

  if (d.readyState === "loading") d.addEventListener("DOMContentLoaded", boot); else boot();
})();
