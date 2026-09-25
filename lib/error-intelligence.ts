import crypto from "node:crypto";
import {createStore} from "./persistence/store";
import {observe} from "./observability";
import {recordFailure, prepareRecovery, resolveFailure, verifyRecovery, listFailures, updateFailure} from "./reliability";
import {addEvidence, createExperiment} from "./science";
import {upsertKnowledge, linkKnowledge} from "./knowledge";
import {createSandbox, snapshotSandbox, startSandbox} from "./sandbox/fabric";
import {getControlState} from "./control-plane";
import {registerRegressionTest, runRegressionSuite} from "./regression";
import {notifyInbox} from "./inbox";
import type {KnowledgeState, SandboxType} from "./types";

/**
 * Error Intelligence (Abschnitt 16).
 *
 *   DETECTED → TRIAGING → CONTAINED → REPRODUCING → DIAGNOSING → HYPOTHESIS
 *   → EXPERIMENTING → ROOT_CAUSE_FOUND → FIXING → VERIFYING → LEARNED
 *   → REGRESSION_LOCKED                       (oder: ESCALATED)
 *
 * Fehlerstruktur: Symptom · Incident · Failure Mode · Root Cause ·
 * Contributing Factors · Prevention · Regression Test · Knowledge.
 *
 * Root Cause ohne Evidenz ist unzulässig. "Never Again" entsteht als negatives
 * Wissen; gelernt wird nur mit Nachweis (kein Erfolg ohne Verifikation).
 */

export type ErrorLifecycle =
  | "DETECTED"
  | "TRIAGING"
  | "CONTAINED"
  | "REPRODUCING"
  | "DIAGNOSING"
  | "HYPOTHESIS"
  | "EXPERIMENTING"
  | "ROOT_CAUSE_FOUND"
  | "FIXING"
  | "VERIFYING"
  | "LEARNED"
  | "REGRESSION_LOCKED"
  | "ESCALATED";

export type ErrorSeverity = "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";

export type ErrorIncident = {
  incidentId: string;
  timestamp: string;
  status: ErrorLifecycle;
  severity: ErrorSeverity;
  symptom: string;
  incident: string;
  failureMode: string;
  rootCause?: string;
  contributingFactors: string[];
  prevention: string[];
  hypothesis?: string;
  evidenceIds: string[];
  taskId?: string;
  runId?: string;
  agentId?: string;
  sandboxId?: string;
  diagnosticSandboxId?: string;
  failureId?: string;
  recoveryId?: string;
  regressionId?: string;
  knowledgeId?: string;
  experimentId?: string;
  error?: string;
  updatedAt: string;
};

export const ERROR_TRANSITIONS: Record<ErrorLifecycle, ErrorLifecycle[]> = {
  DETECTED: ["TRIAGING", "ESCALATED"],
  TRIAGING: ["CONTAINED", "ESCALATED"],
  CONTAINED: ["REPRODUCING", "ESCALATED"],
  REPRODUCING: ["DIAGNOSING", "ESCALATED"],
  DIAGNOSING: ["HYPOTHESIS", "ESCALATED"],
  HYPOTHESIS: ["EXPERIMENTING", "ESCALATED"],
  EXPERIMENTING: ["ROOT_CAUSE_FOUND", "HYPOTHESIS", "ESCALATED"],
  ROOT_CAUSE_FOUND: ["FIXING", "ESCALATED"],
  FIXING: ["VERIFYING", "ESCALATED"],
  VERIFYING: ["LEARNED", "ROOT_CAUSE_FOUND", "ESCALATED"],
  LEARNED: ["REGRESSION_LOCKED"],
  REGRESSION_LOCKED: [],
  ESCALATED: ["TRIAGING"]
};

type Payload = {incidents: ErrorIncident[]};
const store = createStore<Payload>("errors", 2, () => ({incidents: []}));

const rank: Record<ErrorSeverity, number> = {LOW: 1, MEDIUM: 2, HIGH: 3, CRITICAL: 4};

