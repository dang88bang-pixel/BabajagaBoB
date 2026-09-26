import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import {afterAll, beforeAll, describe, expect, it, vi} from "vitest";
import {TEST_BOOTSTRAP_SECRET} from "../helpers/runtime";

/**
 * Auslieferung über die Route (Abschnitt 24).
 *
 * Der Test geht den Weg, den ein Betreiber wirklich geht: über HTTP gegen die
 * echten Routen-Handler. Er legt ein Release aus einem Mini-Build an, versucht
 * ohne Gates auszurollen (409), richtet Pipeline und Freigabe ein und prüft
 * danach, dass die Route den Vorgang dokumentiert — inklusive der ehrlichen
 * Aussage, dass der laufende Prozess neu gestartet werden muss.
 */

const root = fs.mkdtempSync(path.join(os.tmpdir(), "bob-e2e-deploy-"));
const BASE = "http://localhost:3000";
let cookie = "";
let source = "";
let selfServer: http.Server;
const deployed: {releaseId: string; pipelineId: string; approvalId: string} = {releaseId: "", pipelineId: "", approvalId: ""};

let deploymentRoute: typeof import("../../app/api/deployment/route");
let cicdRoute: typeof import("../../app/api/cicd/route");
let approvalsRoute: typeof import("../../app/api/approvals/center/route");

function call(url: string, body?: Record<string, unknown>, withSession = true) {
  const headers: Record<string, string> = {"content-type": "application/json", host: "localhost:3000"};
  if (withSession) headers.cookie = cookie;
  return deploymentRoute.POST(
    new Request(`${BASE}${url}`, {method: "POST", headers, body: body ? JSON.stringify(body) : undefined}) as never
  );
}

beforeAll(async () => {
  process.env.BOB_STORAGE_DIR = path.join(root, "data");
  process.env.BOB_RELEASE_DIR = path.join(root, "releases");
  process.env.BOB_NS_ISOLATION = "off";
  process.env.BOB_BOOTSTRAP_SECRET = TEST_BOOTSTRAP_SECRET;
  vi.resetModules();

  // Der Health-Check prüft den laufenden Dienst wirklich per HTTP. Statt das zu
  // umgehen, steht hier ein echter Mini-Server: genau die zwei Antworten, die
  // ein gesunder Dienst liefert.
  selfServer = http.createServer((request, response) => {
    if (request.url?.startsWith("/api/auth")) {
      response.writeHead(200, {"content-type": "application/json"});
      response.end(JSON.stringify({initialized: true}));
      return;
    }
    response.writeHead(200, {"content-type": "text/html"});
    response.end("<!doctype html><html><body>BabajagaBoB</body></html>");
  });
  await new Promise<void>(resolve => selfServer.listen(0, "127.0.0.1", () => resolve()));
  const address = selfServer.address();
  process.env.BOB_SELF_URL = `http://127.0.0.1:${typeof address === "object" && address ? address.port : 0}`;

  source = path.join(root, "app");
  fs.mkdirSync(path.join(source, ".next"), {recursive: true});
  fs.writeFileSync(path.join(source, ".next", "BUILD_ID"), "BUILD-E2E\n");
  fs.writeFileSync(path.join(source, ".next", "server.js"), "// build\n");
  fs.mkdirSync(path.join(source, "scripts"), {recursive: true});
  fs.writeFileSync(path.join(source, "scripts", "ns-exec.sh"), "#!/bin/sh\n");
  fs.writeFileSync(path.join(source, "package.json"), "{}");

  const auth = await import("../../app/api/auth/route");
  const bootstrap = await auth.POST(
    new Request(`${BASE}/api/auth`, {
      method: "POST",
      headers: {"content-type": "application/json"},
      body: JSON.stringify({action: "bootstrap", secret: TEST_BOOTSTRAP_SECRET, creatorName: "E2E"})
    })
  );
  expect(bootstrap.status).toBe(201);
  cookie = (bootstrap.headers.get("set-cookie") ?? "").split(";")[0];

  deploymentRoute = await import("../../app/api/deployment/route");
  cicdRoute = await import("../../app/api/cicd/route");
  approvalsRoute = await import("../../app/api/approvals/center/route");
});

