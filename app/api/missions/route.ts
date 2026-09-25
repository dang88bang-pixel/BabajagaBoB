import {NextResponse} from "next/server";
import {createMission, createObjective, snapshot} from "../../../lib/control-plane";
import {guardRequest, toDeniedResponse} from "../../../lib/api/guard";

/**
 * Missionen und Objectives.
 *
 * Lesen: authentifizierte Session. Schreiben: ausschließlich Creator
 * (Mission/Objective setzen Ziele und Risikorahmen der Plattform).
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  try {
    guardRequest(req, {action: "mission:read"});
    return NextResponse.json(snapshot().missions, {headers: {"Cache-Control": "no-store"}});
  } catch (error) {
    const denied = toDeniedResponse(error);
    if (denied) return denied;
    throw error;
  }
}

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as Record<string, unknown>;
    if (body.action === "create-mission") {
      const guard = guardRequest(req, {action: "mission:create", creatorOnly: true});
      const mission = createMission({
        title: String(body.title ?? ""),
        objective: String(body.objective ?? ""),
        createdBy: guard.actor.actorId
      });
      return NextResponse.json({mission}, {status: 201});
    }
    if (body.action === "create-objective") {
      guardRequest(req, {action: "objective:create", creatorOnly: true});
      const objective = createObjective({
        missionId: String(body.missionId ?? ""),
        title: String(body.title ?? ""),
        description: String(body.description ?? "")
      });
      return NextResponse.json({objective}, {status: 201});
    }
    return NextResponse.json({error: "unknown action", supported: ["create-mission", "create-objective"]}, {status: 400});
  } catch (error) {
    if (error instanceof Error && "status" in error) {
      const denied = error as {status: number; code?: string; message: string};
      return NextResponse.json({error: denied.code ?? "DENIED", message: denied.message}, {status: denied.status});
    }
    return NextResponse.json({error: error instanceof Error ? error.message : "invalid request"}, {status: 400});
  }
}
