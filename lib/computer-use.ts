import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import {spawn} from "node:child_process";
import {createStore} from "./persistence/store";
import {observe} from "./observability";
import type {Risk} from "./types";

export type ComputerUseKind = "BROWSER" | "DESKTOP" | "CLI";
export type ComputerUseAction =
  | "NAVIGATE"
  | "CLICK"
  | "TYPE"
  | "SELECT"
  | "SCREENSHOT"
  | "OCR"
  | "PROCESS_READ"
  | "FILE_READ"
  | "TERMINAL_EXECUTE";
export type ComputerNetwork = "DENY" | "ALLOWLIST" | "INTERNET";
export type ComputerCapability = {
  kind: ComputerUseKind;
  actions: ComputerUseAction[];
  environments: string[];
  network: ComputerNetwork;
  risk: Risk;
};
export type ComputerExecutionLease = {id: string; acquiredAt: string; expiresAt: string};
export type ComputerInstance = {
  id: string;
  name: string;
  kind: ComputerUseKind;
  os: string;
  arch: string;
  network: ComputerNetwork;
  capabilities: ComputerCapability[];
  authorized: boolean;
  state: "AVAILABLE" | "ALLOCATED" | "EXECUTING" | "PAUSED" | "FAILED" | "RELEASED";
  sandboxId?: string;
  taskId?: string;
  executionLease?: ComputerExecutionLease;
};

type Payload = {instances: ComputerInstance[]};
const DEFAULT_INSTANCES: ComputerInstance[] = [
  {
    id: "CMP-LOCAL-BROWSER",
    name: "Browser Sandbox",
    kind: "BROWSER",
    os: "sandbox",
    arch: "x64",
    network: "DENY",
    capabilities: [
      {
        kind: "BROWSER",
        actions: ["NAVIGATE", "CLICK", "TYPE", "SELECT", "SCREENSHOT", "OCR"],
        environments: ["browser", "test", "experiment"],
        network: "DENY",
        risk: "MODERATE"
      }
    ],
    authorized: false,
    state: "AVAILABLE"
  }
];
const store = createStore<Payload>("computer-use", 1, () => ({instances: DEFAULT_INSTANCES}));
const clone = <T,>(value: T): T => structuredClone(value);
const COMPUTER_KINDS: readonly ComputerUseKind[] = ["BROWSER", "DESKTOP", "CLI"];
const COMPUTER_NETWORKS: readonly ComputerNetwork[] = ["DENY", "ALLOWLIST", "INTERNET"];
const COMPUTER_RISKS: readonly Risk[] = ["SAFE", "LOW", "MODERATE", "HIGH", "CRITICAL"];
const AVAILABLE_COMPUTER_ACTIONS: readonly ComputerUseAction[] = [
  "NAVIGATE", "CLICK", "TYPE", "SELECT", "SCREENSHOT", "OCR", "PROCESS_READ", "FILE_READ"
];
const COMPUTER_OUTPUT_LIMIT = 64_000;
const COMPUTER_LEASE_MS = 5 * 60_000;

function instances(): ComputerInstance[] {
  return store.read().instances;
}

function updatedComputer(payload: Payload, id: string): ComputerInstance {
  const computer = payload.instances.find(instance => instance.id === id);
  if (!computer) throw new Error("computer not found");
  return clone(computer);
}

