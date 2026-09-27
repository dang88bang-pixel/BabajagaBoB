import {NextResponse} from "next/server";
import {
  attestScanCandidate,
  deviceScanSummary,
  listAttestations,
  listDeviceScans,
  listScanCandidates,
  runDeviceScan,
  type AttestationVerdict
} from "../../../lib/device-scan";
import {guardRequest, toDeniedResponse, type GuardedRequest} from "../../../lib/api/guard";

/**
 * Geräte-Netz-Scan + Attestierung (Phase 4 / 7.3).
 *
 * Lesen: authentifizierte Session. Scan und Attestierung sind Creator-Aktionen
 * (`device-scan:manage`); ein Scan erzeugt Discovery-Kandidaten, Vertrauen
 * entsteht ausschließlich durch ausdrückliche Attestierung.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  try {
    guardRequest(req, {action: "device-scan:read"});
    return NextResponse.json(
      {
        summary: deviceScanSummary(),
        scans: listDeviceScans().slice(-50),
        candidates: listScanCandidates().slice(-200),
        attestations: listAttestations().slice(-100)
      },
      {headers: {"Cache-Control": "no-store"}}
    );
  } catch (error) {
    const denied = toDeniedResponse(error);
    if (denied) return denied;
    throw error;
  }
}

export async function POST(req: Request) {
  let guarded: GuardedRequest;
  try {
    guarded = guardRequest(req, {action: "device-scan:manage", creatorOnly: true, risk: "MODERATE"});
  } catch (error) {
    const denied = toDeniedResponse(error);
    if (denied) return denied;
    throw error;
  }
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const action = String(body.action ?? "");
  const actor = guarded.actor.actorId;
  try {
    if (action === "scan") {
      const scan = runDeviceScan({requestedBy: actor});
      return NextResponse.json({scan}, {status: 201});
    }
    if (action === "attest") {
      if (typeof body.candidateId !== "string" || (body.verdict !== "TRUSTED" && body.verdict !== "UNTRUSTED")) {
        return NextResponse.json({error: "candidateId and verdict (TRUSTED|UNTRUSTED) are required"}, {status: 400});
      }
      const attestation = attestScanCandidate({
        candidateId: body.candidateId,
        verdict: body.verdict as AttestationVerdict,
        reason: typeof body.reason === "string" ? body.reason : "",
        attestedBy: actor
      });
      return NextResponse.json({attestation}, {status: 201});
    }
    return NextResponse.json({error: "unknown action"}, {status: 400});
  } catch (error) {
    return NextResponse.json({error: error instanceof Error ? error.message : "device scan action failed"}, {status: 400});
  }
}
