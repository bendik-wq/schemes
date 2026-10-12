"""Operator: produktside i Apple-tradisjon (EN + NO). Kjør: python3 build.py

Struktur: hero med produktbilde (Claude Code bygger funnelen live) → fire tall → filmen (VSL) →
stort utsagn → systemene som bento → åtte uker på en tidslinje → to garantier → byggeplan (Claude API) →
for hvem + spørsmål → søknad → avslutning. Iles-posisjonering: rolig, selektiv, garantert.
"""
from pathlib import Path

HERE = Path(__file__).parent / "public"
FONTS = "https://fonts.googleapis.com/css2?family=Geist:wght@400;500;600;700&family=Geist+Mono:wght@400;500;600&display=swap"
LOGO = '<svg viewBox="0 0 20 20" aria-hidden="true"><rect x="1" y="1" width="18" height="18" rx="5.5" fill="#1d1d1f"/><circle cx="10" cy="10" r="4.2" fill="none" stroke="#fff" stroke-width="2"/><circle cx="10" cy="10" r="1.3" fill="#2997ff"/></svg>'

T = {
"en": dict(
  lang="en", home="/", other="/no/", other_label="Norsk", thanks="/thanks/",
  title="Operator", desc="We install Claude Code in your business and build your funnels, tracking, ads engine and internal tools with your team. Live in 56 days, guaranteed.",
  nav=[("#film", "Film"), ("#system", "System"), ("#weeks", "Eight weeks"), ("#faq", "FAQ")], apply="Apply",
  eyebrow="Operator for Claude Code",
  h1='Own your growth.<br><span>Stop renting it.</span>',
  sub="We install Claude Code inside your business and build your funnels, tracking, ads and internal tools with your team. Live in 56 days. Guaranteed.",
  cta="Apply for the founding cohort", watch="Watch the film",
  assure="Eight seats. One company per industry. 7-day money-back guarantee.",
  term_title="claude — operator/funnel",
  term=["Build our application funnel with Meta Conversions API and send qualified leads to HubSpot.",
        ("c", "● Reading CLAUDE.md, skills/funnels, skills/meta-capi"),
        ("c", "● Plan: landing page · 5-step application · /api/apply · CAPI events · HubSpot sync"),
        ("ok", "✓ public/index.html"), ("ok", "✓ functions/api/apply.js"), ("ok", "✓ capi: Lead, Schedule, Purchase (server-side, deduplicated)"),
        ("ok", "✓ 24 tests passed · security review clean"), ("hl", "→ Deployed to production")],
  preview_title="See if you qualify.",
  figures=[("Day 2", "Your funnel and server-side tracking are live."), ("6", "Growth systems, built inside your business."), ("56 days", "Everything in production, or we keep building free."), ("7 days", "Full refund if you're not convinced.")],
  film_k="The film", film_h='Nine minutes.<br><span>Watch before you apply.</span>',
  film_cap=("How Operator works", "From kickoff to a business that builds its own software."), sound="Sound on",
  statement='Software is now written by AI. <span>Most companies still pay agencies, developers and subscriptions to do it for them. The ones that bring it in-house will run leaner, launch faster and keep the margin.</span>',
  sys_k="The system", sys_h="Everything that drives growth.<br>Built in-house.",
  t_a=("Funnels that ship in a day.", "Video sales pages, multi-step applications, qualification and booking. Live by the end of Build Day 2."),
  t_b=("Tracking you can trust.", "Every lead, call and sale sent to Meta from your server."),
  t_c=("An ads engine.", "New hooks every week, tested and scaled on revenue."),
  t_d=("A sales command centre.", "Show-up, close rate and ROAS in one view. Claude reviews every call."),
  t_e=("Claude Code, set up right.", "Project memory, skills and guardrails your whole team uses."),
  t_f=("Software you own.", "Client portals, quoting tools and dashboards that replace subscriptions and retainers."),
  ui_track=[("Lead", "server"), ("Schedule", "server"), ("Purchase", "server")], dedup="deduplicated",
  ui_kpi=[("82%", "show-up"), ("31%", "close rate"), ("4.2×", "ROAS")], kpi_note="Illustrative",
  ui_tools=[("Client portal", "Status, documents and invoices in one place."), ("Quoting tool", "Request in, branded proposal out."), ("Weekly report", "Pulled from CRM and ERP every Monday.")],
  weeks_k="Eight weeks", weeks_h="From kickoff to running on your own.",
  weeks=[("Week 0", "We set it up", "Environment, skills, tracking accounts and deployment. Done for you."),
         ("Days 1–2", "Build Days", "Your funnel and server-side tracking go live."),
         ("Weeks 2–4", "Go-to-market", "Ads engine, lead scoring, CRM sync and sales dashboard."),
         ("Weeks 5–7", "Replace", "Your first internal tools ship. Retainers start coming down."),
         ("Week 8", "Hand-over", "Security review, documentation and a 90-day roadmap.")],
  g_k="The guarantee", g_h="We take the risk.<br><span>You keep the systems.</span>",
  g=[("7", "days", "If you're not convinced within seven days of starting, you get every cent back. No questions.", "Request in writing within 7 days of your start date."),
     ("56", "days", "Your funnel, tracking and at least two internal tools are live by day 56, or we keep building with you for free.", "Requires both Build Days and 6 of 8 weekly sessions.")],
  plan_k="Try it", plan_h="Describe one tool you wish you had.",
  plan_p="Get a two-day build plan in about twenty seconds. It runs on the Claude API, behind a function we built with Claude Code.",
  plan_f=dict(company=("Company", "40-person logistics company"), users=("Who will use it", "Sales team and 200 clients"), tool=("The tool", "A client portal with shipment status, documents and invoices"), systems=("Connects to (optional)", "HubSpot, Stripe, Google Sheets"), email=("Email", "")),
  plan_btn="Get the build plan",
  fit_h="Questions", for_h="Built for", for_l=["Companies doing $1M+ a year", "Teams spending $5k+ a month on agencies, developers or software", "Founders who want to launch and test faster than their market"],
  not_h="Not built for", not_l=["People who want to become software engineers", "Companies that want it done without being involved", "Pre-revenue ideas"],
  faq=[("What do you actually do?", "We install Claude Code in your business and build, with your team, the systems that drive growth: funnels, server-side tracking, an ads engine, a sales command centre and the internal tools you pay others for today. You own all of it."),
       ("I'm not technical. Will this work?", "Yes. You describe and review; Claude Code writes the software; our engineers review everything before it reaches production."),
       ("How is this different from an agency or a course?", "Agencies rent you their work. Courses give you videos. We build the systems with your team, inside your business, and you keep the code, the tracking and the skill to build the next one."),
       ("What does it cost?", "It depends on your size and goals, so we share pricing on the call. It's typically less than a year of agency fees, and it's covered by the 7-day guarantee."),
       ("Is what we build secure?", "Every tool gets a security review before it goes live: secrets, access control, data handling and consent for tracking."),
       ("Are you affiliated with Anthropic?", "No. Claude Code is Anthropic's product. We're an independent team that builds with it every day.")],
  ap_k="Apply", ap_h="Apply for the founding cohort.", ap_p="Five short steps. If it's a fit, you'll book a 45-minute call where we map exactly what we'll build first. If we don't see a clear return, we'll tell you.",
  ap_assure=["Two minutes", "No payment today", "7-day money-back guarantee"],
  s=[("1 of 5", "Who are you?"), ("2 of 5", "Your business"), ("3 of 5", "Your main goal"), ("4 of 5", "What would you build first?"), ("5 of 5", "Where can we reach you?")],
  f=dict(name="Full name", company="Company", website="Website", revenue="Annual revenue", spend="Monthly spend on agencies, developers and software", first="Describe it in a sentence or two", first_ph="Replace our agency's funnels and get tracking we can trust", ready="Could you start within 30 days?", email="Email", phone="Phone"),
  rev=[("0-1m", "Under $1M"), ("1m-5m", "$1M–5M"), ("5m-20m", "$5M–20M"), ("20m+", "$20M+")], spend=["Under $2k", "$2k–10k", "$10k–30k", "$30k+"],
  goal=["Cut software and agency costs", "Build a go-to-market machine", "Both"], ready=[("yes", "Yes"), ("maybe", "Depends on timing"), ("no", "Just exploring")],
  consent="We only use your details to respond to your application.", back="Back", next="Continue", submit="Submit application",
  close_h="Live in 56 days.<br><span>Guaranteed.</span>", close_p="Plus a full refund in the first seven days.",
  foot="Claude and Claude Code are trademarks of Anthropic. Operator is independent and is not affiliated with or endorsed by Anthropic. Results depend on effort, market and execution; no revenue is guaranteed. Dashboard figures are illustrative.",
  th_title="Application received", th_h="Thank you.<br><span>One step left.</span>", th_book="You look like a strong fit. Pick a time for your call and we'll hold your seat.", th_btn="Choose a time", th_wait="We'll review your application and reply within one business day.",
  th_tips=[("Add it to your calendar.", "Seats are limited, and missed calls are released."), ("We prepare.", "We review your site and funnel before the call. You keep the notes."), ("Bring your numbers.", "Agency, developer and software spend, and your revenue goals.")],
),
"no": dict(
  lang="nb", home="/no/", other="/", other_label="English", thanks="/no/takk/",
  title="Operator", desc="Vi installerer Claude Code i bedriften din og bygger funnels, sporing, annonsemotor og interne verktøy sammen med teamet ditt. I drift på 56 dager, garantert.",
  nav=[("#film", "Film"), ("#system", "System"), ("#weeks", "Åtte uker"), ("#faq", "Spørsmål")], apply="Søk",
  eyebrow="Operator for Claude Code",
  h1='Eie veksten.<br><span>Slutt å leie den.</span>',
  sub="Vi installerer Claude Code i bedriften din og bygger funnels, sporing, annonser og interne verktøy sammen med teamet ditt. I drift på 56 dager. Garantert.",
  cta="Søk om plass i founding-kullet", watch="Se filmen",
  assure="Åtte plasser. Én bedrift per bransje. 7 dager pengene tilbake.",
  term_title="claude — operator/funnel",
  term=["Bygg søknadsfunnelen vår med Meta Conversions API og send kvalifiserte leads til HubSpot.",
        ("c", "● Leser CLAUDE.md, skills/funnels, skills/meta-capi"),
        ("c", "● Plan: landingsside · søknad i 5 steg · /api/apply · CAPI-hendelser · HubSpot-synk"),
        ("ok", "✓ public/index.html"), ("ok", "✓ functions/api/apply.js"), ("ok", "✓ capi: Lead, Schedule, Purchase (server-side, deduplisert)"),
        ("ok", "✓ 24 tester grønne · sikkerhetsgjennomgang ok"), ("hl", "→ Deployet til produksjon")],
  preview_title="Se om du kvalifiserer.",
  figures=[("Dag 2", "Funnel og server-side-sporing er i drift."), ("6", "Vekstsystemer, bygget inne i bedriften."), ("56 dager", "Alt i produksjon, ellers bygger vi videre gratis."), ("7 dager", "Alle pengene tilbake om du ikke er overbevist.")],
  film_k="Filmen", film_h='Ni minutter.<br><span>Se den før du søker.</span>',
  film_cap=("Slik fungerer Operator", "Fra oppstart til en bedrift som bygger sin egen programvare."), sound="Lyd på",
  statement='Programvare skrives nå av AI. <span>De fleste bedrifter betaler fortsatt byråer, utviklere og abonnementer for å gjøre det for seg. De som tar det inn i huset, vil drive slankere, lansere raskere og beholde marginen.</span>',
  sys_k="Systemet", sys_h="Alt som driver vekst.<br>Bygget internt.",
  t_a=("Funnels i drift på én dag.", "Salgssider med video, søknader i flere steg, kvalifisering og booking. I drift innen slutten av Build Day 2."),
  t_b=("Sporing du kan stole på.", "Hvert lead, hver samtale og hvert salg sendes til Meta fra deres server."),
  t_c=("En annonsemotor.", "Nye hooks hver uke, testet og skalert på omsetning."),
  t_d=("En salgssentral.", "Oppmøte, lukkerate og ROAS i én visning. Claude går gjennom hver samtale."),
  t_e=("Claude Code, satt opp riktig.", "Prosjektminne, skills og sikkerhetsrammer hele teamet bruker."),
  t_f=("Programvare dere eier.", "Kundeportaler, tilbudsverktøy og dashboard som erstatter abonnementer og retainere."),
  ui_track=[("Lead", "server"), ("Schedule", "server"), ("Purchase", "server")], dedup="deduplisert",
  ui_kpi=[("82%", "oppmøte"), ("31%", "lukkerate"), ("4,2×", "ROAS")], kpi_note="Illustrasjon",
  ui_tools=[("Kundeportal", "Status, dokumenter og fakturaer på ett sted."), ("Tilbudsverktøy", "Forespørsel inn, ferdig tilbud ut."), ("Ukesrapport", "Hentet fra CRM og ERP hver mandag.")],
  weeks_k="Åtte uker", weeks_h="Fra oppstart til at dere driver det selv.",
  weeks=[("Uke 0", "Vi setter det opp", "Arbeidsmiljø, skills, sporingskontoer og deploy. Ferdig for dere."),
         ("Dag 1–2", "Build Days", "Funnel og server-side-sporing går live."),
         ("Uke 2–4", "Salgsmaskinen", "Annonsemotor, lead-scoring, CRM-synk og salgsdashboard."),
         ("Uke 5–7", "Erstatt", "De første interne verktøyene lanseres. Retainerne går ned."),
         ("Uke 8", "Overlevering", "Sikkerhetsgjennomgang, dokumentasjon og en 90-dagers plan.")],
  g_k="Garantien", g_h="Vi tar risikoen.<br><span>Dere beholder systemene.</span>",
  g=[("7", "dager", "Er du ikke overbevist innen sju dager etter oppstart, får du hver krone tilbake. Ingen spørsmål.", "Krav sendes skriftlig innen 7 dager etter oppstart."),
     ("56", "dager", "Funnel, sporing og minst to interne verktøy er i drift innen dag 56, ellers bygger vi videre med dere gratis.", "Forutsetter begge Build Days og 6 av 8 ukentlige økter.")],
  plan_k="Prøv selv", plan_h="Beskriv ett verktøy du skulle ønske du hadde.",
  plan_p="Få en byggeplan for to dager på rundt tjue sekunder. Den kjører på Claude API, bak en funksjon vi bygget med Claude Code.",
  plan_f=dict(company=("Bedrift", "Logistikkselskap med 40 ansatte"), users=("Hvem skal bruke det", "Salgsteamet og 200 kunder"), tool=("Verktøyet", "En kundeportal med sporing, dokumenter og fakturaer"), systems=("Kobles til (valgfritt)", "HubSpot, Tripletex, Google Sheets"), email=("E-post", "")),
  plan_btn="Få byggeplanen",
  fit_h="Spørsmål", for_h="Laget for", for_l=["Bedrifter som omsetter for 10 MNOK+ i året", "Team som bruker 50 000 kr+ i måneden på byråer, utviklere eller programvare", "Gründere som vil lansere og teste raskere enn markedet"],
  not_h="Ikke laget for", not_l=["De som vil bli utviklere", "Bedrifter som vil ha det gjort uten å være involvert", "Ideer uten omsetning"],
  faq=[("Hva gjør dere egentlig?", "Vi installerer Claude Code i bedriften din og bygger, sammen med teamet ditt, systemene som driver vekst: funnels, server-side-sporing, annonsemotor, salgssentral og de interne verktøyene dere betaler andre for i dag. Dere eier alt."),
       ("Jeg er ikke teknisk. Fungerer dette?", "Ja. Du beskriver og godkjenner, Claude Code skriver programvaren, og ingeniørene våre går gjennom alt før det går i produksjon."),
       ("Hvordan skiller dette seg fra et byrå eller et kurs?", "Byråer leier ut arbeidet sitt. Kurs gir deg videoer. Vi bygger systemene med teamet ditt, inne i bedriften, og dere beholder koden, sporingen og ferdigheten til å bygge det neste."),
       ("Hva koster det?", "Det avhenger av størrelse og mål, så vi deler prisen i samtalen. Det er typisk mindre enn ett år med byråhonorarer, og det er dekket av 7-dagersgarantien."),
       ("Er det vi bygger sikkert?", "Hvert verktøy får en sikkerhetsgjennomgang før det går live: hemmeligheter, tilgangsstyring, datahåndtering og samtykke for sporing."),
       ("Er dere tilknyttet Anthropic?", "Nei. Claude Code er Anthropics produkt. Vi er et uavhengig team som bygger med det hver dag.")],
  ap_k="Søk", ap_h="Søk om plass i founding-kullet.", ap_p="Fem korte steg. Passer det, booker du en 45-minutters samtale der vi kartlegger nøyaktig hva vi bygger først. Ser vi ikke en tydelig gevinst, sier vi det.",
  ap_assure=["To minutter", "Ingen betaling i dag", "7 dager pengene tilbake"],
  s=[("1 av 5", "Hvem er du?"), ("2 av 5", "Bedriften din"), ("3 av 5", "Hovedmålet ditt"), ("4 av 5", "Hva ville du bygget først?"), ("5 av 5", "Hvor når vi deg?")],
  f=dict(name="Fullt navn", company="Bedrift", website="Nettside", revenue="Årlig omsetning", spend="Månedlig kostnad til byråer, utviklere og programvare", first="Beskriv det med en setning eller to", first_ph="Erstatte byråets funnels og få sporing vi kan stole på", ready="Kan dere starte innen 30 dager?", email="E-post", phone="Telefon"),
  rev=[("0-10", "Under 10 MNOK"), ("10-50", "10–50 MNOK"), ("50-200", "50–200 MNOK"), ("200+", "200+ MNOK")], spend=["Under 20 000 kr", "20–100 000 kr", "100–300 000 kr", "Over 300 000 kr"],
  goal=["Kutte programvare- og byråkostnader", "Bygge en salgsmaskin", "Begge deler"], ready=[("ja", "Ja"), ("kanskje", "Avhenger av timing"), ("nei", "Bare nysgjerrig")],
  consent="Vi bruker opplysningene kun til å svare på søknaden.", back="Tilbake", next="Fortsett", submit="Send søknad",
  close_h="I drift på 56 dager.<br><span>Garantert.</span>", close_p="Pluss alle pengene tilbake de første sju dagene.",
  foot="Claude og Claude Code er varemerker for Anthropic. Operator er uavhengig og ikke tilknyttet eller godkjent av Anthropic. Resultater avhenger av innsats, marked og gjennomføring. Ingen omsetning er garantert. Tall i dashboard-eksemplene er illustrasjoner.",
  th_title="Søknad mottatt", th_h="Takk.<br><span>Ett steg igjen.</span>", th_book="Dere ser ut som en god match. Velg tidspunkt for samtalen, så holder vi av plassen.", th_btn="Velg tidspunkt", th_wait="Vi går gjennom søknaden og svarer innen én virkedag.",
  th_tips=[("Legg det i kalenderen.", "Plassene er få, og uteblir du, går plassen videre."), ("Vi forbereder oss.", "Vi går gjennom nettsiden og funnelen før samtalen. Notatene får du."), ("Ha tallene klare.", "Kostnader til byrå, utviklere og programvare, og målene for omsetning.")],
),
}