describe("Auslieferung über die Route", () => {
  it("legt ein Release an, verweigert ohne Gates den Rollout (409) und dokumentiert ihn", async () => {
    const prepared = await call("/api/deployment", {action: "prepare", source, label: "E2E-Release"});
    expect(prepared.status).toBe(201);
    const manifest = ((await prepared.json()) as {release: {releaseId: string; buildId: string; files: number}}).release;
    expect(manifest.buildId).toBe("BUILD-E2E");
    expect(manifest.files).toBeGreaterThanOrEqual(3);

    const plan = await call("/api/deployment", {action: "plan", releaseId: manifest.releaseId});
    expect(plan.status).toBe(200);
    const planned = (await plan.json()) as {allowed: boolean; reasons: string[]; target: string};
    expect(planned.allowed).toBe(false);
    expect(planned.target).toBe("STAGING");
    expect(planned.reasons.join(" ")).toContain("pipeline required");

    const denied = await call("/api/deployment", {action: "deploy", releaseId: manifest.releaseId});
    expect(denied.status).toBe(409);
    const rejected = (await denied.json()) as {deployment: {state: string; reasons: string[]}};
    expect(rejected.deployment.state).toBe("REJECTED");
    expect(rejected.deployment.reasons.join(" ")).toContain("approval required");

    const snapshot = await deploymentRoute.GET(new Request(`${BASE}/api/deployment`, {headers: {cookie, host: "localhost:3000"}}) as never);
    const view = (await snapshot.json()) as {current: string | null; releases: {manifest: {releaseId: string}; state: string}[]; deployments: {state: string}[]};
    expect(view.current).toBeNull();
    expect(view.releases.map(entry => entry.manifest.releaseId)).toContain(manifest.releaseId);
    expect(view.deployments.map(entry => entry.state)).toContain("REJECTED");
  });

  it("rollt mit Gates und Freigabe aus und nennt den nötigen Neustart", async () => {
    const snapshotBefore = await deploymentRoute.GET(new Request(`${BASE}/api/deployment`, {headers: {cookie, host: "localhost:3000"}}) as never);
    const releaseId = ((await snapshotBefore.json()) as {releases: {manifest: {releaseId: string}}[]}).releases[0].manifest.releaseId;

    // Mission/Task über die echten Routen, dann Freigabe und Pipeline.
    const missions = await import("../../app/api/missions/route");
    const tasks = await import("../../app/api/tasks/route");
    const json = (url: string, body: Record<string, unknown>) =>
      new Request(`${BASE}${url}`, {method: "POST", headers: {"content-type": "application/json", host: "localhost:3000", cookie}, body: JSON.stringify(body)});

    const mission = await missions.POST(json("/api/missions", {action: "create-mission", title: "Deployment", objective: "Ausrollen"}) as never);
    expect(mission.status).toBe(201);
    const missionId = ((await mission.json()) as {mission: {missionId: string}}).mission.missionId;
    const objective = await missions.POST(json("/api/missions", {action: "create-objective", missionId, title: "Deployment", description: "Ausrollen"}) as never);
    const objectiveId = ((await objective.json()) as {objective: {objectiveId: string}}).objective.objectiveId;
    const task = await tasks.POST(json("/api/tasks", {action: "create", missionId, objectiveId, title: "Release", risk: "LOW", assignedAgent: "AG-OPS"}) as never);
    expect(task.status).toBe(201);
    const taskId = ((await task.json()) as {task: {taskId: string}}).task.taskId;

    const approval = await approvalsRoute.POST(
      new Request(`${BASE}/api/approvals/center`, {method: "POST", headers: {"content-type": "application/json", host: "localhost:3000", cookie}, body: JSON.stringify({action: "create", value: {taskId, requestedBy: "AG-OPS", changeSummary: "Release", why: "Neuer Stand", expectedEffect: "Neue Build-ID", risks: [], testResults: [], rollbackPlan: "Zeiger zurück", files: [], dbChanges: [], networkEffects: [], affectedSystems: ["platform"]}})}) as never
    );
    expect(approval.status).toBe(201);
    const approvalId = ((await approval.json()) as {approval: {approvalId: string}}).approval.approvalId;
    // Eine Freigabe zu erteilen ist ein Governance-Akt: Sie verlangt zusätzlich
    // einen Capability-Token mit `approval:resolve` (kein Creator-Token im Browser).
    const authority = await import("../../lib/authority");
    const grant = authority.issueCapabilityToken({
      subject: "AG-GOVERNANCE",
      taskId,
      sandboxId: "SB-GOVERNANCE",
      capabilities: ["approval:resolve"],
      risk: "LOW",
      issuedBy: "CREATOR",
      issuedByKind: "CREATOR",
      environment: "production",
      expiresAt: new Date(Date.now() + 5 * 60_000).toISOString()
    });
    const resolved = await approvalsRoute.POST(
      new Request(`${BASE}/api/approvals/center`, {method: "POST", headers: {"content-type": "application/json", host: "localhost:3000", cookie}, body: JSON.stringify({action: "resolve", id: approvalId, status: "GRANTED", actor: "CREATOR", capabilityTokenId: grant.token.id})}) as never
    );
    if (resolved.status !== 200) throw new Error(`resolve ${resolved.status}: ${await resolved.text()}`);
    expect(resolved.status).toBe(200);

    const pipeline = await cicdRoute.POST(json("/api/cicd", {action: "create", value: {taskId, branch: "main", approvalId}}) as never);
    expect(pipeline.status).toBe(201);
    const pipelineId = ((await pipeline.json()) as {pipeline: {id: string}}).pipeline.id;
    for (const kind of ["LINT", "TYPECHECK", "UNIT", "INTEGRATION", "SECURITY", "BUILD"]) {
      const check = await cicdRoute.POST(json("/api/cicd", {action: "check", pipelineId, kind, status: "PASSED", summary: `${kind} grün`}) as never);
      expect(check.status).toBe(200);
    }
    expect((await cicdRoute.POST(json("/api/cicd", {action: "promote", pipelineId, stage: "STAGING"}) as never)).status).toBe(200);
    // Browser und Auswertung sind hier nicht real ausführbar. Sie werden nicht
    // heimlich übersprungen, sondern als Lücke mit Begründung quittiert und im
    // Deployment-Datensatz sichtbar geführt — Produktion bleibt gesperrt.
    await cicdRoute.POST(json("/api/cicd", {action: "check", pipelineId, kind: "BROWSER", status: "SKIPPED", summary: "kein Browser in dieser Umgebung"}) as never);
    await cicdRoute.POST(json("/api/cicd", {action: "check", pipelineId, kind: "EVALUATION", status: "SKIPPED", summary: "keine Auswertungsinstanz vorhanden"}) as never);
    expect((await cicdRoute.POST(json("/api/cicd", {action: "promote", pipelineId, stage: "SMOKE"}) as never)).status).toBe(200);
    await cicdRoute.POST(json("/api/cicd", {action: "check", pipelineId, kind: "SMOKE", status: "PASSED", summary: "Smoke grün"}) as never);

    const rollout = await call("/api/deployment", {action: "deploy", releaseId, pipelineId, approvalId});
    expect(rollout.status).toBe(200);
    const result = (await rollout.json()) as {
      deployment: {state: string; restartRequired: boolean; verifiedActive: boolean; supervisorHint: string; health: {ok: boolean}[]; acknowledgedGaps: string[]};
    };
    expect(result.deployment.health.every(check => check.ok)).toBe(true);
    expect(result.deployment.acknowledgedGaps.join(" ")).toContain("BROWSER");
    expect(result.deployment.acknowledgedGaps.join(" ")).toContain("EVALUATION");
    expect(result.deployment.verifiedActive).toBe(false);
    expect(result.deployment.restartRequired).toBe(true);
    expect(result.deployment.supervisorHint).toContain("release-supervisor.sh");

    // Der Vorgang ist über das Betriebsbild sichtbar und bleibt ehrlich: Der
    // Testprozess läuft nicht im Release-Slot, also ist er nicht „aktiv".
    deployed.releaseId = releaseId;
    deployed.pipelineId = pipelineId;
    deployed.approvalId = approvalId;

    const after = await deploymentRoute.GET(new Request(`${BASE}/api/deployment`, {headers: {cookie, host: "localhost:3000"}}) as never);
    const view = (await after.json()) as {current: string | null; runningBuildId: string | null; deployments: {deploymentId: string; state: string; restartRequired: boolean}[]};
    expect(view.current).toBe(releaseId);
    expect(view.deployments[0].state).toBe("STAGED");
    expect(view.deployments[0].restartRequired).toBe(true);

    const verify = await call("/api/deployment", {action: "verify", deploymentId: view.deployments[0].deploymentId});
    expect(verify.status).toBe(200);
    expect(((await verify.json()) as {deployment: {state: string}}).deployment.state).toBe("STAGED");

    // Zwei verschiedene Sachverhalte, zwei verschiedene Antworten:
    const unknown = await call("/api/deployment", {action: "rollback", deploymentId: "DEP-GIBTS-NICHT", reason: "Test"});
    expect(unknown.status).toBe(404);
    const unknownVerify = await call("/api/deployment", {action: "verify", deploymentId: "DEP-GIBTS-NICHT"});
    expect(unknownVerify.status).toBe(404);
  });

  it("rollt nicht auf einen ungesunden Dienst aus, wenn der Vorgang PRODUKTION verlangt", async () => {
    // Zwei ehrliche Verweigerungen in einem Durchgang:
    // 1. PRODUKTION verlangt den vollen Promotion-Gate — BROWSER/EVALUATION sind
    //    hier nur SKIPPED, also bleibt der Rollout gesperrt (Spezifikation wird
    //    nicht abgeschwächt).
    // 2. Selbst für STAGING gilt: Ist der Dienst nicht gesund, wird nichts
    //    umgestellt — kein Zeigerwechsel, kein stiller Erfolg.
    const snapshotBefore = await deploymentRoute.GET(new Request(`${BASE}/api/deployment`, {headers: {cookie, host: "localhost:3000"}}) as never);
    const before = (await snapshotBefore.json()) as {current: string | null; releases: {manifest: {releaseId: string}}[]};
    expect(before.current).not.toBeNull();

    expect(deployed.releaseId, "Test 2 hat kein Release ausgerollt").not.toBe("");
    const production = await call("/api/deployment", {action: "plan", releaseId: deployed.releaseId, pipelineId: deployed.pipelineId, approvalId: deployed.approvalId, target: "PRODUCTION"});
    const productionPlan = (await production.json()) as {allowed: boolean; target: string; reasons: string[]};
    expect(productionPlan.target).toBe("PRODUCTION");
    expect(productionPlan.allowed).toBe(false);
    // Der Produktions-Rollout verlangt BROWSER/EVALUATION wirklich PASSED — die
    // quittierte Staging-Lücke hilft hier absichtlich nicht.
    expect(productionPlan.reasons.join(" ")).toContain("BROWSER");

    const badTarget = await call("/api/deployment", {action: "plan", releaseId: deployed.releaseId, target: "IRGENDWO"});
    expect(badTarget.status).toBe(400);

    // Dienst anhalten: Ab jetzt ist der Health-Check echt rot.
    await new Promise<void>(resolve => selfServer.close(() => resolve()));
    const failed = await call("/api/deployment", {action: "deploy", releaseId: deployed.releaseId, pipelineId: deployed.pipelineId, approvalId: deployed.approvalId});
    expect(failed.status).toBe(409);
    const failure = (await failed.json()) as {deployment: {state: string; restartRequired: boolean; health: {ok: boolean; name: string; detail: string}[]; reasons: string[]}};
    expect(failure.deployment.state).toBe("FAILED");
    expect(failure.deployment.restartRequired).toBe(false);
    expect(failure.deployment.reasons.join(" ")).toContain("HTTP");

    const after = (await (await deploymentRoute.GET(new Request(`${BASE}/api/deployment`, {headers: {cookie, host: "localhost:3000"}}) as never)).json()) as {current: string | null};
    expect(after.current, "Zeiger wurde trotz Health-Fehler umgestellt").toBe(before.current);
  });
});

afterAll(async () => {
  await new Promise<void>(resolve => selfServer.close(() => resolve()));
});
