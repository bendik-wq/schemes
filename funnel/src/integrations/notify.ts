// Slack / Discord team pings. Only the name, ref, tier and a dashboard link: never email, phone,
// answers or transcripts. Lead text is stripped of markup; mentions are explicit only.

import type { Runtime } from "../app";
import { effectiveTier, type Lead } from "../funnel/leads";
import { chatSafe } from "../lib/text";
import { getRep, type Rep } from "../sales/reps";
import { isHttps, validOutbound } from "../lib/outbound";

export type NotifyKind =
  | "hot_lead" | "qualified" | "booked" | "rescheduled" | "cancelled" | "call_soon" | "no_show" | "showed" | "won" | "lost"
  | "ai_call" | "callback_request" | "test" | "complaint" | "noshow_risk" | "needs_outcome";

const HEAD: Record<NotifyKind, string> = {
  hot_lead: "Hot lead (A tier)",
  qualified: "Qualified lead (B tier)",
  booked: "Call booked",
  rescheduled: "Call rescheduled",
  cancelled: "Call cancelled",
  call_soon: "Call in 15 minutes",
  no_show: "No-show",
  showed: "Call held",
  won: "Won",
  lost: "Lost",
  ai_call: "AI call result",
  callback_request: "Callback requested",
  test: "Test ping from Funnel HQ",
  complaint: "Spam complaint",
  noshow_risk: "High no-show risk",
  needs_outcome: "Call needs an outcome",
};

const WIN_KINDS = new Set<NotifyKind>(["won"]);

export function formatPing(kind: NotifyKind, lead: Pick<Lead, "id" | "first_name" | "last_name" | "ref_code" | "tier" | "tier_override"> | null, origin: string, extra?: string) {
  const name = lead ? chatSafe([lead.first_name, lead.last_name].filter(Boolean).join(" ") || "Lead", 60) : "";
  const tier = lead ? effectiveTier(lead) : null;
  const parts = [HEAD[kind]];
  if (lead) parts.push(`${name} · ${chatSafe(lead.ref_code, 20)}${tier ? ` · tier ${tier}` : ""}`);
  if (extra) parts.push(chatSafe(extra, 200));
  const link = lead ? `${origin}/admin#lead=${encodeURIComponent(lead.id)}` : `${origin}/admin`;
  return { title: parts[0], line: parts.slice(1).join(" — "), link };
}

async function post(url: string, body: unknown): Promise<boolean> {
  if (!isHttps(url)) return false;
  try {
    const r = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    return r.ok;
  } catch {
    return false;
  }
}

/** An extra link under the ping, e.g. the signed one-tap outcome page. Only https links on our own origin. */
export interface PingAction { label: string; url: string }

function ownLink(rt: Runtime, a: PingAction | undefined): PingAction | null {
  if (!a) return null;
  try {
    const u = new URL(a.url);
    if (u.origin !== new URL(rt.origin).origin || !/^[\w./-]+$/.test(u.pathname)) return null;
    return { label: chatSafe(a.label, 40).replace(/[<>|]/g, ""), url: u.toString() };
  } catch {
    return null;
  }
}

