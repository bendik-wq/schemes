/* Application: one question per screen, contact first, keyboard shortcuts, every answer saved
   server-side as you go, an "analysing" step, then the route for your tier. */
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

  function boot() {
    var cfg = w.OPCFG || {};
    var qs = cfg.questions || [];
    var root = d.querySelector(".steps");
    var bar = d.querySelector(".progress i");
    if (!root || !qs.length) return;
    var lead = cfg.lead;
    var answers = (lead && lead.answers) || {};
    var keys = "ABCDEFGH";
    var idx = 0, busy = false, dir = 1;

    // Resume at the first unanswered question for a returning applicant.
    if (lead) {
      idx = 1;
      for (var i = 1; i < qs.length; i++) {
        var a = answers[qs[i].id];
        var has = Array.isArray(a) ? a.length > 0 : a != null && String(a).trim() !== "";
        if (!has && !qs[i].optional) { idx = i; break; }
        idx = Math.min(i + 1, qs.length - 1);
      }
    }

    function progress() { if (bar) bar.style.width = Math.round((idx / qs.length) * 100) + "%"; }

    function frame(q, body, foot) {
      var n = el("p", { class: "step-n", text: String(idx + 1).padStart(2, "0") + " / " + String(qs.length).padStart(2, "0") });
      var h = el("h1", { id: "q-title", text: q.title });
      var kids = [n, h];
      if (q.help) kids.push(el("p", { class: "help", text: q.help }));
      kids.push(body);
      if (foot) kids.push(foot);
      var s = el("div", { class: "step" + (dir < 0 ? " back" : ""), role: "group", "aria-labelledby": "q-title" }, kids);
      root.innerHTML = "";
      root.appendChild(s);
      progress();
      return s;
    }

    function footer(opts) {
      var left = idx > 0 ? el("a", { href: "#", class: "back", text: "‹ Back", onclick: function (e) { e.preventDefault(); go(-1); } }) : el("span");
      var right = el("div", {}, [
        opts.hint ? el("span", { class: "hint", text: opts.hint + "  " }) : null,
        opts.button || null
      ]);
      right.style.display = "flex"; right.style.alignItems = "center"; right.style.gap = "14px";
      return el("div", { class: "step-foot" }, [left, right]);
    }

    function notice(text, err) { return el("div", { class: "notice" + (err ? " err" : ""), role: err ? "alert" : "status", text: text }); }

    function save(id, value) {
      answers[id] = value;
      return post("/api/apply/answers", { answers: (function () { var o = {}; o[id] = value; return o; })(), step: idx + 1 }).catch(function () {});
    }

    function go(delta) {
      dir = delta;
      if (delta < 0) track("app_back", { from: qs[idx].id });
      idx = Math.max(0, Math.min(qs.length - 1, idx + delta));
      render();
      w.scrollTo({ top: 0, behavior: "smooth" });
    }

    // ── contact ──
    function renderContact(q) {
      var f = {};
      function field(name, label, type, auto, full, value) {
        var input = el("input", { id: "f-" + name, name: name, type: type, autocomplete: auto, value: value || "", required: true, "aria-describedby": "m-" + name });
        if (name === "phone") input.setAttribute("inputmode", "tel");
        var msg = el("p", { class: "msg", id: "m-" + name, "aria-live": "polite" });
        var wrap = el("div", { class: "field" + (full ? " full" : "") }, [el("label", { for: "f-" + name, text: label }), input, msg]);
        f[name] = { input: input, msg: msg, wrap: wrap };
        return wrap;
      }
      var L = lead || {};
      var grid = el("div", { class: "fields" }, [
        field("first_name", "First name", "text", "given-name", false, L.first),
        field("last_name", "Last name", "text", "family-name", false, L.last),
        field("email", "Work email", "email", "email", true, L.email),
        field("phone", "Mobile", "tel", "tel", true, L.phone)
      ]);
      f.phone.input.placeholder = cfg.country === "NO" ? "+47 912 34 567" : cfg.country === "GB" ? "+44 7700 900123" : "+1 415 555 0123";
      var consent = el("input", { type: "checkbox", name: "call_consent", id: "f-consent" });
      // Consent is per number: it is only shown as given while the number is unchanged.
      if (L.callConsent) consent.checked = true;
      f.phone.input.addEventListener("input", function () { if (f.phone.input.value.trim() !== (L.phone || "")) consent.checked = false; });
      var consentRow = el("label", { class: "check", for: "f-consent" }, [consent, el("span", { text: (cfg.consent && cfg.consent.label) || "" })]);
      var ts = cfg.turnstile ? el("div", { class: "ts-box cf-turnstile", "data-sitekey": cfg.turnstile, "data-size": "flexible", "data-appearance": "interaction-only" }) : null;
      var status = el("div");
      var btn = el("button", { class: "btn lg", type: "submit", text: "Continue" });
      var body = el("div", {}, [grid, consentRow, ts, status]);
      frame(q, body, footer({ button: btn, hint: "Enter ↵" }));
      if (ts && !w.turnstile) {
        var s = d.createElement("script"); s.src = "https://challenges.cloudflare.com/turnstile/v0/api.js"; s.async = true; d.head.appendChild(s);
      }
      setTimeout(function () { (L.first ? f.email.input : f.first_name.input).focus(); }, 60);

      function setErr(name, text) {
        Object.keys(f).forEach(function (k) { f[k].wrap.classList.remove("bad"); f[k].msg.textContent = ""; });
        if (name && f[name]) { f[name].wrap.classList.add("bad"); f[name].msg.textContent = text; f[name].input.focus(); }
      }
      function submit() {
        if (busy) return;
        var v = {}; Object.keys(f).forEach(function (k) { v[k] = f[k].input.value.trim(); });
        if (!v.first_name) return setErr("first_name", "Please enter your first name.");
        if (!/^[^\s@<>()[\]"]+@[^\s@<>()[\]"]+\.[a-z]{2,}$/i.test(v.email)) return setErr("email", "Please enter a valid email address.");
        if (v.phone.replace(/\D/g, "").length < 7) return setErr("phone", "Please enter your mobile number.");
        setErr(null);
        status.innerHTML = "";
        busy = true; btn.classList.add("busy"); btn.textContent = "Saving…";
        var tsInput = d.querySelector("[name=cf-turnstile-response]");
        post("/api/apply/contact", { first_name: v.first_name, last_name: v.last_name, email: v.email, phone: v.phone, call_consent: consent.checked, turnstile: tsInput ? tsInput.value : undefined })
          .then(function (r) {
            busy = false; btn.classList.remove("busy"); btn.textContent = "Continue";
            if (r.ok) {
              lead = { first: v.first_name, last: v.last_name, email: v.email, phone: v.phone, callConsent: consent.checked, answers: answers };
              go(1);
              return;
            }
            if (r._status === 409) {
              status.appendChild(notice(r.message || "You have applied before with this email. We sent you a link to continue."));
              btn.textContent = "Check your inbox"; btn.disabled = true;
              return;
            }
            if (r.field) return setErr(r.field, r.message || "Please check this field.");
            status.appendChild(notice(r.message || "Something went wrong. Please try again.", true));
            if (w.turnstile && w.turnstile.reset) w.turnstile.reset();
          })
          .catch(function () { busy = false; btn.classList.remove("busy"); btn.textContent = "Continue"; status.appendChild(notice("Network problem. Please try again.", true)); });
      }
      root.closest("form").onsubmit = function (e) { e.preventDefault(); submit(); };
    }

    // ── single choice ──
    function renderSingle(q) {
      var cur = answers[q.id];
      var btns = q.options.map(function (o, i) {
        return el("button", { type: "button", class: "opt", "aria-pressed": cur === o.value ? "true" : "false", "data-value": o.value,
          onclick: function () { pick(o.value); } }, [el("kbd", { text: keys[i] }), el("span", { text: o.label })]);
      });
      var list = el("div", { class: "options", role: "radiogroup", "aria-labelledby": "q-title" }, btns);
      frame(q, list, footer({ hint: "Press " + keys.slice(0, q.options.length).split("").join(", ") }));
      function pick(value) {
        btns.forEach(function (b) { b.setAttribute("aria-pressed", b.getAttribute("data-value") === value ? "true" : "false"); });
        save(q.id, value);
        setTimeout(function () { next(); }, 220);
      }
      root._keys = function (k) { var i = keys.indexOf(k.toUpperCase()); if (i < 0) i = Number(k) - 1; if (i >= 0 && q.options[i]) pick(q.options[i].value); };
      root.closest("form").onsubmit = function (e) { e.preventDefault(); if (answers[q.id]) next(); };
      setTimeout(function () { (btns.filter(function (b) { return b.getAttribute("aria-pressed") === "true"; })[0] || btns[0]).focus(); }, 60);
    }

    // ── multi choice ──
    function renderMulti(q) {
      var sel = (Array.isArray(answers[q.id]) ? answers[q.id] : []).slice();
      var btn = el("button", { class: "btn lg", type: "submit", text: "Continue" });
      var btns = q.options.map(function (o, i) {
        return el("button", { type: "button", class: "opt", role: "checkbox", "aria-checked": sel.indexOf(o.value) >= 0 ? "true" : "false", "data-value": o.value,
          onclick: function () { toggle(o.value); } }, [el("kbd", { text: keys[i] }), el("span", { text: o.label })]);
      });
      var msg = el("div");
      frame(q, el("div", {}, [el("div", { class: "options" }, btns), msg]), footer({ button: btn, hint: "Pick any" }));
      function toggle(v) {
        var i = sel.indexOf(v);
        if (i >= 0) sel.splice(i, 1); else sel.push(v);
        btns.forEach(function (b) { b.setAttribute("aria-checked", sel.indexOf(b.getAttribute("data-value")) >= 0 ? "true" : "false"); });
      }
      root._keys = function (k) { var i = keys.indexOf(k.toUpperCase()); if (i < 0) i = Number(k) - 1; if (i >= 0 && q.options[i]) toggle(q.options[i].value); };
      root.closest("form").onsubmit = function (e) {
        e.preventDefault();
        if (!sel.length) { msg.innerHTML = ""; msg.appendChild(notice("Pick at least one.", true)); return; }
        save(q.id, sel.slice()); next();
      };
    }

    // ── text ──
    function renderText(q) {
      var long = q.id === "why_now";
      var input = el(long ? "textarea" : "input", { id: "f-" + q.id, name: q.id, placeholder: q.placeholder || "", "aria-labelledby": "q-title", "data-private": true });
      if (!long) input.setAttribute("type", "text");
      input.value = answers[q.id] || "";
      var msg = el("p", { class: "msg", "aria-live": "polite" });
      var wrap = el("div", { class: "field full" }, [input, msg]);
      var btn = el("button", { class: "btn lg", type: "submit", text: idx === qs.length - 1 ? "Submit application" : "Continue" });
      frame(q, el("div", { class: "fields" }, [wrap]), footer({ button: btn, hint: long ? (q.optional ? "Optional · ⌘ Enter" : "⌘ Enter") : "Enter ↵" }));
      setTimeout(function () { input.focus(); }, 60);
      input.addEventListener("keydown", function (e) {
        if (long && e.key === "Enter" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); root.closest("form").requestSubmit ? root.closest("form").requestSubmit() : root.closest("form").onsubmit(e); }
      });
      root._keys = null;
      root.closest("form").onsubmit = function (e) {
        e.preventDefault();
        var v = input.value.replace(/\s+/g, " ").trim();
        if (!q.optional && v.length < Math.max(1, q.minLength || 1)) { wrap.classList.add("bad"); msg.textContent = "A few more words, please."; return; }
        save(q.id, v).then(function () { next(); });
      };
    }

    function next() {
      if (idx >= qs.length - 1) return finish();
      go(1);
    }

    function finish() {
      if (bar) bar.style.width = "100%";
      var items = ["Reading your answers", "Checking fit with the program", "Finding the right next step"].map(function (t) { return el("li", { text: t }); });
      root.innerHTML = "";
      root.appendChild(el("div", { class: "step analysing" }, [el("div", { class: "spinner", "aria-hidden": "true" }), el("h1", { text: "One moment." }), el("ul", {}, items)]));
      items.forEach(function (li, i) { setTimeout(function () { li.classList.add("done"); }, 600 + i * 700); });
      var started = Date.now();
      post("/api/apply/submit", {}).then(function (r) {
        var wait = Math.max(0, 2600 - (Date.now() - started));
        setTimeout(function () {
          if (r && r.ok && r.route) { location.href = r.route; return; }
          var missing = r && r.error && r.error.indexOf("missing:") === 0 ? r.error.slice(8) : null;
          var at = missing ? qs.map(function (q) { return q.id; }).indexOf(missing) : -1;
          if (at >= 0) { idx = at; render(); root.querySelector(".step").appendChild(notice("Please answer this one to finish.", true)); return; }
          root.innerHTML = "";
          root.appendChild(el("div", { class: "step" }, [el("h1", { text: "That did not go through." }), notice("Please try again in a moment. Your answers are saved.", true),
            el("div", { class: "step-foot" }, [el("span"), el("button", { class: "btn", type: "button", text: "Try again", onclick: finish })])]));
        }, wait);
      }).catch(function () {
        root.innerHTML = "";
        root.appendChild(el("div", { class: "step" }, [el("h1", { text: "Network problem." }), notice("Your answers are saved. Please try again.", true),
          el("div", { class: "step-foot" }, [el("span"), el("button", { class: "btn", type: "button", text: "Try again", onclick: finish })])]));
      });
    }

    function render() {
      var q = qs[idx];
      root._keys = null;
      if (q.type === "contact") return renderContact(q);
      if (!lead) { idx = 0; return renderContact(qs[0]); }
      if (q.type === "single") return renderSingle(q);
      if (q.type === "multi") return renderMulti(q);
      return renderText(q);
    }

    d.addEventListener("keydown", function (e) {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      var t = e.target;
      if (t && t.matches && t.matches("input,textarea")) return;
      if (root._keys && /^[a-h1-8]$/i.test(e.key)) { e.preventDefault(); root._keys(e.key); }
      if (e.key === "Enter" && t && t.classList && t.classList.contains("opt")) return;
    });

    render();
  }

  if (d.readyState === "loading") d.addEventListener("DOMContentLoaded", boot); else boot();
})();
