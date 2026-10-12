// Operator: reveal-animasjoner, kalkulator, søknadsskjema i flere steg og Claude-byggeplan.
(function () {
  var NO = document.documentElement.lang === "nb";
  var T = NO
    ? { next: "Fyll ut feltene for å gå videre.", send: "Fyll ut feltene for å sende.", sending: "Sender…", fail: "Noe gikk galt", retry: ". Prøv igjen.", thanks: "/no/takk/", cur: "kr", loc: "nb-NO", thinking: "Claude tenker…", wait: "Lager planen din, tar 10–30 sekunder…" }
    : { next: "Please complete the fields to continue.", send: "Please complete the fields to submit.", sending: "Sending…", fail: "Something went wrong", retry: ". Please try again.", thanks: "/thanks/", cur: "$", loc: "en-US", thinking: "Claude is thinking…", wait: "Building your plan, this takes 10–30 seconds…" };
  var fmt = new Intl.NumberFormat(T.loc);
  function money(v) { return NO ? fmt.format(Math.round(v)) + " kr" : "$" + fmt.format(Math.round(v)); }

  // Nav-skygge ved scroll
  var navEl = document.querySelector(".nav");
  if (navEl) { var onS = function () { navEl.classList.toggle("scrolled", window.scrollY > 8); }; window.addEventListener("scroll", onS, { passive: true }); onS(); }

  // Reveal on scroll
  var io = "IntersectionObserver" in window ? new IntersectionObserver(function (es) {
    es.forEach(function (e) { if (e.isIntersecting) { e.target.classList.add("in"); io.unobserve(e.target); } });
  }, { threshold: 0.12 }) : null;
  document.querySelectorAll(".rv").forEach(function (el) { io ? io.observe(el) : el.classList.add("in"); });

  // Kalkulator: sparing + ny omsetning
  var calc = document.querySelector("[data-calc]");
  if (calc) {
    var ins = calc.querySelectorAll("input[type=range]");
    var upd = function () {
      var v = {};
      ins.forEach(function (i) { v[i.name] = +i.value; var l = calc.querySelector('[data-v="' + i.name + '"]'); if (l) l.textContent = i.dataset.kind === "pct" ? i.value + " %" : money(+i.value); });
      calc.querySelector("[data-save]").textContent = money((v.agency + v.saas) * 12 * 0.6);
      calc.querySelector("[data-grow]").textContent = money(v.revenue * (v.lift / 100));
    };
    ins.forEach(function (i) { i.addEventListener("input", upd); });
    upd();
  }

  // Søknadsskjema
  var form = document.querySelector("form[data-apply]");
  if (form) {
    var steps = form.querySelectorAll(".step"), bars = form.querySelectorAll(".progress i"), err = form.querySelector(".err"), idx = 0;
    var prev = form.querySelector("[data-prev]"), next = form.querySelector("[data-next]"), sub = form.querySelector("[data-submit]");
    var show = function (i) {
      idx = i;
      steps.forEach(function (s, n) { s.classList.toggle("on", n === i); });
      bars.forEach(function (b, n) { b.classList.toggle("on", n <= i); });
      prev.style.visibility = i === 0 ? "hidden" : "visible";
      next.style.display = i === steps.length - 1 ? "none" : "";
      sub.style.display = i === steps.length - 1 ? "" : "none";
    };
    var valid = function (s) {
      var ok = true;
      s.querySelectorAll("[required]").forEach(function (el) {
        if (el.type === "radio") { if (!s.querySelector('input[name="' + el.name + '"]:checked')) ok = false; }
        else if (!el.value.trim() || (el.type === "email" && !/^\S+@\S+\.\S+$/.test(el.value))) ok = false;
      });
      return ok;
    };
    next.addEventListener("click", function (e) {
      e.preventDefault();
      if (!valid(steps[idx])) { err.textContent = T.next; return; }
      err.textContent = ""; show(idx + 1);
    });
    prev.addEventListener("click", function (e) { e.preventDefault(); err.textContent = ""; show(Math.max(0, idx - 1)); });
    form.addEventListener("submit", function (e) {
      e.preventDefault();
      if (idx < steps.length - 1) { next.click(); return; }
      if (!valid(steps[idx])) { err.textContent = T.send; return; }
      var label = sub.textContent; sub.disabled = true; sub.textContent = T.sending;
      var data = Object.fromEntries(new FormData(form).entries());
      data.page = location.pathname; data.utm = location.search; data.lang = NO ? "no" : "en";
      fetch("/api/apply", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(data) })
        .then(function (r) { return r.json().catch(function () { return {}; }).then(function (j) { return { ok: r.ok, j: j }; }); })
        .then(function (res) { if (!res.ok) throw new Error(res.j.error || T.fail); location.href = res.j.redirect || T.thanks; })
        .catch(function (x) { err.textContent = x.message + T.retry; sub.disabled = false; sub.textContent = label; });
    });
    show(0);
  }

  // Claude-byggeplan
  var ai = document.querySelector("form[data-ai]");
  if (ai) {
    var out = document.querySelector("[data-ai-out]"), aerr = ai.querySelector(".err"), abtn = ai.querySelector("[type=submit]");
    var esc = function (s) { return String(s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); };
    var list = function (a) { return "<ul class=\"ticks\">" + a.map(function (x) { return "<li>" + esc(x) + "</li>"; }).join("") + "</ul>"; };
    ai.addEventListener("submit", function (e) {
      e.preventDefault(); aerr.textContent = "";
      var data = Object.fromEntries(new FormData(ai).entries()); data.tool = "build-plan"; data.page = location.pathname; data.lang = NO ? "no" : "en";
      var label = abtn.textContent; abtn.disabled = true; abtn.textContent = T.thinking;
      out.innerHTML = "<p class=\"fine\">" + T.wait + "</p>";
      fetch("/api/claude", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(data) })
        .then(function (r) { return r.json().catch(function () { return {}; }).then(function (j) { return { ok: r.ok, j: j }; }); })
        .then(function (res) {
          if (!res.ok) throw new Error(res.j.error || T.fail);
          var r = res.j.result, L = NO ? ["byggedager med Claude Code", "Komponenter", "Build Day 1", "Build Day 2", "Risiko å planlegge for"] : ["build days with Claude Code", "Components", "Build Day 1", "Build Day 2", "Risks to plan for"];
          out.innerHTML = "<div class=\"result\"><span class=\"eyebrow\">" + esc(r.name) + "</span><h3 style=\"margin-top:10px\">" + esc(r.summary) + "</h3>" +
            "<p style=\"margin:10px 0 0\"><span class=\"amber\" style=\"font:400 44px/1 var(--serif)\">~" + esc(r.estimate_days) + "</span> " + L[0] + "</p>" +
            "<h3 style=\"margin-top:22px\">" + L[1] + "</h3>" + list(r.components) + "<h3 style=\"margin-top:22px\">" + L[2] + "</h3>" + list(r.day1) +
            "<h3 style=\"margin-top:22px\">" + L[3] + "</h3>" + list(r.day2) + "<h3 style=\"margin-top:22px\">" + L[4] + "</h3>" + list(r.risks) + "</div>";
        })
        .catch(function (x) { out.innerHTML = ""; aerr.textContent = x.message; })
        .finally(function () { abtn.disabled = false; abtn.textContent = label; });
    });
  }
})();
