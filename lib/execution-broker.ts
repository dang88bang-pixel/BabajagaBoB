import crypto from "node:crypto";
import {getControlState} from "./control-plane";
import {
  abandonComputerExecutionClaim,
  claimComputerExecution,
  configuredComputerDriver,
  getComputer,
  invokeComputerDriver,
  settleComputerExecution,
  type ComputerDriverResult,
  type ComputerInstance,
  type ComputerUseAction
} from "./computer-use";
import {executionGate} from "./execution-gate";
import {capabilityTokens, consumeCapabilityToken, validateCapabilityToken} from "./authority";
import {recordAudit} from "./audit";
import {executionEvidenceContent, recordArtifact, verifyArtifact} from "./artifacts";
import {activeSandboxRuntime, runtimeHandle} from "./runtime-factory";
import {observe} from "./observability";
import {addProvenanceEdge, addProvenanceNode} from "./provenance";
import {MAX_ARGV_LENGTH, firstMetacharacterArg, isShellInterpreter} from "./argv-policy";
import type {ExecutionResult} from "./runtime";
import type {Risk} from "./types";
import {MAX_RESOURCE_LIMITS} from "./resource-limits";
import {stageOfflineAssetsInWorkspace, type OfflineAssetPin} from "./offline-assets";
export {MAX_RESOURCE_LIMITS} from "./resource-limits";

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
  /** HMAC-verified by the offline Creator route; assets are staged only after Broker authorization. */
  offlineTaskPackage?: {packageId: string; assets: OfflineAssetPin[]};
  /**
   * Klartext-Zweck der Ausführung (z. B. `REGRESSION`, `SMOKE_TEST`). Interne
   * Läufe tragen ihn mit, damit im Ereignisstrom nachvollziehbar ist, **warum**
   * ausgeführt wurde — nicht nur wer und womit.
   */
  purpose?: string;
};

/** Computer-Aktionen teilen sich Gate, Token-Prüfung, Audit und Evidence mit der Runtime. */
export type ComputerExecutionRequest = ExecutionRequest & {
  computerId: string;
  computerAction: ComputerUseAction;
  computerInput?: Record<string, unknown>;
};

