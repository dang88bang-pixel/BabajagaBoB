import {NextResponse} from "next/server";
import {allocateComputer, authorizeComputer, listComputers, registerComputer, releaseComputer, startComputer} from "@/lib/computer-use";
import {guardOrDeny} from "@/lib/api/api-gate";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Computer Use (Browser/Desktop/CLI).
 *
 * Discovery ≠ Autorisierung gilt hier genauso wie für Geräte: Registrieren legt
 * eine Instanz an, autorisiert ist sie damit nicht. Autorisierung, Registrierung
 * und Allocation sind Creator-/Session-Aktionen; Netzwerk ist default `DENY`.
 */
export async function GET(request: Request) {
  const denied = guardOrDeny(request, {action: "computer:read"});
  if (denied) return denied;
  return NextResponse.json({computers: listComputers()}, {headers: {"Cache-Control": "no-store"}});
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    if (body.action === "register") {
      const denied = guardOrDeny(request, {action: "computer:register", creatorOnly: true});
      if (denied) return denied;
      return NextResponse.json({computer: registerComputer(body.computer)}, {status: 201});
    }
    if (body.action === "allocate") {
      const denied = guardOrDeny(request, {action: "computer:allocate", taskId: body.taskId, sandboxId: body.sandboxId});
      if (denied) return denied;
      return NextResponse.json({computer: allocateComputer(body.id, body.taskId, body.sandboxId)});
    }
    const denied = guardOrDeny(request, {action: body.action === "authorize" ? "computer:authorize" : "computer:manage", creatorOnly: true});
    if (denied) return denied;
    if (body.action === "authorize") return NextResponse.json({computer: authorizeComputer(body.id, body.authorized !== false)});
    if (body.action === "start") return NextResponse.json({computer: startComputer(body.id)});
    if (body.action === "release") return NextResponse.json({computer: releaseComputer(body.id)});
    return NextResponse.json({error: "unsupported computer action"}, {status: 400});
  } catch (error) {
    return NextResponse.json({error: error instanceof Error ? error.message : "invalid request"}, {status: 400});
  }
}
