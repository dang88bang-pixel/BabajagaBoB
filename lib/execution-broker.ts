import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import {spawn} from "node:child_process";
import {getControlState} from "./control-plane";
import {executionGate} from "./execution-gate";
import {capabilityTokens, consumeCapabilityToken, validateCapabilityToken, type CapabilityToken} from "./authority";
import {recordAudit} from "./audit";
import {executionEvidenceContent, recordArtifact, verifyArtifact} from "./artifacts";
import {activeSandboxRuntime, runtimeHandle} from "./runtime-factory";
import {observe} from "./observability";
import {addProvenanceEdge, addProvenanceNode} from "./provenance";
import {assertComputerBinding, claimComputerExecution, completeComputerExecution, type ComputerUseAction} from "./computer-use";
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
  /**
   * Klartext-Zweck der Ausführung (z. B. `REGRESSION`, `SMOKE_TEST`). Interne
   * Läufe tragen ihn mit, damit im Ereignisstrom nachvollziehbar ist, **warum**
   * ausgeführt wurde — nicht nur wer und womit.
   */
  purpose?: string;
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
export const MAX_RESOURCE_LIMITS = {cpuMillicores: 8000, memoryMb: 16384, storageMb: 32768, timeoutMs: 3_600_000, processes: 512};

function deny(request: Partial<ExecutionRequest>, check: string, reason: string, extra?: Record<string, unknown>): never {
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
    argumentsValue: {check, reason, ...(extra ?? {}), ...argvFingerprint(request.argv)}
  });
  recordAudit({actor, action: "sandbox.execute", resource, decision: "DENY"}, {check, reason});

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
        ...(extra ?? {}),
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

/* ------------------------------------------------------- gemeinsame Prüfungen */

type ExecutionContext = {
  state: ReturnType<typeof getControlState>;
  task: ReturnType<typeof getControlState>["tasks"][number];
  agent: ReturnType<typeof getControlState>["agents"][number];
  sandbox: ReturnType<typeof getControlState>["sandboxes"][number];
  token: CapabilityToken;
  environment: string;
};

/**
 * Die Prüfungen 1–16 des Brokers. Sie sind für **alle** Ausführungswege
 * gemeinsam, damit neben der Prozessausführung kein zweiter, schwächerer
 * Autorisierungspfad entsteht (Computer Use nutzt exakt dieselbe Prüfung und
 * verlangt lediglich zusätzlich die Fähigkeit `computer:execute`).
 */
