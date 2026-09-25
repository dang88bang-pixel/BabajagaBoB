import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import {afterEach, beforeEach, describe, expect, it} from "vitest";
import {DurableStore, StoreIntegrityError, createStore, readMigrationJournal, restoreStoreBackup, verifyStoreBackup} from "../../lib/persistence/store";

/**
 * Store-Migration (Abschnitt 39): Schema-Wechsel dürfen eine Installation nicht
 * aussperren, aber auch nichts stillschweigend annehmen. Getestet werden beide
 * Richtungen: migrierbar -> liest/schreibt v2 nach Prüfung; nicht migrierbar
 * oder neuer als der Code -> fail closed und Datei unverändert.
 */

let root: string;

function digest(version: number, payload: unknown): string {
  return crypto.createHash("sha256").update(JSON.stringify({version, payload})).digest("hex");
}

function writeEnvelope(file: string, version: number, payload: unknown) {
  fs.writeFileSync(file, JSON.stringify({version, writtenAt: new Date().toISOString(), payload, digest: digest(version, payload)}, null, 2));
}

const v1Payload = {secretHash: "hash", secretCreatedAt: "2026-01-01T00:00:00.000Z", source: "ENV", failures: [], lockedUntil: null};
const migration = {1: (payload: unknown) => ({...(payload as Record<string, unknown>), totpUsedSteps: []})};

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "bob-migration-"));
  process.env.BOB_STORAGE_DIR = root;
});

afterEach(() => {
  delete process.env.BOB_STORAGE_DIR;
  fs.rmSync(root, {recursive: true, force: true});
});

describe("Store-Migration", () => {
  it("migriert eine ältere Datei, sichert das Original und schreibt die Journaleintragung", () => {
    const file = path.join(root, "creator-auth.json");
    writeEnvelope(file, 1, v1Payload);
    const store = new DurableStore<Record<string, unknown>>("creator-auth", 2, () => ({}), {migrations: migration});

    const payload = store.read();
    expect(payload.totpUsedSteps).toEqual([]);
    expect(payload.secretHash).toBe("hash");

    const onDisk = JSON.parse(fs.readFileSync(file, "utf8"));
    expect(onDisk.version).toBe(2);
    expect(onDisk.digest).toBe(digest(2, onDisk.payload));
    expect(onDisk.payload.totpUsedSteps).toEqual([]);

    const safety = `${file}.pre-v1.bak`;
    expect(fs.existsSync(safety)).toBe(true);
    expect(JSON.parse(fs.readFileSync(safety, "utf8")).version).toBe(1);

    const journal = readMigrationJournal();
    expect(journal).toHaveLength(1);
    expect(journal[0]).toMatchObject({store: "creator-auth", fromVersion: 1, toVersion: 2, backup: safety});
  });

  it("migriert nur einmal (zweites Lesen nutzt die bereits migrierte Datei)", () => {
    const file = path.join(root, "creator-auth.json");
    writeEnvelope(file, 1, v1Payload);
    const store = new DurableStore<Record<string, unknown>>("creator-auth", 2, () => ({}), {migrations: migration});
    store.read();
    store.read();
    expect(readMigrationJournal()).toHaveLength(1);
  });

  it("fail closed ohne registrierte Migrationskette — Datei bleibt unverändert", () => {
    const file = path.join(root, "creator-auth.json");
    writeEnvelope(file, 1, v1Payload);
    const before = fs.readFileSync(file, "utf8");
    const store = new DurableStore<Record<string, unknown>>("creator-auth", 2, () => ({}));

    expect(() => store.read()).toThrow(StoreIntegrityError);
    expect(fs.readFileSync(file, "utf8")).toBe(before);
    expect(fs.existsSync(`${file}.pre-v1.bak`)).toBe(false);
    expect(readMigrationJournal()).toHaveLength(0);
  });

  it("fail closed bei unvollständiger Kette (Lücke zwischen den Versionen)", () => {
    const file = path.join(root, "creator-auth.json");
    writeEnvelope(file, 1, v1Payload);
    const store = new DurableStore<Record<string, unknown>>("creator-auth", 3, () => ({}), {migrations: {2: () => ({})}});
    expect(store.canMigrate(1)).toBe(false);
    expect(() => store.read()).toThrow(/no migration chain/);
  });

  it("fail closed bei neuerer Datei als der Code (kein Downgrade)", () => {
    const file = path.join(root, "creator-auth.json");
    writeEnvelope(file, 3, v1Payload);
    const store = new DurableStore<Record<string, unknown>>("creator-auth", 2, () => ({}), {migrations: migration});
    expect(() => store.read()).toThrow(/newer than the code expects/);
  });

  it("prüft den Digest vor der Migration (Manipulation wird nicht migriert)", () => {
    const file = path.join(root, "creator-auth.json");
    writeEnvelope(file, 1, v1Payload);
    const tampered = JSON.parse(fs.readFileSync(file, "utf8"));
    tampered.payload.secretHash = "manipuliert";
    fs.writeFileSync(file, JSON.stringify(tampered, null, 2));
    const store = new DurableStore<Record<string, unknown>>("creator-auth", 2, () => ({}), {migrations: migration});
    expect(() => store.read()).toThrow(/digest mismatch/);
    expect(fs.existsSync(`${file}.pre-v1.bak`)).toBe(false);
  });

  it("wendet eine mehrstufige Kette in Reihenfolge an", () => {
    const file = path.join(root, "chain.json");
    writeEnvelope(file, 1, {step: 1});
    const store = new DurableStore<Record<string, unknown>>("chain", 3, () => ({}), {
      migrations: {
        1: payload => ({...(payload as Record<string, unknown>), step: 2}),
        2: payload => ({...(payload as Record<string, unknown>), step: 3, done: true})
      }
    });
    expect(store.read()).toMatchObject({step: 3, done: true});
    expect(JSON.parse(fs.readFileSync(file, "utf8")).version).toBe(3);
  });

  it("meldet eine fehlgeschlagene Migrationsfunktion als Integritätsfehler", () => {
    const file = path.join(root, "chain.json");
    writeEnvelope(file, 1, {step: 1});
    const store = new DurableStore<Record<string, unknown>>("chain", 2, () => ({}), {
      migrations: {
        1: () => {
          throw new Error("kaputt");
        }
      }
    });
    expect(() => store.read()).toThrow(/migration 1 -> 2 failed: kaputt/);
  });
});

