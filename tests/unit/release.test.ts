import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest";
import {TEST_BOOTSTRAP_SECRET} from "../helpers/runtime";

/**
 * Release-Slots (Abschnitt 24).
 *
 * Die Tests arbeiten mit **echten Verzeichnissen** auf der Platte: Sie bauen
 * einen Mini-Build (`.next/BUILD_ID` + Dateien), erzeugen daraus einen Slot und
 * prüfen die Zusicherungen, auf die sich das Deployment verlässt:
 *  - Der Digest deckt jede Datei ab (Manipulation wird erkannt).
 *  - Der Zeigerwechsel ist atomar und hinterlässt keinen halben Zustand.
 *  - Ein unbrauchbarer Quellstand wird nie zu einem Release (fail closed).
 */

let root = "";
let source = "";

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "bob-release-"));
  source = path.join(root, "source");
  fs.mkdirSync(path.join(source, ".next"), {recursive: true});
  fs.writeFileSync(path.join(source, ".next", "BUILD_ID"), "BUILD-ABC\n");
  fs.writeFileSync(path.join(source, ".next", "server.js"), "console.log('hi')\n");
  fs.mkdirSync(path.join(source, "public"));
  fs.writeFileSync(path.join(source, "public", "index.html"), "<html></html>");
  fs.mkdirSync(path.join(source, "scripts"));
  fs.writeFileSync(path.join(source, "scripts", "ns-exec.sh"), "#!/bin/sh\n");
  fs.writeFileSync(path.join(source, "package.json"), JSON.stringify({name: "bob", version: "1.0.0"}));
  process.env.BOB_STORAGE_DIR = path.join(root, "data");
  process.env.BOB_RELEASE_DIR = path.join(root, "releases");
  process.env.BOB_NS_ISOLATION = "off";
  process.env.BOB_BOOTSTRAP_SECRET = TEST_BOOTSTRAP_SECRET;
  vi.resetModules();
});

afterEach(() => {
  delete process.env.BOB_STORAGE_DIR;
  delete process.env.BOB_RELEASE_DIR;
  delete process.env.BOB_NS_ISOLATION;
  delete process.env.BOB_BOOTSTRAP_SECRET;
  fs.rmSync(root, {recursive: true, force: true});
});

describe("Release-Slots", () => {
  it("erzeugt einen Slot mit Manifest und Digest über jede Datei", async () => {
    const release = await import("../../lib/release");
    const manifest = release.prepareRelease({source, label: "Testslot"});
    expect(manifest.releaseId).toMatch(/^REL-/);
    expect(manifest.buildId).toBe("BUILD-ABC");
    expect(manifest.included).toContain(".next");
    expect(manifest.included).toContain("scripts");
    expect(manifest.nodeModules).toBe("ABSENT");
    expect(manifest.files).toBeGreaterThanOrEqual(4);

    const verified = release.verifyRelease(manifest.releaseId);
    expect(verified.ok).toBe(true);
    expect(verified.digest).toBe(manifest.digest);
    expect(release.readManifest(manifest.releaseId).label).toBe("Testslot");
  });

  it("erkennt jede Änderung an einer ausgelieferten Datei (Digest-Prüfung)", async () => {
    const release = await import("../../lib/release");
    const manifest = release.prepareRelease({source, label: "Manipulation"});
    fs.writeFileSync(path.join(release.releasePath(manifest.releaseId), ".next", "server.js"), "console.log('manipuliert')\n");
    const verified = release.verifyRelease(manifest.releaseId);
    expect(verified.ok).toBe(false);
    expect(verified.detail).toContain("digest");
    // Auch eine zusätzliche Datei fällt auf (Anzahl weicht ab).
    fs.writeFileSync(path.join(release.releasePath(manifest.releaseId), "extra.txt"), "x");
    expect(release.verifyRelease(manifest.releaseId).ok).toBe(false);
    expect(release.listReleases().find(entry => entry.manifest.releaseId === manifest.releaseId)?.state).toBe("DEFECTIVE");
  });

  it("stellt den Zeiger atomar um und behält den Vorgänger", async () => {
    const release = await import("../../lib/release");
    const first = release.prepareRelease({source, label: "r1"});
    const switched = release.setCurrentRelease(first.releaseId);
    expect(switched.current).toBe(first.releaseId);
    expect(release.currentReleaseId()).toBe(first.releaseId);

    fs.writeFileSync(path.join(source, ".next", "BUILD_ID"), "BUILD-DEF\n");
    const second = release.prepareRelease({source, label: "r2"});
    const again = release.setCurrentRelease(second.releaseId);
    expect(again.previous).toBe(first.releaseId);
    expect(release.currentReleaseId()).toBe(second.releaseId);
    // Kein Rest eines Zwischenschritts im Verzeichnis.
    expect(fs.readdirSync(release.releaseRoot()).filter(name => name.startsWith(".current-"))).toEqual([]);
  });

  it("verweigert unbrauchbare Quellstände und unbekannte Slots", async () => {
    const release = await import("../../lib/release");
    const empty = path.join(root, "leer");
    fs.mkdirSync(empty, {recursive: true});
    expect(() => release.prepareRelease({source: empty, label: "x"})).toThrow(/BUILD_ID missing/);
    expect(() => release.prepareRelease({source: path.join(root, "gibtsnicht"), label: "x"})).toThrow(/does not exist/);
    expect(() => release.readManifest("REL-GIBTS-NICHT")).toThrow(/not found/);
    expect(() => release.releasePath("../../etc")).toThrow(/release id/);
    expect(release.currentReleaseId()).toBeNull();
  });

  it("schützt aktiven Slot und Vorgänger beim Aufräumen", async () => {
    const release = await import("../../lib/release");
    const a = release.prepareRelease({source, label: "a"});
    release.setCurrentRelease(a.releaseId);
    const b = release.prepareRelease({source, label: "b"});
    const c = release.prepareRelease({source, label: "c"});
    release.setCurrentRelease(c.releaseId);
    const removed = release.pruneReleases(0, [b.releaseId]);
    expect(removed).toContain(a.releaseId);
    expect(removed).not.toContain(c.releaseId);
    expect(removed).not.toContain(b.releaseId);
    expect(release.currentReleaseId()).toBe(c.releaseId);
  });

  it("meldet den laufenden Stand aus dem Arbeitsverzeichnis", async () => {
    const release = await import("../../lib/release");
    const manifest = release.prepareRelease({source, label: "laufend"});
    release.setCurrentRelease(manifest.releaseId);
    const running = release.runningBuildId();
    // Tests laufen im Repository, nicht in einem Release-Slot: Die Funktion darf
    // deshalb keinen Slot erfinden — sie nennt nur, was sie wirklich vorfindet.
    expect(running.cwd.length).toBeGreaterThan(0);
    expect(running.releaseId === null || /^REL-/.test(running.releaseId)).toBe(true);
    expect(running.buildId === null || typeof running.buildId === "string").toBe(true);
  });
});
