import fs from "node:fs";
import {beforeAll, beforeEach, describe, expect, it, vi} from "vitest";
import {isolatedStorageRoot, TEST_BOOTSTRAP_SECRET} from "../helpers/runtime";

/**
 * Backup-Automation mit Aufbewahrungsregel.
 *
 * Der Kern sind die **harten Sicherheitsgrenzen** des Aufräumens: das neueste
 * und das einzige Backup eines Stores werden nie gelöscht, korrupte Sicherungen
 * werden nicht als Müll behandelt, und ein zweiter Lauf im laufenden Intervall
 * führt nicht zu einem stillen Zweitlauf. Geprüft wird gegen das echte
 * Dateisystem im isolierten Storage-Root.
 */

const root = isolatedStorageRoot("backup-auto");
const BASE = "http://localhost:3000";
void root;

let policy: typeof import("../../lib/backup-policy");
let store: typeof import("../../lib/persistence/store");
let route: typeof import("../../app/api/persistence/route");
let cookie = "";

beforeAll(async () => {
  vi.resetModules();
  policy = await import("../../lib/backup-policy");
  store = await import("../../lib/persistence/store");
  route = await import("../../app/api/persistence/route");
  const auth = await import("../../app/api/auth/route");
  const login = await auth.POST(
    new Request(`${BASE}/api/auth`, {
      method: "POST",
      headers: {"content-type": "application/json"},
      body: JSON.stringify({action: "bootstrap", secret: TEST_BOOTSTRAP_SECRET, creatorName: "Backup-Tester"})
    })
  );
  expect(login.status).toBe(201);
  cookie = (login.headers.get("set-cookie") ?? "").split(";")[0];
});

beforeEach(() => {
  vi.unstubAllEnvs();
});

describe("Aufbewahrungsregel", () => {
  it("löscht nur verifizierte Sicherungen jenseits der Grenze und nie die neueste", () => {
    const reports = [
      {store: "demo", file: "/b/demo-3.json", name: "demo-3.json", bytes: 10, writtenAt: "2026-01-03T00:00:00.000Z", digestOk: true, migrationRequired: false, ok: true},
      {store: "demo", file: "/b/demo-2.json", name: "demo-2.json", bytes: 10, writtenAt: "2026-01-02T00:00:00.000Z", digestOk: true, migrationRequired: false, ok: true},
      {store: "demo", file: "/b/demo-1.json", name: "demo-1.json", bytes: 10, writtenAt: "2026-01-01T00:00:00.000Z", digestOk: true, migrationRequired: false, ok: true},
      {store: "demo", file: "/b/demo-0.json", name: "demo-0.json", bytes: 10, writtenAt: "2025-12-31T00:00:00.000Z", digestOk: true, migrationRequired: false, ok: true},
      {store: "demo", file: "/b/demo-broken.json", name: "demo-broken.json", bytes: 10, writtenAt: "2025-12-30T00:00:00.000Z", digestOk: false, migrationRequired: false, ok: false, error: "digest mismatch"}
    ];
    // `fs.rmSync` wird beobachtet: geprüft wird die Entscheidung, nicht die Datei.
    const removed: string[] = [];
    const spy = vi.spyOn(fs, "rmSync").mockImplementation(((target: fs.PathLike) => {
      removed.push(String(target));
    }) as typeof fs.rmSync);
    try {
      const result = policy.pruneBackups({intervalMs: 60_000, keepPerStore: 2}, reports as never);
      expect(removed.sort()).toEqual(["/b/demo-1.json", "/b/demo-0.json"].sort());
      expect(result.kept).toBe(2);
      // Korrupte Sicherungen sind ein Befund und werden gemeldet, nicht gelöscht.
      expect(result.corrupted.map(entry => entry.file)).toEqual(["/b/demo-broken.json"]);
      expect(removed).not.toContain("/b/demo-3.json");
    } finally {
      spy.mockRestore();
    }
  });

  it("löscht nie die einzige Sicherung eines Stores", () => {
    const spy = vi.spyOn(fs, "rmSync").mockImplementation((() => undefined) as unknown as typeof fs.rmSync);
    try {
      const result = policy.pruneBackups(
        {intervalMs: 60_000, keepPerStore: 1},
        [{store: "einzeln", file: "/b/only.json", name: "only.json", bytes: 1, writtenAt: "2026-01-01T00:00:00.000Z", digestOk: true, migrationRequired: false, ok: true}] as never
      );
      expect(spy).not.toHaveBeenCalled();
      expect(result.deleted).toEqual([]);
      expect(result.skipped.some(entry => entry.store === "einzeln")).toBe(true);
    } finally {
      spy.mockRestore();
    }
  });

  it("liest die Grenzen aus der Umgebung und weist unsinnige Werte zurück", () => {
    vi.stubEnv("BOB_BACKUP_KEEP", "0");
    vi.stubEnv("BOB_BACKUP_INTERVAL_MS", "keine-zahl");
    const fallback = policy.backupPolicy();
    expect(fallback.keepPerStore).toBe(5);
    expect(fallback.intervalMs).toBe(60 * 60_000);

    vi.stubEnv("BOB_BACKUP_KEEP", "3");
    vi.stubEnv("BOB_BACKUP_INTERVAL_MS", "120000");
    const configured = policy.backupPolicy();
    expect(configured.keepPerStore).toBe(3);
    expect(configured.intervalMs).toBe(120_000);
  });
});

