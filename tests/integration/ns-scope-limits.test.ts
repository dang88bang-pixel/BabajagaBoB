import {execFileSync} from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {afterAll, beforeAll, describe, expect, it, vi} from "vitest";
import {isolatedStorageRoot} from "../helpers/runtime";

/**
 * Ressourcenlimits über einen transienten systemd-Scope.
 *
 * Warum dieser Weg (gemessen, siehe `docs/ALTERNATIVES_2026-11-01.md`): Ein
 * delegierter cgroup-Unterbaum ist einem unprivilegierten Prozess nicht nutzbar —
 * der Kernel verlangt Schreibzugriff auf `cgroup.procs` des gemeinsamen Vorfahren.
 * Ein transienter Scope (`systemd-run --scope -p MemoryMax=… -p TasksMax=…`)
 * funktioniert dagegen ohne D-Bus und ohne Delegation.
 *
 * Die Suite prüft **Wirkung, nicht Absicht**: Die Nutzlast liest ihre echten
 * Limits (`/.bob/cgroup/memory.max`, `pids.max`), läuft unprivilegiert und wird
 * bei Überschreitung vom Kernel beendet. Ist der Launcher nicht konfiguriert oder
 * nicht nutzbar, wird der Nachweis **sichtbar** übersprungen (Grund im Log).
 */

const root = isolatedStorageRoot("ns-scope-limits");
const rootfs = path.join(root, "rootfs");
const repo = process.cwd();

const built = (() => {
  try {
    execFileSync("bash", [path.join(repo, "scripts", "build-ns-rootfs.sh"), rootfs], {stdio: "pipe", timeout: 180_000});
    return fs.existsSync(path.join(rootfs, "bin", "node"));
  } catch {
    return false;
  }
})();

process.env.BOB_NS_ISOLATION = "on";
process.env.BOB_NS_ROOTFS = rootfs;
process.env.BOB_SANDBOX_LAUNCHER = "systemd-scope";
delete process.env.BOB_CGROUP_DIR;

const LIMITS = {cpuMillicores: 1000, memoryMb: 96, storageMb: 8, timeoutMs: 20_000, processes: 32};

