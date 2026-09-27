import crypto from "node:crypto";
import fs from "node:fs";
import childProcess from "node:child_process";
import path from "node:path";
import {getControlState} from "./control-plane";
import {executionGate} from "./execution-gate";
import {capabilityTokens, consumeCapabilityToken, validateCapabilityToken, type CapabilityToken} from "./authority";
import {recordAudit} from "./audit";
import {executionEvidenceContent, recordArtifact, verifyArtifact} from "./artifacts";
import {activeSandboxRuntime, runtimeHandle} from "./runtime-factory";
import {observe} from "./observability";
import {addProvenanceEdge, addProvenanceNode} from "./provenance";
import {egressAvailable} from "./egress-proxy";
import {MAX_ARGV_LENGTH, firstMetacharacterArg, isShellInterpreter} from "./argv-policy";
import {listComputers, type ComputerCapability, type ComputerInstance, type ComputerUseAction} from "./computer-use";
import type {ExecutionResult} from "./runtime";
import type {Agent, Risk, Sandbox, Task} from "./types";

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
    argumentsValue: {check, reason, ...argvFingerprint(request.argv)}
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

/**
 * Ergebnis der gemeinsamen Autorisierungsprüfungen.
 *
 * Der Kontext ist das einzige, was nach den Prüfungen 1–16 an die eigentliche
 * Ausführung weitergereicht wird. Er ist absichtlich schmal: Task, Agent,
 * Sandbox, Token und die **tatsächlich** gültige Umgebung.
 */
export type AuthorizedContext = {
  task: Task;
  agent: Agent;
  sandbox: Sandbox;
  token: CapabilityToken;
  environment: string;
};

/**
 * Autorisierungsprüfungen 1–16 (ohne Ausführung).
 *
 * Die Funktion ist der gemeinsame Vorhof beider Ausführungspfade (Sandbox und
 * Computer Use). Kein Pfad darf sie umgehen: Wer sie nicht durchläuft, hat
 * keine Bindungs-, Gate-, Netzwerk- und Ressourcenprüfung hinter sich.
 *
 * `extraCapabilities` verlangt zusätzlich zur Ausführungsbasis
 * (`task:execute`, `sandbox:run`) eine fachliche Fähigkeit im Token —
 * z. B. `computer:execute`. Ohne sie bleibt die Aktion verweigert.
 */
/**
 * argv-Prüfung vor jeder weiteren Autorisierung (Prüfungen 1./2.).
 *
 * Diese Funktion ist der **einzige** Ort, an dem Shell-Interpreter und
 * Shell-Metazeichen im Broker geprüft werden — jeder Ausführungspfad ruft sie
 * auf, damit kein Pfad eine eigene (schwächere) Kopie der Regel besitzt. Der
 * Sabotagekatalog (`BROKER_SHELL_GUARD_SKIPPED`) prüft, dass genau dieser Anker
 * existiert; eine zweite Kopie würde den Nachweis entwerten.
 */
function assertArgvAuthorized(request: ExecutionRequest, shapeCheck: string): void {
  if (!request || typeof request !== "object") deny({}, "REQUEST_SHAPE", shapeCheck);
  if (!Array.isArray(request.argv) || request.argv.length === 0) deny(request, "ARGV", "execution argv must not be empty");
  if (request.argv.some(arg => typeof arg !== "string" || arg.length === 0 || arg.length > MAX_ARGV_LENGTH)) deny(request, "ARGV", "invalid execution argument");
  // Keine Shell-Strings: Shell-Interpreter und Metazeichen werden vor jeder
  // weiteren Prüfung auditiert verweigert (argv[] + shell:false bleibt erzwungen).
  if (isShellInterpreter(request.argv[0])) deny(request, "SHELL_PROGRAM", `shell interpreter '${request.argv[0]}' is forbidden`);
  const metacharIndex = firstMetacharacterArg(request.argv);
  if (metacharIndex !== null) deny(request, "SHELL_METACHAR", `shell metacharacters are forbidden in argv[${metacharIndex}]`);
}

