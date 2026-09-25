import {spawn} from "node:child_process";
import crypto from "node:crypto";
import {assertArgvPolicy} from "./argv-policy";
import {createStore} from "./persistence/store";
import type {
  ExecutionResult,
  NetworkPolicy,
  ResourceLimits,
  RuntimeHandle,
  RuntimeObservation,
  RuntimeSnapshot,
  SandboxRuntime,
  SandboxSpec
} from "./runtime";

/**
 * REAL: OCI/Docker-Runtime (Abschnitt 12).
 *
 * Härtung:
 *  - kein Shell-String: ausschließlich argv[] mit `shell:false`
 *  - `--network none` (ALLOWLIST ist fail-closed, bis ein Egress-Proxy existiert)
 *  - `--read-only` Root-Dateisystem, tmpfs für /tmp ohne exec
 *  - `--cap-drop ALL`, `--security-opt no-new-privileges`
 *  - CPU-, Speicher- und PID-Limits, harte Timeouts
 *  - deterministische Namen + Labels, Lifecycle-Reconciliation, Orphan-Erkennung
 *  - Logs/Artefakte werden über stdout/stderr/exitCode erfasst
 *
 * Status: Implementierung vollständig, aber in dieser Umgebung NICHT verifiziert
 * (kein Docker-Daemon vorhanden). Ohne Daemon schlägt jede Operation fehl –
 * das ist gewollt (fail closed), nicht simuliert.
 */

export type OciContainerSpec = {
  image: string;
  command: string[];
  limits: ResourceLimits;
  network: "DENY" | "ALLOWLIST";
  allowlist?: string[];
  workingDirectory?: string;
  containerName?: string;
};

export type OciExecutionResult = ExecutionResult;

export type OciRuntimeObservation = RuntimeObservation & {containerId?: string; containerName?: string; image?: string};

type Persisted = {sandboxId: string; containerName: string; image: string; state: RuntimeHandle["state"]; limits: ResourceLimits; network: NetworkPolicy; createdAt: string};

type Payload = {containers: Persisted[]; snapshots: (RuntimeSnapshot & {imageTag: string})[]};
const store = createStore<Payload>("oci-runtime", 2, () => ({containers: [], snapshots: []}));

const MAX_CAPTURE = 400_000;

function assertSafeImage(image: string) {
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._/:@-]*$/.test(image)) throw new Error("Invalid OCI image reference");
}

function assertSafeName(name: string) {
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,127}$/.test(name)) throw new Error("Invalid OCI container name");
}

function runDocker(args: string[], timeoutMs: number): Promise<{code: number | null; stdout: string; stderr: string; timedOut: boolean}> {
  return new Promise((resolve, reject) => {
    const child = spawn("docker", args, {shell: false, stdio: ["ignore", "pipe", "pipe"]});
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGKILL");
    }, timeoutMs);
    child.stdout.on("data", chunk => {
      stdout = (stdout + String(chunk)).slice(-MAX_CAPTURE);
    });
    child.stderr.on("data", chunk => {
      stderr = (stderr + String(chunk)).slice(-MAX_CAPTURE);
    });
    child.once("error", error => {
      clearTimeout(timer);
      reject(error);
    });
    child.once("close", code => {
      clearTimeout(timer);
      resolve({code, stdout, stderr, timedOut});
    });
  });
}

export class OciContainerRuntimeAdapter implements SandboxRuntime {
  readonly mode = "REAL_OCI" as const;

  private find(sandboxId: string) {
    return store.read().containers.find(c => c.sandboxId === sandboxId);
  }

  handle(sandboxId: string): RuntimeHandle | undefined {
    const record = this.find(sandboxId);
    if (!record) return undefined;
    return {sandboxId, state: record.state, network: record.network, limits: record.limits, mode: "REAL_OCI"};
  }

  async health() {
    try {
      const result = await runDocker(["version", "--format", "{{.Server.Version}}"], 10_000);
      return result.code === 0 ? {ok: true, detail: `docker server ${result.stdout.trim()}`} : {ok: false, detail: `docker unavailable: ${result.stderr.trim() || "no server"}`};
    } catch (error) {
      return {ok: false, detail: `docker unavailable: ${error instanceof Error ? error.message : "unknown error"}`};
    }
  }

