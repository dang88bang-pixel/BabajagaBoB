import fs from "node:fs";
import path from "node:path";
import {beforeAll, describe, expect, it, vi} from "vitest";
import {isolatedStorageRoot, TEST_BOOTSTRAP_SECRET} from "../helpers/runtime";

const ROOT = isolatedStorageRoot("int-metrics-backup");

let store: typeof import("../../lib/persistence/store");
let metrics: typeof import("../../lib/metrics");
let bootstrap: typeof import("../../lib/bootstrap");
let cp: typeof import("../../lib/control-plane");
let route: typeof import("../../app/api/persistence/route");
let authRoute: typeof import("../../app/api/auth/route");

let sessionCookie = "";

function jsonRequest(url: string, body: unknown, cookie?: string): Request {
  return new Request(url, {
    method: "POST",
    headers: {"content-type": "application/json", ...(cookie ? {cookie} : {})},
    body: JSON.stringify(body)
  });
}

beforeAll(async () => {
  vi.resetModules();
  store = await import("../../lib/persistence/store");
  metrics = await import("../../lib/metrics");
  bootstrap = await import("../../lib/bootstrap");
  cp = await import("../../lib/control-plane");
  route = await import("../../app/api/persistence/route");
  authRoute = await import("../../app/api/auth/route");
  bootstrap.completeBootstrap({secret: TEST_BOOTSTRAP_SECRET, creatorName: "Test Creator"});
  const login = await authRoute.POST(jsonRequest("http://localhost/api/auth", {action: "login", secret: ""}));
  expect([200, 201, 400, 403]).toContain(login.status);
  const session = await import("../../lib/session");
  const created = session.createSession({actorId: "CREATOR", role: "OWNER", ttlMs: 60_000});
  sessionCookie = `${session.SESSION_COOKIE}=${created.token}`;
});

describe("Backup mit Digest-Prüfung", () => {
  it("legt digest-geprüfte Kopien an und listet sie als verifiziert", async () => {
    const mission = cp.createMission({title: "Backup-Mission", objective: "Wiederherstellbarkeit prüfen", createdBy: "CREATOR"});
    expect(mission.missionId).toMatch(/^MIS-/);

    const response = await route.POST(jsonRequest("http://localhost/api/persistence", {action: "backup"}, sessionCookie));
    expect(response.status).toBe(201);
    const body = await response.json();
    expect(body.created.length).toBeGreaterThan(0);
    expect(body.verified).toBe(body.created.length);
    for (const file of body.created) {
      expect(fs.existsSync(file)).toBe(true);
      expect(path.dirname(file)).toContain(path.join("backups"));
      const mode = fs.statSync(file).mode & 0o777;
      expect([0o600, 0o400]).toContain(mode);
    }
    const listed = store.listStoreBackups();
    expect(listed.filter(entry => body.created.includes(entry.file)).every(entry => entry.ok)).toBe(true);
  });

  it("verweigert ein manipuliertes Backup (fail closed)", async () => {
    const reports = store.listStoreBackups();
    const target = reports.find(report => report.ok && report.store === "control-state") ?? reports[0];
    expect(target).toBeTruthy();
    const raw = JSON.parse(fs.readFileSync(target.file, "utf8"));
    raw.payload = {...raw.payload, injected: true};
    const tampered = `${target.file}.tampered.json`;
    fs.writeFileSync(tampered, JSON.stringify(raw), "utf8");
    const verification = store.verifyStoreBackup(target.store, tampered);
    expect(verification.ok).toBe(false);
    expect(verification.digestOk).toBe(false);
    expect(() => store.restoreStoreBackup(target.store, tampered)).toThrow(/integrity/i);
    // Über die Route: 409 statt Scheinerfolg.
    const response = await route.POST(jsonRequest("http://localhost/api/persistence", {action: "restore", store: target.store, file: tampered}, sessionCookie));
    expect(response.status).toBe(409);
    expect((await response.json()).failClosed).toBe(true);
    fs.rmSync(tampered, {force: true});
  });

  it("verweigert Backups außerhalb des Backup-Verzeichnisses", () => {
    const outside = path.join(ROOT, "control.json");
    fs.writeFileSync(outside, "{}", "utf8");
    const report = store.verifyStoreBackup("control-state", outside);
    expect(report.ok).toBe(false);
    expect(report.error).toMatch(/outside configured backup directory/);
    expect(() => store.restoreStoreBackup("control-state", outside)).toThrow(/outside configured backup directory/);
  });

  it("stellt einen Store aus einem geprüften Backup wieder her", async () => {
    const before = cp.createMission({title: "Nach-Backup", objective: "Differenz zeigen", createdBy: "CREATOR"});
    const response = await route.POST(jsonRequest("http://localhost/api/persistence", {action: "backup"}, sessionCookie));
    const created = (await response.json()).created as string[];
    const controlBackup = created.find(file => path.basename(file).startsWith("control-state-"));
    expect(controlBackup).toBeTruthy();
    cp.createMission({title: "Nach-Backup 2", objective: "noch eine Mission", createdBy: "CREATOR"});
    expect(cp.getControlState().missions.length).toBeGreaterThan(0);
    const restored = store.restoreStoreBackup("control-state", controlBackup!);
    expect(restored.store).toBe("control-state");
    expect(restored.restoredAt).toBeTruthy();
    expect(before.title).toBe("Nach-Backup");
  });
});

describe("Betriebsmetriken", () => {
  it("liefert Prometheus-Textformat aus gemessenen Werten", () => {
    const text = metrics.renderPrometheusMetrics();
    expect(text).toContain("# TYPE bob_stores_total gauge");
    expect(text).toMatch(/bob_stores_healthy \d+/);
    expect(text).toMatch(/bob_audit_chain_ok [01]/);
    expect(text).toMatch(/bob_capability_tokens_active \d+/);
    expect(text).toMatch(/bob_knowledge_negative \d+/);
    expect(text.endsWith("\n")).toBe(true);
  });

  it("exponiert nur Zahlen und keine Geheimnisse oder Subjektnamen", () => {
    const text = metrics.renderPrometheusMetrics();
    // Jede Messzeile muss genau einen numerischen Wert tragen – kein Freitext,
    // keine Token, keine Subjekte.
    const sampleLines = text.split("\n").filter(line => line.length > 0 && !line.startsWith("#"));
    expect(sampleLines.length).toBeGreaterThan(20);
    for (const line of sampleLines) {
      expect(line).toMatch(/^[a-z_]+(\{[^}]*\})? -?\d+(\.\d+)?$/);
    }
    expect(text).not.toContain("secret");
    expect(text).not.toContain("Bobcap");
    for (const agent of cp.getControlState().agents) {
      expect(text).not.toContain(agent.agentId);
    }
  });
});
