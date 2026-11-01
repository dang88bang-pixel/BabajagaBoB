import {NextResponse} from "next/server";
import {allocateComputer, authorizeComputer, listComputers, registerComputer, releaseComputer, startComputer} from "@/lib/computer-use";
import {executeComputerAuthorized, type ComputerExecutionRequest} from "@/lib/execution-broker";
import {listSandboxes} from "@/lib/sandbox/fabric";
import {guardOrDeny} from "@/lib/api/api-gate";
import {toDeniedResponse} from "@/lib/api/guard";
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
  return NextResponse.json({computers: listComputers()}, {headers: {"Cache-Control": "no-store"}});
}

/**
 * Computer Use über den Broker (Abschnitt 21).
 *
 * Die Route autorisiert (Session bzw. Capability-Token) und übergibt dann an den
 * Broker, der die Fähigkeit `computer:execute`, die Bindung an Task/Sandbox, den
 * Computerzustand und die Netzwerkpolicy prüft. Ohne konfigurierten Treiber
 * (`BOB_COMPUTER_DRIVER`) wird **nichts** als ausgeführt gemeldet.
 */
async function execute(request: Request, body: Record<string, unknown>) {
  const taskId = stringField(body, "taskId", 128);
  const sandboxId = stringField(body, "sandboxId", 128);
  const sandbox = listSandboxes().find(entry => entry.sandboxId === sandboxId);
  if (!sandbox) return NextResponse.json({error: "SANDBOX_NOT_FOUND"}, {status: 404});
  const denied = guardOrDeny(request, {action: "computer:execute", taskId, sandboxId, environment: sandbox.type});
  if (denied) return denied;
  const result = await executeComputerAuthorized({
    taskId,
    sandboxId,
    agentId: stringField(body, "agentId", 128),
    capabilityTokenId: stringField(body, "capabilityTokenId", 128),
    computerId: stringField(body, "computerId", 128),
    computerAction: stringField(body, "computerAction", 64) as ComputerExecutionRequest["computerAction"],
    computerInput: typeof body.computerInput === "object" && body.computerInput !== null ? (body.computerInput as Record<string, unknown>) : {},
    runId: typeof body.runId === "string" ? body.runId : undefined
  });
  return NextResponse.json(result);
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    if (body.action === "register") {
      const denied = guardOrDeny(request, {action: "computer:register", creatorOnly: true});
      if (denied) return denied;
      return NextResponse.json({computer: registerComputer(objectField(body,"computer") as never)}, {status: 201});
    }
    if (body.action === "execute") return await execute(request, body);
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
    // Verweigerungen des Brokers bleiben Verweigerungen (403/409), nur
    // Aufruffeher werden zu 400.
    const denied = toDeniedResponse(error);
    if (denied) return denied;
    // Broker-Verweigerungen (ExecutionDeniedError) sind Policy-Entscheidungen.
    if (error instanceof Error && "check" in error) {
      return NextResponse.json({error: "EXECUTION_DENIED", check: (error as {check: string}).check, message: error.message}, {status: 409});
    }
    const status = typeof (error as {status?: unknown}).status === "number" ? (error as {status: number}).status : 400;
    return NextResponse.json({error: error instanceof Error ? error.message : "invalid request"}, {status});
  }
}
