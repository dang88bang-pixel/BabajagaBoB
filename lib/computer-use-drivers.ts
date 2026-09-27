import crypto from "node:crypto";
import fs from "node:fs";
import {createStore} from "./persistence/store";
import {recordAudit} from "./audit";
import {observe} from "./observability";
import {addProvenanceEdge, addProvenanceNode} from "./provenance";
import {executeSystemAuthorized} from "./system-execution";
import type {ExecutionResult} from "./runtime";
import {listComputers, type ComputerInstance, type ComputerUseAction, type ComputerUseKind} from "./computer-use";

/**
 * Computer-Use-Treiber (MASTER §24, Anforderung CU-001, Phase 4 / 7.2).
 *
 * Ein Treiber macht aus einer Computer-Use-Aktion ein konkretes,
 * Shell-freies argv[] und meldet ehrlich, ob sein Werkzeug in dieser
 * Umgebung überhaupt vorhanden ist:
 *
 *  - BROWSER: headless Chromium (`--headless --screenshot` / `--dump-dom`)
 *  - DESKTOP: X11-Werkzeuge (`xdotool`, `import`/`scrot`)
 *  - CLI: Node-Prozess über den Laufzeitpfad (immer verfügbar)
 *
 * Ausführung läuft **ausschließlich** über den autorisierten Systempfad
 * (`executeSystemAuthorized`, Zweck `COMPUTER_USE`, Capability `computer:use`)
 * in einer gebundenen Sandbox — niemals direkt. Ist ein Treiber nicht
 * verfügbar, wird die Aktion fail closed mit ehrlichem Grund verweigert;
 * es wird nichts simuliert oder behauptet.
 */

export type CuDriverAvailability = {driverId: string; kind: ComputerUseKind; available: boolean; binary?: string; reason?: string};

export type CuDriver = {
  driverId: string;
  kind: ComputerUseKind;
  supports: ComputerUseAction[];
  availability: () => CuDriverAvailability;
  buildAction: (action: ComputerUseAction, params: Record<string, unknown>) => string[];
};

export type CuActionAttempt = {
  attemptId: string;
  instanceId: string;
  action: ComputerUseAction;
  driverId: string;
  sandboxId: string;
  startedAt: string;
  finishedAt: string;
  accepted: boolean;
  exitCode: number | null;
  timedOut: boolean;
  evidence?: {artifactId: string; digest: string; verified: boolean};
};

const store = createStore<{attempts: CuActionAttempt[]}>("computer-use-actions", 1, () => ({attempts: []}));

export function whichBinary(names: string[]): string | undefined {
  const dirs = (process.env.PATH ?? "").split(":").filter(Boolean);
  for (const name of names) {
    for (const dir of dirs) {
      const candidate = `${dir.replace(/\/+$/, "")}/${name}`;
      try {
        fs.accessSync(candidate, fs.constants.X_OK);
        return candidate;
      } catch {
        // weiter suchen
      }
    }
  }
  return undefined;
}

const SAFE_PATH = /^[A-Za-z0-9._/-]+$/;

function requireUrl(params: Record<string, unknown>): string {
  const raw = typeof params.url === "string" ? params.url.trim() : "";
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    throw new Error("browser action requires a valid url parameter");
  }
  if (!["http:", "https:", "file:", "data:"].includes(parsed.protocol)) throw new Error(`browser action refuses protocol ${parsed.protocol}`);
  return parsed.toString();
}

function requireSafePath(params: Record<string, unknown>): string {
  const raw = typeof params.path === "string" ? params.path.trim() : "";
  if (!raw || !SAFE_PATH.test(raw) || raw.includes("..")) throw new Error("file action requires a safe relative or absolute path (no .., no special characters)");
  return raw;
}

/** Browser-Treiber: headless Chromium für Navigation (DOM-Dump) und Screenshots. */
export const browserDriver: CuDriver = {
  driverId: "browser-headless-chromium",
  kind: "BROWSER",
  supports: ["NAVIGATE", "SCREENSHOT"],
  availability: () => {
    const binary = whichBinary(["chromium", "chromium-browser", "google-chrome", "chrome"]);
    if (!binary) return {driverId: "browser-headless-chromium", kind: "BROWSER", available: false, reason: "kein Chromium-Binary im PATH (chromium/chromium-browser/google-chrome)"};
    return {driverId: "browser-headless-chromium", kind: "BROWSER", available: true, binary};
  },
  buildAction: (action, params) => {
    const availability = browserDriver.availability();
    if (!availability.available || !availability.binary) throw new Error(`browser driver unavailable: ${availability.reason ?? "no binary"}`);
    const url = requireUrl(params);
    if (action === "SCREENSHOT") {
      const out = typeof params.out === "string" && SAFE_PATH.test(params.out) ? params.out : `/tmp/cu-screenshot-${crypto.randomUUID().slice(0, 8)}.png`;
      return [availability.binary, "--headless", "--no-sandbox", "--disable-gpu", `--screenshot=${out}`, url];
    }
    return [availability.binary, "--headless", "--no-sandbox", "--dump-dom", url];
  }
};

