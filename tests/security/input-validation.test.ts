import {beforeAll, describe, expect, it, vi} from "vitest";
import {isolatedStorageRoot, TEST_BOOTSTRAP_SECRET} from "../helpers/runtime";

/**
 * Unvollständige Nutzdatensätze dürfen keinen Zustand erzeugen (Abschnitt 6/20).
 *
 * Gefunden beim vollständigen Anwendungsdurchlauf: sieben create/register-Aktionen
 * nahmen ein leeres bzw. unvollständiges Nutzdatum an und **persistierten einen
 * inhaltslosen Datensatz** — 201 trotz fehlender Pflichtfelder. Folgen:
 *
 *  - Scheinzustand: das Control Center zeigte Einträge ohne Name, Art oder Ziel.
 *  - Blockade: ein Skill ohne `id` (`undefined`) belegte den Dedupe-Schlüssel und
 *    ließ **jede** spätere legitime Registrierung mit „skill already exists"
 *    scheitern.
 *  - Fehlerkette: ein Incident ohne Symptom/Schwere ist nicht untersuchbar.
 *
 * Die Suite hält für jede Aktion fest: unvollständige Eingabe → **400** und
 * **kein** neuer Datensatz. Geprüft wird über die echten Route-Handler.
 */

isolatedStorageRoot("input-validation");

let skills: typeof import("../../lib/skills");
let workshop: typeof import("../../lib/workshop");
let simulation: typeof import("../../lib/simulation");
let apps: typeof import("../../lib/apps");
let cicd: typeof import("../../lib/cicd");
let errorIntelligence: typeof import("../../lib/error-intelligence");
let reliability: typeof import("../../lib/reliability");
let computerUse: typeof import("../../lib/computer-use");
let devices: typeof import("../../lib/devices");
let runtimeRegistry: typeof import("../../lib/runtime-registry");
let toolRegistry: typeof import("../../lib/tool-registry");
let science: typeof import("../../lib/science");
let secrets: typeof import("../../lib/secrets");

type Handler = (request: Request) => Promise<Response>;

let cookie = "";

/** Statische Route-Handler (kein dynamischer Import: Vite kann ihn nicht auflösen). */
const ROUTES: Record<string, () => Promise<{POST: Handler}>> = {
  skills: () => import("../../app/api/skills/route"),
  workshop: () => import("../../app/api/workshop/route"),
  simulation: () => import("../../app/api/simulation/route"),
  apps: () => import("../../app/api/apps/route"),
  cicd: () => import("../../app/api/cicd/route"),
  errors: () => import("../../app/api/errors/route"),
  reliability: () => import("../../app/api/reliability/route"),
  "computer-use": () => import("../../app/api/computer-use/route"),
  devices: () => import("../../app/api/devices/route"),
  runtimes: () => import("../../app/api/runtimes/route"),
  tools: () => import("../../app/api/tools/route"),
  science: () => import("../../app/api/science/route"),
  secrets: () => import("../../app/api/secrets/route"),
  runs: () => import("../../app/api/runs/route"),
  "execution-gate": () => import("../../app/api/execution-gate/route"),
  missions: () => import("../../app/api/missions/route"),
  capabilities: () => import("../../app/api/capabilities/route")
};

async function post(route: string, body: unknown): Promise<{status: number; json: Record<string, unknown>}> {
  const loader = ROUTES[route];
  if (!loader) throw new Error(`route not mapped: ${route}`);
  const module = await loader();
  const response = await module.POST(
    new Request(`http://localhost:3000/api/${route}`, {
      method: "POST",
      headers: {"content-type": "application/json", cookie},
      body: JSON.stringify(body)
    })
  );
  const json = (await response.json().catch(() => ({}))) as Record<string, unknown>;
  return {status: response.status, json};
}

beforeAll(async () => {
  vi.resetModules();
  skills = await import("../../lib/skills");
  workshop = await import("../../lib/workshop");
  simulation = await import("../../lib/simulation");
  apps = await import("../../lib/apps");
  cicd = await import("../../lib/cicd");
  errorIntelligence = await import("../../lib/error-intelligence");
  reliability = await import("../../lib/reliability");
  computerUse = await import("../../lib/computer-use");
  devices = await import("../../lib/devices");
  runtimeRegistry = await import("../../lib/runtime-registry");
  toolRegistry = await import("../../lib/tool-registry");
  science = await import("../../lib/science");
  secrets = await import("../../lib/secrets");
  const authRoute = (await import("../../app/api/auth/route")) as {POST: Handler};
  const response = await authRoute.POST(
    new Request("http://localhost:3000/api/auth", {
      method: "POST",
      headers: {"content-type": "application/json"},
      body: JSON.stringify({action: "bootstrap", secret: TEST_BOOTSTRAP_SECRET, creatorName: "Validierung"})
    })
  );
  expect(response.status).toBe(201);
  // Creator-Session aus dem Bootstrap: die Routen-Guards verlangen sie, damit der
  // Test wirklich die Validierung prüft und nicht am Guard scheitert (401).
  cookie = (response.headers.get("set-cookie") ?? "").split(";")[0];
  expect(cookie).toContain("bob_session");
});

