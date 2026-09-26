import {NextResponse} from "next/server";
import {agentFabricSummary, heartbeatAgent, listAgentNodes, listHandoffs, requestHandoff, resolveHandoff, updateAgentStatus} from "@/lib/agent-fabric";
import {guardOrDeny} from "@/lib/api/api-gate";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Agent Fabric: 11 Rollen mit Autonomie-Vertrag, Heartbeats und Übergaben.
 * Lesen ist Session-Aufgabe; Status-/Übergabeänderungen sind Aktionen der
 * Control Plane und damit Creator-gebunden (Agenten melden sich über den
 * Broker bzw. Heartbeat, nicht über Verwaltungsrouten).
 */
export async function GET(request: Request) {
  const denied = guardOrDeny(request, {action: "agent:read"});
  if (denied) return denied;
  return NextResponse.json({agents: listAgentNodes(), handoffs: listHandoffs(), summary: agentFabricSummary()}, {headers: {"Cache-Control": "no-store"}});
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    if (body.action === "heartbeat") {
      const denied = guardOrDeny(request, {action: "agent:heartbeat"});
      if (denied) return denied;
      const agent = heartbeatAgent(body.id);
      if (!agent) return NextResponse.json({error: "agent not found"}, {status: 404});
      return NextResponse.json({agent});
    }
    const denied = guardOrDeny(request, {action: "agent:manage", creatorOnly: true});
    if (denied) return denied;
    if (body.action === "status") {
      const agent = updateAgentStatus(body.id, body.status, body.progress, body.task);
      if (!agent) return NextResponse.json({error: "agent not found"}, {status: 404});
      return NextResponse.json({agent});
    }
    if (body.action === "handoff") return NextResponse.json({handoff: requestHandoff(body.fromAgentId, body.toAgentId, body.taskId, body.reason)}, {status: 201});
    if (body.action === "resolve") return NextResponse.json({handoff: resolveHandoff(body.id, body.status)});
    return NextResponse.json({error: "unknown action"}, {status: 400});
  } catch (error) {
    return NextResponse.json({error: error instanceof Error ? error.message : "invalid request"}, {status: 400});
  }
}