export function registerComputer(input: Omit<ComputerInstance, "id" | "state">): ComputerInstance {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new Error("computer required");
  if (typeof input.name !== "string" || input.name.trim().length === 0 || input.name.length > 128) throw new Error("computer name required");
  if (typeof input.kind !== "string" || input.kind.trim().length === 0) throw new Error("computer kind required");
  if (!COMPUTER_KINDS.includes(input.kind)) throw new Error("invalid computer kind");
  if (typeof input.os !== "string" || input.os.trim().length === 0 || input.os.length > 128) throw new Error("computer os required");
  if (typeof input.arch !== "string" || input.arch.trim().length === 0 || input.arch.length > 128) throw new Error("computer arch required");
  if (!COMPUTER_NETWORKS.includes(input.network)) throw new Error("invalid computer network policy");
  if (!Array.isArray(input.capabilities) || input.capabilities.length === 0 || input.capabilities.length > 32) throw new Error("computer capabilities required");

  const capabilities = input.capabilities.map((profile, index): ComputerCapability => {
    if (!profile || typeof profile !== "object" || Array.isArray(profile)) throw new Error(`invalid computer capability ${index}`);
    const candidate = profile as unknown as Record<string, unknown>;
    if (!COMPUTER_KINDS.includes(candidate.kind as ComputerUseKind) || candidate.kind !== input.kind) {
      throw new Error(`invalid computer capability kind at ${index}`);
    }
    if (!Array.isArray(candidate.actions) || candidate.actions.length === 0 || candidate.actions.length > AVAILABLE_COMPUTER_ACTIONS.length) {
      throw new Error(`invalid computer capability actions at ${index}`);
    }
    const actions = candidate.actions as unknown[];
    if (actions.some(action => typeof action !== "string" || !AVAILABLE_COMPUTER_ACTIONS.includes(action as ComputerUseAction))) {
      throw new Error(`unsupported computer capability action at ${index}`);
    }
    if (new Set(actions).size !== actions.length) throw new Error(`duplicate computer capability action at ${index}`);
    if (!Array.isArray(candidate.environments) || candidate.environments.length === 0 || candidate.environments.length > 16) {
      throw new Error(`invalid computer capability environments at ${index}`);
    }
    const environments = candidate.environments as unknown[];
    if (environments.some(environment => typeof environment !== "string" || !/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,63}$/.test(environment))) {
      throw new Error(`invalid computer capability environment at ${index}`);
    }
    if (new Set(environments).size !== environments.length) throw new Error(`duplicate computer capability environment at ${index}`);
    if (!COMPUTER_NETWORKS.includes(candidate.network as ComputerNetwork)) throw new Error(`invalid computer capability network at ${index}`);
    if (!COMPUTER_RISKS.includes(candidate.risk as Risk)) throw new Error(`invalid computer capability risk at ${index}`);
    return {
      kind: candidate.kind as ComputerUseKind,
      actions: actions as ComputerUseAction[],
      environments: environments as string[],
      network: candidate.network as ComputerNetwork,
      risk: candidate.risk as Risk
    };
  });

  // Discovery ist keine Autorisierung: ein registrierter Computer kommt immer
  // unautorisiert in die Flotte. Nur whitelisted Felder werden persistiert;
  // mitgesendete Actor-/Lifecycle-Felder können keine Bindungen einschleusen.
  const computer: ComputerInstance = {
    id: `CMP-${crypto.randomUUID().slice(0, 12).toUpperCase()}`,
    name: input.name.trim(),
    kind: input.kind,
    os: input.os.trim(),
    arch: input.arch.trim(),
    network: input.network,
    capabilities,
    authorized: false,
    state: "AVAILABLE",
    sandboxId: undefined,
    taskId: undefined,
    executionLease: undefined
  };
  store.update(payload => {
    payload.instances.push(computer);
  });
  observe({
    type: "computer.registered",
    message: `Computer ${computer.id} registriert`,
    status: "COMPLETED",
    actor: "CREATOR",
    action: "computer.register",
    resource: computer.id,
    argumentsValue: {kind: computer.kind, network: computer.network, authorized: false}
  });
  return clone(computer);
}

export function getComputer(id: string): ComputerInstance | null {
  return clone(instances().find(instance => instance.id === id) ?? null);
}

export function allocateComputer(id: string, taskId: string, sandboxId?: string): ComputerInstance {
  const payload = store.update(next => {
    const computer = next.instances.find(instance => instance.id === id);
    if (!computer || !computer.authorized) throw new Error("computer is not authorized");
    if (computer.state !== "AVAILABLE" && computer.state !== "RELEASED") throw new Error("computer is not available");
    if (typeof taskId !== "string" || taskId.trim().length === 0) throw new Error("computer allocation requires a task");
    if (sandboxId !== undefined && (typeof sandboxId !== "string" || sandboxId.trim().length === 0)) throw new Error("invalid sandbox binding");
    computer.state = "ALLOCATED";
    computer.taskId = taskId;
    computer.sandboxId = sandboxId;
    computer.executionLease = undefined;
  });
  const result = updatedComputer(payload, id);
  observe({
    type: "computer.allocated",
    message: `Computer ${id} an ${taskId} gebunden`,
    status: "RUNNING",
    actor: "CREATOR",
    taskId,
    sandboxId,
    action: "computer.allocate",
    resource: id
  });
  return result;
}

/** Creator-only lifecycle action. Brokered executions also claim ALLOCATED instances directly. */
export function startComputer(id: string): ComputerInstance {
  const payload = store.update(next => {
    const computer = next.instances.find(instance => instance.id === id);
    if (!computer) throw new Error("computer not found");
    if (computer.state !== "ALLOCATED") throw new Error("computer must be allocated first");
    computer.state = "EXECUTING";
  });
  const result = updatedComputer(payload, id);
  observe({
    type: "computer.executing",
    message: `Computer ${id} für eine Broker-Ausführung gestartet`,
    status: "EXECUTING",
    actor: "CREATOR",
    taskId: result.taskId,
    sandboxId: result.sandboxId,
    action: "computer.start",
    resource: id
  });
  return result;
}

