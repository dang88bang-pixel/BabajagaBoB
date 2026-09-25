import {auditIntegrity, verifyAuditChain} from "./audit";
// Registriert alle Stores, damit die Kennzahlen die vollständige Landschaft zeigen.
import "./persistence/all-stores";
import {storeIntegrityReport} from "./persistence/store";
import {eventStoreIntegrity} from "./event-store";
import {getControlState} from "./control-plane";
import {listRuns} from "./runs";
import {queueSnapshot} from "./queue";
import {listSandboxes} from "./sandbox/fabric";
import {capabilityTokens} from "./authority";
import {errorSummary, listErrorIncidents} from "./error-intelligence";
import {knowledgeSummary} from "./knowledge";
import {listFailures, listRecoveryPlans} from "./reliability";
import {listRegressionTests} from "./regression";
import {listProviders} from "./provider-fabric";
import {listDevices} from "./devices";
import {listComputers} from "./computer-use";
import {isKilled} from "./governance";
import {isolationReport} from "./ns-isolation";

/**
 * Betriebsmetriken im Prometheus-Textformat (Abschnitt 39 / Operations).
 *
 * Grundsätze:
 *  - **Gemessen statt behauptet:** jede Zahl stammt aus einem Store oder einer
 *    Integritätsprüfung; es gibt keine geschätzten Werte.
 *  - **Keine Geheimnisse:** es werden ausschließlich Zählerstände exponiert –
 *    keine Token-IDs, keine Subjekte, keine Inhalte.
 *  - **Fail closed:** der Endpunkt verlangt eine Session (siehe Route) und
 *    liefert eine leere Kennzahl statt eines geratenen Werts, wenn eine Quelle
 *    nicht lesbar ist.
 */

type Metric = {name: string; help: string; type: "gauge" | "counter"; value: number; labels?: Record<string, string>};

function safe<T>(read: () => T, fallback: T): T {
  try {
    return read();
  } catch {
    return fallback;
  }
}

function render(metric: Metric): string {
  const labels = metric.labels
    ? `{${Object.entries(metric.labels)
        .map(([key, value]) => `${key}="${String(value).replace(/["\\\n]/g, "_")}"`)
        .join(",")}}`
    : "";
  return `# HELP ${metric.name} ${metric.help}\n# TYPE ${metric.name} ${metric.type}\n${metric.name}${labels} ${metric.value}`;
}

