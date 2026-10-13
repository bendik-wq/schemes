import type { Lead } from "../funnel/leads";
import type { Dossier } from "../followup/dossier";

/**
 * Everything a template may use. All strings are already HTML-safe (escaped and defanged).
 * Templates must never interpolate raw lead fields; use `d` (the dossier) and these helpers.
 */
export interface EmailCtx {
  lead: Lead;
  d: Dossier;
  /** Escaped first name, or "there". */
  firstName: string;
  /** Signed, tracked absolute URL for a same-site path, e.g. ctx.link("/book"). */
  link(path: string): string;
  /** <a href="…">label</a> for a same-site path. Label is escaped. */
  a(path: string, label: string): string;
  /** Where this lead books: /book (A), /breakout (B) or /resources (C). */
  bookPath: string;
  /** Escaped call time in the lead's time zone, e.g. "Tuesday 14 October at 15:00 (CEST)", or null. */
  callTime: string | null;
  /** Escaped closer name, e.g. "Bendik". */
  closerName: string;
  /** Escaped signature name. */
  sigName: string;
  /** Which films are configured (VSL_BREAKOUT_SRC / VSL_PRECALL_SRC). Absent: treated as none, so no email promises a video. */
  hasVideo?: { breakout: boolean; precall: boolean };
  now: number;
}

export interface EmailContent {
  /** Plain text, under 80 chars, unique across all templates. */
  subject: string;
  /** Plain text inbox preview line. */
  preheader?: string;
  /** HTML-safe paragraphs. May contain anchors from ctx.a(). One idea per paragraph. */
  paragraphs: string[];
  /** Optional single call to action, rendered as a quiet button. */
  cta?: { label: string; path: string };
  /** Optional PS line (HTML-safe). */
  ps?: string;
}

export type Template = (ctx: EmailCtx) => EmailContent;
