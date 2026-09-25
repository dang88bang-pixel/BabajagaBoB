// @vitest-environment jsdom
import {act} from "react";
import {createRoot, type Root} from "react-dom/client";
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest";
import ControlCenter from "../../components/control-center";

/**
 * Control Center (Abschnitt 34/35) — jede Navigationsseite muss an echte
 * Serverdaten gebunden sein. Dieser Test rendert die Oberfläche mit einer
 * nachgebildeten API und prüft:
 *   1. alle 20 Abschnitte sind erreichbar,
 *   2. Moduldaten erscheinen als echte Zeilen (kein Platzhalter „READY“),
 *   3. fehlende Daten werden ausdrücklich als „nicht verfügbar“ gemeldet,
 *   4. ohne Session erscheint die Anmeldemaske (kein Blick auf Rohdaten).
 */

(globalThis as {IS_REACT_ACT_ENVIRONMENT?: boolean}).IS_REACT_ACT_ENVIRONMENT = true;

const timers: number[] = [];
let container: HTMLDivElement;
let root: Root;

const payloads: Record<string, unknown> = {
  "/api/control": {
    projectId: "PRJ-BOB",
    agents: [
      {
        id: "AG-BUILD",
        agentId: "AG-BUILD",
        name: "Builder",
        role: "Engineering",
        kind: "BUILDER",
        status: "RUNNING",
        progress: 42,
        capabilities: ["sandbox:run"],
        maxRisk: "HIGH",
        health: "HEALTHY",
        heartbeatAt: "2026-01-01T00:00:00.000Z",
        createdAt: "2026-01-01T00:00:00.000Z"
      }
    ],
    missions: [{missionId: "MIS-001", title: "Plattform fertigstellen", status: "RUNNING", progress: 40, owner: "AG-SUP", objective: "Nachweis"}],
    tasks: [{taskId: "TASK-001", title: "Run-Lifecycle", status: "RUNNING", progress: 45, risk: "LOW", assignedAgent: "AG-BUILD", requiresApproval: false}],
    experiments: [],
    sandboxes: [{sandboxId: "SB-001", type: "development", status: "RUNNING", network: "DENY", taskId: "TASK-001", agentId: "AG-BUILD", runtimeMode: "real-local"}],
    events: [],
    approvals: [{id: "APR-001", taskId: "TASK-001", status: "PENDING", reason: "Capability-Änderung", createdAt: "2026-01-01T00:00:00.000Z"}],
    locked: false
  },
  "/api/timeline": {timeline: [], nodes: [], edges: [], integrity: "ok"},
  "/api/capabilities": {edges: [1, 2], tokens: [1]},
  "/api/apps": {apps: []},
  "/api/gallery": {entries: []},
  "/api/runtime": {mode: "real-local", health: "READY", network: "DENY", summary: {total: 1, running: 1, ready: 0, paused: 0, failed: 0, orphaned: 0}},
  "/api/errors": {incidents: [{id: "ERR-1", timestamp: "2026-01-01T00:00:00.000Z", status: "LEARNED", severity: "HIGH", symptom: "Exit 7", incident: "Fehlerfall"}]},
  "/api/governance": {killSwitches: [], delegations: [], integrity: {count: 0, active: 0, expired: 0}},
  "/api/agents/fabric": {
    agents: [
      {
        agentId: "AG-BUILD",
        name: "Builder",
        kind: "BUILDER",
        status: "RUNNING",
        progress: 42,
        capabilities: ["sandbox:run"],
        maxRisk: "HIGH",
        health: "HEALTHY",
        heartbeatAt: "2026-01-01T00:00:00.000Z",
        profile: {initiative: true, experimentation: true, codeChanges: true, sandboxCreation: true, externalNetwork: false, production: false, infrastructure: false, authorityChanges: false}
      }
    ]
  },
  "/api/queue": {jobs: [{jobId: "JOB-1", taskId: "TASK-001", agentId: "AG-BUILD", state: "LEASED", attempt: 1, maxAttempts: 3, risk: "LOW", priority: 5}]},
  "/api/approvals": [{id: "APR-001", taskId: "TASK-001", status: "PENDING", reason: "Capability-Änderung", createdAt: "2026-01-01T00:00:00.000Z"}],
  "/api/cicd": {pipelines: [{id: "PIPE-1", taskId: "TASK-001", branch: "arena/x", stage: "TEST", checks: [{kind: "UNIT", status: "PASSED"}], updatedAt: "2026-01-01T00:00:00.000Z"}]},
  "/api/artifacts": {artifacts: [{id: "ART-1", name: "Ausführung", kind: "EXECUTION", taskId: "TASK-001", runId: "", sandboxId: "SB-001", agentId: "AG-BUILD", knowledgeState: "OBSERVED", digest: "a".repeat(64), createdAt: "2026-01-01T00:00:00.000Z"}]},
  "/api/devices": {devices: [{id: "DEV-1", name: "Host", os: "linux", arch: "x64", trust: "LOCAL_TRUSTED", state: "AVAILABLE", capabilities: ["node"], network: "NONE"}]},
  "/api/computer-use": {computers: [{id: "CU-1", name: "Browser", kind: "BROWSER", network: "DENY", authorized: false, state: "AVAILABLE"}]},
  "/api/knowledge": {nodes: [{knowledgeId: "KN-1", layer: "NEGATIVE", subject: "Never Again: ERR-1", predicate: "prevention", object: "Fehlerbedingung behandeln", state: "SUPPORTED", confidence: "EVIDENCE_BASED"}]},
  "/api/simulation": {scenarios: [{id: "SIM-1", name: "Fluss", kind: "FLOW", state: "MODELING", assumptions: ["A"], expectedStates: ["B"]}]},
  "/api/providers": {providers: [{id: "PRV-1", name: "Beispiel", category: "MODEL", lifecycle: "REGISTERED", health: "UNKNOWN", enabled: false}]},
  "/api/audit": {records: [{}, {}], chain: {valid: true}},
  "/api/readiness": {ready: true, activeTasks: 3, blockedTasks: 0}
};

