// Multistegs søknadsskjema + ROI-kalkulator. Ingen avhengigheter.
(function () {
  // ---------- ROI-kalkulator ----------
  document.querySelectorAll("[data-calc]").forEach(function (calc) {
    var formula = calc.getAttribute("data-calc");
    var out = calc.querySelector("[data-out]");
    var inputs = calc.querySelectorAll("input[type=range]");
    var usd = calc.getAttribute("data-currency") === "usd";
    var fmt = new Intl.NumberFormat(usd ? "en-US" : "nb-NO");
    function update() {
      var v = {};
      inputs.forEach(function (i) {
        v[i.name] = Number(i.value);
        var label = calc.querySelector('[data-val="' + i.name + '"]');
        if (label) label.textContent = (i.dataset.pre || "") + fmt.format(i.value) + (i.dataset.unit || "");
      });
      var result = 0;
      if (formula === "hours") result = v.people * v.hours * v.rate * 46; // 46 arbeidsuker
      if (formula === "locations") result = v.locations * v.customers * v.value * 12;
      if (formula === "deal") result = v.deals * v.value;
      if (formula === "agency") result = v.agency * 12 + v.tools * 12;
      out.textContent = usd ? "$" + fmt.format(Math.round(result)) : fmt.format(Math.round(result)) + " kr";
    }
    inputs.forEach(function (i) { i.addEventListener("input", update); });
    update();
  });

  // ---------- Søknadsskjema ----------
  var form = document.querySelector("form[data-apply]");
  if (!form) return;
  var en = document.documentElement.lang === "en";
  var T = en
    ? { next: "Please complete the fields above to continue.", send: "Please complete the fields above to submit.", sending: "Sending…", submit: "Submit application", fail: "Something went wrong", retry: ". Please try again or email us.", thanks: "/en/thanks/" }
    : { next: "Fyll ut feltene over for å gå videre.", send: "Fyll ut feltene over for å sende.", sending: "Sender…", submit: "Send søknad", fail: "Noe gikk galt", retry: ". Prøv igjen, eller send oss en e-post.", thanks: "/takk/" };
  var steps = form.querySelectorAll(".step");
  var bars = form.querySelectorAll(".steps i");
  var err = form.querySelector(".err");
  var idx = 0;

  function show(i) {
    steps.forEach(function (s, n) { s.classList.toggle("on", n === i); });
    bars.forEach(function (b, n) { b.classList.toggle("on", n <= i); });
    var last = i === steps.length - 1;
    form.querySelector("[data-prev]").style.visibility = i === 0 ? "hidden" : "visible";
    form.querySelector("[data-next]").style.display = last ? "none" : "";
    form.querySelector("[data-submit]").style.display = last ? "" : "none";
    idx = i;
  }
  function valid(step) {
    var ok = true;
    step.querySelectorAll("[required]").forEach(function (el) {
      if (el.type === "radio") {
        if (!step.querySelector('input[name="' + el.name + '"]:checked')) ok = false;
      } else if (!el.value.trim() || (el.type === "email" && !/^\S+@\S+\.\S+$/.test(el.value))) ok = false;
    });
    return ok;
  }
  form.addEventListener("click", function (e) {
    var t = e.target;
    if (t.matches("[data-next]")) {
      e.preventDefault();
      if (!valid(steps[idx])) { err.textContent = T.next; return; }
      err.textContent = "";
      show(Math.min(idx + 1, steps.length - 1));
      form.scrollIntoView({ behavior: "smooth", block: "start" });
    }
    if (t.matches("[data-prev]")) { e.preventDefault(); err.textContent = ""; show(Math.max(idx - 1, 0)); }
  });
  form.addEventListener("submit", function (e) {
    e.preventDefault();
    if (idx < steps.length - 1) { form.querySelector("[data-next]").click(); return; } // Enter i et felt = neste steg
    if (!valid(steps[idx])) { err.textContent = T.send; return; }
    var btn = form.querySelector("[type=submit]");
    btn.disabled = true; var label = btn.textContent; btn.textContent = T.sending;
    var data = Object.fromEntries(new FormData(form).entries());
    data.page = location.pathname;
    data.utm = location.search;
    fetch(form.action, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(data) })
      .then(function (r) { return r.json().catch(function () { return {}; }).then(function (j) { return { ok: r.ok, j: j }; }); })
      .then(function (res) {
        if (!res.ok) throw new Error(res.j.error || T.fail);
        location.href = res.j.redirect || T.thanks;
      })
      .catch(function (x) {
        err.textContent = x.message + T.retry;
        btn.disabled = false; btn.textContent = label;
      });
  });
  show(0);
})();
