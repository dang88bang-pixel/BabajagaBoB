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
  if (requested === "off") {
    cachedReport = {
      level: "FILESYSTEM_ONLY",
      requested,
      enforced: [],
      capabilities,
      rootfs,
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
      capabilities === "BOUNDING_SET_EMPTY" ? "CAPABILITY_BOUNDING_SET_EMPTY" : "CAPABILITY_INHERITABLE_CLEARED"
    ],
    capabilities,
    rootfs,
    detail: `Kernel-Isolation aktiv (unshare-Namespaces, Rootfs read-only, ${capabilities === "BOUNDING_SET_EMPTY" ? "Bounding-Set leer" : "Inheritable/Ambient geleert"}, no_new_privs)`
  };
  return cachedReport;
}

export function isolationActive(): boolean {
  return isolationReport().level === "NAMESPACES";
}

export type IsolationRunOptions = {
  workspace: string;
  timeoutMs: number;
  sandboxId: string;
};

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
      env: {
        PATH: "/usr/local/bin:/bin:/usr/bin",
        HOME: "/work",
        TMPDIR: "/work",
        LANG: "C.UTF-8",
        NODE_ENV: process.env.NODE_ENV ?? "production",
        BOB_SANDBOX: options.sandboxId
      }
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
      reject(error);
    });
    child.once("close", code => {
      clearTimeout(timer);
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
        isolation: "NAMESPACES"
      });
    });
  });
}

/** Für Tests/Diagnose: Cache der Probe verwerfen. */
export function resetIsolationCache() {
  cachedReport = null;
  cachedUnshare = null;
}
