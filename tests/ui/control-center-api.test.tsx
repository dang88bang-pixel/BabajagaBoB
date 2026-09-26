// @vitest-environment jsdom
import {act} from "react";
import {createRoot, type Root} from "react-dom/client";
import {afterEach, beforeAll, describe, expect, it, vi} from "vitest";
import {isolatedStorageRoot, TEST_BOOTSTRAP_SECRET} from "../helpers/runtime";

/**
 * Control Center gegen die **echten** Routen-Handler (Abschnitt 34/35).
 *
 * Anders als `control-center.test.tsx` (nachgebildete API) rendert dieser Test
 * die Oberfläche gegen die tatsächlichen Next-Routen-Handler, echte Sessions,
 * echte Persistenz und echte Guards. Damit ist geprüft, dass jede
 * Navigationsseite an ein real existierendes, autorisiertes Datenangebot
 * gebunden ist — inklusive der Zusage, dass ohne Session nichts erscheint.
 */

(globalThis as {IS_REACT_ACT_ENVIRONMENT?: boolean}).IS_REACT_ACT_ENVIRONMENT = true;

const root = isolatedStorageRoot("ui-real-api");

let container: HTMLDivElement;
let uiRoot: Root;
let cookie = "";

type Handler = (request: Request) => Response | Promise<Response>;
let routes: Record<string, Handler> = {};
let ControlCenter: typeof import("../../components/control-center").default;

const BASE = "http://localhost:3000";

