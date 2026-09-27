import crypto from "node:crypto";
import {createStore} from "./persistence/store";
import {observe} from "./observability";
import {executeAuthorized} from "./execution-broker";
import {registerExperiment as registerControlExperiment, updateExperimentRecord} from "./control-plane";
import {assessSignificance, type SignificanceAssessment} from "./significance";
import type {Experiment, KnowledgeState, Status} from "./types";

/**
 * Science Layer (Abschnitt 14/15).
 *
 *   QUESTION → OBJECTIVE → HYPOTHESIS → BASELINE → CONTROL → VARIABLE
 *   → EXPERIMENT → REPLICATION → OBSERVATION → EVIDENCE → ANALYSIS → CONCLUSION
 *
 * Ein einzelner erfolgreicher Lauf setzt niemals `ESTABLISHED`. Dafür sind
 * Baseline, Kontrolle, mindestens eine Replikation mit übereinstimmendem
 * Ergebnis und Evidenz erforderlich (validateCausalChain). Ohne ausreichende
 * Evidenz bleibt der Wissenszustand UNKNOWN, nicht "erfolgreich".
 */

export type EvidenceKind = "OBSERVATION" | "MEASUREMENT" | "TEST_RESULT" | "SOURCE" | "REPRODUCTION";

export type Objective = {
  objectiveId: string;
  missionId: string;
  title: string;
  description: string;
  status: "PLANNED" | "ACTIVE" | "COMPLETED" | "BLOCKED";
  createdAt: string;
};

export type ExperimentRecord = Experiment & {
  taskId: string;
  agentId: string;
  baseline: string;
  control: string;
  variables: string[];
  confounders: string[];
  expectedResult: string;
  observedResult?: string;
  alternativeExplanations: string[];
  evidenceIds: string[];
  replicationCount: number;
  status: Status;
};

export type Evidence = {
  evidenceId: string;
  experimentId: string;
  kind: EvidenceKind;
  claim: string;
  value: string;
  source?: string;
  observedAt: string;
  knowledgeState: KnowledgeState;
};

export type ExperimentRun = {
  experimentRunId: string;
  experimentId: string;
  kind: "BASELINE" | "CONTROL" | "REPLICATION";
  sandboxId: string;
  argv: string[];
  accepted: boolean;
  exitCode: number | null;
  message: string;
  observedAt: string;
  repeat: number;
};

/**
 * Numerischer Messwert eines Laufs.
 *
 * Erst Messwerte machen eine Aussage über **Stärke** eines Unterschieds
 * möglich. Sie sind an das Experiment und an die Gruppe (Baseline, Kontrolle,
 * Replikation) gebunden; ohne sie bleibt die Signifikanzpr?fung ausdr?cklich
 * ohne Ergebnis (`significant: null`), statt einen Erfolg zu behaupten.
 */
export type Measurement = {
  measurementId: string;
  experimentId: string;
  group: ExperimentRun["kind"];
  label: string;
  value: number;
  observedAt: string;
};

export type DecisionRecord = {
  decisionId: string;
  taskId: string;
  objective: string;
  observations: string[];
  assumptions: string[];
  hypothesis: string;
  options: string[];
  chosenExperiment?: string;
  expectedResult: string;
  observedResult?: string;
  evidenceIds: string[];
  conclusion: string;
  nextAction: string;
  createdAt: string;
};

type Payload = {
  objectives: Objective[];
  experiments: ExperimentRecord[];
  evidence: Evidence[];
  runs: ExperimentRun[];
  measurements: Measurement[];
  decisions: DecisionRecord[];
};
const store = createStore<Payload>(
  "science",
  3,
  () => ({objectives: [], experiments: [], evidence: [], runs: [], measurements: [], decisions: []}),
  {
    // Bestand behält seine Experimente; Messwerte kommen neu hinzu (leer).
    migrations: {
      2: (payload: unknown) => {
        const current = (payload ?? {}) as Partial<Payload>;
        return {...current, measurements: Array.isArray(current.measurements) ? current.measurements : []};
      }
    }
  }
);

