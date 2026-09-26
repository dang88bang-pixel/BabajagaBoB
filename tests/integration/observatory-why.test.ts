import {beforeAll, describe, expect, it, vi} from "vitest";
import {isolatedStorageRoot, TEST_BOOTSTRAP_SECRET} from "../helpers/runtime";

/**
 * Agent Observatory und „Warum?“-Record (Abschnitt 11 / 12).
 *
 * Der Test baut einen **echten** Lauf auf (Mission → Task → Run → Abschluss),
 * damit die Projektion aus echten Ereignissen entsteht. Geprüft wird:
 *  - die neun Observatory-Felder samt benannter Lücken,
 *  - die Kausalitätskette des „Warum?“-Records,
 *  - die Grenzen des Records (keine Gedankenkette, fehlende Referenzen werden benannt),
 *  - die Route selbst: Session nötig, 404 für unbekannte, 400 für ungültige IDs.
 */

const root = isolatedStorageRoot("integration-observatory");

let authRoute: typeof import("../../app/api/auth/route");
let whyRoute: typeof import("../../app/api/events/[id]/why/route");
let observatoryRoute: typeof import("../../app/api/observatory/route");
let cp: typeof import("../../lib/control-plane");
let runs: typeof import("../../lib/runs");
let observatory: typeof import("../../lib/observatory");
let events: typeof import("../../lib/events/log");
let errors: typeof import("../../lib/error-intelligence");

const BASE = "http://localhost:3000";
let cookie = "";
let runId = "";
let taskId = "";

beforeAll(async () => {
  vi.resetModules();
  authRoute = await import("../../app/api/auth/route");
  whyRoute = await import("../../app/api/events/[id]/why/route");
  observatoryRoute = await import("../../app/api/observatory/route");
  cp = await import("../../lib/control-plane");
  runs = await import("../../lib/runs");
  observatory = await import("../../lib/observatory");
  events = await import("../../lib/events/log");
  errors = await import("../../lib/error-intelligence");

  const login = await authRoute.POST(
    new Request(`${BASE}/api/auth`, {
      method: "POST",
      headers: {"content-type": "application/json"},
      body: JSON.stringify({action: "bootstrap", secret: TEST_BOOTSTRAP_SECRET, creatorName: "Observatory-Tester"})
    })
  );
  expect(login.status).toBe(201);
  cookie = (login.headers.get("set-cookie") ?? "").split(";")[0];

  const mission = cp.createMission({title: "Observatory", objective: "Nachweis", createdBy: "CREATOR"});
  const objective = cp.createObjective({missionId: mission.missionId, title: "Observatory-Objektiv", description: "Nachweis"});
  const task = cp.createTask({missionId: mission.missionId, objectiveId: objective.objectiveId, title: "Observatory-Task", risk: "LOW", assignedAgent: "AG-BUILD", createdBy: "CREATOR"});
  taskId = task.taskId;
  const run = runs.createRun({taskId: task.taskId, agentId: "AG-BUILD", risk: "LOW", sandboxId: "SB-OBS"});
  runId = run.runId;
  runs.queueRun(run.runId, "worker-1");
  runs.leaseRun(run.runId, "worker-1");
  runs.startRun(run.runId);
  runs.completeRun(run.runId);
  expect(root).toContain("integration-observatory");
});

describe("Agent Observatory", () => {
  it("projiziert einen echten Lauf mit Ziel, Beobachtung und Ergebnis", () => {
    const activity = observatory.getActivity(runId);
    expect(activity).not.toBeNull();
    expect(activity?.kind).toBe("RUN");
    expect(activity?.status).toBe("SUCCEEDED");
    expect(activity?.statusLabel).toBe("Erfolgreich");
    expect(activity?.observations.length).toBeGreaterThan(0);
    expect(activity?.observations.join(" ")).toContain("RUN");
    expect(activity?.eventIds.length).toBeGreaterThanOrEqual(5);
    // Ehrliche Lücke statt stiller Ergänzung: Für einen Lauf ohne Experiment
    // gibt es keine Hypothese — sie wird benannt, nicht erfunden.
    expect(activity?.gaps.length).toBeGreaterThan(0);
    expect(activity?.gaps.join(" ")).toMatch(/Feld (hypothesis|expectation|evidenceIds)/);
  });

  it("liefert die Aktivität auch über die Route (nur mit Session)", async () => {
    const anonymous = await observatoryRoute.GET(new Request(`${BASE}/api/observatory?runId=${runId}`));
    expect([401, 403]).toContain(anonymous.status);

    const authorized = await observatoryRoute.GET(new Request(`${BASE}/api/observatory?runId=${runId}`, {headers: {cookie}}));
    expect(authorized.status).toBe(200);
    const body = (await authorized.json()) as {activities: {activityId: string}[]; statusModel: {total: number; incomplete: string[]}};
    expect(body.activities.map(entry => entry.activityId)).toEqual([runId]);
    expect(body.statusModel.incomplete).toEqual([]);
    expect(body.statusModel.total).toBeGreaterThanOrEqual(20);
  });

  it("weist ungültige Parameter zurück, statt still zu antworten", async () => {
    const badLimit = await observatoryRoute.GET(new Request(`${BASE}/api/observatory?limit=0`, {headers: {cookie}}));
    expect(badLimit.status).toBe(400);
    const badKind = await observatoryRoute.GET(new Request(`${BASE}/api/observatory?kind=ALLES`, {headers: {cookie}}));
    expect(badKind.status).toBe(400);
    const badId = await observatoryRoute.GET(new Request(`${BASE}/api/observatory?runId=../etc/passwd`, {headers: {cookie}}));
    expect(badId.status).toBe(400);
  });
});

