/* Calendly embed. The browser report is only a claim; the server verifies it with Calendly. */
(function () {
  "use strict";
  var d = document, w = window;
  function boot() {
    var cfg = w.OPCFG || {};
    var box = d.querySelector("[data-cal]");
    if (!box || !cfg.embed) return;
    var frame = d.createElement("iframe");
    frame.src = cfg.embed;
    frame.title = "Pick a time";
    frame.setAttribute("loading", "eager");
    frame.setAttribute("allow", "payment");
    frame.addEventListener("load", function () { var l = box.querySelector(".cal-loading"); if (l) l.remove(); });
    box.appendChild(frame);
    var done = false;
    w.addEventListener("message", function (e) {
      var host;
      try { host = new URL(e.origin).hostname; } catch (x) { return; }
      if (!/(^|\.)calendly\.com$/.test(host)) return;
      var data = e.data || {};
      if (typeof data.event !== "string" || data.event.indexOf("calendly.") !== 0) return;
      if (data.event === "calendly.page_height" && data.payload && data.payload.height) {
        var h = parseInt(data.payload.height, 10);
        if (h > 400 && h < 3000) frame.style.height = h + "px";
      }
      if (data.event === "calendly.event_type_viewed" && w.OP) w.OP.track("booking_page_ready", {});
      if (data.event === "calendly.date_and_time_selected" && w.OP) { w.OP.track("booking_date_selected", {}); w.OP.flush(); }
      if (data.event === "calendly.event_scheduled" && !done) {
        done = true;
        var p = data.payload || {};
        fetch("/api/booking/client", {
          method: "POST", headers: { "content-type": "application/json" }, credentials: "same-origin",
          body: JSON.stringify({ event_uri: p.event && p.event.uri, invitee_uri: p.invitee && p.invitee.uri })
        }).catch(function () {}).then(function () { setTimeout(function () { location.href = "/breakout"; }, 1200); });
      }
    });
  }
  if (d.readyState === "loading") d.addEventListener("DOMContentLoaded", boot); else boot();
})();
