/* VSL player: muted autoplay, "click to listen" restarts with sound, no seek bar, a progress bar
   that runs fast early, resume where they left off, CTA reveal at the pitch, 10 s heartbeats with
   a 100-bucket watched bitmap. */
(function () {
  "use strict";
  var d = document, w = window;
  function cfg() { return w.OPCFG || {}; }

  function boot() {
    var c = cfg(), v = c.video;
    var player = d.querySelector("[data-player]");
    if (!player || !v) return;
    var video = player.querySelector("video");
    var listen = player.querySelector(".listen");
    var bar = player.querySelector(".bar i");
    if (!v.src) { player.classList.add("no-src"); return; }

    player.classList.add("has-src");
    if (v.poster) video.setAttribute("poster", v.poster);
    video.src = v.src;
    video.muted = true;
    video.autoplay = true;
    video.loop = false;

    var BUCKETS = 100, bits = new Array(BUCKETS + 1).join("0").split("").map(Number);
    var played = false, unmuted = false, revealed = !!c.revealed, ctaClicked = false, lastBeat = 0, ended = false, lastT = 0;
    var duration = v.duration || 0;

    function hex() {
      var out = "";
      for (var i = 0; i < BUCKETS; i += 4) out += ((bits[i] << 3) | (bits[i + 1] << 2) | (bits[i + 2] << 1) | bits[i + 3]).toString(16);
      return out;
    }

    function beat(force) {
      var now = Date.now();
      if (!force && now - lastBeat < 10000) return;
      lastBeat = now;
      var body = JSON.stringify({ video: v.id, d: duration, p: video.currentTime || 0, b: hex(), played: played, unmuted: unmuted, cta: ctaClicked });
      if (force === "exit" && navigator.sendBeacon) { navigator.sendBeacon("/api/v", new Blob([body], { type: "application/json" })); return; }
      fetch("/api/v", { method: "POST", headers: { "content-type": "application/json" }, body: body, credentials: "same-origin", keepalive: true })
        .then(function (r) { return r.json(); })
        .then(function (j) { if (j && j.revealed) reveal(); })
        .catch(function () {});
    }

    function reveal() {
      if (revealed && !d.body.classList.contains("gated")) return;
      revealed = true;
      if (d.body.classList.contains("gated")) {
        d.body.classList.remove("gated");
        d.querySelectorAll(".reveal").forEach(function (el) { el.classList.add("fresh"); });
      }
    }

    // Runs fast early: shown progress = p^0.55.
    function paint() {
      if (!duration || !bar) return;
      var p = Math.min(1, Math.max(0, video.currentTime / duration));
      bar.style.width = (Math.pow(p, 0.55) * 100).toFixed(2) + "%";
    }

    // If the film cannot load, never keep the application locked behind it.
    video.addEventListener("error", function () { player.classList.remove("has-src"); reveal(); });
    video.addEventListener("loadedmetadata", function () { if (isFinite(video.duration) && video.duration > 0) duration = video.duration; });
    video.addEventListener("play", function () {
      if (!played) { played = true; beat(true); }
      player.classList.add("playing"); player.classList.remove("paused");
      if (ended) { ended = false; w.OP && w.OP.track("vsl_rewatch", { video: v.id }); }
    });
    video.addEventListener("pause", function () {
      if (video.ended) return;
      if (unmuted) { player.classList.add("paused"); w.OP && w.OP.track("vsl_pause", { video: v.id, at: Math.round(video.currentTime) }); beat(true); }
    });
    video.addEventListener("ended", function () { ended = true; player.classList.remove("playing"); beat(true); });
    video.addEventListener("timeupdate", function () {
      var t = video.currentTime;
      if (duration > 0 && unmuted) {
        // Only mark buckets actually played (no jumps).
        if (t >= lastT && t - lastT < 3 * Math.max(1, video.playbackRate)) {
          var a = Math.floor((lastT / duration) * BUCKETS), b = Math.floor((t / duration) * BUCKETS);
          for (var i = a; i <= b && i < BUCKETS; i++) bits[i] = 1;
        }
        lastT = t;
      }
      if (v.ctaRevealAt > 0 && unmuted && t >= v.ctaRevealAt) reveal();
      paint();
      beat(false);
    });
    video.addEventListener("ratechange", function () { w.OP && w.OP.track("vsl_speed", { video: v.id, rate: video.playbackRate }); });
    video.addEventListener("volumechange", function () { if (unmuted && video.muted) w.OP && w.OP.track("vsl_volume", { video: v.id, muted: 1 }); });

    // Muted autoplay; the overlay invites sound.
    listen.hidden = false;
    var tryPlay = video.play();
    if (tryPlay && tryPlay.catch) tryPlay.catch(function () { /* autoplay blocked: overlay stays */ });

    listen.addEventListener("click", function () {
      listen.hidden = true;
      unmuted = true;
      video.muted = false;
      // Restart with sound, or resume where they left off.
      video.currentTime = v.resume > 5 ? v.resume : 0;
      lastT = video.currentTime;
      video.play();
      beat(true);
    });

    player.addEventListener("click", function (e) {
      if (e.target === listen || listen.contains(e.target) || !unmuted) return;
      if (video.paused) video.play(); else video.pause();
    });
    player.addEventListener("dblclick", function () {
      if (player.requestFullscreen) { player.requestFullscreen().catch(function () {}); w.OP && w.OP.track("vsl_fullscreen", { video: v.id }); }
    });

    d.querySelectorAll("[data-apply]").forEach(function (a) {
      a.addEventListener("click", function () { ctaClicked = true; beat("exit"); });
    });
    d.addEventListener("visibilitychange", function () { if (d.visibilityState === "hidden") beat("exit"); });
    w.addEventListener("pagehide", function () { beat("exit"); });
  }

  if (d.readyState === "loading") d.addEventListener("DOMContentLoaded", boot); else boot();
})();