describe("Why-Record", () => {
  it("gibt Zweck, Entscheidung und Kausalkette eines echten Ereignisses zurück", () => {
    const succeeded = events.listDomainEvents({runId, order: "asc"}).find(event => event.type === "run.succeeded");
    expect(succeeded, "der Lauf muss ein Erfolgsereignis erzeugt haben").toBeDefined();
    const record = observatory.whyRecord((succeeded as {eventId: string}).eventId);
    expect(record).not.toBeNull();
    expect(record?.chain.length).toBeGreaterThan(1);
    // Die Kette läuft vom ältesten Ereignis zum betrachteten (Richtung der Kausalität).
    expect(record?.chain[0].sequence).toBeLessThan(record?.chain[record.chain.length - 1].sequence as number);
    expect(record?.chain[record.chain.length - 1].eventId).toBe(record?.eventId);
    expect(record?.limitations.join(" ")).toContain("keine verborgene Gedankenkette");
    // Nicht jede Beobachtung ist eine autorisierte Ausführung — das wird benannt.
    expect(record?.limitations.join(" ")).toContain("Keine Autorisierungsreferenz");
  });

  it("antwortet nicht mit einer Begründung, die es nicht gibt", () => {
    expect(observatory.whyRecord("EVT-gibt-es-nicht")).toBeNull();
    expect(observatory.whyRecord("")).toBeNull();
  });

  it("ist über die Route erreichbar — Session, 404 und 400 eingeschlossen", async () => {
    const succeeded = events.listDomainEvents({runId, order: "asc"}).find(event => event.type === "run.succeeded");
    const eventId = (succeeded as {eventId: string}).eventId;

    const anonymous = await whyRoute.GET(new Request(`${BASE}/api/events/${eventId}/why`), {params: Promise.resolve({id: eventId})});
    expect([401, 403]).toContain(anonymous.status);

    const ok = await whyRoute.GET(new Request(`${BASE}/api/events/${eventId}/why`, {headers: {cookie}}), {params: Promise.resolve({id: eventId})});
    expect(ok.status).toBe(200);
    const body = (await ok.json()) as {eventId: string; chain: unknown[]; limitations: string[]};
    expect(body.eventId).toBe(eventId);
    expect(body.chain.length).toBeGreaterThan(1);
    expect(body.limitations.length).toBeGreaterThan(0);

    const missing = await whyRoute.GET(new Request(`${BASE}/api/events/EVT-0000-fehlt/why`, {headers: {cookie}}), {params: Promise.resolve({id: "EVT-0000-fehlt"})});
    expect(missing.status).toBe(404);

    const invalid = await whyRoute.GET(new Request(`${BASE}/api/events/nicht-gueltig/why`, {headers: {cookie}}), {params: Promise.resolve({id: "nicht-gueltig"})});
    expect(invalid.status).toBe(400);
  });
});

describe("Defekt-Klassifikation (Status BUG)", () => {
  it("unterscheidet Code-Defekt von Umgebungsfehler", () => {
    expect(errors.isSoftwareDefect("lib/runs.ts: falsche Bedingung beim Abschluss")).toBe(true);
    expect(errors.isSoftwareDefect("Regression in components/status-badge.tsx")).toBe(true);
    expect(errors.isSoftwareDefect("unhandled exception im Worker")).toBe(true);
    expect(errors.isSoftwareDefect("Netzwerk nicht erreichbar (DNS-Timeout)")).toBe(false);
    expect(errors.isSoftwareDefect("Datenbank liefert keine Antwort")).toBe(false);
    expect(errors.isSoftwareDefect("kurz")).toBe(false);
  });

  it("erzeugt für einen bestätigten Defekt ein Ereignis mit Status BUG", () => {
    // Vollständiger, echter Diagnosepfad: Der Fehlerfall durchläuft Trias,
    // Hypothese, Experiment und Evidenz, bevor der Grund festgestellt wird.
    const incident = errors.createErrorIncident({
      severity: "HIGH",
      symptom: "Task bricht reproduzierbar ab",
      incident: "Task-Abbruch",
      failureMode: "UNIT_TEST",
      contributingFactors: [],
      prevention: [],
      evidenceIds: [],
      taskId,
      sandboxId: "SB-OBS"
    });
    errors.transitionError(incident.incidentId, "TRIAGING");
    errors.transitionError(incident.incidentId, "CONTAINED");
    errors.transitionError(incident.incidentId, "REPRODUCING");
    errors.transitionError(incident.incidentId, "DIAGNOSING");
    errors.formHypothesis(incident.incidentId, "lib/science.ts prüft die Baseline nicht, bevor sie bewertet wird");
    errors.startExperiment(incident.incidentId);
    errors.recordExperimentEvidence(incident.incidentId, "Reproduktion", "Fehler tritt in 3 von 3 Läufen auf");
    errors.establishRootCause(incident.incidentId, "lib/science.ts: fehlende Prüfung der Baseline");

    const defect = events.listDomainEvents({type: "error.defect.confirmed", order: "asc"}).at(-1);
    expect(defect, "bestätigter Defekt muss als Ereignis dokumentiert sein").toBeDefined();
    expect((defect as {status: string}).status).toBe("BUG");
    expect((defect as {decision?: string}).decision).toBe("ERROR");
  });
});