/** Desktop-Treiber: X11-Werkzeuge für Eingabe und Screenshots. */
export const desktopDriver: CuDriver = {
  driverId: "desktop-x11-tools",
  kind: "DESKTOP",
  supports: ["CLICK", "TYPE", "SCREENSHOT"],
  availability: () => {
    const xdotool = whichBinary(["xdotool"]);
    const shot = whichBinary(["import", "scrot"]);
    if (!xdotool || !shot) {
      const missing = [!xdotool ? "xdotool" : null, !shot ? "import/scrot" : null].filter(Boolean).join(", ");
      return {driverId: "desktop-x11-tools", kind: "DESKTOP", available: false, reason: `X11-Werkzeuge fehlen: ${missing}`};
    }
    return {driverId: "desktop-x11-tools", kind: "DESKTOP", available: true, binary: xdotool};
  },
  buildAction: (action, params) => {
    const availability = desktopDriver.availability();
    if (!availability.available) throw new Error(`desktop driver unavailable: ${availability.reason ?? "no binaries"}`);
    if (action === "SCREENSHOT") {
      const shot = whichBinary(["import", "scrot"]);
      if (!shot) throw new Error("desktop driver unavailable: no screenshot tool");
      const out = typeof params.out === "string" && SAFE_PATH.test(params.out) ? params.out : `/tmp/cu-desktop-${crypto.randomUUID().slice(0, 8)}.png`;
      return shot.endsWith("scrot") ? [shot, out] : [shot, "-window", "root", out];
    }
    const xdotool = whichBinary(["xdotool"]);
    if (!xdotool) throw new Error("desktop driver unavailable: no xdotool");
    if (action === "CLICK") {
      const x = Number(params.x);
      const y = Number(params.y);
      if (!Number.isInteger(x) || !Number.isInteger(y) || x < 0 || y < 0) throw new Error("click requires non-negative integer x and y");
      return [xdotool, "mousemove", String(x), String(y), "click", "1"];
    }
    if (action === "TYPE") {
      const text = typeof params.text === "string" ? params.text : "";
      if (!text) throw new Error("type requires non-empty text");
      if (text.length > 4000) throw new Error("type text exceeds 4000 characters");
      return [xdotool, "type", "--", text];
    }
    throw new Error(`desktop driver does not support ${action}`);
  }
};

/** CLI-Treiber: Node-Prozess für Prozess-/Datei-Lesezugriffe und Terminal-Ausführung. */
export const cliDriver: CuDriver = {
  driverId: "cli-node",
  kind: "CLI",
  supports: ["PROCESS_READ", "FILE_READ", "TERMINAL_EXECUTE"],
  availability: () => ({driverId: "cli-node", kind: "CLI", available: true, binary: process.execPath}),
  buildAction: (action, params) => {
    if (action === "PROCESS_READ") {
      return [process.execPath, "-e", 'process.stdout.write(JSON.stringify({pid: process.pid, platform: process.platform, arch: process.arch, uptimeSeconds: Math.round(process.uptime())}))'];
    }
    if (action === "FILE_READ") {
      const path = requireSafePath(params);
      return [process.execPath, "-e", `process.stdout.write(require("fs").readFileSync(${JSON.stringify(path)}, "utf8"))`];
    }
    if (action === "TERMINAL_EXECUTE") {
      const argv = Array.isArray(params.argv) ? params.argv : [];
      if (argv.length === 0 || argv.some(entry => typeof entry !== "string" || entry.length === 0)) throw new Error("terminal execution requires a non-empty argv array");
      return argv as string[];
    }
    throw new Error(`cli driver does not support ${action}`);
  }
};

export function cuDrivers(): CuDriver[] {
  return [browserDriver, desktopDriver, cliDriver];
}

