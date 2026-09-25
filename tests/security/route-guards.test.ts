import {beforeAll, describe, expect, it, vi} from "vitest";
import {isolatedStorageRoot, TEST_BOOTSTRAP_SECRET} from "../helpers/runtime";

isolatedStorageRoot("sec-route-guards");

let authRoute: typeof import("../../app/api/auth/route");
let provenanceRoute: typeof import("../../app/api/provenance/route");
let knowledgeRoute: typeof import("../../app/api/knowledge/route");
let runsRoute: typeof import("../../app/api/runs/route");
let cp: typeof import("../../lib/control-plane");
let authority: typeof import("../../lib/authority");
let session: typeof import("../../lib/session");
let fabric: typeof import("../../lib/sandbox/fabric");
let audit: typeof import("../../lib/audit");

const AGENT = "AG-BUILD";
const BASE = "http://localhost:3000";
let sessionCookie = "";
let taskId = "";
let sandboxId = "";

function request(path: string, init: RequestInit = {}): Request {
  return new Request(`${BASE}${path}`, init);
}

function jsonRequest(path: string, body: unknown, headers: Record<string, string> = {}): Request {
  return request(path, {
    method: "POST",
    headers: {"content-type": "application/json", ...headers},
    body: JSON.stringify(body)
  });
}

async function bootstrapCookie(): Promise<string> {
  const response = await authRoute.POST(
    jsonRequest("/api/auth", {action: "bootstrap", secret: TEST_BOOTSTRAP_SECRET, creatorName: "Test Creator"})
  );
  expect(response.status).toBe(201);
  return (response.headers.get("set-cookie") ?? "").split(";")[0];
}

beforeAll(async () => {
  vi.resetModules();
  authRoute = await import("../../app/api/auth/route");
  provenanceRoute = await import("../../app/api/provenance/route");
  knowledgeRoute = await import("../../app/api/knowledge/route");
  runsRoute = await import("../../app/api/runs/route");
  cp = await import("../../lib/control-plane");
  authority = await import("../../lib/authority");
  session = await import("../../lib/session");
  fabric = await import("../../lib/sandbox/fabric");
  audit = await import("../../lib/audit");
  expect(session.SESSION_COOKIE).toBe("bob_session");
});

