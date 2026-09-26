import {getControlState} from "./control-plane";
import {issueCapabilityToken} from "./authority";
import {executeAuthorized, type ExecutionRequest} from "./execution-broker";
import type {ExecutionResult} from "./runtime";
import type {Risk} from "./types";

/**
 * Systemautorisierte Ausführung (Abschnitt 10/12/16).
 *
 * Es gibt interne Abläufe, die selbst keine Session und kein Agenten-Token
 * besitzen, aber echte Prozesse brauchen: Regressionstests (Abschnitt 16),
 * Smoke-Tests der Verifikationspipeline (Abschnitt 13) und Prüfläufe der
 * Wiederherstellung.
 *
 * Diese Abläufe dürfen **nicht** an Broker, Gate und Evidenz vorbei ausgeführt
 * werden. Früher riefen sie die Runtime direkt auf — mit der Folge, dass ein
 * aktiver Kill Switch (Lockdown) sie nicht blockierte, keine Autorisierung
 * existierte und keine Evidenz entstand.
 *
 * Deshalb geht jeder solche Lauf durch denselben Weg wie ein Agentenlauf:
 *
 *   SYSTEM-WORKER → kurze Capability (delegiert von CREATOR) → Execution Gate
 *                 → Broker (17 Prüfungen) → isolierte Runtime → Evidenz
 *
 * Die Capability wird aus der `CREATOR → SYSTEM-WORKER`-Delegationskante des
 * Bootstraps abgeleitet. Fehlt diese Kante, schlägt die Ausstellung fehl und es
 * wird **nichts** ausgeführt (fail closed) — es gibt keine Hintertür.
 *
 * Das Subjekt ist der Besitzer der Sandbox (`sandbox.agentId`), nicht ein
 * Fantasie-Agent: die Sandbox bleibt an ihren Agenten und ihren Task gebunden,
 * und die Rolle des Subjekts muss die Fähigkeiten tragen.
 */

export type SystemExecutionRequest = {
  /** Zweck im Klartext — erscheint in Audit, Event und Verweigerungsgrund. */
  purpose: "REGRESSION" | "SMOKE_TEST";
  sandboxId: string;
  argv: string[];
  timeoutMs?: number;
  runId?: string;
};

const PURPOSE_CAPABILITY: Record<SystemExecutionRequest["purpose"], string> = {
  REGRESSION: "regression:run",
  SMOKE_TEST: "sandbox:run"
};

const SYSTEM_ISSUER = "SYSTEM-WORKER";

/**
 * Führt `argv` im Auftrag des Systems aus — aber nur über Gate, Broker und
 * Evidenz. Jede Verweigerung (Lockdown, fehlende Delegation, Bindungsfehler)
 * wirft und wird im Broker als DENY auditiert.
 */
export async function executeSystemAuthorized(request: SystemExecutionRequest): Promise<ExecutionResult> {
  const state = getControlState();
  const sandbox = state.sandboxes.find(entry => entry.sandboxId === request.sandboxId);
  if (!sandbox) throw new Error(`sandbox not found: ${request.sandboxId}`);
  const task = state.tasks.find(entry => entry.taskId === sandbox.taskId);
  if (!task) throw new Error(`task not found for sandbox ${sandbox.sandboxId}: ${sandbox.taskId}`);

  // Kurzlebig und eng gebunden: Subjekt = Sandbox-Besitzer, Task = Sandbox-Task,
  // Umgebung = Sandbox-Typ, genau eine Verwendung (Standard).
  const issued = issueCapabilityToken(
    {
      subject: sandbox.agentId,
      taskId: task.taskId,
      sandboxId: sandbox.sandboxId,
      environment: sandbox.type,
      capabilities: ["task:execute", "sandbox:run", PURPOSE_CAPABILITY[request.purpose]],
      risk: task.risk as Risk,
      issuedBy: SYSTEM_ISSUER,
      issuedByKind: "SYSTEM",
      expiresAt: new Date(Date.now() + 2 * 60_000).toISOString()
    },
    SYSTEM_ISSUER
  );

  const brokerRequest: ExecutionRequest = {
    taskId: task.taskId,
    agentId: sandbox.agentId,
    sandboxId: sandbox.sandboxId,
    capabilityTokenId: issued.token.id,
    environment: sandbox.type,
    argv: request.argv,
    purpose: request.purpose,
    ...(request.runId ? {runId: request.runId} : {}),
    ...(request.timeoutMs === undefined ? {} : {timeoutMs: request.timeoutMs})
  };
  return executeAuthorized(brokerRequest);
}