export async function notifyTeam(rt: Runtime, kind: NotifyKind, lead: Lead | null, extra?: string, action?: PingAction): Promise<{ slack: boolean; discord: boolean }> {
  if (lead && lead.booking_source === "calendly-direct") return { slack: false, discord: false };
  const s = rt.settings;
  const p = formatPing(kind, lead, rt.origin, extra);
  const rep = lead ? await getRep(rt, lead.closer_id) : null;
  const win = WIN_KINDS.has(kind);
  const pick = (k: string) => (validOutbound(k, s.get(k)) ? s.get(k) : "");
  const slackUrl = (win && pick("SLACK_WINS_WEBHOOK_URL")) || pick("SLACK_WEBHOOK_URL");
  const discordUrl = (win && pick("DISCORD_WINS_WEBHOOK_URL")) || pick("DISCORD_WEBHOOK_URL");
  const out = { slack: false, discord: false };
  const act = ownLink(rt, action);
  if (slackUrl) {
    const mention = rep?.slack_user_id && /^[A-Z0-9]+$/.test(rep.slack_user_id) ? `<@${rep.slack_user_id}> ` : "";
    out.slack = await post(slackUrl, {
      text: `${p.title}${p.line ? `: ${p.line}` : ""}`,
      blocks: [
        { type: "section", text: { type: "mrkdwn", text: `*${p.title}*${p.line ? `\n${mention}${p.line}` : ""}` } },
        { type: "context", elements: [{ type: "mrkdwn", text: `<${p.link}|Open in Funnel HQ>${act ? ` · <${act.url}|${act.label}>` : ""}` }] },
      ],
      unfurl_links: false,
    });
  }
  if (discordUrl) {
    const mention = rep?.discord_user_id && /^\d+$/.test(rep.discord_user_id) ? `<@${rep.discord_user_id}> ` : "";
    out.discord = await post(discordUrl, {
      content: `**${p.title}**${p.line ? `\n${mention}${p.line}` : ""}\n${p.link}${act ? `\n${act.label}: <${act.url}>` : ""}`,
      allowed_mentions: { parse: [], users: rep?.discord_user_id && /^\d+$/.test(rep.discord_user_id) ? [rep.discord_user_id] : [] },
    });
  }
  return out;
}

export async function notifyText(rt: Runtime, title: string, lines: string[]): Promise<void> {
  const s = rt.settings;
  const body = [title, ...lines.map((l) => chatSafe(l, 300))].join("\n");
  if (validOutbound("SLACK_WEBHOOK_URL", s.get("SLACK_WEBHOOK_URL")) && s.get("SLACK_WEBHOOK_URL")) await post(s.get("SLACK_WEBHOOK_URL"), { text: body, unfurl_links: false });
  if (validOutbound("DISCORD_WEBHOOK_URL", s.get("DISCORD_WEBHOOK_URL")) && s.get("DISCORD_WEBHOOK_URL")) await post(s.get("DISCORD_WEBHOOK_URL"), { content: body, allowed_mentions: { parse: [] } });
}

/** A message for one rep (their follow-up list): posted to the team channel with an explicit mention. */
export async function notifyRep(rt: Runtime, rep: Pick<Rep, "name" | "slack_user_id" | "discord_user_id"> | null, title: string, lines: string[], link?: string): Promise<{ slack: boolean; discord: boolean }> {
  const s = rt.settings;
  const out = { slack: false, discord: false };
  const body = lines.map((l) => chatSafe(l, 300)).join("\n");
  const href = link || `${rt.origin}/admin#sales`;
  const slackUrl = validOutbound("SLACK_WEBHOOK_URL", s.get("SLACK_WEBHOOK_URL")) ? s.get("SLACK_WEBHOOK_URL") : "";
  const discordUrl = validOutbound("DISCORD_WEBHOOK_URL", s.get("DISCORD_WEBHOOK_URL")) ? s.get("DISCORD_WEBHOOK_URL") : "";
  const slackId = rep?.slack_user_id && /^[A-Z0-9]+$/.test(rep.slack_user_id) ? rep.slack_user_id : null;
  const discordId = rep?.discord_user_id && /^\d+$/.test(rep.discord_user_id) ? rep.discord_user_id : null;
  const who = rep ? chatSafe(rep.name, 60) : "";
  if (slackUrl) {
    out.slack = await post(slackUrl, {
      text: `${title}${who ? ` · ${who}` : ""}`,
      blocks: [
        { type: "section", text: { type: "mrkdwn", text: `*${title}*${slackId ? ` <@${slackId}>` : who ? ` · ${who}` : ""}\n${body}` } },
        { type: "context", elements: [{ type: "mrkdwn", text: `<${href}|Open in Funnel HQ>` }] },
      ],
      unfurl_links: false,
    });
  }
  if (discordUrl) {
    out.discord = await post(discordUrl, {
      content: `**${title}**${discordId ? ` <@${discordId}>` : who ? ` · ${who}` : ""}\n${body}\n${href}`,
      allowed_mentions: { parse: [], users: discordId ? [discordId] : [] },
    });
  }
  return out;
}
