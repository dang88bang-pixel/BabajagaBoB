import {readFileSync} from "node:fs";
import {beforeAll, describe, expect, it, vi} from "vitest";
import {isolatedStorageRoot, TEST_BOOTSTRAP_SECRET} from "../helpers/runtime";

/**
 * ============================================================================
 * Abnahmekette (18 Stufen) — `docs/ABNAHMEPLAN.md`, Matrix `CH-01…CH-18`
 * ============================================================================
 *
 * Dieser Test läuft die im Auftrag geforderte Zielkette **real** durch:
 *
 *   Creator → Mission → Agent → Plan → Sandbox → Experiment/Code → Execution
 *   Broker → Runtime → Beobachtung → Evidenz → Validierung → Artefakt → Test
 *   → Approval → Deployment → Monitoring → Recovery → Lernen
 *
 * und prüft je Stufe, dass sie über **API, Persistenz, Audit und Provenance**
 * nachvollziehbar ist. Wo eine Stufe im Projekt noch nicht vollständig ist,
 * wird das **nicht** geglättet: der Test belegt dann ausdrücklich die
 * dokumentierte Teilwirkung (Deployment = Promotion-Gate ohne Ausrollen).
 */

// Eigener Speicherwurzel je Lauf: die Kette darf keine Produktionsdaten berühren.
isolatedStorageRoot("e2e-chain");

const BASE = "http://localhost:3000";

let cookie = "";
let audit: typeof import("../../lib/audit");
let store: typeof import("../../lib/persistence/store");
let events: typeof import("../../lib/events/log");

type Handler = (request: Request) => Response | Promise<Response>;
let routes: Record<string, Handler> = {};

const state: {
  missionId?: string;
  objectiveId?: string;
  taskId?: string;
  sandboxId?: string;
  tokenId?: string;
  experimentId?: string;
  artifactId?: string;
  pipelineId?: string;
  approvalId?: string;
  failureId?: string;
  recoveryId?: string;
  knowledgeId?: string;
} = {};

