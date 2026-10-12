"""Bygger Operator-sidene (EN + NO) fra én mal. Struktur etter Daniel Iles' (viralcoach.com) rammeverk:
rolig hero → tallkort → markedsskifte (ikke din feil) → video → «under ett tak» → prosess i 4 steg →
bevisvegg → interaktivt bevis → hvem det er for → spørsmål → søknad → stor garanti med vannmerke.
Kjør: python3 build.py
"""
from pathlib import Path

HERE = Path(__file__).parent / "public"

T = {
"en": dict(
  lang="en", path="", other="/no/", other_label="Norsk",
  title="Operator · Run your business on Claude Code",
  desc="A fully-built operating system for your business, on Claude Code: VSL funnels, server-side ad tracking, a Meta ads engine, a sales command centre and your own tools. Live in 56 days, guaranteed.",
  strip="Applications are open for the next cohort · 8 seats",
  nav=[("#system", "The system"), ("#process", "Process"), ("#faq", "FAQ")], nav_cta="See if you qualify",
  h1='Run Your Business<br>On <em>Claude Code</em>',
  tag="Fully-built operating system with guaranteed delivery.",
  cta="See if you qualify", meta="7-day money-back guarantee · 8 seats per cohort · One company per industry",
  stats=[("Speed", "Day 2", "Your VSL funnel and server-side tracking go live"),
         ("Scope", "6", "Core growth systems, built under one roof"),
         ("Savings", "$100k+", "Typical annual agency, developer and SaaS spend in scope"),
         ("Risk", "7 days", "Full money-back window. No questions asked.")],
  shift_h="Software is now written by AI.<br>Most businesses are still paying people to write it.",
  shift=[("2×", "Your competitors are already building", "Searches for Claude Code doubled in the last 12 months (Google Trends, US). The companies learning it now will run with a fraction of the overhead."),
         ("$", "Agencies sell hours. AI made hours cheap.", "Funnels, tracking, dashboards and internal tools that took an agency months now take days, when you know how to direct it."),
         ("◎", "Most teams have tried AI. Few have a system.", "We run our own business on this exact stack. This page, its application and its AI build planner were built with it.")],
  built_label="Built with", built=["Claude Code", "Cloudflare", "Meta Conversions API", "HubSpot", "Stripe", "Google Analytics 4"],
  vsl_sound="Click for sound", vsl_title="The 9-minute briefing", vsl_small="Watch before you apply",
  roof_eyebrow="The system", roof_h='Your Entire Growth Stack<br><em>Under One Roof</em>',
  roof_lead="Six systems that usually live with six different vendors, built inside your business, connected to each other, and owned by you.",
  nodes=[("01 · FOUNDATION", "Claude Code, set up"), ("02 · FUNNELS", "VSL & applications"), ("03 · TRACKING", "Pixel + Conversions API"),
         ("04 · ADS", "Meta ads engine"), ("05 · SALES", "Sales command centre"), ("06 · SOFTWARE", "Your own tools")],
  core='Your<br><i>business</i>',
  badge=("New", "Founding cohort · 8 seats"),
  sys_desc=["Your workspace, project memory, skill library and guardrails, set up properly. The part everyone skips.",
            "Video sales pages, multi-step applications, qualification and booking. Live by Build Day 2.",
            "Every lead, call and sale sent to Meta from your server. Ads optimise on revenue, not clicks.",
            "New hooks and creatives every week, tested against each other, with a clear scale-or-kill report.",
            "Show-up, close rate, cost per call and ROAS in one view. Claude reviews every call.",
            "Client portals, quoting tools and dashboards that replace subscriptions and retainers."],
  proc_eyebrow="Process", proc_h="How it works",
  proc=[("01", "Identify bottlenecks", "We audit your funnel, tracking, tools and spend, and find exactly where money leaks."),
        ("02", "Build your stack", "We set up Claude Code and build your funnels, tracking and dashboards live, with your team."),
        ("03", "Launch, test & scale", "Ads go live on server-side tracking. We read the numbers and double down on what works."),
        ("04", "Guaranteed delivery", "Everything live by day 56, or we keep building with you for free until it is.")],
  wall_eyebrow="What you walk away with", wall_h="Systems, not slides.",
  w_this=("BUILT WITH THE STACK", "this page", "The page you're reading, its five-step application and its Claude-powered build planner were built and deployed with the exact workflow you'll learn."),
  w_funnel=("VSL FUNNEL", "day 2", "Video sales page, multi-step application, qualification and booking. Live by the end of Build Day 2."),
  w_track=("TRACKING", "server-side", "Every lead, call and sale sent to Meta from your server, deduplicated and consented. Ads optimise on revenue, not clicks."),
  w_sales=("SALES COMMAND CENTRE", "illustrative", "Show-up, close rate, cost per call and ROAS in one live view. Claude reviews every call and drafts the follow-up."),
  w_ads=("ADS ENGINE", "weekly", "New hooks and creatives every week, tested against each other, with a report that tells you what to scale."),
  w_tools=("YOUR OWN SOFTWARE", "owned", "Client portals, quoting tools and internal dashboards that replace subscriptions and retainers."),
  ai_eyebrow="Try it · free", ai_h='Describe one tool you wish existed.<br><em>Get the build plan.</em>',
  ai_lead="Powered by the Claude API, behind a function built with Claude Code.",
  ai_company="Your company", ai_company_ph="e.g. 40-person logistics company", ai_users="Who will use it?", ai_users_ph="e.g. sales team and 200 clients",
  ai_tool="The tool you want", ai_tool_ph="e.g. a client portal with shipment status, documents and invoices", ai_systems="Systems to connect (optional)", ai_systems_ph="e.g. HubSpot, Stripe, Google Sheets",
  ai_email="Email", ai_btn="Generate my build plan",
  for_h="This is for you if…", for_l=["Your business does $1M+ a year", "You spend $5k+ a month on agencies, developers or software", "You want to launch offers and test markets faster than your competitors", "You or one person on your team can commit 6 hours a week"],
  not_h="It isn't if…", not_l=["You want to become a software engineer", "You want everything done for you without being involved", "You're pre-revenue or still looking for an idea"],
  faq_h="You've got questions<br>We've got answers",
  faq=[("What do you do?", "We install Claude Code in your business and build, with your team, the systems that drive growth: VSL funnels, server-side ad tracking, a Meta ads engine, a sales command centre, and the internal tools you currently pay others for. In eight weeks. You own all of it."),
       ("Why Claude Code?", "It writes, runs and fixes real software from plain-language instructions. It's the most capable way we've found for a business to build its own tools, and it's what we run our own business on."),
       ("How do I know this will work for me?", "Before you join, we map your funnel, tools and spend on a call and show you exactly what we'd build first. If we don't see a clear return, we'll tell you. Then you're covered by a 7-day money-back guarantee."),
       ("How does the guarantee work?", "Two parts. First, if within 7 days of starting you're not convinced, you get a full refund, no questions asked. Second, your funnel, tracking and at least two internal tools are live by day 56, or we keep building with you for free. The build guarantee requires attendance at both Build Days and 6 of 8 weekly sessions."),
       ("What makes this different from the other options?", "Agencies rent you their work. Courses give you videos. We build the systems with your team, inside your business, and you keep everything: the code, the tracking, the dashboards, and the skill to build the next one."),
       ("What does it cost?", "It depends on your size and goals, so we share pricing on the call. It's typically less than a year of agency fees, and it's covered by the 7-day guarantee."),
       ("What do I need to do next?", "Apply below. It takes two minutes. If you're a fit, you'll book a 45-minute strategy call."),
       ("Are you affiliated with Anthropic?", "No. Claude Code is Anthropic's product. We're an independent team that builds with it every day.")],
  ap_eyebrow="Apply", ap_h='See if you <em>qualify</em>', ap_lead="Five quick steps. If you're a fit, you'll book a 45-minute strategy call where we map exactly what you'll build.",
  s=[("Step 1 of 5", "Who are you?"), ("Step 2 of 5", "Your business"), ("Step 3 of 5", "Your main goal"), ("Step 4 of 5", "What would you build first?"), ("Step 5 of 5", "Where should we reach you?")],
  f_name="Full name", f_company="Company", f_site="Website", f_rev="Annual revenue", rev_opts=[("0-1m", "Under $1M"), ("1m-5m", "$1M–5M"), ("5m-20m", "$5M–20M"), ("20m+", "$20M+")],
  f_spend="Monthly spend on agencies, developers and software", spend_opts=["Under $2k", "$2k–10k", "$10k–30k", "$30k+"],
  goal_opts=["Cut software & agency costs", "Build a GTM machine and grow revenue", "Both"],
  f_first="Describe it in a sentence or two", f_first_ph="e.g. replace our agency's funnels and get tracking we can trust",
  f_ready="Can you start within 30 days if it's a fit?", ready_opts=[("yes", "Yes"), ("maybe", "Maybe, depends on timing"), ("no", "No, just exploring")],
  f_email="Email", f_phone="Phone", consent="By applying you agree that we may contact you about your application. We never share your details.",
  back="Back", nextb="Next", submit="Submit application", secure=["Two minutes", "No payment today", "7-day money-back guarantee"],
  wm="56", close_h='Live in 56 Days<br><em>Guaranteed</em>', close_sub="Plus a 7-day money-back guarantee from the day you start.",
  foot_l="© Operator by Asym", foot_r="Claude and Claude Code are trademarks of Anthropic. Operator is independent and not affiliated with or endorsed by Anthropic. Results vary and depend on effort, market and execution; no earnings or revenue are guaranteed. Dashboard figures shown are illustrative.",
),
"no": dict(
  lang="nb", path="no/", other="/", other_label="English",
  title="Operator · Driv bedriften din på Claude Code",
  desc="Et ferdig bygget operativsystem for bedriften din, på Claude Code: VSL-funnels, server-side-sporing, Meta-annonsemotor, salgssentral og egne verktøy. I drift på 56 dager, garantert.",
  strip="Søknadene er åpne for neste kull · 8 plasser",
  nav=[("#system", "Systemet"), ("#process", "Prosess"), ("#faq", "Spørsmål")], nav_cta="Se om du kvalifiserer",
  h1='Driv Bedriften Din<br>På <em>Claude Code</em>',
  tag="Ferdig bygget operativsystem med garantert levering.",
  cta="Se om du kvalifiserer", meta="7 dager pengene tilbake · 8 plasser per kull · Én bedrift per bransje",
  stats=[("Fart", "Dag 2", "VSL-funnel og server-side-sporing er i drift"),
         ("Omfang", "6", "Kjernesystemer for vekst, bygget under ett tak"),
         ("Besparelse", "1 MNOK+", "Typiske årlige byrå-, utvikler- og programvarekostnader i spill"),
         ("Risiko", "7 dager", "Full pengene-tilbake-periode. Ingen spørsmål.")],
  shift_h="Programvare skrives nå av AI.<br>De fleste bedrifter betaler fortsatt folk for å skrive den.",
  shift=[("2×", "Konkurrentene dine bygger allerede", "Søkene på Claude Code har doblet seg de siste 12 månedene (Google Trends, USA). Bedriftene som lærer det nå, vil drive med en brøkdel av kostnadene."),
         ("kr", "Byråer selger timer. AI gjorde timer billige.", "Funnels, sporing, dashboard og interne verktøy som tok et byrå måneder, tar nå dager, når du vet hvordan du styrer det."),
         ("◎", "De fleste har prøvd AI. Få har et system.", "Vi driver vår egen bedrift på akkurat denne stacken. Denne siden, søknaden og AI-byggeplanleggeren er bygget med den.")],
  built_label="Bygget med", built=["Claude Code", "Cloudflare", "Meta Conversions API", "HubSpot", "Stripe", "Google Analytics 4"],
  vsl_sound="Klikk for lyd", vsl_title="Gjennomgangen på 9 minutter", vsl_small="Se den før du søker",
  roof_eyebrow="Systemet", roof_h='Hele Vekstmaskinen Din<br><em>Under Ett Tak</em>',
  roof_lead="Seks systemer som vanligvis ligger hos seks ulike leverandører, bygget inne i bedriften din, koblet sammen og eid av dere.",
  nodes=[("01 · FUNDAMENT", "Claude Code, satt opp"), ("02 · FUNNELS", "VSL og søknader"), ("03 · SPORING", "Pixel + Conversions API"),
         ("04 · ANNONSER", "Meta-annonsemotor"), ("05 · SALG", "Salgssentral"), ("06 · PROGRAMVARE", "Egne verktøy")],
  core='Din<br><i>bedrift</i>',
  badge=("Nytt", "Founding-kull · 8 plasser"),
  sys_desc=["Arbeidsmiljø, prosjektminne, skills-bibliotek og sikkerhetsrammer, satt opp riktig. Delen alle hopper over.",
            "Salgssider med video, søknader i flere steg, kvalifisering og booking. I drift innen Build Day 2.",
            "Hvert lead, hver samtale og hvert salg sendes til Meta fra deres server. Annonsene optimaliserer på omsetning.",
            "Nye hooks og kreativer hver uke, testet mot hverandre, med en tydelig rapport om hva som skal skaleres.",
            "Oppmøte, lukkerate, kostnad per samtale og ROAS i én visning. Claude går gjennom hver samtale.",
            "Kundeportaler, tilbudsverktøy og dashboard som erstatter abonnementer og retainere."],
  proc_eyebrow="Prosess", proc_h="Slik fungerer det",
  proc=[("01", "Finn flaskehalsene", "Vi går gjennom funnel, sporing, verktøy og kostnader, og finner nøyaktig hvor pengene lekker."),
        ("02", "Bygg stacken", "Vi setter opp Claude Code og bygger funnels, sporing og dashboard live, sammen med teamet ditt."),
        ("03", "Lanser, test og skaler", "Annonsene går live med server-side-sporing. Vi leser tallene og dobler ned på det som virker."),
        ("04", "Garantert levering", "Alt i drift innen dag 56, ellers fortsetter vi å bygge med dere gratis til det er det.")],
  wall_eyebrow="Dette sitter du igjen med", wall_h="Systemer, ikke lysbilder.",
  w_this=("BYGGET MED STACKEN", "denne siden", "Siden du leser, søknaden i fem steg og den Claude-drevne byggeplanleggeren ble bygget og deployet med akkurat arbeidsflyten du skal lære."),
  w_funnel=("VSL-FUNNEL", "dag 2", "Salgsside med video, søknad i flere steg, kvalifisering og booking. I drift innen slutten av Build Day 2."),
  w_track=("SPORING", "server-side", "Hvert lead, hver samtale og hvert salg sendes til Meta fra deres server, deduplisert og med samtykke. Annonsene optimaliserer på omsetning, ikke klikk."),
  w_sales=("SALGSSENTRAL", "illustrasjon", "Oppmøte, lukkerate, kostnad per samtale og ROAS i én visning. Claude går gjennom hver samtale og skriver oppfølgingen."),
  w_ads=("ANNONSEMOTOR", "ukentlig", "Nye hooks og kreativer hver uke, testet mot hverandre, med en rapport som sier hva du skal skalere."),
  w_tools=("EGEN PROGRAMVARE", "eid", "Kundeportaler, tilbudsverktøy og interne dashboard som erstatter abonnementer og retainere."),
  ai_eyebrow="Prøv · gratis", ai_h='Beskriv ett verktøy du skulle ønske fantes.<br><em>Få byggeplanen.</em>',
  ai_lead="Drevet av Claude API, bak en funksjon bygget med Claude Code.",
  ai_company="Bedriften din", ai_company_ph="f.eks. logistikkselskap med 40 ansatte", ai_users="Hvem skal bruke det?", ai_users_ph="f.eks. salgsteamet og 200 kunder",
  ai_tool="Verktøyet du vil ha", ai_tool_ph="f.eks. en kundeportal med sporing av forsendelser, dokumenter og fakturaer", ai_systems="Systemer det skal kobles til (valgfritt)", ai_systems_ph="f.eks. HubSpot, Tripletex, Google Sheets",
  ai_email="E-post", ai_btn="Lag byggeplanen min",
  for_h="Dette er for deg hvis…", for_l=["Bedriften din omsetter for 10 MNOK+ i året", "Du bruker 50 000 kr+ i måneden på byråer, utviklere eller programvare", "Du vil lansere tilbud og teste markeder raskere enn konkurrentene", "Du eller én i teamet kan sette av 6 timer i uka"],
  not_h="Det er ikke det hvis…", not_l=["Du vil bli utvikler", "Du vil at alt skal gjøres for deg uten at du er involvert", "Du har ingen omsetning ennå eller leter etter en idé"],
  faq_h="Du har spørsmål<br>Vi har svarene",
  faq=[("Hva gjør dere?", "Vi installerer Claude Code i bedriften din og bygger, sammen med teamet ditt, systemene som driver vekst: VSL-funnels, server-side-sporing av annonser, en Meta-annonsemotor, en salgssentral og de interne verktøyene dere i dag betaler andre for. På åtte uker. Dere eier alt."),
       ("Hvorfor Claude Code?", "Det skriver, kjører og retter ekte programvare ut fra instruksjoner på vanlig språk. Det er den mest kapable måten vi har funnet for en bedrift å bygge egne verktøy på, og det er det vi driver vår egen bedrift på."),
       ("Hvordan vet jeg at dette fungerer for meg?", "Før du blir med, kartlegger vi funnel, verktøy og kostnader i en samtale og viser nøyaktig hva vi ville bygget først. Ser vi ikke en tydelig gevinst, sier vi det. Deretter er du dekket av 7 dagers pengene-tilbake-garanti."),
       ("Hvordan fungerer garantien?", "To deler. Først: er du ikke overbevist innen 7 dager etter oppstart, får du alt tilbake, uten spørsmål. Deretter: funnel, sporing og minst to interne verktøy er i drift innen dag 56, ellers fortsetter vi å bygge med dere gratis. Byggegarantien forutsetter deltakelse på begge Build Days og 6 av 8 ukentlige økter."),
       ("Hva gjør dette annerledes enn alternativene?", "Byråer leier ut arbeidet sitt til deg. Kurs gir deg videoer. Vi bygger systemene med teamet ditt, inne i bedriften, og dere beholder alt: koden, sporingen, dashboardene og ferdigheten til å bygge det neste."),
       ("Hva koster det?", "Det avhenger av størrelse og mål, så vi deler prisen i samtalen. Det er typisk mindre enn ett år med byråhonorarer, og det er dekket av 7-dagersgarantien."),
       ("Hva gjør jeg nå?", "Søk under. Det tar to minutter. Passer dere, booker du en 45-minutters strategisamtale."),
       ("Er dere tilknyttet Anthropic?", "Nei. Claude Code er Anthropics produkt. Vi er et uavhengig team som bygger med det hver dag.")],
  ap_eyebrow="Søk", ap_h='Se om du <em>kvalifiserer</em>', ap_lead="Fem raske steg. Passer dere, booker du en 45-minutters strategisamtale der vi kartlegger nøyaktig hva dere skal bygge.",
  s=[("Steg 1 av 5", "Hvem er du?"), ("Steg 2 av 5", "Bedriften din"), ("Steg 3 av 5", "Hovedmålet ditt"), ("Steg 4 av 5", "Hva ville du bygget først?"), ("Steg 5 av 5", "Hvor når vi deg?")],
  f_name="Fullt navn", f_company="Bedrift", f_site="Nettside", f_rev="Årlig omsetning", rev_opts=[("0-10", "Under 10 MNOK"), ("10-50", "10–50 MNOK"), ("50-200", "50–200 MNOK"), ("200+", "200+ MNOK")],
  f_spend="Månedlig kostnad til byråer, utviklere og programvare", spend_opts=["Under 20 000 kr", "20–100 000 kr", "100–300 000 kr", "Over 300 000 kr"],
  goal_opts=["Kutte programvare- og byråkostnader", "Bygge en salgsmaskin og øke omsetningen", "Begge deler"],
  f_first="Beskriv det med en setning eller to", f_first_ph="f.eks. erstatte byråets funnels og få sporing vi kan stole på",
  f_ready="Kan dere starte innen 30 dager hvis det passer?", ready_opts=[("ja", "Ja"), ("kanskje", "Kanskje, avhenger av timing"), ("nei", "Nei, bare nysgjerrig")],
  f_email="E-post", f_phone="Telefon", consent="Ved å søke godtar du at vi kontakter deg om søknaden. Vi deler aldri opplysningene dine.",
  back="Tilbake", nextb="Neste", submit="Send søknad", secure=["To minutter", "Ingen betaling i dag", "7 dager pengene tilbake"],
  wm="56", close_h='I Drift På 56 Dager<br><em>Garantert</em>', close_sub="Pluss 7 dager pengene tilbake fra dagen du starter.",
  foot_l="© Operator by Asym", foot_r="Claude og Claude Code er varemerker for Anthropic. Operator er uavhengig og ikke tilknyttet eller godkjent av Anthropic. Resultater varierer og avhenger av innsats, marked og gjennomføring. Ingen inntekt eller omsetning er garantert. Tall i dashboard-eksemplene er illustrasjoner.",
),
}