describe("Unvollständige Nutzdaten werden abgelehnt (kein Scheinzustand)", () => {
  it("Skills: Registrierung ohne Identität oder Namen wird abgelehnt", () => {
    expect(() => skills.registerSkill(undefined as never)).toThrow(/skill/i);
    expect(() => skills.registerSkill({} as never)).toThrow(/skill id required/);
    expect(() => skills.registerSkill({id: "SK-1", name: "  "} as never)).toThrow(/skill name required/);
    expect(() => skills.registerSkill({id: "SK-1", name: "N", version: ""} as never)).toThrow(/skill version required/);
    expect(skills.listSkills()).toHaveLength(0);
    // Und die legitime Registrierung bleibt danach möglich (keine Blockade).
    const ok = skills.registerSkill({id: "SK-1", name: "Skill", version: "1.0", tools: [], lifecycle: "REGISTERED", provenance: "test", validation: []});
    expect(ok.id).toBe("SK-1");
    expect(skills.listSkills()).toHaveLength(1);
  });

  it("Werkstatt: Objekt ohne Art/Name/Beschreibung/Risiko wird abgelehnt", () => {
    expect(() => workshop.createWorkshopItem(undefined as never)).toThrow(/workshop item required/);
    expect(() => workshop.createWorkshopItem({} as never)).toThrow(/kind required/);
    expect(() => workshop.createWorkshopItem({kind: "TOOL"} as never)).toThrow(/name required/);
    expect(() => workshop.createWorkshopItem({kind: "TOOL", name: "T"} as never)).toThrow(/description required/);
    expect(() => workshop.createWorkshopItem({kind: "TOOL", name: "T", description: "D"} as never)).toThrow(/risk required/);
    expect(workshop.listWorkshop()).toHaveLength(0);
  });

  it("Simulation: Szenario ohne Name/Art wird abgelehnt", () => {
    expect(() => simulation.createScenario(undefined as never)).toThrow(/scenario/i);
    expect(() => simulation.createScenario({} as never)).toThrow(/scenario name required/);
    expect(() => simulation.createScenario({name: "S"} as never)).toThrow(/scenario kind required/);
  });

  it("Apps und Pipelines: Pflichtfelder werden erzwungen", () => {
    expect(() => apps.createApp(undefined as never)).toThrow(/app/i);
    expect(() => apps.createApp({name: "", version: "1", description: "d"})).toThrow(/app name required/);
    expect(() => cicd.createPipeline(undefined as never)).toThrow(/pipeline/i);
    expect(() => cicd.createPipeline({} as never)).toThrow(/pipeline taskId required/);
    expect(() => cicd.createPipeline({taskId: "TASK-001"} as never)).toThrow(/pipeline branch required/);
  });

  it("Fehler-Incident und Failure: Symptom/Schwere/Fehlerbild sind Pflicht", () => {
    expect(() => errorIntelligence.createErrorIncident(undefined as never)).toThrow(/incident/i);
    expect(() => errorIntelligence.createErrorIncident({} as never)).toThrow(/symptom required/);
    const incidentsBeforeFailure = errorIntelligence.listErrorIncidents().length;
    expect(() =>
      errorIntelligence.createErrorIncident({
        symptom: "s",
        incident: "i",
        failureMode: "f",
        severity: "LAUT",
        contributingFactors: [],
        prevention: [],
        evidenceIds: []
      } as never)
    ).toThrow(/invalid severity/);
    // Durch den abgelehnten Datensatz entsteht kein weiterer Incident.
    expect(errorIntelligence.listErrorIncidents()).toHaveLength(incidentsBeforeFailure);

    expect(() => reliability.recordFailure(undefined as never)).toThrow(/failure/i);
    expect(() => reliability.recordFailure({} as never)).toThrow(/symptom required/);
  });

  it("Computer Use: Registrierung ohne Name/Art wird abgelehnt", () => {
    const before = computerUse.listComputers().length;
    expect(() => computerUse.registerComputer(undefined as never)).toThrow(/computer/i);
    expect(() => computerUse.registerComputer({} as never)).toThrow(/computer name required/);
    expect(() => computerUse.registerComputer({name: "X"} as never)).toThrow(/computer kind required/);
    expect(computerUse.listComputers()).toHaveLength(before);
  });

  it("Geräte-Discovery: ein Gerät ohne Identität wird nicht persistiert (kein Phantom)", () => {
    const before = devices.listDevices().length;
    expect(() => devices.discoverDevice(undefined as never)).toThrow(/device required/);
    expect(() => devices.discoverDevice({} as never)).toThrow(/device id required/);
    expect(() => devices.discoverDevice({id: "DEV-1"} as never)).toThrow(/device name required/);
    expect(() => devices.discoverDevice({id: "DEV-1", name: "Gerät"} as never)).toThrow(/device os required/);
    // Ein Gerät ohne `id` wäre nie autorisierbar/zuteilbar — es darf nicht entstehen.
    expect(devices.listDevices()).toHaveLength(before);
    const ok = devices.discoverDevice({id: "DEV-AUDIT", name: "Audit-Gerät", os: "linux", arch: "x64", cpu: 2, ramMb: 2048, network: "NONE", trust: "EPHEMERAL", capabilities: [], lastSeen: new Date().toISOString()});
    expect(ok.id).toBe("DEV-AUDIT");
    expect(ok.authorized).toBe(false);
  });

  it("Runtime- und Werkzeug-Registry: Definition ohne Pflichtfelder wird abgelehnt", () => {
    const runtimesBefore = runtimeRegistry.listRuntimes().length;
    expect(() => runtimeRegistry.registerRuntime(undefined as never)).toThrow(/runtime definition required/);
    expect(() => runtimeRegistry.registerRuntime({} as never)).toThrow(/runtime id required/);
    // Der frühere Fehler: der ganze Request-Body landete als Laufzeit in der Registry.
    expect(() => runtimeRegistry.registerRuntime({action: "register", input: {id: "rt-x"}} as never)).toThrow(/runtime id required/);
    expect(runtimeRegistry.listRuntimes()).toHaveLength(runtimesBefore);
    const ok = runtimeRegistry.registerRuntime({id: "runtime.audit", name: "Audit", version: "1", kind: "CUSTOM", platforms: ["linux"], architectures: ["x64"], buildCommands: [], testCommands: [], sandboxSupport: true, networkDefault: "DENY"});
    expect(ok.id).toBe("runtime.audit");

    const toolsBefore = toolRegistry.listTools().length;
    expect(() => toolRegistry.registerTool(undefined as never)).toThrow(/tool definition required/);
    expect(() => toolRegistry.registerTool({action: "register"} as never)).toThrow(/tool id required/);
    expect(toolRegistry.listTools()).toHaveLength(toolsBefore);
  });

  it("Ziele und Secret-Leases ohne Pflichtangaben werden abgelehnt", () => {
    expect(() => science.createObjective(undefined as never)).toThrow(/objective required/);
    expect(() => science.createObjective({} as never)).toThrow(/objective missionId required/);
    expect(() => science.createObjective({missionId: "MSN-001"} as never)).toThrow(/objective title required/);

    expect(() => secrets.issueSecretLease(undefined as never, "TASK-001", [])).toThrow(/requires a subject/);
    expect(() => secrets.issueSecretLease("AG-BUILD", "" as never, [])).toThrow(/requires a task/);
    // Eine Lease ohne Subjekt wäre nicht validierbar (validate vergleicht beides).
    expect(() => secrets.issueSecretLease("AG-BUILD", "TASK-001", [], 0)).toThrow(/ttl/);
  });

  it("Worker-Zyklus: Lease, Fehlerkette und Zurückstellung ohne Zyklusabbruch", async () => {
    // Regression zu drei zusammenhängenden Defekten: kein Lease vor dem Start
    // ("invalid run transition QUEUED -> RUNNING"), unvollständige Fehlerkette
    // ("invalid error transition DIAGNOSING -> FIXING") und ein Retry nach der
    // Verifikation ("invalid run transition VERIFYING -> QUEUED").
    const control = await import("../../lib/control-plane");
    const queue = await import("../../lib/queue");
    const runs = await import("../../lib/runs");
    const worker = await import("../../lib/worker");
    const intelligence = await import("../../lib/error-intelligence");

    const mission = control.createMission({title: "Worker-Audit", objective: "Fehlerpfad prüfen", createdBy: "CREATOR"});
    const task = control.createTask({missionId: mission.missionId, title: "Worker-Audit-Task", risk: "LOW", assignedAgent: "AG-BUILD", createdBy: "CREATOR"});
    const run = runs.createRun({taskId: task.taskId, agentId: "AG-BUILD", risk: "LOW", sandboxId: "SB-FEHLT"});
    const job = queue.enqueueJob({taskId: task.taskId, runId: run.runId, agentId: "AG-BUILD", risk: "LOW"});

    const cycle = await worker.runWorkerCycle("worker-audit");
    expect(cycle.jobFailures).toEqual([]);
    expect(cycle.recoveryFailures).toEqual([]);
    expect(cycle.recovered).toContain(run.runId);
    expect(cycle.deferred).toContain(job.jobId);

    const incident = intelligence.listErrorIncidents().at(-1)!;
    expect(incident.status).toBe("FIXING");
    expect(incident.evidenceIds.length).toBeGreaterThan(0);
    expect(incident.experimentId).toMatch(/^EXP-/);
    expect(runs.getRun(run.runId)!.state).toBe("VERIFYING");
    expect(queue.getJob(job.jobId)!.deferredReason).toContain("recovery");
  }, 120_000);

  it("Secrets: Lease-Kennung wird aus Ausgabe und Eingabe akzeptiert, Root Cause braucht Evidenz", async () => {
    const secrets = await import("../../lib/secrets");
    const intelligence = await import("../../lib/error-intelligence");

    // Ausgabe der Route ist `{lease:{id}}`; die Prüfaktion akzeptierte früher
    // nur `leaseId`, sodass die eigene Ausgabe nicht direkt verwendbar war.
    const lease = secrets.issueSecretLease("AG-BUILD", "TASK-SECRETS", ["read"], 60_000);
    const viaLeaseId = await post("secrets", {action: "validate", leaseId: lease.id, subjectId: "AG-BUILD", taskId: "TASK-SECRETS"});
    expect(viaLeaseId.status).toBe(200);
    const viaId = await post("secrets", {action: "validate", id: lease.id, subjectId: "AG-BUILD", taskId: "TASK-SECRETS"});
    expect(viaId.status).toBe(200);
    // Fremdes Subjekt bleibt verweigert.
    const foreign = await post("secrets", {action: "validate", leaseId: lease.id, subjectId: "AG-QA", taskId: "TASK-SECRETS"});
    expect(foreign.status).toBe(400);
    expect(await post("secrets", {action: "revoke", leaseId: lease.id})).toMatchObject({status: 200});
    // Zweiter Widerruf ist kein stiller Erfolg mehr.
    expect((await post("secrets", {action: "revoke", leaseId: lease.id})).status).toBe(400);

    // Root Cause: `evidenceIds` ist optional, Evidenz bleibt Pflicht.
    const incident = intelligence.createErrorIncident({
      severity: "LOW", symptom: "Regression Evidenz", incident: "Evidenzprüfung",
      failureMode: "RUN_EXECUTION_FAILURE", contributingFactors: ["audit"], prevention: [], evidenceIds: [],
      error: "Evidenzprüfung"
    });
    const withoutEvidenceIds = await post("errors", {action: "root_cause", id: incident.incidentId, rootCause: "Ursache ohne Nachweisliste"});
    expect(withoutEvidenceIds.status).toBe(400);
    expect(withoutEvidenceIds.json.error).toMatch(/evidence/i);
  });

  it("Routen liefern echte Daten statt eines serialisierten Promise", async () => {
    // Drei Routen riefen async-Funktionen ohne `await` auf: HTTP 200 mit `{}`,
    // Fehler waren unbeobachtbar (u. a. die gesamte Recovery-Verifikation).
    const apps = await post("apps", {action: "install-module", moduleId: "MOD-gibtsnicht", approvalId: "APR-x"});
    expect(apps.status).toBe(400);
    expect(String(apps.json.error)).toMatch(/module not found/);

    const reliability = await post("reliability", {action: "verify", id: "REC-gibtsnicht"});
    expect(reliability.status).toBe(400);
    expect(String(reliability.json.error)).toMatch(/recovery plan not found/);

    const runs = await post("runs", {action: "recover", runId: "RUN-gibtsnicht"});
    expect(runs.status).toBeGreaterThanOrEqual(400);
    expect(Object.keys(runs.json).length).toBeGreaterThan(0);
  });

  it("Registry- und Geräte-Routen lehnen unvollständige Nutzdaten mit 400 ab", async () => {
    const cases: Array<[string, unknown]> = [
      ["devices", {action: "discover"}],
      ["devices", {action: "discover", device: {}}],
      ["devices", {action: "discover", device: {id: "DEV-ROUTE"}}],
      ["runtimes", {action: "register"}],
      ["runtimes", {action: "register", input: {}}],
      ["runtimes", {}],
      ["tools", {action: "register"}],
      ["tools", {action: "register", tool: {}}],
      ["science", {action: "objective"}],
      ["science", {action: "objective", value: {}}],
      ["science", {action: "experiment"}],
      ["science", {action: "experiment", value: {}}],
      ["execution-gate", {}],
      ["secrets", {action: "issue", taskId: "TASK-001"}]
    ];
    // Bestand vor dem Sweep: der Worker-Test oben erzeugt bereits einen
    // Fehler-Incident, der hier unverändert bleiben muss.
    for (const [route, payload] of cases) {
      const {status} = await post(route, payload);
      expect(status, `${route} ${JSON.stringify(payload)}`).toBe(400);
    }
    expect(devices.listDevices().some(entry => entry.id === undefined || entry.id === "")).toBe(false);
    expect(runtimeRegistry.listRuntimes().some(entry => entry.id === undefined || entry.id === "")).toBe(false);
    expect(toolRegistry.listTools().some(entry => entry.id === undefined || entry.id === "")).toBe(false);
    expect(science.listExperiments().some(entry => !entry.baseline || !entry.control)).toBe(false);
  });

  it("Routen antworten mit 400 statt einen Leer-Datensatz zu erzeugen", async () => {
    const cases: Array<[string, unknown]> = [
      ["skills", {action: "register"}],
      ["skills", {action: "register", skill: {}}],
      ["workshop", {action: "create"}],
      ["workshop", {action: "create", value: {}}],
      ["simulation", {action: "create"}],
      ["simulation", {action: "create", scenario: {}}],
      ["apps", {action: "create", value: {}}],
      ["cicd", {action: "create", value: {}}],
      ["errors", {action: "create", input: {}}],
      ["reliability", {action: "failure", value: {}}],
      // Pflichtfeld vor der Suche: ein fehlendes `id` war früher
      // "recovery plan not found" statt eines 400.
      ["reliability", {action: "verify"}],
      ["reliability", {action: "verify", id: ""}],
      ["reliability", {action: "resolve", id: "FAIL-0000"}],
      ["reliability", {action: "prepare"}],
      ["computer-use", {action: "register", computer: {}}],
      // Gefunden im vollständigen Aktionsdurchlauf: eine Mission ohne Titel und
      // Ziel wurde als inhaltsloser Datensatz angelegt (201).
      ["missions", {action: "create-mission"}],
      ["missions", {action: "create-mission", title: "ohne Ziel"}],
      ["missions", {action: "create-mission", objective: "ohne Titel"}],
      // Stille No-Ops: validate/revoke/redact bestätigten ohne Kennung bzw.
      // Wert mit 200, ohne etwas zu tun.
      ["secrets", {action: "validate"}],
      ["secrets", {action: "revoke"}],
      ["secrets", {action: "redact"}],
      // Unbekannte Rolle: klare Ablehnung statt TypeError aus dem Rechte-Modul.
      ["capabilities", {mode: "role-check", role: "GIBTSNICHT", capability: "sandbox:run"}],
      ["capabilities", {mode: "role-check", role: "DEVELOPER"}],
      ["capabilities", {mode: "authorize", subject: {actorId: "AG-X", role: "GIBTSNICHT", capabilities: []}, policy: {action: "sandbox:run", resource: "SB-X", risk: "LOW", requiresApproval: false, environment: "development"}}]
    ];
    // Bestand vor dem Sweep: der Worker-Test oben erzeugt bereits einen
    // Fehler-Incident, der hier unverändert bleiben muss.
    const incidentsBefore = errorIntelligence.listErrorIncidents().length;
    for (const [route, payload] of cases) {
      const {status} = await post(route, payload);
      // 400 = abgelehnt. 401/403/428 wären ebenfalls sicher (vor dem Guard),
      // dürfen aber nach dem Bootstrap für den Creator nicht auftreten.
      expect(status, `${route} ${JSON.stringify(payload)}`).toBe(400);
    }
    // Kein Zustand entstanden.
    expect(skills.listSkills()).toHaveLength(1); // nur der Skill aus dem ersten Test
    expect(workshop.listWorkshop()).toHaveLength(0);
    expect(simulation.listScenarios()).toHaveLength(0);
    expect(errorIntelligence.listErrorIncidents()).toHaveLength(incidentsBefore);
  });
});
