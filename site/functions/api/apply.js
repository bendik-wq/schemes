// Cloudflare Pages Function: POST /api/apply
// Videresender søknader til en webhook (Zapier / Make / Slack / CRM).
// Sett i Cloudflare → Pages → Settings → Variables:
//   WEBHOOK_URL        (påkrevd) f.eks. Zapier "Catch Hook"-URL
//   CALENDAR_URL       (valgfri) Calendly/Cal.com for kvalifiserte leads
// Valgfritt: bind et KV-namespace som LEADS for å lagre kopi av hver søknad.

const QUALIFIED_REVENUE = ["20-50", "50-200", "200+"];

export async function onRequestPost({ request, env }) {
  let data;
  try {
    data = await request.json();
  } catch {
    return json({ error: "Ugyldig forespørsel" }, 400);
  }

  // Enkel spam-felle (skjult felt) og påkrevde felt
  if (data.website_hp) return json({ redirect: "/takk/" });
  for (const k of ["name", "email", "company"]) {
    if (!data[k] || String(data[k]).trim().length < 2) return json({ error: "Mangler " + k }, 400);
  }

  const qualified = QUALIFIED_REVENUE.includes(data.revenue) && data.ready !== "nei";
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
    });
    if (!r.ok) return json({ error: "Kunne ikke lagre søknaden" }, 502);
  } else if (!env.LEADS) {
    return json({ error: "Skjemaet er ikke koblet til ennå (WEBHOOK_URL mangler)" }, 500);
  }

  const redirect = qualified && env.CALENDAR_URL
    ? `/takk/?book=${encodeURIComponent(env.CALENDAR_URL)}&name=${encodeURIComponent(data.name)}`
    : "/takk/";
  return json({ ok: true, redirect });
}

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8" },
  });
}
