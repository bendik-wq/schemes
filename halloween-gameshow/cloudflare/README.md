# Spøkelsesshowet på Cloudflare

Storskjermen ligger på `/`, mobilsiden for gjestene på `/spill?rom=KODE`.
Et Durable Object per romkode holder styr på telefonene og hvem som buzzet først.

- `../index.html` er spillets eneste kildefil. `build.mjs` pakker den inn til `public/index.html`.
- `public/spill.html` er mobilsiden.
- `src/worker.js` er Worker og rom.

Publisering (krever `CLOUDFLARE_API_TOKEN` og `CLOUDFLARE_ACCOUNT_ID` i miljøet):

```sh
npm install
npm run deploy
```

Lokalt: `npm run dev`, åpne http://127.0.0.1:8787.
