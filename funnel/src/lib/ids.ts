const ALPHA = "0123456789abcdefghijklmnopqrstuvwxyz";
const REF_ALPHA = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

function randomString(len: number, alphabet: string): string {
  const bytes = new Uint8Array(len);
  crypto.getRandomValues(bytes);
  let s = "";
  for (let i = 0; i < len; i++) s += alphabet[bytes[i] % alphabet.length];
  return s;
}

/** Time-sortable id: base36 ms timestamp + random tail, with an optional prefix. */
export function newId(prefix = ""): string {
  return prefix + Date.now().toString(36).padStart(9, "0") + randomString(10, ALPHA);
}

/** Human-friendly reference code shown to leads and the team, e.g. "OP-7KQ2MX". Not a secret. */
export function refCode(): string {
  return "OP-" + randomString(6, REF_ALPHA);
}

export function randomToken(bytes = 32): string {
  const b = new Uint8Array(bytes);
  crypto.getRandomValues(b);
  let s = "";
  for (let i = 0; i < b.length; i++) s += b[i].toString(16).padStart(2, "0");
  return s;
}