def head(t, title, noindex=False):
    robots = '<meta name="robots" content="noindex">\n' if noindex else ""
    return f'''<!doctype html>
<html lang="{t["lang"]}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>{title}</title>
{robots}<meta name="description" content="{t["desc"]}">
<meta property="og:title" content="{title}">
<meta property="og:description" content="{t["desc"]}">
<meta name="theme-color" content="#ffffff">
<link rel="alternate" hreflang="en" href="/">
<link rel="alternate" hreflang="nb" href="/no/">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="{FONTS}" rel="stylesheet">
<link rel="stylesheet" href="/assets/op.css">
<script>document.documentElement.classList.add("js")</script>
</head>
<body>
<header class="nav"><div class="wide">
  <a class="brand" href="{t["home"]}">{LOGO}Operator</a>
  <nav>{"".join(f'<a href="{h}">{l}</a>' for h, l in t["nav"])}</nav>
  <div class="end"><a class="lang" href="{t["other"]}">{t["other_label"]}</a><a class="btn sm" href="{t["home"]}#apply">{t["apply"]}</a></div>
</div></header>
'''


def li(xs): return "".join(f"<li>{x}</li>" for x in xs)


def page(t):
    lines = [f'<div class="l" style="animation-delay:.3s"><span class="p">❯ </span>{t["term"][0]}</div>']
    delay = 0.6
    for cls, txt in t["term"][1:]:
        lines.append(f'<div class="l" style="animation-delay:{delay:.2f}s"><span class="{cls}">{txt}</span></div>')
        delay += 0.28
    lines.append(f'<div class="l" style="animation-delay:{delay:.2f}s"><span class="p">❯ </span><span class="caret"></span></div>')
    figures = "".join(f'<div class="rv"><b>{a}</b><p>{b}</p></div>' for a, b in t["figures"])
    track = "".join(f'<div class="row"><span>{a}</span><span class="ok">{b} ✓</span></div>' for a, b in t["ui_track"])
    kpi = "".join(f"<div><b>{a}</b><span>{b}</span></div>" for a, b in t["ui_kpi"])
    tools = "".join(f'<div class="card"><b>{a}</b><span class="muted">{b}</span></div>' for a, b in t["ui_tools"])
    weeks = "".join(f'<div class="rv"><span class="w">{w}</span><h3>{h}</h3><p>{p}</p></div>' for w, h, p in t["weeks"])
    g = "".join(f'<div class="rv"><div class="big">{n}</div><div class="unit">{u}</div><p>{p}</p><p class="fine">{fine}</p></div>' for n, u, p, fine in t["g"])
    faq = "".join(f"<details><summary>{q}</summary><p>{a}</p></details>" for q, a in t["faq"])
    pf = t["plan_f"]; f = t["f"]; s = t["s"]
    rev = "".join(f'<option value="{v}">{l}</option>' for v, l in t["rev"])
    spend = "".join(f"<option>{o}</option>" for o in t["spend"])
    goal = "".join(f'<label><input type="radio" name="goal" value="{o}" required> {o}</label>' for o in t["goal"])
    ready = "".join(f'<label><input type="radio" name="ready" value="{v}" required> {l}</label>' for v, l in t["ready"])
    assure = "".join(f"<span>{x}</span>" for x in t["ap_assure"])
    return head(t, t["title"]) + f'''
<main>
<section class="hero"><div class="wrap">
  <p class="eyebrow">{t["eyebrow"]}</p>
  <h1>{t["h1"]}</h1>
  <p class="sub">{t["sub"]}</p>
  <div class="ctas"><a class="btn" href="#apply">{t["cta"]}</a><a class="link" href="#film">{t["watch"]}</a></div>
  <p class="assure">{t["assure"]}</p>
</div>
<div class="shot"><div class="win">
  <div class="chrome"><i></i><i></i><i></i><span>{t["term_title"]}</span></div>
  <div class="body">
    <div class="term">{"".join(lines)}</div>
    <div class="preview" aria-hidden="true"><div class="pt">{t["preview_title"]}</div><div class="pv"><i></i></div><div class="bars"><span></span><span></span><span></span><span></span><span></span></div><div class="pf"></div><div class="pf"></div><div class="pb"></div></div>
  </div>
</div></div></section>

<div class="wrap"><div class="figures">{figures}</div></div>

<section class="dark film" id="film"><div class="wrap">
  <p class="kicker">{t["film_k"]}</p>
  <h2>{t["film_h"]}</h2>
  <div class="player rv" role="button" tabindex="0" aria-label="{t["film_cap"][0]}">
    <!-- VSL: lim inn Cloudflare Stream / Vimeo iframe her (manus: copy/vsl-operator.md) -->
    <span class="snd">{t["sound"]}</span>
    <div class="pl"><div class="pb"></div></div>
    <div class="cap"><b>{t["film_cap"][0]}</b>{t["film_cap"][1]}</div>
  </div>
</div></section>

<section class="statement"><div class="wrap"><p class="rv">{t["statement"]}</p></div></section>

<section class="paper sys" id="system"><div class="wide">
  <header><p class="kicker">{t["sys_k"]}</p><h2 class="rv">{t["sys_h"]}</h2></header>
  <div class="bento">
    <div class="tile t-a rv"><h3>{t["t_a"][0]}</h3><p>{t["t_a"][1]}</p>
      <div class="ui"><div class="page-mock"><div class="v"><i></i></div><div class="f"><div class="t1"></div><span></span><span></span><span></span></div></div></div></div>
    <div class="tile t-b d rv"><h3>{t["t_b"][0]}</h3><p>{t["t_b"][1]}</p>
      <div class="ui">{track}<div class="row"><span class="muted">{t["dedup"]}</span><span class="ok">event_id ✓</span></div></div></div>
    <div class="tile t-c rv"><h3>{t["t_c"][0]}</h3><p>{t["t_c"][1]}</p>
      <div class="ui"><div class="ads"><div data-ctr="1.8%"></div><div class="win2" data-ctr="3.4%"></div><div data-ctr="2.1%"></div></div></div></div>
    <div class="tile t-d rv"><h3>{t["t_d"][0]}</h3><p>{t["t_d"][1]}</p>
      <div class="ui"><div class="kpi">{kpi}</div><div class="chart"></div><p class="fine" style="margin:8px 0 0">{t["kpi_note"]}</p></div></div>
    <div class="tile t-e d rv"><h3>{t["t_e"][0]}</h3><p>{t["t_e"][1]}</p>
      <div class="ui"><div class="chips"><span>CLAUDE.md</span><span>skills/funnels</span><span>skills/meta-capi</span><span>skills/ads</span><span>skills/sales</span><span>hooks/review</span></div></div></div>
    <div class="tile t-f rv"><h3>{t["t_f"][0]}</h3><p>{t["t_f"][1]}</p>
      <div class="ui"><div class="wide-ui">{tools}</div></div></div>
  </div>
</div></section>

<section class="timeline" id="weeks"><div class="wrap">
  <header><p class="kicker">{t["weeks_k"]}</p><h2 class="rv">{t["weeks_h"]}</h2></header>
  <div class="track">{weeks}</div>
</div></section>

<section class="dark guarantee"><div class="wrap">
  <header><p class="kicker">{t["g_k"]}</p><h2 class="rv">{t["g_h"]}</h2></header>
  <div class="gpair">{g}</div>
</div></section>

<section class="paper" id="plan"><div class="wrap split">
  <div class="stick"><p class="kicker">{t["plan_k"]}</p><h2 class="rv" style="font-size:clamp(34px,4.4vw,52px)">{t["plan_h"]}</h2><p class="sub" style="margin:20px 0 0;font-size:19px">{t["plan_p"]}</p></div>
  <div>
    <form class="card-form" data-ai novalidate>
      <input class="hp" name="website_hp" tabindex="-1" autocomplete="off">
      <div class="two"><div class="field"><label for="ai-co">{pf["company"][0]}</label><input id="ai-co" name="company" required maxlength="160" placeholder="{pf["company"][1]}"></div>
      <div class="field"><label for="ai-us">{pf["users"][0]}</label><input id="ai-us" name="users" required maxlength="160" placeholder="{pf["users"][1]}"></div></div>
      <div class="field"><label for="ai-tool">{pf["tool"][0]}</label><textarea id="ai-tool" name="tool" rows="3" required maxlength="600" placeholder="{pf["tool"][1]}"></textarea></div>
      <div class="two"><div class="field"><label for="ai-sys">{pf["systems"][0]}</label><input id="ai-sys" name="systems" maxlength="300" placeholder="{pf["systems"][1]}"></div>
      <div class="field"><label for="ai-em">{pf["email"][0]}</label><input id="ai-em" type="email" name="email" required autocomplete="email"></div></div>
      <p class="err" aria-live="polite"></p>
      <button class="btn" type="submit">{t["plan_btn"]}</button>
    </form>
    <div data-ai-out></div>
  </div>
</div></section>

<section id="faq"><div class="wrap split">
  <div class="stick"><h2 class="rv">{t["fit_h"]}</h2>
    <div class="fit"><div><h3>{t["for_h"]}</h3><ul class="ticks">{li(t["for_l"])}</ul></div><div><h3>{t["not_h"]}</h3><ul class="ticks x">{li(t["not_l"])}</ul></div></div></div>
  <div class="faq">{faq}</div>
</div></section>

<section class="paper" id="apply"><div class="wrap split">
  <div class="stick"><p class="kicker">{t["ap_k"]}</p><h2 class="rv" style="font-size:clamp(34px,4.4vw,52px)">{t["ap_h"]}</h2><p class="sub" style="margin:20px 0 0;font-size:19px">{t["ap_p"]}</p><div class="assure-row">{assure}</div></div>
  <form class="card-form" data-apply novalidate>
    <input type="hidden" name="offer" value="operator">
    <input class="hp" name="website_hp" tabindex="-1" autocomplete="off">
    <div class="progress"><i></i><i></i><i></i><i></i><i></i></div>
    <div class="step"><span class="stepno">{s[0][0]}</span><h3>{s[0][1]}</h3>
      <div class="field"><label for="a-name">{f["name"]}</label><input id="a-name" name="name" required autocomplete="name"></div>
      <div class="field"><label for="a-co">{f["company"]}</label><input id="a-co" name="company" required autocomplete="organization"></div>
      <div class="field"><label for="a-web">{f["website"]}</label><input id="a-web" name="website" placeholder="https://"></div></div>
    <div class="step"><span class="stepno">{s[1][0]}</span><h3>{s[1][1]}</h3>
      <div class="field"><label for="a-rev">{f["revenue"]}</label><select id="a-rev" name="revenue" required><option value="">—</option>{rev}</select></div>
      <div class="field"><label for="a-sp">{f["spend"]}</label><select id="a-sp" name="spend" required><option value="">—</option>{spend}</select></div></div>
    <div class="step"><span class="stepno">{s[2][0]}</span><h3>{s[2][1]}</h3><div class="opts">{goal}</div></div>
    <div class="step"><span class="stepno">{s[3][0]}</span><h3>{s[3][1]}</h3>
      <div class="field"><label for="a-first">{f["first"]}</label><textarea id="a-first" name="pain" rows="3" required placeholder="{f["first_ph"]}"></textarea></div>
      <div class="field"><label>{f["ready"]}</label><div class="opts">{ready}</div></div></div>
    <div class="step"><span class="stepno">{s[4][0]}</span><h3>{s[4][1]}</h3>
      <div class="field"><label for="a-em">{f["email"]}</label><input id="a-em" type="email" name="email" required autocomplete="email"></div>
      <div class="field"><label for="a-ph">{f["phone"]}</label><input id="a-ph" type="tel" name="phone" required autocomplete="tel"></div>
      <p class="consent">{t["consent"]}</p></div>
    <p class="err" aria-live="polite"></p>
    <div class="formnav"><button class="btn ghost" data-prev>{t["back"]}</button><button class="btn" data-next>{t["next"]}</button><button class="btn" type="submit" data-submit>{t["submit"]}</button></div>
  </form>
</div></section>

<section class="dark closer"><div class="wrap">
  <div class="n" aria-hidden="true">56</div>
  <h2>{t["close_h"]}</h2>
  <p class="sub">{t["close_p"]}</p>
  <div class="ctas"><a class="btn light" href="#apply">{t["cta"]}</a></div>
</div></section>
</main>

<footer><div class="wide"><span>© Operator by Asym</span><p>{t["foot"]}</p></div></footer>
<script src="/assets/op.js"></script>
</body>
</html>
'''