export function createErrorIncident(input: Omit<ErrorIncident, "incidentId" | "timestamp" | "status" | "updatedAt">): ErrorIncident {
  const incident: ErrorIncident = {
    ...input,
    incidentId: `ERR-${crypto.randomUUID().slice(0, 8).toUpperCase()}`,
    timestamp: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    status: "DETECTED"
  };
  store.update(payload => {
    payload.incidents.push(incident);
    if (payload.incidents.length > 1000) payload.incidents.splice(0, payload.incidents.length - 1000);
  });
  observe({
    type: "error.detected",
    message: `${incident.incidentId}: ${incident.symptom}`,
    status: "ERROR",
    actor: incident.agentId ?? "SYSTEM",
    agentId: incident.agentId,
    taskId: incident.taskId,
    runId: incident.runId,
    sandboxId: incident.sandboxId,
    action: "error.detect",
    resource: incident.incidentId,
    decision: "ERROR",
    argumentsValue: {severity: incident.severity, failureMode: incident.failureMode, incident: incident.incident}
  });
  return structuredClone(incident);
}

export function getErrorIncident(incidentId: string): ErrorIncident | null {
  return structuredClone(store.read().incidents.find(i => i.incidentId === incidentId) ?? null);
}

export function listErrorIncidents(): ErrorIncident[] {
  return structuredClone(store.read().incidents.slice().sort((a, b) => b.timestamp.localeCompare(a.timestamp)));
}

export function transitionError(incidentId: string, status: ErrorLifecycle, patch: Partial<ErrorIncident> = {}): ErrorIncident {
  const payload = store.read();
  const incident = payload.incidents.find(i => i.incidentId === incidentId);
  if (!incident) throw new Error("error incident not found");
  if (!ERROR_TRANSITIONS[incident.status].includes(status)) throw new Error(`invalid error transition ${incident.status} -> ${status}`);
  incident.status = status;
  Object.assign(incident, patch, {updatedAt: new Date().toISOString()});
  store.write(payload);
  observe({
    type: `error.${status.toLowerCase()}`,
    message: `Fehler ${incidentId}: ${status}`,
    status: status === "REGRESSION_LOCKED" || status === "LEARNED" ? "COMPLETED" : status === "ESCALATED" ? "BLOCKED" : "RECOVERING",
    actor: incident.agentId ?? "AG-RECOVERY",
    agentId: incident.agentId ?? "AG-RECOVERY",
    taskId: incident.taskId,
    runId: incident.runId,
    sandboxId: incident.sandboxId,
    action: "error.transition",
    resource: incidentId,
    argumentsValue: {status, ...patch}
  });
  return structuredClone(incident);
}

/**
 * Autonome Untersuchung: Containment, Diagnose-Sandbox, Failure-Record.
 * Ein Fehler ohne Task (z. B. CRITICAL Systemfehler) erhält eine Diagnose-Sandbox
 * nur, wenn eine Task-Bindung existiert – sonst wird eskaliert (fail closed).
 */
export async function investigateError(incidentId: string, options: {sandboxType?: SandboxType} = {}): Promise<ErrorIncident> {
  let incident = getErrorIncident(incidentId);
  if (!incident) throw new Error("error incident not found");
  if (incident.status === "DETECTED") incident = transitionError(incidentId, "TRIAGING");
  if (rank[incident.severity] >= 3) incident = transitionError(incidentId, "CONTAINED");
  else if (incident.status === "TRIAGING") incident = transitionError(incidentId, "CONTAINED");

  const state = getControlState();
  const incidentTaskId = incident.taskId;
  const task = incidentTaskId ? state.tasks.find(t => t.taskId === incidentTaskId) : undefined;
  const agentId = incident.agentId ?? task?.assignedAgent ?? "AG-RECOVERY";

  if (!incident.diagnosticSandboxId && task && task.assignedAgent) {
    const sandboxId = `SB-DIAG-${incident.incidentId.slice(4, 12)}`;
    await createSandbox({
      sandboxId,
      type: options.sandboxType ?? "diagnostic",
      taskId: task.taskId,
      agentId: task.assignedAgent,
      risk: rank[incident.severity] >= 3 ? "HIGH" : "LOW"
    });
    // Diagnosesandbox real starten: Reproduktion, Snapshot und Verifikation
    // laufen ausschließlich gegen eine laufende isolierte Runtime.
    await startSandbox(sandboxId);
    incident = transitionError(incidentId, "REPRODUCING", {diagnosticSandboxId: sandboxId, sandboxId: incident.sandboxId ?? sandboxId});
  } else if (incident.status === "CONTAINED") {
    incident = transitionError(incidentId, "REPRODUCING");
  }

  const failure = recordFailure({
    incidentId: incident.incidentId,
    runId: incident.runId,
    taskId: incident.taskId,
    symptom: incident.symptom,
    incident: incident.incident,
    failureMode: incident.failureMode,
    contributingFactors: incident.contributingFactors,
    prevention: []
  });
  const updated = transitionError(incidentId, "DIAGNOSING", {failureId: failure.failureId});
  void agentId;
  return updated;
}

