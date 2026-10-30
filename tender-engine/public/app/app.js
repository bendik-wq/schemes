// Northbid workspace. No framework: hash routes, fetch, and escaped template strings.
(() => {
  "use strict";
  const $ = (s, el = document) => el.querySelector(s);
  const $$ = (s, el = document) => [...el.querySelectorAll(s)];
  const main = $("#main");
  const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const safeUrl = (u) => (/^https:\/\//i.test(String(u || "")) ? esc(u) : "#");
  const fmtDate = (d) => (d ? new Date(String(d).length === 10 ? d + "T12:00:00Z" : d).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }) : "–");
  const daysTo = (d) => (d ? Math.ceil((Date.parse(String(d).length === 10 ? d + "T23:59:00Z" : d) - Date.now()) / 86400000) : null);
  const eur = (n) => (n ? "€" + Number(n).toLocaleString("en-GB", { maximumFractionDigits: 0 }) : "–");
  const scoreCls = (s) => (s >= 65 ? "s-hi" : s >= 40 ? "s-mid" : "s-lo");
  const label = { no_bid: "No bid", bid: "Bid", consider: "Consider", reviewing: "Reviewing", bidding: "Bidding", submitted: "Submitted", won: "Won", lost: "Lost" };
  const STAGES = ["reviewing", "bidding", "no_bid", "submitted", "won", "lost"];
  const REQ = ["open", "comply", "partial", "deviation", "clarify", "n/a"];
  const CATS = ["technical", "commercial", "hse", "quality", "documentation", "legal", "schedule"];

  function toast(msg) {
    const t = $("#toast");
    t.textContent = msg;
    t.classList.add("show");
    clearTimeout(toast.t);
    toast.t = setTimeout(() => t.classList.remove("show"), 3200);
  }

  async function api(path, opts = {}) {
    const init = { method: opts.method || "GET", headers: { "x-nb": "1" } };
    if (opts.body instanceof FormData) init.body = opts.body;
    else if (opts.body !== undefined) { init.body = JSON.stringify(opts.body); init.headers["content-type"] = "application/json"; }
    const res = await fetch("/app/api" + path, init);
    if (res.status === 401) { showLogin(); throw new Error("Signed out"); }
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || "Request failed");
    return data;
  }

  // ---------- Auth ----------
  function showLogin() { $("#shell").hidden = true; $("#login").hidden = false; $("#login input").focus(); }
  $("#login-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    $("#login-err").textContent = "";
    const res = await fetch("/app/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ password: e.target.password.value }) });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) { $("#login-err").textContent = data.error || "Could not sign in"; return; }
    e.target.reset();
    boot();
  });
  $("#logout").addEventListener("click", async () => { await fetch("/app/logout", { method: "POST" }); showLogin(); });

  async function boot() {
    try {
      const me = await api("/me");
      $("#login").hidden = true;
      $("#shell").hidden = false;
      $("#reader-mode").textContent = me.claude ? "Claude reader on" : "Rule reader (no API key)";
      route();
    } catch { /* showLogin already ran */ }
  }

  // ---------- Router ----------
  const views = { overview, tenders, rfqs, rfq, library, profile, leads };
  async function route() {
    const [name, id] = (location.hash.slice(1) || "overview").split("/");
    const view = views[name] || overview;
    $$(".side nav a").forEach((a) => a.toggleAttribute("aria-current", a.dataset.view === (name === "rfq" ? "rfqs" : name)));
    $$(".side nav a").forEach((a) => a.getAttribute("aria-current") !== null && a.setAttribute("aria-current", "page"));
    main.innerHTML = '<p class="muted">Loading…</p>';
    try { await view(id); } catch (e) { if (e.message !== "Signed out") main.innerHTML = `<p class="err">${esc(e.message)}</p>`; }
    main.focus({ preventScroll: true });
  }
  addEventListener("hashchange", route);

  // ---------- Overview ----------
  async function overview() {
    const o = await api("/overview");
    const st = Object.fromEntries(o.stages.map((s) => [s.stage, s]));
    const n = (k) => st[k]?.n || 0;
    const decided = n("won") + n("lost");
    const empty = !o.stages.length && !o.tenders?.n && !o.library?.n;
    main.innerHTML = `
      <div class="head"><div><h1>Overview</h1><p>Bids in progress, new tenders that fit, and evidence that needs renewing.</p></div>
        <div class="row"><a class="btn small" href="#rfqs/new">New RFQ</a></div></div>
      ${empty ? `<div class="card panel" style="margin-bottom:16px"><h2>Start here</h2>
        <p>Fill in your <a href="#profile">company profile</a> and add certificates and standard answers to the <a href="#library">answer library</a>. Then paste your next RFQ.</p>
        <p class="muted small">Want to see it working first? Load a fictional subsea supplier with a sample ITT.</p>
        <button class="btn small ghost" id="demo">Load sample workspace</button></div>` : ""}
      <div class="tiles">
        <div class="card tile"><div class="k">Open bids</div><div class="v">${n("reviewing") + n("bidding")}</div></div>
        <div class="card tile"><div class="k">Submitted, awaiting result</div><div class="v">${n("submitted")}</div></div>
        <div class="card tile"><div class="k">Win rate (decided)</div><div class="v">${decided ? Math.round((n("won") / decided) * 100) + "%" : "–"}</div></div>
        <div class="card tile"><div class="k">Tenders that fit (50+)</div><div class="v">${o.tenders?.good || 0}</div></div>
        <div class="card tile"><div class="k">Evidence expiring in 60 days</div><div class="v">${o.library?.expiring || 0}</div></div>
      </div>
      <div class="grid2">
        <div class="card panel"><h2>Next deadlines</h2>${o.due.length ? `<table><tbody>${o.due.map((r) => {
          const d = daysTo(r.deadline_at);
          return `<tr class="click" data-href="#rfq/${r.id}"><td><b>${esc(r.title)}</b><div class="muted small">${esc(r.client)}</div></td>
            <td>${fmtDate(r.deadline_at)}${d != null ? `<div class="small ${d <= 5 ? "warn" : "muted"}">${d < 0 ? "passed" : d + " days"}</div>` : ""}</td><td><span class="pill ${r.stage}">${esc(label[r.stage] || r.stage)}</span></td></tr>`;
        }).join("")}</tbody></table>` : '<p class="empty">No open bids.</p>'}</div>
        <div class="card panel"><h2>Tender feeds</h2>${o.runs.length ? `<table><tbody>${o.runs.map((r) => `<tr><td>${r.source === "ted" ? "TED (EU/EEA)" : "UK Find a Tender"}</td>
          <td class="small">${esc(fmtDate(r.ran_at))}</td><td class="small">${r.error ? `<span class="warn">${esc(r.error)}</span>` : `${r.fetched} found, ${r.inserted} saved`}</td></tr>`).join("")}</tbody></table>` : '<p class="muted">Feeds run every 6 hours. Run them now from Tender watch.</p>'}
          <p class="muted small">Offer applications received: ${o.applications}</p></div>
      </div>`;
    $$("tr.click", main).forEach((tr) => tr.addEventListener("click", () => (location.hash = tr.dataset.href)));
    $("#demo")?.addEventListener("click", async (e) => {
      e.target.disabled = true; e.target.innerHTML = '<span class="spin"></span> Loading';
      const r = await api("/demo", { method: "POST" });
      location.hash = "#rfq/" + r.rfq;
    });
  }

  // ---------- Tenders ----------
  async function tenders() {
    const params = new URLSearchParams(sessionStorage.getItem("nb_tf") || "status=open&min=30");
    main.innerHTML = `
      <div class="head"><div><h1>Tender watch</h1><p>Public notices from TED (Norway, EU, EEA) and UK Find a Tender, ranked against your profile. Invite-only operator RFQs go straight to <a href="#rfqs">RFQs</a>.</p></div>
        <button class="btn small" id="refresh">Check feeds now</button></div>
      <div class="filters">
        <select id="f-status"><option value="open">Open (new, watching, pursuing)</option><option value="new">New</option><option value="watching">Watching</option><option value="pursuing">Pursuing</option><option value="dismissed">Dismissed</option></select>
        <select id="f-min"><option value="0">Any fit</option><option value="30">Fit 30+</option><option value="50">Fit 50+</option><option value="70">Fit 70+</option></select>
        <input id="f-q" type="search" placeholder="Search title, buyer, text">
      </div>
      <div class="card tablewrap" id="tlist"></div>`;
    $("#f-status").value = params.get("status") || "open";
    $("#f-min").value = params.get("min") || "30";
    $("#f-q").value = params.get("q") || "";
    const load = async () => {
      const p = new URLSearchParams({ status: $("#f-status").value, min: $("#f-min").value, q: $("#f-q").value });
      sessionStorage.setItem("nb_tf", p.toString());
      const rows = await api("/tenders?" + p);
      $("#tlist").innerHTML = rows.length ? `<table><thead><tr><th>Fit</th><th>Tender</th><th>Buyer</th><th>Deadline</th><th>Value</th><th></th></tr></thead><tbody>${rows.map((t) => {
        const d = daysTo(t.deadline_at);
        return `<tr data-id="${t.id}"><td><span class="score ${scoreCls(t.fit_score)}">${t.fit_score}</span></td>
          <td><a href="${safeUrl(t.url)}" target="_blank" rel="noopener"><b>${esc(t.title)}</b></a><div class="reasons">${esc(t.fit_reasons.join(" · "))}</div>
            <details class="small"><summary class="muted">Description</summary><p>${esc(t.description)}</p></details></td>
          <td class="small">${esc(t.buyer)}<div class="muted">${esc(t.country)} · ${t.source === "ted" ? "TED" : "Find a Tender"}</div></td>
          <td class="small">${fmtDate(t.deadline_at)}${d != null ? `<div class="${d <= 7 ? "warn" : "muted"}">${d} days</div>` : ""}</td>
          <td class="small">${eur(t.value_eur)}</td>
          <td><div class="row"><button class="btn small" data-act="rfq">Start bid</button>
            <select data-act="status" aria-label="Status">${["new", "watching", "pursuing", "dismissed"].map((s) => `<option ${s === t.status ? "selected" : ""}>${s}</option>`).join("")}</select></div></td></tr>`;
      }).join("")}</tbody></table>` : '<p class="empty">No tenders match. Widen the filters, check your profile keywords, or check the feeds now.</p>';
    };
    ["f-status", "f-min"].forEach((id) => $("#" + id).addEventListener("change", load));
    $("#f-q").addEventListener("input", () => { clearTimeout(load.t); load.t = setTimeout(load, 300); });
    $("#tlist").addEventListener("click", async (e) => {
      const b = e.target.closest("[data-act=rfq]");
      if (!b) return;
      const id = b.closest("tr").dataset.id;
      const r = await api(`/tenders/${id}/rfq`, { method: "POST" });
      toast("Bid started. Paste or upload the tender documents to read them.");
      location.hash = "#rfq/" + r.id;
    });
    $("#tlist").addEventListener("change", async (e) => {
      if (e.target.dataset.act !== "status") return;
      await api(`/tenders/${e.target.closest("tr").dataset.id}`, { method: "PATCH", body: { status: e.target.value } });
      toast("Saved");
    });
    $("#refresh").addEventListener("click", async (e) => {
      e.target.disabled = true; e.target.innerHTML = '<span class="spin"></span> Checking';
      try {
        const r = await api("/tenders/refresh", { method: "POST" });
        toast(r.runs.map((x) => `${x.source.toUpperCase()}: ${x.error ? "error" : x.fetched + " found"}`).join(" · "));
        await load();
      } finally { e.target.disabled = false; e.target.textContent = "Check feeds now"; }
    });
    await load();
  }

  // ---------- RFQ list ----------
  async function rfqs() {
    const rows = await api("/rfqs");
    main.innerHTML = `
      <div class="head"><div><h1>RFQs &amp; bids</h1><p>Every RFQ, ITT and frame agreement inquiry, from first read to won or lost.</p></div>
        <a class="btn small" href="#rfq/new">New RFQ</a></div>
      <div class="card tablewrap">${rows.length ? `<table><thead><tr><th>RFQ</th><th>Deadline</th><th>Bid score</th><th>Matrix</th><th>Stage</th></tr></thead><tbody>${rows.map((r) => {
        const d = daysTo(r.deadline_at);
        return `<tr class="click" data-href="#rfq/${r.id}"><td><b>${esc(r.title)}</b><div class="muted small">${esc(r.client)} ${r.reference ? "· " + esc(r.reference) : ""}</div></td>
          <td class="small">${fmtDate(r.deadline_at)}${d != null && ["reviewing", "bidding"].includes(r.stage) ? `<div class="${d <= 5 ? "warn" : "muted"}">${d < 0 ? "passed" : d + " days"}</div>` : ""}</td>
          <td>${r.score != null ? `<span class="score ${scoreCls(r.score)}">${r.score}</span> <span class="pill ${esc(r.rec)}">${esc(label[r.rec] || "")}</span>` : '<span class="muted small">Not read yet</span>'}</td>
          <td class="small">${r.reqs ? `${r.done}/${r.reqs} answered` : "–"}</td>
          <td><span class="pill ${r.stage}">${esc(label[r.stage] || r.stage)}</span></td></tr>`;
      }).join("")}</tbody></table>` : '<p class="empty">No RFQs yet. Start with <a href="#rfq/new">New RFQ</a>.</p>'}</div>`;
    $$("tr.click", main).forEach((tr) => tr.addEventListener("click", () => (location.hash = tr.dataset.href)));
  }

  // ---------- New RFQ / RFQ detail ----------
  async function rfq(id) {
    if (id === "new" || !id) return newRfq();
    const r = await api("/rfqs/" + id);
    const a = r.analysis;
    const lib = await api("/library");
    const sc = a?.scorecard;
    main.innerHTML = `
      <div class="head"><div><p class="small"><a href="#rfqs">← RFQs</a></p><h1>${esc(r.title)}</h1>
        <p>${esc(r.client)} ${r.reference ? "· " + esc(r.reference) : ""} · Deadline ${fmtDate(r.deadline_at)} ${r.analysed_by ? `· read by ${r.analysed_by === "claude" ? "Claude" : "rule reader"}` : ""}</p></div>
        <div class="row"><label class="small" style="display:flex;gap:8px;align-items:center">Stage <select id="stage" style="width:auto">${STAGES.map((s) => `<option value="${s}" ${s === r.stage ? "selected" : ""}>${label[s]}</option>`).join("")}</select></label>
          <a class="btn small ghost" href="/app/api/rfqs/${r.id}/matrix.csv">Export matrix (CSV)</a></div></div>
      ${a?.note ? `<div class="note">${esc(a.note)}</div>` : ""}
      <div class="card panel" style="margin-bottom:16px">
        <h2>${a ? "Re-read documents" : "Read the RFQ"}</h2>
        <p class="muted small">Upload the ITT as PDF (needs the Claude reader) or a text file, or paste the text below. Reading again rebuilds the matrix.</p>
        <div class="drop" id="drop">Drop a PDF or .txt here, or <label class="link" style="display:inline;font-weight:600">choose a file<input type="file" id="file" accept=".pdf,.txt,.md,.csv" hidden></label><div id="fname" class="small"></div></div>
        <details ${a ? "" : "open"} style="margin-top:10px"><summary class="small muted">RFQ text</summary><textarea id="src" style="min-height:180px;margin-top:8px">${esc(r.source_text)}</textarea></details>
        <div class="row" style="margin-top:12px"><button class="btn small" id="analyse">${a ? "Read again" : "Read RFQ and build matrix"}</button><span class="muted small" id="astatus"></span></div>
      </div>
      ${a ? `
      <div class="detail-top">
        <div class="card panel"><h2>Bid / no-bid</h2>
          <div class="row"><span class="score ${scoreCls(sc.overall)}" style="font-size:18px;height:34px">${sc.overall}</span><span class="pill ${sc.recommendation}">${label[sc.recommendation]}</span></div>
          <div class="gauge">${[["fit", "Scope fit"], ["capability", "Approvals"], ["compliance", "Evidence"], ["timing", "Time"], ["overall", "Overall"]].map(([k, l]) => `<div><b>${sc[k]}</b><span>${l}</span></div>`).join("")}</div>
          <ul class="tight small">${sc.reasons.map((x) => `<li>${esc(x)}</li>`).join("")}</ul>
          ${a.missing_certifications?.length ? `<p class="small"><span class="warn">Not on your profile:</span> ${a.missing_certifications.map((s) => `<span class="std">${esc(s)}</span>`).join("")}</p>` : ""}
          <p class="muted small">A guide for the go/no-go meeting, not a decision.</p></div>
        <div class="card panel"><h2>Summary</h2><p>${esc(a.summary)}</p>
          ${a.scope?.length ? `<h3 class="small">Scope</h3><ul class="tight small">${a.scope.map((x) => `<li>${esc(x)}</li>`).join("")}</ul>` : ""}
          ${a.risks?.length ? `<h3 class="small">Risks</h3><ul class="tight small">${a.risks.map((x) => `<li>${esc(x)}</li>`).join("")}</ul>` : ""}
          ${a.clarifications?.length ? `<h3 class="small">Questions for the buyer</h3><ul class="tight small">${a.clarifications.map((x) => `<li>${esc(x)}</li>`).join("")}</ul>` : ""}</div>
      </div>
      <div class="card panel" style="margin-bottom:16px">
        <div class="head" style="margin:0"><div><h2 style="margin:0">Compliance matrix</h2><p class="small">${r.requirements.length} requirements · ${r.requirements.filter((q) => q.mandatory).length} mandatory · ${r.requirements.filter((q) => q.status !== "open").length} answered. Evidence is suggested from your library; confirm every row.</p></div></div>
        <div class="filters"><select id="m-cat"><option value="">All categories</option>${CATS.map((c) => `<option>${c}</option>`).join("")}</select>
          <select id="m-status"><option value="">All statuses</option>${REQ.map((c) => `<option>${c}</option>`).join("")}</select>
          <label class="small" style="display:flex;gap:6px;align-items:center;font-weight:400"><input type="checkbox" id="m-mand" style="width:auto"> Mandatory only</label></div>
        <div class="tablewrap"><table class="matrix"><thead><tr><th>#</th><th>Clause</th><th>Requirement</th><th>Category</th><th>Status</th><th>Response / deviation</th><th>Evidence</th></tr></thead><tbody>
        ${r.requirements.map((q) => `<tr data-id="${q.id}" data-cat="${esc(q.category)}" data-status="${esc(q.status)}" data-m="${q.mandatory}">
          <td class="muted small">${q.seq}</td><td class="mono small">${esc(q.clause)}</td>
          <td class="req">${esc(q.text)}${q.mandatory ? "" : ' <span class="pill">optional</span>'}<div>${q.standards.map((s) => `<span class="std">${esc(s)}</span>`).join("")}</div></td>
          <td><select data-f="category">${CATS.map((c) => `<option ${c === q.category ? "selected" : ""}>${c}</option>`).join("")}</select></td>
          <td><select data-f="status">${REQ.map((c) => `<option ${c === q.status ? "selected" : ""}>${c}</option>`).join("")}</select></td>
          <td><textarea data-f="response" rows="2">${esc(q.response)}</textarea></td>
          <td><select data-f="evidence_id"><option value="">–</option>${lib.map((l) => `<option value="${l.id}" ${l.id === q.evidence_id ? "selected" : ""}>${esc(l.title)}</option>`).join("")}</select></td></tr>`).join("")}
        </tbody></table></div></div>
      ${a.cover_letter ? `<div class="card panel"><h2>Cover letter draft</h2><p class="muted small">Check every fact and fill the [placeholders] before sending.</p><div class="letter">${esc(a.cover_letter)}</div>
        <button class="btn small ghost" id="copy" style="margin-top:10px">Copy</button></div>` : ""}` : ""}
      <p style="margin-top:20px"><button class="link" id="del" style="color:var(--red)">Delete this RFQ</button></p>`;

    let file = null;
    const drop = $("#drop");
    const setFile = (f) => { file = f; $("#fname").textContent = f ? `${f.name} (${Math.round(f.size / 1024)} KB)` : ""; };
    $("#file").addEventListener("change", (e) => setFile(e.target.files[0]));
    drop.addEventListener("dragover", (e) => { e.preventDefault(); drop.classList.add("over"); });
    drop.addEventListener("dragleave", () => drop.classList.remove("over"));
    drop.addEventListener("drop", (e) => { e.preventDefault(); drop.classList.remove("over"); setFile(e.dataTransfer.files[0]); });
    $("#analyse").addEventListener("click", async (e) => {
      e.target.disabled = true; e.target.innerHTML = '<span class="spin"></span> Reading';
      $("#astatus").textContent = "Long documents can take a minute or two.";
      try {
        await api("/rfqs/" + r.id, { method: "PATCH", body: { text: $("#src").value } });
        const fd = new FormData();
        if (file) fd.append("file", file);
        const res = await api(`/rfqs/${r.id}/analyse`, { method: "POST", body: fd });
        toast(`${res.requirements} requirements found`);
        route();
      } catch (err) { toast(err.message); e.target.disabled = false; e.target.textContent = "Try again"; $("#astatus").textContent = ""; }
    });
    $("#stage").addEventListener("change", async (e) => { await api("/rfqs/" + r.id, { method: "PATCH", body: { stage: e.target.value } }); toast("Stage saved"); });
    $("#del").addEventListener("click", async () => { if (confirm("Delete this RFQ and its matrix?")) { await api("/rfqs/" + r.id, { method: "DELETE" }); location.hash = "#rfqs"; } });
    $("#copy")?.addEventListener("click", () => navigator.clipboard.writeText(a.cover_letter).then(() => toast("Copied")));
    const tbody = $(".matrix tbody");
    if (tbody) {
      tbody.addEventListener("change", async (e) => {
        const f = e.target.dataset.f;
        if (!f) return;
        const tr = e.target.closest("tr");
        await api("/requirements/" + tr.dataset.id, { method: "PATCH", body: { [f]: e.target.value } });
        if (f === "status") tr.dataset.status = e.target.value;
        toast("Saved");
      });
      const filt = () => {
        const c = $("#m-cat").value, s = $("#m-status").value, m = $("#m-mand").checked;
        $$("tr", tbody).forEach((tr) => { tr.hidden = (c && tr.dataset.cat !== c) || (s && tr.dataset.status !== s) || (m && tr.dataset.m !== "1"); });
      };
      ["m-cat", "m-status", "m-mand"].forEach((id) => $("#" + id).addEventListener("change", filt));
    }
  }

  function newRfq() {
    main.innerHTML = `
      <div class="head"><div><p class="small"><a href="#rfqs">← RFQs</a></p><h1>New RFQ</h1><p>From an operator portal (Ariba, Ivalua, SISCommerce), a contractor, or email.</p></div></div>
      <form class="card form" id="nf">
        <label>Title <input name="title" placeholder="e.g. Hydraulic torque tools, frame agreement" required maxlength="200"></label>
        <div class="two"><label>Buyer <input name="client" maxlength="160"></label><label>Reference <input name="reference" maxlength="80"></label></div>
        <div class="two"><label>Deadline <input type="date" name="deadline_at"></label><label>Estimated value (EUR) <input type="number" name="value_eur" min="0" step="1000"></label></div>
        <label>RFQ text <span class="hint">Paste the inquiry, or leave empty and upload the PDF on the next screen.</span><textarea name="text"></textarea></label>
        <div><button class="btn" type="submit">Create</button></div>
      </form>`;
    $("#nf").addEventListener("submit", async (e) => {
      e.preventDefault();
      const body = Object.fromEntries(new FormData(e.target));
      const r = await api("/rfqs", { method: "POST", body });
      location.hash = "#rfq/" + r.id;
    });
  }

  // ---------- Library ----------
  async function library() {
    const items = await api("/library");
    const soon = (d) => d && Date.parse(d) < Date.now() + 60 * 86400000;
    main.innerHTML = `
      <div class="head"><div><h1>Answer library</h1><p>Approved answers and evidence: certificates, HSE statistics, NORSOK Z-018 documentation, Transparency Act statement, standard terms. The reader links these to requirements.</p></div>
        <button class="btn small" id="add">Add entry</button></div>
      <div id="editor"></div>
      <div class="lib-list">${items.length ? items.map((l) => `<div class="card lib-item" data-id="${l.id}">
        <div class="row" style="justify-content:space-between"><b>${esc(l.title)}</b><span class="row"><span class="pill">${esc(l.category)}</span>
          ${l.expires_at ? `<span class="small ${soon(l.expires_at) ? "warn" : "muted"}">expires ${fmtDate(l.expires_at)}</span>` : ""}
          <button class="link small" data-act="edit">Edit</button><button class="link small" data-act="del" style="color:var(--red)">Delete</button></span></div>
        <div>${l.tags.map((t) => `<span class="std">${esc(t)}</span>`).join("")}</div>
        <div class="body">${esc(l.body)}</div></div>`).join("") : '<p class="empty card">Empty. Add your certificates and the answers you paste into every bid.</p>'}</div>`;
    const edit = (l = {}) => {
      $("#editor").innerHTML = `<form class="card form" id="lf" style="margin-bottom:16px">
        <div class="two"><label>Title <input name="title" required value="${esc(l.title)}"></label>
          <label>Category <select name="category">${CATS.map((c) => `<option ${c === l.category ? "selected" : ""}>${c}</option>`).join("")}</select></label></div>
        <div class="two"><label>Tags <span class="hint">comma separated, include standards like NORSOK S-006</span><input name="tags" value="${esc((l.tags || []).join(", "))}"></label>
          <label>Expires <span class="hint">for certificates</span><input type="date" name="expires_at" value="${esc(l.expires_at || "")}"></label></div>
        <label>Answer text <textarea name="body" required>${esc(l.body)}</textarea></label>
        <div class="row"><button class="btn small" type="submit">Save</button><button class="btn small ghost" type="button" id="cancel">Cancel</button></div></form>`;
      $("#cancel").onclick = () => ($("#editor").innerHTML = "");
      $("#lf").onsubmit = async (e) => {
        e.preventDefault();
        const body = Object.fromEntries(new FormData(e.target));
        await api(l.id ? "/library/" + l.id : "/library", { method: l.id ? "PUT" : "POST", body });
        toast("Saved"); library();
      };
      $("#lf input").focus();
    };
    $("#add").onclick = () => edit();
    main.querySelector(".lib-list").addEventListener("click", async (e) => {
      const act = e.target.dataset.act;
      if (!act) return;
      const id = Number(e.target.closest(".lib-item").dataset.id);
      if (act === "edit") edit(items.find((x) => x.id === id));
      if (act === "del" && confirm("Delete this entry?")) { await api("/library/" + id, { method: "DELETE" }); library(); }
    });
  }

  // ---------- Profile ----------
  async function profile() {
    const p = await api("/profile");
    const list = (a) => esc((a || []).join(", "));
    main.innerHTML = `
      <div class="head"><div><h1>Company profile</h1><p>Drives the tender fit score and the approvals check on every RFQ.</p></div></div>
      <form class="card form" id="pf">
        <label>Company <input name="company" value="${esc(p.company)}"></label>
        <label>What you do <span class="hint">two or three sentences, used by the reader and in cover letters</span><textarea name="summary">${esc(p.summary)}</textarea></label>
        <div class="two"><label>Keywords <span class="hint">products and services, comma separated</span><input name="keywords" value="${list(p.keywords)}"></label>
          <label>Exclude <span class="hint">words that mean "not for us"</span><input name="exclude_keywords" value="${list(p.exclude_keywords)}"></label></div>
        <label>Certifications and approvals held <span class="hint">e.g. ISO 9001:2015, NORSOK S-006, Magnet JQS, ATEX, DNV type approval</span><input name="certifications" value="${list(p.certifications)}"></label>
        <div class="two"><label>CPV code prefixes <span class="hint">e.g. 4291, 7652 (shorter prefix = wider net)</span><input name="cpv" value="${list(p.cpv)}"></label>
          <label>Buyer countries <span class="hint">ISO-3 codes: NOR, GBR, DNK, NLD</span><input name="countries" value="${list(p.countries)}"></label></div>
        <label style="max-width:320px">Minimum contract size (EUR) <input type="number" name="min_value_eur" min="0" step="1000" value="${p.min_value_eur || 0}"></label>
        <div><button class="btn" type="submit">Save and re-rank tenders</button></div>
      </form>`;
    $("#pf").addEventListener("submit", async (e) => {
      e.preventDefault();
      const f = Object.fromEntries(new FormData(e.target));
      const split = (s) => String(s).split(",").map((x) => x.trim()).filter(Boolean);
      const r = await api("/profile", { method: "PUT", body: { ...f, keywords: split(f.keywords), exclude_keywords: split(f.exclude_keywords), certifications: split(f.certifications), cpv: split(f.cpv), countries: split(f.countries).map((c) => c.toUpperCase()), min_value_eur: Number(f.min_value_eur) || 0 } });
      toast(`Saved. ${r.rescored} tenders re-ranked.`);
    });
  }

  // ---------- Offer applications ----------
  async function leads() {
    const rows = await api("/applications");
    main.innerHTML = `
      <div class="head"><div><h1>Offer applications</h1><p>From the Northbid offer page. A = book a call now, B = book after a look at the walkthrough, C = not a fit yet.</p></div></div>
      <div class="card tablewrap">${rows.length ? `<table><thead><tr><th>Tier</th><th>Name</th><th>Company</th><th>Revenue</th><th>RFQs / month</th><th>Timeline</th><th>Pain</th><th>Received</th></tr></thead><tbody>${rows.map((r) => `<tr>
        <td><span class="pill ${r.tier === "A" ? "won" : r.tier === "B" ? "bidding" : ""}">${esc(r.tier)}</span></td>
        <td>${esc(r.name)}<div class="small"><a href="mailto:${esc(r.email)}">${esc(r.email)}</a> ${esc(r.phone)}</div></td><td>${esc(r.company)}<div class="muted small">${esc(r.answers.role)}</div></td>
        <td class="small">${esc(r.answers.revenue)}</td><td class="small">${esc(r.answers.rfqs)}</td><td class="small">${esc(r.answers.timeline)}</td>
        <td class="small">${esc(r.answers.pain)}</td><td class="small">${fmtDate(r.created_at)}</td></tr>`).join("")}</tbody></table>` : '<p class="empty">No applications yet.</p>'}</div>`;
  }

  boot();
})();
