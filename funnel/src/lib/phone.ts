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

/** Normalise to E.164 (+<digits>). Uses the visitor's country for numbers typed without a prefix. */
export function normalizePhone(raw: unknown, defaultCountry: string | null): string | null {
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
  if (d.length < 8 || d.length > 15) return null;
  if (d.startsWith("0")) return null;
  return "+" + d;
}

/** ISO country of an E.164 number (longest dial-code match; +1 split into US/CA by area code). */
export function phoneCountry(e164: string | null | undefined): string | null {
  if (!e164 || !e164.startsWith("+")) return null;
  const d = e164.slice(1);
  if (d.startsWith("1")) return CA_AREA.has(d.slice(1, 4)) ? "CA" : "US";
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
