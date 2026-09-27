import {NextResponse} from "next/server";
import {allocateComputer, authorizeComputer, listComputers, registerComputer, releaseComputer, startComputer, type ComputerUseAction} from "@/lib/computer-use";
import {cuDriverAvailabilityMatrix, executeCuAction, listCuActionAttempts} from "@/lib/computer-use-drivers";
import {guardOrDeny} from "@/lib/api/api-gate";
import {objectField} from "@/lib/request-validation";

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
  return NextResponse.json(
    {computers: listComputers(), drivers: cuDriverAvailabilityMatrix(), attempts: listCuActionAttempts().slice(-100)},
    {headers: {"Cache-Control": "no-store"}}
  );
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    if (body.action === "register") {
      const denied = guardOrDeny(request, {action: "computer:register", creatorOnly: true});
      if (denied) return denied;
      return NextResponse.json({computer: registerComputer(objectField(body,"computer") as never)}, {status: 201});
    }
    if (body.action === "allocate") {
      const denied = guardOrDeny(request, {action: "computer:allocate", taskId: body.taskId, sandboxId: body.sandboxId});
      if (denied) return denied;
      return NextResponse.json({computer: allocateComputer(body.id, body.taskId, body.sandboxId)});
    }
    if (body.action === "execute") {
      const denied = guardOrDeny(request, {action: "computer:execute", creatorOnly: true});
      if (denied) return denied;
      const attempt = await executeCuAction({
        instanceId: String(body.id ?? ""),
        action: String(body.actionName ?? "") as ComputerUseAction,
        ...(body.params && typeof body.params === "object" ? {params: body.params as Record<string, unknown>} : {}),
        ...(typeof body.sandboxId === "string" ? {sandboxId: body.sandboxId} : {}),
        requestedBy: "CREATOR"
      });
      return NextResponse.json({attempt});
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
