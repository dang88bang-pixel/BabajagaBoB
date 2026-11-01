import {spawnSync} from "node:child_process";
import fs from "node:fs";
import crypto from "node:crypto";
import os from "node:os";

/**
 * Ressourcenlimits ohne cgroup-Delegation: transienter systemd-Scope.
 *
 * Warum das existiert: Ein delegierter cgroup-Unterbaum (siehe `cgroupAvailable`)
 * lässt sich einem unprivilegierten Benutzer **nicht** nutzen — der Kernel
 * verlangt Schreibzugriff auf `cgroup.procs` des gemeinsamen Vorfahren, also auf
 * die Wurzel (siehe cgroup-v2-Dokumentation, Abschnitt „Delegation Containment“).
 * Beobachtet: `EACCES` beim Beitritt, obwohl alle Dateien dem Benutzer gehören.
 *
 * Der etablierte Weg (Kernel-Doku, systemd-Handbuch, Stack Overflow) ist ein
 * **transienter Scope**: Ein privilegierter Aufruf von
 * `systemd-run --scope -p MemoryMax=… -p TasksMax=… -p CPUQuota=…` legt den
 * cgroup-Knoten an und setzt die Grenzen; der Nutzlast-Prozess läuft darin.
 * Gemessen in dieser Umgebung: `MemoryMax=48M` beendet einen Speicherfresser mit
 * Exit 137 (OOM-Kill) — ein echtes Kernel-Limit, keine Zusage.
 *
 * Grenzen dieser Lösung (bewusst benannt):
 *  - Sie braucht ein enges `sudoers`-Recht für genau diesen Aufruf; ohne das
 *    bleibt sie `UNAVAILABLE` und die Ausführung mit Limit-Anforderung scheitert
 *    fail closed.
 *  - Sie ersetzt **keine** Namespace-Isolation: der Scope läuft *innerhalb* von
 *    `ns-exec.sh` (unshare, chroot, read-only Rootfs, Netzwerk-Namespace).
 *  - `systemd-run --wait/--pipe` (transiente **Services** mit
 *    Sandbox-Eigenschaften wie `PrivateNetwork`, `SystemCallFilter`) benötigt den
 *    System-D-Bus. Fehlt der Bus (`/run/dbus/system_bus_socket`), ist nur der
 *    Scope-Weg verfügbar — genau dann greift diese Datei.
 */

export type SandboxLauncherMode = "none" | "systemd-scope";

/** Pfade sind über die Umgebung überschreibbar (Tests/Betrieb mit anderem Prefix). */
export const systemdRunBinary = () => process.env.BOB_SYSTEMD_RUN ?? "/usr/bin/systemd-run";
export const setprivBinary = () => process.env.BOB_SETPRIV ?? "/usr/bin/setpriv";

export function launcherMode(): SandboxLauncherMode {
  const raw = (process.env.BOB_SANDBOX_LAUNCHER ?? "none").toLowerCase();
  if (raw === "none" || raw === "") return "none";
  if (raw === "systemd-scope") return "systemd-scope";
  throw new Error(`unsupported BOB_SANDBOX_LAUNCHER: ${raw}`);
}

export type LauncherProbe = {available: boolean; reason?: string; detail?: string};

const PROBE_CACHE = new Map<string, LauncherProbe>();

/** Prüft Aufruf und Wirkung des Scopes — gecacht, weil jeder Test einen Prozess startet. */
export function systemdScopeAvailable(): LauncherProbe {
  if (launcherMode() !== "systemd-scope") {
    return {available: false, reason: "kein Launcher konfiguriert (BOB_SANDBOX_LAUNCHER)"};
  }
  const cached = PROBE_CACHE.get(launcherMode());
  if (cached) return cached;
  const probe = probeScope();
  PROBE_CACHE.set(launcherMode(), probe);
  return probe;
}

