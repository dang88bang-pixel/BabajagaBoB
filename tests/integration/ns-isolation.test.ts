import {execFileSync} from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import {beforeEach, describe, expect, it, vi} from "vitest";
import {isolatedStorageRoot} from "../helpers/runtime";
import {probeUserNamespaces} from "../../lib/ns-isolation";

/**
 * Kernel-Isolation der Ausführung (Runtime-Isolation `NAMESPACES`).
 *
 * Die OCI-Runtime ist in dieser Umgebung nicht verifizierbar (kein Daemon). Damit
 * die Sandbox trotzdem **kernel-seitig** isoliert ist und nicht nur per Policy,
 * prüft diese Suite die Namespace-Isolation real:
 *
 *  - Prozesse laufen in eigenen Netzwerk-/PID-/IPC-/UTS-/Mount-/User-Namespaces
 *  - Rootfs ist read-only (`EROFS`), schreibbar ist nur der Workspace
 *  - `CapBnd`/`CapEff` sind leer, `NoNewPrivs` = 1
 *  - kein Netzwerk (frischer Netzwerk-Namespace: keine Verbindung möglich)
 *  - Agentenargumente werden **nicht** als Shell interpretiert
 *  - Zeitüberschreitung beendet die Prozessgruppe
 *  - ohne verfügbare Isolation wird nichts unisoliert ausgeführt (fail closed)
 *
 * Der Rootfs (Node + Bibliotheken + BusyBox) wird für den Test real gebaut.
 */

const root = isolatedStorageRoot("ns-isolation");
const rootfs = path.join(root, "rootfs");
const repo = process.cwd();

let ns: typeof import("../../lib/ns-isolation");

const PROBE = [
  'const fs=require("fs");',
  'const st=fs.readFileSync("/proc/self/status","utf8");',
  'const g=k=>(st.match(new RegExp("^"+k+":\\\\s*(.*)$","m"))||[])[1]||"?";',
  'const procs=fs.readdirSync("/proc").filter(x=>/^[0-9]+$/.test(x)).length;',
  'let ro="?";try{fs.writeFileSync("/verboten","x");ro="SCHREIBBAR";}catch(e){ro=e.code;}',
  'let rw="?";try{fs.writeFileSync("/work/probe.txt","ok");rw="ok";}catch(e){rw=e.code;}',
  'console.log(JSON.stringify({capBnd:g("CapBnd"),capEff:g("CapEff"),noNewPrivs:g("NoNewPrivs"),procs,ro,rw}));'
].join("");

/**
 * Verfügbarkeit **vor** der Testregistrierung messen. Gehärtete Umgebungen
 * (z. B. CI-Runner mit `apparmor_restrict_unprivileged_userns=1`) erlauben keine
 * unprivilegierten User-Namespaces. Dann wird der Isolationsnachweis **sichtbar
 * übersprungen** (Vitest meldet `skipped`) und der Grund protokolliert — statt
 * stillschweigend zu bestehen. Die fail-closed-Zusagen werden weiterhin geprüft.
 */
const userns = probeUserNamespaces();
const usernsReason = userns.reason ?? "unbekannter Grund";
// Der Rootfs wird nur gebaut, wenn die Umgebung Namespaces überhaupt zulässt
// (spart in CI 126 MB Kopierarbeit und macht den Grund sichtbar).
const rootfsBuilt = userns.available
  ? (() => {
      try {
        execFileSync("bash", [path.join(repo, "scripts", "build-ns-rootfs.sh"), rootfs], {stdio: "pipe", timeout: 180_000});
        return fs.existsSync(path.join(rootfs, "bin", "node"));
      } catch {
        return false;
      }
    })()
  : false;
const isolationAvailable = userns.available && rootfsBuilt;
const unavailableReason = userns.available
  ? "Rootfs konnte nicht gebaut werden (bash scripts/build-ns-rootfs.sh)"
  : usernsReason;
if (!isolationAvailable) console.warn(`[ns-isolation] Kernel-Isolation in dieser Umgebung nicht nachweisbar: ${unavailableReason}`);

process.env.BOB_NS_ROOTFS = rootfs;

/** Nur in Umgebungen mit nachweisbarer Isolation; sonst als `skipped` gemeldet. */
const isolationDescribe = isolationAvailable ? describe : describe.skip;

beforeEach(async () => {
  process.env.BOB_NS_ROOTFS = rootfs;
  process.env.BOB_NS_ISOLATION = "auto";
  vi.resetModules();
  ns = await import("../../lib/ns-isolation");
});

