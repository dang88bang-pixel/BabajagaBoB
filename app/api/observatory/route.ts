import {NextResponse} from "next/server";
import {guardOrDeny} from "@/lib/api/api-gate";
import {listActivities, type ActivityKind} from "@/lib/observatory";
import {statusModelReport} from "@/lib/status";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const IDENTIFIER = /^[A-Za-z0-9_-]{3,80}$/;
const KINDS: ActivityKind[] = ["RUN", "EXPERIMENT", "TASK"];

function badRequest(code: string, message: string) {
  return NextResponse.json({error: message, code}, {status: 400, headers: {"Cache-Control": "no-store"}});
}

/**
 * Agent Observatory (Abschnitt 11): Aktivitäten mit Ziel, Beobachtung, Hypothese,
 * Aktion, Erwartung, Ergebnis, Evidenz, Schlussfolgerung und nächstem Schritt.
 *
 * Der Abschnitt ist eine Projektion über das Ereignis-Log und die Stores; er
 * schreibt nichts. Fehlende Felder werden je Aktivität als `gaps` benannt, damit
 * eine Lücke sichtbar ist und nicht wie ein erfüllter Zustand aussieht.
 * `statusModel` liefert zusätzlich die Selbstauskunft des Status-Modells.
 */
export async function GET(request: Request) {
  const denied = guardOrDeny(request, {action: "observatory:read"});
  if (denied) return denied;

  const url = new URL(request.url);
  const rawLimit = url.searchParams.get("limit");
  const limit = rawLimit === null ? 50 : Number(rawLimit);
  if (!Number.isInteger(limit) || limit < 1 || limit > 500) return badRequest("INVALID_LIMIT", "limit must be an integer between 1 and 500");

  const kind = url.searchParams.get("kind");
  if (kind !== null && !KINDS.includes(kind as ActivityKind)) return badRequest("INVALID_KIND", `kind must be one of ${KINDS.join(", ")}`);

  const filters: Record<string, string | undefined> = {};
  for (const key of ["runId", "experimentId", "taskId"] as const) {
    const value = url.searchParams.get(key);
    if (value === null) continue;
    if (!IDENTIFIER.test(value)) return badRequest("INVALID_IDENTIFIER", `${key} is not a valid identifier`);
    filters[key] = value;
  }

  const activities = listActivities({...filters, kind: (kind as ActivityKind | null) ?? undefined, limit});
  return NextResponse.json(
    {
      activities,
      count: activities.length,
      incomplete: activities.filter(activity => activity.gaps.length > 0).map(activity => activity.activityId),
      statusModel: statusModelReport()
    },
    {headers: {"Cache-Control": "no-store"}}
  );
}
