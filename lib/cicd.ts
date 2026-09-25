import {observe} from "./observability";
import {createStore} from "./persistence/store";

/**
 * CI/CD-Pipeline (Abschnitt 40/41).
 *
 * Die Pipeline wird **persistiert**: eine Promotion-Stufe, die einen Neustart
 * nicht überlebt, wäre kein Nachweis. Der Store hält Prüfstand, Stufe,
 * Freigabe-Referenz und Rollback-Artefakt.
 *
 * Harte Regel: `PRODUCTION` ist nur erreichbar, wenn **alle** Prüfungen
 * `PASSED` sind *und* die Smoke-Stufe erreicht wurde. Der Promotion-Gate
 * (`lib/promotion.ts`) prüft zusätzlich Kill Switch und Freigabe.
 */

export type CheckKind = "LINT" | "TYPECHECK" | "UNIT" | "INTEGRATION" | "SECURITY" | "BUILD" | "BROWSER" | "EVALUATION" | "SMOKE";
export type CheckResult = {
  id: string;
  kind: CheckKind;
  status: "PENDING" | "RUNNING" | "PASSED" | "FAILED" | "SKIPPED";
  summary: string;
  startedAt?: string;
  finishedAt?: string;
};
export type PromotionStage =
  | "BRANCH"
  | "SANDBOX"
  | "VERIFY"
  | "PREVIEW"
  | "APPROVAL"
  | "STAGING"
  | "SMOKE"
  | "PRODUCTION"
  | "ROLLED_BACK";
export type Pipeline = {
  id: string;
  taskId: string;
  runId?: string;
  branch: string;
  stage: PromotionStage;
  checks: CheckResult[];
  approvalId?: string;
  rollbackArtifactId?: string;
  createdAt: string;
  updatedAt: string;
};

const store = createStore<{pipelines: Pipeline[]}>("cicd", 1, () => ({pipelines: []}));
const clone = <T,>(value: T): T => structuredClone(value);
const checkKinds: CheckKind[] = ["LINT", "TYPECHECK", "UNIT", "INTEGRATION", "SECURITY", "BUILD", "BROWSER", "EVALUATION", "SMOKE"];

function update(pipeline: Pipeline) {
  store.update(payload => {
    const index = payload.pipelines.findIndex(entry => entry.id === pipeline.id);
    if (index === -1) payload.pipelines.push(pipeline);
    else payload.pipelines[index] = pipeline;
  });
  return clone(pipeline);
}

export function createPipeline(input: {taskId: string; branch: string; runId?: string; approvalId?: string}) {
  const now = new Date().toISOString();
  const pipeline: Pipeline = {
    id: `PIPE-${Date.now()}`,
    taskId: input.taskId,
    branch: input.branch,
    runId: input.runId,
    approvalId: input.approvalId,
    stage: "BRANCH",
    checks: checkKinds.map(kind => ({id: `CHK-${kind}-${Date.now()}`, kind, status: "PENDING" as const, summary: "Not executed"})),
    createdAt: now,
    updatedAt: now
  };
  update(pipeline);
  observe({
    type: "pipeline.created",
    message: `Pipeline ${pipeline.id} erstellt`,
    status: "QUEUED",
    actor: "ci",
    resource: pipeline.id,
    taskId: pipeline.taskId,
    action: "cicd.pipeline.create",
    argumentsValue: input
  });
  return clone(pipeline);
}

export function updateCheck(pipelineId: string, kind: CheckKind, status: CheckResult["status"], summary: string) {
  const current = store.read().pipelines.find(entry => entry.id === pipelineId);
  if (!current) throw new Error("pipeline not found");
  const check = current.checks.find(entry => entry.kind === kind);
  if (!check) throw new Error("check not found");
  check.status = status;
  check.summary = summary;
  if (status === "RUNNING") check.startedAt = new Date().toISOString();
  if (["PASSED", "FAILED", "SKIPPED"].includes(status)) check.finishedAt = new Date().toISOString();
  current.updatedAt = new Date().toISOString();
  observe({
    type: "ci.check.updated",
    message: `${kind}: ${status}`,
    status: status === "PASSED" ? "COMPLETED" : status === "FAILED" ? "ERROR" : "RUNNING",
    actor: "ci",
    resource: current.id,
    taskId: current.taskId,
    action: "cicd.check.update",
    argumentsValue: {kind, status, summary}
  });
  return update(current);
}

export function promote(pipelineId: string, next: PromotionStage) {
  const pipeline = store.read().pipelines.find(entry => entry.id === pipelineId);
  if (!pipeline) throw new Error("pipeline not found");
  if (next === "PRODUCTION" && pipeline.checks.some(check => check.status !== "PASSED")) {
    throw new Error("production promotion blocked: verification incomplete");
  }
  if (next === "PRODUCTION" && pipeline.stage !== "SMOKE") throw new Error("production requires smoke stage");
  pipeline.stage = next;
  pipeline.updatedAt = new Date().toISOString();
  observe({
    type: "deployment.stage.changed",
    message: `Pipeline ${pipelineId} → ${next}`,
    status: next === "PRODUCTION" ? "COMPLETED" : "RUNNING",
    actor: "operator",
    resource: pipeline.id,
    taskId: pipeline.taskId,
    action: "cicd.promote",
    argumentsValue: {next}
  });
  return update(pipeline);
}

export function listPipelines(): Pipeline[] {
  return store.read().pipelines.map(clone);
}

export function pipelineStoreReport() {
  return store.integrity();
}