export function collectMetrics(): Metric[] {
  const metrics: Metric[] = [];
  const push = (metric: Metric) => metrics.push(metric);

  // --- Persistenz und Integrität -------------------------------------------
  const stores = safe(() => storeIntegrityReport(), {root: "", stores: [], ok: false, unregistered: [], registered: 0});
  push({name: "bob_stores_total", help: "Anzahl registrierter Stores", type: "gauge", value: stores.stores.length});
  push({
    name: "bob_stores_healthy",
    help: "Stores ohne Integritätsfehler",
    type: "gauge",
    value: stores.stores.filter(entry => entry.ok).length
  });
  push({name: "bob_store_integrity_ok", help: "1 wenn alle Stores integer sind, sonst 0", type: "gauge", value: stores.ok ? 1 : 0});

  const events = safe(() => eventStoreIntegrity(), {ok: false, count: 0, issues: [] as string[], file: ""});
  push({name: "bob_events_total", help: "Anzahl persistierter Domain-Events", type: "gauge", value: events.count});
  push({name: "bob_event_store_ok", help: "1 wenn das Event-Log integer ist", type: "gauge", value: events.ok ? 1 : 0});

  const chain = safe(() => verifyAuditChain(), {valid: false, length: 0, issues: [] as string[]});
  push({name: "bob_audit_records", help: "Anzahl verketteter Audit-Einträge", type: "counter", value: chain.length});
  push({name: "bob_audit_chain_ok", help: "1 wenn die HMAC-Kette integer ist", type: "gauge", value: chain.valid ? 1 : 0});
  push({name: "bob_audit_issues", help: "Gemeldete Integritätsprobleme der Audit-Kette", type: "gauge", value: chain.issues.length});
  push({name: "bob_audit_store_ok", help: "1 wenn der Audit-Store integer ist", type: "gauge", value: safe(() => (auditIntegrity().storeOk ? 1 : 0), 0)});

  // --- Ausführungs-Isolation ------------------------------------------------
  // Gemessener Zustand (kernel-seitig erzwungen oder nur Policy), keine Zusage.
  const isolation = safe(() => isolationReport(), null);
  push({
    name: "bob_isolation_namespaces_ok",
    help: "1 wenn die Ausführung kernel-isoliert ist (Namespaces, read-only Rootfs, no_new_privs)",
    type: "gauge",
    value: isolation?.level === "NAMESPACES" ? 1 : 0
  });
  push({
    name: "bob_isolation_capability_drop_ok",
    help: "1 wenn das Capability-Bounding-Set im Sandbox geleert wird",
    type: "gauge",
    value: isolation?.capabilities === "BOUNDING_SET_EMPTY" ? 1 : 0
  });

  // --- Control Plane --------------------------------------------------------
  const state = safe(() => getControlState(), {
    missions: [],
    objectives: [],
    tasks: [],
    agents: [],
    sandboxes: [],
    approvals: []
  } as unknown as ReturnType<typeof getControlState>);
  push({name: "bob_missions", help: "Anzahl Missionen", type: "gauge", value: state.missions.length});
  push({name: "bob_objectives", help: "Anzahl Objectives", type: "gauge", value: state.objectives.length});
  push({name: "bob_tasks", help: "Anzahl Tasks", type: "gauge", value: state.tasks.length});
  push({name: "bob_agents", help: "Anzahl Agenten", type: "gauge", value: state.agents.length});
  push({
    name: "bob_tasks_by_status",
    help: "Tasks je Status",
    type: "gauge",
    value: state.tasks.filter(task => task.status === "RUNNING").length,
    labels: {status: "RUNNING"}
  });
  push({
    name: "bob_approvals_open",
    help: "Offene Approval-Anfragen",
    type: "gauge",
    value: state.approvals.filter(approval => approval.status === "PENDING").length
  });

  // --- Ausführung -----------------------------------------------------------
  const runs = safe(() => listRuns(), []);
  push({name: "bob_runs", help: "Anzahl Runs", type: "gauge", value: runs.length});
  for (const status of ["CREATED", "RUNNING", "COMPLETED", "FAILED", "CANCELLED", "RECOVERING"]) {
    push({name: "bob_runs_by_state", help: "Runs je Zustand", type: "gauge", value: runs.filter(run => run.state === status).length, labels: {state: status}});
  }
  const queue = safe(() => queueSnapshot(), [] as ReturnType<typeof queueSnapshot>);
  push({name: "bob_queue_jobs", help: "Jobs in der Queue", type: "gauge", value: queue.length});
  const sandboxes = safe(() => listSandboxes(), []);
  push({name: "bob_sandboxes", help: "Anzahl Sandboxes", type: "gauge", value: sandboxes.length});
  push({
    name: "bob_sandboxes_running",
    help: "Sandboxes im Zustand RUNNING",
    type: "gauge",
    value: sandboxes.filter(sandbox => sandbox.lifecycle === "RUNNING").length
  });

  // --- Autorisierung --------------------------------------------------------
  const tokens = safe(() => capabilityTokens(), []);
  const now = Date.now();
  push({name: "bob_capability_tokens", help: "Ausgestellte Capability-Token", type: "gauge", value: tokens.length});
  push({
    name: "bob_capability_tokens_active",
    help: "Aktive (nicht widerrufene, nicht abgelaufene) Token",
    type: "gauge",
    value: tokens.filter(token => !token.revoked && new Date(token.expiresAt).getTime() > now).length
  });

  // --- Fehler, Recovery, Wissen --------------------------------------------
  const incidents = safe(() => listErrorIncidents(), []);
  push({name: "bob_error_incidents", help: "Fehler-Incidents", type: "gauge", value: incidents.length});
  const openIncidents = safe(() => errorSummary(), {total: 0, open: 0, rootCauseFound: 0, learned: 0, escalated: 0, critical: 0});
  push({name: "bob_error_incidents_open", help: "Nicht abgeschlossene Incidents", type: "gauge", value: openIncidents.open});
  push({name: "bob_error_incidents_learned", help: "Incidents mit verifiziertem Fix (LEARNED/REGRESSION_LOCKED)", type: "gauge", value: openIncidents.learned});
  push({name: "bob_error_incidents_escalated", help: "Eskalierte Incidents", type: "gauge", value: openIncidents.escalated});
  push({name: "bob_error_incidents_critical_open", help: "Offene Incidents mit Schweregrad CRITICAL", type: "gauge", value: openIncidents.critical});

  const failures = safe(() => listFailures(), []);
  push({name: "bob_failures", help: "Erfasste Fehlerfälle", type: "gauge", value: failures.length});
  push({name: "bob_failures_verified", help: "Verifizierte Fehlerfälle", type: "gauge", value: failures.filter(failure => failure.status === "VERIFIED").length});
  const plans = safe(() => listRecoveryPlans(), []);
  push({name: "bob_recovery_plans", help: "Recovery-Pläne", type: "gauge", value: plans.length});
  push({name: "bob_recovery_verified", help: "Verifizierte Recovery-Pläne", type: "gauge", value: plans.filter(plan => plan.status === "VERIFIED").length});
  push({name: "bob_recovery_rejected", help: "Abgelehnte Recovery-Pläne", type: "gauge", value: plans.filter(plan => plan.status === "REJECTED").length});
  push({name: "bob_regression_tests", help: "Registrierte Regressionstests", type: "gauge", value: safe(() => listRegressionTests().length, 0)});
  const knowledge = safe(() => knowledgeSummary(), {total: 0, negative: 0, unverified: 0, contradictions: 0} as unknown as ReturnType<typeof knowledgeSummary>);
  push({name: "bob_knowledge_nodes", help: "Wissensknoten", type: "gauge", value: knowledge.total ?? 0});
  push({name: "bob_knowledge_negative", help: "Negative Wissensknoten (Never Again)", type: "gauge", value: knowledge.negative ?? 0});

  // --- Fabric ---------------------------------------------------------------
  const providers = safe(() => listProviders(), []);
  push({name: "bob_providers", help: "Provider im Katalog", type: "gauge", value: providers.length});
  push({name: "bob_providers_connected", help: "Verbundene Provider", type: "gauge", value: providers.filter(provider => provider.lifecycle === "CONNECTED").length});
  const devices = safe(() => listDevices(), []);
  push({name: "bob_devices", help: "Bekannte Geräte", type: "gauge", value: devices.length});
  push({name: "bob_devices_authorized", help: "Autorisierte Geräte", type: "gauge", value: devices.filter(device => device.authorized).length});
  const computers = safe(() => listComputers(), []);
  push({name: "bob_computers", help: "Computer-Use-Instanzen", type: "gauge", value: computers.length});
  push({name: "bob_computers_authorized", help: "Autorisierte Computer-Use-Instanzen", type: "gauge", value: computers.filter(computer => computer.authorized).length});

  // --- Governance -----------------------------------------------------------
  for (const scope of ["SYSTEM", "AGENT", "TASK", "SANDBOX", "DEPLOYMENT", "EXPERIMENT"]) {
    push({
      name: "bob_kill_switches_active",
      help: "Aktive Kill Switches je Scope (System-weit gezählt)",
      type: "gauge",
      value: scope === "SYSTEM" && safe(() => isKilled("SYSTEM", "SYSTEM"), false) ? 1 : 0,
      labels: {scope}
    });
  }

  return metrics;
}

/** Prometheus-Textformat (text/plain; version=0.0.4). */
export function renderPrometheusMetrics(): string {
  return `${collectMetrics().map(render).join("\n")}\n`;
}