describe("Routen-Guards (Provenance, Knowledge, Runs)", () => {
  it("verweigert Provenance, Knowledge und Runs vor dem Bootstrap fail closed (428)", async () => {
    const provenance = await provenanceRoute.GET(request("/api/provenance"));
    expect(provenance.status).toBe(428);
    const knowledge = await knowledgeRoute.GET(request("/api/knowledge"));
    expect(knowledge.status).toBe(428);
    const runs = await runsRoute.GET(request("/api/runs"));
    expect(runs.status).toBe(428);
    expect(audit.verifyAuditChain().valid).toBe(true);
  });

  it("legt nach dem Bootstrap Mission, Objective, Task und Agentenbindung an", async () => {
    sessionCookie = await bootstrapCookie();
    const mission = cp.createMission({title: "Guard-Mission", objective: "Routengrenzen prüfen", createdBy: "CREATOR"});
    const objective = cp.createObjective({missionId: mission.missionId, title: "Guard-Objective", description: "HTTP-Grenzen"});
    const task = cp.createTask({
      missionId: mission.missionId,
      objectiveId: objective.objectiveId,
      title: "Guard-Task",
      risk: "LOW",
      assignedAgent: AGENT,
      createdBy: "CREATOR"
    });
    taskId = task.taskId;
    expect(taskId).toMatch(/^TASK-/);
    const sandbox = await fabric.createSandbox({type: "test", taskId, agentId: AGENT, risk: "LOW"});
    sandboxId = sandbox.sandboxId;
    expect(sandboxId).toMatch(/^SB-/);
  });

  it("erlaubt Lesen und Schreiben mit Creator-Session (HttpOnly-Cookie)", async () => {
    const cookie = {cookie: sessionCookie};
    const provenance = await provenanceRoute.GET(request("/api/provenance", {headers: cookie}));
    expect(provenance.status).toBe(200);
    expect(await provenance.json()).toHaveProperty("edges");

    const knowledge = await knowledgeRoute.POST(
      jsonRequest(
        "/api/knowledge",
        {action: "upsert", record: {title: "Routengrenze", statement: "Guards sind fail closed", layer: "SEMANTIC", state: "OBSERVED", tags: ["guard"]}},
        cookie
      )
    );
    expect(knowledge.status).toBe(201);

    const run = await runsRoute.POST(jsonRequest("/api/runs", {action: "create", taskId, agentId: AGENT, risk: "LOW"}, cookie));
    expect(run.status).toBe(201);
    expect((await run.json()).run.runId).toMatch(/^RUN-/);
  });

  it("verweigert unauthentifizierte Aufrufe (401) und auditiert die Ablehnung", async () => {
    const provenance = await provenanceRoute.GET(request("/api/provenance"));
    expect(provenance.status).toBe(401);
    const knowledge = await knowledgeRoute.POST(jsonRequest("/api/knowledge", {action: "upsert", record: {title: "x"}}));
    expect(knowledge.status).toBe(401);
    const runs = await runsRoute.GET(request("/api/runs"));
    expect(runs.status).toBe(401);
    const denials = audit.auditSnapshot(200).filter(record => record.decision === "DENY");
    expect(denials.length).toBeGreaterThan(0);
  });

  it("verweigert Schreibzugriff für Agenten-Capabilitys (Creator-only, 403)", async () => {
    const issued = authority.issueCapabilityToken({
      subject: AGENT,
      taskId,
      sandboxId,
      // Der Agent besitzt die Fähigkeiten formal – trotzdem bleibt Schreiben
      // in Provenance/Knowledge eine Creator-Aktion (Evidenzintegrität).
      capabilities: ["task:execute", "knowledge:read", "knowledge:write", "provenance:read", "provenance:write"],
      risk: "LOW",
      issuedBy: "CREATOR",
      issuedByKind: "CREATOR",
      environment: "development",
      expiresAt: new Date(Date.now() + 5 * 60_000).toISOString()
    });
    const agentHeader = {"authorization": `Bobcap ${issued.token.id}.${issued.secret}`};

    // Lesen mit passender Capability ist erlaubt …
    expect((await provenanceRoute.GET(request("/api/provenance", {headers: agentHeader}))).status).toBe(200);
    // … aber Schreiben bleibt Creator-Aktion.
    const provenanceWrite = await provenanceRoute.POST(
      jsonRequest("/api/provenance", {action: "node", value: {id: "PN-AGENT", kind: "ARTIFACT", label: "Agent-Schreibversuch"}}, agentHeader)
    );
    expect(provenanceWrite.status).toBe(403);
    expect((await provenanceWrite.json()).error).toBe("CREATOR_ONLY");

    const knowledgeWrite = await knowledgeRoute.POST(
      jsonRequest("/api/knowledge", {action: "upsert", record: {title: "Agent-Wissen", statement: "sollte verweigert werden"}}, agentHeader)
    );
    expect(knowledgeWrite.status).toBe(403);
    expect((await knowledgeWrite.json()).error).toBe("CREATOR_ONLY");

    // Runs ohne `run:manage`-Capability: Verweigerung nennt die fehlende Fähigkeit.
    const runWrite = await runsRoute.POST(jsonRequest("/api/runs", {action: "create", taskId, agentId: AGENT, risk: "LOW"}, agentHeader));
    expect(runWrite.status).toBe(403);
    expect((await runWrite.json()).error).toBe("CAPABILITY_DENIED");
    expect((await provenanceRoute.GET(request("/api/provenance", {headers: {authorization: "Bobcap CAP-UNBEKANNT.geheim"}}))).status).toBe(403);
    expect(audit.verifyAuditChain().valid).toBe(true);
  });

  it("verweigert Cross-Origin-Mutationen mit Session-Cookie (CSRF, 403)", async () => {
    const crossOrigin = await provenanceRoute.POST(
      jsonRequest("/api/provenance", {action: "node", value: {id: "PN-CSRF", kind: "ARTIFACT", label: "CSRF"}}, {
        cookie: sessionCookie,
        host: "localhost:3000",
        origin: "https://angreifer.example"
      })
    );
    expect(crossOrigin.status).toBe(403);
    expect((await crossOrigin.json()).error).toBe("CSRF_ORIGIN");
  });
});

/**
 * Nachgezogene Prüfungen für verschachtelte Routen.
 *
 * Der (rekursiv verschärfte) Routenvertrag hat zwei Routen ohne eigene
 * Aktionsprüfung gefunden: `app/api/approvals/center` und
 * `app/api/workshop/execute`. Die Middleware verlangte zwar eine Session, die
 * Route selbst prüfte aber nichts. Dieser Test hält den reparierten Zustand
 * fest — ohne Abschwächung: ohne Session 401, Agenten-Token ohne
 * `workshop:step` 403, unbekannte Aktion 400.
 */
