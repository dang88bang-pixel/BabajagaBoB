import {NextResponse} from "next/server";
import {executeWorkshopStep, listWorkshopExecutions} from "@/lib/workshop-execution";
import {guardOrDeny} from "@/lib/api/api-gate";
import {actionField, readJson, stringField} from "@/lib/request-validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const WORKSHOP_ACTIONS = ["SPECIFY", "PROTOTYPE", "SANDBOX", "TEST", "SECURITY_VALIDATE", "EXPERIMENT", "VALIDATE", "REGISTER"] as const;
type WorkshopActionName = (typeof WORKSHOP_ACTIONS)[number];

/**
 * Werkstatt-Ausführung (Abschnitt 17).
 *
 * Ein Werkstattschritt verändert den Zustand einer Aktivität und erzeugt
 * Provenance, Ereignis und Audit — er ist damit eine zustandsändernde Aktion und
 * braucht eine eigene Autorisierung. Dieser Pfad war zuvor ungeschützt: Die
 * Middleware verlangte zwar eine Session, aber die Route selbst prüfte weder
 * Aktion noch Bindung. Agents benötigen jetzt ein Capability-Token mit
 * `workshop:step`; die Creator-Session (Owner) darf den Schritt ausführen.
 */
export async function GET(request: Request) {
  const denied = guardOrDeny(request, {action: "workshop:read"});
  if (denied) return denied;
  return NextResponse.json({executions: listWorkshopExecutions()}, {headers: {"Cache-Control": "no-store"}});
}

export async function POST(request: Request) {
  const denied = guardOrDeny(request, {action: "workshop:execute", requireAgentCapability: "workshop:step"});
  if (denied) return denied;
  try {
    const body = await readJson(request);
    const workshopId = stringField(body, "workshopId", 128);
    const action = actionField(body, [...WORKSHOP_ACTIONS]) as WorkshopActionName;
    return NextResponse.json(executeWorkshopStep(workshopId, action));
  } catch (error) {
    return NextResponse.json({error: error instanceof Error ? error.message : "workshop execution failed"}, {status: 400});
  }
}