export type ComputerExecutionResult = ExecutionResult & {
  status: "SUCCEEDED" | "FAILED";
  computerId: string;
  computerAction: ComputerUseAction;
  output: unknown;
  outputDigest: string;
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

/**
 * Argumente werden in Verweigerungsnachweisen **nicht im Klartext** abgelegt:
 * argv kann Zugangsdaten oder Nutzdaten enthalten, und Evidenz ist persistent.
 * Festgehalten werden Programm, Anzahl und ein SHA-256 über das vollständige
 * argv — damit bleibt der Nachweis prüfbar und vergleichbar, ohne Geheimnisse
 * in die Evidenz zu kopieren (Datenschutz: default DENY).
 */
function argvFingerprint(argv?: string[]) {
  if (!Array.isArray(argv)) return {program: null, argvLength: 0, argvDigest: null};
  return {
    program: argv[0] ?? null,
    argvLength: argv.length,
    argvDigest: crypto.createHash("sha256").update(JSON.stringify(argv)).digest("hex")
  };
}

const riskRank: Record<Risk, number> = {SAFE: 0, LOW: 1, MODERATE: 2, HIGH: 3, CRITICAL: 4};

function deny(
  request: Partial<ExecutionRequest> & Partial<Pick<ComputerExecutionRequest, "computerId" | "computerAction">>,
  check: string,
  reason: string,
  action: "sandbox.execute" | "computer.execute" = "sandbox.execute"
): never {
  const actor = request.agentId ?? "UNKNOWN";
  const resource = (action === "computer.execute" ? request.computerId : undefined) ?? request.sandboxId ?? request.taskId ?? "UNKNOWN";
  const computerDetails = action === "computer.execute" ? {computerId: request.computerId ?? null, computerAction: request.computerAction ?? null} : {};
  observe({
    type: action === "computer.execute" ? "computer.execution.denied" : "execution.denied",
    message: `Ausführung verweigert (${check}): ${reason}`,
    status: "BLOCKED",
    actor,
    agentId: request.agentId,
    taskId: request.taskId,
    runId: request.runId,
    sandboxId: request.sandboxId,
    action,
    resource: resource.includes(":") ? undefined : resource,
    decision: "DENY",
    authorizationRef: request.capabilityTokenId,
    argumentsValue: {check, reason, ...computerDetails, ...argvFingerprint(request.argv)}
  });
  recordAudit({actor, action, resource, decision: "DENY"}, {check, reason, ...computerDetails});

  // Evidenz der Verweigerung (Abschnitt 49): Eine blockierte Autorisierung ist
  // nachweisbar, nicht nur protokolliert. Die Evidenz ist an Task/Agent/Sandbox
  // gebunden, soweit sie bekannt sind, digest-geprüft und über Provenance
  // verknüpft. Ein Fehler beim Schreiben darf die Verweigerung nicht in einen
  // Erfolg verwandeln — deshalb fail closed mit Ausnahme, aber ohne Evidenz.
  try {
    const artifact = recordArtifact(
      {
        name: `Verweigerung ${check}`,
        kind: "DENIAL",
        taskId: request.taskId ?? "",
        runId: request.runId ?? "",
        sandboxId: request.sandboxId ?? "",
        agentId: request.agentId ?? "UNKNOWN",
        knowledgeState: "OBSERVED",
        contentType: "application/json"
      },
      JSON.stringify({
        check,
        reason,
        taskId: request.taskId ?? null,
        agentId: request.agentId ?? null,
        sandboxId: request.sandboxId ?? null,
        capabilityTokenId: request.capabilityTokenId ?? null,
        environment: request.environment ?? null,
        ...computerDetails,
        ...argvFingerprint(request.argv),
        decidedAt: new Date().toISOString()
      })
    );
    addProvenanceNode({id: artifact.id, kind: "EVIDENCE", label: `Verweigerung ${check}`, runId: request.runId});
    addProvenanceEdge({from: request.runId ?? request.sandboxId ?? artifact.id, to: artifact.id, relation: "DERIVED_FROM"});
    recordAudit({actor, action: "evidence.record", resource: artifact.id, decision: "ALLOW"}, {kind: artifact.kind, digest: artifact.digest});
  } catch (evidenceError) {
    observe({
      type: "evidence.error",
      message: `Verweigerungsevidenz konnte nicht geschrieben werden: ${evidenceError instanceof Error ? evidenceError.message : "unbekannt"}`,
      status: "ERROR",
      actor,
      taskId: request.taskId,
      sandboxId: request.sandboxId,
      action: "evidence.record",
      decision: "ERROR"
    });
  }

  throw new ExecutionDeniedError(check, reason);
}

type BrokerContext = {
  state: ReturnType<typeof getControlState>;
  task: ReturnType<typeof getControlState>["tasks"][number];
  agent: ReturnType<typeof getControlState>["agents"][number];
  sandbox: ReturnType<typeof getControlState>["sandboxes"][number];
  token: ReturnType<typeof capabilityTokens>[number];
  environment: string;
  handle: ReturnType<typeof runtimeHandle>;
};

type BrokerMode = "sandbox" | "computer";
type BrokerAuthorizationOptions = {
  validateResource?: (context: BrokerContext) => void;
  beforeConsume?: (context: BrokerContext) => void;
  onConsumeFailure?: (context: BrokerContext) => void;
};

function authorizeForExecution(
  request: ExecutionRequest,
  mode: BrokerMode,
  options: BrokerAuthorizationOptions = {}
): BrokerContext {
  const action = mode === "computer" ? "computer.execute" : "sandbox.execute";
  if (!request || typeof request !== "object") deny({}, "REQUEST_SHAPE", "malformed execution request", action);

  if (mode === "sandbox") {
    if (!Array.isArray(request.argv) || request.argv.length === 0) deny(request, "ARGV", "execution argv must not be empty", action);
    if (request.argv.some(arg => typeof arg !== "string" || arg.length === 0 || arg.length > MAX_ARGV_LENGTH)) deny(request, "ARGV", "invalid execution argument", action);
    // Keine Shell-Strings: Shell-Interpreter und Metazeichen werden vor jeder
    // weiteren Prüfung auditiert verweigert (argv[] + shell:false bleibt erzwungen).
    if (isShellInterpreter(request.argv[0])) deny(request, "SHELL_PROGRAM", `shell interpreter '${request.argv[0]}' is forbidden`, action);
    const metacharIndex = firstMetacharacterArg(request.argv);
    if (metacharIndex !== null) deny(request, "SHELL_METACHAR", `shell metacharacters are forbidden in argv[${metacharIndex}]`, action);
  } else if (!Array.isArray(request.argv) || request.argv.length !== 1 || request.argv[0] !== "COMPUTER_USE") {
    // The Computer Use adapter is a typed action, not a general command runner.
    // Its JSON input never becomes a process argv or shell string.
    deny(request, "COMPUTER_REQUEST", "computer actions require the fixed COMPUTER_USE broker marker", action);
  }

  if (request.timeoutMs !== undefined && (!Number.isSafeInteger(request.timeoutMs) || request.timeoutMs <= 0 || request.timeoutMs > MAX_RESOURCE_LIMITS.timeoutMs)) {
    deny(request, "RESOURCE_LIMITS", "timeout outside allowed range", action);
  }

  const state = getControlState();
  const task = state.tasks.find(entry => entry.taskId === request.taskId);
  if (!task) deny(request, "TASK_EXISTS", `task not found: ${request.taskId}`, action);
  const agent = state.agents.find(entry => entry.agentId === request.agentId);
  if (!agent) deny(request, "AGENT_EXISTS", `agent not found: ${request.agentId}`, action);

  // The specific static agent capability and the task-execution capability
  // form the upper bound. The token below is a narrower, one-use delegation.
  if (task.assignedAgent !== request.agentId) deny(request, "AGENT_TASK_BINDING", `task ${task.taskId} is assigned to ${task.assignedAgent ?? "nobody"}`, action);
  const requiredAgentCapabilities = mode === "computer" ? ["task:execute", "computer:use"] : ["task:execute"];
  const missingAgentCapability = requiredAgentCapabilities.find(capability => !agent.capabilities.includes(capability));
  if (missingAgentCapability) deny(request, "AGENT_CAPABILITY", `agent ${agent.agentId} lacks ${missingAgentCapability}`, action);
  if (riskRank[agent.maxRisk] < riskRank[task.risk]) deny(request, "AGENT_RISK", `agent ${agent.agentId} may not perform ${task.risk} work`, action);

  // Sandbox and task/agent binding are mandatory for both ordinary runtime and
  // Computer Use. A desktop resource is never an alternative authorization path.
  const sandbox = state.sandboxes.find(entry => entry.sandboxId === request.sandboxId);
  if (!sandbox) deny(request, "SANDBOX_EXISTS", `sandbox not found: ${request.sandboxId}`, action);
  if (sandbox.taskId !== request.taskId) deny(request, "SANDBOX_TASK_BINDING", `sandbox ${sandbox.sandboxId} is bound to ${sandbox.taskId}`, action);
  if (sandbox.agentId !== request.agentId) deny(request, "SANDBOX_AGENT_BINDING", `sandbox ${sandbox.sandboxId} is owned by ${sandbox.agentId}`, action);

  const token = capabilityTokens().find(entry => entry.id === request.capabilityTokenId);
  if (!token) deny(request, "TOKEN_EXISTS", "capability token not found", action);

  const environment = request.environment ?? sandbox.type;
  const requiredTokenCapabilities = mode === "computer"
    ? ["task:execute", "sandbox:run", "computer:execute"]
    : ["task:execute", "sandbox:run"];
  const validation = validateCapabilityToken(request.capabilityTokenId, requiredTokenCapabilities, {
    subject: request.agentId,
    taskId: request.taskId,
    sandboxId: request.sandboxId,
    risk: task.risk,
    environment
  });
  if (!validation.valid) deny(request, "TOKEN_VALIDATION", validation.reason, action);
  if (token.subject !== request.agentId) deny(request, "TOKEN_SUBJECT", "token subject mismatch", action);
  if (token.taskId !== request.taskId) deny(request, "TOKEN_TASK", "token task scope mismatch", action);
  if (token.sandboxId !== request.sandboxId) deny(request, "TOKEN_SANDBOX", "token sandbox scope mismatch", action);
  if (riskRank[token.risk] < riskRank[task.risk]) deny(request, "TOKEN_RISK", "token risk scope is insufficient", action);
  if (token.environment && token.environment !== environment) deny(request, "ENVIRONMENT", `token environment ${token.environment} does not match ${environment}`, action);

  // Kill Switch and Approval checks are identical for code and computer work.
  const gate = executionGate(task, request.approvalId, state.locked, request.agentId, request.experimentId, request.sandboxId);
  if (!gate.allowed) deny(request, "EXECUTION_GATE", gate.reasons.join("; "), action);
  if (task.requiresApproval) {
    const approval = request.approvalId ? state.approvals.find(entry => entry.approvalId === request.approvalId) : undefined;
    if (!approval || approval.status !== "GRANTED") deny(request, "APPROVAL", "approval is required but not granted", action);
    if (approval.taskId !== task.taskId) deny(request, "APPROVAL_BINDING", "approval belongs to a different task", action);
  }

  if (sandbox.network === "ALLOWLIST") deny(request, "NETWORK_POLICY", "ALLOWLIST networking is fail-closed", action);
  const handle = runtimeHandle(request.sandboxId);
  if (handle?.network.mode === "ALLOWLIST") deny(request, "NETWORK_POLICY", "runtime network allowlist is not available", action);

  const limits = handle?.limits;
  if (limits) {
    if (limits.timeoutMs <= 0 || limits.timeoutMs > MAX_RESOURCE_LIMITS.timeoutMs) deny(request, "RESOURCE_LIMITS", "timeout outside allowed range", action);
    if (limits.memoryMb <= 0 || limits.memoryMb > MAX_RESOURCE_LIMITS.memoryMb) deny(request, "RESOURCE_LIMITS", "memory outside allowed range", action);
    if (limits.cpuMillicores <= 0 || limits.cpuMillicores > MAX_RESOURCE_LIMITS.cpuMillicores) deny(request, "RESOURCE_LIMITS", "cpu outside allowed range", action);
    if (limits.processes <= 0 || limits.processes > MAX_RESOURCE_LIMITS.processes) deny(request, "RESOURCE_LIMITS", "process limit outside allowed range", action);
  }

  const context = {state, task, agent, sandbox, token, environment, handle};
  options.validateResource?.(context);
  // Computer execution takes an atomic lease before token consumption, so a
  // parallel request cannot consume a valid token for an already-busy device.
  options.beforeConsume?.(context);
  try {
    consumeCapabilityToken(request.capabilityTokenId, request.agentId);
  } catch (error) {
    options.onConsumeFailure?.(context);
    deny(request, "TOKEN_REPLAY", error instanceof Error ? error.message : "capability token could not be consumed", action);
  }
  return context;
}

function linkExecutionProvenance(request: ExecutionRequest, context: BrokerContext, computer?: ComputerInstance) {
  if (!request.runId) return;
  addProvenanceNode({id: request.runId, kind: "RUN", label: request.runId, runId: request.runId});
  addProvenanceNode({id: context.task.taskId, kind: "TASK", label: context.task.title});
  addProvenanceNode({id: context.sandbox.sandboxId, kind: "SANDBOX", label: context.sandbox.type});
  addProvenanceNode({id: context.token.id, kind: "CAPABILITY", label: context.token.id});
  addProvenanceEdge({from: request.runId, to: context.token.id, relation: "AUTHORIZED_BY"});
  addProvenanceEdge({from: request.runId, to: context.sandbox.sandboxId, relation: "EXECUTED_IN"});
  addProvenanceEdge({from: request.runId, to: context.task.taskId, relation: "CAUSED_BY"});
  if (computer) {
    addProvenanceNode({id: computer.id, kind: "DEVICE", label: computer.name, runId: request.runId});
    addProvenanceEdge({from: request.runId, to: computer.id, relation: "OBSERVED", note: "Computer resource used by brokered action"});
  }
}

export async function executeAuthorized(request: ExecutionRequest): Promise<ExecutionResult> {
  const context = authorizeForExecution(request, "sandbox");
  const {task, sandbox, token, environment} = context;
  linkExecutionProvenance(request, context);

  if (request.offlineTaskPackage) {
    const offlinePackage = request.offlineTaskPackage;
    if (!/^OTP-[a-f0-9-]{36}$/.test(offlinePackage.packageId) || request.purpose !== `OFFLINE_TASK_PACKAGE:${offlinePackage.packageId}` || !Array.isArray(offlinePackage.assets)) {
      deny(request, "OFFLINE_PACKAGE_BINDING", "offline package execution binding is invalid");
    }
    if (offlinePackage.assets.length > 0) {
      const workspace = context.handle?.workspace;
      const storageLimit = context.handle?.limits.storageMb;
      if (!workspace || !storageLimit) deny(request, "OFFLINE_ASSET_RUNTIME", "runtime has no verified workspace for offline asset staging");
      let staged: Awaited<ReturnType<typeof stageOfflineAssetsInWorkspace>>;
      try {
        staged = await stageOfflineAssetsInWorkspace({
          packageId: offlinePackage.packageId,
          assets: offlinePackage.assets,
          workspace,
          maxBytes: storageLimit * 1024 * 1024
        });
      } catch (error) {
        deny(request, "OFFLINE_ASSET_STAGE", error instanceof Error ? error.message : "offline task assets could not be staged");
      }
      for (const asset of staged) {
        observe({
          type: "offline.asset.staged",
          message: `Offline-Asset ${asset.assetId} im Sandbox-Workspace bereitgestellt`,
          status: "COMPLETED",
          actor: request.agentId,
          agentId: request.agentId,
          taskId: request.taskId,
          sandboxId: request.sandboxId,
          action: "offline.asset.stage",
          resource: asset.assetId,
          decision: "ALLOW",
          authorizationRef: token.id,
          argumentsValue: {packageId: offlinePackage.packageId, digest: asset.digest, sizeBytes: asset.sizeBytes, workspacePath: asset.workspacePath}
        });
      }
    }
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
    purpose: request.purpose,
    argumentsValue: {argv: request.argv, environment, ...(request.purpose ? {purpose: request.purpose} : {})}
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

  // Runtime-Ausgabe ist die Evidenz des lokalen Code-Laufs. Computer-Ausgaben
  // benutzen unten eine andere Projektion und werden nicht ungefiltert persistiert.
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
      durationMs: result.durationMs,
      isolation: result.isolation
    })
  );
  const anchor = request.runId ?? sandbox.sandboxId;
  addProvenanceNode({id: artifact.id, kind: "EVIDENCE", label: `Evidenz ${artifact.kind}`, runId: request.runId});
  addProvenanceEdge({from: anchor, to: artifact.id, relation: anchor === request.runId ? "PRODUCED" : "DERIVED_FROM"});
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
    evidence: {artifactId: artifact.id, digest: artifact.digest, verified: verifyArtifact(artifact.id).ok, truncated: artifact.truncated}
  };
}

