import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import {afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi} from "vitest";
import {TEST_BOOTSTRAP_SECRET} from "../helpers/runtime";

/**
 * Deployment (Abschnitt 24 / Zielkette „Deployment").
 *
 * Der Test baut **echte** Release-Slots und misst gegen einen **echten**
 * HTTP-Server (Mini-Instanz auf einem freien Port). Geprüft werden die
 * Zusicherungen, an denen ein Deployment scheitern muss:
 *  - ohne bestandene Promotion-Gates und ohne Freigabe kein Rollout,
 *  - ohne gesunden Zielzustand kein Rollout (Health-Check vor dem Umschalten),
 *  - „aktiv" nur, wenn der laufende Stand die Build-ID wirklich ausliefert,
 *  - Rollback nur mit unversehrtem Vorgänger, danach erneute Messung,
 *  - Kill-Switch blockiert, Audit-/Event-Kette bleibt gültig.
 */

let root = "";
let source = "";
let server: http.Server | null = null;
let base = "";
let healthy = true;

const BUILD_FILES = ["server.js", "routes-manifest.json"];

function writeBuild(buildId: string) {
  fs.mkdirSync(path.join(source, ".next"), {recursive: true});
  fs.writeFileSync(path.join(source, ".next", "BUILD_ID"), `${buildId}\n`);
  for (const file of BUILD_FILES) fs.writeFileSync(path.join(source, ".next", file), `// ${buildId} ${file}\n`);
  fs.mkdirSync(path.join(source, "scripts"), {recursive: true});
  fs.writeFileSync(path.join(source, "scripts", "ns-exec.sh"), "#!/bin/sh\n");
  fs.writeFileSync(path.join(source, "package.json"), JSON.stringify({name: "bob-test"}));
}