isolationDescribe("Kernel-Isolation (NAMESPACES)", () => {
  it("meldet aktive Isolation mit den erzwungenen Garantien", () => {
    const report = ns.isolationReport(true);
    expect(report.level).toBe("NAMESPACES");
    expect(report.enforced).toContain("NETWORK_NAMESPACE");
    expect(report.enforced).toContain("PID_NAMESPACE");
    expect(report.enforced).toContain("READ_ONLY_ROOTFS");
    expect(report.enforced).toContain("NO_NEW_PRIVS");
    expect(report.capabilities).toBe("BOUNDING_SET_EMPTY");
    expect(report.rootfs).toBe(rootfs);
  });

  it("führt argv kernel-isoliert aus und belegt die Garantien im Prozess", async () => {
    const result = await ns.runIsolated(["node", "-e", PROBE], {workspace: path.join(root, "work"), timeoutMs: 20_000, sandboxId: "SB-NS-1"});
    expect(result.accepted, result.stderr).toBe(true);
    expect(result.isolation).toBe("NAMESPACES");
    const probe = JSON.parse(result.stdout) as {capBnd: string; capEff: string; noNewPrivs: string; procs: number; ro: string; rw: string};
    expect(probe.capBnd).toBe("0000000000000000");
    expect(probe.capEff).toBe("0000000000000000");
    expect(probe.noNewPrivs).toBe("1");
    expect(probe.ro).toBe("EROFS");
    expect(probe.rw).toBe("ok");
    // Eigener PID-Namespace: nur die eigenen Prozesse sind sichtbar.
    expect(probe.procs).toBeLessThan(5);
  }, 60_000);

  it("hat kein Netzwerk im Sandbox-Namespace (kernel-seitig, nicht per Policy)", async () => {
    const probe = [
      'const net=require("net");',
      'const dev=Object.keys(require("fs").readFileSync("/proc/net/dev","utf8").split("\\n").slice(2).reduce((a,l)=>{const n=l.trim().split(":")[0];if(n)a[n]=1;return a;},{}));',
      'const socket=net.connect({host:"1.1.1.1",port:80});',
      'socket.setTimeout(3000);',
      'socket.on("error",e=>{console.log(JSON.stringify({ifaces:dev,connect:e.code}));process.exit(0);});',
      'socket.on("connect",()=>{console.log(JSON.stringify({ifaces:dev,connect:"VERBUNDEN"}));process.exit(0);});'
    ].join("");
    const result = await ns.runIsolated(["node", "-e", probe], {workspace: path.join(root, "work-net"), timeoutMs: 15_000, sandboxId: "SB-NS-2"});
    expect(result.accepted, result.stderr).toBe(true);
    const parsed = JSON.parse(result.stdout) as {ifaces: string[]; connect: string};
    expect(parsed.ifaces).toEqual(["lo"]);
    expect(parsed.connect).not.toBe("VERBUNDEN");
  }, 60_000);

  it("interpretiert Agentenargumente nicht als Shell", async () => {
    const canary = path.join(root, "canary.txt");
    fs.writeFileSync(canary, "unversehrt");
    const evil = `x"; touch ${canary}.boese; echo "`;
    const result = await ns.runIsolated(["node", "-e", "process.stdout.write(JSON.stringify(process.argv.slice(1)))", evil], {
      workspace: path.join(root, "work-argv"),
      timeoutMs: 15_000,
      sandboxId: "SB-NS-3"
    });
    expect(result.accepted, result.stderr).toBe(true);
    expect(JSON.parse(result.stdout)).toEqual([evil]);
    expect(fs.existsSync(`${canary}.boese`)).toBe(false);
    expect(fs.readFileSync(canary, "utf8")).toBe("unversehrt");
  }, 60_000);

  it("beendet Zeitüberschreitungen und lässt keine Prozesse zurück", async () => {
    const result = await ns.runIsolated(["node", "-e", "setTimeout(()=>{}, 60_000)"], {
      workspace: path.join(root, "work-timeout"),
      timeoutMs: 1_500,
      sandboxId: "SB-NS-4"
    });
    expect(result.timedOut).toBe(true);
    expect(result.accepted).toBe(false);
  }, 60_000);

  it("erzwingt CPU-Zeit und Dateigröße kernel-seitig (rlimits)", async () => {
    // Kleines CPU-Kontingent über eine lange Laufzeit: 200 Millicores × 8 s = 2 s CPU.
    const burn = await ns.runIsolated(["node", "-e", "const t=Date.now();while(Date.now()-t<20000){}"], {
      workspace: path.join(root, "work-cpu"),
      timeoutMs: 8_000,
      sandboxId: "SB-NS-CPU",
      limits: {cpuMillicores: 200, memoryMb: 256, storageMb: 8, timeoutMs: 8_000, processes: 32}
    });
    expect(burn.accepted).toBe(false);
    expect(burn.timedOut).toBe(false); // nicht das Wall-Clock-Timeout, sondern die CPU-Grenze
    expect(burn.resourceLimits?.kernel).toContain("CPU_TIME");

    const write = await ns.runIsolated(
      [
        "node",
        "-e",
        'try{require("fs").writeFileSync("/work/gross.bin",Buffer.alloc(4*1024*1024))}catch(e){process.stdout.write(e.code)}'
      ],
      {
        workspace: path.join(root, "work-fsize"),
        timeoutMs: 15_000,
        sandboxId: "SB-NS-FSIZE",
        limits: {cpuMillicores: 1000, memoryMb: 512, storageMb: 1, timeoutMs: 15_000, processes: 32}
      }
    );
    expect(write.stdout).toBe("EFBIG");
    // Der Kernel bricht den Schreibvorgang an der Grenze ab: die Datei ist höchstens
    // so groß wie erlaubt (nicht 4 MB) — das ist der Nachweis, nicht die Fehlermeldung.
    const written = fs.statSync(path.join(root, "work-fsize", "gross.bin")).size;
    expect(written).toBeLessThanOrEqual(1024 * 1024);
    expect(written).toBeLessThan(4 * 1024 * 1024);
  }, 60_000);

  it("erzwingt Speicher- und Prozesslimits über einen delegierten cgroup-Unterbaum", async () => {
    if (ns.cgroupAvailable().available === false) return; // ohne Delegation nicht prüfbar
    const limits = {cpuMillicores: 1000, memoryMb: 48, storageMb: 8, timeoutMs: 20_000, processes: 16};
    const hog = await ns.runIsolated(
      ["node", "-e", 'const a=[];for(;;)a.push(Buffer.alloc(8*1024*1024))'],
      {workspace: path.join(root, "work-cgroup"), timeoutMs: 20_000, sandboxId: "SB-NS-CGROUP", limits}
    );
    expect(hog.accepted).toBe(false);
    expect(hog.resourceLimits?.cgroup).toBe("ENFORCED");
    expect(ns.isolationReport().enforced).toContain("CGROUP_MEMORY_LIMIT");
    expect(ns.isolationReport().enforced).toContain("CGROUP_PIDS_LIMIT");

    // Prozesslimit: bei pids.max = 16 scheitert das Erzeugen **gleichzeitig**
    // laufender Prozesse (pids.current zählt nur lebende Prozesse), also deutlich
    // vor dem Zählerstand, den es ohne Limit erreichen würde.
    const forks = await ns.runIsolated(
      [
        "node",
        "-e",
        [
          'const cp=require("child_process");',
          'const kinder=[];let n=0;',
          'for(;n<100;n++){try{kinder.push(cp.spawn("/bin/sleep",["5"]))}catch(e){break}}',
          'for(const k of kinder)k.kill("SIGKILL");',
          'setTimeout(()=>process.stdout.write(String(n)),50)'
        ].join("")
      ],
      {workspace: path.join(root, "work-pids"), timeoutMs: 20_000, sandboxId: "SB-NS-PIDS", limits}
    );
    const started = Number(forks.stdout);
    expect(Number.isFinite(started)).toBe(true);
    expect(started).toBeLessThan(100);
    // Kein Restverzeichnis: die Ausführung räumt ihren cgroup-Zweig auf.
    expect(fs.readdirSync(ns.cgroupRoot() as string).filter(entry => entry.startsWith("bob-SB-NS-CGROUP"))).toEqual([]);
  }, 90_000);

  it("verweigert jede Ausführung, wenn cgroup-Limits konfiguriert aber nicht nutzbar sind", async () => {
    const previous = process.env.BOB_CGROUP_DIR;
    process.env.BOB_CGROUP_DIR = path.join(root, "kein-cgroup");
    try {
      vi.resetModules();
      const strict = await import("../../lib/ns-isolation");
      expect(strict.cgroupAvailable().available).toBe(false);
      expect(strict.isolationReport(true).resourceLimits.cgroup).toBe("UNAVAILABLE");
      await expect(
        strict.runIsolated(["node", "-e", "1"], {
          workspace: path.join(root, "work-nocgroup"),
          timeoutMs: 5_000,
          sandboxId: "SB-NS-NOCGROUP",
          limits: {cpuMillicores: 1000, memoryMb: 128, storageMb: 8, timeoutMs: 5_000, processes: 16}
        })
      ).rejects.toThrow(/cgroup/);
    } finally {
      if (previous === undefined) delete process.env.BOB_CGROUP_DIR;
      else process.env.BOB_CGROUP_DIR = previous;
    }
  }, 60_000);

  it("erkennt einen verschwundenen Rootfs und behauptet keine Isolation", async () => {
    vi.resetModules();
    const live = await import("../../lib/ns-isolation");
    // Vorher: echte Isolation (Rootfs wurde in beforeAll gebaut).
    expect(live.isolationReport(true).level).toBe("NAMESPACES");
    // Rootfs verschwindet (gelöschtes Volume) → der Bericht darf NAMESPACES nicht behaupten
    // und die Ausführung darf nicht unisoliert weiterlaufen.
    const moved = `${rootfs}.weg`;
    fs.renameSync(rootfs, moved);
    try {
      const report = live.isolationReport(true);
      expect(report.level).toBe("FILESYSTEM_ONLY");
      expect(report.reason).toMatch(/Rootfs/);
      await expect(live.runIsolated(["node", "-e", "1"], {workspace: path.join(root, "work-weg"), timeoutMs: 5_000, sandboxId: "SB-NS-6"})).rejects.toThrow(/isolation/);
    } finally {
      fs.renameSync(moved, rootfs);
    }
    // Nach der Wiederherstellung ist die Isolation wieder aktiv (kein vergifteter Cache).
    expect(live.isolationReport(true).level).toBe("NAMESPACES");
  }, 60_000);

});