const COMPUTER_ACTIONS: readonly ComputerUseAction[] = [
  "NAVIGATE", "CLICK", "TYPE", "SELECT", "SCREENSHOT", "OCR", "PROCESS_READ", "FILE_READ", "TERMINAL_EXECUTE"
];
const MAX_COMPUTER_INPUT_BYTES = 16_384;

function normalizeComputerInput(request: ComputerExecutionRequest): {value: Record<string, unknown>; json: string; digest: string} {
  const value = request.computerInput ?? {};
  if (!value || typeof value !== "object" || Array.isArray(value)) deny(request, "COMPUTER_INPUT", "computerInput must be a JSON object", "computer.execute");
  let json: string;
  try {
    json = JSON.stringify(value);
  } catch {
    deny(request, "COMPUTER_INPUT", "computerInput must be JSON serializable", "computer.execute");
  }
  if (Buffer.byteLength(json, "utf8") > MAX_COMPUTER_INPUT_BYTES) deny(request, "COMPUTER_INPUT", "computerInput exceeds the 16 KiB limit", "computer.execute");
  // Round-trip strips prototypes/getters and ensures the exact bytes hashed are
  // the bytes sent to the configured adapter.
  const normalized = JSON.parse(json) as Record<string, unknown>;
  if (!normalized || typeof normalized !== "object" || Array.isArray(normalized)) deny(request, "COMPUTER_INPUT", "computerInput must be a JSON object", "computer.execute");
  return {
    value: normalized,
    json,
    digest: crypto.createHash("sha256").update(json).digest("hex")
  };
}

