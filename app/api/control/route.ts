import {NextResponse} from "next/server";
import {resolveApproval, runGuardian, setLockdown, snapshot} from "@/lib/control-plane";
import {actionField, readJson, stringField} from "@/lib/request-validation";
import {guardRequest} from "@/lib/api/guard";

/**
 * Control-Plane-Kommandos (Abschnitt 5).
 *
 * Lesen: authentifizierte Session. Schreiben: ausschließlich Creator –
 * Lockdown, Guardian-Lauf und Approval-Entscheidungen sind Governance-Akte.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  guardRequest(req, {action: "control:read"});
  return NextResponse.json(snapshot(), {headers: {"Cache-Control": "no-store"}});
}

export async function POST(req: Request) {
  try {
    const body = await readJson(req);
    const action = actionField(body, ["guardian", "lockdown", "approval"]);

    if (action === "guardian") {
      guardRequest(req, {action: "control:guardian", creatorOnly: true});
      return NextResponse.json(runGuardian());
    }
    if (action === "lockdown") {
      guardRequest(req, {action: "control:lockdown", creatorOnly: true});
      if (typeof body.locked !== "boolean") throw new Error("locked must be boolean");
      return NextResponse.json(setLockdown(body.locked));
    }
    guardRequest(req, {action: "approval:resolve", creatorOnly: true});
    return NextResponse.json(resolveApproval(stringField(body, "id", 128), body.grant === true));
  } catch (error) {
    if (error instanceof Error && "status" in error) {
      const denied = error as {status: number; code?: string; message: string};
      return NextResponse.json({error: denied.code ?? "DENIED", message: denied.message}, {status: denied.status});
    }
    return NextResponse.json({error: error instanceof Error ? error.message : "Control operation failed"}, {status: 400});
  }
}
