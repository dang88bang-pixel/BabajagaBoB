import {NextResponse} from "next/server";
import {
  allocateComputer,
  authorizeComputer,
  getComputer,
  listComputers,
  registerComputer,
  releaseComputer,
  startComputer,
  type ComputerUseAction
} from "@/lib/computer-use";
import {guardOrDeny} from "@/lib/api/api-gate";
import {guardRequest, toDeniedResponse} from "@/lib/api/guard";
import {issueCapabilityToken} from "@/lib/authority";
import {getControlState} from "@/lib/control-plane";
import {executeComputerAuthorized, ExecutionDeniedError} from "@/lib/execution-broker";
import {actionField, objectField, optionalStringField, readJson, stringField} from "@/lib/request-validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const COMPUTER_ACTIONS: readonly ComputerUseAction[] = [
  "NAVIGATE", "CLICK", "TYPE", "SELECT", "SCREENSHOT", "OCR", "PROCESS_READ", "FILE_READ", "TERMINAL_EXECUTE"
];

/**
 * Computer Use (Browser/Desktop/CLI).
 *
 * Discover/authorize/allocate are distinct lifecycle steps. Actual input is
 * accepted only by `executeComputerAuthorized`, which applies the normal Gate,
 * one-use token, resource binding, audit, provenance and evidence path.
 */
export async function GET(request: Request) {
  const denied = guardOrDeny(request, {action: "computer:read"});
  if (denied) return denied;
  return NextResponse.json({computers: listComputers()}, {headers: {"Cache-Control": "no-store"}});
}

export async function POST(request: Request) {
  try {
    const body = await readJson(request);
    const action = actionField(body, ["register", "allocate", "authorize", "start", "release", "execute"]);

    if (action === "register") {
      const denied = guardOrDeny(request, {action: "computer:register", creatorOnly: true});
      if (denied) return denied;
      const input = objectField(body, "computer");
      return NextResponse.json({computer: registerComputer(input as never)}, {status: 201, headers: {"Cache-Control": "no-store"}});
    }

    if (action === "allocate") {
      const taskId = stringField(body, "taskId", 128);
      const sandboxId = optionalStringField(body, "sandboxId", 128);
      const denied = guardOrDeny(request, {action: "computer:allocate", taskId, sandboxId});
      if (denied) return denied;
      return NextResponse.json({computer: allocateComputer(stringField(body, "id", 128), taskId, sandboxId)}, {headers: {"Cache-Control": "no-store"}});
    }

    if (action === "execute") {
      const computerId = stringField(body, "computerId", 128);
      const computer = getComputer(computerId);
      if (!computer) return NextResponse.json({error: "computer not found"}, {status: 404});
      if (!computer.taskId || !computer.sandboxId) {
        return NextResponse.json({error: "computer must be allocated to a task and sandbox before execution"}, {status: 409});
      }

      const state = getControlState();
      const task = state.tasks.find(entry => entry.taskId === computer.taskId);
      const sandbox = state.sandboxes.find(entry => entry.sandboxId === computer.sandboxId);
      if (!task || !sandbox) return NextResponse.json({error: "computer task or sandbox binding no longer exists"}, {status: 409});
      const computerAction = stringField(body, "computerAction", 32) as ComputerUseAction;
      if (!COMPUTER_ACTIONS.includes(computerAction)) return NextResponse.json({error: "unsupported computer action"}, {status: 400});
      const input = body.computerInput === undefined ? {} : objectField(body, "computerInput");
      const guarded = guardRequest(request, {
        action: "computer:execute",
        taskId: task.taskId,
        sandboxId: sandbox.sandboxId,
        environment: sandbox.type,
        requireAgentCapability: "computer:use"
      });

      // Agent requests must use the subject and token authenticated by the
      // capability header; caller-supplied actor/token fields are ignored.
      // A Creator session may authorize a single action, but the ephemeral
      // token is created and consumed entirely server-side and is never sent
      // back to the browser.
      let agentId = task.assignedAgent;
      let capabilityTokenId = guarded.actor.tokenId;
      if (guarded.actor.kind === "AGENT") {
        agentId = guarded.actor.agentId ?? "";
      } else if (guarded.actor.kind === "CREATOR") {
        if (!agentId) return NextResponse.json({error: "computer task must have an assigned agent"}, {status: 409});
        const issued = issueCapabilityToken({
          subject: agentId,
          taskId: task.taskId,
          sandboxId: sandbox.sandboxId,
          environment: sandbox.type,
          capabilities: ["task:execute", "sandbox:run", "computer:use", "computer:execute"],
          risk: task.risk,
          issuedBy: "CREATOR",
          issuedByKind: "CREATOR",
          expiresAt: new Date(Date.now() + 2 * 60_000).toISOString(),
          maxUses: 1
        }, "CREATOR");
        capabilityTokenId = issued.token.id;
      } else {
        return NextResponse.json({error: "Computer Use execution requires a Creator session or scoped agent capability"}, {status: 403});
      }
      if (!capabilityTokenId || !agentId) return NextResponse.json({error: "execution capability is missing"}, {status: 403});

      const timeoutMs = body.timeoutMs;
      if (timeoutMs !== undefined && (typeof timeoutMs !== "number" || !Number.isSafeInteger(timeoutMs))) {
        return NextResponse.json({error: "invalid timeoutMs"}, {status: 400});
      }
      const runId = optionalStringField(body, "runId", 128);
      const result = await executeComputerAuthorized({
        taskId: task.taskId,
        agentId,
        sandboxId: sandbox.sandboxId,
        capabilityTokenId,
        environment: sandbox.type,
        argv: ["COMPUTER_USE"],
        computerId,
        computerAction,
        computerInput: input,
        ...(runId ? {runId} : {}),
        ...(timeoutMs === undefined ? {} : {timeoutMs})
      });
      return NextResponse.json(result, {headers: {"Cache-Control": "no-store"}});
    }

    const denied = guardOrDeny(request, {
      action: action === "authorize" ? "computer:authorize" : "computer:manage",
      creatorOnly: true
    });
    if (denied) return denied;
    const id = stringField(body, "id", 128);
    if (action === "authorize") return NextResponse.json({computer: authorizeComputer(id, body.authorized !== false)});
    if (action === "start") return NextResponse.json({computer: startComputer(id)});
    if (action === "release") return NextResponse.json({computer: releaseComputer(id)});
    return NextResponse.json({error: "unsupported computer action"}, {status: 400});
  } catch (error) {
    const denied = toDeniedResponse(error);
    if (denied) return denied;
    if (error instanceof ExecutionDeniedError) {
      return NextResponse.json({error: error.check, message: error.message}, {status: 409, headers: {"Cache-Control": "no-store"}});
    }
    return NextResponse.json({error: error instanceof Error ? error.message : "invalid request"}, {status: 400});
  }
}
