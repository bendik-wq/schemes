// Pure calling-hours rules. A call goes out only when EVERY time zone of the phone number's
// country is inside hours: weekdays 9–20, Saturday 9–17, never Sunday, never on Australian
// national public holidays (for AU numbers).

import { AI_CALLER, TARGET_COUNTRIES } from "../config";
import { callableNumber, callingZones, phoneCountry } from "../lib/phone";
import { localParts } from "./sequences";

/** Anonymous Gregorian algorithm. Returns [month (1-12), day]. */
export function easterSunday(year: number): [number, number] {
  const a = year % 19, b = Math.floor(year / 100), c = year % 100, d = Math.floor(b / 4), e = b % 4;
  const f = Math.floor((b + 8) / 25), g = Math.floor((b - f + 1) / 3), h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4), k = c % 4, l = (32 + 2 * e + 2 * i - h - k) % 7, m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return [month, day];
}

function ymd(y: number, m: number, d: number) {
  return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

function addDays(y: number, m: number, d: number, n: number): string {
  const t = new Date(Date.UTC(y, m - 1, d) + n * 86_400_000);
  return ymd(t.getUTCFullYear(), t.getUTCMonth() + 1, t.getUTCDate());
}

/** Australian national public holidays (observed weekday substitutes included for fixed dates). */
export function auHolidays(year: number): Set<string> {
  const out = new Set<string>();
  const fixed = (m: number, d: number, substitute: boolean) => {
    out.add(ymd(year, m, d));
    if (!substitute) return;
    const dow = new Date(Date.UTC(year, m - 1, d)).getUTCDay();
    if (dow === 6) out.add(addDays(year, m, d, 2));
    if (dow === 0) out.add(addDays(year, m, d, 1));
  };
  fixed(1, 1, true);
  fixed(1, 26, true);
  fixed(4, 25, false);
  fixed(12, 25, true);
  fixed(12, 26, true);
  // Christmas on Saturday → Monday 27, Boxing Day → Tuesday 28.
  const xmasDow = new Date(Date.UTC(year, 11, 25)).getUTCDay();
  if (xmasDow === 5) out.add(ymd(year, 12, 28)); // Boxing Day Sat → Mon 28
  if (xmasDow === 6) { out.add(ymd(year, 12, 27)); out.add(ymd(year, 12, 28)); }
  const [em, ed] = easterSunday(year);
  out.add(addDays(year, em, ed, -2)); // Good Friday
  out.add(addDays(year, em, ed, 1)); // Easter Monday
  return out;
}

export function inCallingHours(t: number, tz: string, country?: string | null): boolean {
  const p = localParts(t, tz);
  const minutes = p.hh * 60 + p.mm;
  if (tz.startsWith("Australia/") && auHolidays(p.y).has(ymd(p.y, p.mo, p.d))) return false;
  if (p.dow === 0) return false;
  const rules = (country && AI_CALLER.countryHours[country]) || AI_CALLER;
  const w = p.dow === 6 ? rules.saturday : rules.weekday;
  return minutes >= w.start * 60 && minutes < w.end * 60;
}

export function allZonesOk(t: number, zones: string[], country?: string | null): boolean {
  return zones.length > 0 && zones.every((z) => inCallingHours(t, z, country));
}

/** Earliest time ≥ t when every zone is within hours (15-minute steps, up to 8 days), or null. */
export function nextCallingTime(t: number, zones: string[], country?: string | null): number | null {
  if (!zones.length) return null;
  const step = 15 * 60_000;
  let x = Math.ceil(t / 60_000) * 60_000;
  for (let i = 0; i < 8 * 24 * 4; i++) {
    if (allZonesOk(x, zones, country)) return x;
    x = Math.ceil((x + 1) / step) * step;
  }
  return null;
}

export function callableCountry(phone: string | null | undefined): boolean {
  const c = phoneCountry(phone);
  return !!c && TARGET_COUNTRIES.includes(c) && callingZones(phone).length > 0 && callableNumber(phone);
}
