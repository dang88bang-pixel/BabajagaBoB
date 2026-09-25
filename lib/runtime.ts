import type {ResourceLimits, Risk} from "./types";

export type {ResourceLimits};

/**
 * Sandbox-Runtime-Vertrag (Abschnitt 11/12/47).
 *
 * Klassifizierung der Implementierungen:
 *  - `LocalWorkspaceRuntime` (lib/runtime-local.ts) → REAL (lokales Dateisystem,
 *    echter argv-Prozess, echte Tarball-Snapshots). Mit aktivierter
 *    Kernel-Isolation (`lib/ns-isolation.ts`, `BOB_NS_ISOLATION=auto|on`)
 *    laufen die Prozesse zusätzlich in eigenen Kernel-Namespaces (Netzwerk,
 *    PID, IPC, UTS, Mount, User), mit read-only Rootfs, geleertem
 *    Capability-Bounding-Set und `no_new_privs`.
 *  - `OciContainerRuntimeAdapter` (lib/oci-runtime.ts) → REAL, sofern ein
 *    Docker/OCI-Daemon verfügbar ist; sonst FAIL CLOSED.
 *  - `MockSandboxRuntime`               → MOCK. Nur für Entwicklung/Tests,
 *    niemals als reale Isolation darstellen.
 */

export type SandboxRuntimeState = "CREATED" | "READY" | "RUNNING" | "PAUSED" | "SNAPSHOTTED" | "RESTORED" | "DESTROYED" | "FAILED";

export type NetworkPolicy = {mode: "DENY" | "ALLOWLIST"; allowlist: string[]};

export type SandboxSpec = {
  id: string;
  type: string;
  network: NetworkPolicy;
  limits: ResourceLimits;
  risk: Risk;
  /** Optionale Startargumente (argv, keine Shell-Strings). */
  argv?: string[];
  image?: string;
};

export type RuntimeSnapshot = {
  id: string;
  sandboxId: string;
  createdAt: string;
  state: SandboxRuntimeState;
  /** SHA-256 über den tatsächlichen Snapshot-Inhalt. */
  digest: string;
  sizeBytes?: number;
  path?: string;
};

export type IsolationLevel = "FILESYSTEM_ONLY" | "NAMESPACES";

export type RuntimeHandle = {
  sandboxId: string;
  state: SandboxRuntimeState;
  network: NetworkPolicy;
  limits: ResourceLimits;
  mode: "REAL_LOCAL" | "REAL_OCI" | "MOCK";
  workspace?: string;
  /** Tatsächlich erzwungene Isolationsebene (keine Behauptung, sondern Zustand). */
  isolation?: IsolationLevel;
};

export type ExecutionResult = {
  accepted: boolean;
  exitCode: number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
  durationMs: number;
  message: string;
  /**
   * Digest-gebundene Evidenz zur Ausführung (vom Broker gesetzt, Abschnitt 4).
   * Fehlt sie, wurde der Lauf nicht über den autorisierten Broker ausgeführt.
   */
  evidence?: {artifactId: string; digest: string; verified: boolean; truncated: boolean};
  /** Isolationsstufe, in der dieser Lauf tatsächlich ausgeführt wurde. */
  isolation?: IsolationLevel;
};

export type RuntimeObservation = {
  sandboxId: string;
  state: SandboxRuntimeState | "ORPHANED";
  managed: boolean;
  detail?: string;
  observedAt: string;
};

export interface SandboxRuntime {
  readonly mode: "REAL_LOCAL" | "REAL_OCI" | "MOCK";
  create(spec: SandboxSpec): Promise<RuntimeHandle>;
  start(sandboxId: string): Promise<RuntimeHandle>;
  pause(sandboxId: string): Promise<RuntimeHandle>;
  reset(sandboxId: string): Promise<RuntimeHandle>;
  clone(sourceSandboxId: string, target: SandboxSpec): Promise<RuntimeHandle>;
  snapshot(sandboxId: string): Promise<RuntimeSnapshot>;
  restore(sandboxId: string, snapshotId: string): Promise<RuntimeHandle>;
  destroy(sandboxId: string): Promise<void>;
  execute(sandboxId: string, argv: string[], timeoutMs?: number): Promise<ExecutionResult>;
  handle(sandboxId: string): RuntimeHandle | undefined;
  reconcile(): Promise<RuntimeObservation[]>;
  health(): Promise<{ok: boolean; detail: string}>;
}

