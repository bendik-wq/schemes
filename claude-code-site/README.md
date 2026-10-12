# Operator: Claude Code for grunnleggere og bedrifter

Live: **https://operator-claude-code.pages.dev** (EN) · **https://operator-claude-code.pages.dev/no/** (NO)
Tilbud og prising: `../offers/claude-code-operator.md`

## Struktur
- `build.py`: genererer EN + NO + takkesider fra én mal. **Rediger tekst her**, kjør `python3 build.py`.
- `public/assets/op.css` / `op.js`: design (shine-knapp, VSL-ramme, reveal), kalkulator, søknadsskjema i 5 steg, Claude-byggeplan.
- `functions/api/apply.js`: søknader → `WEBHOOK_URL`. Kvalifiserte (EN $1M+, NO 10 MNOK+) sendes til `CALENDAR_URL`.
- `functions/api/claude.js`: byggeplan-generator via Claude API (`claude-opus-5-5`, svarer på norsk når `lang=no`).

## Secrets (Cloudflare → operator-claude-code → Settings → Variables and Secrets)
- `ANTHROPIC_API_KEY`: påkrevd for generatoren
- `WEBHOOK_URL`: påkrevd for søknadsskjemaet
- `CALENDAR_URL`: booking-link (valgfri)

## Deploy
```bash
npm install
python3 build.py
npx wrangler pages deploy --branch main
```

## Før lansering
- [ ] Lim inn VSL-video (Cloudflare Stream / Vimeo) i `.vsl .inner` i `build.py`
- [ ] Sett secrets over
- [ ] Meta Pixel + CAPI (med samtykke-banner for EU/Norge)
- [ ] Skriftlige garantivilkår (7 dager + byggegaranti) og personvernerklæring
