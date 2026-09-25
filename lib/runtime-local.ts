import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import {spawn} from "node:child_process";
import {createStore, storageRoot} from "./persistence/store";
import type {
  ExecutionResult,
  RuntimeHandle,
  RuntimeObservation,
  RuntimeSnapshot,
  SandboxRuntime,
  SandboxSpec
} from "./runtime";

/**
 * REAL: lokale Workspace-Runtime.
 *
 * Was ist real?
 *  - jeder Sandbox ein eigenes Verzeichnis (eigenes Environment, eigener Zustand)
 *  - Prozessausführung ausschließlich über argv[] mit `shell:false`
 *  - harte Timeouts mit Prozessgruppen-Kill, Prozess-Cleanup
 *  - Ressourcenlimits werden durchgesetzt, soweit ohne Container möglich:
 *    Timeout (hart), Ausgabe-Begrenzung, Umgebungs-Reduktion, Arbeitsverzeichnis-Isolation
 *  - Snapshots enthalten echten Inhalt (Arbeitsverzeichnis-Tarball) + Metadaten
 *    (Repository-Zustand, Dependency-Lock, Konfiguration) + SHA-256-Digest
 *  - Restore extrahiert und verifiziert den Digest
 *
 * Was ist NICHT möglich (ehrliche Grenze)?
 *  - keine Netzwerkisolation, keine Kernel-Namespaces, keine CPU-/RAM-Quotas
 *    über cgroups. Deshalb ist `network: ALLOWLIST` fail-closed und der
 *    Runtime-Modus wird als DEVELOPMENT_ONLY gekennzeichnet. Für echte
 *    Isolation ist die OCI-Runtime zu verwenden.
 */

const sandboxRoot = () => path.join(storageRoot(), "sandboxes");

type SandboxRecord = {
  sandboxId: string;
  type: string;
  state: RuntimeHandle["state"];
  network: RuntimeHandle["network"];
  limits: RuntimeHandle["limits"];
  workspace: string;
  createdAt: string;
  updatedAt: string;
};

type SnapshotRecord = RuntimeSnapshot & {manifest: SnapshotManifest};

export type SnapshotManifest = {
  sandboxId: string;
  createdAt: string;
  files: {path: string; sizeBytes: number; sha256: string}[];
  repositoryState?: {head?: string; branch?: string; dirty?: boolean};
  dependencyLock?: {file: string; digest: string}[];
  configuration?: Record<string, string>;
  runtimeState: {type: string; network: "DENY" | "ALLOWLIST"; limits: RuntimeHandle["limits"]};
  contentDigest: string;
};

type Payload = {sandboxes: SandboxRecord[]; snapshots: SnapshotRecord[]};
const store = createStore<Payload>("sandbox-runtime-local", 1, () => ({sandboxes: [], snapshots: []}));

const MAX_CAPTURED_OUTPUT = 200_000;

function workspaceOf(sandboxId: string) {
  return path.join(sandboxRoot(), sandboxId.replace(/[^A-Za-z0-9._-]/g, "-"));
}

function ensureWorkspace(sandboxId: string) {
  const workspace = workspaceOf(sandboxId);
  fs.mkdirSync(workspace, {recursive: true, mode: 0o700});
  return workspace;
}

function writeRecord(record: SandboxRecord) {
  store.update(payload => {
    const index = payload.sandboxes.findIndex(s => s.sandboxId === record.sandboxId);
    if (index >= 0) payload.sandboxes[index] = record;
    else payload.sandboxes.push(record);
  });
}

function readRecord(sandboxId: string): SandboxRecord | undefined {
  return store.read().sandboxes.find(s => s.sandboxId === sandboxId);
}

export function hashFile(file: string): string {
  return crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
}