beforeAll(async () => {
  server = http.createServer((request, response) => {
    if (!healthy) {
      response.writeHead(503).end("down");
      return;
    }
    if (request.url === "/api/auth") {
      response.writeHead(200, {"content-type": "application/json"}).end(JSON.stringify({initialized: true, authenticated: false}));
      return;
    }
    response.writeHead(200, {"content-type": "text/html"}).end("<!DOCTYPE html><html><body>Test</body></html>");
  });
  await new Promise<void>(resolve => server?.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  base = `http://127.0.0.1:${typeof address === "object" && address ? address.port : 0}`;
});

afterAll(async () => {
  await new Promise<void>(resolve => server?.close(() => resolve()));
});

beforeEach(() => {
  healthy = true;
  root = fs.mkdtempSync(path.join(os.tmpdir(), "bob-deploy-"));
  source = path.join(root, "app");
  writeBuild("BUILD-ONE");
  process.env.BOB_STORAGE_DIR = path.join(root, "data");
  process.env.BOB_RELEASE_DIR = path.join(root, "releases");
  process.env.BOB_NS_ISOLATION = "off";
  process.env.BOB_BOOTSTRAP_SECRET = TEST_BOOTSTRAP_SECRET;
  vi.resetModules();
});

afterEach(() => {
  delete process.env.BOB_RELEASE_DIR;
  fs.rmSync(root, {recursive: true, force: true});
});

/** Legt Pipeline + Freigabe so an, wie es die Promotion-Gates verlangen. */
async function readyGates(module: {cicd: typeof import("../../lib/cicd"); approvals: typeof import("../../lib/approvals"); cp: typeof import("../../lib/control-plane")}) {
  const {cicd, approvals, cp} = module;
  const mission = cp.createMission({title: "Deployment", objective: "Ausrollen", createdBy: "CREATOR"});
  const objective = cp.createObjective({missionId: mission.missionId, title: "Deployment", description: "Ausrollen"});
  const task = cp.createTask({missionId: mission.missionId, objectiveId: objective.objectiveId, title: "Release", risk: "LOW", assignedAgent: "AG-OPS", createdBy: "CREATOR"});
  const approval = approvals.createApproval({
    taskId: task.taskId,
    requestedBy: "AG-OPS",
    changeSummary: "Release ausrollen",
    why: "Neuer geprüfter Stand",
    expectedEffect: "Neue Build-ID wird ausgeliefert",
    risks: ["kurze Nichtverfügbarkeit"],
    testResults: ["alle Suiten grün"],
    rollbackPlan: "Zeiger zurückstellen und neu starten",
    files: ["lib/deployment.ts"],
    dbChanges: [],
    networkEffects: [],
    affectedSystems: ["platform"]
  });
  approvals.resolveApprovalRequest(approval.approvalId, "GRANTED", "CREATOR");
  const pipeline = cicd.createPipeline({taskId: task.taskId, branch: "main", approvalId: approval.approvalId});
  for (const kind of ["LINT", "TYPECHECK", "UNIT", "INTEGRATION", "SECURITY", "BUILD"] as const) cicd.updateCheck(pipeline.id, kind, "PASSED", `${kind} grün`);
  cicd.promote(pipeline.id, "STAGING");
  // Browser und Auswertung laufen in dieser Umgebung nicht real: Die Pipeline
  // führt sie als ausdrücklich übersprungen **mit Begründung**. Genau diesen
  // Zustand verlangt das Staging-Gate; der Produktions-Rollout bleibt blockiert.
  cicd.updateCheck(pipeline.id, "BROWSER", "SKIPPED", "kein Browser in dieser Umgebung installierbar");
  cicd.updateCheck(pipeline.id, "EVALUATION", "SKIPPED", "keine Auswertungsinstanz vorhanden");
  cicd.promote(pipeline.id, "SMOKE");
  // Der Smoke-Test läuft real (Live-Prüfungen) und ist deshalb bestanden.
  cicd.updateCheck(pipeline.id, "SMOKE", "PASSED", "Live-Smoke-Prüfungen grün");
  return {taskId: task.taskId, approvalId: approval.approvalId, pipelineId: pipeline.id};
}

describe("Deployment-Ablauf", () => {
  it("verweigert den Rollout ohne Gates, ohne Freigabe und legt einen REJECTED-Datensatz an", async () => {
    const release = await import("../../lib/release");
    const {deployRelease, planDeployment, listDeployments} = await import("../../lib/deployment");
    const manifest = release.prepareRelease({source, label: "ohne Gates"});

    const plan = planDeployment({releaseId: manifest.releaseId});
    expect(plan.allowed).toBe(false);
    expect(plan.reasons.join(" ")).toContain("pipeline required");
    expect(plan.reasons.join(" ")).toContain("approval required");

    const result = await deployRelease({releaseId: manifest.releaseId, requestedBy: "CREATOR", base});
    expect(result.allowed).toBe(false);
    expect(result.deployment.state).toBe("REJECTED");
    expect(release.currentReleaseId()).toBeNull();
    expect(listDeployments()).toHaveLength(1);
  });

  it("rollt mit Gates und Freigabe aus und misst den laufenden Stand", async () => {
    const release = await import("../../lib/release");
    const cicd = await import("../../lib/cicd");
    const approvals = await import("../../lib/approvals");
    const cp = await import("../../lib/control-plane");
    const {deployRelease, verifyDeployment, listDeployments} = await import("../../lib/deployment");
    const {auditSnapshot, verifyAuditChain} = await import("../../lib/audit");
    const {verifyEventChain} = await import("../../lib/events/log");

    const gates = await readyGates({cicd, approvals, cp});
    const manifest = release.prepareRelease({source, label: "Rollout"});
    const result = await deployRelease({...gates, releaseId: manifest.releaseId, requestedBy: "CREATOR", base});

    expect(result.allowed).toBe(true);
    expect(["STAGED", "ACTIVE"]).toContain(result.deployment.state);
    expect(result.deployment.health.every(check => check.ok)).toBe(true);
    expect(result.deployment.health.map(check => check.kind)).toEqual(
      expect.arrayContaining(["RELEASE_DIGEST", "STORE", "EVENT_CHAIN", "AUDIT_CHAIN", "ISOLATION", "HTTP_APP", "HTTP_ROOT"])
    );
    expect(release.currentReleaseId()).toBe(manifest.releaseId);
    // Der laufende Prozess ist der Testprozess (kein Release-Slot) — deshalb darf
    // der Zustand nicht „aktiv" behaupten, sondern nennt den nötigen Neustart.
    expect(result.deployment.restartRequired).toBe(true);
    expect(result.deployment.verifiedActive).toBe(false);
    expect(result.deployment.supervisorHint).toContain("release-supervisor.sh");

    const verified = verifyDeployment(result.deployment.deploymentId);
    expect(verified.state).toBe("STAGED");
    expect(listDeployments()).toHaveLength(1);
    expect(auditSnapshot(50).some(record => record.action === "deployment.execute")).toBe(true);
    expect(auditSnapshot(50).some(record => record.action === "deployment.verify")).toBe(true);
    expect(verifyAuditChain().valid).toBe(true);
    expect(verifyEventChain().valid).toBe(true);
    expect(cicd.getPipeline(gates.pipelineId)?.stage).toBe("SMOKE");
  });

  it("bricht vor dem Umschalten ab, wenn der Zielzustand nicht gesund ist", async () => {
    const release = await import("../../lib/release");
    const cicd = await import("../../lib/cicd");
    const approvals = await import("../../lib/approvals");
    const cp = await import("../../lib/control-plane");
    const {deployRelease} = await import("../../lib/deployment");
    const {listInbox} = await import("../../lib/inbox");

    const gates = await readyGates({cicd, approvals, cp});
    const manifest = release.prepareRelease({source, label: "krank"});
    healthy = false;
    const result = await deployRelease({...gates, releaseId: manifest.releaseId, requestedBy: "CREATOR", base});

    expect(result.allowed).toBe(true);
    expect(result.deployment.state).toBe("FAILED");
    expect(release.currentReleaseId()).toBeNull();
    expect(result.deployment.health.some(check => check.kind === "HTTP_APP" && !check.ok)).toBe(true);
    expect(listInbox().some(item => item.mode === "BLOCK")).toBe(true);
  });

  it("nennt einen gleichen Build aus fremdem Arbeitsverzeichnis nicht „aktiv“", async () => {
    // Genau die Falle, in die eine oberflächliche Prüfung tappt: Der laufende
    // Prozess meldet dieselbe Build-ID wie der Slot — er startet aber aus einem
    // anderen Verzeichnis. Das ist kein Ausrollen, sondern Zufall.
    //
    // Das Arbeitsverzeichnis des „laufenden" Prozesses wird hier ausdrücklich
    // selbst hergestellt (statt es aus der Umgebung zu erraten): Der Test darf
    // nicht davon abhängen, ob im Repository gerade ein Build liegt.
    const buildId = "BUILD-GLEICH-1";
    const elsewhere = path.join(root, "fremder-start");
    fs.mkdirSync(path.join(elsewhere, ".next"), {recursive: true});
    fs.writeFileSync(path.join(elsewhere, ".next", "BUILD_ID"), `${buildId}\n`);
    writeBuild(buildId);

    const release = await import("../../lib/release");
    const deployment = await import("../../lib/deployment");
    const cicd = await import("../../lib/cicd");
    const approvals = await import("../../lib/approvals");
    const cp = await import("../../lib/control-plane");
    const gates = await readyGates({cicd, approvals, cp});
    const manifest = release.prepareRelease({source, label: "gleicher-build"});
    expect(manifest.buildId).toBe(buildId);

    const originalCwd = process.cwd();
    process.chdir(elsewhere);
    try {
      const result = await deployment.deployRelease({...gates, releaseId: manifest.releaseId, requestedBy: "CREATOR", base});
      expect(result.allowed).toBe(true);
      expect(result.deployment.runningBuildId).toBe(buildId);
      expect(result.deployment.runningReleaseId, "Slot darf nicht aus dem fremden Verzeichnis abgeleitet werden").toBeNull();
      expect(result.deployment.state).toBe("STAGED");
      expect(result.deployment.verifiedActive).toBe(false);
      expect(result.deployment.restartRequired).toBe(true);
      expect(result.deployment.supervisorHint).toContain("release-supervisor.sh");
      expect(result.deployment.supervisorHint).toContain("statt aus dem Slot");
    } finally {
      process.chdir(originalCwd);
    }
  });

  it("rollt auf den Vorgänger zurück und misst danach erneut", async () => {
    const release = await import("../../lib/release");
    const cicd = await import("../../lib/cicd");
    const approvals = await import("../../lib/approvals");
    const cp = await import("../../lib/control-plane");
    const {deployRelease, rollbackDeployment} = await import("../../lib/deployment");

    const gates = await readyGates({cicd, approvals, cp});
    const first = release.prepareRelease({source, label: "v1"});
    const one = await deployRelease({...gates, releaseId: first.releaseId, requestedBy: "CREATOR", base});
    expect(one.deployment.state).toBe("STAGED");

    writeBuild("BUILD-TWO");
    const second = release.prepareRelease({source, label: "v2"});
    const two = await deployRelease({...gates, releaseId: second.releaseId, requestedBy: "CREATOR", base});
    expect(two.deployment.fromReleaseId).toBe(first.releaseId);
    expect(release.currentReleaseId()).toBe(second.releaseId);

    // Manipulation am Vorgänger: Rollback muss verweigert werden (fail closed).
    fs.appendFileSync(path.join(release.releasePath(first.releaseId), ".next", "server.js"), "// sabotage\n");
    const blocked = await rollbackDeployment(two.deployment.deploymentId, "CREATOR", "Regression in v2", base);
    expect(blocked.performed).toBe(false);
    expect(blocked.reasons.join(" ")).toContain("not intact");
    expect(release.currentReleaseId()).toBe(second.releaseId);

    // Nach Wiederherstellung des Digests gelingt der Rückroll.
    fs.writeFileSync(path.join(release.releasePath(first.releaseId), ".next", "server.js"), `// BUILD-ONE ${BUILD_FILES[0]}\n`);
    const performed = await rollbackDeployment(two.deployment.deploymentId, "CREATOR", "Regression in v2", base);
    expect(performed.performed).toBe(true);
    expect(performed.deployment.state).toBe("ROLLED_BACK");
    expect(release.currentReleaseId()).toBe(first.releaseId);
    expect(performed.deployment.health.every(check => check.ok)).toBe(true);
  });

  it("verweigert Rollout und Rollback bei aktivem Kill-Switch", async () => {
    const release = await import("../../lib/release");
    const cicd = await import("../../lib/cicd");
    const approvals = await import("../../lib/approvals");
    const cp = await import("../../lib/control-plane");
    const governance = await import("../../lib/governance");
    const {deployRelease, planDeployment} = await import("../../lib/deployment");

    const gates = await readyGates({cicd, approvals, cp});
    const manifest = release.prepareRelease({source, label: "killswitch"});
    governance.setKillSwitch("DEPLOYMENT", manifest.releaseId, true, "Release gesperrt");

    const plan = planDeployment({...gates, releaseId: manifest.releaseId});
    expect(plan.allowed).toBe(false);
    expect(plan.reasons.join(" ")).toContain("kill-switch");

    const result = await deployRelease({...gates, releaseId: manifest.releaseId, requestedBy: "CREATOR", base});
    expect(result.deployment.state).toBe("REJECTED");
    expect(release.currentReleaseId()).toBeNull();
    governance.setKillSwitch("DEPLOYMENT", manifest.releaseId, false, "Freigabe");
  });

  it("verweigert den Rollout, wenn der Release-Digest nicht mehr stimmt", async () => {
    const release = await import("../../lib/release");
    const cicd = await import("../../lib/cicd");
    const approvals = await import("../../lib/approvals");
    const cp = await import("../../lib/control-plane");
    const {deployRelease} = await import("../../lib/deployment");

    const gates = await readyGates({cicd, approvals, cp});
    const manifest = release.prepareRelease({source, label: "manipuliert"});
    fs.appendFileSync(path.join(release.releasePath(manifest.releaseId), ".next", "server.js"), "// sabotage\n");

    const result = await deployRelease({...gates, releaseId: manifest.releaseId, requestedBy: "CREATOR", base});
    expect(result.deployment.state).toBe("REJECTED");
    expect(result.reasons.join(" ")).toContain("digest invalid");
    expect(release.currentReleaseId()).toBeNull();
  });
});
