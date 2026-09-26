import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import {afterEach, beforeEach, describe, expect, it} from "vitest";
import {DurableStore, StoreIntegrityError, createStore, readMigrationJournal, listStoreBackups, repairStorePayloads, restoreStoreBackup, storeIntegrityReport, verifyStoreBackup} from "../../lib/persistence/store";

/**
 * Store-Migration (Abschnitt 39): Schema-Wechsel dürfen eine Installation nicht
 * aussperren, aber auch nichts stillschweigend annehmen. Getestet werden beide
 * Richtungen: migrierbar -> liest/schreibt v2 nach Prüfung; nicht migrierbar
 * oder neuer als der Code -> fail closed und Datei unverändert.
 */

let root: string;

function boundDigest(store: string, version: number, payload: unknown): string {
  return crypto.createHash("sha256").update(JSON.stringify({store, version, payload})).digest("hex");
}

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
    expect(onDisk.digest).toBe(boundDigest("creator-auth", 2, onDisk.payload));
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

describe("Schutz vor inhaltslosen Envelopes (Vergiftungsfehler)", () => {
  it("verweigert das Schreiben eines null-Payloads", () => {
    const store = new DurableStore<unknown>("leer", 1, () => ({items: []}));
    expect(() => store.write(null)).toThrow(/refusing to persist a null payload/);
    expect(fs.existsSync(path.join(root, "leer.json"))).toBe(false);
  });

  it("erkennt einen vorhandenen null-Payload und initialisiert den Store neu", () => {
    const file = path.join(root, "leer.json");
    writeEnvelope(file, 1, null);
    const store = new DurableStore<{items: string[]}>("leer", 1, () => ({items: []}));
    expect(store.read()).toEqual({items: []});
    const onDisk = JSON.parse(fs.readFileSync(file, "utf8"));
    expect(onDisk.payload).toEqual({items: []});
    expect(readMigrationJournal().some(entry => entry.backup === `${file}.null-payload`)).toBe(true);
  });

  it("meldet den Zustand im Integritätsbericht, ohne den Betrieb zu blockieren", () => {
    const file = path.join(root, "leer.json");
    writeEnvelope(file, 1, null);
    const store = new DurableStore<{items: string[]}>("leer", 1, () => ({items: []}));
    const report = store.integrity();
    expect(report.ok).toBe(true);
    expect(report.error).toMatch(/empty payload detected/);
    expect(store.read()).toEqual({items: []});
  });

  it("schreibt beim Backup leerer Stores deren echten Initialzustand", () => {
    const file = path.join(root, "frisch.json");
    const store = createStore("frisch", 1, () => ({items: ["initial"]}));
    const backupFile = store.backup();
    const backup = JSON.parse(fs.readFileSync(backupFile, "utf8"));
    expect(backup.payload).toEqual({items: ["initial"]});
    expect(backup.payload).not.toBeNull();
    // Der Live-Store ist durch das Backup nutzbar geblieben.
    expect(store.read()).toEqual({items: ["initial"]});
    expect(fs.existsSync(file)).toBe(true);
  });
});

describe("Reparaturweg über den Store-Registry", () => {
  it("repariert inhaltslose Envelopes aller registrierten Stores", () => {
    createStore("reparatur", 1, () => ({items: ["initial"]}));
    const file = path.join(root, "reparatur.json");
    writeEnvelope(file, 1, null);

    const results = repairStorePayloads();
    const entry = results.find(result => result.store === "reparatur");
    expect(entry?.repaired).toBe(true);
    expect(entry?.action).toMatch(/empty payload/);
    expect(JSON.parse(fs.readFileSync(file, "utf8")).payload).toEqual({items: ["initial"]});

    // Zweiter Lauf ist idempotent: nichts mehr zu reparieren.
    expect(repairStorePayloads().find(result => result.store === "reparatur")?.repaired).toBe(false);
  });
});

