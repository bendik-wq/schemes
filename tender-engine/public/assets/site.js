// Offer page application: one question per screen, validated, posted to /api/apply.
(() => {
  const form = document.getElementById("apply-form");
  if (!form) return;
  const steps = [...form.querySelectorAll(".q")];
  const bar = document.getElementById("bar");
  const stepno = document.getElementById("stepno");
  const err = document.getElementById("apply-err");
  const back = document.getElementById("back");
  const next = document.getElementById("next");
  let i = 0;

  const show = () => {
    steps.forEach((s, n) => (s.hidden = n !== i));
    bar.style.width = `${Math.round(((i + 1) / steps.length) * 100)}%`;
    stepno.textContent = `Step ${i + 1} of ${steps.length}`;
    back.style.visibility = i ? "visible" : "hidden";
    next.textContent = i === steps.length - 1 ? "Send application" : "Continue";
    err.textContent = "";
  };

  const valid = () => {
    const s = steps[i];
    if (i === 0) {
      const f = form.elements;
      if (f.name.value.trim().length < 2) return "Please add your name.";
      if (f.company.value.trim().length < 2) return "Please add your company.";
      if (!/^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i.test(f.email.value.trim())) return "Please add a valid work email.";
      return "";
    }
    return s.querySelector("input[type=radio]:checked") ? "" : "Please pick one.";
  };

  back.addEventListener("click", () => { if (i > 0) { i--; show(); } });

  // Picking an option moves on by itself, except on the last step.
  form.addEventListener("change", (e) => {
    if (e.target.type === "radio" && i < steps.length - 1) setTimeout(() => { i++; show(); steps[i].querySelector("input")?.focus(); }, 180);
  });

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const problem = valid();
    if (problem) { err.textContent = problem; return; }
    if (i < steps.length - 1) { i++; show(); steps[i].querySelector("input")?.focus(); return; }
    next.disabled = true;
    const f = form.elements;
    const val = (n) => form.querySelector(`input[name=${n}]:checked`)?.value || "";
    const body = {
      name: f.name.value, email: f.email.value, phone: f.phone.value, company: f.company.value, website: f.website.value,
      answers: { role: val("role"), revenue: val("revenue"), rfqs: val("rfqs"), writer: val("writer"), qualification: val("qualification"), timeline: val("timeline"), pain: f.pain.value },
    };
    try {
      const res = await fetch("/api/apply", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
      const data = await res.json();
      if (!res.ok || !data.ok) throw new Error(data.error || "Something went wrong. Please try again.");
      steps.forEach((s) => (s.hidden = true));
      form.querySelector(".nav-btns").hidden = true;
      stepno.hidden = true;
      bar.style.width = "100%";
      const done = document.getElementById("done");
      done.hidden = false;
      const first = document.createElement("h3");
      const p = document.createElement("p");
      if (data.tier === "C") {
        first.textContent = "Thank you. We have your answers.";
        p.textContent = "From what you told us, an install may be early for you right now. Start by keeping your certificates and standard answers in one place, and apply again when your RFQ volume grows.";
        done.append(first, p);
      } else {
        first.textContent = "Thank you. Let's look at one of your RFQs.";
        p.textContent = "Pick a time for a 30-minute call. Bring a recent inquiry or ITT (or send it under NDA), and we'll run it through Northbid together.";
        done.append(first, p);
        if (data.booking && /^https:\/\//.test(data.booking)) {
          const a = document.createElement("a");
          a.className = "btn"; a.href = data.booking; a.target = "_blank"; a.rel = "noopener"; a.textContent = "Choose a time";
          done.append(a);
        } else {
          const q = document.createElement("p");
          q.textContent = "We'll email you within one working day with times.";
          done.append(q);
        }
      }
    } catch (e2) {
      err.textContent = e2.message;
      next.disabled = false;
    }
  });

  show();
})();
