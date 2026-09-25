import {NextResponse} from "next/server";
import {listRuns, createRun, startRun, completeRun, failRun, cancelRun, beginRecovery, rollbackRun, attachExecution} from "@/lib/runs";
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
  const body = await request.json();
  const denied = guardOrDeny(request, {
    action: "run:manage",
    taskId: typeof body.taskId === "string" ? body.taskId : undefined,
    sandboxId: typeof body.sandboxId === "string" ? body.sandboxId : undefined
  });
  if (denied) return denied;

  let result = null;
  if (body.action === "create") {
    const run = createRun({taskId: body.taskId, agentId: body.agentId, risk: body.risk as Risk, sandboxId: body.sandboxId});
    if (run && typeof body.jobId === "string" && typeof body.sandboxId === "string") attachExecution(run.runId, body.jobId, body.sandboxId);
    result = run;
  }
  if (body.action === "start") result = startRun(body.runId);
  if (body.action === "complete") result = completeRun(body.runId);
  if (body.action === "fail") result = failRun(body.runId, body.error);
  if (body.action === "cancel") result = cancelRun(body.runId);
  if (body.action === "recover") result = beginRecovery(body.runId);
  if (body.action === "rollback") result = rollbackRun(body.runId, body.artifactId);
  if (!result) {
    return NextResponse.json({error: "invalid transition", action: body.action ?? null}, {status: 409, headers: {"Cache-Control": "no-store"}});
  }
  return NextResponse.json({run: result}, {status: body.action === "create" ? 201 : 200, headers: {"Cache-Control": "no-store"}});
}
