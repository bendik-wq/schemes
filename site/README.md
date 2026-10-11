# Landingssider (Cloudflare Pages)

Norske sider (`/`) for Bergen-tilbudene, engelske (`/en/`) for de tre globale flaggskipstilbudene i `offers/flagship-3-offers.md`.

| Side | URL | Tilbud |
|---|---|---|
| `public/ai-ansatte/` | `/ai-ansatte/` | #3 AI-ansatte i drift på 90 dager (fra 480k) |
| `public/ki-synlighet/` | `/ki-synlighet/` | #1 KI-Synlighet Enterprise (fra 320k) |
| `public/founder-content/` | `/founder-content/` | #2 Founder Content Engine (fra 32k/mnd) |
| `public/takk/` | `/takk/` | Takkeside / book møte |
| `public/en/authority/` | `/en/authority/` | Authority Engine, organic content (from $3k/mo) |
| `public/en/founder-build/` | `/en/founder-build/` | Founder Build Program, Claude Code for founders ($30k) |
| `public/en/executive-health/` | `/en/executive-health/` | Executive Health Office (from $30k/yr) |
| `public/en/thanks/` | `/en/thanks/` | Engelsk takkeside |
| `public/en/strength-span/` | `/en/strength-span/` | Strength Span: longevity, mobility, strength ($30k/yr) |
| `functions/api/claude.js` | `POST /api/claude` | Claude-generatorer: hooks, byggeplan, healthspan-snapshot |
| `functions/api/apply.js` | `POST /api/apply` | Tar imot søknader og sender dem til webhook |

Ingen byggesteg. Ren HTML/CSS/JS. Hver side følger VSL-strukturen: hook → video → «ikke din feil» → mekanisme → ROI-kalkulator → tidslinje → garanti → for/ikke for → FAQ → søknad i 4 steg → after-close.

## Live

**https://asym-offers.pages.dev** (Cloudflare Pages-prosjekt `asym-offers`, deployet med `wrangler pages deploy`).

Secrets som må settes (Cloudflare → Workers & Pages → asym-offers → Settings → Variables and Secrets, eller `npx wrangler pages secret put NAVN`):
- `ANTHROPIC_API_KEY`: Claude API-nøkkel for generatorene (modell `claude-opus-5-5`, effort `low`, fallback `default`)
- `WEBHOOK_URL`: hvor søknader og leads sendes (Zapier, Make, Slack, CRM)
- `CALENDAR_URL` (valgfri): booking-link for kvalifiserte

Anbefalt: bind et KV-namespace som `LEADS`, så aktiveres rate limiting (5 AI-generasjoner per IP per time). Vurder også Cloudflare Turnstile på generatorene før dere kjører annonser.

## Deploy

**Alternativ A: koble GitHub i Cloudflare-dashbordet**
1. Cloudflare → Workers & Pages → Create → Pages → Connect to Git → `bendik-wq/schemes`
2. Root directory: `site` · Build command: *(tom)* · Output: `public`
3. Settings → Variables: `WEBHOOK_URL` (Zapier/Make/Slack-hook) og ev. `CALENDAR_URL` (Calendly/Cal.com)

**Alternativ B: CLI**
```bash
cd site
npm install
npx wrangler pages deploy --branch main   # bruker wrangler.toml (prosjekt asym-offers)
npx wrangler pages secret put WEBHOOK_URL
```

## Før lansering
- [ ] Bytt «Asym» til riktig merkenavn hvis ønskelig (søk og erstatt)
- [ ] Spill inn VSL-ene (manus: `copy/`) og lim inn embed-koden i `<div class="vsl">` (Cloudflare Stream eller Vimeo)
- [ ] Sett `WEBHOOK_URL`. Uten den svarer skjemaet med en feilmelding.
- [ ] Les gjennom priser og garantivilkår og lenk til fullstendige vilkår
- [ ] Legg inn Meta Pixel / CAPI og analytics (Cloudflare Web Analytics er gratis)
- [ ] Legg til personvernerklæring (påkrevd når vi samler inn personopplysninger)

## Kvalifisering
`apply.js` merker et lead som `qualified` når omsetningen er 20 MNOK+ og svaret på «klar til å starte» ikke er «nei». Kvalifiserte sendes til kalenderen (`CALENDAR_URL`). De andre får «vi tar kontakt».
