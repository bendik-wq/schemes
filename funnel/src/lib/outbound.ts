// Outbound URLs the Worker posts lead data to. Only https, and only the hosts each integration uses.

export function isHttps(u: string): URL | null {
  try {
    const x = new URL(u);
    return x.protocol === "https:" ? x : null;
  } catch {
    return null;
  }
}

export function validOutbound(key: string, value: string): boolean {
  if (!value) return true;
  const u = isHttps(value);
  if (!u) return false;
  if (/^SLACK_/.test(key)) return u.hostname === "hooks.slack.com";
  if (/^DISCORD_/.test(key)) return /^(discord\.com|discordapp\.com|ptb\.discord\.com|canary\.discord\.com)$/.test(u.hostname) && u.pathname.startsWith("/api/webhooks/");
  if (key === "POSTHOG_HOST") return /(^|\.)posthog\.com$/.test(u.hostname);
  return true; // LEAD_WEBHOOK_URL, PUBLIC_URL: any https host
}

export const OUTBOUND_KEYS = ["SLACK_WEBHOOK_URL", "SLACK_WINS_WEBHOOK_URL", "DISCORD_WEBHOOK_URL", "DISCORD_WINS_WEBHOOK_URL", "LEAD_WEBHOOK_URL", "POSTHOG_HOST", "PUBLIC_URL"];