function probeScope(): LauncherProbe {
  // Der Pfad ist über die Umgebung überschreibbar; `turbopackIgnore` verhindert,
  // dass der Bundler deswegen das ganze Projekt in die Server-Trace zieht.
  if (!fs.existsSync(/*turbopackIgnore: true*/ systemdRunBinary())) {
    return {available: false, reason: `${systemdRunBinary()} fehlt; transiente Scopes sind nicht verfügbar`};
  }
  if (!fs.existsSync("/run/systemd/private")) {
    return {available: false, reason: "systemd ist nicht erreichbar (/run/systemd/private fehlt)"};
  }
  // Der Scope wird über `sudo -n` betreten: ohne hinterlegtes sudoers-Recht
  // scheitert schon der Aufruf. Das wird hier festgestellt, nicht angenommen.
  const identity = spawnSync("sudo", ["-n", "true"], {timeout: 5_000, encoding: "utf8"});
  if (identity.status !== 0) {
    return {
      available: false,
      reason: `sudo -n nicht möglich (${(identity.stderr ?? "").trim().split("\n").pop() || `exit ${identity.status}`}); ein sudoers-Recht für ${systemdRunBinary()} wird benötigt`
    };
  }
  // Wirkungsprobe: Der Prozess im Scope muss eine endliche memory.max sehen und
  // selbst unprivilegiert laufen (setpriv), damit der Scope keine Rechte verleiht.
  const script = [
    'const fs=require("node:fs");',
    'const cg=fs.readFileSync("/proc/self/cgroup","utf8").trim().split("::")[1]||"";',
    'let limit="?";try{limit=fs.readFileSync("/sys/fs/cgroup"+cg+"/memory.max","utf8").trim()}catch(e){limit=e.code}',
    'process.stdout.write(JSON.stringify({uid:process.getuid(),cgroup:cg,limit}))'
  ].join("");
  const args = [
    "-n",
    systemdRunBinary(),
    "--scope",
    "--quiet",
    "--collect",
    "-p",
    "MemoryMax=96M",
    "-p",
    "TasksMax=64",
    "--",
    ...unprivilegedPrefix(),
    process.execPath,
    "-e",
    script
  ];
  const result = spawnSync("sudo", args, {timeout: 30_000, encoding: "utf8"});
  if (result.status !== 0) {
    const detail = ((result.stderr ?? "") + (result.stdout ?? "")).trim().split("\n").slice(-2).join(" ").slice(0, 300);
    return {available: false, reason: `Scope-Probe fehlgeschlagen (${detail || `exit ${result.status}`})`};
  }
  try {
    const observed = JSON.parse(String(result.stdout).trim().split("\n").pop() ?? "{}") as {uid?: number; cgroup?: string; limit?: string};
    if (!observed.cgroup || observed.cgroup === "/") {
      return {available: false, reason: "Scope-Probe: Prozess lief nicht in einem eigenen cgroup-Knoten"};
    }
    if (observed.limit !== String(96 * 1024 * 1024)) {
      return {available: false, reason: `Scope-Probe: memory.max ist ${observed.limit ?? "unbekannt"}, erwartet ${96 * 1024 * 1024}`};
    }
    if (observed.uid === 0) {
      return {available: false, reason: "Scope-Probe: Nutzlast lief als root; setpriv-Präfix greift nicht"};
    }
    return {available: true, detail: `transienter systemd-Scope aktiv (cgroup ${observed.cgroup})`};
  } catch (error) {
    return {available: false, reason: `Scope-Probe lieferte keine Auswertung (${error instanceof Error ? error.message : "unbekannt"})`};
  }
}

/**
 * Senkt die Rechte auf den aufrufenden Benutzer: `sudo systemd-run` startet sonst
 * als root. `setpriv` ist Teil von util-linux und in der Umgebung vorhanden.
 * Fehlt es, wird der Scope verweigert — ein root-laufender „Sandbox"-Prozess wäre
 * eine Rechteausweitung, keine Isolation.
 */
function unprivilegedPrefix(): string[] {
  const uid = process.getuid?.() ?? 0;
  const gid = process.getgid?.() ?? 0;
  if (uid === 0) return []; // läuft die Plattform selbst als root, ist nichts zu senken
  if (!fs.existsSync(/*turbopackIgnore: true*/ setprivBinary())) throw new Error(`${setprivBinary()} fehlt; ein Scope als root wäre eine Rechteausweitung`);
  return [setprivBinary(), `--reuid=${uid}`, `--regid=${gid}`, "--clear-groups"];
}

/** Ressourcen-Eigenschaften des Scopes aus den Sandbox-Limits. */
export function scopeProperties(limits: {memoryMb: number; processes: number; cpuMillicores: number}): string[] {
  const memoryMb = Math.max(16, Math.floor(limits.memoryMb));
  const processes = Math.max(1, Math.floor(limits.processes));
  const quota = Math.max(1, Math.min(10_000, Math.round(limits.cpuMillicores / 10)));
  return ["-p", `MemoryMax=${memoryMb}M`, "-p", `TasksMax=${processes}`, "-p", `CPUQuota=${quota}%`];
}

