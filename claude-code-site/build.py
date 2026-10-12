"""Bygger Operator-sidene (EN + NO) fra én mal. Kjør: python3 build.py"""
from pathlib import Path

HERE = Path(__file__).parent / "public"

T = {
"en": dict(
  lang="en", path="", other="/no/", other_label="Norsk", title="Operator: Claude Code for founders & businesses",
  desc="Rebuild your business with Claude Code. Cut hundreds of thousands in software and agency costs, and build a go-to-market machine: VSL pages, Meta ads with server-side tracking, and sales dashboards.",
  strip="▶ Watch the 9-minute briefing before you apply. Next cohort: 8 seats.",
  nav_cta="Apply now",
  pill="Applications open · 8 companies per cohort",
  h1='Rebuild your business<br>with <em class="grad">Claude Code</em>.',
  sub="Stop paying agencies and SaaS vendors hundreds of thousands a year for things your team can now build in days. Then use the same skills to build a go-to-market machine that opens new revenue streams.",
  vsl_tag="BRIEFING · 9 MIN", vsl_title="Watch this before you apply", vsl_small="How founders replace $100k+ in agency and software spend, and build GTM systems in days",
  cta="Apply for the next cohort", trust=["7-day money-back guarantee", "Built live with your team", "You own everything"],
  # problem
  k1="The problem", h_prob='You\'re paying <em>other people</em> to build your business.',
  prob=[
    "A performance agency at $10–30k a month for ads, funnels and tracking that you can't see inside.",
    "A dev agency that quoted six figures and nine months for one internal tool.",
    "Twelve SaaS subscriptions that each do 40% of what you need and don't talk to each other.",
    "And no single view of what a lead costs, which ads actually close, and where the revenue comes from.",
  ],
  prob_close="It's not that you lack talent. The way software gets built changed in the last 18 months. With an agentic coding tool like Claude Code, you describe what you want, and it writes, runs and fixes the code. Almost nobody has shown business owners how to use it properly.",
  # outcomes
  k2="Two outcomes", h_out='Save the money. <em>Then multiply it.</em>',
  save_t="Save", save_num="$100k–500k", save_s="per year, typically, in agency, developer and software costs",
  save_l=["Replace SaaS tools with software you own", "Build internal tools, portals and automations in days", "Stop paying retainers for work you can direct yourself"],
  grow_t="Grow", grow_num="New revenue", grow_s="new offers, new markets and new channels, launched in days instead of quarters",
  grow_l=["VSL pages and application funnels, live in a day", "Meta ads with server-side tracking you actually trust", "Sales dashboards that show what closes and why"],
  # stack
  k3="The Operator stack", h_stack='Six systems. <em>Built with you, owned by you.</em>',
  stack=[
    ("01 · FOUNDATION", "Claude Code, set up properly", "Your workspace, repository, project memory, our skill library for SEO, ads, copy and sales, guardrails, and one-command deployment."),
    ("02 · FUNNELS", "VSL & application engine", "VSL pages, multi-step applications, thank-you flows and A/B tests. This page was built this way."),
    ("03 · TRACKING", "Attribution you trust", "Meta Pixel plus Conversions API server-side, UTM architecture, lead scoring and qualification routing."),
    ("04 · ADS", "Meta ads engine", "Creative, copy, testing and reporting with ad skills, plus competitor research from the Ads Library."),
    ("05 · SALES", "Sales command centre", "Show-up, close rate, CAC and ROAS in one dashboard. Claude reviews every sales call and drafts the follow-up."),
    ("06 · REPLACE", "Your own software", "Client portals, quoting tools, reporting and internal systems: everything you pay others for today."),
  ],
  # terminal
  k4="What it looks like", h_term='You describe it. <em>Claude Code builds it.</em>',
  term='''<span class="p">❯</span> Build a VSL page for our new offer with a 4-step application form,
  Meta Pixel + Conversions API, and send qualified leads to HubSpot.

<span class="c">● Reading CLAUDE.md, skills/funnels, skills/meta-tracking…</span>
<span class="c">● Planning: page, form, /api/apply function, CAPI events, HubSpot sync</span>
<span class="g">✓</span> Created public/offer/index.html          <span class="c">(VSL, sections, form)</span>
<span class="g">✓</span> Created functions/api/apply.js           <span class="c">(validation, scoring)</span>
<span class="g">✓</span> Added CAPI Lead + Schedule events       <span class="c">(server-side, deduped)</span>
<span class="g">✓</span> Tests passing · security review clean
<span class="y">→ Deployed to production in 3m 41s</span>''',
  # calculator
  k5="Run your numbers", h_calc='What is this worth <em>to you?</em>',
  c_agency="Monthly spend on agencies & developers", c_saas="Monthly spend on SaaS you could replace", c_rev="Annual revenue", c_lift="Revenue lift from a better GTM system",
  c_save="Potential annual savings", c_grow="Potential new annual revenue",
  c_fine="Illustration only, not a promise. Savings assume about 60% of spend is replaceable. We go through your real numbers on the call.",
  agency_max=50000, agency_val=12000, agency_step=1000, saas_max=30000, saas_val=4000, saas_step=500, rev_min=500000, rev_max=50000000, rev_val=5000000, rev_step=500000,
  # build plan
  k6="Try it now · free", h_ai='Describe one tool you wish existed. <em>Get the build plan.</em>',
  ai_lead="This runs on the Claude API, behind a function built with Claude Code: the exact workflow you'll learn.",
  ai_company="Your company", ai_company_ph="e.g. 40-person logistics company", ai_users="Who will use it?", ai_users_ph="e.g. sales team and 200 clients",
  ai_tool="The tool you want", ai_tool_ph="e.g. a client portal with shipment status, documents and invoices", ai_systems="Systems to connect (optional)", ai_systems_ph="e.g. HubSpot, Stripe, Google Sheets",
  ai_email="Email (we'll send you a copy)", ai_btn="Generate my build plan",
  # timeline
  k7="The 8 weeks", h_tl='From kickoff to <em>a business that builds itself.</em>',
  tl=[
    ("Week 0: we set it up", "Your environment, skill library, tracking accounts and deployment, done for you before day one."),
    ("Build Days 1–2: live", "Your VSL page, application funnel and server-side tracking go live by the end of day two."),
    ("Weeks 2–4: GTM machine", "Meta ads engine, lead scoring, CRM sync and your sales dashboard."),
    ("Weeks 5–7: replace", "Your first two internal tools in production. Agency and SaaS spend starts coming down."),
    ("Week 8: hand-over", "Security review, documentation and a 90-day roadmap. Your team runs it from here."),
  ],
  # guarantee
  k8="Zero risk", g_days="7", g_label="Days", h_g='7-day money-back guarantee. <em>No questions asked.</em>',
  g_text="Join, meet the team, sit through onboarding and the first Build Day. If within 7 days you're not convinced this is the best investment you'll make this year, tell us and you get every cent back.",
  g_text2="And a build guarantee on top: your VSL page, tracking and at least two internal tools live by day 56, or we keep building with you for free until they are.",
  g_fine="Refund requests must be made in writing within 7 days of your program start date. Build guarantee requires attendance at Build Days and at least 6 of 8 weekly sessions.",
  # value stack
  k9="What's included", h_val='Everything you need. <em>Nothing you don\'t.</em>',
  val=[("Claude Code environment + skill library", "$10,000"), ("VSL & application funnel engine", "$15,000"), ("Server-side tracking & attribution", "$12,000"), ("Meta ads engine", "$15,000"), ("Sales command centre + call analysis", "$12,000"), ("Two internal tools in production", "$40,000"), ("8 × 1:1 sessions + cohort + reviews", "$16,000"), ("Security review of everything you ship", "$5,000")],
  val_total=("Total value", "$125,000"), val_note="Your investment is a fraction of this, and of one year of agency fees. We'll walk you through it on the call.",
  # who
  h_for="This is for you if…", for_l=["You run a business doing $1M+ a year", "You spend $5k+ a month on agencies, developers or SaaS", "You want to launch offers and test markets faster", "You or one person on your team can commit 6 hours a week"],
  h_not="Not for you if…", not_l=["You want to become a professional software engineer", "You want it all done for you (ask about Done-With-You)", "You're pre-revenue or still looking for an idea"],
  # faq
  k10="Questions", faq=[
    ("I've never written code. Can I do this?", "Yes. That's who it's for. You'll learn to describe, review and test while the AI writes the code. Our engineers review everything before it touches production."),
    ("How is this different from a course?", "Nothing here is a video library. We set up your environment, build your funnel and tracking live with you, and review every tool you ship. You leave with working systems, not notes."),
    ("Is what we build secure?", "Every tool gets a security review before going live: secrets, access control, data handling and consent for tracking. Security is part of the program."),
    ("How much does it cost?", "We share pricing on the call after we understand your business, because the right option depends on your size and goals. It's covered by the 7-day money-back guarantee."),
    ("Are you affiliated with Anthropic?", "No. Claude Code is Anthropic's product. We're an independent team that builds with it every day and teaches businesses to do the same."),
  ],
  # apply
  k11="Apply", h_apply='Apply for <em>the next cohort</em>', apply_lead="Five quick steps, under two minutes. If you're a fit, you'll book a 45-minute strategy call where we map exactly what you'll build.",
  s1="Step 1 of 5", s1h="Who are you?", f_name="Full name", f_company="Company", f_site="Website",
  s2="Step 2 of 5", s2h="Your business", f_rev="Annual revenue", rev_opts=[("0-1m", "Under $1M"), ("1m-5m", "$1M–5M"), ("5m-20m", "$5M–20M"), ("20m+", "$20M+")],
  f_spend="Monthly spend on agencies, developers and SaaS", spend_opts=["Under $2k", "$2k–10k", "$10k–30k", "$30k+"],
  s3="Step 3 of 5", s3h="Your main goal", goal_opts=["Cut software & agency costs", "Build a GTM machine and grow revenue", "Both"],
  s4="Step 4 of 5", s4h="What would you build first?", f_first="Describe it in a sentence or two", f_first_ph="e.g. replace our agency's VSL funnels and get proper Meta tracking",
  f_ready="Can you start within 30 days if it's a fit?", ready_opts=[("yes", "Yes"), ("maybe", "Maybe, depends on timing"), ("no", "No, just exploring")],
  s5="Step 5 of 5", s5h="Where should we reach you?", f_email="Email", f_phone="Phone", consent="By applying you agree that we may contact you about your application. We never share your details.",
  back="← Back", nextb="Next →", submit="Submit application",
  # after close
  h_after="Still thinking?", after="Eight weeks from now you'll either be eight weeks older and still paying the agency, or eight weeks older with a GTM machine, your own tools, and a team that knows how to build the next thirty. The only difference is the decision you make now.",
  foot="Claude and Claude Code are trademarks of Anthropic. Operator by Asym is independent and not affiliated with or endorsed by Anthropic. Results vary; no earnings are guaranteed.",
),
"no": dict(
  lang="nb", path="no/", other="/", other_label="English", title="Operator: Claude Code for gründere og bedrifter",
  desc="Bygg om bedriften din med Claude Code. Kutt hundretusener i programvare og byråer, og bygg en salgs- og markedsmaskin: VSL-sider, Meta-annonser med server-side-sporing og salgsdashboard.",
  strip="▶ Se den 9 minutter lange gjennomgangen før du søker. Neste kull: 8 plasser.",
  nav_cta="Søk nå",
  pill="Søknadene er åpne · 8 bedrifter per kull",
  h1='Bygg om bedriften din<br>med <em class="grad">Claude Code</em>.',
  sub="Slutt å betale byråer og programvareleverandører hundretusener i året for det teamet ditt nå kan bygge på dager. Bruk deretter de samme ferdighetene til å bygge en maskin for salg og markedsføring som åpner nye inntektskilder.",
  vsl_tag="GJENNOMGANG · 9 MIN", vsl_title="Se denne før du søker", vsl_small="Hvordan gründere erstatter hundretusener i byrå- og programvarekostnader, og bygger salgssystemer på dager",
  cta="Søk om plass i neste kull", trust=["7 dager pengene tilbake", "Bygget live med teamet ditt", "Dere eier alt"],
  k1="Problemet", h_prob='Du betaler <em>andre</em> for å bygge bedriften din.',
  prob=[
    "Et annonsebyrå til 100–300 000 kr i måneden for annonser, funnels og sporing du ikke ser inn i.",
    "Et utviklerbyrå som ville ha en million og ni måneder for ett internt verktøy.",
    "Tolv abonnementer som hver gjør 40 % av det du trenger, og som ikke snakker sammen.",
    "Og ingen samlet oversikt over hva et lead koster, hvilke annonser som faktisk gir salg, og hvor omsetningen kommer fra.",
  ],
  prob_close="Det er ikke kompetansen det står på. Måten programvare lages på har endret seg de siste 18 månedene. Med et agentisk kodeverktøy som Claude Code beskriver du hva du vil ha, og det skriver, kjører og retter koden. Nesten ingen har vist bedriftseiere hvordan de bruker det skikkelig.",
  k2="To utfall", h_out='Spar pengene. <em>Så mangedobler du dem.</em>',
  save_t="Spar", save_num="1–5 MNOK", save_s="i året, typisk, i byrå-, utvikler- og programvarekostnader",
  save_l=["Erstatt abonnementer med programvare dere eier", "Bygg interne verktøy, portaler og automasjoner på dager", "Slutt å betale retainere for arbeid du kan styre selv"],
  grow_t="Voks", grow_num="Ny omsetning", grow_s="nye tilbud, nye markeder og nye kanaler, lansert på dager i stedet for kvartaler",
  grow_l=["VSL-sider og søknadsfunnels i drift på én dag", "Meta-annonser med server-side-sporing du faktisk kan stole på", "Salgsdashboard som viser hva som lukkes, og hvorfor"],
  k3="Operator-stacken", h_stack='Seks systemer. <em>Bygget med dere, eid av dere.</em>',
  stack=[
    ("01 · FUNDAMENT", "Claude Code, satt opp riktig", "Arbeidsmiljø, repo, prosjektminne, vårt skills-bibliotek for SEO, annonser, copy og salg, sikkerhetsrammer og deploy med én kommando."),
    ("02 · FUNNELS", "VSL- og søknadsmotor", "VSL-sider, søknadsskjema i flere steg, takkesider og A/B-testing. Denne siden ble bygget sånn."),
    ("03 · SPORING", "Attribusjon du stoler på", "Meta Pixel + Conversions API på serversiden, UTM-oppsett, lead-scoring og kvalifisering."),
    ("04 · ANNONSER", "Meta-annonsemotor", "Kreativ, copy, testing og rapportering med annonseskills, pluss konkurrentanalyse fra Ads Library."),
    ("05 · SALG", "Salgssentral", "Oppmøte, lukkerate, CAC og ROAS i ett dashboard. Claude analyserer hver salgssamtale og skriver oppfølgingen."),
    ("06 · ERSTATT", "Deres egen programvare", "Kundeportaler, tilbudsverktøy, rapportering og interne systemer: alt dere betaler andre for i dag."),
  ],
  k4="Slik ser det ut", h_term='Du beskriver det. <em>Claude Code bygger det.</em>',
  term='''<span class="p">❯</span> Bygg en VSL-side for det nye tilbudet vårt med søknadsskjema i 4 steg,
  Meta Pixel + Conversions API, og send kvalifiserte leads til HubSpot.

<span class="c">● Leser CLAUDE.md, skills/funnels, skills/meta-tracking…</span>
<span class="c">● Planlegger: side, skjema, /api/apply-funksjon, CAPI-hendelser, HubSpot-synk</span>
<span class="g">✓</span> Opprettet public/tilbud/index.html       <span class="c">(VSL, seksjoner, skjema)</span>
<span class="g">✓</span> Opprettet functions/api/apply.js         <span class="c">(validering, scoring)</span>
<span class="g">✓</span> La til CAPI Lead + Schedule              <span class="c">(server-side, deduplisert)</span>
<span class="g">✓</span> Tester grønne · sikkerhetsgjennomgang ok
<span class="y">→ Deployet til produksjon på 3m 41s</span>''',
  k5="Regn på det", h_calc='Hva er dette verdt <em>for deg?</em>',
  c_agency="Månedlig kostnad til byråer og utviklere", c_saas="Månedlig kostnad til programvare du kan erstatte", c_rev="Årlig omsetning", c_lift="Økt omsetning fra et bedre salgssystem",
  c_save="Mulig årlig besparelse", c_grow="Mulig ny årlig omsetning",
  c_fine="Kun illustrasjon, ikke et løfte. Besparelsen forutsetter at ca. 60 % av kostnaden kan erstattes. Vi går gjennom deres tall i samtalen.",
  agency_max=500000, agency_val=120000, agency_step=10000, saas_max=300000, saas_val=40000, saas_step=5000, rev_min=5000000, rev_max=500000000, rev_val=50000000, rev_step=5000000,
  k6="Prøv nå · gratis", h_ai='Beskriv ett verktøy du skulle ønske fantes. <em>Få byggeplanen.</em>',
  ai_lead="Dette kjører på Claude API, bak en funksjon bygget med Claude Code. Akkurat den arbeidsflyten du skal lære.",
  ai_company="Bedriften din", ai_company_ph="f.eks. logistikkselskap med 40 ansatte", ai_users="Hvem skal bruke det?", ai_users_ph="f.eks. salgsteamet og 200 kunder",
  ai_tool="Verktøyet du vil ha", ai_tool_ph="f.eks. en kundeportal med sporing av forsendelser, dokumenter og fakturaer", ai_systems="Systemer det skal kobles til (valgfritt)", ai_systems_ph="f.eks. HubSpot, Tripletex, Google Sheets",
  ai_email="E-post (vi sender deg en kopi)", ai_btn="Lag byggeplanen min",
  k7="De 8 ukene", h_tl='Fra oppstart til <em>en bedrift som bygger selv.</em>',
  tl=[
    ("Uke 0: vi setter det opp", "Arbeidsmiljø, skills-bibliotek, sporingskontoer og deploy, ferdig for dere før dag én."),
    ("Build Days 1–2: live", "VSL-siden, søknadsfunnelen og server-side-sporingen er i drift innen slutten av dag to."),
    ("Uke 2–4: salgsmaskinen", "Meta-annonsemotor, lead-scoring, CRM-synk og salgsdashboard."),
    ("Uke 5–7: erstatt", "De to første interne verktøyene i produksjon. Byrå- og programvarekostnadene begynner å gå ned."),
    ("Uke 8: overlevering", "Sikkerhetsgjennomgang, dokumentasjon og en 90-dagers plan. Teamet ditt tar det videre herfra."),
  ],
  k8="Null risiko", g_days="7", g_label="Dager", h_g='7 dager pengene tilbake. <em>Ingen spørsmål.</em>',
  g_text="Bli med, møt teamet, gjennomfør onboarding og første Build Day. Er du ikke overbevist innen 7 dager om at dette er den beste investeringen du gjør i år, sier du fra, og du får hver krone tilbake.",
  g_text2="I tillegg en byggegaranti: VSL-side, sporing og minst to interne verktøy i drift innen dag 56, ellers fortsetter vi å bygge med dere gratis til de er det.",
  g_fine="Krav om refusjon må gis skriftlig innen 7 dager etter programstart. Byggegarantien forutsetter deltakelse på Build Days og minst 6 av 8 ukentlige økter.",
  k9="Dette får du", h_val='Alt du trenger. <em>Ingenting du ikke trenger.</em>',
  val=[("Claude Code-miljø + skills-bibliotek", "110 000 kr"), ("VSL- og søknadsmotor", "160 000 kr"), ("Server-side-sporing og attribusjon", "130 000 kr"), ("Meta-annonsemotor", "160 000 kr"), ("Salgssentral + samtaleanalyse", "130 000 kr"), ("To interne verktøy i produksjon", "430 000 kr"), ("8 × 1:1 + kull + gjennomganger", "170 000 kr"), ("Sikkerhetsgjennomgang av alt dere lanserer", "55 000 kr")],
  val_total=("Total verdi", "1 345 000 kr"), val_note="Investeringen din er en brøkdel av dette, og av ett år med byråhonorarer. Vi går gjennom det i samtalen.",
  h_for="Dette er for deg hvis…", for_l=["Bedriften din omsetter for 10 MNOK+ i året", "Du bruker 50 000 kr+ i måneden på byråer, utviklere eller programvare", "Du vil lansere tilbud og teste markeder raskere", "Du eller én i teamet kan sette av 6 timer i uka"],
  h_not="Ikke for deg hvis…", not_l=["Du vil bli profesjonell utvikler", "Du vil at alt skal gjøres for deg (spør om Done-With-You)", "Du har ingen omsetning ennå eller leter etter en idé"],
  k10="Spørsmål", faq=[
    ("Jeg har aldri skrevet kode. Kan jeg gjøre dette?", "Ja. Det er nettopp dem det er laget for. Du lærer å beskrive, gå gjennom og teste, mens AI-en skriver koden. Ingeniørene våre går gjennom alt før det går i produksjon."),
    ("Hvordan er dette forskjellig fra et kurs?", "Det finnes ikke noe videobibliotek her. Vi setter opp miljøet, bygger funnel og sporing live med dere, og går gjennom hvert verktøy dere lanserer. Dere sitter igjen med systemer som virker, ikke notater."),
    ("Er det vi bygger sikkert?", "Hvert verktøy får en sikkerhetsgjennomgang før det går live: hemmeligheter, tilgangsstyring, datahåndtering og samtykke for sporing. Sikkerhet er en del av programmet."),
    ("Hva koster det?", "Vi deler prisen i samtalen når vi forstår bedriften din, fordi riktig løsning avhenger av størrelse og mål. Alt er dekket av 7 dagers pengene-tilbake-garanti."),
    ("Er dere tilknyttet Anthropic?", "Nei. Claude Code er Anthropics produkt. Vi er et uavhengig team som bygger med det hver dag og lærer bedrifter å gjøre det samme."),
  ],
  k11="Søk", h_apply='Søk om plass i <em>neste kull</em>', apply_lead="Fem raske steg, under to minutter. Passer dere, booker du en 45-minutters strategisamtale der vi kartlegger nøyaktig hva dere skal bygge.",
  s1="Steg 1 av 5", s1h="Hvem er du?", f_name="Fullt navn", f_company="Bedrift", f_site="Nettside",
  s2="Steg 2 av 5", s2h="Bedriften din", f_rev="Årlig omsetning", rev_opts=[("0-10", "Under 10 MNOK"), ("10-50", "10–50 MNOK"), ("50-200", "50–200 MNOK"), ("200+", "200+ MNOK")],
  f_spend="Månedlig kostnad til byråer, utviklere og programvare", spend_opts=["Under 20 000 kr", "20–100 000 kr", "100–300 000 kr", "Over 300 000 kr"],
  s3="Steg 3 av 5", s3h="Hovedmålet ditt", goal_opts=["Kutte programvare- og byråkostnader", "Bygge en salgsmaskin og øke omsetningen", "Begge deler"],
  s4="Steg 4 av 5", s4h="Hva ville du bygget først?", f_first="Beskriv det med en setning eller to", f_first_ph="f.eks. erstatte byråets VSL-funnels og få ordentlig Meta-sporing",
  f_ready="Kan dere starte innen 30 dager hvis det passer?", ready_opts=[("ja", "Ja"), ("kanskje", "Kanskje, avhenger av timing"), ("nei", "Nei, bare nysgjerrig")],
  s5="Steg 5 av 5", s5h="Hvor når vi deg?", f_email="E-post", f_phone="Telefon", consent="Ved å søke godtar du at vi kontakter deg om søknaden. Vi deler aldri opplysningene dine.",
  back="← Tilbake", nextb="Neste →", submit="Send søknad",
  h_after="Fortsatt usikker?", after="Om åtte uker er du enten åtte uker eldre og betaler fortsatt byrået, eller åtte uker eldre med en salgsmaskin, egne verktøy og et team som vet hvordan de bygger de neste tretti. Det eneste som skiller dem er valget du tar nå.",
  foot="Claude og Claude Code er varemerker for Anthropic. Operator by Asym er uavhengig og ikke tilknyttet eller godkjent av Anthropic. Resultater varierer, og ingen inntekt er garantert.",
),
}