function stubFetch(denied: string[] = []) {
  vi.stubGlobal("fetch", (input: RequestInfo | URL) => {
    const url = String(input);
    if (denied.includes(url)) return Promise.resolve(new Response("{}", {status: 500}));
    const body = payloads[url];
    if (body === undefined) return Promise.resolve(new Response("{}", {status: 404}));
    return Promise.resolve(new Response(JSON.stringify(body), {status: 200, headers: {"content-type": "application/json"}}));
  });
}

async function render() {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root.render(<ControlCenter />);
  });
  await act(async () => {
    await Promise.resolve();
  });
}

async function click(label: string) {
  const button = [...container.querySelectorAll("nav button")].find(entry => entry.textContent?.startsWith(label));
  expect(button, `Navigationspunkt ${label} fehlt`).toBeTruthy();
  await act(async () => {
    button?.dispatchEvent(new MouseEvent("click", {bubbles: true}));
  });
  await act(async () => {
    await Promise.resolve();
  });
}

beforeEach(() => {
  stubFetch();
});

afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  vi.unstubAllGlobals();
  timers.forEach(clearInterval);
});

describe("Control Center Oberfläche", () => {
  it("zeigt alle 20 Abschnitte in der Navigation", async () => {
    await render();
    const labels = [...container.querySelectorAll("nav button")].map(button => button.textContent?.replace("›", "").trim());
    // Vollständige Navigationsliste (Abschnitt 34): jeder Eintrag ist an eine
    // echte Serverroute gebunden.
    for (const label of ["Übersicht", "Missionen", "Objectives", "Aufgaben", "Agenten", "Warteschlange", "Runs", "Sandboxes", "Runtimes", "Evidenz", "Audit", "Provenance", "Timeline / Replay", "Wissen", "Experimente", "Wissenschaft", "Fehlerfälle", "Recovery", "Regression", "Creator-Inbox", "Freigaben", "Governance", "Sicherheit", "Datenschutz", "Provider", "Geräte", "Computer Use", "CI/CD-Pipeline", "Tests", "Betrieb/Persistenz", "Metriken", "Secrets", "Werkzeuge", "Skills", "Werkstatt", "Simulation", "Galerie", "Apps"]) {
      expect(labels).toContain(label);
    }
    expect(labels.length).toBeGreaterThanOrEqual(38);
  });

  it("rendert echte Daten statt Platzhaltern", async () => {
    await render();
    await click("Warteschlange");
    expect(container.textContent).toContain("JOB-1");
    expect(container.textContent).toContain("LEASED");

    await click("Evidenz");
    expect(container.textContent).toContain("ART-1");
    expect(container.textContent).toContain("OBSERVED");

    await click("Wissen");
    expect(container.textContent).toContain("Never Again: ERR-1");
    expect(container.textContent).toContain("NEGATIVE");

    await click("Geräte");
    expect(container.textContent).toContain("DEV-1");
    await click("Computer Use");
    expect(container.textContent).toContain("BROWSER");

    await click("Tests");
    expect(container.textContent).toContain("PIPE-1");
    expect(container.textContent).toContain("UNIT:PASSED");

    // Der frühere Platzhalter darf nicht mehr auftauchen.
    expect(container.textContent).not.toContain("explicit integration boundary");
  });

  it("meldet fehlende Daten ausdrücklich als nicht verfügbar", async () => {
    vi.unstubAllGlobals();
    stubFetch(["/api/queue", "/api/knowledge"]);
    await render();
    await click("Warteschlange");
    expect(container.textContent).toContain("nicht verfügbar");
    await click("Wissen");
    expect(container.textContent).toContain("nicht verfügbar");
  });

  it("zeigt ohne Session die Anmeldemaske und keine Rohdaten", async () => {
    vi.unstubAllGlobals();
    vi.stubGlobal("fetch", (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === "/api/control") return Promise.resolve(new Response("{}", {status: 401}));
      if (url === "/api/auth") return Promise.resolve(new Response(JSON.stringify({authenticated: false, requiresBootstrap: false, revoked: false, loginAvailable: true}), {status: 200}));
      return Promise.resolve(new Response("{}", {status: 404}));
    });
    await render();
    expect(container.textContent).toContain("Creator-Zugang");
    expect(container.textContent).toContain("Als Creator anmelden");
    expect(container.textContent).not.toContain("Emergency Lockdown");
  });
});
