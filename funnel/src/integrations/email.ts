// Email engine: queue, claim, re-check, build, personalise, send (Resend) or simulate.
// Every link is a signed redirect; every email has an open pixel, one-click unsubscribe
// (RFC 8058) and the postal address in both parts.

import type { Runtime } from "../app";
import { isTestLead } from "../admin/testdata";
import { BRAND } from "../config";
import { escHtml, unescHtml } from "../lib/text";
import { signShort } from "../lib/crypto";
import { newId } from "../lib/ids";
import { signingSecret } from "../lib/secret";
import { countryTimezone } from "../lib/phone";
import { getLead, effectiveTier, type Lead } from "../funnel/leads";
import { buildDossier } from "../followup/dossier";
import { getRep } from "../sales/reps";
import { track } from "../tracking/track";
import {
  SEQUENCES, PRECALL_MAX_TOTAL, PRECALL_PER_DAY_DEFAULT, PRECALL_UNOPENED_STOP, TRANSACTIONAL,
  localDayStart, maxLateMs, nextLocalMorning, precallTimes, quietUntil, respectsQuietHours, validTimezone,
} from "./sequences";
import { processSmsQueue, scheduleSmsReminders, smsReminderDelivered } from "./sms";
import { TEMPLATES, precallPlan } from "./all-templates";
import type { EmailContent, EmailCtx } from "./email-types";
import { personalizeEmail } from "../personalize/personalize";
import { PAUSABLE_SEQUENCES, leadEmailStatus, marketingPause } from "../lib/suppress";

export interface EmailRow {
  id: string;
  lead_id: string;
  sequence: string;
  step: number;
  template: string;
  send_at: number;
  status: string;
  attempts: number;
  subject: string | null;
}

const SAFE_PATH = /^\/(?!\/)[^\s\\]*$/;

export function isSafePath(p: string): boolean {
  return SAFE_PATH.test(p) && !/[\u0000-\u001f]/.test(p);
}

export async function linkSig(rt: Runtime, emailId: string, path: string): Promise<string> {
  return signShort(await signingSecret(rt.env), `r|${emailId}|${path}`);
}

export async function unsubSig(rt: Runtime, leadId: string): Promise<string> {
  return signShort(await signingSecret(rt.env), `u|${leadId}`);
}

export async function unsubscribeUrl(rt: Runtime, leadId: string): Promise<string> {
  return `${rt.origin}/u/${leadId}/${await unsubSig(rt, leadId)}`;
}

/** The lead's time zone: stored, then their browser, then their country, then the sales tz. */
export async function leadTimezone(rt: Runtime, lead: Lead): Promise<string> {
  if (validTimezone(lead.timezone)) return lead.timezone as string;
  const s = await rt.env.DB.prepare(
    "SELECT client_tz FROM sessions WHERE (lead_id = ? OR visitor_id = ?) AND client_tz IS NOT NULL ORDER BY last_seen_at DESC LIMIT 1",
  ).bind(lead.id, lead.visitor_id || "").first<{ client_tz: string }>();
  if (validTimezone(s?.client_tz)) return s!.client_tz;
  const c = countryTimezone(lead.country);
  if (c) return c;
  const sales = rt.settings.get("SALES_TIMEZONE") || BRAND.salesTimezone;
  return validTimezone(sales) ? sales : "UTC";
}