describe("Backups über Schemagrenzen", () => {
  it("erkennt ältere Sicherungen als migrierbar statt als Fehler", () => {
    const file = path.join(root, "creator-auth.json");
    writeEnvelope(file, 1, v1Payload);
    // Registrierter Store mit Migrationskette: die Backup-Prüfung muss ihn kennen.
    const backupFile = path.join(root, "backups", "creator-auth-2026-01-01.json");
    fs.mkdirSync(path.dirname(backupFile), {recursive: true});
    writeEnvelope(backupFile, 1, v1Payload);
    createStore("creator-auth", 2, () => ({...v1Payload, totpUsedSteps: []}), {migrations: migration});

    const report = verifyStoreBackup("creator-auth", backupFile);
    expect(report.ok).toBe(true);
    expect(report.migrationRequired).toBe(true);
    expect(report.digestOk).toBe(true);
  });

  it("stellt eine ältere Sicherung migrierend wieder her und sichert den aktuellen Stand", () => {
    const file = path.join(root, "creator-auth.json");
    writeEnvelope(file, 2, {...v1Payload, totpUsedSteps: [42]});
    const backupFile = path.join(root, "backups", "creator-auth-alt.json");
    fs.mkdirSync(path.dirname(backupFile), {recursive: true});
    writeEnvelope(backupFile, 1, v1Payload);
    createStore("creator-auth", 2, () => ({...v1Payload, totpUsedSteps: []}), {migrations: migration});

    const restored = restoreStoreBackup("creator-auth", backupFile);
    expect(restored.store).toBe("creator-auth");
    const onDisk = JSON.parse(fs.readFileSync(file, "utf8"));
    expect(onDisk.version).toBe(2);
    expect(onDisk.payload.totpUsedSteps).toEqual([]);
    // Der vorherige Stand ist als Sicherungskopie vorhanden (kein Datenverlust).
    expect(fs.existsSync(`${file}.pre-v2.bak`)).toBe(true);
  });

  it("lehnt neuere Sicherungen ab (kein Downgrade)", () => {
    const backupFile = path.join(root, "backups", "creator-auth-neu.json");
    fs.mkdirSync(path.dirname(backupFile), {recursive: true});
    writeEnvelope(backupFile, 3, v1Payload);
    createStore("creator-auth", 2, () => ({...v1Payload, totpUsedSteps: []}), {migrations: migration});
    const report = verifyStoreBackup("creator-auth", backupFile);
    expect(report.ok).toBe(false);
    expect(report.error).toMatch(/newer than the code expects/);
  });
});