function authorizeExecution(
  request: ExecutionRequest,
  requiredCapabilities: string[],
  extra?: Record<string, unknown>
): ExecutionContext {
  // 1./2. Task und Agent müssen existieren.
  if (!request || typeof request !== "object") deny({}, "REQUEST_SHAPE", "malformed execution request", extra);
  if (!Array.isArray(request.argv) || request.argv.length === 0) deny(request, "ARGV", "execution argv must not be empty", extra);
  if (request.argv.some(arg => typeof arg !== "string" || arg.length === 0 || arg.length > MAX_ARGV_LENGTH)) deny(request, "ARGV", "invalid execution argument", extra);
  // Keine Shell-Strings: Shell-Interpreter und Metazeichen werden vor jeder
  // weiteren Prüfung auditiert verweigert (argv[] + shell:false bleibt erzwungen).
  if (isShellInterpreter(request.argv[0])) deny(request, "SHELL_PROGRAM", `shell interpreter '${request.argv[0]}' is forbidden`, extra);
  const metacharIndex = firstMetacharacterArg(request.argv);
  if (metacharIndex !== null) deny(request, "SHELL_METACHAR", `shell metacharacters are forbidden in argv[${metacharIndex}]`, extra);

  const state = getControlState();
  const task = state.tasks.find(t => t.taskId === request.taskId);
  if (!task) deny(request, "TASK_EXISTS", `task not found: ${request.taskId}`, extra);
  const agent = state.agents.find(a => a.agentId === request.agentId);
  if (!agent) deny(request, "AGENT_EXISTS", `agent not found: ${request.agentId}`, extra);

  // 3. Agent darf die Task ausführen (Assignment + Capability + maxRisk).
  if (task.assignedAgent !== request.agentId) deny(request, "AGENT_TASK_BINDING", `task ${task.taskId} is assigned to ${task.assignedAgent ?? "nobody"}`, extra);
  if (!agent.capabilities.includes("task:execute")) deny(request, "AGENT_CAPABILITY", `agent ${agent.agentId} lacks task:execute`, extra);
  if (riskRank[agent.maxRisk] < riskRank[task.risk]) deny(request, "AGENT_RISK", `agent ${agent.agentId} may not perform ${task.risk} work`, extra);

  // 4./5. Sandbox existiert und gehört zur Task.
  const sandbox = state.sandboxes.find(s => s.sandboxId === request.sandboxId);
  if (!sandbox) deny(request, "SANDBOX_EXISTS", `sandbox not found: ${request.sandboxId}`, extra);
  if (sandbox.taskId !== request.taskId) deny(request, "SANDBOX_TASK_BINDING", `sandbox ${sandbox.sandboxId} is bound to ${sandbox.taskId}`, extra);
  if (sandbox.agentId !== request.agentId) deny(request, "SANDBOX_AGENT_BINDING", `sandbox ${sandbox.sandboxId} is owned by ${sandbox.agentId}`, extra);

  // 6./7. Capability Token existiert und ist gültig.
  const token = capabilityTokens().find(t => t.id === request.capabilityTokenId);
  if (!token) deny(request, "TOKEN_EXISTS", "capability token not found", extra);

  // 8.-12. Token-Bindungen (Subject, Task, Sandbox, Risk, Fähigkeiten) + Gültigkeit.
  const validation = validateCapabilityToken(request.capabilityTokenId, requiredCapabilities, {
    subject: request.agentId,
    taskId: request.taskId,
    sandboxId: request.sandboxId,
    risk: task.risk
  });
  if (!validation.valid) deny(request, "TOKEN_VALIDATION", validation.reason, extra);
  if (token.subject !== request.agentId) deny(request, "TOKEN_SUBJECT", "token subject mismatch", extra);
  if (token.taskId !== request.taskId) deny(request, "TOKEN_TASK", "token task scope mismatch", extra);
  if (token.sandboxId !== request.sandboxId) deny(request, "TOKEN_SANDBOX", "token sandbox scope mismatch", extra);
  if (riskRank[token.risk] < riskRank[task.risk]) deny(request, "TOKEN_RISK", "token risk scope is insufficient", extra);
  const environment = request.environment ?? sandbox.type;
  if (token.environment && token.environment !== environment) deny(request, "ENVIRONMENT", `token environment ${token.environment} does not match ${environment}`, extra);

  // 13. Kill Switch (System/Agent/Task/Sandbox/Experiment) über das Gate.
  // 14. Approval, falls erforderlich.
  const gate = executionGate(task, request.approvalId, state.locked, request.agentId, request.experimentId, request.sandboxId);
  if (!gate.allowed) deny(request, "EXECUTION_GATE", gate.reasons.join("; "), extra);
  if (task.requiresApproval) {
    const approval = request.approvalId ? state.approvals.find(a => a.approvalId === request.approvalId) : undefined;
    if (!approval || approval.status !== "GRANTED") deny(request, "APPROVAL", "approval is required but not granted", extra);
    if (approval.taskId !== task.taskId) deny(request, "APPROVAL_BINDING", "approval belongs to a different task", extra);
  }

  // 15. Netzwerkpolicy: DENY ist Standard, ALLOWLIST ist fail-closed.
  if (sandbox.network === "ALLOWLIST") deny(request, "NETWORK_POLICY", "ALLOWLIST networking is fail-closed", extra);
  const handle = runtimeHandle(request.sandboxId);
  if (handle?.network.mode === "ALLOWLIST") deny(request, "NETWORK_POLICY", "runtime network allowlist is not available", extra);

  // 16. Ressourcenlimits müssen innerhalb der Policy-Grenzen liegen.
  const limits = handle?.limits;
  if (limits) {
    if (limits.timeoutMs <= 0 || limits.timeoutMs > MAX_RESOURCE_LIMITS.timeoutMs) deny(request, "RESOURCE_LIMITS", "timeout outside allowed range", extra);
    if (limits.memoryMb <= 0 || limits.memoryMb > MAX_RESOURCE_LIMITS.memoryMb) deny(request, "RESOURCE_LIMITS", "memory outside allowed range", extra);
    if (limits.cpuMillicores <= 0 || limits.cpuMillicores > MAX_RESOURCE_LIMITS.cpuMillicores) deny(request, "RESOURCE_LIMITS", "cpu outside allowed range", extra);
    if (limits.processes <= 0 || limits.processes > MAX_RESOURCE_LIMITS.processes) deny(request, "RESOURCE_LIMITS", "process limit outside allowed range", extra);
  }

  return {state, task, agent, sandbox, token, environment};
}

