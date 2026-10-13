/* Calendly embed, reusable: OPBook.mount(container, embedUrl). Used on /book and under the video on /breakout.
   The browser report is only a claim; the server verifies it with Calendly. If no sign of life comes from
   Calendly within 12 s, a calm fallback offers a new tab or WhatsApp (tracked as booking_embed_failed). */
(function () {
  "use strict";
  var d = document, w = window;
  var FAIL_MS = 12000;
  function track(n, p) { try { if (w.OP) w.OP.track(n, p || {}); } catch (e) {} }

  function el(tag, attrs, text) {
    var e = d.createElement(tag);
    for (var k in attrs || {}) e.setAttribute(k, attrs[k]);
    if (text) e.textContent = text;
    return e;
  }

  function mount(box, embedUrl) {
    if (!box || !embedUrl || box._opMounted) return null;
    box._opMounted = true;
    var cfg = w.OPCFG || {};
    var frame = d.createElement("iframe");
    frame.src = embedUrl;
    frame.title = "Pick a time for your call";
    frame.setAttribute("loading", "eager");
    box.appendChild(frame);

    var alive = false, done = false, failed = false;
    function clearLoading() { var l = box.querySelector(".cal-loading"); if (l) l.remove(); }
    frame.addEventListener("load", clearLoading);

    var timer = setTimeout(function () {
      if (alive) return;
      failed = true;
      track("booking_embed_failed", { page: location.pathname });
      clearLoading();
      var note = el("div", { class: "cal-fail", role: "status" });
      note.appendChild(el("p", {}, "The calendar didn't load."));
      var p = el("p");
      var open = el("a", { href: embedUrl, target: "_blank", rel: "noopener" }, "Open it in a new tab");
      p.appendChild(open);
      if (cfg.wa) {
        p.appendChild(d.createTextNode(" or "));
        p.appendChild(el("a", { href: cfg.wa }, "message us on WhatsApp"));
      }
      p.appendChild(d.createTextNode("."));
      note.appendChild(p);
      box.parentNode.insertBefore(note, box.nextSibling);
    }, FAIL_MS);

    w.addEventListener("message", function (e) {
      if (e.source !== frame.contentWindow) return;
      var host;
      try { host = new URL(e.origin).hostname; } catch (x) { return; }
      if (!/(^|\.)calendly\.com$/.test(host)) return;
      var data = e.data || {};
      if (typeof data.event !== "string" || data.event.indexOf("calendly.") !== 0) return;
      if (!alive) { alive = true; clearTimeout(timer); clearLoading(); if (failed) { var n = box.parentNode.querySelector(".cal-fail"); if (n) n.remove(); } }
      if (data.event === "calendly.page_height" && data.payload && data.payload.height) {
        var h = parseInt(data.payload.height, 10);
        if (h > 400 && h < 3000) frame.style.height = h + "px";
      }
      if (data.event === "calendly.event_type_viewed") track("booking_page_ready", {});
      if (data.event === "calendly.date_and_time_selected") { track("booking_date_selected", {}); if (w.OP) w.OP.flush(); }
      if (data.event === "calendly.event_scheduled" && !done) {
        done = true;
        var p = data.payload || {};
        fetch("/api/booking/client", {
          method: "POST", headers: { "content-type": "application/json" }, credentials: "same-origin",
          body: JSON.stringify({ event_uri: p.event && p.event.uri, invitee_uri: p.invitee && p.invitee.uri })
        }).catch(function () {}).then(function () { setTimeout(function () { location.href = "/breakout"; }, 1200); });
      }
    });
    return frame;
  }

  w.OPBook = { mount: mount };

  function boot() {
    var cfg = w.OPCFG || {};
    var box = d.querySelector("[data-cal]");
    if (box && cfg.embed) mount(box, cfg.embed);
  }
  if (d.readyState === "loading") d.addEventListener("DOMContentLoaded", boot); else boot();
})();
