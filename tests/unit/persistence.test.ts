import fs from "node:fs";
import path from "node:path";
import {beforeAll, describe, expect, it, vi} from "vitest";
import {isolatedStorageRoot} from "../helpers/runtime";

const root = isolatedStorageRoot("unit-store");

let storeModule: typeof import("../../lib/persistence/store");

beforeAll(async () => {
  vi.resetModules();
  storeModule = await import("../../lib/persistence/store");
});

describe("DurableStore (Persistenz)", () => {
  it("nutzt das isolierte Storage-Root", () => {
    expect(storeModule.storageRoot()).toBe(root);
  });

  it("schreibt atomar und liest mit bestätigtem Digest", () => {
    const store = storeModule.createStore("unit-basic", 1, () => ({items: [] as string[]}));
    store.write({items: ["a", "b"]});
    expect(store.read().items).toEqual(["a", "b"]);
    expect(store.integrity().ok).toBe(true);
    expect(storeModule.storeIntegrityReport().ok).toBe(true);
  });

  it("erkennt Manipulation fail-closed (Digest-Mismatch)", () => {
    const store = storeModule.createStore("unit-tamper", 1, () => ({items: [] as string[]}));
    store.write({items: ["original"]});
    const file = path.join(root, "unit-tamper.json");
    const envelope = JSON.parse(fs.readFileSync(file, "utf8")) as {payload: {items: string[]}};
    envelope.payload.items.push("manipuliert");
    fs.writeFileSync(file, JSON.stringify(envelope));
    expect(() => store.read()).toThrow(storeModule.StoreIntegrityError);
  });

  it("verwirft unbekannte Store-Versionen", () => {
    const payload = {items: [] as string[]};
    const envelope = {
      version: 99,
      writtenAt: new Date().toISOString(),
      payload,
      digest: storeModule.domainDigest({version: 99, payload})
    };
    fs.writeFileSync(path.join(root, "unit-version.json"), JSON.stringify(envelope));
    const store = storeModule.createStore("unit-version", 1, () => payload);
    expect(() => store.read()).toThrow(storeModule.StoreIntegrityError);
  });

  /**
   * Regression: Ein nicht lesbarer Store wurde als „store file is not valid
   * JSON" gemeldet — also als Datenbeschädigung statt als Lese-/Rechteproblem.
   * Ein Verzeichnis am Store-Dateipfad erzeugt deterministisch einen Lesefehler
   * (EISDIR), unabhängig davon, ob die Tests als root laufen.
   */
  it("meldet einen nicht lesbaren Store als Lesefehler, nicht als Beschädigung", () => {
    const unreadableFile = path.join(root, "unit-unreadable.json");
    fs.mkdirSync(unreadableFile, {recursive: true});
    const store = storeModule.createStore("unit-unreadable", 1, () => ({items: [] as string[]}));
    try {
      expect(() => store.read()).toThrow(/store file is not readable \(EISDIR\)/);
      expect(() => store.read()).not.toThrow(/not valid JSON/);
      const report = store.integrity();
      expect(report.ok).toBe(false);
      expect(report.error).toMatch(/not readable \(EISDIR\)/);
      expect(report.error).not.toMatch(/not valid JSON/);
    } finally {
      fs.rmSync(unreadableFile, {recursive: true, force: true});
    }
  });

  it("unterscheidet nicht vorhandene von beschädigten Stores", () => {
    const missing = storeModule.createStore("unit-missing", 1, () => ({items: [] as string[]}));
    expect(missing.integrity()).toMatchObject({ok: true, exists: false, error: "store not created yet"});
    const broken = path.join(root, "unit-broken.json");
    fs.writeFileSync(broken, "{ kaputt");
    const store = storeModule.createStore("unit-broken", 1, () => ({items: [] as string[]}));
    expect(() => store.read()).toThrow(/not valid JSON/);
    expect(store.integrity()).toMatchObject({ok: false, error: "[unit-broken] store file is not valid JSON"});
  });

  it("führt registrierte Stores mit Version und Datei", () => {
    const registry = storeModule.storeRegistry();
    expect(registry.some(entry => entry.store === "unit-basic")).toBe(true);
  });
});