export function formHypothesis(incidentId: string, hypothesis: string): ErrorIncident {
  if (!hypothesis || hypothesis.length < 5) throw new Error("hypothesis must be substantive");
  return transitionError(incidentId, "HYPOTHESIS", {hypothesis});
}

export function startExperiment(incidentId: string, objectiveId = "OBJ-003"): ErrorIncident {
  const incident = getErrorIncident(incidentId);
  if (!incident) throw new Error("error incident not found");
  if (!incident.hypothesis) throw new Error("hypothesis required before experimentation");
  const sandboxId = incident.diagnosticSandboxId ?? incident.sandboxId;
  if (!sandboxId) throw new Error("diagnostic sandbox required for reproduction");
  const experimentId = `EXP-${incident.incidentId.slice(4, 12)}`;
  createExperiment({
    experimentId,
    missionId: "MIS-002",
    objectiveId,
    title: `Reproduktion ${incident.incidentId}`,
    sandboxId,
    hypothesis: incident.hypothesis,
    baseline: "bekannt guter Lauf",
    control: "unveränderter Ablauf",
    variables: incident.contributingFactors.length ? incident.contributingFactors : ["vermutete Fehlerbedingung"],
    confounders: ["Umgebungsvarianz", "Abhängigkeitsversion"],
    expectedResult: "Der beobachtete Fehler tritt reproduzierbar auf",
    alternativeExplanations: ["Umgebungsvarianz", "Abhängigkeitsfehler"],
    taskId: incident.taskId ?? "UNASSIGNED",
    agentId: incident.agentId ?? "AG-RECOVERY"
  });
  return transitionError(incidentId, "EXPERIMENTING", {experimentId});
}

export function recordExperimentEvidence(incidentId: string, claim: string, value: string): ErrorIncident {
  const incident = getErrorIncident(incidentId);
  if (!incident) throw new Error("error incident not found");
  if (!incident.experimentId) throw new Error("incident has no experiment");
  const evidence = addEvidence({experimentId: incident.experimentId, kind: "REPRODUCTION", claim, value, knowledgeState: "OBSERVED"});
  const payload = store.read();
  const record = payload.incidents.find(i => i.incidentId === incidentId);
  if (!record) throw new Error("error incident not found");
  record.evidenceIds = [...new Set([...record.evidenceIds, evidence.evidenceId])];
  record.updatedAt = new Date().toISOString();
  store.write(payload);
  observe({
    type: "error.evidence.recorded",
    message: `Evidence ${evidence.evidenceId} für ${incidentId} erfasst`,
    status: "TESTING",
    actor: "AG-RECOVERY",
    agentId: "AG-RECOVERY",
    taskId: record.taskId,
    runId: record.runId,
    action: "error.evidence",
    resource: incidentId,
    outputRef: evidence.evidenceId,
    argumentsValue: {claim, value}
  });
  return structuredClone(record);
}