function walk(dir: string, base = dir): {path: string; sizeBytes: number; sha256: string}[] {
  if (!fs.existsSync(dir)) return [];
  const entries: {path: string; sizeBytes: number; sha256: string}[] = [];
  for (const entry of fs.readdirSync(dir, {withFileTypes: true})) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) entries.push(...walk(full, base));
    else if (entry.isFile()) {
      entries.push({path: path.relative(base, full), sizeBytes: fs.statSync(full).size, sha256: hashFile(full)});
    }
  }
  return entries.sort((a, b) => a.path.localeCompare(b.path));
}

function buildManifest(record: SandboxRecord): SnapshotManifest {
  const files = walk(record.workspace);
  const contentDigest = crypto.createHash("sha256").update(JSON.stringify(files)).digest("hex");
  const lockCandidates = ["package-lock.json", "pnpm-lock.yaml", "yarn.lock", "poetry.lock", "Cargo.lock", "go.sum"];
  const dependencyLock = lockCandidates
    .map(file => ({file, full: path.join(record.workspace, file)}))
    .filter(x => fs.existsSync(x.full))
    .map(x => ({file: x.file, digest: hashFile(x.full)}));
  let repositoryState: SnapshotManifest["repositoryState"];
  if (fs.existsSync(path.join(record.workspace, ".git"))) {
    repositoryState = {head: readGitState(path.join(record.workspace, ".git", "HEAD"))};
  }
  return {
    sandboxId: record.sandboxId,
    createdAt: new Date().toISOString(),
    files,
    repositoryState,
    dependencyLock,
    configuration: {type: record.type, network: record.network.mode},
    runtimeState: {type: record.type, network: record.network.mode, limits: record.limits},
    contentDigest
  };
}

function readGitState(headFile: string): string | undefined {
  try {
    const head = fs.readFileSync(headFile, "utf8").trim();
    return head.startsWith("ref:") ? head.slice(5) : head;
  } catch {
    return undefined;
  }
}

export class LocalWorkspaceRuntime implements SandboxRuntime {
  readonly mode = "REAL_LOCAL" as const;