describe("Vollständigkeit der Store-Registry", () => {
  it("meldet auch Stores, die nur von einzelnen Modulen registriert werden", async () => {
    await import("../../lib/persistence/all-stores");
    const report = storeIntegrityReport();
    const names = report.stores.map(entry => entry.store);
    expect(report.registered).toBeGreaterThanOrEqual(30);
    // Diese Stores fehlten im Bericht, weil die Persistenz-Route ihre Module
    // nicht importiert hatte (Teilabdeckung → beschädigte Datei unbemerkt).
    for (const store of ["cicd", "simulation", "skills", "workshop"]) {
      expect(names).toContain(store);
    }
    expect(report.unregistered).toEqual([]);
  });
});

describe("Bindung an den Store-Namen", () => {
  it("schreibt den Store-Namen in den Envelope und bindet ihn in den Digest", () => {
    const store = createStore<{items: string[]}>("gebunden", 1, () => ({items: []}));
    store.write({items: ["a"]});
    const envelope = JSON.parse(fs.readFileSync(path.join(root, "gebunden.json"), "utf8"));
    expect(envelope.store).toBe("gebunden");
    expect(envelope.digest).toBe(crypto.createHash("sha256").update(JSON.stringify({store: "gebunden", version: 1, payload: {items: ["a"]}})).digest("hex"));
  });

  it("verweigert eine Datei, die unter fremdem Namen abgelegt wurde", () => {
    const store = createStore<{items: string[]}>("gebunden", 1, () => ({items: []}));
    store.write({items: ["a"]});
    fs.copyFileSync(path.join(root, "gebunden.json"), path.join(root, "umgeleitet.json"));
    const foreign = createStore<{items: string[]}>("umgeleitet", 1, () => ({items: []}));
    expect(() => foreign.read()).toThrow(/belongs to "gebunden"/);
  });

  it("liest ältere Envelopes ohne Store-Namen weiter (Bestandsinstallation)", () => {
    writeEnvelope(path.join(root, "legacy.json"), 1, {items: ["alt"]});
    const store = createStore<{items: string[]}>("legacy", 1, () => ({items: []}));
    expect(store.read()).toEqual({items: ["alt"]});
    // Nach dem nächsten Schreiben trägt der Envelope den Namen.
    store.write({items: ["neu"]});
    expect(JSON.parse(fs.readFileSync(path.join(root, "legacy.json"), "utf8")).store).toBe("legacy");
  });
});

describe("Reparatur hinterlässt eine echte Sicherungskopie", () => {
  it("legt die Datei mit leerem Inhalt ablegbar und verweist im Journal darauf", () => {
    const file = path.join(root, "verseucht.json");
    writeEnvelope(file, 1, null);
    const store = createStore("verseucht", 1, () => ({items: ["initial"]}));
    expect(store.read()).toEqual({items: ["initial"]});

    const copy = `${file}.null-payload`;
    expect(fs.existsSync(copy)).toBe(true);
    expect(JSON.parse(fs.readFileSync(copy, "utf8")).payload).toBeNull();
    const journal = readMigrationJournal().find(entry => entry.store === "verseucht");
    expect(journal?.backup).toBe(copy);
  });
});

describe("Backup-Zuordnung bei ähnlichen Store-Namen", () => {
  it("verwechselt workshop nicht mit workshop-executions", () => {
    const workshop = createStore("workshop", 1, () => ({items: []}));
    const executions = createStore("workshop-executions", 1, () => ({runs: []}));
    const workshopBackup = workshop.backup();
    const executionBackup = executions.backup();

    const reports = listStoreBackups();
    const workshopReports = reports.filter(report => report.store === "workshop");
    expect(workshopReports.map(report => report.file)).toEqual([workshopBackup]);

    // Ein fremdes Backup wird nicht als eigenes anerkannt und nicht eingespielt.
    const foreign = verifyStoreBackup("workshop", executionBackup);
    expect(foreign.ok).toBe(false);
    expect(foreign.error).toMatch(/workshop-executions/);
    expect(() => restoreStoreBackup("workshop", executionBackup)).toThrow(/cannot be restored here|workshop-executions/i);
  });
});