def li(items): return "".join(f"<li>{x}</li>" for x in items)

def page(t):
    no = t["lang"] == "nb"
    nav = "".join(f'<a href="{h}">{l}</a>' for h, l in t["nav"])
    stats = "".join(f'<div class="stat"><div class="k">{k}</div><div class="v">{v}</div><p>{p}</p></div>' for k, v, p in t["stats"])
    cols = "".join(f'<div class="col rv"><div class="num">{i}</div><h3>{h}</h3><p>{p}</p></div>' for i, h, p in t["shift"])
    built = "".join(f"<b>{b}</b>" for b in t["built"])
    sysg = "".join(f'<div class="rv"><span class="n">{a.split(" · ")[0]}</span><h3>{b}</h3><p>{d}</p></div>' for (a, b), d in zip(t["nodes"], t["sys_desc"]))
    steps = "".join(f'<div class="rv"><div class="dot">{n}</div><h3>{h}</h3><p>{p}</p></div>' for n, h, p in t["proc"])
    cmd = "Bygg en VSL-side med søknad i 5 steg og Meta CAPI" if no else "Build a VSL page with a 5-step application and Meta CAPI"
    mock_this = f'<div class="mock"><span class="b">❯</span> {cmd}<br><span class="d">● {"leser" if no else "reading"} CLAUDE.md · skills/funnels</span><br><span class="g">✓</span> public/index.html<br><span class="g">✓</span> functions/api/apply.js<br><span class="g">✓</span> functions/api/claude.js<br><span class="b">→ {"deployet til produksjon" if no else "deployed to production"}</span></div>'
    mock_track = f'<div class="mock"><div class="row"><span>Lead</span><span class="g">server ✓</span></div><div class="row"><span>Schedule</span><span class="g">server ✓</span></div><div class="row"><span>Purchase</span><span class="g">server ✓</span></div><div class="row"><span class="d">{"deduplisert" if no else "deduplicated"}</span><span class="b">event_id ✓</span></div></div>'
    mock_sales = f'<div class="mock" style="background:#fbfaf7"><div class="kpis"><div><b>82%</b><span>{"oppmøte" if no else "show-up"}</span></div><div><b>31%</b><span>{"lukkerate" if no else "close rate"}</span></div><div><b>4.2×</b><span>ROAS</span></div></div><div class="spark"></div></div>'
    def pcard(t3, mock, feature=False):
        h, tag, txt = t3
        return f'<div class="pcard rv{" feature" if feature else ""}"><div class="h"><span>{h}</span><span>{tag}</span></div>{mock}<p>{txt}</p></div>'
    proof = pcard(t["w_this"], mock_this, True) + pcard(t["w_track"], mock_track) + pcard(t["w_sales"], mock_sales)
    faq = "".join(f"<details><summary>{q}</summary><p>{a}</p></details>" for q, a in t["faq"])
    rev = "".join(f'<option value="{v}">{l}</option>' for v, l in t["rev_opts"])
    spend = "".join(f"<option>{o}</option>" for o in t["spend_opts"])
    goal = "".join(f'<label><input type="radio" name="goal" value="{o}" required> {o}</label>' for o in t["goal_opts"])
    ready = "".join(f'<label><input type="radio" name="ready" value="{v}" required> {l}</label>' for v, l in t["ready_opts"])
    secure = "".join(f"<span>{x}</span>" for x in t["secure"])
    meta = "".join(f"<span>{m.strip()}</span>" for m in t["meta"].split("·"))
    s = t["s"]
    return f"""<!doctype html>
<html lang="{t["lang"]}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>{t["title"]}</title>
<meta name="description" content="{t["desc"]}">
<meta property="og:title" content="{t["title"]}">
<meta property="og:description" content="{t["desc"]}">
<meta name="theme-color" content="#f7f6f2">
<link rel="alternate" hreflang="en" href="/">
<link rel="alternate" hreflang="nb" href="/no/">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Instrument+Serif:ital@0;1&family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@500;600&display=swap" rel="stylesheet">
<link rel="stylesheet" href="/assets/op.css">
</head>
<body>
<div class="strip"><a href="#apply">{t["strip"].split("·")[0].strip()} · <b>{t["strip"].split("·")[1].strip()}</b> →</a></div>
<header class="nav"><div class="wrap">
  <a class="logo" href="/{t["path"]}"><i></i><strong>OPERATOR</strong></a>
  <nav class="l">{nav}</nav>
  <div class="r"><a class="lang" href="{t["other"]}">{t["other_label"]}</a><a class="btn sm" href="#apply">{t["nav_cta"]}</a></div>
</div></header>

<div class="hero"><div class="wrap">
  <span class="badge"><b>{t["badge"][0]}</b>{t["badge"][1]}</span>
  <h1>{t["h1"]}</h1>
  <p class="tag">{t["tag"]}</p>
  <a class="btn" href="#apply">{t["cta"]} <span class="arr">→</span></a>
  <div class="meta">{meta}</div>
</div></div>

<div class="vsl-wrap"><div class="wrap">
  <div class="vsl rv">
    <!-- VSL: lim inn Cloudflare Stream / Vimeo iframe her (manus: copy/vsl-operator.md) -->
    <span class="sound">🔈 {t["vsl_sound"]}</span>
    <div class="ph"><div><div class="play"></div><strong>{t["vsl_title"]}</strong><small>{t["vsl_small"]}</small></div></div>
  </div>
  <div class="stats rv">{stats}</div>
</div></div>

<section><div class="wrap">
  <div class="sec-head"><h2 class="rv">{t["shift_h"]}</h2></div>
  <div class="cols3">{cols}</div>
  <div class="built rv"><span class="lab">{t["built_label"]}</span>{built}</div>
</div></section>

<section class="alt" id="system"><div class="wrap">
  <div class="sec-head"><span class="eyebrow">{t["roof_eyebrow"]}</span><h2 class="rv">{t["roof_h"]}</h2><p class="lead rv">{t["roof_lead"]}</p></div>
  <div class="sys">{sysg}</div>
</div></section>

<section id="process"><div class="wrap">
  <div class="sec-head"><span class="eyebrow">{t["proc_eyebrow"]}</span><h2 class="rv">{t["proc_h"]}</h2></div>
  <div class="steps">{steps}</div>
</div></section>

<section class="alt"><div class="wrap">
  <div class="sec-head"><span class="eyebrow">{t["wall_eyebrow"]}</span><h2 class="rv">{t["wall_h"]}</h2></div>
  <div class="proof">{proof}</div>
  <p class="center" style="margin-top:44px"><a class="btn" href="#apply">{t["cta"]} <span class="arr">→</span></a></p>
</div></section>

<section id="plan"><div class="wrap narrow">
  <div class="sec-head"><span class="eyebrow">{t["ai_eyebrow"]}</span><h2 class="rv">{t["ai_h"]}</h2><p class="lead">{t["ai_lead"]}</p></div>
  <div class="panel rv"><form data-ai novalidate>
    <input class="hp" name="website_hp" tabindex="-1" autocomplete="off">
    <div class="two"><div class="field"><label>{t["ai_company"]}</label><input name="company" required maxlength="160" placeholder="{t["ai_company_ph"]}"></div>
    <div class="field"><label>{t["ai_users"]}</label><input name="users" required maxlength="160" placeholder="{t["ai_users_ph"]}"></div></div>
    <div class="field"><label>{t["ai_tool"]}</label><textarea name="tool" rows="3" required maxlength="600" placeholder="{t["ai_tool_ph"]}"></textarea></div>
    <div class="two"><div class="field"><label>{t["ai_systems"]}</label><input name="systems" maxlength="300" placeholder="{t["ai_systems_ph"]}"></div>
    <div class="field"><label>{t["ai_email"]}</label><input type="email" name="email" required autocomplete="email"></div></div>
    <p class="err" aria-live="polite"></p>
    <button class="btn" type="submit">{t["ai_btn"]}</button>
  </form></div>
  <div data-ai-out></div>
</div></section>

<section class="tight"><div class="wrap">
  <div class="fit">
    <div class="rv"><h3>{t["for_h"]}</h3><ul class="ticks">{li(t["for_l"])}</ul></div>
    <div class="rv"><h3>{t["not_h"]}</h3><ul class="ticks x">{li(t["not_l"])}</ul></div>
  </div>
</div></section>

<section id="faq"><div class="wrap narrow">
  <div class="sec-head"><h2 class="rv">{t["faq_h"]}</h2></div>
  <div class="faq">{faq}</div>
</div></section>

<section id="apply" class="alt"><div class="wrap narrow">
  <div class="sec-head"><span class="eyebrow">{t["ap_eyebrow"]}</span><h2 class="rv">{t["ap_h"]}</h2><p class="lead">{t["ap_lead"]}</p></div>
  <div class="panel"><form data-apply novalidate>
    <input type="hidden" name="offer" value="operator">
    <input class="hp" name="website_hp" tabindex="-1" autocomplete="off">
    <div class="progress"><i></i><i></i><i></i><i></i><i></i></div>
    <div class="step"><span class="stepno">{s[0][0]}</span><h3>{s[0][1]}</h3>
      <div class="field"><label>{t["f_name"]}</label><input name="name" required autocomplete="name"></div>
      <div class="field"><label>{t["f_company"]}</label><input name="company" required autocomplete="organization"></div>
      <div class="field"><label>{t["f_site"]}</label><input name="website" placeholder="https://"></div></div>
    <div class="step"><span class="stepno">{s[1][0]}</span><h3>{s[1][1]}</h3>
      <div class="field"><label>{t["f_rev"]}</label><select name="revenue" required><option value="">—</option>{rev}</select></div>
      <div class="field"><label>{t["f_spend"]}</label><select name="spend" required><option value="">—</option>{spend}</select></div></div>
    <div class="step"><span class="stepno">{s[2][0]}</span><h3>{s[2][1]}</h3><div class="opts">{goal}</div></div>
    <div class="step"><span class="stepno">{s[3][0]}</span><h3>{s[3][1]}</h3>
      <div class="field"><label>{t["f_first"]}</label><textarea name="pain" rows="3" required placeholder="{t["f_first_ph"]}"></textarea></div>
      <div class="field"><label>{t["f_ready"]}</label><div class="opts">{ready}</div></div></div>
    <div class="step"><span class="stepno">{s[4][0]}</span><h3>{s[4][1]}</h3>
      <div class="field"><label>{t["f_email"]}</label><input type="email" name="email" required autocomplete="email"></div>
      <div class="field"><label>{t["f_phone"]}</label><input type="tel" name="phone" required autocomplete="tel"></div>
      <p class="consent">{t["consent"]}</p></div>
    <p class="err" aria-live="polite"></p>
    <div class="formnav"><button class="btn ghost sm" data-prev>← {t["back"]}</button><button class="btn sm" data-next>{t["nextb"]} →</button><button class="btn" type="submit" data-submit>{t["submit"]}</button></div>
  </form></div>
  <div class="secure">{secure}</div>
</div></section>

<section class="closer"><div class="wrap">
  <div class="wm" aria-hidden="true">{t["wm"]}</div>
  <h2>{t["close_h"]}</h2>
  <p class="lead">{t["close_sub"]}</p>
  <a class="btn" href="#apply">{t["cta"]} <span class="arr">→</span></a>
</div></section>

<footer><div class="wrap"><div><strong>OPERATOR</strong><br>{t["foot_l"]}</div><div>{t["foot_r"]}</div></div></footer>
<script src="/assets/op.js"></script>
</body>
</html>
"""

