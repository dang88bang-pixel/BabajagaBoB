import {NextResponse} from "next/server";
import {allocateComputer, authorizeComputer, listComputers, registerComputer, releaseComputer, startComputer} from "@/lib/computer-use";
import {computerDriverStatus, executeComputerAuthorized} from "@/lib/execution-broker";
import {guardOrDeny} from "@/lib/api/api-gate";
import {listSandboxes} from "@/lib/sandbox/fabric";
import {objectField, stringField} from "@/lib/request-validation";

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
    {computers: listComputers(), driver: computerDriverStatus()},
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
    /**
     * Ausführung einer Computer-Aktion — **ausschließlich** über den Broker.
     *
     * Die Route ist nur die Autorisierungsschranke (Session oder
     * Capability-Token mit `computer:execute`); danach entscheidet der Broker
     * über Instanz, Bindung, Fähigkeit, Netz, Risiko, Gate und Evidenz. Ohne
     * konfigurierten Treiber bleibt die Aktion verweigert.
     */
    if (body.action === "execute") {
      const taskId = stringField(body, "taskId", 128);
      const sandboxId = stringField(body, "sandboxId", 128);
      const agentId = stringField(body, "agentId", 128);
      const sandbox = listSandboxes().find(entry => entry.sandboxId === sandboxId);
      if (!sandbox) return NextResponse.json({error: "SANDBOX_NOT_FOUND", message: "sandbox not found"}, {status: 404});
      const denied = guardOrDeny(request, {
        action: "computer:execute",
        taskId,
        sandboxId,
        environment: sandbox.type,
        requireAgentCapability: "computer:execute"
      });
      if (denied) return denied;
      const result = await executeComputerAuthorized({
        taskId,
        agentId,
        sandboxId,
        capabilityTokenId: stringField(body, "capabilityTokenId", 128),
        ...(typeof body.runId === "string" ? {runId: body.runId} : {}),
        argv: Array.isArray(body.argv) && body.argv.length > 0 ? body.argv.map(String) : ["COMPUTER_USE"],
        computerId: stringField(body, "computerId", 128),
        computerAction: stringField(body, "computerAction", 64) as never,
        ...(body.computerInput && typeof body.computerInput === "object" ? {computerInput: body.computerInput as Record<string, unknown>} : {})
      });
      return NextResponse.json({result}, {headers: {"Cache-Control": "no-store"}});
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
