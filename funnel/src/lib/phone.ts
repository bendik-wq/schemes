// E.164 normalisation and phone-number → country / time zones. Calling hours always come from
// the phone number, never from the browser that filled in the form.

export const DIAL: Record<string, string> = {
  US: "1", CA: "1", GB: "44", IE: "353", NO: "47", SE: "46", DK: "45", FI: "358", IS: "354", NL: "31", DE: "49", BE: "32",
  FR: "33", ES: "34", PT: "351", IT: "39", CH: "41", AT: "43", PL: "48", AU: "61", NZ: "64", SG: "65", AE: "971", ZA: "27",
  IN: "91", HK: "852", JP: "81", MX: "52", BR: "55", LU: "352", EE: "372", LT: "370", LV: "371", CZ: "420", GR: "30",
};

const CA_AREA = new Set([
  "204", "226", "236", "249", "250", "263", "289", "306", "343", "354", "365", "367", "368", "382", "387", "403", "416", "418", "428",
  "431", "437", "438", "450", "468", "474", "506", "514", "519", "548", "579", "581", "584", "587", "600", "604", "613", "639", "647",
  "672", "683", "705", "709", "742", "753", "778", "780", "782", "807", "819", "825", "867", "873", "879", "902", "905",
]);

/** Digits after the "+" in E.164. apply.js applies the same 8–15 rule (keep the two in step). */
export const PHONE_MIN_DIGITS = 8;
export const PHONE_MAX_DIGITS = 15;

/** A country the form's dial-code picker may send: an ISO code present in DIAL, else null. */
export function dialCountry(v: unknown): string | null {
  const c = String(v ?? "").trim().toUpperCase();
  return /^[A-Z]{2}$/.test(c) && Object.prototype.hasOwnProperty.call(DIAL, c) ? c : null;
}

/**
 * Normalise to E.164 (+<digits>). Numbers typed without a prefix use the country picked in the form
 * (when it is a known dial code), else the visitor's country.
 */
export function normalizePhone(raw: unknown, defaultCountry: string | null, pickedCountry?: unknown): string | null {
  defaultCountry = dialCountry(pickedCountry) || defaultCountry;
  let s = String(raw ?? "").trim();
  if (!s) return null;
  if (/[a-z]/i.test(s.replace(/ext\.?\s*\d+$/i, ""))) return null;
  s = s.replace(/ext\.?\s*\d+$/i, "");
  let digits = s.replace(/[^\d+]/g, "");
  if (digits.startsWith("00")) digits = "+" + digits.slice(2);
  if (!digits.startsWith("+")) {
    const cc = DIAL[(defaultCountry || "").toUpperCase()];
    if (!cc) return null;
    let national = digits.replace(/\D/g, "");
    if (cc === "1" && national.length === 11 && national.startsWith("1")) national = national.slice(1);
    else if (national.startsWith("0") && cc !== "39") national = national.slice(1);
    digits = "+" + cc + national;
  }
  const d = digits.slice(1).replace(/\D/g, "");
  if (d.length < PHONE_MIN_DIGITS || d.length > PHONE_MAX_DIGITS) return null;
  if (d.startsWith("0")) return null;
  return "+" + d;
}

// +1 area codes that are NOT the US or Canada (Caribbean, Atlantic and Pacific territories), plus
// non-geographic codes: premium (900, 976), personal and machine (5XX, 600, 700), toll-free (8XX).
const NANP_BLOCKED = new Set([
  "242", "246", "264", "268", "284", "340", "345", "441", "473", "649", "658", "664", "670", "671", "684", "721", "758", "767",
  "784", "787", "809", "829", "849", "868", "869", "876", "939",
  "900", "976", "500", "521", "522", "533", "544", "566", "577", "588", "600", "700", "710", "456",
  "800", "811", "822", "833", "844", "855", "866", "877", "888", "880", "881", "882", "883", "884", "885", "886", "887", "622", "633",
]);

/** ISO country of an E.164 number (longest dial-code match; +1 split into US/CA by area code). */
export function phoneCountry(e164: string | null | undefined): string | null {
  if (!e164 || !e164.startsWith("+")) return null;
  const d = e164.slice(1);
  if (d.startsWith("1")) {
    const area = d.slice(1, 4);
    if (NANP_BLOCKED.has(area) || area[0] === "0" || area[0] === "1") return null;
    return CA_AREA.has(area) ? "CA" : "US";
  }
  let best: string | null = null;
  let bestLen = 0;
  for (const [iso, cc] of Object.entries(DIAL)) {
    if (cc !== "1" && d.startsWith(cc) && cc.length > bestLen) { best = iso; bestLen = cc.length; }
  }
  return best;
}

