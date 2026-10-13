// The offer stack block (OFFER.stack in config.ts): under the application on the landing pages and on
// /breakout. Everything comes from config; bonuses render only when the owner has listed real ones.

import { OFFER } from "../config";
import { escHtml } from "../lib/text";

/**
 * Pure. `risk`: add the guarantee lines; `price`: add the price note. Both are left out on the landing page,
 * where the line above the offer and the guarantee band below it already say them.
 */
export function offerStackHtml(opts: { risk: boolean; price?: boolean; headingId?: string }): string {
  const s = OFFER.stack;
  const hid = opts.headingId || "offer-title";
  const items = s.items.map((i) => `<li><span class="wk">${escHtml(i.weeks)}</span><div><h3>${escHtml(i.title)}</h3><p>${escHtml(i.body)}</p></div></li>`).join("");
  const bonuses = s.bonuses.length
    ? `<div class="offer-bonus"><p class="kicker">Also included</p><ul>${s.bonuses.map((b) => `<li><strong>${escHtml(b.title)}</strong> ${escHtml(b.body)}</li>`).join("")}</ul></div>`
    : "";
  const risk = opts.risk && s.risk.length ? `<p class="offer-risk">${s.risk.map(escHtml).join(" ")}</p>` : "";
  return `<div class="offer-card"><header class="offer-head"><p class="kicker">${escHtml(s.kicker)}</p><h2 class="offer-name" id="${escHtml(hid)}">${escHtml(s.name)}</h2></header>`
    + `<ol class="offer-list">${items}</ol>${bonuses}`
    + `<div class="offer-foot"><p class="offer-effort"><span class="offer-label">Your time</span> ${escHtml(s.effort)}</p>${opts.price === false ? "" : `<p class="offer-price">${escHtml(s.priceNote)}</p>`}</div>${risk}</div>`;
}
