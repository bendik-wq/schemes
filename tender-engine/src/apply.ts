// Offer page application: validation and A/B/C tier.

import { clean } from "./util";

export const QUESTIONS = {
  role: ["supplier", "contractor", "service", "operator", "other"],
  revenue: ["lt20", "20to100", "100to500", "500plus"],
  rfqs: ["0to2", "3to5", "6to15", "16plus"],
  writer: ["md", "bidteam", "engineers", "consultant"],
  qualification: ["jqs", "achilles", "both", "none"],
  timeline: ["now", "quarter", "later"],
} as const;

export type Answers = { [K in keyof typeof QUESTIONS]: (typeof QUESTIONS)[K][number] } & { pain: string };

export interface Application {
  name: string;
  email: string;
  phone: string;
  company: string;
  answers: Answers;
}

const EMAIL_RE = /^[^\s@<>"]{1,64}@[^\s@<>"]{1,190}\.[a-z]{2,24}$/i;

export function validateApplication(body: Record<string, unknown>): { ok: true; app: Application } | { ok: false; error: string } {
  const name = clean(body.name, 120);
  const email = clean(body.email, 200).toLowerCase();
  const phone = clean(body.phone, 40).replace(/[^\d+ ()-]/g, "");
  const company = clean(body.company, 160);
  if (name.length < 2) return { ok: false, error: "Please add your name." };
  if (!EMAIL_RE.test(email)) return { ok: false, error: "Please add a valid work email." };
  if (company.length < 2) return { ok: false, error: "Please add your company." };
  const a = (body.answers ?? {}) as Record<string, unknown>;
  const answers = { pain: clean(a.pain, 1000) } as Answers;
  for (const [k, opts] of Object.entries(QUESTIONS)) {
    const v = String(a[k] ?? "");
    if (!(opts as readonly string[]).includes(v)) return { ok: false, error: `Please answer: ${k}.` };
    (answers as Record<string, string>)[k] = v;
  }
  return { ok: true, app: { name, email, phone, company, answers } };
}

/** A = book a call now, B = book with the breakout first, C = resources. */
export function tierOf(a: Answers): "A" | "B" | "C" {
  if (a.role === "operator") return "C"; // buyers, not the ICP
  if (a.revenue === "lt20" && (a.rfqs === "0to2" || a.timeline === "later")) return "C";
  if (a.rfqs === "0to2" && a.timeline === "later") return "C";
  const volume = a.rfqs === "6to15" || a.rfqs === "16plus" ? 2 : a.rfqs === "3to5" ? 1 : 0;
  const size = a.revenue === "100to500" || a.revenue === "500plus" ? 2 : a.revenue === "20to100" ? 1 : 0;
  const soon = a.timeline === "now" ? 2 : a.timeline === "quarter" ? 1 : 0;
  return volume + size + soon >= 4 ? "A" : "B";
}