const ZONES: Record<string, string[]> = {
  US: ["America/New_York", "America/Chicago", "America/Denver", "America/Phoenix", "America/Los_Angeles"],
  CA: ["America/St_Johns", "America/Halifax", "America/Toronto", "America/Winnipeg", "America/Edmonton", "America/Vancouver"],
  AU: ["Australia/Sydney", "Australia/Brisbane", "Australia/Adelaide", "Australia/Darwin", "Australia/Perth", "Australia/Lord_Howe"],
  NZ: ["Pacific/Auckland"],
  GB: ["Europe/London"], IE: ["Europe/Dublin"], NO: ["Europe/Oslo"], SE: ["Europe/Stockholm"], DK: ["Europe/Copenhagen"],
  FI: ["Europe/Helsinki"], IS: ["Atlantic/Reykjavik"], NL: ["Europe/Amsterdam"], DE: ["Europe/Berlin"], BE: ["Europe/Brussels"],
  FR: ["Europe/Paris"], ES: ["Europe/Madrid"], PT: ["Europe/Lisbon"], IT: ["Europe/Rome"], CH: ["Europe/Zurich"], AT: ["Europe/Vienna"],
  PL: ["Europe/Warsaw"], SG: ["Asia/Singapore"], AE: ["Asia/Dubai"], ZA: ["Africa/Johannesburg"], IN: ["Asia/Kolkata"],
  HK: ["Asia/Hong_Kong"], JP: ["Asia/Tokyo"], LU: ["Europe/Luxembourg"], EE: ["Europe/Tallinn"], LT: ["Europe/Vilnius"],
  LV: ["Europe/Riga"], CZ: ["Europe/Prague"], GR: ["Europe/Athens"], MX: ["America/Mexico_City"], BR: ["America/Sao_Paulo"],
};

// Hawaii and Alaska area codes get their own zone (the mainland window would ring them at dawn).
const US_SPECIAL: Record<string, string> = { "808": "Pacific/Honolulu", "907": "America/Anchorage" };

/** Every time zone the phone number's country spans. Calls only go out when all are within hours. */
export function callingZones(e164: string | null | undefined): string[] {
  const c = phoneCountry(e164);
  if (!c) return [];
  if (c === "US") {
    const area = (e164 || "").slice(2, 5);
    if (US_SPECIAL[area]) return [US_SPECIAL[area]];
  }
  return ZONES[c] || [];
}

/** Default time zone for a country (for emails), or null. */
export function countryTimezone(country: string | null | undefined): string | null {
  const z = ZONES[(country || "").toUpperCase()];
  return z ? z[0] : null;
}

/**
 * Numbers the AI caller may ring: ordinary mobile and geographic ranges only. Premium-rate,
 * personal, shared-cost and other revenue-share ranges are refused (toll-fraud protection).
 * Twilio and ElevenLabs geo permissions should be locked down as well.
 */
const CALLABLE: Record<string, RegExp> = {
  US: /^\+1[2-9]\d{9}$/,
  CA: /^\+1[2-9]\d{9}$/,
  GB: /^\+44(7[1-57-9]\d{8}|7624\d{6}|[12]\d{8,9}|3\d{9})$/,
  IE: /^\+353(8[35-9]\d{7}|[1-9]\d{6,8})$/,
  AU: /^\+61[2-478]\d{8}$/,
  NZ: /^\+64(2\d{7,9}|[34679]\d{7})$/,
  NO: /^\+47[2-79]\d{7}$/,
  SE: /^\+46(7[02369]\d{7}|[1-68]\d{6,8})$/,
  DK: /^\+45[2-7]\d{7}$/,
  FI: /^\+358(4\d{6,9}|50\d{5,8}|[1-35-9]\d{5,8})$/,
  IS: /^\+354[4-8]\d{6}$/,
  NL: /^\+31(6\d{8}|[1-57]\d{8})$/,
  DE: /^\+49(1[5-7]\d{8,9}|[2-9]\d{6,10})$/,
  AE: /^\+971(5[02-8]\d{7}|[2-79]\d{7})$/,
  SG: /^\+65[689]\d{7}$/,
};
const PREMIUM: RegExp[] = [
  /^\+49(900|137|180|700)/, /^\+31(90[069])/, /^\+46(900|939|944)/, /^\+4590/, /^\+4782/, /^\+358(0?[1237]00|60|70)/,
  /^\+44(70|87|9)/, /^\+44(7781|7839|7911|7700|7509|7797|7937|1481|1534)/, // premium, personal, Jersey/Guernsey
  /^\+61(19|13|18|891)/, /^\+64(900|240)/,
];

export function callableNumber(e164: string | null | undefined): boolean {
  const c = phoneCountry(e164);
  if (!c || !e164) return false;
  if (PREMIUM.some((re) => re.test(e164))) return false;
  const re = CALLABLE[c];
  return !!re && re.test(e164);
}