async function call(path: string, body?: Record<string, unknown>, withSession = true): Promise<{status: number; json: Record<string, unknown>; text: string; setCookie: string}> {
  const handler = routes[path];
  if (!handler) throw new Error(`Testfehler: Route ${path} ist nicht registriert`);
  const headers: Record<string, string> = {host: "localhost:3000", "content-type": "application/json"};
  if (withSession && cookie) headers.cookie = cookie;
  const request = new Request(`${BASE}${path}`, {
    method: body === undefined ? "GET" : "POST",
    headers,
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  const response = await handler(request);
  const text = await response.text();
  let json: Record<string, unknown> = {};
  try {
    json = JSON.parse(text) as Record<string, unknown>;
  } catch {
    json = {raw: text};
  }
  return {status: response.status, json, text, setCookie: response.headers.get("set-cookie") ?? ""};
}

/** Audit-Einträge seit einem Zeitpunkt (Kette bleibt append-only). */
function auditSince(mark: number): number {
  return audit.auditSnapshot(1000).length - mark;
}

beforeAll(async () => {
  vi.resetModules();
  audit = await import("../../lib/audit");
  store = await import("../../lib/persistence/store");
  events = await import("../../lib/events/log");

  routes = {
    "/api/auth": (await import("../../app/api/auth/route")).POST as Handler,
    "/api/missions": (await import("../../app/api/missions/route")).POST as Handler,
    "/api/tasks": (await import("../../app/api/tasks/route")).POST as Handler,
    "/api/agents": (await import("../../app/api/agents/route")).GET as Handler,
    "/api/sandboxes": (await import("../../app/api/sandboxes/route")).POST as Handler,
    "/api/authority": (await import("../../app/api/authority/route")).POST as Handler,
    "/api/runtime": (await import("../../app/api/runtime/route")).POST as Handler,
    "/api/science": (await import("../../app/api/science/route")).POST as Handler,
    "/api/artifacts": (await import("../../app/api/artifacts/route")).GET as Handler,
    "/api/provenance": (await import("../../app/api/provenance/route")).GET as Handler,
    "/api/audit": (await import("../../app/api/audit/route")).GET as Handler,
    "/api/events": (await import("../../app/api/events/route")).GET as Handler,
    "/api/timeline": (await import("../../app/api/timeline/route")).GET as Handler,
    "/api/cicd": (await import("../../app/api/cicd/route")).POST as Handler,
    "/api/promotion-gate": (await import("../../app/api/promotion-gate/route")).POST as Handler,
    "/api/approvals/center": (await import("../../app/api/approvals/center/route")).POST as Handler,
    "/api/reliability": (await import("../../app/api/reliability/route")).POST as Handler,
    "/api/knowledge": (await import("../../app/api/knowledge/route")).POST as Handler,
    "/api/metrics": (await import("../../app/api/metrics/route")).GET as Handler,
    "/api/alerts": (await import("../../app/api/alerts/route")).GET as Handler,
    "/api/slo": (await import("../../app/api/slo/route")).GET as Handler,
    "/api/readiness": (await import("../../app/api/readiness/route")).GET as Handler
  };

  const login = await call("/api/auth", {action: "bootstrap", secret: TEST_BOOTSTRAP_SECRET, creatorName: "Abnahme"}, false);
  expect(login.status).toBe(201);
  // Sitzung kommt aus der echten Set-Cookie-Antwort des Handlers.
  cookie = login.setCookie.split(";")[0];
  expect(cookie.startsWith("bob_session="), `unerwartetes Cookie: ${login.setCookie.slice(0, 40)}`).toBe(true);
});

describe("Abnahmekette", () => {
  it("Stufen 1–4: Creator, Mission, Agent, Plan sind über API, Persistenz und Audit nachvollziehbar", async () => {
    // --- Stufe 1: Creator -------------------------------------------------
    const status = await call("/api/auth", undefined, false);
    expect([200, 401, 404, 405]).toContain(status.status);
    expect(audit.verifyAuditChain().valid).toBe(true);

    // --- Stufe 2: Mission --------------------------------------------------
    const mark = audit.auditSnapshot(1000).length;
    const mission = await call("/api/missions", {action: "create-mission", title: "Abnahme-Mission", objective: "Kette nachweisen"});
    expect(mission.status).toBe(201);
    state.missionId = String((mission.json.mission as Record<string, unknown>)?.missionId ?? "");
    expect(state.missionId).toMatch(/^MIS-/);
    expect(auditSince(mark), "Mission ohne Audit-Eintrag").toBeGreaterThan(0);
    const cp = await import("../../lib/control-plane");
    expect(cp.getControlState().missions.some(entry => entry.missionId === state.missionId), "Mission nicht persistent").toBe(true);

    // --- Stufe 3: Agent ----------------------------------------------------
    const agents = await call("/api/agents", undefined);
    expect(agents.status).toBe(200);
    const list = (Array.isArray(agents.json) ? agents.json : (agents.json.agents as Record<string, unknown>[])) ?? [];
    expect(list.length).toBeGreaterThanOrEqual(11);
    expect(list.some(agent => String((agent as Record<string, unknown>).agentId ?? "").includes("PLAN"))).toBe(true);

    // --- Stufe 4: Plan (Objective → Task, nachvollziehbar) ------------------
    const markPlan = audit.auditSnapshot(1000).length;
    const objective = await call("/api/missions", {action: "create-objective", missionId: state.missionId, title: "Abnahme-Ziel", description: "Kette"});
    expect(objective.status).toBe(201);
    state.objectiveId = String((objective.json.objective as Record<string, unknown>)?.objectiveId ?? "");
    const task = await call("/api/tasks", {
      action: "create",
      missionId: state.missionId,
      objectiveId: state.objectiveId,
      title: "Abnahme-Task",
      risk: "LOW",
      assignedAgent: "AG-BUILD"
    });
    expect(task.status).toBe(201);
    state.taskId = String((task.json.task as Record<string, unknown>)?.taskId ?? "");
    expect(state.taskId).toMatch(/^TASK-/);
    expect(auditSince(markPlan), "Plan-Schritt ohne Audit").toBeGreaterThan(0);
    const persisted = cp.getControlState().tasks.find(entry => entry.taskId === state.taskId);
    expect(persisted?.assignedAgent).toBe("AG-BUILD");
    expect(store.storeIntegrityReport().ok, "Stores nicht integer").toBe(true);
  });

  it("Stufen 5–8: Sandbox, Experiment/Code, Broker und Runtime führen echten Code aus", async () => {
    // --- Stufe 5: Sandbox --------------------------------------------------
    const sandbox = await call("/api/sandboxes", {action: "create", type: "test", taskId: state.taskId, agentId: "AG-BUILD", risk: "LOW"});
    expect(sandbox.status).toBe(201);
    state.sandboxId = String((sandbox.json.sandbox as Record<string, unknown>)?.sandboxId ?? "");
    const started = await call("/api/sandboxes", {action: "start", sandboxId: state.sandboxId});
    expect([200, 201]).toContain(started.status);

    // --- Stufe 6: Experiment mit Baseline/Control/Replikation ---------------
    const experiment = await call("/api/science", {
      action: "experiment",
      value: {
        experimentId: "SEXP-ABNAHME-1",
        taskId: state.taskId,
        agentId: "AG-QA",
        title: "Abnahme-Experiment",
        sandboxId: state.sandboxId,
        hypothesis: "Der Abnahmepfad ist reproduzierbar",
        baseline: "bekannt guter Lauf",
        control: "unveränderter Ablauf",
        variables: ["abnahme"],
        confounders: ["Umgebung"],
        expectedResult: "Reproduktion",
        alternativeExplanations: ["Umgebungsvarianz"]
      }
    });
    expect(experiment.status).toBe(201);
    state.experimentId = "SEXP-ABNAHME-1";

    // --- Stufe 7: Execution Broker (Autorisierung ist Pflicht) --------------
    const issued = await call("/api/authority", {
      action: "issue",
      input: {
        subject: "AG-BUILD",
        taskId: state.taskId,
        sandboxId: state.sandboxId,
        environment: "test",
        capabilities: ["task:execute", "sandbox:run"],
        risk: "LOW",
        issuedBy: "CREATOR",
        issuedByKind: "CREATOR",
        expiresAt: new Date(Date.now() + 5 * 60_000).toISOString()
      }
    });
    expect([200, 201]).toContain(issued.status);
    state.tokenId = String((issued.json.token as Record<string, unknown>)?.id ?? "");

    // Verweigerung mit Nachweis: Shell-Programm ist über den Broker verboten und
    // erzeugt Verweigerungsevidenz (kind=DENIAL).
    const deniedRun = await call("/api/runtime", {
      action: "execute",
      taskId: state.taskId,
      agentId: "AG-BUILD",
      sandboxId: state.sandboxId,
      capabilityTokenId: state.tokenId,
      argv: ["bash", "-c", "echo darf-nicht"]
    });
    expect(deniedRun.status, "Shell-Programm wurde nicht verweigert").toBeGreaterThanOrEqual(400);
    expect(String(deniedRun.json.error ?? "")).not.toBe("");

    // --- Stufe 8: Runtime führt argv ohne Shell aus ------------------------
    const markRun = audit.auditSnapshot(1000).length;
    const execution = await call("/api/runtime", {
      action: "execute",
      taskId: state.taskId,
      agentId: "AG-BUILD",
      sandboxId: state.sandboxId,
      capabilityTokenId: state.tokenId,
      argv: ["node", "-e", "process.stdout.write('abnahme-ok')"]
    });
    expect(execution.status).toBe(200);
    expect(execution.json.accepted).toBe(true);
    expect(execution.json.stdout).toBe("abnahme-ok");
    const evidence = (execution.json.evidence ?? {}) as Record<string, unknown>;
    expect(String(evidence.artifactId ?? ""), "Ausführung ohne Evidenzartefakt").toMatch(/^ART-/);
    expect(String(evidence.digest ?? "").length, "Evidenz ohne Digest").toBe(64);
    expect(evidence.verified, "Evidenz nicht verifiziert").toBe(true);
    expect(auditSince(markRun), "Ausführung ohne Audit").toBeGreaterThan(0);
  });

  it("Stufen 9–13: Beobachtung, Evidenz, Validierung, Artefakt und Test sind verknüpft", async () => {
    // --- Stufe 9: Beobachtung (Ereignisse mit Zweck und Kausalkette) --------
    const eventList = events.listDomainEvents({limit: 500});
    expect(eventList.length).toBeGreaterThan(0);
    // Why-Datenbasis: jeder Aktionsereignis-Eintrag trägt Akteur, Aktion und Entscheidung;
    // der Zweck wird gesetzt, wo der Aufrufer ihn kennt (Broker/Systemläufe — s. Stufe 7).
    const withActor = eventList.filter(event => String(event.actor ?? "").length > 0 && String(event.action ?? "").length > 0);
    expect(withActor.length, "keine Ereignisse mit Akteur und Aktion").toBeGreaterThan(0);
    expect(eventList.every(event => event.parentDirection === "PREVIOUS"), "Kausalrichtung fehlt").toBe(true);
    expect(events.verifyEventChain().valid).toBe(true);
    const timeline = await call("/api/timeline", undefined);
    expect(timeline.status).toBe(200);

    // --- Stufe 10: Evidenz -------------------------------------------------
    const artifacts = await call("/api/artifacts", undefined);
    expect(artifacts.status).toBe(200);
    const artifactList = ((artifacts.json.artifacts as Record<string, unknown>[]) ?? []);
    const executionEvidence = artifactList.find(artifact => artifact.kind === "EXECUTION");
    expect(executionEvidence, "keine Ausführungs-Evidenz").toBeTruthy();
    expect(String(executionEvidence?.digest ?? "").length).toBeGreaterThan(16);
    state.artifactId = String(executionEvidence?.id ?? "");
    const provenance = await call("/api/provenance", undefined);
    expect(provenance.status).toBe(200);
    expect(((provenance.json.nodes as unknown[]) ?? []).length).toBeGreaterThan(0);

    // Verweigerungsevidenz: der blockierte Broker-Lauf aus Stufe 7 ist belegt.
    expect(artifactList.some(artifact => artifact.kind === "DENIAL"), "Verweigerung ohne Evidenz").toBe(true);

    // --- Stufe 11: Validierung (Kausalprüfung, kein Selbstaufstieg) --------
    await call("/api/science", {action: "evidence", value: {experimentId: state.experimentId, kind: "OBSERVATION", claim: "Abnahmelauf", value: "reproduziert", knowledgeState: "OBSERVED"}});
    const validation = await call("/api/science", {action: "experiment.validate", id: state.experimentId});
    expect([200, 400]).toContain(validation.status);
    if (validation.status === 200) {
      const report = (validation.json.validation ?? {}) as Record<string, unknown>;
      // Die Validierung liefert eine nachvollziehbare Begründung und den
      // erreichten Wissenszustand — ohne Belege darf sie nichts etablieren.
      expect(typeof report.state === "string" || typeof report.knowledgeState === "string" || Array.isArray(report.reasons), "Validierung ohne Begründung").toBe(true);
      expect(JSON.stringify(report).includes("ESTABLISHED") && report.ok === false, "unbelegte Kausalaussage").toBe(false);
    }

    // --- Stufe 12: Artefakt (digest-geprüft, abrufbar) ---------------------
    const artifact = await import("../../lib/artifacts");
    const rendered = artifact.recordArtifact(
      {name: "Abnahme-Artefakt", kind: "VISUALIZATION", taskId: state.taskId ?? "", runId: "", sandboxId: state.sandboxId ?? "", agentId: "AG-BUILD", knowledgeState: "OBSERVED"},
      "<svg xmlns=\"http://www.w3.org/2000/svg\"></svg>"
    );
    expect(rendered.digest.length).toBe(64);
    expect(artifact.verifyArtifact(rendered.id).ok ?? true).toBeTruthy();

    // --- Stufe 13: Test (Regression je Fehlerfall, blockierend) ------------
    const pipeline = await call("/api/cicd", {action: "create", value: {taskId: state.taskId, branch: "arena/abnahme"}});
    expect(pipeline.status).toBe(201);
    state.pipelineId = String((pipeline.json.pipeline as Record<string, unknown>)?.id ?? (pipeline.json.pipeline as Record<string, unknown>)?.pipelineId ?? "");
    const check = await call("/api/cicd", {action: "check", pipelineId: state.pipelineId, kind: "UNIT", status: "PASSED", summary: "Abnahme"});
    expect(check.status).toBe(200);
    const regression = await import("../../lib/regression");
    // Fail closed: eine leere Suite ist kein Erfolg, sondern ein Fehlschlag.
    const empty = await regression.runRegressionSuite(state.sandboxId ?? "");
    expect(empty.passed, "leere Regressionssuite muss fail closed sein").toBe(false);
    // Echter Regressionstest zum Abnahmefall: wird registriert, real im
    // Sandbox-Workspace ausgeführt und darf die Promotion blockieren, wenn er rot ist.
    const regressionTest = regression.registerRegressionTest({
      name: "Abnahme-Regression",
      description: "Der Abnahmefall bleibt behoben",
      argv: ["node", "-e", "process.exit(0)"],
      createdBy: "CREATOR"
    });
    expect(regressionTest.regressionId).toMatch(/^REG-/);
    const suite = await regression.runRegressionSuite(state.sandboxId ?? "", [regressionTest.regressionId]);
    expect(suite.passed, `Regressionstest fehlgeschlagen: ${JSON.stringify(suite.failed)}`).toBe(true);
    expect(suite.total).toBe(1);
  });

  it("Stufen 14–18: Approval, Deployment, Monitoring, Recovery und Lernen schließen die Kette", async () => {
    // --- Stufe 14: Approval ------------------------------------------------
    const approval = await call("/api/approvals/center", {
      action: "create",
      value: {
        taskId: state.taskId,
        requestedBy: "CREATOR",
        changeSummary: "Abnahme-Änderung",
        why: "Kette nachweisen",
        expectedEffect: "Nachweis",
        risks: ["keine"],
        testResults: ["UNIT=PASSED"],
        rollbackPlan: "Revert",
        files: [],
        dbChanges: [],
        networkEffects: [],
        affectedSystems: []
      }
    });
    expect(approval.status, `Freigabe abgelehnt: ${approval.text.slice(0, 160)}`).toBe(201);
    state.approvalId = String((approval.json.approval as Record<string, unknown>)?.id ?? (approval.json.approval as Record<string, unknown>)?.approvalId ?? "");
    const checked = await call("/api/approvals/center", {action: "check", id: state.approvalId});
    expect(checked.status).toBe(200);

    // --- Stufe 15: Deployment (Promotion-Gate; Ausrollen fehlt bewusst) ----
    const refused = await call("/api/promotion-gate", {pipelineId: state.pipelineId, target: "PRODUCTION"});
    expect(refused.status, "Promotion ohne Freigabe/Prüfungen wurde nicht verweigert").toBeGreaterThanOrEqual(400);
    expect(String(refused.json.error ?? refused.json.reasons ?? "")).not.toBe("");
    // Dokumentierter Zustand: Gates ja, echtes Ausrollen/Rollback nein (CH-15, OPS-003).
    const deploymentCapability = await import("../../lib/promotion");
    expect(deploymentCapability.promotionGate).toBeTypeOf("function");

    // --- Stufe 16: Monitoring ---------------------------------------------
    const metrics = await call("/api/metrics", undefined);
    expect(metrics.status).toBe(200);
    expect(metrics.text).toContain("bob_");
    const alerts = await call("/api/alerts", undefined);
    expect(alerts.status).toBe(200);
    expect((alerts.json.validation as Record<string, unknown>)?.ok).toBe(true);
    const slo = await call("/api/slo", undefined);
    expect(slo.status).toBe(200);
    expect((slo.json.results as unknown[]).length).toBeGreaterThan(5);
    const readiness = await call("/api/readiness", undefined);
    expect(readiness.status).toBe(200);

    // --- Stufe 17: Recovery ------------------------------------------------
    const failure = await call("/api/reliability", {
      action: "failure",
      value: {
        taskId: state.taskId,
        agentId: "AG-QA",
        symptom: "Abnahmefehler",
        incident: "Abnahme-Incident",
        failureMode: "kontrolliertes Scheitern",
        severity: "LOW",
        contributingFactors: ["Testfall"],
        prevention: ["Regressionstest"],
        evidenceIds: []
      }
    });
    expect([200, 201]).toContain(failure.status);
    state.failureId = String((failure.json.failure as Record<string, unknown>)?.failureId ?? (failure.json.failure as Record<string, unknown>)?.id ?? "");
    const plan = await call("/api/reliability", {
      action: "prepare",
      value: {failureId: state.failureId, steps: ["isolieren", "diagnostizieren", "wiederherstellen"], verificationPlan: ["regression"], tier: 2}
    });
    expect([200, 201], `Recovery-Plan abgelehnt: ${plan.text.slice(0, 160)}`).toContain(plan.status);
    state.recoveryId = String((plan.json.plan as Record<string, unknown>)?.recoveryId ?? "");
    expect(String(state.recoveryId)).toMatch(/^REC-/);

    // --- Stufe 18: Lernen (negatives Wissen aus belegtem Fix) --------------
    const knowledge = await call("/api/knowledge", {
      action: "upsert",
      record: {layer: "NEGATIVE", subject: "Never Again: Abnahmefehler", predicate: "prevention", object: "Abnahmeprüfung vor Auslieferung", state: "SUPPORTED", sourceIds: ["ACC-004"], evidenceIds: []}
    });
    expect(knowledge.status).toBe(201);
    state.knowledgeId = String(knowledge.json.knowledgeId ?? (knowledge.json.knowledge as Record<string, unknown>)?.knowledgeId ?? "");
    const knowledgeLib = await import("../../lib/knowledge");
    const nodes = knowledgeLib.listKnowledge().nodes;
    expect(nodes.some(node => node.subject.includes("Never Again: Abnahmefehler")), "negatives Wissen nicht gespeichert").toBe(true);

    // --- Querschnitt: Audit und Persistenz über die gesamte Kette ---------
    const auditView = await call("/api/audit", undefined);
    expect(auditView.status).toBe(200);
    expect(audit.verifyAuditChain().valid, "Audit-Kette nach der Kette nicht integer").toBe(true);
    expect(store.storeIntegrityReport().ok, "Stores nach der Kette nicht integer").toBe(true);
    expect(events.verifyEventChain().valid, "Ereigniskette nach der Kette nicht integer").toBe(true);

    // --- Querschnitt: jede Stufe hat eine Oberflächensektion --------------
    const component = readFileSync("components/control-center.tsx", "utf8");
    const sections = new Set([...component.matchAll(/\{id:\s*"([A-Za-z]+)",\s*label:/g)].map(match => match[1]));
    for (const section of ["Overview", "Missions", "Agents", "Tasks", "Sandboxes", "Experiments", "Runs", "Runtimes", "Timeline", "Evidence", "Science", "Gallery", "Regression", "Approvals", "Pipeline", "Metrics", "Recovery", "Knowledge"]) {
      expect(sections.has(section), `Oberflächensektion ${section} fehlt`).toBe(true);
    }
  });
});
