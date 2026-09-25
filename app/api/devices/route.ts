import {NextResponse} from "next/server";
import {allocateDevice, authorizeDevice, discoverDevice, heartbeatDevice, listDevices, releaseDevice} from "../../../lib/devices";
import {guardOrDeny} from "@/lib/api/api-gate";
import {authorizeEnrollment, enrollmentAvailable, recordEnrollment, recordEnrollmentDenial} from "../../../lib/device-enrollment";
import {objectField} from "@/lib/request-validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const denied = guardOrDeny(request, {action: "device:read"});
  if (denied) return denied;
  return NextResponse.json(
    {devices: listDevices(), enrollment: {available: enrollmentAvailable()}},
    {headers: {"Cache-Control": "no-store"}}
  );
}

/**
 * Geräte-Aktionen.
 *
 * Drei Wege, klar getrennt:
 *  1. **Creator-Session**: alles (Discovery, Autorisieren, Reservieren, Freigeben).
 *  2. **Enrollment-Geheimnis** (Discovery-Agent): nur `enroll` und `heartbeat` —
 *     ein Gerät kann sich melden, aber nicht autorisieren. Das Geheimnis wird
 *     nie ausgeliefert und nie protokolliert.
 *  3. Fremde/fehlende Zugangsdaten: 401/403, kein Datensatz.
 */
export async function POST(request: Request) {
  const body = (await request.clone().json().catch(() => ({}))) as {action?: string; secret?: unknown; device?: Record<string, unknown>};
  const action = String(body.action ?? "");
  const enrollmentActions = action === "enroll" || action === "heartbeat";

  // Discovery über den Agentenweg: das Enrollment-Geheimnis wird hier geprüft,
  // bevor die übliche Session-Grenze greift (das Gerät hat keine Session).
  if (enrollmentActions) {
    const identity = {
      id: String(body.device?.id ?? ""),
      name: String(body.device?.name ?? ""),
      os: String(body.device?.os ?? ""),
      arch: String(body.device?.arch ?? ""),
      cpu: Number(body.device?.cpu ?? 0),
      ramMb: Number(body.device?.ramMb ?? 0),
      gpu: body.device?.gpu === undefined ? undefined : String(body.device.gpu),
      network: (body.device?.network ?? "NONE") as "INTERNET" | "LAN" | "VPN" | "NONE" | "ALLOWLIST",
      trust: (body.device?.trust ?? "EPHEMERAL") as "LOCAL_TRUSTED" | "MANAGED" | "EPHEMERAL" | "EXPERIMENTAL" | "RESTRICTED" | "OBSERVATION_ONLY",
      capabilities: Array.isArray(body.device?.capabilities) ? (body.device?.capabilities as string[]).map(String) : []
    };
    const verdict = authorizeEnrollment(body.secret, identity);
    if (!verdict.ok) {
      recordEnrollmentDenial(verdict.code, body.device?.id);
      return NextResponse.json({error: verdict.code, message: verdict.message}, {status: verdict.status});
    }
    try {
      if (action === "enroll") {
        // `authorized` aus dem Aufruf wird verworfen: Discovery ist keine
        // Autorisierung, unabhängig davon, was das Gerät behauptet.
        const created = discoverDevice({...identity, cpu: identity.cpu || 1, ramMb: identity.ramMb || 1} as never);
        recordEnrollment(identity, "device.enroll");
        return NextResponse.json({device: created}, {status: 201, headers: {"Cache-Control": "no-store"}});
      }
      const updated = heartbeatDevice(identity.id, {capabilities: identity.capabilities, network: identity.network});
      recordEnrollment(identity, "device.heartbeat");
      return NextResponse.json({device: updated, authorized: updated.authorized}, {headers: {"Cache-Control": "no-store"}});
    } catch (error) {
      return NextResponse.json({error: error instanceof Error ? error.message : "device error"}, {status: 400});
    }
  }

  const creatorOnly = ["authorize", "discover", "allocate", "release"].includes(action);
  const denied = guardOrDeny(request, {action: creatorOnly ? "device:authorize" : "device:manage", creatorOnly});
  if (denied) return denied;

  try {
    const granted = await request.json();
    if (granted.action === "discover") return NextResponse.json({device: discoverDevice(objectField(granted, "device") as never)}, {status: 201});
    if (granted.action === "authorize") return NextResponse.json({device: authorizeDevice(String(granted.id), Boolean(granted.authorized))});
    if (granted.action === "allocate") return NextResponse.json({device: allocateDevice(String(granted.id), String(granted.taskId))});
    if (granted.action === "allocate-best") {
      // Ohne Task ist das kein Auftrag: Eine Zuweisung an "undefined" wäre ein
      // stiller Erfolg, der im Betrieb wie eine echte Reservierung aussieht.
      if (typeof granted.taskId !== "string" || granted.taskId.trim().length === 0) {
        return NextResponse.json({error: "taskId required"}, {status: 400});
      }
      return NextResponse.json({device: (await import("../../../lib/devices")).scheduleDevice(String(granted.taskId), {cpu: granted.cpu === undefined ? undefined : Number(granted.cpu), ramMb: granted.ramMb === undefined ? undefined : Number(granted.ramMb), gpu: granted.gpu === undefined ? undefined : String(granted.gpu), os: granted.os === undefined ? undefined : String(granted.os), arch: granted.arch === undefined ? undefined : String(granted.arch), capabilities: Array.isArray(granted.capabilities) ? granted.capabilities.map(String) : undefined, network: granted.network === undefined ? undefined : String(granted.network) as never})});
    }
    if (granted.action === "release") return NextResponse.json({device: releaseDevice(String(granted.id))});
    return NextResponse.json({error: "Unsupported device action", supported: ["discover", "authorize", "allocate", "allocate-best", "release", "enroll", "heartbeat"]}, {status: 400});
  } catch (error) {
    return NextResponse.json({error: error instanceof Error ? error.message : "device error"}, {status: 400});
  }
}
