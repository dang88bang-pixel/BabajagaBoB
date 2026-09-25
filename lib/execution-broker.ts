import {getControlState} from "./control-plane";
import {executionGate} from "./execution-gate";
import {capabilityTokens, validateCapabilityToken} from "./authority";
import {recordAudit} from "./audit";
import {executionEvidenceContent, recordArtifact, verifyArtifact} from "./artifacts";
import {activeSandboxRuntime, runtimeHandle} from "./runtime-factory";
import {observe} from "./observability";
import {addProvenanceEdge, addProvenanceNode} from "./provenance";
import {MAX_ARGV_LENGTH, firstMetacharacterArg, isShellInterpreter} from "./argv-policy";
import type {ExecutionResult} from "./runtime";
import type {Risk} from "./types";

/**
 * Execution Broker (Abschnitt 10).
 *
 * Jede Ausführung passiert diese 17 Prüfungen, bevor `SandboxRuntime.execute`
 * aufgerufen wird. Jede Verweigerung wird auditiert (DENY) und als Event
 * festgehalten, damit abgelehnte Autorisierungsversuche nachweisbar sind.
 *
 *   Intent → Policy → Authorization → Execution Gate → Broker → Isolated Runtime → Evidence
 */

export type ExecutionRequest = {
  taskId: string;
  agentId: string;
  sandboxId: string;
  capabilityTokenId: string;
  runId?: string;
  approvalId?: string;
  experimentId?: string;
  environment?: string;
  argv: string[];
  timeoutMs?: number;
};

export type ExecutionDenial = {
  allowed: false;
  check: string;
  reason: string;
  audited: true;
};

export class ExecutionDeniedError extends Error {
  readonly check: string;
  constructor(check: string, reason: string) {
    super(`execution denied (${check}): ${reason}`);
    this.name = "ExecutionDeniedError";
    this.check = check;
  }
}

const riskRank: Record<Risk, number> = {SAFE: 0, LOW: 1, MODERATE: 2, HIGH: 3, CRITICAL: 4};
const MAX_RESOURCE_LIMITS = {cpuMillicores: 8000, memoryMb: 16384, storageMb: 32768, timeoutMs: 3_600_000, processes: 512};

function deny(request: Partial<ExecutionRequest>, check: string, reason: string): never {
  const actor = request.agentId ?? "UNKNOWN";
  const resource = request.sandboxId ?? request.taskId ?? "UNKNOWN";
  observe({
    type: "execution.denied",
    message: `Ausführung verweigert (${check}): ${reason}`,
    status: "BLOCKED",
    actor,
    agentId: request.agentId,
    taskId: request.taskId,
    runId: request.runId,
    sandboxId: request.sandboxId,
    action: "sandbox.execute",
    resource: resource.includes(":") ? undefined : resource,
    decision: "DENY",
    authorizationRef: request.capabilityTokenId,
    argumentsValue: {check, reason, argv: request.argv}
  });
  recordAudit({actor, action: "sandbox.execute", resource, decision: "DENY"}, {check, reason});
  throw new ExecutionDeniedError(check, reason);
}

