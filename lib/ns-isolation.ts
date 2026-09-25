import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import {spawn, spawnSync} from "node:child_process";
import {storageRoot} from "./persistence/store";
import type {ExecutionResult} from "./runtime";

/**
 * Kernel-Isolation der Sandbox-Ausführung (Runtime-Isolation `NAMESPACES`).
 *
 * Warum das existiert: Die lokale Workspace-Runtime führt echte Prozesse aus,
 * hatte aber **keine Kernel-Isolation** — Netzwerk-DENY war reine Policy, das
 * Dateisystem war der Host. Die OCI-Runtime schließt das, ist in dieser
 * Umgebung aber nicht verifizierbar (kein Container-Daemon). Diese Schicht
 * nutzt ausschließlich Kernel-Primitive, die ohne Daemon und ohne Root
 * verfügbar sind:
 *
 *   unshare(2)  → eigener Netzwerk-, PID-, IPC-, UTS-, Mount- und User-Namespace
 *   mount(2)    → Rootfs read-only, Workspace als einziger schreibbarer Pfad
 *   chroot(2)   → Prozess sieht nur den Rootfs
 *   setpriv(1)  → no_new_privs, Capability-Bounding-Set leer
 *
 * Was damit **kernel-seitig** gilt (nicht nur als Policy):
 *  - kein Netzwerk (frischer Netzwerk-Namespace: nur `lo`, kein Route-Eintrag)
 *  - keine Sicht auf Host-Prozesse (eigener PID-Namespace)
 *  - Rootfs ist `EROFS`; geschrieben werden kann nur im Workspace
 *  - keine Capabilities (`CapBnd`/`CapEff` = 0), `NoNewPrivs` = 1
 *  - keine Rechte auf dem Host: der Prozess läuft in einer User-Namespace und
 *    ist außerhalb davon ein unprivilegierter Benutzer
 *
 * Ehrliche Grenze: Das ist **kein OCI-Container** (kein Image-Format, keine
 * cgroups-Quotas, kein runc). Ressourcenlimits bleiben zeitbasiert. Die
 * Klassifizierung ist deshalb `NAMESPACES`, nicht `REAL_OCI`.
 */

export type IsolationLevel = "FILESYSTEM_ONLY" | "NAMESPACES";
export type IsolationRequest = "on" | "off" | "auto";

export type IsolationReport = {
  level: IsolationLevel;
  requested: IsolationRequest;
  /** Kernel-seitig erzwungene Garantien (leer, wenn die Isolation nicht aktiv ist). */
  enforced: string[];
  capabilities: "BOUNDING_SET_EMPTY" | "INHERITABLE_AMBIENT_ONLY" | "UNKNOWN";
  rootfs: string;
  detail: string;
  /**
   * Durchgesetzte Ressourcenlimits — getrennt nach Mechanismus, damit nichts
   * behauptet wird, was nicht gilt:
   *  - `kernel`: immer verfügbar (rlimits: CPU-Zeit, Dateigröße)
   *  - `cgroup`: nur mit delegiertem cgroup-v2-Unterbaum (`BOB_CGROUP_DIR`)
   */
  resourceLimits: {
    kernel: string[];
    cgroup: "ENFORCED" | "UNAVAILABLE";
    detail: string;
  };
  reason?: string;
};

const NS_EXEC_SCRIPT = path.join(process.cwd(), "scripts", "ns-exec.sh");
const MAX_CAPTURED_OUTPUT = 200_000;

export function requestedIsolation(): IsolationRequest {
  const raw = (process.env.BOB_NS_ISOLATION ?? "auto").toLowerCase();
  if (raw === "on" || raw === "off" || raw === "auto") return raw;
  throw new Error(`unsupported BOB_NS_ISOLATION: ${raw}`);
}

export function nsRootfsPath(): string {
  return process.env.BOB_NS_ROOTFS ?? path.join(storageRoot(), "ns-rootfs");
}

function unshareBinary(): string | null {
  for (const candidate of ["/usr/bin/unshare", "/bin/unshare", "/usr/local/bin/unshare"]) {
    if (fs.existsSync(candidate)) return candidate;
  }
  return null;
}

/**
 * Billige Prüfung (reines `stat`): Rootfs und Wrapper müssen vorhanden sein.
 * Wird bei **jedem** Bericht erneut ausgeführt — eine Behauptung „NAMESPACES"
 * wäre falsch, sobald der Rootfs fehlt (z. B. gelöschtes Volume).
 */
function missingPrerequisite(): string | null {
  if (!fs.existsSync(NS_EXEC_SCRIPT)) return `ns-exec.sh fehlt: ${NS_EXEC_SCRIPT}`;
  const rootfs = nsRootfsPath();
  const busybox = path.join(rootfs, "bin", "busybox");
  if (!fs.existsSync(busybox)) {
    return `Rootfs fehlt oder ist unvollständig: ${rootfs} (bash scripts/build-ns-rootfs.sh)`;
  }
  return null;
}

