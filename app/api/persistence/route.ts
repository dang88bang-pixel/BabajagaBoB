import {NextResponse} from "next/server";
// Lädt alle Module mit persistentem Store: sonst prüft der Bericht nur die
// Stores, die zufällig über den Import-Graph dieser Route erreichbar sind.
import "../../../lib/persistence/all-stores";
import {backupAllStores, listStoreBackups, repairStorePayloads, restoreStoreBackup, storageRoot, storeIntegrityReport} from "../../../lib/persistence/store";
import {recordAudit} from "../../../lib/audit";
import {eventStoreIntegrity} from "../../../lib/event-store";
import {controlStateReport} from "../../../lib/control-plane";
import {listProvenance} from "../../../lib/provenance";
import {guardOrDeny} from "../../../lib/api/api-gate";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Persistenz-Status des Control Plane.
 *
 * Der Control-State wird ausschließlich über den kanonischen Store
 * (`lib/persistence/store.ts`, integrity-geprüfter Envelope, atomares Schreiben)
 * geführt. Der frühere Parallel-Store `DurableJsonControlStore` ist stillgelegt:
 * Ein Restore daraus hätte den echten Zustand nicht wiederhergestellt, sondern
 * einen zweiten, abweichenden Zustand erzeugt (fail closed statt Scheinerfolg).
 *
 * Backups sind **Kopien** des kanonischen Stores (Digest-geprüft, Version
 * gebunden, Pfad auf `<BOB_STORAGE_DIR>/backups` beschränkt) – sie sind kein
 * zweiter Live-Zustand, sondern ein Nachweis für Wiederherstellbarkeit.
 */
export async function GET(request: Request) {
  const denied = guardOrDeny(request, {action: "persistence:read"});
  if (denied) return denied;

  const provenance = listProvenance();
  const backups = listStoreBackups();
  return NextResponse.json(
    {
      provider: "local-json",
      root: storageRoot(),
      integrity: controlStateReport(),
      stores: storeIntegrityReport(),
      events: eventStoreIntegrity(),
      provenance: {nodes: provenance.nodes.length, edges: provenance.edges.length},
      backupPath: `${storageRoot()}/backups`,
      backups: {
        count: backups.length,
        verified: backups.filter(backup => backup.ok).length,
        failed: backups.filter(backup => !backup.ok).map(backup => ({store: backup.store, name: backup.name, error: backup.error})),
        newest: backups.slice(-3)
      }
    },
    {headers: {"Cache-Control": "no-store"}}
  );
}

/**
 * Creator-Aktionen:
 *  - `backup`  legt digest-geprüfte Kopien aller Stores an.
 *  - `restore` stellt einen Store aus einem **geprüften** Backup wieder her
 *              (Pfadbindung → Version → Digest → Schreiben).
 *  - `repair`  setzt Stores mit inhaltslosem Envelope (`payload: null`) auf den
 *              Initialzustand zurück (journalliert + auditiert).
 */
export async function POST(request: Request) {
  const denied = guardOrDeny(request, {action: "persistence:backup", creatorOnly: true});
  if (denied) return denied;

  const body = await request.json().catch(() => ({} as Record<string, unknown>));
  if (body.action === "backup") {
    const files = backupAllStores();
    const reports = listStoreBackups().filter(report => files.includes(report.file));
    return NextResponse.json(
      {created: files, verified: reports.filter(report => report.ok).length, reports},
      {status: 201, headers: {"Cache-Control": "no-store"}}
    );
  }
  if (body.action === "restore") {
    if (typeof body.store !== "string" || typeof body.file !== "string") {
      return NextResponse.json({error: "store and file are required"}, {status: 400});
    }
    try {
      return NextResponse.json(restoreStoreBackup(body.store, body.file), {headers: {"Cache-Control": "no-store"}});
    } catch (error) {
      // Ein nicht verifizierbares Backup wird niemals eingespielt.
      return NextResponse.json(
        {error: error instanceof Error ? error.message : "restore failed", failClosed: true},
        {status: 409, headers: {"Cache-Control": "no-store"}}
      );
    }
  }
  if (body.action === "repair") {
    // Repariert inhaltslose Envelopes (`payload: null`) — sie enthalten keine
    // Information, brechen aber jeden Lesezugriff. Jede Reparatur wird auditiert.
    const results = repairStorePayloads();
    const repaired = results.filter(result => result.repaired).map(result => result.store);
    if (repaired.length > 0) {
      recordAudit({actor: "CREATOR", action: "persistence.repair", resource: repaired.join(","), decision: "ALLOW"}, {repaired});
    }
    return NextResponse.json({repaired, results}, {headers: {"Cache-Control": "no-store"}});
  }
  return NextResponse.json({error: "unsupported persistence action", supported: ["backup", "restore", "repair"]}, {status: 400});
}
