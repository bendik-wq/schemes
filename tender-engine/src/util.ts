export interface Env {
  DB: D1Database;
  ASSETS: Fetcher;
  APP_PASSWORD?: string;
  SESSION_SECRET?: string;
  ANTHROPIC_API_KEY?: string;
  LEAD_WEBHOOK_URL?: string;
  BOOKING_URL?: string;
}

export const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json; charset=utf-8" } });

export function parseList(raw: string | null | undefined): string[] {
  if (!raw) return [];
  try {
    const v = JSON.parse(raw);
    return Array.isArray(v) ? v.map(String) : [];
  } catch {
    return [];
  }
}

/** Trim, collapse whitespace and cap a stranger-typed string. */
export function clean(v: unknown, max = 500): string {
  return String(v ?? "").replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "").trim().slice(0, max);
}

export async function sha256Hex(s: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export function csvCell(v: unknown): string {
  let s = String(v ?? "");
  // Block formula injection when the CSV is opened in Excel.
  if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