/**
 * MOCK-Runtime: bildet Lifecycle-Semantik ab, führt aber nichts real aus.
 * Muss in jeder Anzeige als MOCK gekennzeichnet bleiben.
 */
const mockHandles = new Map<string, RuntimeHandle>();
const mockSnapshots = new Map<string, RuntimeSnapshot>();
const digest = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url");

export class MockSandboxRuntime implements SandboxRuntime {
  readonly mode = "MOCK" as const;

  async create(spec: SandboxSpec): Promise<RuntimeHandle> {
    if (spec.network.mode === "ALLOWLIST") throw new Error("ALLOWLIST networking is fail-closed in MOCK runtime");
    const handle: RuntimeHandle = {sandboxId: spec.id, state: "READY", network: spec.network, limits: spec.limits, mode: "MOCK"};
    mockHandles.set(spec.id, handle);
    return structuredClone(handle);
  }

  async start(sandboxId: string): Promise<RuntimeHandle> {
    const handle = mockHandles.get(sandboxId);
    if (!handle) throw new Error("sandbox not found");
    handle.state = "RUNNING";
    return structuredClone(handle);
  }

  async pause(sandboxId: string): Promise<RuntimeHandle> {
    const handle = mockHandles.get(sandboxId);
    if (!handle) throw new Error("sandbox not found");
    handle.state = "PAUSED";
    return structuredClone(handle);
  }

  async reset(sandboxId: string): Promise<RuntimeHandle> {
    const handle = mockHandles.get(sandboxId);
    if (!handle) throw new Error("sandbox not found");
    handle.state = "READY";
    return structuredClone(handle);
  }

  async clone(sourceSandboxId: string, target: SandboxSpec): Promise<RuntimeHandle> {
    if (!mockHandles.has(sourceSandboxId)) throw new Error("source sandbox not found");
    return this.create(target);
  }

  async snapshot(sandboxId: string): Promise<RuntimeSnapshot> {
    const handle = mockHandles.get(sandboxId);
    if (!handle) throw new Error("sandbox not found");
    const snapshot: RuntimeSnapshot = {
      id: `SNP-${Date.now()}`,
      sandboxId,
      createdAt: new Date().toISOString(),
      state: "SNAPSHOTTED",
      digest: digest({mock: true, sandboxId})
    };
    mockSnapshots.set(snapshot.id, snapshot);
    handle.state = "SNAPSHOTTED";
    return structuredClone(snapshot);
  }

  async restore(sandboxId: string, snapshotId: string): Promise<RuntimeHandle> {
    const handle = mockHandles.get(sandboxId);
    const snapshot = mockSnapshots.get(snapshotId);
    if (!handle || !snapshot || snapshot.sandboxId !== sandboxId) throw new Error("snapshot not found");
    handle.state = "RESTORED";
    return structuredClone(handle);
  }

  async destroy(sandboxId: string): Promise<void> {
    mockHandles.delete(sandboxId);
  }

  async execute(sandboxId: string, argv: string[], timeoutMs?: number): Promise<ExecutionResult> {
    const handle = mockHandles.get(sandboxId);
    if (!handle) throw new Error("sandbox not found");
    if (argv.length === 0) throw new Error("argv must not be empty");
    void timeoutMs;
    if (handle.network.mode === "DENY" && /^(curl|wget|nc|ssh|scp|ftp)$/i.test(argv[0])) {
      return {accepted: false, exitCode: null, stdout: "", stderr: "", timedOut: false, durationMs: 0, message: "network operation rejected by sandbox policy"};
    }
    handle.state = "RUNNING";
    return {accepted: true, exitCode: 0, stdout: "", stderr: "", timedOut: false, durationMs: 0, message: "MOCK execution accepted (no host process started)"};
  }

  handle(sandboxId: string): RuntimeHandle | undefined {
    const handle = mockHandles.get(sandboxId);
    return handle ? structuredClone(handle) : undefined;
  }

  async reconcile(): Promise<RuntimeObservation[]> {
    return [...mockHandles.values()].map(h => ({sandboxId: h.sandboxId, state: h.state, managed: true, detail: "MOCK", observedAt: new Date().toISOString()}));
  }

  async health() {
    return {ok: true, detail: "MOCK runtime active (development only, no isolation)"};
  }
}

export const sandboxRuntime = new MockSandboxRuntime();