beforeAll(async () => {
  vi.resetModules();
  const bootstrap = await import("../../lib/bootstrap");
  const auth = await import("../../app/api/auth/route");
  ControlCenter = (await import("../../components/control-center")).default;

  const login = await auth.POST(
    new Request(`${BASE}/api/auth`, {
      method: "POST",
      headers: {"content-type": "application/json"},
      body: JSON.stringify({action: "bootstrap", secret: TEST_BOOTSTRAP_SECRET, creatorName: "UI-Tester"})
    })
  );
  expect(login.status).toBe(201);
  cookie = (login.headers.get("set-cookie") ?? "").split(";")[0];
  expect(cookie.startsWith("bob_session=")).toBe(true);

  // Reale Daten anlegen, damit die Oberfläche echte Zeilen zeigen kann.
  const cp = await import("../../lib/control-plane");
  const mission = cp.createMission({title: "UI-Nachweis", objective: "Oberfläche an echte Daten binden", createdBy: "CREATOR"});
  const objective = cp.createObjective({missionId: mission.missionId, title: "UIOBJ", description: "Nachweis"});
  const task = cp.createTask({
    missionId: mission.missionId,
    objectiveId: objective.objectiveId,
    title: "UI-Task",
    risk: "LOW",
    assignedAgent: "AG-BUILD",
    createdBy: "CREATOR"
  });
  const artifacts = await import("../../lib/artifacts");
  artifacts.recordArtifact(
    {name: "UI-Evidenz", kind: "EXECUTION", taskId: task.taskId, runId: "", sandboxId: "SB-UI", agentId: "AG-BUILD", knowledgeState: "OBSERVED"},
    "inhalt"
  );
  const knowledge = await import("../../lib/knowledge");
  knowledge.upsertKnowledge({
    layer: "NEGATIVE",
    subject: "Never Again: UI-Nachweis",
    predicate: "prevention",
    object: "Oberfläche zeigt echte Daten",
    state: "SUPPORTED"
  });
  const inbox = await import("../../lib/inbox");
  inbox.notifyInbox({mode: "INFORM", title: "UI-Hinweis", message: "Oberfläche gebunden"});
  // Ein entdecktes, aber **nicht** autorisiertes Gerät: die Oberfläche muss
  // diesen Unterschied ausweisen (Discovery ≠ Autorisierung).
  const devices = await import("../../lib/devices");
  devices.discoverDevice({id: "DEV-UI-1", name: "UI-Gerät", os: "linux", arch: "x64", cpu: 2, ramMb: 2048, network: "NONE", trust: "EPHEMERAL", capabilities: ["node"], lastSeen: new Date().toISOString()} as never);
  const errors = await import("../../lib/error-intelligence");
  errors.createErrorIncident({
    severity: "HIGH",
    symptom: "UI-Symptom",
    incident: "UI-Fehlerfall",
    failureMode: "Test",
    contributingFactors: [],
    prevention: [],
    evidenceIds: [],
    taskId: task.taskId,
    agentId: "AG-BUILD"
  } as never);

  routes = {
    "/api/control": (await import("../../app/api/control/route")).GET as Handler,
    "/api/timeline": (await import("../../app/api/timeline/route")).GET as Handler,
    "/api/capabilities": (await import("../../app/api/capabilities/route")).GET as Handler,
    "/api/apps": (await import("../../app/api/apps/route")).GET as Handler,
    "/api/gallery": (await import("../../app/api/gallery/route")).GET as Handler,
    "/api/runtime": (await import("../../app/api/runtime/route")).GET as Handler,
    "/api/errors": (await import("../../app/api/errors/route")).GET as Handler,
    "/api/governance": (await import("../../app/api/governance/route")).GET as Handler,
    "/api/agents/fabric": (await import("../../app/api/agents/fabric/route")).GET as Handler,
    "/api/queue": (await import("../../app/api/queue/route")).GET as Handler,
    "/api/approvals": (await import("../../app/api/approvals/route")).GET as Handler,
    "/api/cicd": (await import("../../app/api/cicd/route")).GET as Handler,
    "/api/artifacts": (await import("../../app/api/artifacts/route")).GET as Handler,
    "/api/devices": (await import("../../app/api/devices/route")).GET as Handler,
    "/api/computer-use": (await import("../../app/api/computer-use/route")).GET as Handler,
    "/api/knowledge": (await import("../../app/api/knowledge/route")).GET as Handler,
    "/api/simulation": (await import("../../app/api/simulation/route")).GET as Handler,
    "/api/providers": (await import("../../app/api/providers/route")).GET as Handler,
    "/api/audit": (await import("../../app/api/audit/route")).GET as Handler,
    "/api/readiness": (await import("../../app/api/readiness/route")).GET as Handler,
    "/api/runs": (await import("../../app/api/runs/route")).GET as Handler,
    "/api/runtimes": (await import("../../app/api/runtimes/route")).GET as Handler,
    "/api/science": (await import("../../app/api/science/route")).GET as Handler,
    "/api/reliability": (await import("../../app/api/reliability/route")).GET as Handler,
    "/api/inbox": (await import("../../app/api/inbox/route")).GET as Handler,
    "/api/privacy": (await import("../../app/api/privacy/route")).GET as Handler,
    "/api/persistence": (await import("../../app/api/persistence/route")).GET as Handler,
    "/api/tools": (await import("../../app/api/tools/route")).GET as Handler,
    "/api/skills": (await import("../../app/api/skills/route")).GET as Handler,
    "/api/workshop": (await import("../../app/api/workshop/route")).GET as Handler,
    "/api/auth": (await import("../../app/api/auth/route")).GET as Handler,
    "/api/sandboxes": (await import("../../app/api/sandboxes/route")).GET as Handler,
    "/api/experiments": (await import("../../app/api/experiments/route")).GET as Handler,
    "/api/provenance": (await import("../../app/api/provenance/route")).GET as Handler,
    "/api/observatory": (await import("../../app/api/observatory/route")).GET as Handler,
    "/api/deployment": (await import("../../app/api/deployment/route")).GET as Handler,
    "/api/faults": (await import("../../app/api/faults/route")).GET as Handler,
    "/api/metrics": (await import("../../app/api/metrics/route")).GET as Handler,
    "/api/alerts": (await import("../../app/api/alerts/route")).GET as Handler
  };
  expect(bootstrap.completeBootstrap).toBeTypeOf("function");
  expect(root).toContain("ui-real-api");
});

afterEach(() => {
  act(() => uiRoot?.unmount());
  container?.remove();
  vi.unstubAllGlobals();
});

function dispatchUrl(url: string, withSession: boolean): Promise<Response> {
  const target = url.split("?")[0];
  const handler = routes[target];
  if (!handler) return Promise.resolve(new Response("{}", {status: 404}));
  const headers: Record<string, string> = {host: "localhost:3000"};
  if (withSession) headers.cookie = cookie;
  return Promise.resolve(handler(new Request(url.startsWith("http") ? url : `${BASE}${url}`, {headers})));
}

async function renderUi(withSession = true) {
  vi.stubGlobal("fetch", async (input: RequestInfo | URL) => {
    return dispatchUrl(String(input), withSession);
  });
  container = document.createElement("div");
  document.body.appendChild(container);
  uiRoot = createRoot(container);
  await act(async () => {
    uiRoot.render(<ControlCenter />);
  });
  await act(async () => {
    await Promise.resolve();
    await new Promise(resolve => setTimeout(resolve, 0));
  });
}

async function click(label: string) {
  const button = [...container.querySelectorAll("nav button")].find(entry => entry.textContent?.startsWith(label));
  expect(button, `Navigationspunkt ${label} fehlt`).toBeTruthy();
  await act(async () => {
    button?.dispatchEvent(new MouseEvent("click", {bubbles: true}));
  });
}