export function authorizeComputer(id: string, authorized = true, actor = "CREATOR"): ComputerInstance {
  if (actor !== "CREATOR") throw new Error("computer authorization requires Creator authority");
  const payload = store.update(next => {
    const computer = next.instances.find(instance => instance.id === id);
    if (!computer) throw new Error("computer not found");
    computer.authorized = authorized;
  });
  const result = updatedComputer(payload, id);
  observe({
    type: "computer.authorized",
    message: `Computer ${id} ${authorized ? "autorisiert" : "Autorisierung entzogen"}`,
    status: "COMPLETED",
    actor,
    action: "computer.authorize",
    resource: id,
    decision: authorized ? "ALLOW" : "DENY",
    argumentsValue: {authorized}
  });
  return result;
}

export function releaseComputer(id: string): ComputerInstance {
  const payload = store.update(next => {
    const computer = next.instances.find(instance => instance.id === id);
    if (!computer) throw new Error("computer not found");
    if (computer.executionLease && Date.parse(computer.executionLease.expiresAt) > Date.now()) {
      throw new Error("computer has an active execution lease");
    }
    computer.state = "RELEASED";
    computer.taskId = undefined;
    computer.sandboxId = undefined;
    computer.executionLease = undefined;
  });
  const result = updatedComputer(payload, id);
  observe({
    type: "computer.released",
    message: `Computer ${id} freigegeben`,
    status: "COMPLETED",
    actor: "CREATOR",
    action: "computer.release",
    resource: id
  });
  return result;
}

/** Atomarer Claim verhindert parallele Computer-Aktionen auf derselben Instanz. */
export function claimComputerExecution(
  id: string,
  leaseId: string,
  expected: {taskId: string; sandboxId: string; leaseMs?: number}
): ComputerInstance {
  const payload = store.update(next => {
    const computer = next.instances.find(instance => instance.id === id);
    if (!computer) throw new Error("computer not found");
    if (!computer.authorized) throw new Error("computer authorization was revoked");
    if (computer.taskId !== expected.taskId) throw new Error("computer is allocated to a different task");
    if (computer.sandboxId !== expected.sandboxId) throw new Error("computer is allocated to a different sandbox");
    if (computer.state !== "ALLOCATED" && computer.state !== "EXECUTING") throw new Error(`computer is not executable in state ${computer.state}`);
    if (computer.executionLease && Date.parse(computer.executionLease.expiresAt) > Date.now()) {
      throw new Error("computer already has an active execution");
    }
    const now = Date.now();
    computer.state = "EXECUTING";
    computer.executionLease = {
      id: leaseId,
      acquiredAt: new Date(now).toISOString(),
      expiresAt: new Date(now + (expected.leaseMs ?? COMPUTER_LEASE_MS)).toISOString()
    };
  });
  return updatedComputer(payload, id);
}

/** Drop a claim if token consumption fails before the driver starts. */
export function abandonComputerExecutionClaim(id: string, leaseId: string): void {
  store.update(payload => {
    const computer = payload.instances.find(instance => instance.id === id);
    if (!computer || computer.executionLease?.id !== leaseId) return;
    computer.state = "ALLOCATED";
    computer.executionLease = undefined;
  });
}

/** Release an execution claim after its driver has exited. */
export function settleComputerExecution(id: string, leaseId: string, accepted: boolean): ComputerInstance {
  const payload = store.update(next => {
    const computer = next.instances.find(instance => instance.id === id);
    if (!computer) throw new Error("computer not found");
    if (computer.executionLease?.id !== leaseId) throw new Error("computer execution lease is no longer owned by this run");
    computer.state = accepted ? "ALLOCATED" : "FAILED";
    computer.executionLease = undefined;
  });
  return updatedComputer(payload, id);
}

export function configuredComputerDriver(): string | null {
  const configured = process.env.BOB_COMPUTER_DRIVER;
  if (!configured) return null;
  if (!path.isAbsolute(configured)) throw new Error("BOB_COMPUTER_DRIVER must be an absolute path");
  const resolved = path.resolve(configured);
  const stat = fs.lstatSync(resolved);
  if (!stat.isFile() || stat.isSymbolicLink()) throw new Error("BOB_COMPUTER_DRIVER must be a regular, non-symlink file");
  fs.accessSync(resolved, fs.constants.R_OK);
  return fs.realpathSync(resolved);
}

