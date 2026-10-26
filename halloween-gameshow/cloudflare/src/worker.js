// Spøkelsesshowet på Cloudflare.
// Worker: kobler WebSockets til et rom. Storskjermen (/) og mobilsiden (/spill) er statiske filer.
// Room (Durable Object): ett per romkode. Storskjermen er sjefen; telefonene buzzer og stemmer.

const CODE_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ"; // uten I og O, så koden er lett å lese

export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    if (url.pathname === "/api/ping") return json({ ok: true });
    if (url.pathname === "/api/new") {
      let code = "";
      for (let i = 0; i < 4; i++) code += CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)];
      return json({ code });
    }
    const m = url.pathname.match(/^\/ws\/([A-Z]{4})$/);
    if (m) {
      if (req.headers.get("Upgrade") !== "websocket") return new Response("Forventet WebSocket", { status: 426 });
      const stub = env.ROOM.get(env.ROOM.idFromName(m[1]));
      return stub.fetch(req);
    }
    return env.ASSETS.fetch(req);
  }
};

const json = (o, status = 200) => new Response(JSON.stringify(o), { status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" } });

export class Room {
  constructor(ctx, env) {
    this.ctx = ctx;
    this.env = env;
  }

  async fetch(req) {
    const url = new URL(req.url);
    const role = url.searchParams.get("role") === "host" ? "host" : "player";
    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    this.ctx.acceptWebSocket(server, [role]);
    const pid = url.searchParams.get("pid") || crypto.randomUUID();
    server.serializeAttachment({ role, pid, name: "", team: -1 });

    // Gi den nye tilkoblingen alt den trenger for å tegne seg selv
    const [teams, phase, buzz] = await Promise.all([this.get("teams", []), this.get("phase", { mode: "watch" }), this.get("buzz", null)]);
    if (role === "host") {
      this.send(server, { t: "welcome", role });
      this.send(server, { t: "roster", players: this.roster() });
      const photos = await this.ctx.storage.list({ prefix: "photo:" });
      for (const [k, data] of photos) this.send(server, { t: "photo", team: +k.split(":")[1], data });
    } else {
      this.send(server, { t: "welcome", role, pid, teams, phase, buzz });
    }
    return new Response(null, { status: 101, webSocket: client });
  }

  async webSocketMessage(ws, raw) {
    let msg;
    try { msg = JSON.parse(raw); } catch { return; }
    const me = ws.deserializeAttachment() || {};

    if (me.role === "host") {
      switch (msg.t) {
        case "teams":
          await this.ctx.storage.put("teams", msg.teams);
          this.toPlayers({ t: "teams", teams: msg.teams });
          break;
        case "phase": {
          const old = await this.get("phase", {});
          await this.ctx.storage.put("phase", msg.phase);
          // Ny buzz-nøkkel betyr nytt spørsmål: lås opp buzzeren
          if ((msg.phase.mode === "buzz" || msg.phase.buzz) && msg.phase.key !== old.key) await this.ctx.storage.put("buzz", { key: msg.phase.key, winner: null });
          const buzz = await this.get("buzz", null);
          this.toPlayers({ t: "phase", phase: msg.phase, buzz });
          break;
        }
        case "reactArm": {
          // Reaksjonstest: alle mobiler viser VENT, og etter en tilfeldig pause sender rommet GÅ.
          const key = String(msg.key), delay = Math.max(1000, Math.min(8000, +msg.delay || 3000));
          this.react = { key, goAt: null, presses: {} };
          this.toPlayers({ t: "react", key, state: "wait" });
          clearTimeout(this.reactTimer);
          this.reactTimer = setTimeout(() => {
            if (!this.react || this.react.key !== key) return;
            this.react.goAt = Date.now();
            this.toPlayers({ t: "react", key, state: "go" });
            this.toHosts({ t: "reactGo", key });
          }, delay);
          break;
        }
        case "pour":
        case "scare":
        case "flash":
          this.toPlayers(msg);
          break;
        case "clearPhotos": {
          const photos = await this.ctx.storage.list({ prefix: "photo:" });
          await this.ctx.storage.delete([...photos.keys()]);
          break;
        }
      }
      return;
    }

    // Spillere
    switch (msg.t) {
      case "join": {
        me.name = String(msg.name || "").slice(0, 24) || "Navnløs";
        me.team = Number.isInteger(msg.team) ? msg.team : -1;
        ws.serializeAttachment(me);
        this.toHosts({ t: "roster", players: this.roster() });
        break;
      }
      case "buzz": {
        if (me.team < 0) return;
        const buzz = await this.get("buzz", null);
        const phase = await this.get("phase", {});
        const canBuzz = phase.mode === "buzz" || (phase.buzz === true && phase.team !== me.team);
        if (!buzz || buzz.winner || !canBuzz || buzz.key !== phase.key) return;
        buzz.winner = { team: me.team, name: me.name, pid: me.pid, at: Date.now() };
        await this.ctx.storage.put("buzz", buzz);
        this.toHosts({ t: "buzzed", ...buzz.winner, key: buzz.key });
        this.toPlayers({ t: "buzzed", ...buzz.winner, key: buzz.key });
        break;
      }
      case "press": {
        const r = this.react;
        if (!r || r.key !== msg.key || me.team < 0 || r.presses[me.pid]) return;
        const early = !r.goAt, ms = early ? null : Date.now() - r.goAt;
        r.presses[me.pid] = true;
        this.send(ws, { t: "pressAck", key: r.key, early, ms });
        this.toHosts({ t: "pressed", key: r.key, pid: me.pid, name: me.name, team: me.team, early, ms });
        break;
      }
      case "draw":
        if (me.team < 0 || typeof msg.data !== "string" || msg.data.length > 160000 || !msg.data.startsWith("data:image/")) return;
        this.toHosts({ t: "draw", team: me.team, data: msg.data, name: me.name });
        break;
      // Mobilkasinoet: mobilen spiller selv og melder resultatet til storskjermen
      case "cres": {
        if (me.team < 0) return;
        const n = v => Math.max(0, Math.min(10, Math.round(+v || 0)));
        this.toHosts({ t: "cres", pid: me.pid, name: me.name, team: me.team, game: String(msg.game || "").slice(0, 20), text: String(msg.text || "").slice(0, 140), drink: n(msg.drink), give: n(msg.give), souls: Math.max(0, Math.min(1e6, Math.round(+msg.souls || 0))), big: !!msg.big });
        break;
      }
      case "cgive":
        if (me.team < 0 || !Number.isInteger(msg.team)) return;
        this.toHosts({ t: "cgive", pid: me.pid, name: me.name, team: me.team, to: msg.team });
        break;
      case "ccash":
        if (me.team < 0) return;
        this.toHosts({ t: "ccash", pid: me.pid, name: me.name, team: me.team, amount: Math.max(0, Math.min(1000, Math.round(+msg.amount || 0))) });
        break;
      case "vote":
        this.toHosts({ t: "vote", key: msg.key, value: msg.value, sub: msg.sub, pid: me.pid, team: me.team, name: me.name });
        break;
      case "photo": {
        if (me.team < 0 || typeof msg.data !== "string" || msg.data.length > 120000 || !msg.data.startsWith("data:image/")) return;
        await this.ctx.storage.put("photo:" + me.team, msg.data);
        this.toHosts({ t: "photo", team: me.team, data: msg.data, name: me.name });
        break;
      }
    }
  }

  async webSocketClose(ws) {
    try { ws.close(); } catch {}
    const me = ws.deserializeAttachment() || {};
    if (me.role === "player") this.toHosts({ t: "roster", players: this.roster(ws) });
  }

  async webSocketError(ws) { await this.webSocketClose(ws); }

  roster(except) {
    return this.ctx.getWebSockets("player").filter(w => w !== except).map(w => w.deserializeAttachment()).filter(a => a && a.name).map(a => ({ pid: a.pid, name: a.name, team: a.team }));
  }
  async get(k, d) { const v = await this.ctx.storage.get(k); return v === undefined ? d : v; }
  send(ws, o) { try { ws.send(JSON.stringify(o)); } catch {} }
  toPlayers(o) { const s = JSON.stringify(o); for (const w of this.ctx.getWebSockets("player")) { try { w.send(s); } catch {} } }
  toHosts(o) { const s = JSON.stringify(o); for (const w of this.ctx.getWebSockets("host")) { try { w.send(s); } catch {} } }
}