export function formatCallTime(ms: number, tz: string): string {
  const zone = validTimezone(tz) ? tz : "UTC";
  const day = new Intl.DateTimeFormat("en-GB", { timeZone: zone, weekday: "long", day: "numeric", month: "long" }).format(new Date(ms));
  const time = new Intl.DateTimeFormat("en-GB", { timeZone: zone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date(ms));
  const tzName = new Intl.DateTimeFormat("en-GB", { timeZone: zone, timeZoneName: "short" }).formatToParts(new Date(ms)).find((p) => p.type === "timeZoneName")?.value || zone;
  return `${day} at ${time} (${tzName})`;
}

export function bookPathFor(lead: Pick<Lead, "tier" | "tier_override">): string {
  return effectiveTier(lead) === "C" ? "/resources" : "/book";
}

export async function buildCtx(rt: Runtime, lead: Lead, emailId: string): Promise<EmailCtx> {
  const secret = await signingSecret(rt.env);
  const tz = await leadTimezone(rt, lead);
  const rep = await getRep(rt, lead.closer_id);
  const links = new Map<string, string>();
  for (const p of ["/", "/apply", "/book", "/breakout", "/resources", "/go/join", "/go/reschedule", "/go/confirm", "/go/requalify", "/refer", "/proof/submit"]) {
    links.set(p, `${rt.origin}/r/${emailId}/${await signShort(secret, `r|${emailId}|${p}`)}?u=${encodeURIComponent(p)}`);
  }
  // The lead's own written call plan (served only once a plan exists).
  const planPath = `/plan/for/${lead.id}`;
  links.set(planPath, `${rt.origin}/r/${emailId}/${await signShort(secret, `r|${emailId}|${planPath}`)}?u=${encodeURIComponent(planPath)}`);
  const link = (path: string) => {
    const p = isSafePath(path) ? path : "/";
    return links.get(p) || links.get("/") as string;
  };
  return {
    lead,
    d: buildDossier(lead),
    firstName: buildDossier(lead).firstName,
    link,
    a: (path, label) => `<a href="${escHtml(link(path))}" style="color:#0a62d6;text-decoration:underline">${escHtml(label)}</a>`,
    bookPath: bookPathFor(lead),
    callTime: lead.call_at ? escHtml(formatCallTime(lead.call_at, tz)) : null,
    closerName: escHtml(rep?.name || BRAND.founder),
    sigName: escHtml(rt.settings.get("EMAIL_SIGNATURE") || BRAND.founder),
    now: rt.now(),
  };
}

export interface Rendered { subject: string; html: string; text: string; }

function htmlToText(html: string): string {
  return unescHtml(
    html
      .replace(/<a [^>]*href="([^"]+)"[^>]*>(.*?)<\/a>/gi, (_m, href, label) => `${label} (${unescHtml(href)})`)
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<[^>]+>/g, ""),
  );
}

