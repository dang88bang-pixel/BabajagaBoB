import fs from "node:fs";
import path from "node:path";
import {beforeAll, describe, expect, it, vi} from "vitest";
import {isolatedStorageRoot, TEST_BOOTSTRAP_SECRET} from "../helpers/runtime";

/**
 * Zweiter Faktor des Creator-Logins (Abschnitt 38).
 *
 * Fail closed ist die Kernaussage: Ist ein Secret gesetzt, dann ist der Faktor
 * verpflichtend — fehlender, falscher oder wiederverwendeter Code wird
 * verweigert, und ein Upgrade (Store v1 → v2) sperrt den Creator nicht aus.
 */

const TOTP_SECRET = "JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP";

const root = isolatedStorageRoot("creator-totp");
/** Login-Secret entsteht beim Bootstrap als Datei (`creator-token`, 0600). */
function loginSecret(): string {
  return fs.readFileSync(path.join(root, "creator-token"), "utf8").trim();
}

let totp: typeof import("../../lib/totp");
let creator: typeof import("../../lib/creator-auth");
let bootstrap: typeof import("../../lib/bootstrap");

beforeAll(async () => {
  delete process.env.BOB_CREATOR_TOTP_SECRET;
  vi.resetModules();
  totp = await import("../../lib/totp");
  creator = await import("../../lib/creator-auth");
  bootstrap = await import("../../lib/bootstrap");
  bootstrap.completeBootstrap({secret: TEST_BOOTSTRAP_SECRET, creatorName: "TOTP-Tester"});
});

describe("TOTP-Grundfunktionen", () => {
  it("erzeugt ein gültiges base32-Secret", () => {
    const secret = totp.generateTotpSecret();
    expect(secret).toMatch(/^[A-Z2-7]+$/);
    expect(totp.base32Decode(secret).length).toBe(20);
  });

  it("ist deterministisch für denselben Zeitschritt und ändert sich danach", () => {
    const step = totp.totpStep(Date.now());
    const a = totp.totpCode(TOTP_SECRET, step);
    const b = totp.totpCode(TOTP_SECRET, step);
    expect(a).toBe(b);
    expect(a).toMatch(/^\d{6}$/);
    expect(totp.totpCode(TOTP_SECRET, step + 1)).not.toBe(a);
  });

  it("akzeptiert nur das Fenster ±1 und verweigert fremde Codes", () => {
    const step = totp.totpStep(Date.now());
    expect(totp.verifyTotpCode(totp.totpCode(TOTP_SECRET, step), {secret: TOTP_SECRET}).ok).toBe(true);
    expect(totp.verifyTotpCode(totp.totpCode(TOTP_SECRET, step - 1), {secret: TOTP_SECRET}).ok).toBe(true);
    expect(totp.verifyTotpCode(totp.totpCode(TOTP_SECRET, step + 1), {secret: TOTP_SECRET}).ok).toBe(true);
    expect(totp.verifyTotpCode(totp.totpCode(TOTP_SECRET, step + 3), {secret: TOTP_SECRET}).ok).toBe(false);
    expect(totp.verifyTotpCode("000000", {secret: TOTP_SECRET, atMs: Date.now()}).ok).toBe(false);
    expect(totp.verifyTotpCode("", {secret: TOTP_SECRET}).ok).toBe(false);
  });

  it("verweigert die Wiederverwendung eines Zeitschritts (Replay-Schutz)", () => {
    const step = totp.totpStep(Date.now());
    const code = totp.totpCode(TOTP_SECRET, step);
    const first = totp.verifyTotpCode(code, {secret: TOTP_SECRET});
    expect(first.ok).toBe(true);
    expect(first.step).toBe(step);
    const replay = totp.verifyTotpCode(code, {secret: TOTP_SECRET, usedSteps: [step]});
    expect(replay.ok).toBe(false);
    expect(replay.reason).toMatch(/already used|replay/i);
  });
});

describe("Creator-Login mit zweitem Faktor", () => {
  it("bleibt ohne konfiguriertes Secret unverändert (NOT_CONFIGURED)", () => {
    delete process.env.BOB_CREATOR_TOTP_SECRET;
    expect(totp.totpConfigured()).toBe(false);
    const login = creator.verifyCreatorLogin(loginSecret());
    expect(login.ok).toBe(true);
    expect(login.secondFactor).toBe("NOT_CONFIGURED");
  });

  it("ist mit konfiguriertem Secret verpflichtend (fail closed)", () => {
    process.env.BOB_CREATOR_TOTP_SECRET = TOTP_SECRET;
    expect(totp.totpConfigured()).toBe(true);

    let missing: unknown;
    try {
      creator.verifyCreatorLogin(loginSecret());
    } catch (error) {
      missing = error;
    }
    expect((missing as {code?: string; status?: number}).code).toBe("TOTP_REQUIRED");
    expect((missing as {status?: number}).status).toBe(403);

    let wrong: unknown;
    try {
      creator.verifyCreatorLogin(loginSecret(), "000000");
    } catch (error) {
      wrong = error;
    }
    expect((wrong as {code?: string}).code).toBe("TOTP_REQUIRED");
  });

  it("akzeptiert den korrekten Code genau einmal (Replay wird verweigert)", () => {
    process.env.BOB_CREATOR_TOTP_SECRET = TOTP_SECRET;
    const code = totp.totpCode(TOTP_SECRET, totp.totpStep(Date.now(), 1));
    const login = creator.verifyCreatorLogin(loginSecret(), code);
    expect(login.ok).toBe(true);
    expect(login.secondFactor).toBe("TOTP");

    let replay: unknown;
    try {
      creator.verifyCreatorLogin(loginSecret(), code);
    } catch (error) {
      replay = error;
    }
    expect((replay as {code?: string}).code).toBe("TOTP_REQUIRED");
  });

  it("sperrt nach fünf Fehlversuchen (423) und meldet den gesperrten Zustand", () => {
    process.env.BOB_CREATOR_TOTP_SECRET = TOTP_SECRET;
    let last: unknown;
    for (let attempt = 0; attempt < 6; attempt += 1) {
      try {
        creator.verifyCreatorLogin(loginSecret(), "000000");
      } catch (error) {
        last = error;
      }
    }
    expect((last as {code?: string; status?: number}).code).toBe("CREATOR_LOCKED");
    expect((last as {status?: number}).status).toBe(423);
    expect(creator.creatorLockState().locked).toBe(true);
    // `creatorLoginAvailable()` sagt nur, ob ein Login-Secret existiert — der
    // Sperrzustand wird getrennt gemeldet (`creatorLockState`, `GET /api/auth`).
    expect(creator.creatorLoginAvailable()).toBe(true);
  });

  it("bewertet die TOTP-Konfiguration unabhängig vom Login-Secret", () => {
    process.env.BOB_CREATOR_TOTP_SECRET = TOTP_SECRET;
    expect(totp.totpSecretConfigured()).toBe(true);
    expect(totp.totpSecretConfigured("kurz")).toBe(false);
    delete process.env.BOB_CREATOR_TOTP_SECRET;
  });
});