def li(items): return "".join(f"<li>{x}</li>" for x in items)

def page(t):
    stack = "".join(f'<div class="card rv"><span class="n">{n}</span><h3>{h}</h3><p>{p}</p></div>' for n, h, p in t["stack"])
    tl = "".join(f"<div class=\"rv\"><div><b>{h}</b><p>{p}</p></div></div>" for h, p in t["tl"])
    val = "".join(f"<div><span>{a}</span><span>{b}</span></div>" for a, b in t["val"])
    faq = "".join(f"<details><summary>{q}</summary><p>{a}</p></details>" for q, a in t["faq"])
    rev = "".join(f'<option value="{v}">{l}</option>' for v, l in t["rev_opts"])
    spend = "".join(f"<option>{o}</option>" for o in t["spend_opts"])
    goal = "".join(f'<label><input type="radio" name="goal" value="{o}" required> {o}</label>' for o in t["goal_opts"])
    ready = "".join(f'<label><input type="radio" name="ready" value="{v}" required> {l}</label>' for v, l in t["ready_opts"])
    trust = "".join(f"<span>{x}</span>" for x in t["trust"])
    prob = "".join(f'<div class="card rv"><p style="color:var(--text)">{x}</p></div>' for x in t["prob"])
    return f'''<!doctype html>
<html lang="{t["lang"]}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>{t["title"]}</title>
<meta name="description" content="{t["desc"]}">
<meta property="og:title" content="{t["title"]}">
<meta property="og:description" content="{t["desc"]}">
<meta name="theme-color" content="#060608">
<link rel="alternate" hreflang="en" href="/">
<link rel="alternate" hreflang="nb" href="/no/">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Instrument+Serif:ital@0;1&family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@500;600&display=swap" rel="stylesheet">
<link rel="stylesheet" href="/assets/op.css">
</head>
<body>
<div class="strip"><a href="#vsl">{t["strip"]}</a></div>
<header class="nav"><div class="wrap">
  <a class="logo" href="/{t["path"]}"><i></i>Operator</a>
  <div class="right"><a class="lang" href="{t["other"]}">{t["other_label"]}</a><a class="btn sm" href="#apply">{t["nav_cta"]}</a></div>
</div></header>

<div class="hero" id="vsl"><div class="wrap">
  <span class="pill"><b></b>{t["pill"]}</span>
  <h1>{t["h1"]}</h1>
  <p class="sub">{t["sub"]}</p>
  <div class="vsl"><div class="inner">
    <!-- VSL: lim inn Cloudflare Stream / Vimeo iframe her -->
    <span class="tag">{t["vsl_tag"]}</span>
    <div class="ph"><div><div class="play"></div><strong>{t["vsl_title"]}</strong><small>{t["vsl_small"]}</small></div></div>
  </div></div>
  <a class="btn" href="#apply">{t["cta"]} →</a>
  <div class="trust">{trust}</div>
</div></div>

<section><div class="wrap">
  <div class="narrow center rv"><span class="kicker">{t["k1"]}</span><h2>{t["h_prob"]}</h2></div>
  <div class="grid g2" style="margin-top:36px">{prob}</div>
  <p class="lead narrow center rv" style="margin-top:34px">{t["prob_close"]}</p>
</div></section>

<section><div class="wrap">
  <div class="center rv"><span class="kicker">{t["k2"]}</span><h2>{t["h_out"]}</h2></div>
  <div class="grid g2" style="margin-top:36px">
    <div class="card big rv"><span class="n">{t["save_t"]}</span><div class="num grad">{t["save_num"]}</div><p>{t["save_s"]}</p><ul class="ticks">{li(t["save_l"])}</ul></div>
    <div class="card big rv"><span class="n">{t["grow_t"]}</span><div class="num grad">{t["grow_num"]}</div><p>{t["grow_s"]}</p><ul class="ticks">{li(t["grow_l"])}</ul></div>
  </div>
</div></section>

<section><div class="wrap">
  <div class="center rv"><span class="kicker">{t["k3"]}</span><h2>{t["h_stack"]}</h2></div>
  <div class="grid g3" style="margin-top:36px">{stack}</div>
</div></section>

<section><div class="wrap narrow">
  <div class="center rv"><span class="kicker">{t["k4"]}</span><h2>{t["h_term"]}</h2></div>
  <div class="term rv" style="margin-top:30px"><div class="bar"><i></i><i></i><i></i></div><pre>{t["term"]}</pre></div>
</div></section>

<section><div class="wrap narrow">
  <div class="center rv"><span class="kicker">{t["k5"]}</span><h2>{t["h_calc"]}</h2></div>
  <div class="calc rv" data-calc style="margin-top:30px">
    <label>{t["c_agency"]} <b data-v="agency"></b></label><input type="range" name="agency" min="0" max="{t["agency_max"]}" step="{t["agency_step"]}" value="{t["agency_val"]}">
    <label>{t["c_saas"]} <b data-v="saas"></b></label><input type="range" name="saas" min="0" max="{t["saas_max"]}" step="{t["saas_step"]}" value="{t["saas_val"]}">
    <label>{t["c_rev"]} <b data-v="revenue"></b></label><input type="range" name="revenue" min="{t["rev_min"]}" max="{t["rev_max"]}" step="{t["rev_step"]}" value="{t["rev_val"]}">
    <label>{t["c_lift"]} <b data-v="lift"></b></label><input type="range" name="lift" min="5" max="50" step="5" value="15" data-kind="pct">
    <div class="out"><div><span>{t["c_save"]}</span><b class="grad" data-save>—</b></div><div><span>{t["c_grow"]}</span><b class="grad" data-grow>—</b></div></div>
    <p class="fine" style="margin-top:16px">{t["c_fine"]}</p>
  </div>
</div></section>

<section id="plan"><div class="wrap narrow">
  <div class="center rv"><span class="kicker">{t["k6"]}</span><h2>{t["h_ai"]}</h2><p class="lead">{t["ai_lead"]}</p></div>
  <div class="apply rv" style="margin-top:26px"><form data-ai novalidate>
    <input class="hp" name="website_hp" tabindex="-1" autocomplete="off">
    <div class="grid g2"><div class="field"><label>{t["ai_company"]}</label><input name="company" required maxlength="160" placeholder="{t["ai_company_ph"]}"></div>
    <div class="field"><label>{t["ai_users"]}</label><input name="users" required maxlength="160" placeholder="{t["ai_users_ph"]}"></div></div>
    <div class="field"><label>{t["ai_tool"]}</label><textarea name="tool" rows="3" required maxlength="600" placeholder="{t["ai_tool_ph"]}"></textarea></div>
    <div class="grid g2"><div class="field"><label>{t["ai_systems"]}</label><input name="systems" maxlength="300" placeholder="{t["ai_systems_ph"]}"></div>
    <div class="field"><label>{t["ai_email"]}</label><input type="email" name="email" required autocomplete="email"></div></div>
    <p class="err" aria-live="polite"></p>
    <button class="btn" type="submit">{t["ai_btn"]}</button>
  </form></div>
  <div data-ai-out></div>
</div></section>

<section><div class="wrap narrow">
  <div class="center rv"><span class="kicker">{t["k7"]}</span><h2>{t["h_tl"]}</h2></div>
  <div class="steps-tl" style="margin-top:30px">{tl}</div>
</div></section>

<section><div class="wrap">
  <div class="guar rv">
    <div class="seal"><div><div><b class="grad">{t["g_days"]}</b><span>{t["g_label"]}</span></div></div></div>
    <div><span class="kicker">{t["k8"]}</span><h2 style="font-size:clamp(28px,3.6vw,42px)">{t["h_g"]}</h2><p class="lead">{t["g_text"]}</p><p>{t["g_text2"]}</p><p class="fine">{t["g_fine"]}</p></div>
  </div>
</div></section>

<section><div class="wrap narrow">
  <div class="center rv"><span class="kicker">{t["k9"]}</span><h2>{t["h_val"]}</h2></div>
  <div class="stack rv" style="margin-top:30px">{val}<div class="tot"><span>{t["val_total"][0]}</span><span>{t["val_total"][1]}</span></div></div>
  <p class="lead center rv" style="margin-top:22px">{t["val_note"]}</p>
  <p class="center rv" style="margin-top:22px"><a class="btn" href="#apply">{t["cta"]} →</a></p>
</div></section>

<section><div class="wrap">
  <div class="grid g2">
    <div class="card rv"><h3>{t["h_for"]}</h3><ul class="ticks">{li(t["for_l"])}</ul></div>
    <div class="card rv"><h3>{t["h_not"]}</h3><ul class="ticks x">{li(t["not_l"])}</ul></div>
  </div>
</div></section>

<section><div class="wrap narrow">
  <div class="center rv"><span class="kicker">{t["k10"]}</span></div>
  {faq}
</div></section>

<section id="apply"><div class="wrap narrow">
  <div class="center rv"><span class="kicker">{t["k11"]}</span><h2>{t["h_apply"]}</h2><p class="lead">{t["apply_lead"]}</p></div>
  <div class="apply" style="margin-top:30px"><form data-apply novalidate>
    <input type="hidden" name="offer" value="operator">
    <input class="hp" name="website_hp" tabindex="-1" autocomplete="off">
    <div class="progress"><i></i><i></i><i></i><i></i><i></i></div>
    <div class="step"><span class="stepno">{t["s1"]}</span><h3>{t["s1h"]}</h3>
      <div class="field"><label>{t["f_name"]}</label><input name="name" required autocomplete="name"></div>
      <div class="field"><label>{t["f_company"]}</label><input name="company" required autocomplete="organization"></div>
      <div class="field"><label>{t["f_site"]}</label><input name="website" placeholder="https://"></div></div>
    <div class="step"><span class="stepno">{t["s2"]}</span><h3>{t["s2h"]}</h3>
      <div class="field"><label>{t["f_rev"]}</label><select name="revenue" required><option value="">—</option>{rev}</select></div>
      <div class="field"><label>{t["f_spend"]}</label><select name="spend" required><option value="">—</option>{spend}</select></div></div>
    <div class="step"><span class="stepno">{t["s3"]}</span><h3>{t["s3h"]}</h3><div class="opts">{goal}</div></div>
    <div class="step"><span class="stepno">{t["s4"]}</span><h3>{t["s4h"]}</h3>
      <div class="field"><label>{t["f_first"]}</label><textarea name="pain" rows="3" required placeholder="{t["f_first_ph"]}"></textarea></div>
      <div class="field"><label>{t["f_ready"]}</label><div class="opts">{ready}</div></div></div>
    <div class="step"><span class="stepno">{t["s5"]}</span><h3>{t["s5h"]}</h3>
      <div class="field"><label>{t["f_email"]}</label><input type="email" name="email" required autocomplete="email"></div>
      <div class="field"><label>{t["f_phone"]}</label><input type="tel" name="phone" required autocomplete="tel"></div>
      <p class="consent">{t["consent"]}</p></div>
    <p class="err" aria-live="polite"></p>
    <div class="formnav"><button class="btn ghost sm" data-prev>{t["back"]}</button><button class="btn sm" data-next>{t["nextb"]}</button><button class="btn" type="submit" data-submit>{t["submit"]}</button></div>
  </form></div>
</div></section>

<section><div class="wrap narrow center rv">
  <h2>{t["h_after"]}</h2><p class="lead">{t["after"]}</p>
  <p style="margin-top:26px"><a class="btn" href="#apply">{t["cta"]} →</a></p>
</div></section>

<footer><div class="wrap"><span>© Operator by Asym</span><span style="max-width:640px">{t["foot"]}</span></div></footer>
<script src="/assets/op.js"></script>
</body>
</html>
'''