export function createObjective(x: {objectiveId?: string; missionId: string; title: string; description: string}): Objective {
  if(!x||typeof x!=="object")throw new Error("objective required");
  for(const key of ["missionId","title","description"] as const){
    const value=(x as Record<string,unknown>)[key];
    if(typeof value!=="string"||value.trim().length===0)throw new Error(`objective ${key} required`);
  }
  const payload = store.read();
  const objective: Objective = {
    objectiveId: x.objectiveId ?? `OBJ-${(payload.objectives.length + 1).toString().padStart(3, "0")}`,
    missionId: x.missionId,
    title: x.title,
    description: x.description,
    status: "PLANNED",
    createdAt: new Date().toISOString()
  };
  payload.objectives.push(objective);
  store.write(payload);
  observe({
    type: "science.objective.created",
    message: `Forschungsziel ${objective.objectiveId} erstellt`,
    status: "PLANNING",
    actor: "AG-SCIENTIST",
    agentId: "AG-SCIENTIST",
    action: "science.objective.create",
    resource: objective.objectiveId,
    argumentsValue: x
  });
  return structuredClone(objective);
}

export function createExperiment(x: Omit<ExperimentRecord, "evidenceIds" | "status" | "progress" | "knowledgeState" | "replicationCount">): ExperimentRecord {
  // Ein Experiment ohne Frage/Hypothese/Baseline/Kontrolle/Erwartung ist nicht
  // kausal auswertbar — es würde als leerer Datensatz in der Kette landen.
  if(!x||typeof x!=="object")throw new Error("experiment required");
  for(const key of ["taskId","agentId","baseline","control","expectedResult"] as const){
    const value=(x as Record<string,unknown>)[key];
    if(typeof value!=="string"||value.trim().length===0)throw new Error(`experiment ${key} required`);
  }
  for(const key of ["variables","confounders","alternativeExplanations"] as const){
    if(!Array.isArray((x as Record<string,unknown>)[key]))throw new Error(`experiment ${key} required`);
  }
  const payload = store.read();
  const experimentId = x.experimentId || `EXP-${(payload.experiments.length + 1).toString().padStart(3, "0")}`;
  if (payload.experiments.some(e => e.experimentId === experimentId)) throw new Error(`experiment already exists: ${experimentId}`);
  const experiment: ExperimentRecord = {
    ...x,
    experimentId,
    evidenceIds: [],
    replicationCount: 0,
    status: "PLANNING",
    progress: 0,
    knowledgeState: "HYPOTHESIS"
  };
  payload.experiments.push(experiment);
  store.write(payload);
  try {
    registerControlExperiment({
      experimentId,
      missionId: experiment.missionId,
      objectiveId: experiment.objectiveId,
      title: experiment.title,
      status: experiment.status,
      progress: 0,
      sandboxId: experiment.sandboxId,
      hypothesis: experiment.hypothesis,
      knowledgeState: "HYPOTHESIS"
    });
  } catch {
    /* Control-Registry kann bereits einen Eintrag haben */
  }
  observe({
    type: "science.experiment.created",
    message: `Experiment ${experimentId} geplant`,
    status: "PLANNING",
    actor: experiment.agentId,
    agentId: experiment.agentId,
    taskId: experiment.taskId,
    experimentId,
    sandboxId: experiment.sandboxId,
    action: "science.experiment.create",
    resource: experimentId,
    argumentsValue: {hypothesis: experiment.hypothesis, baseline: experiment.baseline, control: experiment.control, variables: experiment.variables, confounders: experiment.confounders}
  });
  return structuredClone(experiment);
}

export function getExperiment(experimentId: string): ExperimentRecord | null {
  return structuredClone(store.read().experiments.find(e => e.experimentId === experimentId) ?? null);
}

