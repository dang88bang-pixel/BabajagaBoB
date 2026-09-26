import {NextResponse} from "next/server";
import {activeRuntimeMode, reconcileActiveRuntime} from "../../../lib/runtime-factory";
import {executeAuthorized} from "../../../lib/execution-broker";
import {listSandboxes} from "../../../lib/sandbox/fabric";
import {isolationReport} from "../../../lib/ns-isolation";
import {guardRequest, toDeniedResponse} from "../../../lib/api/guard";
import {actionField, readJson, stringArray, stringField} from "../../../lib/request-validation";

/**
 * Runtime-Status und autorisierte Ausführung (Abschnitt 10/12).
 *
 *   Agent/Creator → POST /api/runtime {action:"execute"} → Execution Broker
 *                 → Isolierte Runtime → Evidence
 *
 * Es gibt hier bewusst keine Sandbox-Verwaltung: Lebenszyklus und Snapshots
 * laufen über `/api/sandboxes` (Creator-only). `execute` verlangt ein gültiges
 * Capability-Token; der Broker prüft danach alle 17 Bedingungen (Subjekt, Task,
 * Sandbox, Risiko, Umgebung, Gate, Approval, Netzwerk, Ressourcen).
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  try {
    guardRequest(req, {action: "runtime:read"});
    if (activeRuntimeMode !== "oci") {
      // Der Isolationszustand wird gemessen, nicht behauptet (siehe lib/ns-isolation.ts).
      return NextResponse.json({
        mode: activeRuntimeMode,
        health: "READY",
        network: "DENY",
        isolation: isolationReport(),
        observations: [],
        summary: {total: 0, running: 0, ready: 0, paused: 0, failed: 0, orphaned: 0}
      });
    }
    const observations = await reconcileActiveRuntime();
    const summary = {
      total: observations.length,
      running: observations.filter(x => x.state === "RUNNING").length,
      ready: observations.filter(x => x.state === "READY").length,
      paused: observations.filter(x => x.state === "PAUSED").length,
      failed: observations.filter(x => x.state === "FAILED").length,
      orphaned: observations.filter(x => x.state === "ORPHANED").length
    };
    return NextResponse.json({
      mode: activeRuntimeMode,
      health: summary.failed > 0 || summary.orphaned > 0 ? "DEGRADED" : "READY",
      network: "DENY",
      observations,
      summary,
      adapter: "docker/oci"
    });
  } catch (error) {
    // Verweigerungen bleiben Verweigerungen (401/403), nur echte
    // Runtime-Probleme werden zu 503.
    const denied = toDeniedResponse(error);
    if (denied) return denied;
    return NextResponse.json({mode: activeRuntimeMode, health: "ERROR", error: error instanceof Error ? error.message : "runtime status failed"}, {status: 503});
  }
}

export async function POST(request: Request) {
  try {
    const body = await readJson(request);
    const action = actionField(body, ["execute", "reconcile"]);

    if (action === "reconcile") {
      guardRequest(request, {action: "runtime:reconcile", creatorOnly: true});
      return NextResponse.json({mode: activeRuntimeMode, observations: await reconcileActiveRuntime()});
    }

    const taskId = stringField(body, "taskId", 128);
    const sandboxId = stringField(body, "sandboxId", 128);
    const agentId = stringField(body, "agentId", 128);
    // Authentifizierung über das Gate; Bindung für Agenten über die Capability.
    // Die Umgebung ist die der Sandbox (kein Default): ein Token für eine
    // `test`-Sandbox darf nicht in `development` ausgeführt werden und umgekehrt.
    const sandbox = listSandboxes().find(entry => entry.sandboxId === sandboxId);
    if (!sandbox) throw Object.assign(new Error("sandbox not found"), {status: 404, code: "SANDBOX_NOT_FOUND"});
    guardRequest(request, {action: "sandbox:run", taskId, sandboxId, environment: sandbox.type, requireAgentCapability: "task:execute"});

    const argv = stringArray(body.argv, "argv", 64, 4096);
    return NextResponse.json(
      await executeAuthorized({
        taskId,
        agentId,
        sandboxId,
        capabilityTokenId: stringField(body, "capabilityTokenId", 128),
        approvalId: typeof body.approvalId === "string" ? body.approvalId : undefined,
        runId: typeof body.runId === "string" ? body.runId : undefined,
        experimentId: typeof body.experimentId === "string" ? body.experimentId : undefined,
        argv
      })
    );
  } catch (error) {
    if (error instanceof Error && "status" in error) {
      const denied = error as {status: number; code?: string; message: string};
      return NextResponse.json({error: denied.code ?? "DENIED", message: denied.message}, {status: denied.status});
    }
    return NextResponse.json({error: error instanceof Error ? error.message : "runtime error", denied: true}, {status: 409});
  }
}