THANKS = {
  "en": dict(lang="en", file="thanks/index.html", home="/", title="Application received", h="Application received.<br><em>One step left.</em>",
             book="You look like a strong fit. Pick a time for your strategy call now and we'll hold your seat.", bookbtn="Pick a time",
             wait="We'll review your application and get back to you within one business day.",
             tips=[("01", "Add the call to your calendar. Seats are limited and missed calls are released."), ("02", "Before the call we review your website and current funnel. You keep the notes either way."), ("03", "Bring your numbers: agency, developer and software spend, and your revenue goals.")]),
  "no": dict(lang="nb", file="no/takk/index.html", home="/no/", title="Søknad mottatt", h="Søknad mottatt.<br><em>Ett steg igjen.</em>",
             book="Dere ser ut som en god match. Velg tidspunkt for strategisamtalen nå, så holder vi av plassen.", bookbtn="Velg tidspunkt",
             wait="Vi går gjennom søknaden og tar kontakt innen én virkedag.",
             tips=[("01", "Legg samtalen i kalenderen. Plassene er få, og uteblir du, går plassen videre."), ("02", "Før samtalen går vi gjennom nettsiden og dagens funnel. Notatene får du uansett."), ("03", "Ha tallene klare: kostnader til byrå, utviklere og programvare, og målene for omsetning.")]),
}