export function updateExperiment(
  experimentId: string,
  patch: Partial<Pick<ExperimentRecord, "status" | "progress" | "expectedResult" | "observedResult" | "knowledgeState" | "alternativeExplanations" | "confounders">>
): ExperimentRecord {
  const payload = store.read();
  const experiment = payload.experiments.find(e => e.experimentId === experimentId);
  if (!experiment) throw new Error("experiment not found");
  if (patch.knowledgeState === "ESTABLISHED") throw new Error("ESTABLISHED requires validateCausalChain; direct promotion is forbidden");
  Object.assign(experiment, patch);
  store.write(payload);
  try {
    updateExperimentRecord(experimentId, {
      status: experiment.status,
      progress: experiment.progress,
      knowledgeState: experiment.knowledgeState,
      hypothesis: experiment.hypothesis
    });
  } catch (error) {
    if (!(error instanceof Error) || !/not found|already exists/i.test(error.message)) throw error;
  }
  observe({
    type: "science.experiment.updated",
    message: `Experiment ${experimentId} aktualisiert`,
    status: experiment.status,
    actor: "AG-SCIENTIST",
    agentId: "AG-SCIENTIST",
    taskId: experiment.taskId,
    experimentId,
    action: "science.experiment.update",
    resource: experimentId,
    argumentsValue: patch
  });
  return structuredClone(experiment);
}

export function addEvidence(x: Omit<Evidence, "evidenceId" | "observedAt">): Evidence {
  const payload = store.read();
  const evidence: Evidence = {...x, evidenceId: `EVD-${crypto.randomUUID().slice(0, 8).toUpperCase()}`, observedAt: new Date().toISOString()};
  payload.evidence.push(evidence);
  const experiment = payload.experiments.find(e => e.experimentId === x.experimentId);
  if (experiment) experiment.evidenceIds.push(evidence.evidenceId);
  store.write(payload);
  observe({
    type: "science.evidence.added",
    message: `Evidence ${evidence.evidenceId} erfasst`,
    status: "TESTING",
    actor: "AG-SCIENTIST",
    agentId: "AG-SCIENTIST",
    experimentId: x.experimentId,
    action: "science.evidence.add",
    resource: evidence.evidenceId,
    argumentsValue: {kind: evidence.kind, claim: evidence.claim, value: evidence.value}
  });
  return structuredClone(evidence);
}

export function listEvidence(experimentId?: string): Evidence[] {
  return structuredClone(store.read().evidence.filter(e => !experimentId || e.experimentId === experimentId));
}

/**
 * Erfasst einen Messwert zu einem Experiment.
 *
 * Nur endliche Zahlen werden angenommen: ein Messwert ist die Grundlage der
 * Signifikanzprüfung, und `NaN`, `Infinity` oder Texte w?rden die Pr?fung
 * stillschweigend verfälschen. Unzul?ssige Werte werden abgelehnt (fail closed),
 * nicht gerundet oder ersetzt.
 */
export function addMeasurement(x: Omit<Measurement, "measurementId" | "observedAt">): Measurement {
  if (!x || typeof x !== "object") throw new Error("measurement required");
  if (typeof x.experimentId !== "string" || x.experimentId.trim().length === 0) throw new Error("experimentId required");
  if (!["BASELINE", "CONTROL", "REPLICATION"].includes(x.group)) throw new Error("measurement group must be BASELINE, CONTROL or REPLICATION");
  if (typeof x.value !== "number" || !Number.isFinite(x.value)) throw new Error("measurement value must be a finite number");
  const label = typeof x.label === "string" && x.label.trim().length > 0 ? x.label.trim().slice(0, 120) : "value";
  const measurement: Measurement = {
    measurementId: `MEA-${crypto.randomUUID().slice(0, 8).toUpperCase()}`,
    experimentId: x.experimentId,
    group: x.group,
    label,
    value: x.value,
    observedAt: new Date().toISOString()
  };
  store.update(payload => {
    payload.measurements.push(measurement);
    if (payload.measurements.length > 5000) payload.measurements.splice(0, payload.measurements.length - 5000);
  });
  observe({
    type: "science.measurement.added",
    message: `Messwert ${measurement.measurementId} (${label}) für ${x.group} erfasst`,
    status: "TESTING",
    actor: "AG-SCIENTIST",
    agentId: "AG-SCIENTIST",
    experimentId: x.experimentId,
    action: "science.measurement.add",
    resource: measurement.measurementId,
    argumentsValue: {group: x.group, label, value: x.value}
  });
  return structuredClone(measurement);
}