describe("systemd-Scope als Limit-Mechanismus", () => {
  let ns: typeof import("../../lib/ns-isolation");
  let launcher: typeof import("../../lib/sandbox-launcher");
  let unavailable: string | null = null;

  beforeAll(async () => {
    if (!built) {
      unavailable = "Rootfs konnte nicht gebaut werden";
      return;
    }
    vi.resetModules();
    launcher = await import("../../lib/sandbox-launcher");
    ns = await import("../../lib/ns-isolation");
    const probe = launcher.systemdScopeAvailable();
    if (!probe.available) unavailable = probe.reason ?? "Launcher nicht nutzbar";
  });

  afterAll(() => {
    fs.rmSync(rootfs, {recursive: true, force: true});
    delete process.env.BOB_SANDBOX_LAUNCHER;
    delete process.env.BOB_NS_ROOTFS;
    delete process.env.BOB_NS_ISOLATION;
  });

  it("meldet den Scope nur als verfügbar, wenn ein Probelauf die Limits sieht", ctx => {
    if (unavailable) {
      ctx.skip(`systemd-Scope nicht nutzbar: ${unavailable}`);
      return;
    }
    const probe = launcher.systemdScopeAvailable();
    expect(probe.available).toBe(true);
    expect(probe.detail).toMatch(/\.scope/);
    const plan = launcher.launcherPlan(["/bin/true"], LIMITS, "SB-PLAN");
    expect(plan.label).toBe("SYSTEMD_SCOPE");
    expect(plan.args).toContain("--scope");
    expect(plan.args).toContain(`MemoryMax=96M`);
    expect(plan.args).toContain(`TasksMax=32`);
    expect(plan.args.some(a => a.startsWith("--unit=bob-scope-"))).toBe(true);
    // sudo verwirft die Umgebung: Limits müssen explizit mitgegeben werden.
    expect(plan.args.some(a => a.startsWith("--setenv=BOB_NS_SELF_CGROUP="))).toBe(true);
    // Der Scope läuft als root; die Nutzlast muss auf den aufrufenden Benutzer
    // zurückfallen, sonst wäre der Launcher eine Rechteausweitung.
    if ((process.getuid?.() ?? 0) !== 0) {
      expect(plan.args).toContain(`--reuid=${process.getuid?.()}`);
      expect(plan.args).toContain("/usr/bin/setpriv");
    }
  });

  it("lässt die Nutzlast unprivilegiert laufen und ihre echten Limits lesen", async ctx => {
    if (unavailable) {
      ctx.skip(`systemd-Scope nicht nutzbar: ${unavailable}`);
      return;
    }
    const script = [
      'const fs=require("fs");',
      'const cg=(fs.readFileSync("/proc/self/cgroup","utf8").trim().split("::")[1])||"";',
      'const max=fs.readFileSync("/.bob/cgroup/memory.max","utf8").trim();',
      'const pids=fs.readFileSync("/.bob/cgroup/pids.max","utf8").trim();',
      'process.stdout.write(JSON.stringify({uid:process.getuid(),cg,max,pids}))'
    ].join("");
    const result = await ns.runIsolated(["node", "-e", script], {
      workspace: path.join(root, "probe"),
      timeoutMs: 20_000,
      sandboxId: "SB-SCOPE-PROBE",
      limits: LIMITS
    });
    expect(result.accepted).toBe(true);
    // Im User-Namespace ist uid 0 normal (--map-root-user); entscheidend ist, dass
    // der Prozess auf dem Host unprivilegiert gestartet wurde (setpriv-Präfix,
    // siehe Plan-Test) und dass die Limits von innen lesbar sind.
    const observed = JSON.parse(result.stdout) as {uid: number; cg: string; max: string; pids: string};
    expect(observed.uid).toBe(0);
    expect(observed.cg).toMatch(/\.scope$/);
    expect(observed.max).toBe(String(LIMITS.memoryMb * 1024 * 1024));
    expect(observed.pids).toBe(String(LIMITS.processes));
  }, 60_000);

  it("beendet eine Speicherüberziehung am Limit (kein Erfolg über memory.max hinaus)", async ctx => {
    if (unavailable) {
      ctx.skip(`systemd-Scope nicht nutzbar: ${unavailable}`);
      return;
    }
    // 40 Schritte à 8 MiB = 320 MiB angefordert, Limit 96 MiB: Der Prozess muss
    // deutlich vor dem Ende sterben. Die Schrittnummer im stdout zeigt, wie weit
    // er gekommen ist — das ist der Messwert, keine Behauptung.
    const progress = 'const a=[];for(let i=0;i<40;i++){a.push(Buffer.alloc(8*1024*1024,1));process.stdout.write(i+",")}process.stdout.write("FERTIG")';
    const result = await ns.runIsolated(["node", "-e", progress], {
      workspace: path.join(root, "mem"),
      timeoutMs: 20_000,
      sandboxId: "SB-SCOPE-MEM",
      limits: LIMITS
    });
    expect(result.accepted).toBe(false);
    expect(result.stdout).not.toContain("FERTIG");
    const steps = result.stdout.split(",").filter(Boolean).map(Number);
    expect(steps.length).toBeGreaterThan(0); // der Prozess lief wirklich
    // Mindestens die Hälfte des Limits muss nutzbar gewesen sein (sonst wäre der
    // Test nur ein Startabbruch), und das Ende muss vor den 320 MiB liegen.
    expect(steps.length * 8).toBeGreaterThanOrEqual(LIMITS.memoryMb / 2);
    expect(steps.length).toBeLessThan(40);
    expect(result.resourceLimits?.cgroup).toBe("ENFORCED");
  }, 60_000);

  it("begrenzt gleichzeitig laufende Prozesse (TasksMax)", async ctx => {
    if (unavailable) {
      ctx.skip(`systemd-Scope nicht nutzbar: ${unavailable}`);
      return;
    }
    const script = [
      'const {spawn}=require("child_process");let ok=0,fail=0,pending=48,shown=false;',
      'function done(){if(shown)return;shown=true;process.stdout.write(JSON.stringify({ok,fail}));process.exit(0)}',
      'for(let i=0;i<48;i++){const c=spawn(process.execPath,["-e","setTimeout(()=>{},1500)"],{stdio:"ignore"});',
      'c.on("error",()=>{fail++;if(--pending===0)done()});c.on("exit",code=>{code===0?ok++:fail++;if(--pending===0)done()})}',
      'setTimeout(done,6000);'
    ].join("");
    const result = await ns.runIsolated(["node", "-e", script], {
      workspace: path.join(root, "pids"),
      timeoutMs: 20_000,
      sandboxId: "SB-SCOPE-PIDS",
      limits: LIMITS
    });
    const observed = JSON.parse(result.stdout || "{}") as {ok?: number; fail?: number};
    // Ein Prozesslimit ist nur durchgesetzt, wenn Erzeugung tatsächlich scheitert.
    expect(observed.fail ?? 0).toBeGreaterThan(0);
    expect(observed.ok ?? 0).toBeLessThan(48);
  }, 60_000);

  it("überlebt eine ungültige Launcher-Konfiguration ohne Ausnahme", async () => {
    const previous = process.env.BOB_SANDBOX_LAUNCHER;
    process.env.BOB_SANDBOX_LAUNCHER = "kaputt";
    vi.resetModules();
    const broken = await import("../../lib/sandbox-launcher");
    const report = broken.launcherReport();
    // Der Bericht darf nicht werfen (sonst 500 auf /api/runtime) und muss die
    // Konfiguration als ungültig ausweisen.
    expect(report.mode).toBe("invalid");
    expect(report.available).toBe(false);
    expect(report.reason).toMatch(/BOB_SANDBOX_LAUNCHER/);
    if (previous === undefined) delete process.env.BOB_SANDBOX_LAUNCHER;
    else process.env.BOB_SANDBOX_LAUNCHER = previous;
  });

  it("verweigert Scope-Limits, wenn der Launcher konfiguriert aber nicht nutzbar ist", async () => {
    const previous = process.env.BOB_SYSTEMD_RUN;
    process.env.BOB_SYSTEMD_RUN = path.join(os.tmpdir(), "gibt-es-nicht", "systemd-run");
    vi.resetModules();
    const broken = await import("../../lib/sandbox-launcher");
    broken.resetScopeProbe();
    expect(broken.systemdScopeAvailable().available).toBe(false);
    const strict = await import("../../lib/ns-isolation");
    const report = strict.isolationReport(true);
    expect(report.resourceLimits.cgroup).toBe("UNAVAILABLE");
    expect(report.resourceLimits.mechanism).toBe("none");
    expect(report.enforced).not.toContain("CGROUP_MEMORY_LIMIT");
    if (previous === undefined) delete process.env.BOB_SYSTEMD_RUN;
    else process.env.BOB_SYSTEMD_RUN = previous;
  }, 60_000);
});
