# SEO- og annonseskills fra AgriciDaniel: slik leverer vi Bergen Synlighet

Kilde: https://github.com/AgriciDaniel (73 repoer). Alle er MIT-lisensiert og åpen kildekode.

Installasjon i Claude Code:
```
/plugin marketplace add AgriciDaniel/claude-seo
/plugin install claude-seo@agricidaniel-claude-seo
/plugin marketplace add AgriciDaniel/claude-ads
/plugin install claude-ads@ai-marketing-hub-claude-ads
```

## De relevante repoene

| Repo | ⭐ | Hva | Bruk hos oss |
|---|---|---|---|
| **claude-seo** | 18.7k | 26 SEO-skills + 19 agenter: teknisk, E-E-A-T, schema, **GEO/KI-søk**, **lokal SEO** | KI-synlighetstest + månedlig levering |
| **claude-ads** | 9.9k | Annonseskills for 12 plattformer (Meta, Google, TikTok, YouTube…): audit, oppretting, kreativ, landingsside | Del 2 av Synlighetsmotoren |
| jev-seo | 551 | SEO-audit fra én URL, med rapport i PDF/XLSX/MD | Pen PDF-rapport til salgssamtalen |
| local-competitor-map | 40 | KI-analyse av lokale konkurrenter på Google 3D-kart | «Se konkurrentene dine på kartet» på samtalen |
| keywordpro | 260 | Søkeordsanalyse lokalt, med eksport | Manus-ideer: hva spør folk i Bergen om? |
| claude-blog | 2.4k | Blogg-skill (30 sub-skills) | Gjøre videoer om til artikler for KI-synlighet |
| youtube-scout / you2betoblog | 60 / 32 | YouTube-research og fra video til blogg | Gjenbruk av innhold |
| all-profile | 22 | Audit og oppsett av sosiale profiler | Uke 1-oppsett |

## Kobling: VSL-løfte → skill

| Løfte i VSL-en | Kommando |
|---|---|
| **Gratis KI-synlighetstest** før samtalen | `/seo geo <url>` + `/seo local <url>` (+ `jev-seo` for PDF) |
| «Hva gjør de tre største konkurrentene dine?» | `/seo competitor-pages <url>`, `local-competitor-map` |
| Del 1: manus basert på kundenes spørsmål | `/seo content-brief "<tjeneste> Bergen"`, `/seo cluster`, keywordpro |
| Del 2: annonser i Bergen | `/ads plan`, `/ads create`, `/ads meta`, `/ads launch --draft`, `/ads monitor` |
| Del 3: bli anbefalt av ChatGPT | `/seo geo`, `/seo schema` (LocalBusiness), `/seo local` (Google-profil, NAP, anmeldelser), `/seo agentic` |
| Månedlig rapport | `/seo drift compare <url>`, `/ads report` |
| Landingssiden vår | `/seo page`, `/ads validate` |

## Salgssamtale-flyt (30 min)
1. Kjør `/seo geo` + `/seo local` på prospektets URL kvelden før, og eksporter PDF.
2. Spør ChatGPT live på skjermen: «Hvem er beste [bransje] i Bergen?» og vis svaret.
3. Gå gjennom 3 funn fra rapporten. Ikke mer.
4. Presenter Synlighetsmotoren og garantien, og gi tilbudet.

⚠️ Google-verktøyet (`/seo google`) og DataForSEO-utvidelsen krever egne nøkler. Monid har også DataForSEO-endepunkter (se `tools/`).