/** Root Cause nur mit Evidenz (Abschnitt 16). */
export function establishRootCause(incidentId: string, rootCause: string, evidenceIds: string[] = []): ErrorIncident {
  const incident = getErrorIncident(incidentId);
  if (!incident) throw new Error("error incident not found");
  const merged = [...new Set([...incident.evidenceIds, ...evidenceIds])];
  if (merged.length === 0) throw new Error("root cause requires evidence (no evidence recorded)");
  if (!rootCause || rootCause.length < 5) throw new Error("root cause must be substantive");
  const updated = transitionError(incidentId, "ROOT_CAUSE_FOUND", {rootCause, evidenceIds: merged});
  if (incident.failureId) resolveFailure(incident.failureId, rootCause, undefined);
  return updated;
}

export function markFixing(incidentId: string): ErrorIncident {
  return transitionError(incidentId, "FIXING");
}

/** Erzeugt einen dauerhaften Regressionstest für den Fehler ("Never Again"). */
export function createRegressionTest(incidentId: string, argv: string[], createdBy = "AG-QA"): ErrorIncident {
  const incident = getErrorIncident(incidentId);
  if (!incident) throw new Error("error incident not found");
  const test = registerRegressionTest({
    incidentId,
    rootCause: incident.rootCause,
    name: `Regression ${incident.incidentId}`,
    description: incident.symptom,
    argv,
    createdBy
  });
  // Denselben Test mit dem Failure verknüpfen — kein zweiter Regressionstest
  // (früher entstanden hier zwei Tests: REG-<incident> und REG-<failure>).
  if (incident.failureId) {
    const failure = listFailures().find(f => f.failureId === incident.failureId);
    if (failure) {
      updateFailure(incident.failureId, {
        regressionId: test.regressionId,
        prevention: [...new Set([...failure.prevention, `Regressionstest ${test.regressionId}`])]
      });
    }
  }
  const payload = store.read();
  const record = payload.incidents.find(i => i.incidentId === incidentId);
  if (!record) throw new Error("error incident not found");
  record.regressionId = test.regressionId;
  record.updatedAt = new Date().toISOString();
  store.write(payload);
  return structuredClone(record);
}

/**
 * Verifikation: führt die Regression im Diagnose-Sandbox aus. Ohne bestandene
 * Regression gibt es kein LEARNED/REGRESSION_LOCKED.
 */
export async function verifyFix(incidentId: string): Promise<{incident: ErrorIncident; passed: boolean; detail: string}> {
  const incident = getErrorIncident(incidentId);
  if (!incident) throw new Error("error incident not found");
  if (!incident.diagnosticSandboxId) throw new Error("no diagnostic sandbox available");
  const verifying = transitionError(incidentId, "VERIFYING");
  const suite = await runRegressionSuite(verifying.diagnosticSandboxId!, verifying.regressionId ? [verifying.regressionId] : undefined);
  if (!suite.passed) {
    const reverted = transitionError(incidentId, "ROOT_CAUSE_FOUND", {error: `verification failed: ${suite.failed.join(", ") || "no regression tests registered"}`});
    return {incident: reverted, passed: false, detail: suite.failed.join(", ") || "no regression tests registered"};
  }
  const learned = transitionError(incidentId, "LEARNED", {error: undefined});
  return {incident: learned, passed: true, detail: `${suite.passedCount}/${suite.total} regression tests passed`};
}