export function renderEmail(
  content: EmailContent,
  opts: { link: (p: string) => string; unsubUrl: string; pixelUrl: string | null; address: string; sigName: string; company: string },
): Rendered {
  const subject = content.subject.replace(/[\r\n]+/g, " ").slice(0, 120);
  const ctaHtml = content.cta
    ? `<p style="margin:28px 0"><a href="${escHtml(opts.link(content.cta.path))}" style="display:inline-block;background:#0a62d6;color:#ffffff;text-decoration:none;padding:12px 22px;border-radius:999px;font-weight:600;font-size:15px">${escHtml(content.cta.label)}</a></p>`
    : "";
  const paras = content.paragraphs.map((p) => `<p style="margin:0 0 16px">${p}</p>`).join("\n");
  const ps = content.ps ? `<p style="margin:24px 0 0;color:#424245">PS. ${content.ps}</p>` : "";
  const pre = content.preheader ? `<div style="display:none;max-height:0;overflow:hidden;opacity:0">${escHtml(content.preheader)}</div>` : "";
  const pixel = opts.pixelUrl ? `<img src="${escHtml(opts.pixelUrl)}" width="1" height="1" alt="" style="display:block;border:0">` : "";
  const html = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>${escHtml(subject)}</title></head>
<body style="margin:0;padding:0;background:#ffffff">${pre}
<div style="max-width:560px;margin:0 auto;padding:32px 24px;font:16px/1.6 -apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;color:#1d1d1f">
${paras}
${ctaHtml}
<p style="margin:24px 0 0">${opts.sigName}</p>
${ps}
<hr style="border:0;border-top:1px solid #d2d2d7;margin:36px 0 16px">
<p style="margin:0;font-size:12px;line-height:1.5;color:#6e6e73">${escHtml(opts.company)} · ${escHtml(opts.address)}<br>
You are getting this because you applied for ${escHtml(BRAND.name)}. <a href="${escHtml(opts.unsubUrl)}" style="color:#6e6e73">Unsubscribe</a> and we will stop every email at once.</p>
</div>${pixel}</body></html>`;
  const textParts = [
    ...content.paragraphs.map(htmlToText),
    content.cta ? `${content.cta.label}: ${opts.link(content.cta.path)}` : "",
    unescHtml(opts.sigName),
    content.ps ? `PS. ${htmlToText(content.ps)}` : "",
    "--",
    `${opts.company} · ${opts.address}`,
    `Unsubscribe: ${opts.unsubUrl}`,
  ].filter(Boolean);
  return { subject, html, text: textParts.join("\n\n") };
}

/** Insert (or refresh) one row per step. Re-enqueueing reschedules pending/cancelled/skipped rows. */
export async function enqueueSequence(rt: Runtime, lead: Lead, seqId: string, opts: { anchor?: number } = {}): Promise<number> {
  // Text reminders follow every verified booking or reschedule (only with their own consent; see sms.ts).
  // An email unsubscribe is not a text opt-out, so this runs before the email checks below.
  if (seqId === "booked") await scheduleSmsReminders(rt, lead).catch((e) => console.error("sms schedule", lead.id, e));
  if (lead.unsubscribed_at || lead.booking_source === "calendly-direct") return 0;
  const seq = SEQUENCES[seqId];
  if (!seq) throw new Error(`unknown sequence ${seqId}`);
  const now = rt.now();
  const base = opts.anchor ?? now;
  const rows: Array<{ step: number; template: string; at: number }> = [];

  if (seqId === "precall") {
    if (!lead.call_at) return 0;
    const perDay = Math.min(PRECALL_MAX_TOTAL, rt.settings.num("PRECALL_EMAILS_PER_DAY", PRECALL_PER_DAY_DEFAULT));
    if (perDay <= 0) return 0;
    // Ranked by fit with the lead's blockers and goal; never more than PRECALL_MAX_TOTAL per booking.
    const plan = precallPlan(buildDossier(lead)).slice(0, PRECALL_MAX_TOTAL);
    const times = precallTimes(now, lead.call_at, await leadTimezone(rt, lead), perDay, plan.length);
    times.forEach((t, i) => rows.push({ step: i, template: plan[i], at: t }));
  } else {
    seq.steps.forEach((s, i) => {
      if (s.anchor === "call") {
        if (!lead.call_at) return;
        const at = lead.call_at + s.offset;
        if (at < now) return; // reminder already passed
        rows.push({ step: i, template: s.template, at });
      } else {
        rows.push({ step: i, template: s.template, at: base + s.offset });
      }
    });
  }
  if (!rows.length) return 0;
  const stmt = rt.env.DB.prepare(
    `INSERT INTO emails (id, lead_id, sequence, step, template, send_at, status, attempts, created_at)
     VALUES (?,?,?,?,?,?,'pending',0,?)
     ON CONFLICT(lead_id, sequence, step) DO UPDATE SET send_at = excluded.send_at, template = excluded.template,
       status = 'pending', attempts = 0, error = NULL
     WHERE emails.status IN ('pending','cancelled','skipped')`,
  );
  await rt.env.DB.batch(rows.map((r) => stmt.bind(newId("m"), lead.id, seqId, r.step, r.template, r.at, now)));
  if (seqId === "precall") {
    // Drop steps beyond the new plan (call moved earlier).
    await rt.env.DB.prepare("UPDATE emails SET status='cancelled' WHERE lead_id=? AND sequence='precall' AND status='pending' AND step >= ?").bind(lead.id, rows.length).run();
  }
  return rows.length;
}

export async function cancelSequences(rt: Runtime, leadId: string, seqIds: string[]): Promise<void> {
  if (!seqIds.length) return;
  await rt.env.DB.prepare(
    `UPDATE emails SET status='cancelled' WHERE lead_id = ? AND status = 'pending' AND sequence IN (${seqIds.map(() => "?").join(",")})`,
  ).bind(leadId, ...seqIds).run();
}

export async function cancelAllEmails(rt: Runtime, leadId: string): Promise<void> {
  await rt.env.DB.prepare("UPDATE emails SET status='cancelled' WHERE lead_id = ? AND status = 'pending'").bind(leadId).run();
}

/** One-off email (continue link, voice link, test, behaviour trigger) sent right away. */
export async function sendOneOff(rt: Runtime, lead: Lead, sequence: string, template: string, step?: number): Promise<string | null> {
  // Imported contacts only ever get the continue link they asked for by applying.
  if (lead.booking_source === "calendly-direct" && sequence !== "continue") return null;
  if (lead.unsubscribed_at) return null;
  const now = rt.now();
  const s = step ?? (await rt.env.DB.prepare("SELECT COALESCE(MAX(step), -1) + 1 AS n FROM emails WHERE lead_id = ? AND sequence = ?").bind(lead.id, sequence).first<{ n: number }>())?.n ?? 0;
  const id = newId("m");
  const r = await rt.env.DB.prepare(
    `INSERT INTO emails (id, lead_id, sequence, step, template, send_at, status, attempts, created_at) VALUES (?,?,?,?,?,?,'pending',0,?)
     ON CONFLICT(lead_id, sequence, step) DO NOTHING`,
  ).bind(id, lead.id, sequence, s, template, now, now).run();
  if (!r.meta?.changes) return null;
  const row = await rt.env.DB.prepare("SELECT * FROM emails WHERE id = ?").bind(id).first<EmailRow>();
  if (row) rt.waitUntil(processRows(rt, [row]));
  return id;
}

export interface QueueResult { processed: number; sent: number; simulated: number; failed: number; skipped: number; }

/**
 * Go-live switch (for Funnel HQ): every pending email that was due more than `olderThanMs` ago (default 1 h) is
 * marked skipped with error "backlog", so switching sending on after a pause, an outage or a data import never
 * sends weeks of old mail at once. Future emails are untouched; safe to run twice. Returns how many were skipped.
 */
export async function skipBacklog(rt: Runtime, olderThanMs = 60 * 60_000): Promise<number> {
  const r = await rt.env.DB.prepare("UPDATE emails SET status = 'skipped', error = 'backlog' WHERE status = 'pending' AND send_at < ?")
    .bind(rt.now() - Math.max(0, olderThanMs)).run();
  return Number(r.meta?.changes || 0);
}

export async function processEmailQueue(rt: Runtime, limit = 60): Promise<QueueResult> {
  // Text reminders ride on the email cron (same 5-minute tick), isolated so a failure never stops the email.
  await processSmsQueue(rt).catch((e) => console.error("sms queue", e));
  const now = rt.now();
  // Rows stuck in 'sending' (Worker evicted mid-send) go back to the queue.
  await rt.env.DB.prepare("UPDATE emails SET status='pending' WHERE status='sending' AND send_at < ?").bind(now - 15 * 60_000).run();
  const due = await rt.env.DB.prepare("SELECT * FROM emails WHERE status = 'pending' AND send_at <= ? ORDER BY send_at LIMIT ?").bind(now, limit * 3).all<EmailRow>();
  // At most one email per lead per run, so a backlog (cron outage) never arrives as a burst.
  const seen = new Set<string>();
  const rows = (due.results || []).filter((r) => (seen.has(r.lead_id) ? false : (seen.add(r.lead_id), true))).slice(0, limit);
  return processRows(rt, rows);
}

async function processRows(rt: Runtime, rows: EmailRow[]): Promise<QueueResult> {
  const res: QueueResult = { processed: 0, sent: 0, simulated: 0, failed: 0, skipped: 0 };
  let pending = [...rows];
  while (pending.length) {
    // Batches of 6, never the same lead twice in one batch.
    const batch: EmailRow[] = [];
    const seen = new Set<string>();
    const rest: EmailRow[] = [];
    for (const r of pending) {
      if (batch.length < 6 && !seen.has(r.lead_id)) { batch.push(r); seen.add(r.lead_id); } else rest.push(r);
    }
    pending = rest;
    const outcomes = await Promise.all(batch.map((r) => processOne(rt, r).catch((e) => { console.error("email", r.id, e); return "failed" as const; })));
    for (const o of outcomes) {
      if (o === null) continue;
      res.processed++;
      if (o === "sent") res.sent++;
      else if (o === "simulated") res.simulated++;
      else if (o === "failed") res.failed++;
      else res.skipped++;
    }
  }
  return res;
}

type Outcome = "sent" | "simulated" | "failed" | "skipped" | "cancelled" | null;

async function setStatus(rt: Runtime, id: string, status: string, extra: Record<string, unknown> = {}) {
  const keys = Object.keys(extra);
  await rt.env.DB.prepare(`UPDATE emails SET status = ?${keys.map((k) => `, ${k} = ?`).join("")} WHERE id = ?`)
    .bind(status, ...keys.map((k) => extra[k] ?? null), id).run();
}

/** Hold a claimed row until `at` (not an attempt; the row stays pending). */
async function defer(rt: Runtime, row: EmailRow, at: number, why: string): Promise<null> {
  // Up to 20 minutes of spread per row, so a morning of deferred mail does not leave in one burst.
  const jitter = (parseInt(row.id.slice(-4), 36) % 20) * 60_000;
  await rt.env.DB.prepare("UPDATE emails SET status = 'pending', attempts = MAX(0, attempts - 1), send_at = ?, error = ? WHERE id = ?")
    .bind(at + jitter, why, row.id).run();
  return null;
}

/** Sends today (local day) of non-transactional email to this lead: the daily marketing cap counts these. */
export async function marketingSentToday(rt: Runtime, leadId: string, tz: string): Promise<number> {
  const r = await rt.env.DB.prepare(
    `SELECT COUNT(*) AS n FROM emails WHERE lead_id = ? AND status IN ('sent','simulated') AND sent_at >= ?
     AND sequence NOT IN (${[...TRANSACTIONAL].map(() => "?").join(",")})`,
  ).bind(leadId, localDayStart(rt.now(), tz), ...TRANSACTIONAL).first<{ n: number }>();
  return Number(r?.n || 0);
}

/**
 * Round 3 sending safety, in order: the booking confirmation never arrives after the call; a stale step is
 * skipped ("stale", see maxLateMs); the 3 h / 1 h emails stay quiet once a text reminder was delivered; the
 * pre-call run stops after three unopened in a row; outside 08:00–20:00 local the row waits for the morning;
 * over MAX_MARKETING_PER_DAY (default 2, booked reminders and other transactional mail exempt) it waits for
 * the next local morning.
 */
async function sendingSafety(rt: Runtime, row: EmailRow, lead: Lead): Promise<"send" | Outcome> {
  const now = rt.now();
  if (row.sequence === "booked" && lead.call_at && now > lead.call_at) { await setStatus(rt, row.id, "skipped", { error: "call passed" }); return "skipped"; }
  const late = maxLateMs(row.sequence, row.step, row.template);
  if (late != null && now - row.send_at > late) { await setStatus(rt, row.id, "skipped", { error: "stale" }); return "skipped"; }
  if (row.sequence === "booked" && (row.template === "bk_3h" || row.template === "bk_1h") && (await smsReminderDelivered(rt, lead.id, lead.call_at))) {
    await setStatus(rt, row.id, "skipped", { error: "text reminder delivered" });
    return "skipped";
  }
  if (row.sequence === "precall") {
    const last = await rt.env.DB.prepare("SELECT opens FROM emails WHERE lead_id = ? AND sequence = 'precall' AND status IN ('sent','simulated') ORDER BY sent_at DESC LIMIT ?")
      .bind(lead.id, PRECALL_UNOPENED_STOP).all<{ opens: number }>();
    const rows = last.results || [];
    if (rows.length >= PRECALL_UNOPENED_STOP && rows.every((r) => !r.opens)) {
      await setStatus(rt, row.id, "cancelled", { error: "unopened" });
      await rt.env.DB.prepare("UPDATE emails SET status = 'cancelled', error = 'unopened' WHERE lead_id = ? AND sequence = 'precall' AND status = 'pending'").bind(lead.id).run();
      return "cancelled";
    }
  }
  const tz = await leadTimezone(rt, lead);
  if (respectsQuietHours(row.sequence, row.step, row.template)) {
    const until = quietUntil(now, tz);
    if (until) return defer(rt, row, until, "quiet hours");
  }
  if (!TRANSACTIONAL.has(row.sequence)) {
    const cap = rt.settings.num("MAX_MARKETING_PER_DAY", 2);
    if (cap > 0 && (await marketingSentToday(rt, lead.id, tz)) >= cap) return defer(rt, row, nextLocalMorning(now, tz), "daily cap");
  }
  return "send";
}

async function processOne(rt: Runtime, row: EmailRow): Promise<Outcome> {

  const claim = await rt.env.DB.prepare("UPDATE emails SET status='sending', attempts = attempts + 1 WHERE id = ? AND status = 'pending'").bind(row.id).run();
  if (!claim.meta?.changes) return null;
  const attempts = row.attempts + 1;
  const lead = await getLead(rt, row.lead_id);
  if (!lead) { await setStatus(rt, row.id, "cancelled", { error: "lead gone" }); return "cancelled"; }
  // Test data (example.com, ?test=1, the team's own browsers) never gets real email.
  if (await isTestLead(rt, lead.id)) { await setStatus(rt, row.id, "skipped", { error: "test lead" }); return "skipped"; }
  if (lead.unsubscribed_at) { await setStatus(rt, row.id, "cancelled", { error: "unsubscribed" }); return "cancelled"; }
  // Hard bounce or spam complaint (Resend webhook): never send to this address again.
  const bad = await leadEmailStatus(rt, lead.id);
  if (bad) { await setStatus(rt, row.id, "cancelled", { error: bad === "bounced" ? "hard bounce" : "spam complaint" }); return "cancelled"; }
  // Deliverability guard: marketing waits (not cancelled) while paused.
  if (PAUSABLE_SEQUENCES.includes(row.sequence) && (await marketingPause(rt))) {
    await rt.env.DB.prepare("UPDATE emails SET status = 'pending', attempts = MAX(0, attempts - 1), send_at = ? WHERE id = ?").bind(rt.now() + 60 * 60_000, row.id).run();
    return null;
  }
  if (lead.booking_source === "calendly-direct" && row.sequence !== "continue") { await setStatus(rt, row.id, "skipped", { error: "imported contact" }); return "skipped"; }
  const seq = SEQUENCES[row.sequence];
  if (seq?.stopIf(lead)) {
    await setStatus(rt, row.id, "cancelled", { error: "sequence goal met" });
    await rt.env.DB.prepare("UPDATE emails SET status='cancelled', error='sequence goal met' WHERE lead_id=? AND sequence=? AND status='pending'").bind(lead.id, row.sequence).run();
    return "cancelled";
  }
  const step = seq?.steps[row.step];
  if (step?.skipIf?.(lead)) { await setStatus(rt, row.id, "skipped", { error: "step skipped" }); return "skipped"; }
  if (step?.anchor === "call" && lead.call_at && rt.now() > lead.call_at) { await setStatus(rt, row.id, "skipped", { error: "call passed" }); return "skipped"; }
  const safety = await sendingSafety(rt, row, lead);
  if (safety !== "send") return safety;
  const template = TEMPLATES[row.template];
  if (!template) { await setStatus(rt, row.id, "failed", { error: `unknown template ${row.template}` }); return "failed"; }

  const ctx = await buildCtx(rt, lead, row.id);
  let content = template(ctx);
  const p = await personalizeEmail(rt, lead, { id: row.id, template: row.template, sequence: row.sequence }, content, ctx);
  content = p.content;
  const rendered = renderEmail(content, {
    link: ctx.link,
    unsubUrl: await unsubscribeUrl(rt, lead.id),
    pixelUrl: `${rt.origin}/o/${row.id}.gif`,
    address: rt.settings.get("BUSINESS_ADDRESS") || "[postal address not set]",
    sigName: ctx.sigName,
    company: rt.settings.get("SITE_NAME") || `${BRAND.name}`,
  });
  const meta = { subject: rendered.subject, personalized: p.mode, facts_used: JSON.stringify(p.factsUsed), personalize_error: p.error };

  const s = rt.settings;
  const live = s.has("RESEND_API_KEY") && s.has("EMAIL_FROM") && s.has("BUSINESS_ADDRESS");
  if (!live) {
    await setStatus(rt, row.id, "simulated", { ...meta, sent_at: rt.now(), error: null });
    await track(rt, { leadId: lead.id }, { name: "email_sent", source: "cron", props: { sequence: row.sequence, template: row.template, simulated: true }, localOnly: true });
    return "simulated";
  }
  const r = await sendViaResend(rt, lead.email, rendered, await unsubscribeUrl(rt, lead.id), row.id);
  if (r.ok) {
    await setStatus(rt, row.id, "sent", { ...meta, sent_at: rt.now(), provider_id: r.id, error: null });
    await track(rt, { leadId: lead.id }, { name: "email_sent", source: "cron", props: { sequence: row.sequence, template: row.template }, localOnly: true });
    return "sent";
  }
  if (attempts < 3 && r.retryable) {
    await setStatus(rt, row.id, "pending", { ...meta, error: r.error, send_at: rt.now() + attempts * 10 * 60_000 });
    return "failed";
  }
  await setStatus(rt, row.id, "failed", { ...meta, error: r.error });
  return "failed";
}

export async function sendViaResend(
  rt: Runtime, to: string, m: Rendered, unsubUrl: string, idempotencyKey: string,
): Promise<{ ok: true; id: string } | { ok: false; error: string; retryable: boolean }> {
  const s = rt.settings;
  try {
    const r = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        authorization: `Bearer ${s.get("RESEND_API_KEY")}`,
        "content-type": "application/json",
        "idempotency-key": idempotencyKey,
      },
      body: JSON.stringify({
        from: s.get("EMAIL_FROM"),
        to: [to],
        reply_to: s.get("EMAIL_REPLY_TO") || undefined,
        subject: m.subject,
        html: m.html,
        text: m.text,
        headers: { "List-Unsubscribe": `<${unsubUrl}>`, "List-Unsubscribe-Post": "List-Unsubscribe=One-Click" },
      }),
    });
    if (r.ok) {
      const j = (await r.json().catch(() => ({}))) as { id?: string };
      return { ok: true, id: j.id || "" };
    }
    const t = (await r.text().catch(() => "")).slice(0, 300);
    return { ok: false, error: `resend ${r.status}: ${t}`, retryable: r.status >= 500 || r.status === 429 };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e), retryable: true };
  }
}

/** Dashboard preview of any template for any lead (or an empty lead). Never sends. */
export async function previewTemplate(rt: Runtime, lead: Lead | null, template: string): Promise<Rendered & { mode: string; factsUsed: string[] }> {
  const t = TEMPLATES[template];
  if (!t) throw new Error("unknown template");
  const l: Lead = lead || ({ id: "preview", email: "preview@example.com", answers: "{}", status: "applied", booking_source: "funnel" } as Lead);
  const ctx = await buildCtx(rt, l, "preview");
  const content = t(ctx);
  const p = lead ? await personalizeEmail(rt, lead, { id: "preview", template, sequence: "preview" }, content, ctx, { dryRun: true }) : { content, mode: "off", factsUsed: [] as string[], error: null };
  const r = renderEmail(p.content, {
    link: ctx.link, unsubUrl: `${rt.origin}/u/preview`, pixelUrl: null,
    address: rt.settings.get("BUSINESS_ADDRESS") || "[postal address not set]", sigName: ctx.sigName,
    company: rt.settings.get("SITE_NAME") || `${BRAND.name}`,
  });
  return { ...r, mode: p.mode, factsUsed: p.factsUsed };
}

export async function sendTestEmail(rt: Runtime, to: string): Promise<{ ok: boolean; error?: string; simulated?: boolean }> {
  const t = TEMPLATES.test_email;
  if (!t) return { ok: false, error: "no test template" };
  const fake = { id: "test", email: to, first_name: "there", answers: "{}", status: "applied", booking_source: "funnel" } as Lead;
  const ctx = await buildCtx(rt, fake, "test");
  const rendered = renderEmail(t(ctx), {
    link: ctx.link, unsubUrl: `${rt.origin}/u/test`, pixelUrl: null,
    address: rt.settings.get("BUSINESS_ADDRESS") || "[postal address not set]", sigName: ctx.sigName,
    company: rt.settings.get("SITE_NAME") || `${BRAND.name}`,
  });
  if (!rt.settings.has("RESEND_API_KEY") || !rt.settings.has("EMAIL_FROM")) return { ok: true, simulated: true };
  const r = await sendViaResend(rt, to, rendered, `${rt.origin}/u/test`, newId("t"));
  return r.ok ? { ok: true } : { ok: false, error: r.error };
}
