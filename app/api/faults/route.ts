import {NextResponse} from "next/server";
import {guardOrDeny} from "@/lib/api/api-gate";
import {actionField, optionalString, readJson, stringField} from "@/lib/request-validation";
import {FAULT_KINDS, type FaultKind, faultSnapshot, injectFault} from "@/lib/fault-injection";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Fehlerinjektion (Abschnitt 37 / TEST-003).
 *
 * `GET` liefert Katalog, bisherige Injektionen und die Berichte der
 * Skriptprüfer (echter Prozessabsturz des Dienstes, Sabotageproben).
 *
 * `POST` ist eine **Creator-Aktion**: Eine Injektion verändert den Zustand
 * wirklich (Prozessabbruch, Lease-Verlust, konkurrierende Schreibvorgänge) und
 * darf deshalb nicht von einem Agenten ausgelöst werden. Ein aktiver
 * System-Kill-Switch blockiert sie zusätzlich (Prüfung in `lib/fault-injection.ts`).
 */
export async function GET(request: Request) {
  const denied = guardOrDeny(request, {action: "fault:read"});
  if (denied) return denied;
  return NextResponse.json(faultSnapshot(), {headers: {"Cache-Control": "no-store"}});
}

export async function POST(request: Request) {
  const denied = guardOrDeny(request, {action: "fault:inject", creatorOnly: true});
  if (denied) return denied;
  try {
    const body = await readJson(request);
    const action = actionField(body, ["inject"]);
    if (action !== "inject") return NextResponse.json({error: "unknown action", supported: ["inject"]}, {status: 400});
    const kind = stringField(body, "kind", 40) as FaultKind;
    if (!FAULT_KINDS.includes(kind)) {
      return NextResponse.json({error: "unsupported fault kind", supported: FAULT_KINDS}, {status: 400});
    }
    const count = optionalString(body, "count", 4);
    const injection = await injectFault({kind, requestedBy: "CREATOR", count: count ? Number(count) : undefined});
    // Kein stiller Erfolg: Ein nicht bestandener Nachweis ist ein Fehlschlag.
    const status = injection.outcome === "SURVIVED" ? 200 : injection.outcome === "NOT_INJECTED" ? 409 : 500;
    return NextResponse.json({injection}, {status});
  } catch (error) {
    const message = error instanceof Error ? error.message : "fault injection failed";
    return NextResponse.json({error: message}, {status: /kill-switch/i.test(message) ? 423 : 400});
  }
}
