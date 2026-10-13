/* VSL player: muted autoplay (never under reduced motion), "click to listen" restarts with sound, a visible
   pause/play control, Space/K on the focused player, optional captions, HLS via a self-hosted hls.js light
   build when the browser has no native HLS, no seek bar, a progress bar that runs fast early, resume where
   they left off, CTA reveal at the pitch, an optional soft "ready already?" link, and 10 s heartbeats with a
   100-bucket watched bitmap (the server derives vsl_25/50/75/95/complete from it). */
(function () {
  "use strict";
  var d = document, w = window;
  function cfg() { return w.OPCFG || {}; }
  function track(n, p) { try { if (w.OP) w.OP.track(n, p || {}); } catch (e) {} }

  function loadHls(cb) {
    if (w.Hls) return cb(w.Hls);
    var s = d.createElement("script");
    s.src = "/assets/hls.light.min.js" + (cfg().v ? "?v=" + encodeURIComponent(cfg().v) : "");
    s.async = true;
    s.onload = function () { cb(w.Hls || null); };
    s.onerror = function () { cb(null); };
    d.head.appendChild(s);
  }

  function boot() {
    var c = cfg(), v = c.video;
    var player = d.querySelector("[data-player]");
    if (!player || !v) return;
    var video = player.querySelector("video");
    var listen = player.querySelector(".listen");
    var listenLabel = player.querySelector(".listen-label");
    var pp = player.querySelector(".pp");
    var bar = player.querySelector(".bar i");
    if (!v.src) { player.classList.add("no-src"); return; }

    var reduce = w.matchMedia && w.matchMedia("(prefers-reduced-motion: reduce)").matches;
    var label = v.label || "The film";
    player.setAttribute("aria-label", label + ". Press Space or K to play or pause.");
    video.setAttribute("aria-label", label);
    player.classList.add("has-src");
    if (v.poster) video.setAttribute("poster", v.poster);

    // Captions (WebVTT). A cross-origin track needs CORS on the video element too.
    var captionsOn = false;
    if (v.captions) {
      if (/^https:/.test(v.captions) && v.captions.indexOf(location.origin) !== 0) video.setAttribute("crossorigin", "anonymous");
      var tr = d.createElement("track");
      tr.kind = "captions"; tr.srclang = "en"; tr.label = "English"; tr.src = v.captions; tr.default = true;
      video.appendChild(tr);
      captionsOn = true;
      try {
        video.textTracks.addEventListener("change", function () {
          captionsOn = false;
          for (var i = 0; i < video.textTracks.length; i++) if (video.textTracks[i].mode === "showing") captionsOn = true;
        });
      } catch (e) {}
    }

    video.muted = true;
    video.loop = false;
    video.autoplay = !reduce;

    var BUCKETS = 100, bits = new Array(BUCKETS + 1).join("0").split("").map(Number);
    var played = false, unmuted = false, revealed = !!c.revealed, ctaClicked = false, lastBeat = 0, ended = false, lastT = 0;
    var duration = v.duration || 0, watchedSec = 0, softShown = false, stalls = 0, waitTimer = 0, errored = false;
    var gate = c.gate || {};
    var soft = d.querySelector("[data-soft-cta]");

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
      if (soft) soft.hidden = true;
      if (revealed && !d.body.classList.contains("gated")) return;
      revealed = true;
      if (d.body.classList.contains("gated")) {
        d.body.classList.remove("gated");
        d.querySelectorAll(".reveal").forEach(function (el) { el.classList.add("fresh"); });
      }
    }

    function showSoft() {
      if (softShown || !soft || gate.mode !== "soft" || !d.body.classList.contains("gated")) return;
      softShown = true;
      soft.hidden = false;
      soft.classList.add("fresh");
    }
    if (soft) {
      soft.addEventListener("click", function (e) {
        var a = e.target.closest && e.target.closest("a");
        if (!a) return;
        e.preventDefault();
        track("vsl_soft_cta", { video: v.id, at: Math.round(video.currentTime || 0), watched: Math.round(watchedSec) });
        reveal();
        var sec = d.getElementById("apply");
        if (sec) {
          sec.scrollIntoView({ behavior: reduce ? "auto" : "smooth", block: "start" });
          var first = sec.querySelector("input, button, textarea, select");
          if (first) setTimeout(function () { first.focus({ preventScroll: true }); }, reduce ? 0 : 450);
        }
      });
    }

    // Runs fast early: shown progress = p^0.55.
    function paint() {
      if (!duration || !bar) return;
      var p = Math.min(1, Math.max(0, video.currentTime / duration));
      bar.style.width = (Math.pow(p, 0.55) * 100).toFixed(2) + "%";
    }

    function syncPP() {
      var playing = !video.paused && !video.ended;
      player.classList.toggle("playing", playing);
      if (pp) {
        pp.hidden = !played && !playing;
        pp.setAttribute("aria-label", (playing ? "Pause " : "Play ") + (v.id === "main" ? "the film" : "the video"));
      }
    }

    function fail(code) {
      if (errored) return;
      errored = true;
      track("vsl_error", { video: v.id, code: code || 0 });
      // If the film cannot load, never keep the application locked behind it.
      player.classList.remove("has-src");
      if (listen) listen.hidden = true;
      if (pp) pp.hidden = true;
      reveal();
    }

    function startWithSound() {
      if (listen) listen.hidden = true;
      unmuted = true;
      video.muted = false;
      // Restart with sound, or resume where they left off.
      try { video.currentTime = v.resume > 5 ? v.resume : 0; } catch (e) {}
      lastT = video.currentTime;
      var p = video.play();
      if (p && p.catch) p.catch(function () {});
      beat(true);
    }

    // Pause always pauses (muted autoplay included); play starts with sound the first time.
    function playPause() {
      if (!video.paused && !video.ended) { video.pause(); return; }
      if (!unmuted) { startWithSound(); return; }
      var p = video.play(); if (p && p.catch) p.catch(function () {});
    }

    video.addEventListener("error", function () { fail(video.error ? video.error.code : 0); });
    video.addEventListener("loadedmetadata", function () { if (isFinite(video.duration) && video.duration > 0) duration = video.duration; });
    video.addEventListener("play", function () {
      if (!played) { played = true; beat(true); }
      player.classList.remove("paused");
      syncPP();
      if (ended) { ended = false; track("vsl_rewatch", { video: v.id }); }
    });
    video.addEventListener("pause", function () {
      syncPP();
      if (video.ended) return;
      player.classList.add("paused");
      if (unmuted) { track("vsl_pause", { video: v.id, at: Math.round(video.currentTime) }); beat(true); }
    });
    video.addEventListener("ended", function () { ended = true; syncPP(); beat(true); });
    video.addEventListener("waiting", function () {
      if (!played || video.paused) return;
      clearTimeout(waitTimer);
      // A stall is buffering for more than 3 s mid-play; at most three are reported per page.
      waitTimer = setTimeout(function () { if (stalls < 3) { stalls++; track("vsl_stall", { video: v.id, at: Math.round(video.currentTime) }); } }, 3000);
    });
    video.addEventListener("playing", function () { clearTimeout(waitTimer); syncPP(); });
    video.addEventListener("timeupdate", function () {
      var t = video.currentTime;
      var step = t - lastT;
      var contiguous = step >= 0 && step < 3 * Math.max(1, video.playbackRate);
      if (duration > 0 && unmuted && contiguous) {
        // Only mark buckets actually played (no jumps).
        var a = Math.floor((lastT / duration) * BUCKETS), b = Math.floor((t / duration) * BUCKETS);
        for (var i = a; i <= b && i < BUCKETS; i++) bits[i] = 1;
      }
      // Soft gate: seconds actually watched, with sound or with captions showing.
      if (contiguous && (unmuted || captionsOn)) {
        watchedSec += step;
        if (gate.softAt > 0 && watchedSec >= gate.softAt) showSoft();
      }
      lastT = t;
      if (v.ctaRevealAt > 0 && unmuted && t >= v.ctaRevealAt) reveal();
      paint();
      beat(false);
    });
    video.addEventListener("ratechange", function () { track("vsl_speed", { video: v.id, rate: video.playbackRate }); });
    video.addEventListener("volumechange", function () { if (unmuted && video.muted) track("vsl_volume", { video: v.id, muted: 1 }); });

    // Source: native (MP4, or HLS on Safari/iOS), else hls.js light for .m3u8 (Cloudflare Stream).
    function attach() {
      if (v.hls && !video.canPlayType("application/vnd.apple.mpegurl")) {
        loadHls(function (Hls) {
          if (!Hls || !Hls.isSupported || !Hls.isSupported()) { fail(-1); return; }
          var hls = new Hls({ enableWorker: false, capLevelToPlayerSize: true });
          hls.on(Hls.Events.ERROR, function (_e, data) { if (data && data.fatal) { try { hls.destroy(); } catch (x) {} fail(-2); } });
          hls.loadSource(v.src);
          hls.attachMedia(video);
          if (!reduce) hls.on(Hls.Events.MANIFEST_PARSED, function () { var p = video.play(); if (p && p.catch) p.catch(function () {}); });
        });
      } else {
        video.src = v.src;
        if (!reduce) { var p = video.play(); if (p && p.catch) p.catch(function () { /* autoplay blocked: overlay stays */ }); }
      }
    }

    // The overlay invites sound (or, under reduced motion, starts the film).
    listen.hidden = false;
    if (reduce && listenLabel) listenLabel.textContent = "Play " + (v.id === "main" ? "the film" : "the video");
    attach();

    listen.addEventListener("click", function (e) { e.stopPropagation(); startWithSound(); });
    if (pp) pp.addEventListener("click", function (e) { e.stopPropagation(); playPause(); });

    player.addEventListener("click", function (e) {
      if (e.target.closest && e.target.closest("button")) return;
      if (!unmuted) startWithSound(); else playPause();
    });
    player.addEventListener("keydown", function (e) {
      if (e.target !== player || e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === " " || e.key === "Spacebar" || e.key === "k" || e.key === "K" || e.key === "Enter") { e.preventDefault(); playPause(); }
    });
    player.addEventListener("dblclick", function () {
      if (player.requestFullscreen) { player.requestFullscreen().catch(function () {}); track("vsl_fullscreen", { video: v.id }); }
    });

    d.querySelectorAll("[data-apply]").forEach(function (a) {
      a.addEventListener("click", function () { ctaClicked = true; beat("exit"); });
    });
    d.addEventListener("visibilitychange", function () { if (d.visibilityState === "hidden") beat("exit"); });
    w.addEventListener("pagehide", function () { beat("exit"); });
    // Back/forward cache: the page comes back as it was; resync the controls and the server's reveal state.
    w.addEventListener("pageshow", function (e) { if (e.persisted) { lastBeat = 0; syncPP(); if (played) beat(true); } });
  }

  if (d.readyState === "loading") d.addEventListener("DOMContentLoaded", boot); else boot();
})();
