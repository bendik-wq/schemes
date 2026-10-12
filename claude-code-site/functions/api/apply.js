// Cloudflare Pages Function: POST /api/apply
// Videresender søknader til en webhook (Zapier / Make / Slack / CRM).
// Sett i Cloudflare → Pages → Settings → Variables:
//   WEBHOOK_URL        (påkrevd) f.eks. Zapier "Catch Hook"-URL
//   CALENDAR_URL       (valgfri) Calendly/Cal.com for kvalifiserte leads
// Valgfritt: bind et KV-namespace som LEADS for å lagre kopi av hver søknad.

// Engelsk side bruker USD-intervaller, norsk bruker MNOK.
const QUALIFIED_REVENUE = ["1m-5m", "5m-20m", "20m+", "10-50", "50-200", "200+"];

export async function onRequestPost({ request, env }) {
  let data;
  try {
    data = await request.json();
  } catch {
    return json({ error: "Ugyldig forespørsel" }, 400);
  }

  // Enkel spam-felle (skjult felt) og påkrevde felt
  if (data.website_hp) return json({ redirect: data.lang === "no" ? "/no/takk/" : "/thanks/" }); // stille avvisning av bots
  for (const k of ["name", "email", "company"]) {
    if (!data[k] || String(data[k]).trim().length < 2) return json({ error: data.lang === "no" ? "Mangler " + k : "Missing " + k }, 400);
  }

  const qualified = QUALIFIED_REVENUE.includes(data.revenue) && !["nei", "no"].includes(data.ready);
  const lead = {
    ...data,
    qualified,
    received_at: new Date().toISOString(),
    ip_country: request.headers.get("cf-ipcountry") || "",
  };

  if (env.LEADS) {
    await env.LEADS.put(`lead:${Date.now()}:${crypto.randomUUID()}`, JSON.stringify(lead));
  }
  if (env.WEBHOOK_URL) {
    const r = await fetch(env.WEBHOOK_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(lead),
    }).catch(() => null);
    if (!r || !r.ok) return json({ error: "Kunne ikke lagre søknaden" }, 502);
  } else if (!env.LEADS) {
    return json({ error: data.lang === "no" ? "Skjemaet er ikke koblet til ennå" : "The form is not connected yet" }, 500);
  }

  const thanks = data.lang === "no" ? "/no/takk/" : "/thanks/";
  const redirect = qualified && env.CALENDAR_URL
    ? `${thanks}?book=${encodeURIComponent(env.CALENDAR_URL)}&name=${encodeURIComponent(data.name)}`
    : thanks;
  return json({ ok: true, redirect });
}

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8" },
  });
}