/**
 * 16b. Wiederholungssperre: Das Token wird **vor** der Ausführung verbraucht.
 * Eine Autorisierung = eine Ausführung; ein zweiter Lauf mit demselben Token
 * ist ein Replay und wird verweigert (Audit + Verweigerungsevidenz).
 */
function consumeTokenFor(request: ExecutionRequest, extra?: Record<string, unknown>) {
  try {
    consumeCapabilityToken(request.capabilityTokenId, request.agentId);
  } catch (error) {
    deny(request, "TOKEN_REPLAY", error instanceof Error ? error.message : "capability token could not be consumed", extra);
  }
}

function linkProvenance(request: ExecutionRequest, context: ExecutionContext) {
  if (!request.runId) return;
  addProvenanceNode({id: request.runId, kind: "RUN", label: request.runId, runId: request.runId});
  addProvenanceNode({id: context.task.taskId, kind: "TASK", label: context.task.title});
  addProvenanceNode({id: context.sandbox.sandboxId, kind: "SANDBOX", label: context.sandbox.type});
  addProvenanceNode({id: context.token.id, kind: "CAPABILITY", label: context.token.id});
  addProvenanceEdge({from: request.runId, to: context.token.id, relation: "AUTHORIZED_BY"});
  addProvenanceEdge({from: request.runId, to: context.sandbox.sandboxId, relation: "EXECUTED_IN"});
  addProvenanceEdge({from: request.runId, to: context.task.taskId, relation: "CAUSED_BY"});
}

/**
 * Gemeinsamer Abschluss eines autorisierten Laufs: Ergebnisereignis, Audit,
 * digest-gebundene Evidenz und Provenance. Beide Ausführungswege (Prozess und
 * Computer Use) enden hier, damit kein Weg ohne Evidenz möglich ist.
 */