THANKS = {
  "en": dict(lang="en", file="thanks/index.html", home="/", title="Application received", h="Application received. <em>One step left.</em>",
             book="You look like a strong fit. Pick a time for your strategy call now and we'll hold your seat.", bookbtn="Pick a time →",
             wait="We'll review your application and get back to you within one business day.",
             tips=["Add the call to your calendar. Seats are limited; missed calls are released.", "Before the call we review your website and current funnel. You keep the notes either way.", "Bring your numbers: monthly agency, developer and SaaS spend, and your revenue goals."]),
  "no": dict(lang="nb", file="no/takk/index.html", home="/no/", title="Søknad mottatt", h="Søknad mottatt. <em>Ett steg igjen.</em>",
             book="Dere ser ut som en god match. Velg tidspunkt for strategisamtalen nå, så holder vi av plassen.", bookbtn="Velg tidspunkt →",
             wait="Vi går gjennom søknaden og tar kontakt innen én virkedag.",
             tips=["Legg samtalen i kalenderen. Plassene er få, og uteblir du, går plassen videre.", "Før samtalen går vi gjennom nettsiden og dagens funnel. Notatene får du uansett.", "Ha tallene klare: månedlige kostnader til byrå, utviklere og programvare, og målene for omsetning."]),
}

def thanks(t):
    tips = "".join(f'<div class="card"><span class="n">0{i+1}</span><p style="color:var(--text)">{x}</p></div>' for i, x in enumerate(t["tips"]))
    return f'''<!doctype html>
<html lang="{t["lang"]}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex">
<title>{t["title"]} · Operator</title>
<link href="https://fonts.googleapis.com/css2?family=Instrument+Serif:ital@0;1&family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@500;600&display=swap" rel="stylesheet">
<link rel="stylesheet" href="/assets/op.css"></head>
<body><header class="nav"><div class="wrap"><a class="logo" href="{t["home"]}"><i></i>Operator</a></div></header>
<div class="hero"><div class="wrap narrow">
  <span class="pill"><b></b>{t["title"]}</span><h1 style="font-size:clamp(36px,6vw,64px)">{t["h"]}</h1>
  <div id="book" style="display:none"><p class="sub">{t["book"]}</p><a class="btn" id="booklink" href="#" target="_blank" rel="noopener">{t["bookbtn"]}</a></div>
  <p class="sub" id="wait">{t["wait"]}</p>
  <div class="grid g3" style="margin-top:40px;text-align:left">{tips}</div>
</div></div>
<script>(function(){{var q=new URLSearchParams(location.search),u=q.get("book");if(u&&/^https:\\/\\//.test(u)){{document.getElementById("book").style.display="";document.getElementById("wait").style.display="none";document.getElementById("booklink").href=u;}}}})();</script>
</body></html>
'''

for key, t in T.items():
    out = HERE / t["path"] / "index.html"
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(page(t), encoding="utf-8")
for key, t in THANKS.items():
    out = HERE / t["file"]
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(thanks(t), encoding="utf-8")
print("built")
