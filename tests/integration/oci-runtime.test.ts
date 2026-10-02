import {spawnSync} from "node:child_process";
import {describe, expect, it} from "vitest";
import {buildOciCreateArgs, ociContainerName, ociContainerRuntime} from "../../lib/oci-runtime";
import {MAX_RESOURCE_LIMITS} from "../../lib/resource-limits";

const dockerCli = "docker";
const dockerAvailable = spawnSync(dockerCli, ["version", "--format", "{{.Server.Version}}"], {
  encoding: "utf8",
  timeout: 10_000
}).status === 0;

if (!dockerAvailable) {
  // Local environments without a daemon report this as skipped/UNVERIFIED.
  // The dedicated CI job first requires `docker version`, so it cannot pass by skipping.
  console.info("OCI lifecycle test skipped: Docker daemon is unavailable (run in the dedicated OCI CI job to verify).");
}

const limits = {cpuMillicores: 500, memoryMb: 256, storageMb: 128, timeoutMs: 60_000, processes: 32};

/** The command policy is testable without a local Docker installation. */
describe("OCI hardening command contract", () => {
  it("builds a shell-free, non-root, network-denied container with bounded writable storage", () => {
    const spec = {id: "SB-OCI-CONTRACT", type: "test", network: {mode: "DENY" as const, allowlist: []}, limits, risk: "LOW" as const};
    const name = ociContainerName(spec.id);
    const args = buildOciCreateArgs(spec, name, "alpine:3.20", ["sleep", "infinity"]);
    const value = (flag: string) => args[args.indexOf(flag) + 1];

    expect(args).toContain("--pull=never");
    expect(value("--network")).toBe("none");
    // Docker's omitted PID mode is private; `--pid=private` is rejected by the CLI.
    expect(args).not.toContain("--pid");
    expect(args.some(arg => arg.startsWith("--pid="))).toBe(false);
    expect(value("--ipc")).toBe("private");
    expect(value("--cpus")).toBe("0.5");
    expect(value("--memory")).toBe("256m");
    expect(value("--memory-swap")).toBe("256m");
    expect(value("--pids-limit")).toBe("32");
    expect(value("--shm-size")).toBe("1m");
    expect(args).toContain("--read-only");
    expect(value("--cap-drop")).toBe("ALL");
    expect(value("--security-opt")).toBe("no-new-privileges=true");
    expect(value("--user")).toBe("65532:65532");
    expect(value("--tmpfs")).toMatch(/^\/tmp:rw,noexec,nosuid,nodev,size=128m,mode=1777$/);
    expect(ociContainerName("SB.a")).not.toBe(ociContainerName("SB_a"));
    expect(ociContainerName("x".repeat(128)).length).toBeLessThanOrEqual(128);
    expect(args).not.toContain("--storage-opt");
    expect(args.slice(-3)).toEqual(["alpine:3.20", "sleep", "infinity"]);
  });

  it("rejects unsafe sandbox identifiers, non-DENY networking and shell entrypoints", () => {
    const spec = {id: "SB-OCI-CONTRACT", type: "test", network: {mode: "DENY" as const, allowlist: []}, limits, risk: "LOW" as const};
    expect(() => ociContainerName("../escape")).toThrow(/sandbox id/i);
    expect(() => buildOciCreateArgs(spec, "bob-safe", "alpine:3.20", ["sleep", "infinity"])).toThrow(/name is not bound/i);
    expect(() => buildOciCreateArgs({...spec, network: {mode: "ALLOWLIST" as const, allowlist: ["example.com"]}}, ociContainerName(spec.id), "alpine:3.20", ["sleep", "infinity"])).toThrow(/DENY/i);
    expect(() => buildOciCreateArgs(spec, ociContainerName(spec.id), "alpine:3.20", ["sh", "-c", "echo unsafe"])).toThrow(/shell interpreter/i);
    expect(() => buildOciCreateArgs({...spec, limits: {...limits, storageMb: MAX_RESOURCE_LIMITS.storageMb + 1}}, ociContainerName(spec.id), "alpine:3.20", ["sleep", "infinity"])).toThrow(/broker maximum/i);
  });
});

type DockerInspect = {
  Config: {User: string};
  State: {Running: boolean};
  HostConfig: {
    NetworkMode: string;
    PidMode: string;
    IpcMode: string;
    ReadonlyRootfs: boolean;
    CapDrop: string[];
    SecurityOpt: string[];
    UsernsMode: string;
    Memory: number;
    MemorySwap: number;
    NanoCpus: number;
    PidsLimit: number;
    ShmSize: number;
    Tmpfs: Record<string, string>;
  };
};

function inspectContainer(name: string): DockerInspect {
  const result = spawnSync(dockerCli, ["inspect", name], {encoding: "utf8", timeout: 15_000});
  expect(result.status, result.stderr).toBe(0);
  return (JSON.parse(result.stdout) as DockerInspect[])[0];
}