function finalizeExecution(input: {
  request: ExecutionRequest;
  context: ExecutionContext;
  result: ExecutionResult;
  artifactKind: string;
  artifactName: string;
  isolation: string;
  extraEvidence?: Record<string, unknown>;
}): ExecutionResult {
  const {request, context, result} = input;
  const {sandbox, token} = context;

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
    argumentsValue: {exitCode: result.exitCode, durationMs: result.durationMs, timedOut: result.timedOut, ...(input.extraEvidence ?? {})}
  });

  recordAudit({actor: request.agentId, action: "sandbox.execute", resource: sandbox.sandboxId, decision: result.accepted ? "ALLOW" : "ERROR"}, {
    taskId: request.taskId,
    argv: request.argv,
    exitCode: result.exitCode
  });

  // 18. Evidenz: Das Ergebnis wird digest-gebunden und persistent festgehalten.
  // Der Digest wird im Evidenzmodul über den gespeicherten Inhalt gebildet —
  // stdout/stderr sind damit nachprüfbar, nicht bloß protokolliert.
  const content = JSON.stringify(
    {
      ...JSON.parse(
        executionEvidenceContent({
          taskId: request.taskId,
          agentId: request.agentId,
          sandboxId: request.sandboxId,
          runId: request.runId,
          environment: context.environment,
          argv: request.argv,
          accepted: result.accepted,
          exitCode: result.exitCode,
          stdout: result.stdout,
          stderr: result.stderr,
          timedOut: result.timedOut,
          durationMs: result.durationMs,
          isolation: input.isolation
        })
      ),
      ...(input.extraEvidence ?? {})
    },
    null,
    2
  );
  const artifact = recordArtifact(
    {
      name: input.artifactName,
      kind: input.artifactKind,
      taskId: request.taskId,
      runId: request.runId ?? "",
      sandboxId: request.sandboxId,
      agentId: request.agentId,
      knowledgeState: "OBSERVED",
      contentType: "application/json"
    },
    content
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

export async function executeAuthorized(request: ExecutionRequest): Promise<ExecutionResult> {
  const context = authorizeExecution(request, ["task:execute", "sandbox:run"]);
  consumeTokenFor(request);
  linkProvenance(request, context);

  const {task, sandbox, token} = context;
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
    argumentsValue: {argv: request.argv, environment: context.environment, ...(request.purpose ? {purpose: request.purpose} : {})}
  });

  // 17. Execution Gate erlaubt die Aktion (bereits geprüft) → Ausführung.
  const result = await activeSandboxRuntime.execute(request.sandboxId, request.argv, request.timeoutMs);

  return finalizeExecution({
    request,
    context,
    result,
    artifactKind: "EXECUTION",
    artifactName: `Ausführung ${task.taskId} in ${sandbox.sandboxId}`,
    isolation: result.isolation ?? "FILESYSTEM_ONLY"
  });
}

/* ----------------------------------------------------------- Computer Use */

/**
 * Computer Use über den Broker (Abschnitt 21).
 *
 * Ein Computer führt **nur** über diesen Weg aus. Die Autorisierung ist exakt
 * die der Prozessausführung, ergänzt um die Fähigkeit `computer:execute`, und
 * wird zusätzlich an die Allokation gebunden (Task/Sandbox). Es gibt keinen
 * direkten Treiberaufruf aus der Oberfläche oder aus einem Agenten heraus.
 *
 * Der Treiber ist ein Node-Modul, das **eine** Aktion als JSON über stdin
 * erhält und sein Ergebnis als JSON auf stdout schreibt. Ausgeführt wird er mit
 * `argv[]` und `shell:false` — kein Shell-String, keine Interpretation von
 * Eingaben durch eine Shell. Fehlt ein Treiber, wird die Aktion **nicht** als
 * ausgeführt gemeldet (fail closed).
 */

const COMPUTER_ACTIONS = new Set<ComputerUseAction>([
  "NAVIGATE",
  "CLICK",
  "TYPE",
  "SELECT",
  "SCREENSHOT",
  "OCR",
  "PROCESS_READ",
  "FILE_READ",
  "TERMINAL_EXECUTE"
]);

export type ComputerExecutionRequest = {
  taskId: string;
  agentId: string;
  sandboxId: string;
  capabilityTokenId: string;
  computerId: string;
  computerAction: ComputerUseAction;
  computerInput?: Record<string, unknown>;
  runId?: string;
  approvalId?: string;
  experimentId?: string;
  environment?: string;
  timeoutMs?: number;
};

export type ComputerExecutionResult = ExecutionResult & {
  /** Ergebnis der Computer-Aktion (`SUCCEEDED`/`FAILED`) — nie „ausgeführt" ohne Prozess. */
  status: "SUCCEEDED" | "FAILED";
  computerId: string;
  action: ComputerUseAction;
};

const COMPUTER_MAX_INPUT_BYTES = 8192;
const COMPUTER_MAX_OUTPUT_BYTES = 200_000;