describe("Nachgezogene Aktionsprüfungen (verschachtelte Routen)", () => {
  it("verweigert Freigabe-Center und Werkstatt-Ausführung ohne Session (401)", async () => {
    const approvals = await import("../../app/api/approvals/center/route");
    const workshop = await import("../../app/api/workshop/execute/route");
    expect((await approvals.GET(request("/api/approvals/center"))).status).toBe(401);
    expect((await workshop.GET(request("/api/workshop/execute"))).status).toBe(401);
    expect(
      (await workshop.POST(jsonRequest("/api/workshop/execute", {workshopId: "WR-1", action: "TEST"}))).status
    ).toBe(401);
    expect(audit.verifyAuditChain().valid).toBe(true);
  });

  it("erlaubt Lesen mit Creator-Session und weist fehlerhafte Nutzdaten ab (400)", async () => {
    const approvals = await import("../../app/api/approvals/center/route");
    const workshop = await import("../../app/api/workshop/execute/route");
    const cookie = {cookie: sessionCookie};
    expect((await approvals.GET(request("/api/approvals/center", {headers: cookie}))).status).toBe(200);
    expect((await workshop.GET(request("/api/workshop/execute", {headers: cookie}))).status).toBe(200);

    // Unbekannte Werkstatt-Aktion: abgelehnt, kein stiller Erfolg.
    const unknownAction = await workshop.POST(jsonRequest("/api/workshop/execute", {workshopId: "WR-1", action: "ALLES"}, cookie));
    expect(unknownAction.status).toBe(400);
    expect((await unknownAction.json()).error).toBe("unsupported action");

    // Unlesbare Nutzdaten (kein JSON): 400 statt 500.
    const broken = await workshop.POST(request("/api/workshop/execute", {method: "POST", headers: {...cookie, "content-type": "application/json"}, body: "{kaputt"}));
    expect(broken.status).toBe(400);

    // Gültige Aktion auf ein nicht existierendes Objekt: 400 mit Grund.
    const missingItem = await workshop.POST(jsonRequest("/api/workshop/execute", {workshopId: "WS-GIBT-ES-NICHT", action: "TEST"}, cookie));
    expect(missingItem.status).toBe(400);
    expect((await missingItem.json()).error).toBe("workshop item not found");

    // Freigabe-Center: unbekannte Aktion ebenfalls 400.
    const unknownApproval = await approvals.POST(jsonRequest("/api/approvals/center", {action: "loeschen"}, cookie));
    expect(unknownApproval.status).toBe(400);
  });

  it("verweigert den Werkstattschritt mit Agenten-Token ohne workshop:step (403)", async () => {
    const workshop = await import("../../app/api/workshop/execute/route");
    const issued = authority.issueCapabilityToken({
      subject: AGENT,
      taskId,
      sandboxId,
      capabilities: ["workshop:read"],
      risk: "LOW",
      issuedBy: "CREATOR",
      issuedByKind: "CREATOR",
      environment: "development",
      expiresAt: new Date(Date.now() + 5 * 60_000).toISOString()
    });
    const agentHeader = {"authorization": `Bobcap ${issued.token.id}.${issued.secret}`};
    expect((await workshop.GET(request("/api/workshop/execute", {headers: agentHeader}))).status).toBe(200);
    const denied = await workshop.POST(jsonRequest("/api/workshop/execute", {workshopId: "WR-1", action: "TEST"}, agentHeader));
    expect(denied.status).toBe(403);
    expect((await denied.json()).error).toBe("CAPABILITY_DENIED");
    expect(audit.verifyAuditChain().valid).toBe(true);
  });
});

/**
 * Deployment (Abschnitt 24): Ausrollen ist eine Creator-Aktion.
 *
 * Ein Agent darf sich niemals selbst ausrollen — weder direkt noch über einen
 * Capability-Token. Geprüft wird zusätzlich, dass die Route auch mit gültiger
 * Session die Gates prüft (kein direkter Pfad am Promotion-Gate vorbei) und
 * unbekannte Aktionen abweist.
 */