describe.skipIf(!dockerAvailable)("Real OCI runtime", () => {
  it("enforces OCI flags and completes the real lifecycle with storage quota and restore", async () => {
    const health = await ociContainerRuntime.health();
    expect(health.ok, health.detail).toBe(true);
    const id = `OCI-CI-${Date.now()}`;
    try {
      const created = await ociContainerRuntime.create({
        id,
        type: "integration",
        network: {mode: "DENY", allowlist: []},
        limits,
        risk: "LOW",
        argv: ["sleep", "infinity"],
        image: process.env.BOB_OCI_IMAGE ?? "alpine:3.20"
      });
      expect(created.mode).toBe("REAL_OCI");
      expect(created.state).toBe("READY");

      const started = await ociContainerRuntime.start(id);
      expect(started.state).toBe("RUNNING");
      expect(started.network.mode).toBe("DENY");
      expect(started.limits).toEqual(limits);

      const inspect = inspectContainer(ociContainerName(id));
      const reconciled = await ociContainerRuntime.reconcile();
      expect(reconciled.some(entry => entry.sandboxId === id && entry.state === "RUNNING" && entry.managed)).toBe(true);
      expect(inspect.HostConfig.NetworkMode).toBe("none");
      // An empty PidMode is Docker's private PID namespace default; host would be unsafe.
      expect(inspect.HostConfig.PidMode).toBe("");
      expect(inspect.HostConfig.IpcMode).toBe("private");
      expect(inspect.HostConfig.ReadonlyRootfs).toBe(true);
      expect(inspect.HostConfig.CapDrop).toContain("ALL");
      expect(inspect.HostConfig.SecurityOpt).toContain("no-new-privileges=true");
      expect(inspect.HostConfig.Memory).toBe(limits.memoryMb * 1024 * 1024);
      expect(inspect.HostConfig.MemorySwap).toBe(limits.memoryMb * 1024 * 1024);
      expect(inspect.HostConfig.NanoCpus).toBe(limits.cpuMillicores * 1_000_000);
      expect(inspect.HostConfig.PidsLimit).toBe(limits.processes);
      expect(inspect.HostConfig.ShmSize).toBe(1024 * 1024);
      expect(inspect.Config.User).toBe("65532:65532");
      const tmpfs = inspect.HostConfig.Tmpfs["/tmp"];
      expect(tmpfs).toContain("noexec");
      expect(tmpfs).toContain("nosuid");
      expect(tmpfs).toContain(`size=${limits.storageMb}m`);

      const execution = await ociContainerRuntime.execute(id, ["echo", "oci-ok"]);
      expect(execution.accepted).toBe(true);
      expect(execution.exitCode).toBe(0);
      expect(execution.stdout).toContain("oci-ok");

      const readOnlyProbe = await ociContainerRuntime.execute(id, ["touch", "/bob-readonly-probe"]);
      expect(readOnlyProbe.accepted).toBe(false);
      expect(readOnlyProbe.stderr).toMatch(/read-only file system/i);

      // `/` ist read-only; `/tmp` ist nach `storageMb` begrenzt und `/dev/shm`
      // wird separat auf 1 MiB gekappt. Ein Write über die /tmp-Quota muss scheitern.
      const storageProbe = await ociContainerRuntime.execute(id, ["dd", "if=/dev/zero", "of=/tmp/bob-quota-probe", "bs=1048576", `count=${limits.storageMb + 1}`]);
      expect(storageProbe.accepted).toBe(false);
      expect(storageProbe.exitCode).not.toBe(0);
      expect(storageProbe.stderr).toMatch(/no space left|file too large/i);
      expect((await ociContainerRuntime.execute(id, ["rm", "-f", "/tmp/bob-quota-probe"])).accepted).toBe(true);

      const timed = await ociContainerRuntime.execute(id, ["sleep", "30"], 1_000);
      expect(timed.timedOut).toBe(true);
      expect(timed.accepted).toBe(false);
      expect(ociContainerRuntime.handle(id)?.state).toBe("FAILED");
      expect(inspectContainer(ociContainerName(id)).State.Running).toBe(false);

      const reset = await ociContainerRuntime.reset(id);
      expect(reset.state).toBe("READY");
      expect(reset.limits).toEqual(limits);
      const restartedAfterReset = await ociContainerRuntime.start(id);
      expect(restartedAfterReset.state).toBe("RUNNING");
      expect((await ociContainerRuntime.execute(id, ["echo", "reset-ok"])).stdout).toContain("reset-ok");

      const snapshot = await ociContainerRuntime.snapshot(id);
      expect(snapshot.state).toBe("SNAPSHOTTED");
      expect(snapshot.digest).toMatch(/^[a-f0-9]{64}$/);

      await ociContainerRuntime.destroy(id);
      expect(ociContainerRuntime.handle(id)).toBeUndefined();
      expect(spawnSync(dockerCli, ["inspect", ociContainerName(id)], {encoding: "utf8"}).status).not.toBe(0);

      const restored = await ociContainerRuntime.restore(id, snapshot.id);
      expect(restored.mode).toBe("REAL_OCI");
      expect(restored.state).toBe("RESTORED");
      expect(restored.limits).toEqual(limits);

      const restarted = await ociContainerRuntime.start(id);
      expect(restarted.state).toBe("RUNNING");
      const afterRestore = await ociContainerRuntime.execute(id, ["echo", "restored"]);
      expect(afterRestore.accepted).toBe(true);
      expect(afterRestore.stdout).toContain("restored");
      const restoredInspect = inspectContainer(ociContainerName(id));
      expect(restoredInspect.HostConfig.ReadonlyRootfs).toBe(true);
      expect(restoredInspect.HostConfig.NetworkMode).toBe("none");
      expect(restoredInspect.Config.User).toBe("65532:65532");
    } finally {
      await ociContainerRuntime.destroy(id).catch(() => undefined);
    }
  }, 180_000);
});