function computerDriverPath(request: Partial<ExecutionRequest>, extra: Record<string, unknown>): string {
  const driver = process.env.BOB_COMPUTER_DRIVER ?? "";
  if (!driver) deny(request, "COMPUTER_DRIVER", "no computer driver is configured (BOB_COMPUTER_DRIVER); refusing to report a simulated action as executed", extra);
  if (!path.isAbsolute(driver)) deny(request, "COMPUTER_DRIVER", "the computer driver must be an absolute path", extra);
  if (isShellInterpreter(driver)) deny(request, "COMPUTER_DRIVER", "a shell interpreter may not act as computer driver", extra);
  let stat: fs.Stats;
  try {
    stat = fs.statSync(driver);
  } catch {
    deny(request, "COMPUTER_DRIVER", `computer driver not found: ${driver}`, extra);
  }
  if (!stat.isFile()) deny(request, "COMPUTER_DRIVER", "the computer driver must be a regular file", extra);
  if (!/\.(mjs|cjs|js)$/.test(driver)) deny(request, "COMPUTER_DRIVER", "the computer driver must be a node module (.mjs/.cjs/.js)", extra);
  return driver;
}

/** Führt den Treiber aus: argv[], shell:false, Timeout mit Gruppen-Kill, Ausgabegrenze. */
function runComputerDriver(driver: string, payload: unknown, timeoutMs: number): Promise<ExecutionResult> {
  return new Promise(resolve => {
    const started = Date.now();
    const child = spawn(process.execPath, [driver], {
      shell: false,
      detached: true,
      cwd: path.dirname(driver),
      // Reduzierte Umgebung: keine Secrets, kein Provider-Zugang, kein Netz-Proxy.
      env: {PATH: "/usr/bin:/bin", NODE_ENV: "production", BOB_COMPUTER_EXECUTION: "1"},
      stdio: ["pipe", "pipe", "pipe"]
    });
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    let settled = false;
    const limit = (text: string, chunk: string) => (text.length >= COMPUTER_MAX_OUTPUT_BYTES ? text : (text + chunk).slice(0, COMPUTER_MAX_OUTPUT_BYTES));

    child.stdout.on("data", chunk => {
      stdout = limit(stdout, String(chunk));
    });
    child.stderr.on("data", chunk => {
      stderr = limit(stderr, String(chunk));
    });

    const timer = setTimeout(() => {
      timedOut = true;
      try {
        if (child.pid) process.kill(-child.pid, "SIGKILL");
        else child.kill("SIGKILL");
      } catch {
        child.kill("SIGKILL");
      }
    }, timeoutMs);

    const finish = (exitCode: number | null, message: string, spawnError?: string) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      const failureDetail = spawnError ? `${message}: ${spawnError}` : message;
      resolve({
        accepted: !timedOut && exitCode === 0 && !spawnError,
        exitCode,
        stdout,
        stderr: spawnError ? `${stderr}${stderr ? "\n" : ""}${spawnError}` : stderr,
        timedOut,
        durationMs: Date.now() - started,
        message: timedOut ? `computer driver timed out after ${timeoutMs}ms` : failureDetail
      });
    };

    child.on("error", error => finish(null, "computer driver could not be started", error.message));
    child.on("close", (code, signal) => finish(code, signal ? `computer driver terminated by ${signal}` : `computer driver exited with code ${code ?? "null"}`));
    child.stdin.on("error", () => {
      /* Ein geschlossener stdin darf den Lauf nicht in einen unbeendeten Zustand bringen. */
    });
    child.stdin.end(JSON.stringify(payload));
  });
}