export function listMeasurements(experimentId?: string): Measurement[] {
  return structuredClone(store.read().measurements.filter(m => !experimentId || m.experimentId === experimentId));
}

/**
 * Führt einen Experimentlauf über den Broker aus (Baseline, Kontrolle oder Replikation).
 * `repeat` erlaubt mehrere Replikationen derselben Bedingung.
 */
export async function runExperiment(input: {
  experimentId: string;
  kind: ExperimentRun["kind"];
  sandboxId: string;
  argv: string[];
  agentId: string;
  taskId: string;
  capabilityTokenId: string;
  approvalId?: string;
  environment?: string;
  repeat?: number;
}): Promise<ExperimentRun> {
  const experiment = getExperiment(input.experimentId);
  if (!experiment) throw new Error("experiment not found");
  const result = await executeAuthorized({
    taskId: input.taskId,
    agentId: input.agentId,
    sandboxId: input.sandboxId,
    capabilityTokenId: input.capabilityTokenId,
    approvalId: input.approvalId,
    environment: input.environment,
    argv: input.argv
  });
  const run: ExperimentRun = {
    experimentRunId: `XR-${crypto.randomUUID().slice(0, 8).toUpperCase()}`,
    experimentId: input.experimentId,
    kind: input.kind,
    sandboxId: input.sandboxId,
    argv: input.argv,
    accepted: result.accepted,
    exitCode: result.exitCode,
    message: result.message,
    observedAt: new Date().toISOString(),
    repeat: input.repeat ?? 1
  };
  const payload = store.read();
  payload.runs.push(run);
  const record = payload.experiments.find(e => e.experimentId === input.experimentId);
  if (record) {
    if (input.kind === "REPLICATION") record.replicationCount += 1;
    const total = 3; // Baseline, Kontrolle, Replikation
    const completed = new Set(payload.runs.filter(r => r.experimentId === input.experimentId).map(r => r.kind)).size;
    record.progress = Math.min(100, Math.round((completed / total) * 100));
    // Jeder Messlauf — Baseline, Kontrolle, Replikation — erzeugt eine Beobachtung;
    // der Zustand ist deshalb OBSERVING. Die Bewertung passiert in `validateCausalChain`.
    record.status = "OBSERVING";
    record.observedResult = result.message;
    record.knowledgeState = result.accepted ? "SUPPORTED" : "CONTRADICTED";
  }
  store.write(payload);
  observe({
    type: "science.experiment.run",
    message: `Experiment ${input.experimentId}: ${input.kind} ${result.accepted ? "erfolgreich" : "fehlgeschlagen"}`,
    status: record?.status ?? "EXPERIMENT",
    actor: input.agentId,
    agentId: input.agentId,
    taskId: input.taskId,
    sandboxId: input.sandboxId,
    experimentId: input.experimentId,
    action: "science.experiment.run",
    resource: run.experimentRunId,
    decision: result.accepted ? "ALLOW" : "ERROR",
    argumentsValue: {kind: input.kind, argv: input.argv, exitCode: result.exitCode}
  });
  return run;
}

export function listExperimentRuns(experimentId?: string): ExperimentRun[] {
  return structuredClone(store.read().runs.filter(r => !experimentId || r.experimentId === experimentId));
}

export type CausalValidation = {
  experimentId: string;
  valid: boolean;
  knowledgeState: KnowledgeState;
  baselineRuns: number;
  controlRuns: number;
  replicationRuns: number;
  replicationAgreement: number;
  alternativeExplanations: string[];
  confounders: string[];
  evidenceCount: number;
  /** Gemessene Werte je Gruppe (Grundlage der Signifikanzprüfung). */
  measurementCount: number;
  /**
   * Signifikanzprüfung der Differenz Baseline gegen Kontrolle.
   * `significant: null` heißt **nicht prüfbar** und wird nie als Best?tigung
   * gewertet (kein stiller Erfolg).
   */
  significance: SignificanceAssessment;
  reasons: string[];
};