describe("Deployment-Route (Creator-Aktion)", () => {
  it("verweigert ohne Session (401) und vor dem Bootstrap fail closed", async () => {
    const deployments = await import("../../app/api/deployment/route");
    expect((await deployments.GET(request("/api/deployment"))).status).toBe(401);
    const deploy = await deployments.POST(jsonRequest("/api/deployment", {action: "deploy", releaseId: "REL-20260101000000-abcd"}));
    expect(deploy.status).toBe(401);
  });

  it("verweigert einem Agenten-Token den Rollout (403 CREATOR_ONLY)", async () => {
    const deployments = await import("../../app/api/deployment/route");
    const issued = authority.issueCapabilityToken({
      subject: AGENT,
      taskId,
      sandboxId,
      capabilities: ["deployment:execute", "deployment:read", "task:execute"],
      risk: "LOW",
      issuedBy: "CREATOR",
      issuedByKind: "CREATOR",
      environment: "development",
      expiresAt: new Date(Date.now() + 5 * 60_000).toISOString()
    });
    const agentHeader = {"authorization": `Bobcap ${issued.token.id}.${issued.secret}`};
    const denied = await deployments.POST(jsonRequest("/api/deployment", {action: "deploy", releaseId: "REL-20260101000000-abcd"}, agentHeader));
    expect(denied.status).toBe(403);
    const body = (await denied.json()) as {error: string};
    expect(["CREATOR_ONLY", "AGENT_FORBIDDEN", "CAPABILITY_DENIED"]).toContain(body.error);
    expect(audit.verifyAuditChain().valid).toBe(true);
  });

  it("weist destruktive Aktionen ohne Attribute ab (kein stiller Erfolg)", async () => {
    // Gefunden vom Betriebsaudit `scripts/audit-actions.mjs`: „prune" räumte mit
    // Vorgabewert Slots weg und „allocate-best" reservierte ein Gerät für die
    // Task „undefined" — beides sah für den Aufrufer wie ein echter Erfolg aus.
    const deployments = await import("../../app/api/deployment/route");
    const devices = await import("../../app/api/devices/route");
    const cookie = {cookie: sessionCookie};

    const prune = await deployments.POST(jsonRequest("/api/deployment", {action: "prune"}, cookie));
    expect(prune.status).toBe(400);
    expect(((await prune.json()) as {error: string}).error).toBe("keep required");

    const allocate = await devices.POST(
      new Request(`${BASE}/api/devices`, {method: "POST", headers: {"content-type": "application/json", host: "localhost:3000", ...cookie}, body: JSON.stringify({action: "allocate-best"})})
    );
    expect(allocate.status).toBe(400);
    expect(((await allocate.json()) as {error: string}).error).toBe("taskId required");
    expect(audit.verifyAuditChain().valid).toBe(true);
  });

  it("prüft mit Creator-Session die Gates und weist unbekannte Aktionen ab", async () => {
    const deployments = await import("../../app/api/deployment/route");
    const cookie = {cookie: sessionCookie};
    // Unbekannte Aktion: 400, kein stiller Erfolg.
    const unknown = await deployments.POST(jsonRequest("/api/deployment", {action: "gibtsnicht"}, cookie));
    expect(unknown.status).toBe(400);
    // Unbekanntes Release: 400 mit Grund, kein Rollout.
    const missing = await deployments.POST(jsonRequest("/api/deployment", {action: "plan", releaseId: "REL-20260101000000-abcd"}, cookie));
    expect(missing.status).toBe(200);
    const plan = (await missing.json()) as {allowed: boolean; reasons: string[]};
    expect(plan.allowed).toBe(false);
    expect(plan.reasons.join(" ")).toMatch(/not found|pipeline required/);
    // Unbekannte Vorgänge sind 404 (nicht 409): „gibt es nicht" und
    // „wurde verweigert" dürfen nicht dieselbe Antwort bekommen.
    expect((await deployments.POST(jsonRequest("/api/deployment", {action: "rollback", deploymentId: "DEP-GIBTS-NICHT", reason: "Test"}, cookie))).status).toBe(404);
    expect((await deployments.POST(jsonRequest("/api/deployment", {action: "verify", deploymentId: "DEP-GIBTS-NICHT"}, cookie))).status).toBe(404);

    // Betriebsbild ist lesbar, verrät aber keine Geheimnisse.
    const snapshot = await deployments.GET(request("/api/deployment", {headers: cookie}));
    expect(snapshot.status).toBe(200);
    const text = await snapshot.text();
    expect(text).not.toMatch(/secret|token|password/i);
  });
});