export async function executeComputerAuthorized(request: ComputerExecutionRequest): Promise<ComputerExecutionResult> {
  if (!request || typeof request !== "object") deny({}, "REQUEST_SHAPE", "malformed computer execution request");
  if (typeof request.computerId !== "string" || request.computerId.length === 0) deny({}, "COMPUTER_ID", "computerId is required");
  if (!COMPUTER_ACTIONS.has(request.computerAction)) deny({}, "COMPUTER_ACTION", `unsupported computer action: ${String(request.computerAction)}`);
  const input = request.computerInput ?? {};
  if (typeof input !== "object" || Array.isArray(input)) deny({}, "COMPUTER_INPUT", "computerInput must be an object");
  if (Buffer.byteLength(JSON.stringify(input), "utf8") > COMPUTER_MAX_INPUT_BYTES) deny({}, "COMPUTER_INPUT", "computerInput exceeds the allowed size");

  const extra = {computerId: request.computerId, computerAction: request.computerAction};
  const normalized: ExecutionRequest = {
    taskId: request.taskId,
    agentId: request.agentId,
    sandboxId: request.sandboxId,
    capabilityTokenId: request.capabilityTokenId,
    argv: ["COMPUTER_USE", request.computerAction],
    ...(request.runId ? {runId: request.runId} : {}),
    ...(request.approvalId ? {approvalId: request.approvalId} : {}),
    ...(request.experimentId ? {experimentId: request.experimentId} : {}),
    ...(request.environment ? {environment: request.environment} : {}),
    ...(request.timeoutMs === undefined ? {} : {timeoutMs: request.timeoutMs})
  } as ExecutionRequest;

  // Gemeinsame Autorisierung — inklusive der Fähigkeit `computer:execute`.
  const context = authorizeExecution(normalized, ["task:execute", "sandbox:run", "computer:execute"], extra);

  // Domänenbindung: Autorisierung, Task, Sandbox, Zustand, Netzwerk, Aktion.
  // Bewusst **vor** dem Verbrauch des Tokens: Eine falsch gebundene Anfrage darf
  // keine Autorisierung verbrauchen.
  try {
    assertComputerBinding(request.computerId, request.taskId, request.sandboxId, request.computerAction);
  } catch (error) {
    deny(normalized, "COMPUTER_BINDING", error instanceof Error ? error.message : "computer binding rejected", extra);
  }

  const driver = computerDriverPath(normalized, extra);
  claimComputerExecution(request.computerId, request.taskId, request.sandboxId, request.computerAction);
  consumeTokenFor(normalized, extra);
  linkProvenance(normalized, context);

  const {task, sandbox, token} = context;
  observe({
    type: "computer.authorized",
    message: `Computer Use autorisiert: ${request.computerAction} auf ${request.computerId}`,
    status: "EXECUTING",
    actor: request.agentId,
    agentId: request.agentId,
    taskId: request.taskId,
    runId: request.runId,
    sandboxId: request.sandboxId,
    action: "computer.execute",
    resource: request.computerId,
    decision: "ALLOW",
    authorizationRef: token.id,
    argumentsValue: {computerId: request.computerId, computerAction: request.computerAction, environment: context.environment}
  });

  const handle = runtimeHandle(request.sandboxId);
  const timeoutMs = Math.max(1_000, Math.min(request.timeoutMs ?? handle?.limits.timeoutMs ?? 60_000, MAX_RESOURCE_LIMITS.timeoutMs));
  const result = await runComputerDriver(
    driver,
    {
      computerId: request.computerId,
      action: request.computerAction,
      input,
      taskId: task.taskId,
      sandboxId: sandbox.sandboxId,
      agentId: request.agentId,
      runId: request.runId ?? null
    },
    timeoutMs
  );
  completeComputerExecution(request.computerId, result.accepted);

  const finalized = finalizeExecution({
    request: normalized,
    context,
    result,
    artifactKind: "COMPUTER_USE",
    artifactName: `Computer Use ${request.computerAction} auf ${request.computerId}`,
    isolation: handle?.isolation ?? "FILESYSTEM_ONLY",
    extraEvidence: {computerId: request.computerId, computerAction: request.computerAction}
  });

  return {
    ...finalized,
    status: result.accepted ? "SUCCEEDED" : "FAILED",
    computerId: request.computerId,
    action: request.computerAction
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