function computerOutputDigest(driver: ComputerDriverResult): string {
  return crypto.createHash("sha256").update(driver.stdout, "utf8").digest("hex");
}

/**
 * Authorizes one Computer Use action through the same Gate and single-use
 * capability path as code execution. The adapter is operator-configured,
 * invoked with shell:false and bounded input/output/time, and receives no token
 * secrets. Sensitive input/output is returned to the caller but only digests
 * and action metadata are persisted to Events, Audit and Evidence.
 */
export async function executeComputerAuthorized(request: ComputerExecutionRequest): Promise<ComputerExecutionResult> {
  if (!request || typeof request !== "object") deny({}, "REQUEST_SHAPE", "malformed computer execution request", "computer.execute");
  if (!COMPUTER_ACTIONS.includes(request.computerAction)) deny(request, "COMPUTER_ACTION", "unsupported computer action", "computer.execute");
  if (request.computerAction === "TERMINAL_EXECUTE") {
    // Terminal execution would reintroduce an untyped command path through the
    // adapter. It remains disabled until its own argv/capability contract exists.
    deny(request, "COMPUTER_ACTION", "terminal execution is not available through Computer Use", "computer.execute");
  }
  const normalizedInput = normalizeComputerInput(request);
  let driverPath = "";
  const leaseId = `CULEASE-${crypto.randomUUID()}`;
  let claimed = false;

  const context = authorizeForExecution(request, "computer", {
    validateResource: ctx => {
      const candidate = getComputer(request.computerId);
      if (!candidate) deny(request, "COMPUTER_EXISTS", `computer not found: ${request.computerId}`, "computer.execute");
      if (!candidate.authorized) deny(request, "COMPUTER_AUTHORIZATION", "computer is not authorized", "computer.execute");
      if (candidate.taskId !== request.taskId) deny(request, "COMPUTER_TASK_BINDING", "computer is allocated to a different task", "computer.execute");
      if (candidate.sandboxId !== request.sandboxId) deny(request, "COMPUTER_SANDBOX_BINDING", "computer is allocated to a different sandbox", "computer.execute");
      if (candidate.state !== "ALLOCATED" && candidate.state !== "EXECUTING") deny(request, "COMPUTER_STATE", `computer is not executable in state ${candidate.state}`, "computer.execute");
      if (candidate.network !== "DENY" || ctx.sandbox.network !== "DENY") deny(request, "NETWORK_POLICY", "computer execution requires network DENY", "computer.execute");
      const profile = candidate.capabilities.find(entry => entry.kind === candidate.kind && entry.actions.includes(request.computerAction));
      if (!profile) deny(request, "COMPUTER_CAPABILITY", `computer does not allow ${request.computerAction}`, "computer.execute");
      if (!profile.environments.includes(ctx.environment)) deny(request, "ENVIRONMENT", `computer capability does not allow environment ${ctx.environment}`, "computer.execute");
      if (profile.network !== "DENY") deny(request, "NETWORK_POLICY", "computer capability network must be DENY", "computer.execute");
      if (riskRank[profile.risk] < riskRank[ctx.task.risk]) deny(request, "COMPUTER_RISK", `computer capability risk ${profile.risk} is insufficient for ${ctx.task.risk}`, "computer.execute");
      try {
        const configured = configuredComputerDriver();
        if (!configured) deny(request, "COMPUTER_DRIVER", "BOB_COMPUTER_DRIVER is not configured", "computer.execute");
        driverPath = configured;
      } catch (error) {
        deny(request, "COMPUTER_DRIVER", error instanceof Error ? error.message : "computer driver is unavailable", "computer.execute");
      }
    },
    beforeConsume: () => {
      try {
        claimComputerExecution(request.computerId, leaseId, {taskId: request.taskId, sandboxId: request.sandboxId});
        claimed = true;
      } catch (error) {
        deny(request, "COMPUTER_BUSY", error instanceof Error ? error.message : "computer is not available", "computer.execute");
      }
    },
    onConsumeFailure: () => {
      if (claimed) abandonComputerExecutionClaim(request.computerId, leaseId);
    }
  });
  const computer = getComputer(request.computerId);
  if (!computer) {
    if (claimed) abandonComputerExecutionClaim(request.computerId, leaseId);
    deny(request, "COMPUTER_EXISTS", "computer not found", "computer.execute");
  }

  let driverResult: ComputerDriverResult;
  const timeoutMs = Math.min(request.timeoutMs ?? context.handle?.limits.timeoutMs ?? 60_000, context.handle?.limits.timeoutMs ?? 60_000, 60_000);
  try {
    linkExecutionProvenance(request, context, computer);
    observe({
      type: "computer.execution.authorized",
      message: `Computer-Aktion ${request.computerAction} für ${computer.id} autorisiert`,
      status: "EXECUTING",
      actor: request.agentId,
      agentId: request.agentId,
      taskId: request.taskId,
      runId: request.runId,
      sandboxId: request.sandboxId,
      action: "computer.execute",
      resource: computer.id,
      decision: "ALLOW",
      authorizationRef: context.token.id,
      inputRef: request.runId,
      purpose: request.purpose,
      argumentsValue: {
        computerId: computer.id,
        computerAction: request.computerAction,
        inputDigest: normalizedInput.digest,
        environment: context.environment
      }
    });
    driverResult = await invokeComputerDriver({
      driverPath,
      computer,
      action: request.computerAction,
      computerInput: normalizedInput.value,
      taskId: request.taskId,
      sandboxId: request.sandboxId,
      environment: context.environment,
      timeoutMs,
      cwd: context.handle?.workspace
    });
  } catch (error) {
    driverResult = {
      accepted: false,
      output: null,
      stdout: "",
      stderr: error instanceof Error ? error.message : "computer driver failed",
      exitCode: null,
      timedOut: false,
      durationMs: 0,
      message: error instanceof Error ? error.message : "computer driver failed",
      outputTruncated: false
    };
  }
  let leaseSettled = false;
  try {
    settleComputerExecution(computer.id, leaseId, driverResult.accepted);
    leaseSettled = true;
  } catch (error) {
    // A lost lease is a safety failure. Do not describe the operation as
    // successful if the resource state could not be reconciled.
    driverResult = {
      ...driverResult,
      accepted: false,
      message: `computer execution state could not be settled: ${error instanceof Error ? error.message : "unknown error"}`
    };
  }
  if (!leaseSettled && claimed) abandonComputerExecutionClaim(computer.id, leaseId);

  const outputDigest = computerOutputDigest(driverResult);
  const status = driverResult.accepted ? "SUCCEEDED" : "FAILED";
  observe({
    type: driverResult.accepted ? "computer.execution.completed" : "computer.execution.failed",
    message: `Computer-Aktion ${request.computerAction} ${driverResult.accepted ? "abgeschlossen" : "fehlgeschlagen"}`,
    status: driverResult.accepted ? "COMPLETED" : "ERROR",
    actor: request.agentId,
    agentId: request.agentId,
    taskId: request.taskId,
    runId: request.runId,
    sandboxId: request.sandboxId,
    action: "computer.execute.result",
    resource: computer.id,
    decision: driverResult.accepted ? "ALLOW" : "ERROR",
    result: driverResult.message,
    outputRef: request.runId,
    authorizationRef: context.token.id,
    argumentsValue: {
      computerId: computer.id,
      computerAction: request.computerAction,
      inputDigest: normalizedInput.digest,
      outputDigest,
      exitCode: driverResult.exitCode,
      durationMs: driverResult.durationMs,
      timedOut: driverResult.timedOut,
      outputTruncated: driverResult.outputTruncated
    }
  });
  recordAudit({actor: request.agentId, action: "computer.execute", resource: computer.id, decision: driverResult.accepted ? "ALLOW" : "ERROR"}, {
    taskId: request.taskId,
    runId: request.runId ?? null,
    sandboxId: request.sandboxId,
    computerAction: request.computerAction,
    inputDigest: normalizedInput.digest,
    outputDigest,
    exitCode: driverResult.exitCode,
    durationMs: driverResult.durationMs,
    timedOut: driverResult.timedOut,
    status
  });

  const evidence = recordArtifact(
    {
      name: `Computer-Aktion ${request.computerAction} auf ${computer.id}`,
      kind: "COMPUTER_EXECUTION",
      taskId: request.taskId,
      runId: request.runId ?? "",
      sandboxId: request.sandboxId,
      agentId: request.agentId,
      knowledgeState: "OBSERVED",
      contentType: "application/json"
    },
    JSON.stringify({
      taskId: request.taskId,
      agentId: request.agentId,
      runId: request.runId ?? null,
      sandboxId: request.sandboxId,
      environment: context.environment,
      computerId: computer.id,
      computerAction: request.computerAction,
      inputDigest: normalizedInput.digest,
      outputDigest,
      accepted: driverResult.accepted,
      status,
      exitCode: driverResult.exitCode,
      timedOut: driverResult.timedOut,
      durationMs: driverResult.durationMs,
      outputTruncated: driverResult.outputTruncated,
      observedAt: new Date().toISOString()
    }, null, 2)
  );
  const anchor = request.runId ?? sandboxResourceAnchor(request.sandboxId);
  if (request.runId) {
    addProvenanceNode({id: evidence.id, kind: "EVIDENCE", label: `Evidenz ${evidence.kind}`, runId: request.runId});
    addProvenanceEdge({from: request.runId, to: evidence.id, relation: "PRODUCED"});
  } else {
    addProvenanceNode({id: evidence.id, kind: "EVIDENCE", label: `Evidenz ${evidence.kind}`});
    addProvenanceEdge({from: anchor, to: evidence.id, relation: "DERIVED_FROM"});
  }
  recordAudit({actor: request.agentId, action: "evidence.record", resource: evidence.id, decision: "ALLOW"}, {
    taskId: request.taskId,
    runId: request.runId ?? null,
    digest: evidence.digest,
    kind: evidence.kind
  });
  observe({
    type: "evidence.recorded",
    message: `Computer-Evidenz ${evidence.id} gespeichert (${evidence.digest.slice(0, 12)}…)`,
    status: "COMPLETED",
    actor: request.agentId,
    agentId: request.agentId,
    taskId: request.taskId,
    runId: request.runId,
    sandboxId: request.sandboxId,
    action: "evidence.record",
    resource: evidence.id,
    decision: "ALLOW",
    outputRef: evidence.id,
    authorizationRef: context.token.id,
    argumentsValue: {digest: evidence.digest, kind: evidence.kind}
  });

  return {
    accepted: driverResult.accepted,
    exitCode: driverResult.exitCode,
    stdout: driverResult.stdout,
    stderr: driverResult.stderr,
    timedOut: driverResult.timedOut,
    durationMs: driverResult.durationMs,
    message: driverResult.message,
    evidence: {artifactId: evidence.id, digest: evidence.digest, verified: verifyArtifact(evidence.id).ok, truncated: evidence.truncated},
    status,
    computerId: computer.id,
    computerAction: request.computerAction,
    output: driverResult.output,
    outputDigest
  };
}

function sandboxResourceAnchor(sandboxId: string): string {
  // The sandbox is a real domain node; ensure it exists for evidence linkage.
  addProvenanceNode({id: sandboxId, kind: "SANDBOX", label: sandboxId});
  return sandboxId;
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