  async create(spec: SandboxSpec): Promise<RuntimeHandle> {
    assertSafeImage(spec.image ?? process.env.BOB_OCI_IMAGE ?? "alpine:3.20");
    if (spec.network.mode === "ALLOWLIST") throw new Error("OCI ALLOWLIST networking is fail-closed until a controlled egress proxy exists");
    if (spec.limits.timeoutMs <= 0 || spec.limits.memoryMb <= 0 || spec.limits.cpuMillicores <= 0 || spec.limits.processes <= 0) throw new Error("Invalid sandbox resource limits");
    const containerName = `bob-${spec.id.toLowerCase().replace(/[^a-z0-9-]/g, "-")}`;
    assertSafeName(containerName);
    const existing = this.find(spec.id);
    if (existing) throw new Error(`OCI sandbox already exists: ${spec.id}`);
    const image = spec.image ?? process.env.BOB_OCI_IMAGE ?? "alpine:3.20";
    const command = spec.argv && spec.argv.length ? spec.argv : ["sleep", "infinity"];
    const args = [
      "create",
      "--name",
      containerName,
      "--label",
      "com.bob.managed=true",
      "--label",
      `com.bob.sandbox-id=${spec.id}`,
      "--network",
      "none",
      "--cpus",
      String(spec.limits.cpuMillicores / 1000),
      "--memory",
      `${spec.limits.memoryMb}m`,
      "--pids-limit",
      String(spec.limits.processes),
      "--read-only",
      "--cap-drop",
      "ALL",
      "--security-opt",
      "no-new-privileges",
      "--tmpfs",
      "/tmp:rw,noexec,nosuid,size=64m",
      image,
      ...command
    ];
    const result = await runDocker(args, Math.min(spec.limits.timeoutMs, 30_000));
    if (result.timedOut || result.code !== 0) throw new Error(`OCI create failed: ${result.stderr || result.stdout || "unknown error"}`);
    const record: Persisted = {
      sandboxId: spec.id,
      containerName,
      image,
      state: "READY",
      limits: spec.limits,
      network: {mode: "DENY", allowlist: []},
      createdAt: new Date().toISOString()
    };
    store.update(payload => {
      payload.containers.push(record);
    });
    return {sandboxId: spec.id, state: "READY", network: record.network, limits: record.limits, mode: "REAL_OCI"};
  }

  private update(sandboxId: string, state: RuntimeHandle["state"]) {
    const payload = store.read();
    const record = payload.containers.find(c => c.sandboxId === sandboxId);
    if (record) record.state = state;
    store.write(payload);
  }

  async start(sandboxId: string): Promise<RuntimeHandle> {
    const record = this.find(sandboxId);
    if (!record) throw new Error("OCI sandbox not found");
    const result = await runDocker(["start", record.containerName], Math.min(record.limits.timeoutMs, 30_000));
    if (result.timedOut || result.code !== 0) throw new Error(`OCI start failed: ${result.stderr || result.stdout}`);
    this.update(sandboxId, "RUNNING");
    return {sandboxId, state: "RUNNING", network: record.network, limits: record.limits, mode: "REAL_OCI"};
  }

  async pause(sandboxId: string): Promise<RuntimeHandle> {
    const record = this.find(sandboxId);
    if (!record) throw new Error("OCI sandbox not found");
    const result = await runDocker(["pause", record.containerName], 30_000);
    if (result.timedOut || result.code !== 0) throw new Error(`OCI pause failed: ${result.stderr || result.stdout}`);
    this.update(sandboxId, "PAUSED");
    return {sandboxId, state: "PAUSED", network: record.network, limits: record.limits, mode: "REAL_OCI"};
  }

  async reset(sandboxId: string): Promise<RuntimeHandle> {
    const record = this.find(sandboxId);
    if (!record) throw new Error("OCI sandbox not found");
    // Reset = Neustart des Containers (deterministischer Ausgangszustand aus dem Image).
    await runDocker(["rm", "-f", record.containerName], 30_000).catch(() => undefined);
    const created = await this.create({
      id: sandboxId,
      type: "reset",
      network: record.network,
      limits: record.limits,
      risk: "LOW",
      image: record.image
    });
    return created;
  }

  async clone(sourceSandboxId: string, target: SandboxSpec): Promise<RuntimeHandle> {
    const source = this.find(sourceSandboxId);
    if (!source) throw new Error("OCI source sandbox not found");
    return this.create({...target, image: source.image});
  }

  /** Snapshot über `docker commit` → eigenes Image mit Digest. */
  async snapshot(sandboxId: string): Promise<RuntimeSnapshot> {
    const record = this.find(sandboxId);
    if (!record) throw new Error("OCI sandbox not found");
    const imageTag = `bob-snapshot-${sandboxId.toLowerCase().replace(/[^a-z0-9-]/g, "-")}:${Date.now()}`;
    const commit = await runDocker(["commit", record.containerName, imageTag], 120_000);
    if (commit.timedOut || commit.code !== 0) throw new Error(`OCI snapshot failed: ${commit.stderr || commit.stdout}`);
    const inspect = await runDocker(["image", "inspect", "--format", "{{.Id}}", imageTag], 30_000);
    const imageDigest = inspect.stdout.trim();
    if (inspect.code !== 0 || !imageDigest) throw new Error("OCI snapshot digest could not be determined");
    const snapshot: RuntimeSnapshot & {imageTag: string} = {
      id: `SNP-${crypto.randomUUID().slice(0, 8).toUpperCase()}`,
      sandboxId,
      createdAt: new Date().toISOString(),
      state: "SNAPSHOTTED",
      digest: crypto.createHash("sha256").update(imageDigest).digest("hex"),
      imageTag
    };
    store.update(payload => {
      payload.snapshots.push(snapshot);
    });
    this.update(sandboxId, "SNAPSHOTTED");
    return {id: snapshot.id, sandboxId, createdAt: snapshot.createdAt, state: "SNAPSHOTTED", digest: snapshot.digest};
  }