export type ComputerDriverResult = {
  accepted: boolean;
  output: unknown;
  stdout: string;
  stderr: string;
  exitCode: number | null;
  timedOut: boolean;
  durationMs: number;
  message: string;
  outputTruncated: boolean;
};

/**
 * Calls only an operator-configured local adapter. The adapter is not a shell:
 * it receives one JSON request on stdin with a minimal environment and bounded
 * output/time. Actual authorization and capability consumption happen in the
 * central Execution Broker before this function can be called.
 */
export async function invokeComputerDriver(input: {
  driverPath: string;
  computer: ComputerInstance;
  action: ComputerUseAction;
  computerInput: Record<string, unknown>;
  taskId: string;
  sandboxId: string;
  environment: string;
  timeoutMs: number;
  cwd?: string;
}): Promise<ComputerDriverResult> {
  const startedAt = Date.now();
  const requestBody = JSON.stringify({
    computerId: input.computer.id,
    kind: input.computer.kind,
    action: input.action,
    input: input.computerInput,
    taskId: input.taskId,
    sandboxId: input.sandboxId,
    environment: input.environment
  });
  const child = spawn(process.execPath, [input.driverPath], {
    cwd: input.cwd ?? process.cwd(),
    shell: false,
    detached: process.platform !== "win32",
    stdio: ["pipe", "pipe", "pipe"],
    env: {
      PATH: process.env.PATH ?? "/usr/bin:/bin",
      HOME: input.cwd ?? process.cwd(),
      LANG: "C.UTF-8",
      NODE_ENV: process.env.NODE_ENV ?? "production",
      BOB_COMPUTER_ID: input.computer.id,
      BOB_SANDBOX_ID: input.sandboxId
    }
  });

  return new Promise(resolve => {
    let stdout = "";
    let stderr = "";
    let outputTruncated = false;
    let timedOut = false;
    let completed = false;
    const capture = (chunk: Buffer, target: "stdout" | "stderr") => {
      const current = target === "stdout" ? stdout : stderr;
      const next = current + String(chunk);
      if (Buffer.byteLength(next, "utf8") > COMPUTER_OUTPUT_LIMIT) outputTruncated = true;
      const bounded = Buffer.from(next, "utf8").subarray(-COMPUTER_OUTPUT_LIMIT).toString("utf8");
      if (target === "stdout") stdout = bounded;
      else stderr = bounded;
    };
    const terminate = () => {
      try {
        if (child.pid && process.platform !== "win32") process.kill(-child.pid, "SIGKILL");
        else child.kill("SIGKILL");
      } catch {
        child.kill("SIGKILL");
      }
    };
    const timer = setTimeout(() => {
      timedOut = true;
      terminate();
    }, input.timeoutMs);
    const finish = (exitCode: number | null, error?: Error) => {
      if (completed) return;
      completed = true;
      clearTimeout(timer);
      let output: unknown = null;
      let parseError = "";
      if (stdout.trim().length > 0 && !outputTruncated) {
        try {
          output = JSON.parse(stdout);
        } catch {
          parseError = "computer driver output must be valid JSON";
        }
      } else if (stdout.trim().length === 0 && !error && !timedOut) {
        parseError = "computer driver returned no output";
      }
      const outputObject = output && typeof output === "object" && !Array.isArray(output) ? (output as Record<string, unknown>) : null;
      const accepted = !error && !timedOut && !outputTruncated && exitCode === 0 && outputObject?.ok === true;
      resolve({
        accepted,
        output,
        stdout,
        stderr: error ? `${stderr}${stderr ? "\n" : ""}${error.message}`.slice(-COMPUTER_OUTPUT_LIMIT) : stderr,
        exitCode,
        timedOut,
        durationMs: Date.now() - startedAt,
        message: error?.message ?? (timedOut ? `computer driver timed out after ${input.timeoutMs}ms` : outputTruncated ? "computer driver output exceeded the capture limit" : parseError || (accepted ? "computer action completed" : "computer driver did not confirm success")),
        outputTruncated
      });
    };

    child.stdout.on("data", chunk => capture(chunk as Buffer, "stdout"));
    child.stderr.on("data", chunk => capture(chunk as Buffer, "stderr"));
    child.once("error", error => finish(null, error));
    child.once("close", code => finish(code));
    child.stdin.once("error", error => {
      if ((error as NodeJS.ErrnoException).code !== "EPIPE") finish(null, error);
    });
    child.stdin.end(requestBody);
  });
}

export function computerUseStoreReport() {
  return store.integrity();
}

export function listComputers(): ComputerInstance[] {
  return clone(instances());
}
