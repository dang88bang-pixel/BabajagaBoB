import {NextResponse} from "next/server";
import {controlStateReport} from "../../../lib/control-plane";
import {eventStoreIntegrity} from "../../../lib/event-store";
import {listProvenance} from "../../../lib/provenance";

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
 */
export async function GET() {
  const provenance = listProvenance();
  return NextResponse.json(
    {
      provider: "local-json",
      integrity: controlStateReport(),
      events: eventStoreIntegrity(),
      provenance: {nodes: provenance.nodes.length, edges: provenance.edges.length},
      backups: "kein Parallel-Backup-Pfad; kanonischer Store schreibt atomar (tmp+rename) und prüft Digests"
    },
    {headers: {"Cache-Control": "no-store"}}
  );
}

export async function POST() {
  return NextResponse.json(
    {
      error:
        "Legacy-Backup/Restore stillgelegt: der kanonische Control-State-Store ist die einzige Quelle. " +
        "Ein Backup/Restore über einen Parallel-Store würde einen abweichenden Zustand wiederherstellen (fail closed)."
    },
    {status: 409}
  );
}
