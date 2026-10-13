// Funnel HQ users: who can sign in with a magic link, with which role, tied to which rep.
// Owners manage everyone; managers manage everyone except owners. Nobody can lock out the last owner path:
// the ADMIN_PASSWORD login always works as the owner's break-glass account.

import type { Runtime } from "../app";
import { BRAND } from "../config";
import { newId } from "../lib/ids";
import { escHtml } from "../lib/text";
import { sendViaResend } from "../integrations/email";
import { ROLES, type AdminUser, type Role } from "./auth";

export interface UserRow { id: string; email: string; name: string | null; role: Role; rep_id: string | null; active: number; created_at: number; last_login_at: number | null }

export class UserError extends Error {}

export async function listUsers(rt: Runtime): Promise<UserRow[]> {
  return ((await rt.env.DB.prepare("SELECT id, email, name, role, rep_id, active, created_at, last_login_at FROM users ORDER BY active DESC, created_at").all<UserRow>()).results) || [];
}

export async function getUser(rt: Runtime, id: string): Promise<UserRow | null> {
  return (await rt.env.DB.prepare("SELECT id, email, name, role, rep_id, active, created_at, last_login_at FROM users WHERE id = ?").bind(id).first<UserRow>()) || null;
}

export interface UserInput { email?: unknown; name?: unknown; role?: unknown; rep_id?: unknown; active?: unknown }

/** Pure validation. Throws UserError. */
export function cleanUser(input: UserInput, partial: boolean): Partial<UserRow> {
  const out: Partial<UserRow> = {};
  if (input.email !== undefined || !partial) {
    const e = typeof input.email === "string" ? input.email.trim().toLowerCase() : "";
    if (!/^[^\s@<>"]+@[^\s@<>"]+\.[a-z]{2,}$/i.test(e) || e.length > 200) throw new UserError("Enter a valid email address.");
    out.email = e;
  }
  if (input.name !== undefined) out.name = typeof input.name === "string" ? input.name.trim().slice(0, 80) || null : null;
  if (input.role !== undefined || !partial) {
    if (!ROLES.includes(input.role as Role)) throw new UserError("Pick a role.");
    out.role = input.role as Role;
  }
  if (input.rep_id !== undefined) {
    const r = typeof input.rep_id === "string" ? input.rep_id.trim() : "";
    if (r && !/^[A-Za-z0-9_-]{1,40}$/.test(r)) throw new UserError("Unknown rep.");
    out.rep_id = r || null;
  }
  if (input.active !== undefined) out.active = input.active ? 1 : 0;
  return out;
}

function mayManage(actor: AdminUser, targetRole: Role | undefined): boolean {
  if (actor.role === "owner") return true;
  if (actor.role === "manager") return targetRole !== "owner";
  return false;
}

async function checkRep(rt: Runtime, role: Role | undefined, repId: string | null | undefined) {
  if ((role === "closer" || role === "setter") && !repId) throw new UserError("Closers and setters must be linked to a rep, so they see their own leads.");
  if (repId) {
    const r = await rt.env.DB.prepare("SELECT id FROM reps WHERE id = ?").bind(repId).first();
    if (!r) throw new UserError("Unknown rep.");
  }
}

export async function createUser(rt: Runtime, actor: AdminUser, input: UserInput): Promise<UserRow> {
  const u = cleanUser(input, false);
  if (!mayManage(actor, u.role)) throw new UserError("Only an owner can add another owner.");
  await checkRep(rt, u.role, u.rep_id);
  const row: UserRow = { id: newId("u"), email: u.email!, name: u.name ?? null, role: u.role!, rep_id: u.rep_id ?? null, active: 1, created_at: rt.now(), last_login_at: null };
  try {
    await rt.env.DB.prepare("INSERT INTO users (id, email, name, role, rep_id, active, created_at) VALUES (?,?,?,?,?,?,?)")
      .bind(row.id, row.email, row.name, row.role, row.rep_id, row.active, row.created_at).run();
  } catch (e) {
    if (/UNIQUE/i.test(String(e))) throw new UserError("A user with that email already exists.");
    throw e;
  }
  return row;
}

export async function updateUser(rt: Runtime, actor: AdminUser, id: string, input: UserInput): Promise<{ before: UserRow; after: UserRow }> {
  const before = await getUser(rt, id);
  if (!before) throw new UserError("User not found.");
  const patch = cleanUser(input, true);
  if (!mayManage(actor, before.role) || !mayManage(actor, patch.role)) throw new UserError("Only an owner can change an owner.");
  if (actor.id === id && (patch.role && patch.role !== before.role || patch.active === 0)) throw new UserError("You cannot change your own role or deactivate yourself.");
  const next = { ...before, ...patch };
  await checkRep(rt, next.role, next.rep_id);
  const keys = Object.keys(patch) as Array<keyof UserRow>;
  if (keys.length) {
    try {
      await rt.env.DB.prepare(`UPDATE users SET ${keys.map((k) => `${k} = ?`).join(", ")} WHERE id = ?`).bind(...keys.map((k) => patch[k] ?? null), id).run();
    } catch (e) {
      if (/UNIQUE/i.test(String(e))) throw new UserError("A user with that email already exists.");
      throw e;
    }
  }
  return { before, after: next };
}

/** The sign-in email. Simulated (logged without the link) when Resend is not configured. */
export async function sendMagicEmail(rt: Runtime, to: string, name: string | null, url: string): Promise<{ sent: boolean; simulated: boolean }> {
  const brand = rt.settings.get("SITE_NAME") || BRAND.name;
  const hi = name ? `Hi ${escHtml(name.split(" ")[0])},` : "Hi,";
  const html = `<!doctype html><html><body style="font-family:-apple-system,Segoe UI,Arial,sans-serif;color:#111;line-height:1.5">
<p>${hi}</p><p>Use this link to sign in to Funnel HQ. It works once and expires in 15 minutes.</p>
<p><a href="${escHtml(url)}" style="display:inline-block;padding:10px 16px;background:#111;color:#fff;border-radius:6px;text-decoration:none">Sign in to Funnel HQ</a></p>
<p style="color:#666;font-size:13px">If you did not ask for this, ignore this email. Nobody can sign in without the link.</p>
<p style="color:#666;font-size:13px">${escHtml(brand)}</p></body></html>`;
  const text = `${name ? `Hi ${name.split(" ")[0]},` : "Hi,"}\n\nSign in to Funnel HQ (works once, expires in 15 minutes):\n${url}\n\nIf you did not ask for this, ignore this email.\n${brand}`;
  if (!rt.settings.has("RESEND_API_KEY") || !rt.settings.has("EMAIL_FROM")) {
    // Local development only: print the link so the flow can be tested without an email provider.
    const host = new URL(rt.origin).hostname;
    if (host === "127.0.0.1" || host === "localhost") console.log("[magic link, simulated]", url);
    else console.log("[magic link] email not configured; link not sent");
    return { sent: false, simulated: true };
  }
  const r = await sendViaResend(rt, to, { subject: `Your Funnel HQ sign-in link`, html, text }, `${rt.origin}/admin/login`, newId("mg"));
  if (!r.ok) console.error("magic link email failed", r.error);
  return { sent: r.ok, simulated: false };
}