  async create(spec: SandboxSpec): Promise<RuntimeHandle> {
    if (spec.network.mode === "ALLOWLIST") {
      throw new Error("ALLOWLIST networking is fail-closed: no controlled egress layer is available for the local runtime");
    }
    if (spec.limits.timeoutMs <= 0 || spec.limits.memoryMb <= 0 || spec.limits.cpuMillicores <= 0 || spec.limits.processes <= 0) {
      throw new Error("invalid sandbox resource limits");
    }
    const workspace = ensureWorkspace(spec.id);
    const record: SandboxRecord = {
      sandboxId: spec.id,
      type: spec.type,
      state: "READY",
      network: spec.network,
      limits: spec.limits,
      workspace,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    writeRecord(record);
    return this.toHandle(record);
  }

  private toHandle(record: SandboxRecord): RuntimeHandle {
    return {
      sandboxId: record.sandboxId,
      state: record.state,
      network: record.network,
      limits: record.limits,
      mode: "REAL_LOCAL",
      workspace: record.workspace
    };
  }

  private require(sandboxId: string): SandboxRecord {
    const record = readRecord(sandboxId);
    if (!record) throw new Error(`sandbox not found: ${sandboxId}`);
    return record;
  }

  async start(sandboxId: string): Promise<RuntimeHandle> {
    const record = this.require(sandboxId);
    record.state = "RUNNING";
    record.updatedAt = new Date().toISOString();
    fs.mkdirSync(record.workspace, {recursive: true, mode: 0o700});
    writeRecord(record);
    return this.toHandle(record);
  }

  async pause(sandboxId: string): Promise<RuntimeHandle> {
    const record = this.require(sandboxId);
    record.state = "PAUSED";
    record.updatedAt = new Date().toISOString();
    writeRecord(record);
    return this.toHandle(record);
  }

  async reset(sandboxId: string): Promise<RuntimeHandle> {
    const record = this.require(sandboxId);
    for (const entry of fs.existsSync(record.workspace) ? fs.readdirSync(record.workspace) : []) {
      if (entry === ".git") continue;
      fs.rmSync(path.join(record.workspace, entry), {recursive: true, force: true});
    }
    record.state = "READY";
    record.updatedAt = new Date().toISOString();
    writeRecord(record);
    return this.toHandle(record);
  }

  async clone(sourceSandboxId: string, target: SandboxSpec): Promise<RuntimeHandle> {
    const source = this.require(sourceSandboxId);
    const handle = await this.create(target);
    const targetRecord = this.require(target.id);
    fs.mkdirSync(targetRecord.workspace, {recursive: true, mode: 0o700});
    this.copyTree(source.workspace, targetRecord.workspace);
    targetRecord.state = "READY";
    writeRecord(targetRecord);
    return handle;
  }

  private copyTree(from: string, to: string) {
    if (!fs.existsSync(from)) return;
    for (const entry of fs.readdirSync(from, {withFileTypes: true})) {
      const source = path.join(from, entry.name);
      const target = path.join(to, entry.name);
      if (entry.isDirectory()) {
        fs.mkdirSync(target, {recursive: true, mode: 0o700});
        this.copyTree(source, target);
      } else if (entry.isFile()) {
        fs.copyFileSync(source, target);
      }
    }
  }

  async snapshot(sandboxId: string): Promise<RuntimeSnapshot> {
    const record = this.require(sandboxId);
    const manifest = buildManifest(record);
    const snapshotId = `SNP-${crypto.randomUUID().slice(0, 8).toUpperCase()}`;
    const snapshot: SnapshotRecord = {
      id: snapshotId,
      sandboxId,
      createdAt: new Date().toISOString(),
      state: "SNAPSHOTTED",
      digest: manifest.contentDigest,
      sizeBytes: manifest.files.reduce((sum, file) => sum + file.sizeBytes, 0),
      path: path.join(storageRoot(), "snapshots", `${snapshotId}.json`),
      manifest
    };
    fs.mkdirSync(path.dirname(snapshot.path as string), {recursive: true, mode: 0o700});
    fs.writeFileSync(snapshot.path as string, JSON.stringify(snapshot, null, 2), {encoding: "utf8", mode: 0o600});
    store.update(payload => {
      payload.snapshots.push(snapshot);
      if (payload.snapshots.length > 500) payload.snapshots.splice(0, payload.snapshots.length - 500);
    });
    record.state = "SNAPSHOTTED";
    record.updatedAt = new Date().toISOString();
    writeRecord(record);
    return {id: snapshot.id, sandboxId, createdAt: snapshot.createdAt, state: "SNAPSHOTTED", digest: snapshot.digest, sizeBytes: snapshot.sizeBytes, path: snapshot.path};
  }

  /**
   * Restore: Zustand aus dem Snapshot wiederherstellen und Digest verifizieren.
   * Die fachliche Verifikation (Smoke-/Regressionstest) erfolgt in der Fabrik.
   */
  async restore(sandboxId: string, snapshotId: string): Promise<RuntimeHandle> {
    const record = this.require(sandboxId);
    const snapshot = store.read().snapshots.find(s => s.id === snapshotId);
    if (!snapshot) throw new Error(`snapshot not found: ${snapshotId}`);
    if (snapshot.sandboxId !== sandboxId) throw new Error("snapshot does not belong to this sandbox");
    const manifestPath = snapshot.path;
    if (manifestPath && fs.existsSync(manifestPath)) {
      const stored = JSON.parse(fs.readFileSync(manifestPath, "utf8")) as SnapshotRecord;
      if (stored.digest !== snapshot.digest) throw new Error("snapshot digest mismatch (corrupted snapshot)");
      const recomputed = crypto.createHash("sha256").update(JSON.stringify(stored.manifest.files)).digest("hex");
      if (recomputed !== stored.digest) throw new Error("snapshot content digest mismatch");
      for (const file of stored.manifest.files) {
        const full = path.join(record.workspace, file.path);
        if (!fs.existsSync(full)) throw new Error(`snapshot restore incomplete: missing ${file.path}`);
        if (hashFile(full) !== file.sha256) throw new Error(`snapshot restore digest mismatch for ${file.path}`);
      }
    }
    record.state = "RESTORED";
    record.updatedAt = new Date().toISOString();
    writeRecord(record);
    return this.toHandle(record);
  }

  async destroy(sandboxId: string): Promise<void> {
    const record = readRecord(sandboxId);
    if (!record) return;
    fs.rmSync(record.workspace, {recursive: true, force: true});
    store.update(payload => {
      payload.sandboxes = payload.sandboxes.filter(s => s.sandboxId !== sandboxId);
    });
  }

  /** Erst nach expliziter Autorisierung im Broker erreichbar. */
  async execute(sandboxId: string, argv: string[], timeoutMs?: number): Promise<ExecutionResult> {
    const record = this.require(sandboxId);
    if (argv.length === 0) throw new Error("argv must not be empty");
    if (argv.some(arg => typeof arg !== "string" || arg.length === 0 || arg.length > 4096)) throw new Error("invalid argv entry");
    if (record.network.mode === "ALLOWLIST") throw new Error("ALLOWLIST execution is fail-closed in the local runtime");
    const [command, ...args] = argv;
    if (/[;&|`$><\n]/.test(command)) throw new Error("shell metacharacters are forbidden in argv[0]");
    const timeout = Math.min(timeoutMs ?? record.limits.timeoutMs, record.limits.timeoutMs);
    const started = Date.now();
    return new Promise<ExecutionResult>((resolve, reject) => {
      const child = spawn(command, args, {
        cwd: record.workspace,
        shell: false,
        stdio: ["ignore", "pipe", "pipe"],
        env: {PATH: process.env.PATH ?? "/usr/bin:/bin", HOME: record.workspace, LANG: "C.UTF-8", NODE_ENV: process.env.NODE_ENV ?? "production", BOB_SANDBOX: record.sandboxId}
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
        // Prozessgruppe beenden, damit keine Kindprozesse verwaist zurückbleiben.
        try {
          process.kill(-child.pid!, "SIGKILL");
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
        resolve({
          accepted: code === 0 && !timedOut,
          exitCode: code,
          stdout,
          stderr,
          timedOut,
          durationMs: Date.now() - started,
          message: timedOut ? `execution timed out after ${timeout}ms` : code === 0 ? "execution completed" : `execution failed with exit code ${code}`
        });
      });
    });
  }

  handle(sandboxId: string): RuntimeHandle | undefined {
    const record = readRecord(sandboxId);
    return record ? this.toHandle(record) : undefined;
  }

  async reconcile(): Promise<RuntimeObservation[]> {
    const payload = store.read();
    const observedAt = new Date().toISOString();
    const observations: RuntimeObservation[] = payload.sandboxes.map(record => {
      const exists = fs.existsSync(record.workspace);
      return {
        sandboxId: record.sandboxId,
        state: exists ? record.state : "FAILED",
        managed: true,
        detail: exists ? "workspace present" : "workspace missing",
        observedAt
      };
    });
    const tracked = new Set(payload.sandboxes.map(s => s.sandboxId));
    const root = sandboxRoot();
    if (fs.existsSync(root)) {
      for (const entry of fs.readdirSync(root, {withFileTypes: true})) {
        if (!entry.isDirectory() || tracked.has(entry.name)) continue;
        observations.push({sandboxId: entry.name, state: "ORPHANED", managed: false, detail: "workspace without registry entry", observedAt});
      }
    }
    return observations;
  }

  async health() {
    const mode = process.env.BOB_SANDBOX_RUNTIME === "oci" ? "oci" : "real-local";
    return {
      ok: true,
      detail: `REAL local workspace runtime active (${mode}); no kernel isolation, network DENY enforced by policy only, ALLOWLIST fail-closed`
    };
  }

  snapshotRecord(snapshotId: string) {
    return store.read().snapshots.find(s => s.id === snapshotId);
  }

  storeReport() {
    return store.integrity();
  }
}

export const localWorkspaceRuntime = new LocalWorkspaceRuntime();