def thanks(t):
    tips = "".join(f'<div><h3>{a}</h3><p class="muted" style="margin:8px 0 0">{b}</p></div>' for a, b in t["th_tips"])
    return head(t, f'{t["th_title"]} · Operator', noindex=True) + f'''
<main>
<section class="hero" style="padding-block:110px 60px"><div class="wrap">
  <h1>{t["th_h"]}</h1>
  <div id="book" hidden><p class="sub">{t["th_book"]}</p><div class="ctas"><a class="btn" id="booklink" href="#" target="_blank" rel="noopener">{t["th_btn"]}</a></div></div>
  <p class="sub" id="wait">{t["th_wait"]}</p>
</div></section>
<section style="padding-block:20px 120px"><div class="wrap"><div class="fit thanks-tips">{tips}</div></div></section>
</main>
<footer><div class="wide"><span>© Operator by Asym</span></div></footer>
<script>(function(){{var q=new URLSearchParams(location.search),u=q.get("book");if(u&&/^https:\\/\\//.test(u)){{document.getElementById("book").hidden=false;document.getElementById("wait").hidden=true;document.getElementById("booklink").href=u;}}}})();</script>
</body>
</html>
'''


for key, t in T.items():
    base = HERE if key == "en" else HERE / "no"
    base.mkdir(parents=True, exist_ok=True)
    (base / "index.html").write_text(page(t), encoding="utf-8")
    th = HERE / t["thanks"].strip("/")
    th.mkdir(parents=True, exist_ok=True)
    (th / "index.html").write_text(thanks(t), encoding="utf-8")
print("built")