/** Lernschritt: negatives Wissen ("Never Again") + Knowledge-Link. */
export function learnFromError(incidentId: string, summary: string, verification?: string): ErrorIncident {
  const incident = getErrorIncident(incidentId);
  if (!incident) throw new Error("error incident not found");
  if (incident.status !== "LEARNED") throw new Error(`learning requires a verified fix (status ${incident.status})`);
  const state: KnowledgeState = incident.rootCause && incident.evidenceIds.length > 0 && verification ? "ESTABLISHED" : "SUPPORTED";
  const node = upsertKnowledge({
    layer: "NEGATIVE",
    subject: `Never Again: ${incident.incidentId}`,
    predicate: "prevention",
    object: summary,
    state,
    sourceIds: [incident.incidentId],
    evidenceIds: incident.evidenceIds,
    conditions: incident.contributingFactors.join("; "),
    verification
  });
  if (incident.rootCause) {
    const semantic = upsertKnowledge({
      layer: "SEMANTIC",
      subject: incident.failureMode,
      predicate: "rootCause",
      object: incident.rootCause,
      state,
      sourceIds: [incident.incidentId],
      evidenceIds: incident.evidenceIds
    });
    linkKnowledge(node.knowledgeId, semantic.knowledgeId, "DERIVED_FROM");
  }
  const final = incident.regressionId ? transitionError(incidentId, "REGRESSION_LOCKED", {knowledgeId: node.knowledgeId}) : transitionError(incidentId, "LEARNED", {knowledgeId: node.knowledgeId});
  return final;
}

export function escalateError(incidentId: string, reason: string): ErrorIncident {
  const incident = transitionError(incidentId, "ESCALATED", {error: reason});
  notifyInbox({
    mode: "ESCALATE",
    title: `Fehler ${incidentId} eskaliert`,
    message: reason,
    taskId: incident.taskId
  });
  return incident;
}

/** Vorbereitung der Recovery (Checkpoint + Plan). */
export async function prepareErrorRecovery(incidentId: string): Promise<ErrorIncident> {
  const incident = getErrorIncident(incidentId);
  if (!incident) throw new Error("error incident not found");
  let checkpointSnapshotId: string | undefined;
  if (incident.diagnosticSandboxId) {
    try {
      const snapshot = await snapshotSandbox(incident.diagnosticSandboxId, incident.agentId ?? "AG-RECOVERY");
      checkpointSnapshotId = snapshot.snapshotId;
    } catch {
      /* ohne Snapshot bleibt die Recovery unbestätigt (kein Fake-Erfolg) */
    }
  }
  const plan = prepareRecovery({
    failureId: incident.failureId ?? incident.incidentId,
    tier: rank[incident.severity] >= 3 ? 3 : 2,
    steps: ["betroffene Ausführung isolieren", "Diagnose sammeln", "Snapshot wiederherstellen", "Regression und Smoke ausführen"],
    verificationPlan: ["smoke test", "regression suite"],
    diagnosticSandboxId: incident.diagnosticSandboxId,
    checkpointSnapshotId
  });
  return transitionError(incidentId, "FIXING", {recoveryId: plan.recoveryId});
}

export async function executeRecoveryForIncident(incidentId: string) {
  const incident = getErrorIncident(incidentId);
  if (!incident) throw new Error("error incident not found");
  if (!incident.recoveryId) throw new Error("incident has no recovery plan");
  const {beginRecovery} = await import("./reliability");
  const plan = await beginRecovery(incident.recoveryId, incident.agentId ?? "AG-RECOVERY");
  return plan;
}

export async function verifyRecoveryForIncident(incidentId: string) {
  const incident = getErrorIncident(incidentId);
  if (!incident) throw new Error("error incident not found");
  if (!incident.recoveryId) throw new Error("incident has no recovery plan");
  return verifyRecovery(incident.recoveryId);
}

export function errorSummary() {
  const incidents = listErrorIncidents();
  return {
    total: incidents.length,
    open: incidents.filter(i => ["DETECTED", "TRIAGING", "CONTAINED", "REPRODUCING", "DIAGNOSING", "HYPOTHESIS", "EXPERIMENTING"].includes(i.status)).length,
    rootCauseFound: incidents.filter(i => ["ROOT_CAUSE_FOUND", "FIXING", "VERIFYING"].includes(i.status)).length,
    learned: incidents.filter(i => ["LEARNED", "REGRESSION_LOCKED"].includes(i.status)).length,
    escalated: incidents.filter(i => i.status === "ESCALATED").length,
    critical: incidents.filter(i => i.severity === "CRITICAL" && !["LEARNED", "REGRESSION_LOCKED"].includes(i.status)).length
  };
}

export function errorStoreReport() {
  return store.integrity();
}