describe("Control Center gegen echte Routen", () => {
  it("zeigt mit Session echte Datensätze aus allen Abschnitten", async () => {
    await renderUi(true);
    expect(container.textContent).toContain("Creator");

    for (const section of ["Fehlerfälle", "Agenten", "Missionen", "Objectives", "Aufgaben", "Warteschlange", "Runs", "Sandboxes", "Runtimes", "Evidenz", "Audit", "Provenance", "Timeline / Replay", "Observatory", "Wissen", "Deployment", "Experimente", "Wissenschaft", "Recovery", "Regression", "Fehlerinjektion", "Creator-Inbox", "Freigaben", "Governance", "Sicherheit", "Datenschutz", "Provider", "Geräte", "Computer Use", "CI/CD-Pipeline", "Tests", "Betrieb/Persistenz", "Werkzeuge", "Skills", "Werkstatt", "Simulation", "Galerie", "Apps"]) {
      await click(section);
      expect(container.textContent, `Abschnitt ${section} meldet einen Ausfall`).not.toContain("nicht verfügbar");
    }

    await click("Missionen");
    expect(container.textContent).toContain("UI-Nachweis");
    await click("Aufgaben");
    expect(container.textContent).toContain("UI-Task");
    await click("Evidenz");
    expect(container.textContent).toContain("UI-Evidenz");
    await click("Wissen");
    expect(container.textContent).toContain("Never Again: UI-Nachweis");
    await click("Fehlerfälle");
    expect(container.textContent).toContain("UI-Fehlerfall");
    await click("Creator-Inbox");
    expect(container.textContent).toContain("UI-Hinweis");

    // Geräte: Discovery ist keine Autorisierung — das muss sichtbar sein.
    await click("Geräte");
    expect(container.textContent).toContain("DEV-UI-1");
    expect(container.textContent).toContain("nein — Discovery ≠ Autorisierung");

    // Betrieb/Persistenz: geplante Sicherung mit Aufbewahrungsgrenze.
    await click("Betrieb/Persistenz");
    expect(container.textContent).toContain("Backup-Automation");
    expect(container.textContent).not.toContain("nicht verfügbar");

    // Metriken sind Prometheus-Text der echten Route, keine erfundene Anzeige.
    await click("Metriken");
    expect(container.textContent).toContain("bob_");
    expect(container.textContent).not.toContain("nicht verfügbar");
    // Alarmregeln der echten Route: an die ausgelieferten Kennzahlen gebunden.
    expect(container.textContent).toContain("Alarmregeln");
    expect(container.textContent).toContain("Prüfung BESTANDEN");

    // Secrets sind bewusst nur als Grenze dargestellt: die Oberfläche liest sie
    // nicht (kein Lesezugriff auf Geheimnisse), es gibt keine Platzhalterwerte.
    await click("Secrets");
    expect(container.textContent).toContain("KEIN LESEZUGRIFF");
  });

  it("zeigt Fehlerinjektion, Absturzbericht und Sabotageproben als echten Zustand", async () => {
    // Eine echte Injektion in denselben Speicher, den die Route liest.
    const faults = await import("../../lib/fault-injection");
    const injection = await faults.injectFault({kind: "DUPLICATE_JOB", requestedBy: "CREATOR"});
    expect(injection.outcome).toBe("SURVIVED");

    await renderUi(true);
    await click("Fehlerinjektion");
    const text = container.textContent ?? "";

    // Der Katalog kommt aus der Route, nicht aus dem Bauteil.
    for (const kind of ["PROCESS_ABORT", "WORKER_LOSS", "NETWORK_LOSS", "DUPLICATE_JOB", "CONCURRENT_WRITE", "STORE_TAMPER"]) {
      expect(text, `Katalogart ${kind} fehlt`).toContain(kind);
    }
    // Die echte Injektion ist sichtbar — mit Ergebnis, nicht als Platzhalter.
    expect(text).toContain(injection.faultId);
    expect(text).toContain("SURVIVED");
    expect(text).toContain(injection.observed.slice(0, 20));

    // Berichte der Skriptprüfer fehlen hier (nicht gelaufen) — das wird gesagt,
    // nicht verschwiegen; erfunden wird nichts.
    expect(text).toContain("scripts/fault-injection.mjs");
    expect(text).toContain("scripts/sabotage.mjs");
    expect(text).toContain("Kein Bericht vorhanden");
  });

  it("zeigt ohne Session die Anmeldemaske und keine Daten", async () => {
    await renderUi(false);
    expect(container.textContent).toContain("Creator-Zugang");
    expect(container.textContent).not.toContain("UI-Nachweis");
    expect(container.textContent).not.toContain(TEST_BOOTSTRAP_SECRET);
  });
});
