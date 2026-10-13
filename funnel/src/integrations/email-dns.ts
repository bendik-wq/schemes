// Sending-domain check for the Integrations screen: SPF, DKIM, DMARC and From-domain alignment,
// looked up with DNS-over-HTTPS (cloudflare-dns.com). Read-only; nothing is changed.

import type { Runtime } from "../app";

export type DnsState = "pass" | "warn" | "fail";
export interface DnsCheck { id: string; label: string; state: DnsState; detail: string; records: string[] }
export interface DnsRecords { root: string[]; send: string[]; dkim: string[]; dmarc: string[] }

const DOMAIN_RE = /^(?=.{3,253}$)([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;

/** "Name <hi@mail.example.com>" or "hi@example.com" → "mail.example.com". */
export function fromDomain(from: string): string | null {
  const m = from.match(/<?[^\s<>@]+@([^\s<>]+?)>?\s*$/);
  const d = m ? m[1].toLowerCase().replace(/\.$/, "") : "";
  return DOMAIN_RE.test(d) ? d : null;
}

const spf = (txt: string[]) => txt.filter((t) => /^v=spf1(\s|$)/i.test(t.trim()));

/** Pure: grade the records for a From domain sending through Resend (return path on send.<domain>). */
export function assessEmailDns(domain: string, r: DnsRecords): DnsCheck[] {
  const out: DnsCheck[] = [];
  const rootSpf = spf(r.root);
  out.push({
    id: "spf", label: `SPF on ${domain}`, records: rootSpf,
    ...(rootSpf.length === 1 ? { state: "pass" as const, detail: "Exactly one SPF record." }
      : rootSpf.length === 0 ? { state: "warn" as const, detail: "No SPF record at the root. Resend uses send." + domain + ", but other senders on this domain need one." }
      : { state: "fail" as const, detail: `${rootSpf.length} SPF records. Receivers treat more than one as an error: merge them into one.` }),
  });
  const sendSpf = spf(r.send);
  out.push({
    id: "spf_send", label: `SPF on send.${domain} (Resend return path)`, records: sendSpf,
    ...(sendSpf.length === 1 && /amazonses\.com/i.test(sendSpf[0]) ? { state: "pass" as const, detail: "One SPF record that includes amazonses.com." }
      : sendSpf.length > 1 ? { state: "fail" as const, detail: `${sendSpf.length} SPF records on send.${domain}: keep exactly one.` }
      : sendSpf.length === 1 ? { state: "warn" as const, detail: "SPF found but it does not include amazonses.com, which Resend sends through." }
      : { state: "fail" as const, detail: "Missing. Add the TXT record Resend shows for send." + domain + "." }),
  });
  const dkim = r.dkim.filter((t) => /(^|;)\s*p=[A-Za-z0-9+/=]{20,}/.test(t.replace(/\s+/g, "")));
  out.push({
    id: "dkim", label: `DKIM (resend._domainkey.${domain})`, records: r.dkim.map((t) => (t.length > 80 ? t.slice(0, 77) + "…" : t)),
    ...(dkim.length ? { state: "pass" as const, detail: "Public key published." } : { state: "fail" as const, detail: "No DKIM key found. Add the resend._domainkey TXT record from Resend." }),
  });
  const dmarc = r.dmarc.filter((t) => /^v=DMARC1/i.test(t.trim()));
  const policy = dmarc.length === 1 ? (dmarc[0].match(/(?:^|;)\s*p\s*=\s*(none|quarantine|reject)/i)?.[1] || "").toLowerCase() : "";
  out.push({
    id: "dmarc", label: `DMARC (_dmarc.${domain})`, records: dmarc,
    ...(dmarc.length > 1 ? { state: "fail" as const, detail: "More than one DMARC record: keep exactly one." }
      : !dmarc.length ? { state: "fail" as const, detail: "No DMARC record. Start with v=DMARC1; p=none; rua=mailto:… and tighten later." }
      : policy === "none" ? { state: "warn" as const, detail: "Policy p=none: monitoring only. Move to quarantine once reports look clean." }
      : policy ? { state: "pass" as const, detail: `Policy p=${policy}.` } : { state: "fail" as const, detail: "DMARC record has no valid p= policy." }),
  });
  const strictDkim = dmarc.length === 1 && /(?:^|;)\s*adkim\s*=\s*s/i.test(dmarc[0]);
  out.push({
    id: "alignment", label: "From-domain alignment", records: [],
    ...(dkim.length ? { state: "pass" as const, detail: `DKIM signs as ${domain}, the same domain as From${strictDkim ? " (strict alignment)" : ""}.` }
      : { state: "fail" as const, detail: "Without DKIM on the From domain, DMARC cannot align. Fix DKIM first." }),
  });
  return out;
}

/** TXT records for a name via DNS-over-HTTPS. Quoted chunks are joined. */
export async function dohTxt(name: string): Promise<string[]> {
  const r = await fetch(`https://cloudflare-dns.com/dns-query?name=${encodeURIComponent(name)}&type=TXT`, { headers: { accept: "application/dns-json" } });
  if (!r.ok) throw new Error(`DNS lookup failed (${r.status})`);
  const j = (await r.json().catch(() => ({}))) as { Answer?: Array<{ type: number; data: string }> };
  return (j.Answer || []).filter((a) => a.type === 16 && typeof a.data === "string")
    .map((a) => (a.data.match(/"((?:[^"\\]|\\.)*)"/g) || [a.data]).map((c) => c.replace(/^"|"$/g, "").replace(/\\"/g, '"')).join("").slice(0, 2000));
}

export async function checkEmailDns(rt: Runtime): Promise<{ domain: string | null; checks: DnsCheck[]; error?: string }> {
  const domain = fromDomain(rt.settings.get("EMAIL_FROM"));
  if (!domain) return { domain: null, checks: [], error: "Set the From address (Name <you@yourdomain.com>) first." };
  try {
    const [root, send, dkim, dmarc] = await Promise.all([dohTxt(domain), dohTxt(`send.${domain}`), dohTxt(`resend._domainkey.${domain}`), dohTxt(`_dmarc.${domain}`)]);
    return { domain, checks: assessEmailDns(domain, { root, send, dkim, dmarc }) };
  } catch (e) {
    return { domain, checks: [], error: (e instanceof Error ? e.message : String(e)).slice(0, 200) };
  }
}