export async function executeAuthorized(request: ExecutionRequest): Promise<ExecutionResult> {
  // 1./2. Task und Agent müssen existieren.
  if (!request || typeof request !== "object") deny({}, "REQUEST_SHAPE", "malformed execution request");
  if (!Array.isArray(request.argv) || request.argv.length === 0) deny(request, "ARGV", "execution argv must not be empty");
  if (request.argv.some(arg => typeof arg !== "string" || arg.length === 0 || arg.length > MAX_ARGV_LENGTH)) deny(request, "ARGV", "invalid execution argument");
  // Keine Shell-Strings: Shell-Interpreter und Metazeichen werden vor jeder
  // weiteren Prüfung auditiert verweigert (argv[] + shell:false bleibt erzwungen).
  if (isShellInterpreter(request.argv[0])) deny(request, "SHELL_PROGRAM", `shell interpreter '${request.argv[0]}' is forbidden`);
  const metacharIndex = firstMetacharacterArg(request.argv);
  if (metacharIndex !== null) deny(request, "SHELL_METACHAR", `shell metacharacters are forbidden in argv[${metacharIndex}]`);

  const state = getControlState();
  const task = state.tasks.find(t => t.taskId === request.taskId);
  if (!task) deny(request, "TASK_EXISTS", `task not found: ${request.taskId}`);
  const agent = state.agents.find(a => a.agentId === request.agentId);
  if (!agent) deny(request, "AGENT_EXISTS", `agent not found: ${request.agentId}`);

  // 3. Agent darf die Task ausführen (Assignment + Capability + maxRisk).
  if (task.assignedAgent !== request.agentId) deny(request, "AGENT_TASK_BINDING", `task ${task.taskId} is assigned to ${task.assignedAgent ?? "nobody"}`);
  if (!agent.capabilities.includes("task:execute")) deny(request, "AGENT_CAPABILITY", `agent ${agent.agentId} lacks task:execute`);
  if (riskRank[agent.maxRisk] < riskRank[task.risk]) deny(request, "AGENT_RISK", `agent ${agent.agentId} may not perform ${task.risk} work`);

  // 4./5. Sandbox existiert und gehört zur Task.
  const sandbox = state.sandboxes.find(s => s.sandboxId === request.sandboxId);
  if (!sandbox) deny(request, "SANDBOX_EXISTS", `sandbox not found: ${request.sandboxId}`);
  if (sandbox.taskId !== request.taskId) deny(request, "SANDBOX_TASK_BINDING", `sandbox ${sandbox.sandboxId} is bound to ${sandbox.taskId}`);
  if (sandbox.agentId !== request.agentId) deny(request, "SANDBOX_AGENT_BINDING", `sandbox ${sandbox.sandboxId} is owned by ${sandbox.agentId}`);

  // 6./7. Capability Token existiert und ist gültig.
  const token = capabilityTokens().find(t => t.id === request.capabilityTokenId);
  if (!token) deny(request, "TOKEN_EXISTS", "capability token not found");

  // 8.-12. Token-Bindungen (Subject, Task, Sandbox, Risk) + Gültigkeit.
  const validation = validateCapabilityToken(request.capabilityTokenId, ["task:execute", "sandbox:run"], {
    subject: request.agentId,
    taskId: request.taskId,
    sandboxId: request.sandboxId,
    risk: task.risk
  });
  if (!validation.valid) deny(request, "TOKEN_VALIDATION", validation.reason);
  if (token.subject !== request.agentId) deny(request, "TOKEN_SUBJECT", "token subject mismatch");
  if (token.taskId !== request.taskId) deny(request, "TOKEN_TASK", "token task scope mismatch");
  if (token.sandboxId !== request.sandboxId) deny(request, "TOKEN_SANDBOX", "token sandbox scope mismatch");
  if (riskRank[token.risk] < riskRank[task.risk]) deny(request, "TOKEN_RISK", "token risk scope is insufficient");
  const environment = request.environment ?? sandbox.type;
  if (token.environment && token.environment !== environment) deny(request, "ENVIRONMENT", `token environment ${token.environment} does not match ${environment}`);

  // 13. Kill Switch (System/Agent/Task/Sandbox/Experiment) über das Gate.
  // 14. Approval, falls erforderlich.
  const gate = executionGate(task, request.approvalId, state.locked, request.agentId, request.experimentId, request.sandboxId);
  if (!gate.allowed) deny(request, "EXECUTION_GATE", gate.reasons.join("; "));
  if (task.requiresApproval) {
    const approval = request.approvalId ? state.approvals.find(a => a.approvalId === request.approvalId) : undefined;
    if (!approval || approval.status !== "GRANTED") deny(request, "APPROVAL", "approval is required but not granted");
    if (approval.taskId !== task.taskId) deny(request, "APPROVAL_BINDING", "approval belongs to a different task");
  }

  // 15. Netzwerkpolicy: DENY ist Standard, ALLOWLIST ist fail-closed.
  if (sandbox.network === "ALLOWLIST") deny(request, "NETWORK_POLICY", "ALLOWLIST networking is fail-closed");
  const handle = runtimeHandle(request.sandboxId);
  if (handle?.network.mode === "ALLOWLIST") deny(request, "NETWORK_POLICY", "runtime network allowlist is not available");

  // 16. Ressourcenlimits müssen innerhalb der Policy-Grenzen liegen.
  const limits = handle?.limits;
  if (limits) {
    if (limits.timeoutMs <= 0 || limits.timeoutMs > MAX_RESOURCE_LIMITS.timeoutMs) deny(request, "RESOURCE_LIMITS", "timeout outside allowed range");
    if (limits.memoryMb <= 0 || limits.memoryMb > MAX_RESOURCE_LIMITS.memoryMb) deny(request, "RESOURCE_LIMITS", "memory outside allowed range");
    if (limits.cpuMillicores <= 0 || limits.cpuMillicores > MAX_RESOURCE_LIMITS.cpuMillicores) deny(request, "RESOURCE_LIMITS", "cpu outside allowed range");
    if (limits.processes <= 0 || limits.processes > MAX_RESOURCE_LIMITS.processes) deny(request, "RESOURCE_LIMITS", "process limit outside allowed range");
  }

  // 17. Execution Gate erlaubt die Aktion (bereits geprüft) → Ausführung.
  if (request.runId) {
    addProvenanceNode({id: request.runId, kind: "RUN", label: request.runId, runId: request.runId});
    addProvenanceNode({id: task.taskId, kind: "TASK", label: task.title});
    addProvenanceNode({id: sandbox.sandboxId, kind: "SANDBOX", label: sandbox.type});
    addProvenanceNode({id: token.id, kind: "CAPABILITY", label: token.id});
    addProvenanceEdge({from: request.runId, to: token.id, relation: "AUTHORIZED_BY"});
    addProvenanceEdge({from: request.runId, to: sandbox.sandboxId, relation: "EXECUTED_IN"});
    addProvenanceEdge({from: request.runId, to: task.taskId, relation: "CAUSED_BY"});
  }

  observe({
    type: "execution.authorized",
    message: `Ausführung autorisiert für ${task.taskId} in ${sandbox.sandboxId}`,
    status: "EXECUTING",
    actor: request.agentId,
    agentId: request.agentId,
    taskId: request.taskId,
    runId: request.runId,
    sandboxId: request.sandboxId,
    experimentId: request.experimentId,
    action: "sandbox.execute",
    resource: sandbox.sandboxId,
    decision: "ALLOW",
    authorizationRef: token.id,
    inputRef: request.runId,
    argumentsValue: {argv: request.argv, environment}
  });

  const result = await activeSandboxRuntime.execute(request.sandboxId, request.argv, request.timeoutMs);

  observe({
    type: result.accepted ? "execution.completed" : "execution.failed",
    message: result.accepted ? `Ausführung in ${sandbox.sandboxId} erfolgreich` : `Ausführung in ${sandbox.sandboxId} fehlgeschlagen: ${result.message}`,
    status: result.accepted ? "COMPLETED" : "ERROR",
    actor: request.agentId,
    agentId: request.agentId,
    taskId: request.taskId,
    runId: request.runId,
    sandboxId: request.sandboxId,
    action: "sandbox.execute.result",
    resource: sandbox.sandboxId,
    decision: result.accepted ? "ALLOW" : "ERROR",
    result: result.message,
    outputRef: request.runId,
    authorizationRef: token.id,
    argumentsValue: {exitCode: result.exitCode, durationMs: result.durationMs, timedOut: result.timedOut}
  });

  recordAudit({actor: request.agentId, action: "sandbox.execute", resource: sandbox.sandboxId, decision: result.accepted ? "ALLOW" : "ERROR"}, {
    taskId: request.taskId,
    argv: request.argv,
    exitCode: result.exitCode
  });

  // 18. Evidenz: Das Ergebnis wird digest-gebunden und persistent festgehalten.
  // Der Digest wird im Evidenzmodul über den gespeicherten Inhalt gebildet —
  // stdout/stderr sind damit nachprüfbar, nicht bloß protokolliert.
  const artifact = recordArtifact(
    {
      name: `Ausführung ${task.taskId} in ${sandbox.sandboxId}`,
      kind: "EXECUTION",
      taskId: request.taskId,
      runId: request.runId ?? "",
      sandboxId: request.sandboxId,
      agentId: request.agentId,
      knowledgeState: "OBSERVED",
      contentType: "application/json"
    },
    executionEvidenceContent({
      taskId: request.taskId,
      agentId: request.agentId,
      sandboxId: request.sandboxId,
      runId: request.runId,
      environment,
      argv: request.argv,
      accepted: result.accepted,
      exitCode: result.exitCode,
      stdout: result.stdout,
      stderr: result.stderr,
      timedOut: result.timedOut,
      durationMs: result.durationMs
    })
  );
  const anchor = request.runId ?? sandbox.sandboxId;
  addProvenanceNode({id: artifact.id, kind: "EVIDENCE", label: `Evidenz ${artifact.kind}`, runId: request.runId});
  addProvenanceEdge({
    from: anchor,
    to: artifact.id,
    relation: anchor === request.runId ? "PRODUCED" : "DERIVED_FROM"
  });
  recordAudit(
    {actor: request.agentId, action: "evidence.record", resource: artifact.id, decision: "ALLOW"},
    {taskId: request.taskId, runId: request.runId ?? null, digest: artifact.digest, bytes: artifact.bytes, truncated: artifact.truncated}
  );
  observe({
    type: "evidence.recorded",
    message: `Evidenz ${artifact.id} gespeichert (${artifact.digest.slice(0, 12)}…)`,
    status: "COMPLETED",
    actor: request.agentId,
    agentId: request.agentId,
    taskId: request.taskId,
    runId: request.runId,
    sandboxId: request.sandboxId,
    action: "evidence.record",
    resource: artifact.id,
    decision: "ALLOW",
    outputRef: artifact.id,
    authorizationRef: token.id,
    argumentsValue: {digest: artifact.digest, kind: artifact.kind}
  });

  return {
    ...result,
    evidence: {
      artifactId: artifact.id,
      digest: artifact.digest,
      verified: verifyArtifact(artifact.id).ok,
      truncated: artifact.truncated
    }
  };
}