let cachedUnshare: {available: boolean; reason?: string} | null = null;

/**
 * Erlaubt die Umgebung unprivilegierte User-Namespaces? Praktischer Test, kein
 * Raten: ein echter `unshare`-Lauf. Gehärtete Umgebungen (z. B. CI-Runner mit
 * `kernel.apparmor_restrict_unprivileged_userns=1`) melden hier den echten Grund.
 *
 * `BOB_NS_PROBE_FORCE_UNAVAILABLE=1` erzwingt die Meldung „nicht verfügbar" —
 * ausschließlich für Diagnose und den Nachweis des Skip-Pfads in den Tests.
 */
export function probeUserNamespaces(): {available: boolean; reason?: string} {
  if (process.env.BOB_NS_PROBE_FORCE_UNAVAILABLE === "1") {
    return {available: false, reason: "User-Namespaces sind per BOB_NS_PROBE_FORCE_UNAVAILABLE=1 als nicht verfügbar gemeldet"};
  }
  const unshare = unshareBinary();
  if (!unshare) return {available: false, reason: "unshare(1) ist nicht verfügbar"};
  const result = spawnSync(unshare, ["--user", "--map-root-user", "true"], {timeout: 5_000, encoding: "utf8"});
  if (result.status !== 0) {
    const detail = (result.stderr ?? "").toString().trim() || `exit ${result.status ?? "?"}`;
    return {available: false, reason: `User-Namespaces sind nicht erlaubt: ${detail}`};
  }
  return {available: true};
}

/** Gecachte Variante für den Bericht (der Testlauf ist teuer). */
function unshareUsable(): {available: boolean; reason?: string} {
  if (cachedUnshare) return cachedUnshare;
  cachedUnshare = probeUserNamespaces();
  return cachedUnshare;
}

let cachedReport: IsolationReport | null = null;

/** Aktueller Isolationszustand — nie eine Behauptung ohne Prüfung. */
export function isolationReport(refresh = false): IsolationReport {
  if (refresh) cachedUnshare = null;
  // Voraussetzungen werden immer geprüft; nur der unshare-Testlauf ist gecacht.
  const missing = requestedIsolation() === "off" ? null : missingPrerequisite();
  if (cachedReport && !refresh && !missing) return cachedReport;
  const requested = requestedIsolation();
  const rootfs = nsRootfsPath();
  const capabilities: IsolationReport["capabilities"] = fs.existsSync("/usr/bin/setpriv") ? "BOUNDING_SET_EMPTY" : "INHERITABLE_AMBIENT_ONLY";
  const cgroup = cgroupAvailable();
  const resourceLimits: IsolationReport["resourceLimits"] = {
    kernel: ["CPU_TIME", "FILE_SIZE"],
    cgroup: cgroup.available ? "ENFORCED" : "UNAVAILABLE",
    detail: cgroup.available
      ? `cgroup v2 aktiv (${cgroupRoot()}): Speicher- und Prozesslimit werden je Ausführung kernel-seitig durchgesetzt`
      : `cgroup v2 nicht verfügbar (${cgroup.reason}); Speicher- und Prozesslimits sind nicht kernel-seitig durchsetzbar (NOT_IMPLEMENTED), CPU-Zeit und Dateigröße sind es`
  };
  if (requested === "off") {
    cachedReport = {
      level: "FILESYSTEM_ONLY",
      requested,
      enforced: [],
      capabilities,
      rootfs,
      resourceLimits,
      detail: "Kernel-Isolation ist per BOB_NS_ISOLATION=off deaktiviert; Netzwerk-DENY gilt nur als Policy."
    };
    return cachedReport;
  }
  const result = missing ? {available: false, reason: missing} : unshareUsable();
  if (!result.available) {
    cachedReport = {
      level: "FILESYSTEM_ONLY",
      requested,
      enforced: [],
      capabilities,
      rootfs,
      resourceLimits,
      detail: `Kernel-Isolation nicht aktiv: ${result.reason ?? "unbekannter Grund"}`,
      reason: result.reason
    };
    return cachedReport;
  }
  cachedReport = {
    level: "NAMESPACES",
    requested,
    enforced: [
      "NETWORK_NAMESPACE",
      "PID_NAMESPACE",
      "IPC_NAMESPACE",
      "UTS_NAMESPACE",
      "MOUNT_NAMESPACE",
      "USER_NAMESPACE",
      "READ_ONLY_ROOTFS",
      "WORKSPACE_WRITE_ONLY",
      "NO_NEW_PRIVS",
      capabilities === "BOUNDING_SET_EMPTY" ? "CAPABILITY_BOUNDING_SET_EMPTY" : "CAPABILITY_INHERITABLE_CLEARED",
      "CPU_TIME_LIMIT",
      "FILE_SIZE_LIMIT",
      ...(cgroup.available ? ["CGROUP_MEMORY_LIMIT", "CGROUP_PIDS_LIMIT"] : [])
    ],
    capabilities,
    rootfs,
    resourceLimits,
    detail: `Kernel-Isolation aktiv (unshare-Namespaces, Rootfs read-only, ${capabilities === "BOUNDING_SET_EMPTY" ? "Bounding-Set leer" : "Inheritable/Ambient geleert"}, no_new_privs)`
  };
  return cachedReport;
}