export type LauncherPlan = {command: string; args: string[]; label: string; unit?: string; cgroupPath?: string};

/** Eindeutiger, systemd-tauglicher Unit-Name für den transienten Scope. */
export function scopeUnitName(sandboxId: string): string {
  const safe = sandboxId.replace(/[^A-Za-z0-9_-]/g, "").slice(0, 24) || "sandbox";
  return `bob-scope-${safe}-${crypto.randomBytes(4).toString("hex")}`;
}

/** Host-Pfad des cgroup-Knotens eines Scope-Units (nur wenn systemd dort slice't). */
export function scopeCgroupPath(unit: string): string {
  return `/sys/fs/cgroup/system.slice/${unit}.scope`;
}

/**
 * Baut den Aufruf für `argv`. Ohne Launcher bleibt es beim direkten `spawn`
 * (unshare-Pfad). Mit Launcher steht davor: `sudo -n systemd-run --scope …`.
 */
export function launcherPlan(
  argv: string[],
  limits?: {memoryMb: number; processes: number; cpuMillicores: number},
  sandboxId = "sandbox",
  env: Record<string, string | undefined> = {}
): LauncherPlan {
  if (launcherMode() === "none") return {command: argv[0], args: argv.slice(1), label: "DIRECT"};
  const probe = systemdScopeAvailable();
  if (!probe.available) throw new Error(`sandbox launcher unavailable: ${probe.reason}`);
  const properties = limits ? scopeProperties(limits) : ["-p", "MemoryMax=96M"];
  // Ein benannter Unit macht den cgroup-Knoten für die Nutzlast nachweisbar
  // (`/sys/fs/cgroup/system.slice/<unit>.scope`) — ohne Namen wäre das Limit nur
  // behauptet, nicht von innen prüfbar.
  const unit = scopeUnitName(sandboxId);
  // `sudo` setzt die Umgebung zurück; `systemd-run --setenv` gibt die Sandbox-
  // Umgebung (rlimits, NODE_OPTIONS, Selbst-cgroup) explizit weiter. Damit hängt
  // die Wirkung nicht an `sudoers`-`SETENV`-Regeln.
  const cgroupPath = scopeCgroupPath(unit);
  // Der Selbst-cgroup-Pfad gehört zur Ausführung selbst und wird deshalb hier
  // gesetzt, nicht von der aufrufenden Stelle geraten.
  const setenv = Object.entries({...env, BOB_NS_SELF_CGROUP: cgroupPath})
    .filter(([, value]) => typeof value === "string" && value !== "")
    .map(([key, value]) => `--setenv=${key}=${value}`);
  return {
    command: "sudo",
    args: [
      "-n",
      systemdRunBinary(),
      "--scope",
      "--quiet",
      "--collect",
      `--unit=${unit}`,
      ...properties,
      ...setenv,
      "--",
      ...unprivilegedPrefix(),
      ...argv
    ],
    label: "SYSTEMD_SCOPE",
    unit,
    cgroupPath
  };
}

/** Nur für Tests: Probeergebnis verwerfen. */
export function resetScopeProbe(): void {
  PROBE_CACHE.clear();
}

/**
 * Hostweite Einordnung für Berichte (kein Ausführungsweg). Wirft nie: ein
 * Tippfehler in `BOB_SANDBOX_LAUNCHER` darf den Runtime-Bericht nicht mit 500
 * beenden — er wird als ungültige Konfiguration ausgewiesen, Limits gelten dann
 * als nicht durchgesetzt.
 */
export function launcherReport() {
  const sudoersHint = `User needs: <user> ALL=(root) NOPASSWD: ${systemdRunBinary()} --scope *`;
  let mode: string;
  try {
    mode = launcherMode();
  } catch (error) {
    return {
      mode: "invalid",
      available: false,
      reason: error instanceof Error ? error.message : String(error),
      detail: undefined as string | undefined,
      sudoersHint,
      host: os.hostname()
    };
  }
  const probe = mode === "systemd-scope" ? systemdScopeAvailable() : {available: false, reason: "kein Launcher konfiguriert (BOB_SANDBOX_LAUNCHER)"};
  return {
    mode,
    available: probe.available,
    reason: probe.reason,
    detail: probe.detail,
    sudoersHint,
    host: os.hostname()
  };
}