describe("Kernel-Isolation: ehrlicher Bericht und fail closed", () => {
  it("erkennt die Umgebung, wenn Kernel-Isolation nicht möglich ist", async () => {
    // Immer ausgeführt: Entweder ist die Isolation real aktiv (dann hier nur die
    // Bestätigung), oder die Umgebung erlaubt sie nicht — dann muss der Bericht
    // den gemessenen Grund nennen und keine Garantien behaupten.
    vi.resetModules();
    const probeLib = await import("../../lib/ns-isolation");
    process.env.BOB_NS_ISOLATION = "auto";
    const report = probeLib.isolationReport(true);
    if (isolationAvailable) {
      expect(report.level).toBe("NAMESPACES");
      expect(report.reason).toBeUndefined();
    } else {
      expect(report.level).toBe("FILESYSTEM_ONLY");
      expect(report.enforced).toEqual([]);
      expect(report.reason).toBeTruthy();
      expect(report.detail).toContain("nicht aktiv");
    }
  }, 60_000);

  it("führt bei erzwungener Isolation nichts unisoliert aus (fail closed)", async () => {
    process.env.BOB_NS_ISOLATION = "on";
    process.env.BOB_NS_ROOTFS = path.join(root, "nicht-vorhanden");
    vi.resetModules();
    const strict = await import("../../lib/ns-isolation");
    const report = strict.isolationReport(true);
    expect(report.level).toBe("FILESYSTEM_ONLY");
    expect(report.reason).toBeTruthy();
    await expect(strict.runIsolated(["node", "-e", "1"], {workspace: root, timeoutMs: 5_000, sandboxId: "SB-NS-5"})).rejects.toThrow(/isolation is not active/);

    const runtime = (await import("../../lib/runtime-local")).localWorkspaceRuntime;
    const handle = await runtime.create({
      id: "SB-NS-STRICT",
      type: "test",
      network: {mode: "DENY", allowlist: []},
      limits: {cpuMillicores: 500, memoryMb: 512, storageMb: 256, timeoutMs: 5_000, processes: 32},
      risk: "LOW"
    });
    expect(handle.isolation).toBe("FILESYSTEM_ONLY");
    await expect(runtime.execute("SB-NS-STRICT", ["node", "-e", "process.stdout.write('unisoliert')"])).rejects.toThrow(/kernel isolation is enforced/);
  }, 60_000);
});
