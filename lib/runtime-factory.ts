import {localWorkspaceRuntime} from "./runtime-local";
import {ociContainerRuntime} from "./oci-runtime";
import {sandboxRuntime as mockRuntime, type SandboxRuntime} from "./runtime";
import {isolationReport} from "./ns-isolation";

/**
 * Fail-closed Runtime-Auswahl (Abschnitt 12/47).
 *
 *  BOB_SANDBOX_RUNTIME=local  → REAL lokale Workspace-Runtime (Standard)
 *  BOB_SANDBOX_RUNTIME=oci    → REAL OCI/Docker-Runtime (benötigt Docker-Daemon;
 *                               fehlt er, schlägt jede Ausführung fehl)
 *  BOB_SANDBOX_RUNTIME=mock   → MOCK; nur zulässig, wenn BOB_ALLOW_MOCK_RUNTIME=1
 *                               (Entwicklung/Tests). Mocks werden niemals als
 *                               reale Isolation dargestellt.
 */

export type RuntimeMode = "local" | "oci" | "mock";

export function requestedRuntimeMode(): RuntimeMode {
  const raw = (process.env.BOB_SANDBOX_RUNTIME ?? "local").toLowerCase();
  if (raw === "local" || raw === "oci" || raw === "mock") return raw;
  throw new Error(`unsupported BOB_SANDBOX_RUNTIME: ${raw}`);
}

export function runtimeModeLabel(): string {
  const mode = requestedRuntimeMode();
  if (mode === "local") return "REAL_LOCAL";
  if (mode === "oci") return "REAL_OCI";
  return "MOCK";
}

function select(): SandboxRuntime {
  const mode = requestedRuntimeMode();
  if (mode === "mock") {
    if (process.env.BOB_ALLOW_MOCK_RUNTIME !== "1") {
      throw new Error("MOCK runtime requires BOB_ALLOW_MOCK_RUNTIME=1; refusing to simulate isolation silently");
    }
    return mockRuntime;
  }
  if (mode === "oci") return ociContainerRuntime;
  return localWorkspaceRuntime;
}

export const activeSandboxRuntime: SandboxRuntime = select();
export const activeRuntimeMode: RuntimeMode = requestedRuntimeMode();

export async function runtimeHealth() {
  const health = await activeSandboxRuntime.health();
  const isolation = isolationReport();
  return {
    mode: runtimeModeLabel(),
    requested: activeRuntimeMode,
    ok: health.ok,
    detail: health.detail,
    networkDefault: "DENY" as const,
    allowlist: "FAIL_CLOSED" as const,
    isolation: activeRuntimeMode === "oci" ? "CONTAINER" : activeRuntimeMode === "local" ? isolation.level : "NONE",
    isolationDetail: isolation.detail,
    isolationEnforced: isolation.enforced
  };
}

export async function reconcileActiveRuntime() {
  return activeSandboxRuntime.reconcile();
}

export function runtimeHandle(sandboxId: string) {
  return activeSandboxRuntime.handle(sandboxId);
}
