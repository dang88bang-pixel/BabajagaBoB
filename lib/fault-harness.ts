import {execFile} from "node:child_process";
import {getControlState, createMission, createObjective, createTask} from "./control-plane";
import * as fabric from "./sandbox/fabric";
import * as runs from "./runs";
import {issueCapabilityToken} from "./authority";
import {executeAuthorized} from "./execution-broker";

/**
 * Hilfsmittel für Fehlerinjektion (Abschnitt 37 / TEST-003).
 *
 * Diese Datei ist **kein** Mock: Sie baut dieselbe Kette auf, die auch die
 * echten Abnahmetests fahren — Mission → Objective → Task → Sandbox →
 * Capability → Broker → Runtime — und führt das Programm wirklich aus.
 * Fehlerinjektion muss gegen die reale Ausführung messen, sonst belegt sie
 * nichts.
 */

export const FAULT_AGENT = "AG-BUILD";

export type SandboxContext = {
  taskId: string;
  sandboxId: string;
  agentId: string;
  tokenId: string;
  runId: string;
  fabric: typeof fabric;
};

/** Baut die vollständige, autorisierte Ausführungskette für eine Injektion auf. */
export async function buildSandboxContext(label: string): Promise<SandboxContext> {
  const mission = createMission({title: `Fehlerinjektion ${label}`, objective: "Nachweisen, dass echte Störungen erkannt werden", createdBy: "CREATOR"});
  const objective = createObjective({missionId: mission.missionId, title: label, description: "Fehlerinjektion"});
  const task = createTask({missionId: mission.missionId, objectiveId: objective.objectiveId, title: `Injektion ${label}`, risk: "LOW", assignedAgent: FAULT_AGENT, createdBy: "CREATOR"});
  const sandbox = await fabric.createSandbox({type: "test", taskId: task.taskId, agentId: FAULT_AGENT, risk: "LOW"});
  await fabric.startSandbox(sandbox.sandboxId);
  const run = runs.createRun({taskId: task.taskId, agentId: FAULT_AGENT, risk: "LOW", sandboxId: sandbox.sandboxId});
  const issued = issueCapabilityToken({
    subject: FAULT_AGENT,
    taskId: task.taskId,
    sandboxId: sandbox.sandboxId,
    environment: "test",
    capabilities: ["task:execute", "sandbox:run"],
    risk: "LOW",
    issuedBy: "CREATOR",
    issuedByKind: "CREATOR",
    expiresAt: new Date(Date.now() + 5 * 60_000).toISOString()
  });
  return {taskId: task.taskId, sandboxId: sandbox.sandboxId, agentId: FAULT_AGENT, tokenId: issued.token.id, runId: run.runId, fabric};
}

export type SandboxedProgramResult = {
  accepted: boolean;
  exitCode: number | null;
  message: string;
  durationMs: number;
  timedOut: boolean;
  evidenceArtifactId: string | null;
  evidenceDigest: string | null;
  stdout: string;
  stderr: string;
};

/**
 * Führt ein Programm in einer echten Sandbox über den Broker aus.
 * Der Aufruf geht durch Gate → Broker → Runtime; es gibt keinen Nebenweg.
 */
export async function runSandboxedProgram(argv: string[], label = "process-abort"): Promise<SandboxedProgramResult> {
  const context = await buildSandboxContext(label);
  const result = await executeAuthorized({
    taskId: context.taskId,
    agentId: context.agentId,
    sandboxId: context.sandboxId,
    capabilityTokenId: context.tokenId,
    runId: context.runId,
    environment: "test",
    argv
  });
  return {
    accepted: result.accepted,
    exitCode: result.exitCode ?? null,
    message: result.message,
    durationMs: result.durationMs ?? 0,
    timedOut: Boolean(result.timedOut),
    evidenceArtifactId: result.evidence?.artifactId ?? null,
    evidenceDigest: result.evidence?.digest ?? null,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? ""
  };
}

/**
 * Führt ein **Kindprozess**-Programm aus und bricht es ab. Damit lässt sich ein
 * echter Prozessabsturz außerhalb der Sandbox prüfen (z. B. „stirbt der
 * Prüfprozess, bleibt die Datei trotzdem integer?"). Der Rückgabewert enthält
 * Signal und Exit-Code so, wie das Betriebssystem sie meldet.
 */
export function spawnAndAbort(command: string, args: string[], signal: NodeJS.Signals, killAfterMs: number): Promise<{signal: string | null; code: number | null; stderr: string}> {
  return new Promise(resolve => {
    const child = execFile(command, args, {timeout: 30_000}, (error, _stdout, stderr) => {
      const typed = error as (Error & {signal?: string; code?: number}) | null;
      resolve({signal: typed?.signal ?? null, code: typeof typed?.code === "number" ? typed.code : null, stderr: String(stderr ?? "")});
    });
    setTimeout(() => child.kill(signal), killAfterMs).unref?.();
  });
}

/** Aktueller Zustand der Control Plane — für Prüfungen nach der Injektion. */
export function controlSnapshot() {
  return getControlState();
}
