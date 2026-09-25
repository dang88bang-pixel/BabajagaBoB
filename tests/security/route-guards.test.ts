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