function authorizeContext(request: ExecutionRequest, extraCapabilities: string[] = []): AuthorizedContext {
  assertArgvAuthorized(request, "malformed execution request");

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
  const validation = validateCapabilityToken(request.capabilityTokenId, ["task:execute", "sandbox:run", ...extraCapabilities], {
    subject: request.agentId,
    taskId: request.taskId,
    sandboxId: request.sandboxId,
    risk: task.risk
  });
  if (!validation.valid) deny(request, "TOKEN_VALIDATION", validation.reason);
  if (token.subject !== request.agentId) deny(request, "TOKEN_SUBJECT", "token subject mismatch");
  for (const capability of extraCapabilities) {
    if (!token.capabilities.includes(capability)) deny(request, "TOKEN_CAPABILITY", `token lacks capability ${capability}`);
  }
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

  /**
   * 15. Netzwerkpolicy: `DENY` ist Standard.
   *
   * `ALLOWLIST` ist nur mit einer kontrollierten Ausgangsschicht zulässig
   * (`lib/egress-proxy.ts`): Ohne konfigurierte Allowlist bleibt die Ausführung
   * verweigert, damit keine Sandbox auf einem Weg ins Netz kommt, der nicht
   * geprüft wird. Der Proxy selbst entscheidet je Ziel und auditiert jede
   * Entscheidung zusätzlich.
   */
  const handle = runtimeHandle(request.sandboxId);
  const allowlistRequested = sandbox.network === "ALLOWLIST" || handle?.network.mode === "ALLOWLIST";
  if (allowlistRequested && !egressAvailable()) {
    deny(request, "NETWORK_POLICY", "ALLOWLIST networking is fail-closed: no controlled egress layer is configured");
  }

  // 16. Ressourcenlimits müssen innerhalb der Policy-Grenzen liegen.
  const limits = handle?.limits;
  if (limits) {
    if (limits.timeoutMs <= 0 || limits.timeoutMs > MAX_RESOURCE_LIMITS.timeoutMs) deny(request, "RESOURCE_LIMITS", "timeout outside allowed range");
    if (limits.memoryMb <= 0 || limits.memoryMb > MAX_RESOURCE_LIMITS.memoryMb) deny(request, "RESOURCE_LIMITS", "memory outside allowed range");
    if (limits.cpuMillicores <= 0 || limits.cpuMillicores > MAX_RESOURCE_LIMITS.cpuMillicores) deny(request, "RESOURCE_LIMITS", "cpu outside allowed range");
    if (limits.processes <= 0 || limits.processes > MAX_RESOURCE_LIMITS.processes) deny(request, "RESOURCE_LIMITS", "process limit outside allowed range");
  }

  return {task, agent, sandbox, token, environment};
}

/** Verbraucht das Token **vor** der Ausführung (Replay-Sperre, Prüfung 16b). */
function consumeToken(request: ExecutionRequest): void {
  // Wiederholungssperre: Das Token wird **vor** der Ausführung verbraucht.
  // Eine Autorisierung = eine Ausführung; ein zweiter Lauf mit demselben Token
  // ist ein Replay und wird verweigert (Audit + Verweigerungsevidenz).
  try {
    consumeCapabilityToken(request.capabilityTokenId, request.agentId);
  } catch (error) {
    deny(request, "TOKEN_REPLAY", error instanceof Error ? error.message : "capability token could not be consumed");
  }
}

/** Verankert Run, Task, Sandbox und Token in der Provenance (Prüfung 17). */
function anchorProvenance(request: ExecutionRequest, context: AuthorizedContext): void {
  const {task, sandbox, token, environment} = context;
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
    purpose: request.purpose,
    argumentsValue: {argv: request.argv, environment, ...(request.purpose ? {purpose: request.purpose} : {})}
  });
}

/**
 * Autorisierte Ausführung in der Sandbox-Runtime (Abschnitt 10).
 *
 * Prüfungen 1–16, Replay-Sperre, Provenance, Ausführung, Evidenz. Wer diesen
 * Weg verlässt, hat keine Autorisierung — deshalb ist er der einzige Pfad in
 * die Runtime.
 */