export function driverFor(kind: ComputerUseKind, drivers: CuDriver[] = cuDrivers()): CuDriver | undefined {
  return drivers.find(driver => driver.kind === kind);
}

export function cuDriverAvailabilityMatrix(drivers: CuDriver[] = cuDrivers()): CuDriverAvailability[] {
  return drivers.map(driver => driver.availability());
}

/**
 * Führt eine Computer-Use-Aktion aus — ausschließlich über den autorisierten
 * Systempfad. Autorisierung der Instanz, Treiber-Verfügbarkeit und
 * Sandbox-Bindung werden vorher geprüft; jede Verweigerung wird auditiert.
 */
export async function executeCuAction(
  input: {instanceId: string; action: ComputerUseAction; params?: Record<string, unknown>; sandboxId?: string; requestedBy: string; timeoutMs?: number},
  drivers: CuDriver[] = cuDrivers()
): Promise<CuActionAttempt> {
  const instance: ComputerInstance | undefined = listComputers().find(computer => computer.id === input.instanceId);
  if (!instance) throw new Error(`computer instance not found: ${input.instanceId}`);
  if (!instance.authorized) throw new Error("computer is not authorized");
  if (instance.state !== "ALLOCATED" && instance.state !== "EXECUTING") throw new Error("computer must be allocated before use");

  const driver = driverFor(instance.kind, drivers);
  if (!driver) throw new Error(`no driver registered for ${instance.kind}`);
  const availability = driver.availability();
  if (!availability.available) {
    recordAudit({actor: input.requestedBy, action: "computer-use:action", decision: "DENY", resource: instance.id}, {action: input.action, driverId: driver.driverId, reason: availability.reason});
    throw new Error(`driver unavailable (${driver.driverId}): ${availability.reason ?? "unknown"}`);
  }
  if (!driver.supports.includes(input.action)) throw new Error(`driver ${driver.driverId} does not support ${input.action}`);

  const sandboxId = input.sandboxId ?? instance.sandboxId;
  if (!sandboxId) throw new Error("computer use requires a bound sandbox");

  const argv = driver.buildAction(input.action, input.params ?? {});
  const startedAt = new Date().toISOString();
  let result: ExecutionResult;
  try {
    result = await executeSystemAuthorized({purpose: "COMPUTER_USE", sandboxId, argv, ...(input.timeoutMs !== undefined ? {timeoutMs: input.timeoutMs} : {})});
  } catch (error) {
    recordAudit({actor: input.requestedBy, action: "computer-use:action", decision: "DENY", resource: instance.id}, {action: input.action, driverId: driver.driverId, reason: error instanceof Error ? error.message : String(error)});
    throw error;
  }

  const attemptId = `CUA-${crypto.randomUUID().slice(0, 12).toUpperCase()}`;
  store.update(payload => {
    payload.attempts.push({
      attemptId,
      instanceId: instance.id,
      action: input.action,
      driverId: driver.driverId,
      sandboxId,
      startedAt,
      finishedAt: new Date().toISOString(),
      accepted: result.accepted,
      exitCode: result.exitCode,
      timedOut: result.timedOut,
      ...(result.evidence ? {evidence: {artifactId: result.evidence.artifactId, digest: result.evidence.digest, verified: result.evidence.verified}} : {})
    });
  });
  const attempt = store.read().attempts.find(entry => entry.attemptId === attemptId);
  if (!attempt) throw new Error("computer-use attempt could not be persisted");

  addProvenanceNode({id: attemptId, kind: "EVENT", label: `cu ${instance.kind}:${input.action} ${instance.id}`});
  addProvenanceEdge({from: attemptId, to: instance.id, relation: "EXECUTED_IN"});

  observe({
    type: "computer.action.executed",
    message: `Computer ${instance.id} führte ${input.action} über Treiber ${driver.driverId} aus (${result.accepted ? "akzeptiert" : "abgelehnt"})`,
    status: result.accepted ? "COMPLETED" : "BLOCKED",
    actor: input.requestedBy,
    agentId: input.requestedBy,
    action: "computer-use:action",
    resource: instance.id,
    argumentsValue: {action: input.action, driverId: driver.driverId}
  });
  recordAudit({actor: input.requestedBy, action: "computer-use:action", decision: "ALLOW", resource: instance.id}, {action: input.action, driverId: driver.driverId, accepted: result.accepted});
  return attempt;
}

export function listCuActionAttempts(): CuActionAttempt[] {
  return store.read().attempts;
}
