import {NextResponse} from "next/server";
import {evaluateAndNotify, sloReport, sloThresholds} from "../../../lib/slo";
import {guardOrDeny} from "@/lib/api/api-gate";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * SLO-Bewertung des Betriebs (Abschnitt 43).
 *
 * - `GET /api/slo` — **rein lesend**: Schwellen, Messungen, Bewertung. Ohne
 *   Schreibwirkung, damit eine Anzeige (Control Center) nie versehentlich
 *   Meldungen erzeugt.
 * - `POST /api/slo {action:"evaluate"}` — bewertet **und** legt bei einer
 *   Verletzung (`BREACHED`) einen `BLOCK`-Eintrag in der Creator-Inbox an,
 *   fehlende Messwerte erzeugen `ASK`. Nichts wird automatisch repariert oder
 *   abgeschaltet; die Entscheidung bleibt beim Creator.
 */
export async function GET(request: Request) {
  const denied = guardOrDeny(request, {action: "slo:read"});
  if (denied) return denied;
  const report = await sloReport();
  return NextResponse.json(
    {thresholds: sloThresholds(), ...report},
    {headers: {"Cache-Control": "no-store"}}
  );
}

export async function POST(request: Request) {
  const denied = guardOrDeny(request, {action: "slo:evaluate", creatorOnly: false});
  if (denied) return denied;
  // Kein impliziter Standardfall: eine fehlende Aktion ist ein Eingabefehler
  // (kein stiller Erfolg, der als „bewertet“ missverstanden werden könnte).
  const body = (await request.json().catch(() => ({}))) as {action?: string};
  if (body.action === "evaluate") {
    const report = await evaluateAndNotify("AG-OPS");
    return NextResponse.json(report, {headers: {"Cache-Control": "no-store"}});
  }
  if (body.action === "report") {
    return NextResponse.json(await sloReport(), {headers: {"Cache-Control": "no-store"}});
  }
  if (body.action === undefined) {
    return NextResponse.json({error: "ACTION_REQUIRED", message: "action fehlt (evaluate oder report)"}, {status: 400});
  }
  return NextResponse.json({error: "Unsupported slo action", supported: ["evaluate", "report"]}, {status: 400});
}