export async function executeAuthorized(request: ExecutionRequest): Promise<ExecutionResult> {
  const context = authorizeContext(request);
  consumeToken(request);
  anchorProvenance(request, context);
  const {task, sandbox, token, environment} = context;

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
      durationMs: result.durationMs,
      isolation: result.isolation
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

/* ============================================================== Computer Use */

/**
 * Computer Use über denselben Broker (Abschnitt 24).
 *
 * Computer-Aktionen sind **Ausführungen**: sie bekommen Prozesse, sehen
 * Bildschirminhalte und berühren fremde Daten. Deshalb laufen sie nicht über
 * eine eigene Steuerungsschicht, sondern durch exakt denselben Weg wie jede
 * Sandbox-Ausführung (Prüfungen 1–16, Replay-Sperre, Provenance, Evidenz).
 *
 * Zusätzlich gelten Computer-Prüfungen, bevor ein Treiber überhaupt startet:
 *
 *   COMPUTER_EXISTS      – Instanz existiert
 *   COMPUTER_AUTHORIZED  – Creator hat sie autorisiert (Discovery ≠ Autorisierung)
 *   COMPUTER_STATE       – sie ist diesem Lauf zugeordnet (ALLOCATED/EXECUTING)
 *   COMPUTER_BINDING     – Task und Sandbox stimmen überein (keine Fremdnutzung)
 *   COMPUTER_ACTION      – die Aktion ist in den Fähigkeiten der Instanz
 *   COMPUTER_ENVIRONMENT – die Umgebung ist für die Aktion zugelassen
 *   COMPUTER_NETWORK     – die Aktion verlangt nicht mehr Netz als die Sandbox hat
 *   COMPUTER_RISK        – das Risiko der Aktion bleibt im Rahmen der Task
 *   COMPUTER_DRIVER      – ein Treiber ist konfiguriert (sonst fail closed)
 *
 * **Treiber-Vertrag** (`BOB_COMPUTER_DRIVER`):
 *
 *   - absoluter Pfad zu einer ausführbaren Datei oder zu einem Node-Modul
 *     (`.mjs`/`.cjs`/`.js`, dann mit `process.execPath` gestartet);
 *   - Start als `argv[]` mit `shell:false`, ohne Umgebungsvererbung;
 *   - Aktion als JSON über **stdin**, Antwort als JSON über **stdout**
 *     (`{"ok": true}` bzw. `{"ok": false, "error": "…"}`);
 *     antwortet der Treiber nicht im JSON-Format, entscheidet der Exit-Code;
 *   - harte Zeitgrenze (aus den Sandbox-Limits), danach `SIGKILL`;
 *   - relativer Pfad, fehlende Datei, Shell-Interpreter → **keine** Ausführung.
 *
 * Ohne konfigurierten Treiber ist Computer Use damit nicht „simuliert“, sondern
 * verweigert: Es gibt keinen Pfad, der eine Aktion vortäuscht.
 */

export type ComputerExecutionRequest = ExecutionRequest & {
  computerId: string;
  computerAction: ComputerUseAction;
  /** Fachliche Eingabe der Aktion (Ziel, Text, Selektor …) als JSON-Daten. */
  computerInput?: Record<string, unknown>;
};

export type ComputerExecutionResult = ExecutionResult & {
  status: "SUCCEEDED" | "FAILED" | "TIMEOUT";
  computer: {
    computerId: string;
    kind: string;
    action: ComputerUseAction;
    driver: string;
    /** Vom Treiber zurückgegebene Antwort (nur wenn als JSON lesbar). */
    response: Record<string, unknown> | null;
  };
};

const COMPUTER_MAX_OUTPUT = 200_000;
const COMPUTER_MAX_INPUT_BYTES = 64 * 1024;
const COMPUTER_DEFAULT_TIMEOUT_MS = 60_000;

/**
 * Zustand des Treibers — für Oberfläche und Betrieb, ohne Geheimnisse.
 *
 * `configured: false` heißt: Computer Use ist **nicht** ausführbar. Das ist der
 * Default dieser Umgebung (kein Browser-/Desktop-Treiber angebunden).
 */
export function computerDriverStatus(): {configured: boolean; driver: string | null; reason: string} {
  const configured = (process.env.BOB_COMPUTER_DRIVER ?? "").trim();
  if (configured.length === 0) {
    return {configured: false, driver: null, reason: "BOB_COMPUTER_DRIVER ist nicht gesetzt — Computer Use bleibt verweigert (fail closed)."};
  }
  if (!path.isAbsolute(configured)) {
    return {configured: false, driver: null, reason: "BOB_COMPUTER_DRIVER muss ein absoluter Pfad sein."};
  }
  if (isShellInterpreter(configured)) {
    return {configured: false, driver: null, reason: "BOB_COMPUTER_DRIVER darf kein Shell-Interpreter sein."};
  }
  if (!fs.existsSync(configured) || !fs.statSync(configured).isFile()) {
    return {configured: false, driver: null, reason: "BOB_COMPUTER_DRIVER zeigt auf keine vorhandene Datei."};
  }
  return {configured: true, driver: configured, reason: "Treiber konfiguriert."};
}

/** Löst den Treiber in ein `argv[]` auf (`shell:false`, keine Shell-Auflösung). */
function resolveComputerDriver(): {argv: string[]; driver: string} | null {
  const status = computerDriverStatus();
  if (!status.configured || !status.driver) return null;
  const driver = status.driver;
  if (/\.(mjs|cjs|js)$/i.test(driver)) return {argv: [process.execPath, driver], driver};
  return {argv: [driver], driver};
}

/** Fähigkeit der Instanz, die die angeforderte Aktion trägt (sonst `undefined`). */
function computerCapabilityFor(instance: ComputerInstance, action: ComputerUseAction): ComputerCapability | undefined {
  return instance.capabilities.find(capability => capability.actions.includes(action));
}

type DriverOutcome = ExecutionResult & {response: Record<string, unknown> | null};

/**
 * Startet den Treiber als echten Prozess — ohne Shell, mit Zeitgrenze und
 * begrenzter Ausgabe. Daten gehen ausschließlich über stdin/stdout (JSON).
 */
function runComputerDriver(
  argv: string[],
  payload: Record<string, unknown>,
  options: {cwd: string; timeoutMs: number; sandboxId: string; computerId: string}
): Promise<DriverOutcome> {
  const started = Date.now();
  const input = JSON.stringify(payload);
  if (Buffer.byteLength(input, "utf8") > COMPUTER_MAX_INPUT_BYTES) {
    return Promise.resolve({
      accepted: false,
      exitCode: null,
      stdout: "",
      stderr: "",
      timedOut: false,
      durationMs: 0,
      message: `Aktionseingabe überschreitet ${COMPUTER_MAX_INPUT_BYTES} Bytes`,
      response: null
    });
  }
  return new Promise<DriverOutcome>(resolve => {
    const child = childProcess.spawn(argv[0], argv.slice(1), {
      cwd: options.cwd,
      shell: false,
      stdio: ["pipe", "pipe", "pipe"],
      env: {
        PATH: process.env.PATH ?? "/usr/bin:/bin",
        HOME: options.cwd,
        LANG: "C.UTF-8",
        NODE_ENV: process.env.NODE_ENV ?? "production",
        BOB_SANDBOX: options.sandboxId,
        BOB_COMPUTER: options.computerId
      }
    });
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    let settled = false;
    const finish = (outcome: DriverOutcome) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(outcome);
    };
    const timer = setTimeout(() => {
      timedOut = true;
      // Prozessgruppe zuerst: verwaiste Kindprozesse wären sonst eine
      // Hintertür an der Zeitgrenze vorbei.
      try {
        process.kill(-child.pid!, "SIGKILL");
      } catch {
        child.kill("SIGKILL");
      }
      finish({
        accepted: false,
        exitCode: null,
        stdout,
        stderr,
        timedOut: true,
        durationMs: Date.now() - started,
        message: `Treiber überschritt die Zeitgrenze von ${options.timeoutMs}ms`,
        response: null
      });
    }, options.timeoutMs);
    child.stdout?.on("data", chunk => (stdout = (stdout + String(chunk)).slice(-COMPUTER_MAX_OUTPUT)));
    child.stderr?.on("data", chunk => (stderr = (stderr + String(chunk)).slice(-COMPUTER_MAX_OUTPUT)));
    child.once("error", error => {
      finish({
        accepted: false,
        exitCode: null,
        stdout,
        stderr,
        timedOut: false,
        durationMs: Date.now() - started,
        message: `Treiber konnte nicht gestartet werden: ${error.message}`,
        response: null
      });
    });
    child.once("close", code => {
      const durationMs = Date.now() - started;
      let response: Record<string, unknown> | null = null;
      const trimmed = stdout.trim();
      if (trimmed.length > 0) {
        try {
          const parsed = JSON.parse(trimmed) as unknown;
          if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) response = parsed as Record<string, unknown>;
        } catch {
          // Kein JSON: die Aktion wird über den Exit-Code bewertet, nicht
          // stillschweigend als Erfolg gewertet.
          response = null;
        }
      }
      const ok = typeof response?.ok === "boolean" ? response.ok : code === 0;
      finish({
        accepted: ok && code === 0 && !timedOut,
        exitCode: code,
        stdout,
        stderr,
        timedOut: false,
        durationMs,
        message:
          code === 0
            ? typeof response?.error === "string" && response.error.length > 0
              ? response.error
              : "Computer-Aktion ausgeführt"
            : `Treiber endete mit Exit-Code ${code}${stderr.trim() ? `: ${stderr.trim().slice(0, 200)}` : ""}`,
        response
      });
    });
    child.stdin?.on("error", () => {
      /* Treiber hat stdin geschlossen — das Ergebnis kommt über stdout/Exit. */
    });
    child.stdin?.end(input);
  });
}

