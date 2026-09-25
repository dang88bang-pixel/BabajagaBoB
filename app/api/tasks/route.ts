import {NextResponse} from "next/server";
import {assignTask, createTask, getTask, snapshot, updateTaskStatus} from "../../../lib/control-plane";
import {guardRequest, toDeniedResponse} from "../../../lib/api/guard";
import type {Risk, Status} from "../../../lib/types";

/**
 * Tasks.
 *
 * Lesen: authentifizierte Session. Schreiben: Creator erstellt und weist zu;
 * Statusübergänge sind zusätzlich für Agenten mit `task:execute`-Capability
 * zulässig, aber nur für die eigene, zugewiesene Task.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const RISKS: Risk[] = ["SAFE", "LOW", "MODERATE", "HIGH", "CRITICAL"];

export async function GET(req: Request) {
  try {
    guardRequest(req, {action: "task:read"});
    return NextResponse.json(snapshot().tasks, {headers: {"Cache-Control": "no-store"}});
  } catch (error) {
    const denied = toDeniedResponse(error);
    if (denied) return denied;
    throw error;
  }
}

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as Record<string, unknown>;
    const action = String(body.action ?? "");

    if (action === "create") {
      const risk = (RISKS.includes(body.risk as Risk) ? body.risk : "LOW") as Risk;
      const guard = guardRequest(req, {action: "task:create", creatorOnly: true, risk});
      const task = createTask({
        missionId: String(body.missionId ?? ""),
        objectiveId: typeof body.objectiveId === "string" ? body.objectiveId : undefined,
        title: String(body.title ?? ""),
        risk,
        assignedAgent: typeof body.assignedAgent === "string" ? body.assignedAgent : undefined,
        requiresApproval: typeof body.requiresApproval === "boolean" ? body.requiresApproval : undefined,
        createdBy: guard.actor.actorId
      });
      return NextResponse.json({task}, {status: 201});
    }

    if (action === "assign") {
      const taskId = String(body.taskId ?? "");
      guardRequest(req, {action: "task:assign", creatorOnly: true, taskId});
      return NextResponse.json({task: assignTask(taskId, String(body.agentId ?? ""))});
    }

    if (action === "status") {
      const taskId = String(body.taskId ?? "");
      // Agenten benötigen task:execute und die Bindung an genau diese Task.
      guardRequest(req, {action: "task:status", taskId, requireAgentCapability: "task:execute"});
      const task = getTask(taskId);
      if (!task) return NextResponse.json({error: "task not found"}, {status: 404});
      const status = String(body.status ?? "") as Status;
      const progress = typeof body.progress === "number" ? body.progress : task.progress;
      return NextResponse.json({task: updateTaskStatus(taskId, status, progress)});
    }

    return NextResponse.json({error: "unknown action", supported: ["create", "assign", "status"]}, {status: 400});
  } catch (error) {
    if (error instanceof Error && "status" in error) {
      const denied = error as {status: number; code?: string; message: string};
      return NextResponse.json({error: denied.code ?? "DENIED", message: denied.message}, {status: denied.status});
    }
    return NextResponse.json({error: error instanceof Error ? error.message : "invalid request"}, {status: 400});
  }
}
