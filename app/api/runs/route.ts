import {NextResponse} from "next/server";
import {listRuns, createRun, startRun, completeRun, failRun, cancelRun, beginRecovery, rollbackRun, attachExecution, getRun, queueRun, leaseRun} from "@/lib/runs";
import {guardOrDeny} from "@/lib/api/api-gate";
import type {Risk} from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Runs (Ausführungsversuche) über HTTP.
 *
 * Lesen verlangt eine authentifizierte Session, Schreiben zusätzlich eine
 * Capability (`run:manage`) oder Creator-Autorität. Die Route liefert bei
 * Verweigerung eine JSON-Antwort (401/403/423) statt zu werfen.
 */
export async function GET(request: Request) {
  const denied = guardOrDeny(request, {action: "run:read"});
  if (denied) return denied;
  return NextResponse.json({runs: listRuns()}, {headers: {"Cache-Control": "no-store"}});
}

export async function POST(request: Request) {
  // Tolerant parsen, damit ein unlesbarer Body nicht als 500 endet.
  const body = (await request.clone().json().catch(() => ({}))) as Record<string, unknown>;
  const denied = guardOrDeny(request, {
    action: "run:manage",
    taskId: typeof body.taskId === "string" ? body.taskId : undefined,
    sandboxId: typeof body.sandboxId === "string" ? body.sandboxId : undefined
  });
  if (denied) return denied;

  // Feldprüfung vor der Zustandsänderung: `undefined` als Lauf-Kennung war
  // früher eine stille 409/200-Antwort (kein Lauf gefunden), jetzt eine 400.
  const action = typeof body.action === "string" ? body.action : undefined;
  if (!action) return NextResponse.json({error: "action is required"}, {status: 400});
  const runId = typeof body.runId === "string" && body.runId.length > 0 ? body.runId : undefined;

  try {
    let result = null;
    if (action === "create") {
      if (typeof body.taskId !== "string" || typeof body.agentId !== "string") {
        return NextResponse.json({error: "taskId and agentId are required"}, {status: 400});
      }
      const run = createRun({taskId: body.taskId, agentId: body.agentId, risk: body.risk as Risk, sandboxId: body.sandboxId as string | undefined});
      if (run && typeof body.jobId === "string" && typeof body.sandboxId === "string") attachExecution(run.runId, body.jobId, body.sandboxId);
      result = run;
    } else {
      if (!runId) return NextResponse.json({error: "runId is required"}, {status: 400});
      if (action === "start") {
        // Ein über die API angelegter Lauf ist CREATED; `startRun` verlangt
        // LEASED. Die Route führte deshalb zu "invalid run transition
        // CREATED -> RUNNING" und war ohne Dispatcher nicht benutzbar. Sie
        // führt jetzt dieselben Schritte wie ein Worker aus — Queue und Lease
        // bleiben dabei explizite, auditierte Übergänge.
        const current = getRun(runId);
        if (!current) return NextResponse.json({error: "run not found", runId}, {status: 404});
        if (current.state === "CREATED") queueRun(runId, "CREATOR");
        if (getRun(runId)?.state === "QUEUED") leaseRun(runId, "CREATOR");
        result = startRun(runId);
      }
      if (action === "complete") result = completeRun(runId);
      if (action === "fail") {
        if (typeof body.error !== "string" || body.error.length === 0) {
          return NextResponse.json({error: "error message is required"}, {status: 400});
        }
        result = failRun(runId, body.error);
      }
      if (action === "cancel") result = cancelRun(runId);
      // `beginRecovery` ist async (führt die Recovery-Stufe aus) — ohne await wären
      // Rückgabe und Fehler nur ein Promise.
      if (action === "recover") result = await beginRecovery(runId);
      if (action === "rollback") result = typeof body.artifactId === "string" ? rollbackRun(runId, body.artifactId) : null;
    }
    if (!result) {
      return NextResponse.json({error: "invalid transition", action}, {status: 409, headers: {"Cache-Control": "no-store"}});
    }
    return NextResponse.json({run: result}, {status: action === "create" ? 201 : 200, headers: {"Cache-Control": "no-store"}});
  } catch (error) {
    return NextResponse.json({error: error instanceof Error ? error.message : "invalid run transition", action}, {status: 400, headers: {"Cache-Control": "no-store"}});
  }
}
