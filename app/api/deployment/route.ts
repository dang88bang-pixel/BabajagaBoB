import {NextResponse} from "next/server";
import {guardOrDeny} from "@/lib/api/api-gate";
import {actionField, optionalString, readJson, stringField} from "@/lib/request-validation";
import {DeploymentRejected, deployRelease, deploymentSnapshot, getDeployment, planDeployment, rollbackDeployment, verifyDeployment} from "@/lib/deployment";
import {listReleases, prepareRelease, pruneReleases} from "@/lib/release";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Deployment (Abschnitt 24).
 *
 * `GET` liefert das Betriebsbild (Slots, Zeiger, laufender Build, Historie).
 * Alle Aktionen sind **Creator-Aktionen** (`creatorOnly`) — ein Agent darf sich
 * niemals selbst ausrollen. Zusätzlich verlangt `deploy` bestandene
 * Promotion-Gates und eine gewährte Freigabe (Prüfung in `lib/deployment.ts`).
 *
 * Der Prozess-Neustart ist bewusst **nicht** Teil der Route: Die Plattform kann
 * sich nicht selbst neu starten. Dafür gibt es `scripts/release-supervisor.sh`,
 * das den Wechsel ausführt, neu startet, die Build-ID prüft und bei fehlender
 * Gesundheit selbsttätig zurückrollt. Die Route gibt den genauen Befehl als
 * `supervisorHint` zurück, statt einen Erfolg zu behaupten.
 */
export async function GET(request: Request) {
  const denied = guardOrDeny(request, {action: "deployment:read"});
  if (denied) return denied;
  return NextResponse.json(deploymentSnapshot(), {headers: {"Cache-Control": "no-store"}});
}

export async function POST(request: Request) {
  const denied = guardOrDeny(request, {action: "deployment:execute", creatorOnly: true});
  if (denied) return denied;
  try {
    const body = await readJson(request);
    const action = actionField(body, ["prepare", "plan", "deploy", "rollback", "verify", "prune"]);

    if (action === "prepare") {
      const manifest = prepareRelease({source: optionalString(body, "source", 512) ?? process.cwd(), label: stringField(body, "label", 200)});
      return NextResponse.json({release: manifest}, {status: 201});
    }
    if (action === "prune") {
      // Löschen ist destruktiv: Ohne ausdrückliche Angabe wird **nichts**
      // entfernt. Ein stiller Erfolg mit Vorgabewert hätte alte Slots
      // weggeräumt, ohne dass der Aufrufer das verlangt hat.
      if (body.keep === undefined) return NextResponse.json({error: "keep required", message: "Anzahl der zu behaltenden Slots muss ausdrücklich genannt werden."}, {status: 400});
      const keep = Number(body.keep);
      if (!Number.isInteger(keep) || keep < 1 || keep > 20) return NextResponse.json({error: "invalid keep"}, {status: 400});
      return NextResponse.json({removed: pruneReleases(keep, [])});
    }
    if (action === "rollback") {
      const deploymentId = stringField(body, "deploymentId", 80);
      // Unbekannter Vorgang ist 404, ein **verweigerter** Rückroll 409 — zwei
      // verschiedene Sachverhalte, die nicht denselben Status bekommen dürfen.
      if (!getDeployment(deploymentId)) return NextResponse.json({error: `deployment ${deploymentId} not found`}, {status: 404});
      const result = await rollbackDeployment(deploymentId, "CREATOR", stringField(body, "reason", 1000));
      return NextResponse.json(result, {status: result.performed ? 200 : 409});
    }
    if (action === "verify") {
      const deploymentId = stringField(body, "deploymentId", 80);
      if (!getDeployment(deploymentId)) return NextResponse.json({error: `deployment ${deploymentId} not found`}, {status: 404});
      return NextResponse.json({deployment: verifyDeployment(deploymentId)});
    }

    const releaseId = stringField(body, "releaseId", 80);
    const pipelineId = optionalString(body, "pipelineId", 128);
    const approvalId = optionalString(body, "approvalId", 128);
    const target = body.target === undefined ? "STAGING" : stringField(body, "target", 20).toUpperCase();
    if (target !== "STAGING" && target !== "PRODUCTION") return NextResponse.json({error: "invalid target", supported: ["STAGING", "PRODUCTION"]}, {status: 400});
    if (action === "plan") return NextResponse.json(planDeployment({releaseId, pipelineId, approvalId, target}));

    const result = await deployRelease({releaseId, pipelineId, approvalId, target, requestedBy: "CREATOR"});
    // Kein stiller Erfolg: Ein nicht ausgerollter Vorgang (Gates verweigert oder
    // Health-Check gescheitert) ist für den Aufrufer ein Fehlschlag — 409.
    if (!result.allowed || result.deployment.state === "FAILED") {
      return NextResponse.json({deployment: result.deployment, reasons: result.reasons}, {status: 409});
    }
    return NextResponse.json(result, {status: 200});
  } catch (error) {
    if (error instanceof DeploymentRejected) return NextResponse.json({error: error.message, reasons: error.reasons}, {status: 409});
    const message = error instanceof Error ? error.message : "deployment request failed";
    return NextResponse.json({error: message}, {status: /not found/i.test(message) ? 404 : 400});
  }
}

/** Zählt nur die vorhandenen Slots — reine Lesezugriffe für Betriebswerkzeuge. */
export async function OPTIONS(request: Request) {
  const denied = guardOrDeny(request, {action: "deployment:read"});
  if (denied) return denied;
  return NextResponse.json({releases: listReleases().map(entry => entry.manifest.releaseId), actions: ["prepare", "plan", "deploy", "rollback", "verify", "prune"]});
}
