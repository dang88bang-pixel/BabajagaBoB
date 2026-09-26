import {NextResponse} from "next/server";
import {guardOrDeny} from "@/lib/api/api-gate";
import {whyRecord} from "@/lib/observatory";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Ereignis-IDs sind `EVT-<uuid>`; alles andere wird abgelehnt, nicht gesucht. */
const EVENT_ID = /^EVT-[A-Za-z0-9-]{4,80}$/;

/**
 * „Warum wurde das gemacht?“ (Abschnitt 12) — strukturierte Begründung eines
 * Ereignisses: Zweck, Entscheidung, Akteur, Autorisierungs- und
 * Provenance-Referenz sowie die Kausalkette bis zur Wurzel.
 *
 * Der Record enthält bewusst keine Gedankenkette: Jedes Feld stammt aus dem
 * Ereignis-Log oder einem Store. Was fehlt, steht in `limitations`.
 */
export async function GET(request: Request, context: {params: Promise<{id: string}>}) {
  const denied = guardOrDeny(request, {action: "event:read"});
  if (denied) return denied;

  const {id} = await context.params;
  if (!EVENT_ID.test(id)) {
    return NextResponse.json({error: "invalid event id", code: "INVALID_EVENT_ID"}, {status: 400, headers: {"Cache-Control": "no-store"}});
  }
  const record = whyRecord(id);
  if (!record) {
    return NextResponse.json({error: "event not found", code: "NOT_FOUND", eventId: id}, {status: 404, headers: {"Cache-Control": "no-store"}});
  }
  return NextResponse.json(record, {headers: {"Cache-Control": "no-store"}});
}
