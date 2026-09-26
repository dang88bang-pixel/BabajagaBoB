import crypto from "node:crypto";

/**
 * Zeitbasierte Einmalkennwörter (TOTP, RFC 6238) als **zweiter Faktor** für die
 * Creator-Anmeldung (Abschnitt 15/38, bislang `NOT_IMPLEMENTED`).
 *
 * Geltungsbereich und Grenzen:
 *  - Der zweite Faktor ist **optional**: Ist `BOB_CREATOR_TOTP_SECRET` nicht
 *    gesetzt, bleibt der Einzel-Secret-Login gültig (`docs/BOOTSTRAP.md` §5).
 *  - Ist er gesetzt, ist er **verpflichtend** (fail closed): fehlender oder
 *    falscher Code → Ablehnung, ohne Ausweichpfad.
 *  - Ein Code wird nur einmal akzeptiert (Replay-Schutz über persistierte
 *    Zeitfenster) und nur innerhalb ±1 Fenster (±30 s).
 *  - Das Secret wird nie ausgegeben, nur im Speicher verglichen; das Ergebnis
 *    ist konstantzeit-ähnlich (Vergleich über `timingSafeEqual`).
 */

export type TotpVerification = {ok: boolean; reason?: string; step?: number};

const BASE32_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
const TOTP_SECRET_ENV = "BOB_CREATOR_TOTP_SECRET";
export const TOTP_PERIOD_SECONDS = 30;
export const TOTP_DIGITS = 6;

/** Base32-Dekodierung (RFC 4648, Groß-/Kleinschreibung, optionale Bindestriche). */
export function base32Decode(input: string): Buffer {
  const cleaned = input.replace(/[\s-]/g, "").toUpperCase().replace(/=+$/, "");
  if (cleaned.length === 0 || /[^A-Z2-7]/.test(cleaned)) throw new Error("invalid base32 secret");
  let bits = 0;
  let value = 0;
  const output: number[] = [];
  for (const character of cleaned) {
    value = (value << 5) | BASE32_ALPHABET.indexOf(character);
    bits += 5;
    if (bits >= 8) {
      output.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Buffer.from(output);
}

export function totpSecretConfigured(secret = process.env[TOTP_SECRET_ENV]): boolean {
  return typeof secret === "string" && secret.replace(/[\s-]/g, "").length >= 16;
}

export function totpConfigured(): boolean {
  return totpSecretConfigured();
}

/** Zeitfenster (Counter) zu einem Zeitpunkt, optional verschoben. */
export function totpStep(atMs: number = Date.now(), offset = 0): number {
  return Math.floor(atMs / 1000 / TOTP_PERIOD_SECONDS) + offset;
}

/** Code für ein Zeitfenster; rein rechnerisch, ohne Zustand. */
export function totpCode(secret: string, step: number, digits = TOTP_DIGITS): string {
  const key = base32Decode(secret);
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(step));
  const digest = crypto.createHmac("sha1", key).update(counter).digest();
  const offset = digest[digest.length - 1] & 0x0f;
  const binary =
    ((digest[offset] & 0x7f) << 24) | ((digest[offset + 1] & 0xff) << 16) | ((digest[offset + 2] & 0xff) << 8) | (digest[offset + 3] & 0xff);
  return String(binary % 10 ** digits).padStart(digits, "0");
}

/**
 * Prüft einen Code gegen ±`window` Zeitfenster. `usedSteps` verhindert die
 * Wiederverwendung eines bereits akzeptierten Codes (Replay).
 */
export function verifyTotpCode(
  code: string,
  options: {secret?: string; atMs?: number; window?: number; usedSteps?: number[]} = {}
): TotpVerification {
  const secret = options.secret ?? process.env[TOTP_SECRET_ENV];
  if (!totpSecretConfigured(secret)) return {ok: false, reason: "TOTP_NOT_CONFIGURED"};
  if (typeof code !== "string" || !/^\d{6,8}$/.test(code.trim())) return {ok: false, reason: "TOTP_CODE_FORMAT"};
  const atMs = options.atMs ?? Date.now();
  const window = options.window ?? 1;
  const used = new Set(options.usedSteps ?? []);
  const supplied = Buffer.from(code.trim());
  for (let offset = -window; offset <= window; offset += 1) {
    const step = totpStep(atMs, offset);
    if (used.has(step)) continue;
    const expected = Buffer.from(totpCode(secret!, step));
    if (expected.length === supplied.length && crypto.timingSafeEqual(expected, supplied)) {
      return {ok: true, step};
    }
  }
  if ([...used].some(step => Math.abs(step - totpStep(atMs)) <= window)) {
    return {ok: false, reason: "TOTP_REPLAY"};
  }
  return {ok: false, reason: "TOTP_CODE_MISMATCH"};
}

/** Neues Base32-Secret für die Einrichtung (32 Zeichen = 160 Bit). */
export function generateTotpSecret(): string {
  const bytes = crypto.randomBytes(20);
  let bits = 0;
  let value = 0;
  let output = "";
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      output += BASE32_ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  return output;
}