/**
 * Strukturierte Kausalprüfung (Abschnitt 15):
 * zeitliche Reihenfolge, notwendige Vorbedingungen, Intervention, Kontrollgruppe,
 * Reproduktion, alternative Erklärungen, Confounder, unabhängige Evidenz, Gegenbeispiel.
 */
export function validateCausalChain(experimentId: string): CausalValidation {
  const payload = store.read();
  const experiment = payload.experiments.find(e => e.experimentId === experimentId);
  if (!experiment) throw new Error("experiment not found");
  const runs = payload.runs.filter(r => r.experimentId === experimentId);
  const baseline = runs.filter(r => r.kind === "BASELINE");
  const control = runs.filter(r => r.kind === "CONTROL");
  const replication = runs.filter(r => r.kind === "REPLICATION");
  const reasons: string[] = [];

  if (baseline.length === 0) reasons.push("baseline missing");
  if (control.length === 0) reasons.push("control group missing");
  if (replication.length === 0) reasons.push("replication missing");
  if (experiment.evidenceIds.length === 0) reasons.push("no evidence recorded");

  const signatures = replication.map(r => `${r.accepted}|${r.exitCode}`);
  const agreement = replication.length === 0 ? 0 : Math.max(...Object.values(signatures.reduce<Record<string, number>>((acc, s) => ({...acc, [s]: (acc[s] ?? 0) + 1}), {}))) / signatures.length;
  if (replication.length > 0 && agreement < 1) reasons.push("replications disagree");
  if (experiment.confounders.length > 0 && experiment.alternativeExplanations.length === 0) reasons.push("confounders present but no alternative explanations documented");
  if (baseline.length && control.length && baseline[0].observedAt > control[0].observedAt) reasons.push("baseline must be observed before the control condition");
  if (replication.length > 0 && replication.some(r => !r.accepted)) reasons.push("replication rejected");
  if (replication.length > 0 && replication.some(r => r.message.trim().length === 0)) reasons.push("replication lacks observation message");
  if (baseline.length > 0 && baseline.some(r => r.message.trim().length === 0)) reasons.push("baseline lacks observation message");
  if (control.length > 0 && control.some(r => r.message.trim().length === 0)) reasons.push("control lacks observation message");

  // Statistische Tragfähigkeit: Ein Unterschied, der auch Zufall sein kann,
  // trägt keine Kausalaussage. Geprüft wird nur mit echten Messwerten; ohne sie
  // bleibt das Ergebnis `significant: null` und **ohne** zus?tzlichen Grund
  // (fehlende Messwerte sind kein Fehler des Experiments, sondern eine Grenze
  // der Aussage).
  const measurements = payload.measurements.filter(m => m.experimentId === experimentId);
  const significance = assessSignificance({
    baseline: measurements.filter(m => m.group === "BASELINE").map(m => m.value),
    control: measurements.filter(m => m.group === "CONTROL").map(m => m.value)
  });
  if (significance.computed && significance.significant === false) {
    reasons.push(
      `difference is not statistically significant (p=${significance.pValue?.toFixed(4)} ?? n/a, alpha=${significance.alpha})`
    );
  }
  if (significance.computed && significance.confidence === "INSUFFICIENT") {
    reasons.push(
      `sample size below the required ${significance.requiredPerGroup ?? "?"} measurements per group (baseline ${significance.samples.baseline}, control ${significance.samples.control})`
    );
  }

  const contradiction = runs.some(r => r.kind === "CONTROL" && !r.accepted) || experiment.knowledgeState === "CONTRADICTED";
  const valid = reasons.length === 0;
  const state: KnowledgeState = contradiction ? "CONTRADICTED" : valid ? "ESTABLISHED" : replication.length > 0 || experiment.evidenceIds.length > 0 ? "SUPPORTED" : "HYPOTHESIS";

  const result: CausalValidation = {
    experimentId,
    valid,
    knowledgeState: state,
    baselineRuns: baseline.length,
    controlRuns: control.length,
    replicationRuns: replication.length,
    replicationAgreement: agreement,
    alternativeExplanations: experiment.alternativeExplanations,
    confounders: experiment.confounders,
    evidenceCount: experiment.evidenceIds.length,
    measurementCount: measurements.length,
    significance,
    reasons
  };
  experiment.knowledgeState = state;
  experiment.status = valid ? "COMPLETED" : experiment.status === "PLANNING" ? "EXPERIMENT" : experiment.status;
  store.write(payload);
  try {
    updateExperimentRecord(experimentId, {knowledgeState: state, status: experiment.status, progress: experiment.progress});
  } catch (error) {
    if (!(error instanceof Error) || !/not found/i.test(error.message)) throw error;
  }
  observe({
    type: "science.causal.validation",
    message: `Kausalprüfung ${experimentId}: ${state}`,
    status: valid ? "SUCCEEDED" : "FAILED",
    actor: "AG-SCIENTIST",
    agentId: "AG-SCIENTIST",
    experimentId,
    action: "science.causal.validate",
    resource: experimentId,
    decision: valid ? "ALLOW" : "DENY",
    purpose: "Prüfen, ob die Beobachtungen die Behauptung stützen (Baseline, Kontrolle, Replikation, Evidenz).",
    result: valid ? `ESTABLISHED (${result.replicationRuns} Replikationen, Abweichung ${result.replicationAgreement})` : `nicht belegt: ${result.reasons.join("; ")}`,
    argumentsValue: {
      reasons: result.reasons,
      agreement: result.replicationAgreement,
      significance: {
        computed: result.significance.computed,
        method: result.significance.method,
        pValue: result.significance.pValue,
        significant: result.significance.significant,
        confidence: result.significance.confidence
      }
    }
  });
  return result;
}