export function isolationActive(): boolean {
  return isolationReport().level === "NAMESPACES";
}

export type IsolationLimits = {
  cpuMillicores: number;
  memoryMb: number;
  storageMb: number;
  timeoutMs: number;
  processes: number;
};

export type IsolationRunOptions = {
  workspace: string;
  timeoutMs: number;
  sandboxId: string;
  /** Ressourcenlimits der Sandbox (werden kernel-seitig durchgesetzt, soweit möglich). */
  limits?: IsolationLimits;
};

/**
 * Delegierter cgroup-v2-Unterbaum (optional). Ohne Delegation sind Speicher- und
 * Prozesslimits **nicht** kernel-seitig durchsetzbar: `RLIMIT_AS` bricht Node
 * (V8 reserviert viel Adressraum) und `RLIMIT_NPROC` zählt pro Host-UID — damit
 * würde eine Sandbox die gesamte Plattform desselben Benutzers drosseln.
 * Deshalb wird nur der delegierte cgroup-Pfad genutzt, und alles andere ehrlich
 * als „nicht durchgesetzt" gemeldet.
 */
export function cgroupRoot(): string | null {
  const dir = process.env.BOB_CGROUP_DIR;
  return dir && dir.length > 0 ? dir : null;
}

export function cgroupAvailable(): {available: boolean; reason?: string} {
  const root = cgroupRoot();
  if (!root) return {available: false, reason: "kein delegierter cgroup-Unterbaum gesetzt (BOB_CGROUP_DIR)"};
  if (!fs.existsSync(path.join(root, "cgroup.procs"))) return {available: false, reason: `cgroup.procs fehlt in ${root}`};
  try {
    for (const file of ["cgroup.procs", "cgroup.subtree_control", "memory.max"]) {
      fs.accessSync(path.join(root, file), fs.constants.W_OK);
    }
  } catch (error) {
    return {available: false, reason: `cgroup-Unterbaum nicht beschreibbar: ${root} (${error instanceof Error ? error.message : String(error)})`};
  }
  return {available: true};
}

/** CPU-Zeitlimit in Sekunden: Millicores über die maximale Laufzeit. */
export function cpuSecondsFor(limits: IsolationLimits): number {
  const seconds = (limits.timeoutMs / 1000) * (limits.cpuMillicores / 1000);
  return Math.max(1, Math.ceil(seconds));
}

/**
 * Führt `argv` isoliert aus. Schlägt die Isolation fehl (Skript/Rootfs/Mounts),
 * wird **nichts** ausgeführt — der Aufruf liefert `accepted: false` mit
 * Fehlermeldung (fail closed), niemals einen unisolierten Lauf.
 */
