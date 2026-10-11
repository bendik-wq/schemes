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
| `functions/api/apply.js` | `POST /api/apply` | Tar imot søknader og sender dem til webhook |

Ingen byggesteg. Ren HTML/CSS/JS. Hver side følger VSL-strukturen: hook → video → «ikke din feil» → mekanisme → ROI-kalkulator → tidslinje → garanti → for/ikke for → FAQ → søknad i 4 steg → after-close.

## Deploy

**Alternativ A: koble GitHub i Cloudflare-dashbordet**
1. Cloudflare → Workers & Pages → Create → Pages → Connect to Git → `bendik-wq/schemes`
2. Root directory: `site` · Build command: *(tom)* · Output: `public`
3. Settings → Variables: `WEBHOOK_URL` (Zapier/Make/Slack-hook) og ev. `CALENDAR_URL` (Calendly/Cal.com)

**Alternativ B: CLI**
```bash
cd site
npx wrangler pages deploy        # bruker wrangler.toml
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
