import {approvalGranted} from "./approvals";
import {executeAuthorized} from "./execution-broker";
import {executionGate} from "./execution-gate";
import {enqueueJob, expireLeases, leaseJob, startJob, completeJob, failJob} from "./queue";
import {getRun, queueRun, startRun, completeRun, failRun, attachExecution, createRun} from "./runs";
import {createSandbox} from "./sandbox/fabric";
import {ensureExecutionCapability} from "./authority";
import {getControlState} from "./control-plane";
import {observe} from "./observability";
import type {Risk, SandboxType} from "./types";

/**
 * Dispatcher (Abschnitt 7/21).
 *
 * Creator → Task → Agent → Authorization → Sandbox → Run → Job → Runtime
 *
 * Der Dispatcher erzeugt ausschließlich Runs/Jobs/Sandboxes; ausgeführt wird
 * erst im Broker nach vollständiger Autorisierung.
 */

export type DispatchInput = {
  taskId: string;
  agentId: string;
  risk: Risk;
  sandboxType?: SandboxType;
  sandboxId?: string;
  approvalId?: string;
  experimentId?: string;
  environment?: string;
  idempotencyKey?: string;
  timeoutMs?: number;
};

export type DispatchResult = {
  runId: string;
  jobId: string;
  sandboxId: string;
  state: string;
  created: boolean;
};

export async function dispatchTask(input: DispatchInput): Promise<DispatchResult> {
  const state = getControlState();
  const task = state.tasks.find(t => t.taskId === input.taskId);
  if (!task) throw new Error(`task not found: ${input.taskId}`);
  const agent = state.agents.find(a => a.agentId === input.agentId);
  if (!agent) throw new Error(`agent not found: ${input.agentId}`);
  if (task.assignedAgent !== input.agentId) throw new Error(`task ${task.taskId} is assigned to ${task.assignedAgent ?? "nobody"}`);

  const gate = executionGate(task, input.approvalId, state.locked, input.agentId, input.experimentId, input.sandboxId);
  if (!gate.allowed) {
    observe({
      type: "dispatch.blocked",
      message: `Dispatch verweigert: ${gate.reasons.join("; ")}`,
      status: "BLOCKED",
      actor: input.agentId,
      agentId: input.agentId,
      taskId: task.taskId,
      experimentId: input.experimentId,
      action: "task.dispatch",
      resource: task.taskId,
      decision: "DENY",
      argumentsValue: {reasons: gate.reasons}
    });
    throw new Error(`execution blocked: ${gate.reasons.join("; ")}`);
  }
  if (task.requiresApproval && !(input.approvalId && approvalGranted(input.approvalId))) {
    throw new Error("execution blocked: approval required and not granted");
  }

  const sandboxId = input.sandboxId ?? `SB-${Date.now().toString(36).toUpperCase()}`;
  const existingSandbox = state.sandboxes.find(s => s.sandboxId === sandboxId);
  if (!existingSandbox) {
    await createSandbox({
      sandboxId,
      type: input.sandboxType ?? "development",
      taskId: task.taskId,
      agentId: input.agentId,
      risk: input.risk
    });
  }

  const run = createRun({
    taskId: task.taskId,
    agentId: input.agentId,
    risk: input.risk,
    sandboxId,
    idempotencyKey: input.idempotencyKey ?? `task:${task.taskId}:${agent.agentId}`,
    timeoutMs: input.timeoutMs
  });
  const job = enqueueJob({
    taskId: task.taskId,
    runId: run.runId,
    agentId: input.agentId,
    risk: input.risk,
    idempotencyKey: input.idempotencyKey ? `${input.idempotencyKey}:job` : `job:${run.runId}`,
    timeoutMs: input.timeoutMs
  });
  attachExecution(run.runId, job.jobId, sandboxId);
  queueRun(run.runId);

  observe({
    type: "task.dispatched",
    message: `Task ${task.taskId} an ${input.agentId} dispatcht`,
    status: "QUEUED",
    actor: "AG-SUP",
    agentId: input.agentId,
    taskId: task.taskId,
    runId: run.runId,
    jobId: job.jobId,
    sandboxId,
    experimentId: input.experimentId,
    action: "task.dispatch",
    resource: task.taskId,
    inputRef: input.approvalId,
    argumentsValue: {risk: input.risk, sandboxType: input.sandboxType ?? "development", environment: input.environment}
  });

  return {runId: run.runId, jobId: job.jobId, sandboxId, state: "QUEUED", created: true};
}

/** Einfacher synchroner Worker-Schritt für einen konkreten Run (Tests/CLI). */
export async function runOnce(input: {runId: string; workerId?: string; argv?: string[]}) {
  const workerId = input.workerId ?? `worker-${process.pid}`;
  expireLeases();
  const run = getRun(input.runId);
  if (!run || !run.jobId || !run.sandboxId) throw new Error("run is not fully bound (job/sandbox missing)");
  const leased = leaseJob(run.jobId, workerId);
  if (!leased) throw new Error("job could not be leased");
  if (!startJob(run.jobId, workerId)) throw new Error("job could not be started");
  if (!startRun(run.runId)) throw new Error("run could not be started");
  const state = getControlState();
  const task = state.tasks.find(t => t.taskId === run.taskId);
  if (!task) throw new Error("task not found");
  const sandbox = state.sandboxes.find(s => s.sandboxId === run.sandboxId);
  if (!sandbox) throw new Error("sandbox not found");
  const capability = ensureExecutionCapability(run.agentId, run.taskId, sandbox.sandboxId, task.risk, sandbox.type);
  try {
    const result = await executeAuthorized({
      taskId: run.taskId,
      agentId: run.agentId,
      sandboxId: sandbox.sandboxId,
      capabilityTokenId: capability.id,
      runId: run.runId,
      environment: sandbox.type,
      argv: input.argv ?? ["agent-execution"]
    });
    if (!result.accepted) throw new Error(`execution rejected: ${result.message}`);
    completeJob(run.jobId, workerId);
    completeRun(run.runId);
    return {accepted: true, message: result.message, runId: run.runId};
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    failJob(run.jobId, message, workerId);
    failRun(run.runId, message);
    return {accepted: false, message, runId: run.runId};
  }
}