export async function runIsolated(argv: string[], options: IsolationRunOptions): Promise<ExecutionResult> {
  const report = isolationReport(true);
  if (report.level !== "NAMESPACES") {
    throw new Error(`isolation is not active: ${report.detail}`);
  }
  const missing = missingPrerequisite();
  if (missing) throw new Error(`isolation prerequisites missing: ${missing}`);
  const unshare = unshareBinary();
  if (!unshare) throw new Error("unshare(1) fehlt");
  // Der Workspace ist der einzige schreibbare Pfad und muss als Mountpunkt existieren.
  fs.mkdirSync(options.workspace, {recursive: true, mode: 0o700});
  const started = Date.now();
  const timeout = Math.max(1_000, options.timeoutMs);

  // Ressourcenlimits: CPU-Zeit und Dateigröße sind immer kernel-seitig erzwingbar
  // (rlimits), Speicher und Prozesse nur in einem delegierten cgroup-Unterbaum.
  const env: NodeJS.ProcessEnv = {
    PATH: "/usr/local/bin:/bin:/usr/bin",
    HOME: "/work",
    TMPDIR: "/work",
    LANG: "C.UTF-8",
    NODE_ENV: process.env.NODE_ENV ?? "production",
    BOB_SANDBOX: options.sandboxId
  };
  const cgroup = cgroupAvailable();
  let cgroupDir: string | null = null;
  if (options.limits) {
    env.BOB_NS_RLIMIT_CPU_SECONDS = String(cpuSecondsFor(options.limits));
    env.BOB_NS_RLIMIT_FSIZE_BYTES = String(Math.max(1, Math.floor(options.limits.storageMb * 1024 * 1024)));
    // V8-Obergrenze für Node-Prozesse; kein Kernel-Limit, deshalb zusätzlich zu
    // (nicht statt) cgroup/Rlimit und im Bericht getrennt benannt.
    env.NODE_OPTIONS = `--max-old-space-size=${Math.max(32, Math.floor(options.limits.memoryMb * 0.75))}`;
    if (cgroupRoot()) {
      if (!cgroup.available) throw new Error(`cgroup limits requested but unavailable: ${cgroup.reason}`);
      cgroupDir = path.join(cgroupRoot() as string, `bob-${options.sandboxId.replace(/[^A-Za-z0-9_-]/g, "")}-${crypto.randomBytes(4).toString("hex")}`);
      fs.mkdirSync(cgroupDir, {recursive: true, mode: 0o755});
      fs.writeFileSync(path.join(cgroupDir, "memory.max"), String(Math.max(16, Math.floor(options.limits.memoryMb)) * 1024 * 1024));
      fs.writeFileSync(path.join(cgroupDir, "pids.max"), String(Math.max(1, Math.floor(options.limits.processes))));
      env.BOB_NS_CGROUP_PROCS = path.join(cgroupDir, "cgroup.procs");
    }
  }
  const cleanupCgroup = () => {
    if (!cgroupDir) return;
    // Erst wenn nichts mehr drin läuft, lässt sich das Verzeichnis entfernen.
    try {
      const procs = fs.readFileSync(path.join(cgroupDir, "cgroup.procs"), "utf8").trim();
      if (procs.length === 0) fs.rmdirSync(cgroupDir);
    } catch {
      /* Aufräumen ist Best-Effort; ein Restverzeichnis ist kein Sicherheitsproblem. */
    }
  };
  const args = [
    "--user",
    "--map-root-user",
    "--net",
    "--pid",
    "--ipc",
    "--uts",
    "--mount",
    "--propagation",
    "private",
    "--fork",
    "--kill-child",
    NS_EXEC_SCRIPT,
    report.rootfs,
    options.workspace,
    ...argv
  ];
  return new Promise<ExecutionResult>((resolve, reject) => {
    const child = spawn(unshare, args, {
      cwd: options.workspace,
      shell: false,
      detached: true,
      stdio: ["ignore", "pipe", "pipe"],
      env
    });
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    const capture = (chunk: Buffer, target: "stdout" | "stderr") => {
      const text = String(chunk);
      if (target === "stdout") stdout = (stdout + text).slice(-MAX_CAPTURED_OUTPUT);
      else stderr = (stderr + text).slice(-MAX_CAPTURED_OUTPUT);
    };
    child.stdout?.on("data", chunk => capture(chunk as Buffer, "stdout"));
    child.stderr?.on("data", chunk => capture(chunk as Buffer, "stderr"));
    const timer = setTimeout(() => {
      timedOut = true;
      const pid = child.pid;
      // Prozessgruppe beenden: es bleiben keine Kindprozesse zurück.
      try {
        if (pid) process.kill(-pid, "SIGKILL");
        else child.kill("SIGKILL");
      } catch {
        child.kill("SIGKILL");
      }
    }, timeout);
    child.once("error", error => {
      clearTimeout(timer);
      cleanupCgroup();
      reject(error);
    });
    child.once("close", code => {
      clearTimeout(timer);
      cleanupCgroup();
      // 125/126 = Setup-Fehler des Wrappers (kein Payload gestartet): fail closed.
      const setupFailed = code === 125 || code === 126;
      resolve({
        accepted: code === 0 && !timedOut,
        exitCode: code,
        stdout,
        stderr,
        timedOut,
        durationMs: Date.now() - started,
        message: setupFailed
          ? `isolation setup failed (exit ${code}); nothing was executed`
          : timedOut
            ? `execution timed out after ${timeout}ms`
            : code === 0
              ? "execution completed (kernel-isolated)"
              : `execution failed with exit code ${code}`,
        isolation: "NAMESPACES",
        resourceLimits: {
          kernel: ["CPU_TIME", "FILE_SIZE"],
          cgroup: cgroupDir ? "ENFORCED" : "UNAVAILABLE"
        }
      });
    });
  });
}

/** Für Tests/Diagnose: Cache der Probe verwerfen. */
export function resetIsolationCache() {
  cachedReport = null;
  cachedUnshare = null;
}
