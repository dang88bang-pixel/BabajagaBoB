import {NextResponse} from "next/server";
import {addEgressEntry, egressStatus, removeEgressEntry} from "../../../lib/egress";
import {guardRequest, toDeniedResponse, type GuardedRequest} from "../../../lib/api/guard";
import {recordAudit} from "../../../lib/audit";

/**
 * Egress-Schicht: Status und Allowlist-Verwaltung (Phase 4 / 7.1).
 *
 * Lesen: authentifizierte Session. Einträge ändern ist Creator-Aktion
 * (`egress:manage`), weil jede Freischaltung die DENY-Vorgabe aufbricht.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  try {
    guardRequest(req, {action: "egress:read"});
    return NextResponse.json(egressStatus(), {headers: {"Cache-Control": "no-store"}});
  } catch (error) {
    const denied = toDeniedResponse(error);
    if (denied) return denied;
    throw error;
  }
}

export async function POST(req: Request) {
  let guarded: GuardedRequest;
  try {
    guarded = guardRequest(req, {action: "egress:manage", creatorOnly: true, risk: "MODERATE"});
  } catch (error) {
    const denied = toDeniedResponse(error);
    if (denied) return denied;
    throw error;
  }
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const action = String(body.action ?? "");
  if (action === "add") {
    if (typeof body.host !== "string") return NextResponse.json({error: "host is required"}, {status: 400});
    try {
      const entry = addEgressEntry({
        host: body.host,
        ports: Array.isArray(body.ports) ? body.ports.map(Number) : undefined,
        addedBy: guarded.actor.actorId,
        reason: typeof body.reason === "string" ? body.reason : undefined
      });
      recordAudit({actor: guarded.actor.actorId, action: "egress:allowlist:add", decision: "ALLOW", resource: entry.host}, {ports: entry.ports, reason: entry.reason});
      return NextResponse.json({entry}, {status: 201});
    } catch (error) {
      return NextResponse.json({error: error instanceof Error ? error.message : "add failed"}, {status: 400});
    }
  }
  if (action === "remove") {
    if (typeof body.host !== "string") return NextResponse.json({error: "host is required"}, {status: 400});
    const removed = removeEgressEntry(body.host);
    recordAudit({actor: guarded.actor.actorId, action: "egress:allowlist:remove", decision: removed ? "ALLOW" : "DENY", resource: body.host}, {removed});
    return NextResponse.json({removed}, {status: removed ? 200 : 404});
  }
  return NextResponse.json({error: "unknown action"}, {status: 400});
}