export function createDecision(x: Omit<DecisionRecord, "decisionId" | "createdAt">): DecisionRecord {
  const payload = store.read();
  const decision: DecisionRecord = {...x, decisionId: `ADR-${crypto.randomUUID().slice(0, 8).toUpperCase()}`, createdAt: new Date().toISOString()};
  payload.decisions.push(decision);
  store.write(payload);
  observe({
    type: "agent.decision.recorded",
    message: `Entscheidung ${decision.decisionId} dokumentiert`,
    status: "COMPLETED",
    actor: "AG-SCIENTIST",
    agentId: "AG-SCIENTIST",
    taskId: decision.taskId,
    action: "science.decision.create",
    resource: decision.decisionId,
    argumentsValue: {hypothesis: decision.hypothesis, conclusion: decision.conclusion, nextAction: decision.nextAction}
  });
  return structuredClone(decision);
}

export function listScience() {
  const payload = store.read();
  return structuredClone(payload);
}

export function listExperiments(): ExperimentRecord[] {
  return structuredClone(store.read().experiments);
}

export function scienceStoreReport() {
  return store.integrity();
}

/** Signifikanzübersicht über alle geprüften Experimente (Nachweis, keine Steuerung). */
export function significanceSummary() {
  const measurements = store.read().measurements;
  const experiments = store.read().experiments;
  const assessed = experiments.map(experiment => ({
    experimentId: experiment.experimentId,
    significance: assessSignificance({
      baseline: measurements.filter(m => m.experimentId === experiment.experimentId && m.group === "BASELINE").map(m => m.value),
      control: measurements.filter(m => m.experimentId === experiment.experimentId && m.group === "CONTROL").map(m => m.value)
    })
  }));
  return {
    measurements: measurements.length,
    withMeasurements: assessed.filter(entry => entry.significance.samples.baseline > 0 && entry.significance.samples.control > 0).length,
    computed: assessed.filter(entry => entry.significance.computed).length,
    significant: assessed.filter(entry => entry.significance.significant === true).length,
    notSignificant: assessed.filter(entry => entry.significance.significant === false).length,
    undecidable: assessed.filter(entry => entry.significance.significant === null).length
  };
}

export function experimentSummary() {
  const experiments = store.read().experiments;
  return {
    total: experiments.length,
    established: experiments.filter(e => e.knowledgeState === "ESTABLISHED").length,
    hypotheses: experiments.filter(e => e.knowledgeState === "HYPOTHESIS").length,
    contradicted: experiments.filter(e => e.knowledgeState === "CONTRADICTED").length
  };
}