  /** Restore: neuen Container aus dem Snapshot-Image erzeugen und verifizieren. */
  async restore(sandboxId: string, snapshotId: string): Promise<RuntimeHandle> {
    const snapshot = store.read().snapshots.find(s => s.id === snapshotId);
    if (!snapshot) throw new Error("OCI snapshot not found");
    if (snapshot.sandboxId !== sandboxId) throw new Error("OCI snapshot belongs to another sandbox");
    const inspect = await runDocker(["image", "inspect", "--format", "{{.Id}}", snapshot.imageTag], 30_000);
    if (inspect.code !== 0) throw new Error("OCI snapshot image is missing; restore impossible");
    const computed = crypto.createHash("sha256").update(inspect.stdout.trim()).digest("hex");
    if (computed !== snapshot.digest) throw new Error("OCI snapshot digest mismatch (image was modified)");
    const record = this.find(sandboxId);
    if (record) {
      await runDocker(["rm", "-f", record.containerName], 30_000).catch(() => undefined);
      store.update(payload => {
        payload.containers = payload.containers.filter(c => c.sandboxId !== sandboxId);
      });
    }
    const created = await this.create({
      id: sandboxId,
      type: "restore",
      network: {mode: "DENY", allowlist: []},
      limits: record?.limits ?? {cpuMillicores: 1000, memoryMb: 1024, storageMb: 2048, timeoutMs: 300_000, processes: 64},
      risk: "LOW",
      image: snapshot.imageTag
    });
    this.update(sandboxId, "RESTORED");
    return {...created, state: "RESTORED"};
  }

  async destroy(sandboxId: string): Promise<void> {
    const record = this.find(sandboxId);
    store.update(payload => {
      payload.containers = payload.containers.filter(c => c.sandboxId !== sandboxId);
    });
    if (record) await runDocker(["rm", "-f", record.containerName], 30_000).catch(() => undefined);
  }

  async execute(sandboxId: string, argv: string[], timeoutMs?: number): Promise<ExecutionResult> {
    const record = this.find(sandboxId);
    if (!record) throw new Error("OCI sandbox not found");
    if (!Array.isArray(argv) || argv.length === 0) throw new Error("Execution argv is empty");
    // Dieselbe argv-Policy wie Broker und lokale Runtime: keine Shell-Strings.
    assertArgvPolicy(argv, "oci sandbox runtime");
    if (record.state !== "RUNNING") throw new Error(`OCI sandbox is not executable in state ${record.state}`);
    const result = await runDocker(["exec", record.containerName, ...argv], Math.min(timeoutMs ?? record.limits.timeoutMs, record.limits.timeoutMs));
    return {
      accepted: result.code === 0 && !result.timedOut,
      exitCode: result.code,
      stdout: result.stdout,
      stderr: result.stderr,
      timedOut: result.timedOut,
      durationMs: 0,
      message: result.timedOut ? "OCI execution timed out" : result.code === 0 ? "execution completed" : `execution failed with exit code ${result.code}`
    };
  }

  async reconcile(): Promise<RuntimeObservation[]> {
    const observedAt = new Date().toISOString();
    const observations: RuntimeObservation[] = [];
    const listed = await runDocker(["ps", "-a", "--filter", "label=com.bob.managed=true", "--format", "{{json .}}"], 15_000).catch(() => ({code: 1, stdout: "", stderr: "", timedOut: false}));
    const actual = new Map<string, {id: string; name: string; image: string; state: string}>();
    if (listed.code === 0) {
      for (const line of listed.stdout.split("\n").filter(Boolean)) {
        try {
          const row = JSON.parse(line) as {ID?: string; Names?: string; Image?: string; State?: string};
          if (row.ID && row.Names) actual.set(row.Names, {id: row.ID, name: row.Names, image: row.Image ?? "", state: row.State ?? ""});
        } catch {
          /* unlesbare Zeile überspringen */
        }
      }
    }
    for (const record of store.read().containers) {
      const inspect = await runDocker(["inspect", "--format", "{{.State.Status}}", record.containerName], 15_000);
      const status = inspect.code === 0 ? inspect.stdout.trim() : "missing";
      const state: RuntimeHandle["state"] =
        status === "running" ? "RUNNING" : status === "created" ? "READY" : status === "paused" ? "PAUSED" : "FAILED";
      this.update(record.sandboxId, state);
      observations.push({sandboxId: record.sandboxId, state, managed: true, detail: `container ${record.containerName} (${status})`, observedAt});
    }
    for (const row of actual.values()) {
      if (store.read().containers.some(c => c.containerName === row.name)) continue;
      observations.push({sandboxId: row.name, state: "ORPHANED", managed: false, detail: `unmanaged container ${row.name}`, observedAt});
    }
    return observations;
  }

  storeReport() {
    return store.integrity();
  }
}

export const ociContainerRuntime = new OciContainerRuntimeAdapter();