/**
 * Autorisierte Computer-Aktion (Browser/Desktop/CLI) über den Broker.
 *
 * Alle Verweigerungen — auch die Computer-spezifischen — gehen durch `deny()`
 * und erzeugen damit Ereignis, Audit und Verweigerungsevidenz.
 */
export async function executeComputerAuthorized(request: ComputerExecutionRequest): Promise<ComputerExecutionResult> {
  // Dieselbe argv-Regel wie jeder andere Ausführungspfad — keine eigene Kopie.
  assertArgvAuthorized(request, "malformed computer execution request");
  if (typeof request.computerId !== "string" || request.computerId.trim().length === 0) deny(request, "COMPUTER_ID", "computerId is required");
  if (typeof request.computerAction !== "string" || request.computerAction.trim().length === 0) deny(request, "COMPUTER_ACTION", "computerAction is required");

  // 1–16: dieselben Prüfungen wie jede Ausführung, zusätzlich mit der
  // fachlichen Fähigkeit `computer:execute` im Token.
  const context = authorizeContext(request, ["computer:execute"]);
  const {task, sandbox, token, environment} = context;

  // Computer-Prüfungen (vor Verbrauch des Tokens: eine Fremdbindung darf kein
  // gültiges Token verbrauchen).
  const instance = listComputers().find(entry => entry.id === request.computerId);
  if (!instance) deny(request, "COMPUTER_EXISTS", `computer not found: ${request.computerId}`);
  if (!instance.authorized) deny(request, "COMPUTER_AUTHORIZED", `computer ${instance.id} is not authorized`);
  if (!["ALLOCATED", "EXECUTING"].includes(instance.state)) {
    deny(request, "COMPUTER_STATE", `computer ${instance.id} is ${instance.state}; allocation is required before execution`);
  }
  if (instance.taskId !== request.taskId) {
    deny(request, "COMPUTER_BINDING", `computer ${instance.id} is allocated to a different task: ${instance.taskId ?? "none"}`);
  }
  if (instance.sandboxId && instance.sandboxId !== request.sandboxId) {
    deny(request, "COMPUTER_BINDING", `computer ${instance.id} is bound to a different sandbox: ${instance.sandboxId}`);
  }
  const capability = computerCapabilityFor(instance, request.computerAction as ComputerUseAction);
  if (!capability) deny(request, "COMPUTER_ACTION", `computer ${instance.id} does not support action ${request.computerAction}`);
  if (capability.environments.length > 0 && !capability.environments.includes(environment)) {
    deny(request, "COMPUTER_ENVIRONMENT", `action ${request.computerAction} is not allowed in environment ${environment}`);
  }
  if (capability.network !== "DENY" && sandbox.network === "DENY") {
    deny(request, "COMPUTER_NETWORK", `action ${request.computerAction} requires network ${capability.network} but the sandbox is DENY`);
  }
  if (riskRank[capability.risk] > riskRank[task.risk]) {
    deny(request, "COMPUTER_RISK", `action ${request.computerAction} is rated ${capability.risk} and exceeds task risk ${task.risk}`);
  }
  const driver = resolveComputerDriver();
  if (!driver) deny(request, "COMPUTER_DRIVER", computerDriverStatus().reason);

  consumeToken(request);
  anchorProvenance(request, context);

  const handle = runtimeHandle(request.sandboxId);
  const timeoutMs = Math.min(
    request.timeoutMs ?? handle?.limits.timeoutMs ?? COMPUTER_DEFAULT_TIMEOUT_MS,
    Math.min(handle?.limits.timeoutMs ?? MAX_RESOURCE_LIMITS.timeoutMs, MAX_RESOURCE_LIMITS.timeoutMs)
  );
  const cwd = handle?.workspace ?? process.cwd();
  const outcome = await runComputerDriver(
    driver.argv,
    {
      computerId: instance.id,
      kind: instance.kind,
      action: request.computerAction,
      input: request.computerInput ?? {},
      taskId: request.taskId,
      sandboxId: request.sandboxId,
      runId: request.runId ?? null,
      environment
    },
    {cwd, timeoutMs, sandboxId: request.sandboxId, computerId: instance.id}
  );

  const status: ComputerExecutionResult["status"] = outcome.timedOut ? "TIMEOUT" : outcome.accepted ? "SUCCEEDED" : "FAILED";

  observe({
    type: outcome.accepted ? "computer.executed" : "computer.failed",
    message: outcome.accepted
      ? `Computer ${instance.id}: ${request.computerAction} ausgeführt`
      : `Computer ${instance.id}: ${request.computerAction} fehlgeschlagen — ${outcome.message}`,
    status: outcome.accepted ? "COMPLETED" : "ERROR",
    actor: request.agentId,
    agentId: request.agentId,
    taskId: request.taskId,
    runId: request.runId,
    sandboxId: request.sandboxId,
    action: "computer.execute",
    resource: instance.id,
    decision: outcome.accepted ? "ALLOW" : "ERROR",
    result: outcome.message,
    outputRef: request.runId,
    authorizationRef: token.id,
    argumentsValue: {
      computerId: instance.id,
      action: request.computerAction,
      driver: driver.driver,
      exitCode: outcome.exitCode,
      durationMs: outcome.durationMs,
      timedOut: outcome.timedOut
    }
  });

  recordAudit(
    {actor: request.agentId, action: "computer.execute", resource: instance.id, decision: outcome.accepted ? "ALLOW" : "ERROR"},
    {
      taskId: request.taskId,
      sandboxId: request.sandboxId,
      action: request.computerAction,
      driver: driver.driver,
      exitCode: outcome.exitCode,
      status
    }
  );

  const artifact = recordArtifact(
    {
      name: `Computer ${instance.id}: ${request.computerAction}`,
      kind: "EXECUTION",
      taskId: request.taskId,
      runId: request.runId ?? "",
      sandboxId: request.sandboxId,
      agentId: request.agentId,
      knowledgeState: "OBSERVED",
      contentType: "application/json"
    },
    JSON.stringify(
      {
        // Dieselben Felder wie jede Ausführung (digest-geprüft über stdout/stderr).
        ...(JSON.parse(
          executionEvidenceContent({
            taskId: request.taskId,
            agentId: request.agentId,
            sandboxId: request.sandboxId,
            runId: request.runId,
            environment,
            argv: request.argv,
            accepted: outcome.accepted,
            exitCode: outcome.exitCode,
            stdout: outcome.stdout,
            stderr: outcome.stderr,
            timedOut: outcome.timedOut,
            durationMs: outcome.durationMs
          })
        ) as Record<string, unknown>),
        // … und der Computer-Bezug, damit die Aktion nachvollziehbar bleibt.
        kind: "COMPUTER_USE",
        computerId: instance.id,
        computerKind: instance.kind,
        action: request.computerAction,
        driver: driver.driver,
        status,
        response: outcome.response
      },
      null,
      2
    )
  );
  const anchor = request.runId ?? sandbox.sandboxId;
  addProvenanceNode({id: artifact.id, kind: "EVIDENCE", label: `Computer ${request.computerAction}`, runId: request.runId});
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
    ...outcome,
    status,
    computer: {
      computerId: instance.id,
      kind: instance.kind,
      action: request.computerAction,
      driver: driver.driver,
      response: outcome.response
    },
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