def thanks(t):
    tips = "".join(f'<div class="col"><div class="num">{n}</div><p>{x}</p></div>' for n, x in t["tips"])
    return f'''<!doctype html>
<html lang="{t["lang"]}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex">
<title>{t["title"]} · Operator</title>
<link href="https://fonts.googleapis.com/css2?family=Instrument+Serif:ital@0;1&family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@500;600&display=swap" rel="stylesheet">
<link rel="stylesheet" href="/assets/op.css"></head>
<body><header class="nav"><div class="wrap"><a class="logo" href="{t["home"]}"><i></i><strong>OPERATOR</strong></a></div></header>
<div class="hero"><div class="wrap narrow">
  <h1 style="font-size:clamp(42px,7vw,76px)">{t["h"]}</h1>
  <div id="book" style="display:none"><p class="tag">{t["book"]}</p><a class="btn" id="booklink" href="#" target="_blank" rel="noopener">{t["bookbtn"]}</a></div>
  <p class="tag" id="wait">{t["wait"]}</p>
</div></div>
<section><div class="wrap"><div class="cols3">{tips}</div></div></section>
<script>(function(){{var q=new URLSearchParams(location.search),u=q.get("book");if(u&&/^https:\\/\\//.test(u)){{document.getElementById("book").style.display="";document.getElementById("wait").style.display="none";document.getElementById("booklink").href=u;}}}})();</script>
</body></html>
'''

for t in T.values():
    out = HERE / t["path"] / "index.html"
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(page(t), encoding="utf-8")
for t in THANKS.values():
    out = HERE / t["file"]
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(thanks(t), encoding="utf-8")
print("built")