describe("Geplanter Lauf", () => {
  it("läuft einmal, überspringt den zweiten Lauf und erzwingt ihn nur ausdrücklich", () => {
    const first = policy.runScheduledBackup({actor: "CREATOR"});
    expect(first.ran).toBe(true);
    expect(first.createdAt.length).toBeGreaterThan(0);
    expect(first.verified).toBe(first.createdAt.length);
    expect(first.reason).toContain("Intervall abgelaufen");

    const second = policy.runScheduledBackup({actor: "CREATOR"});
    expect(second.ran).toBe(false);
    expect(second.createdAt).toEqual([]);
    expect(second.reason).toMatch(/noch nicht abgelaufen/);

    const forced = policy.runScheduledBackup({force: true, actor: "CREATOR"});
    expect(forced.ran).toBe(true);
    expect(forced.reason).toContain("erzwungen");
  });

  it("liefert einen Status mit Fälligkeit, Aufbewahrung und Integrität", () => {
    const status = policy.backupAutomationStatus();
    expect(status.policy.keepPerStore).toBeGreaterThanOrEqual(1);
    expect(status.runs).toBeGreaterThanOrEqual(1);
    expect(status.backups.count).toBeGreaterThan(0);
    expect(status.backups.verified).toBeGreaterThan(0);
    expect(status.backups.location.endsWith("backups")).toBe(true);
    expect(status.integrity.ok).toBe(true);
    expect(typeof status.due).toBe("boolean");
  });

  it("schreibt Audit und Ereignis für den Lauf", async () => {
    const audit = await import("../../lib/audit");
    const records = audit.auditSnapshot(50).filter(record => record.action === "persistence.backup.run");
    expect(records.length).toBeGreaterThan(0);
    expect(records.every(record => record.decision === "ALLOW")).toBe(true);
    expect(audit.verifyAuditChain().valid).toBe(true);
  });

  it("legt für jeden registrierten Store eine verifizierbare Kopie an", () => {
    const backups = store.listStoreBackups();
    expect(backups.length).toBeGreaterThan(0);
    expect(backups.every(backup => backup.digestOk)).toBe(true);
  });
});

describe("Persistenz-Route", () => {
  it("führt den geplanten Lauf über die geschützte Route aus", async () => {
    const response = await route.POST(
      new Request(`${BASE}/api/persistence`, {
        method: "POST",
        headers: {"content-type": "application/json", cookie},
        body: JSON.stringify({action: "backup.run", force: true})
      })
    );
    expect(response.status).toBe(201);
    const body = (await response.json()) as {ran: boolean; verified: number; prune: {kept: number}};
    expect(body.ran).toBe(true);
    expect(body.verified).toBeGreaterThan(0);
    expect(body.prune.kept).toBeGreaterThan(0);

    const prune = await route.POST(
      new Request(`${BASE}/api/persistence`, {
        method: "POST",
        headers: {"content-type": "application/json", cookie},
        body: JSON.stringify({action: "backup.prune"})
      })
    );
    expect(prune.status).toBe(200);
    const pruneBody = (await prune.json()) as {deleted: unknown[]; corrupted: unknown[]};
    expect(Array.isArray(pruneBody.deleted)).toBe(true);
    expect(Array.isArray(pruneBody.corrupted)).toBe(true);
  });

  it("verweigert ohne Session und ohne Aktion", async () => {
    const anonymous = await route.POST(
      new Request(`${BASE}/api/persistence`, {
        method: "POST",
        headers: {"content-type": "application/json"},
        body: JSON.stringify({action: "backup.run"})
      })
    );
    expect([401, 428]).toContain(anonymous.status);

    const noAction = await route.POST(
      new Request(`${BASE}/api/persistence`, {
        method: "POST",
        headers: {"content-type": "application/json", cookie},
        body: JSON.stringify({})
      })
    );
    expect(noAction.status).toBe(400);
  });
});