/** Prüfprotokoll ohne Ausführung (Dry-Run für UI/Governance). */
export function preflight(request: Omit<ExecutionRequest, "argv">): {allowed: boolean; checks: string[]; reasons: string[]} {
  const state = getControlState();
  const checks: string[] = [];
  const reasons: string[] = [];
  const task = state.tasks.find(t => t.taskId === request.taskId);
  checks.push("TASK_EXISTS");
  if (!task) reasons.push("task not found");
  const agent = state.agents.find(a => a.agentId === request.agentId);
  checks.push("AGENT_EXISTS");
  if (!agent) reasons.push("agent not found");
  const sandbox = state.sandboxes.find(s => s.sandboxId === request.sandboxId);
  checks.push("SANDBOX_EXISTS");
  if (!sandbox) reasons.push("sandbox not found");
  if (task && sandbox && sandbox.taskId !== task.taskId) reasons.push("sandbox/task mismatch");
  const token = capabilityTokens().find(t => t.id === request.capabilityTokenId);
  checks.push("TOKEN_EXISTS");
  if (!token) reasons.push("capability token not found");
  if (task && token) {
    const validation = validateCapabilityToken(request.capabilityTokenId, ["task:execute", "sandbox:run"], {
      subject: request.agentId,
      taskId: task.taskId,
      sandboxId: sandbox?.sandboxId,
      risk: task.risk
    });
    checks.push("TOKEN_VALIDATION");
    if (!validation.valid) reasons.push(validation.reason);
    const gate = executionGate(task, request.approvalId, state.locked, request.agentId, request.experimentId, request.sandboxId);
    checks.push("EXECUTION_GATE");
    if (!gate.allowed) reasons.push(...gate.reasons);
  }
  return {allowed: reasons.length === 0, checks, reasons};
}
