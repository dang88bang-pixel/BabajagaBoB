import {NextResponse} from "next/server";
import {dispatchTask} from "@/lib/dispatcher";
import {runWorkerCycle} from "@/lib/worker";
import type {Risk} from "@/lib/types";

/**
 * Dispatcher-/Worker-Endpunkt.
 *
 * Der frühere direkte Worker-Pfad (`worker.start`/`worker.complete`/`worker.fail`)
 * ist stillgelegt: Diese Übergänge hätten Execution Gate, Broker und
 * Capability-Prüfung umgangen. Ausführung läuft ausschließlich über den
 * governed Worker-Zyklus (`worker.cycle`) oder den Dispatcher (`dispatch`).
 */
export async function POST(req: Request) {
  const body = await req.json();
  if (body.action === "dispatch") {
    const result = await dispatchTask({
      taskId: body.taskId,
      agentId: body.agentId,
      risk: body.risk as Risk,
      sandboxType: body.sandboxType
    });
    return NextResponse.json(result, {status: 201});
  }
  if (body.action === "worker.cycle") {
    const result = await runWorkerCycle(typeof body.workerId === "string" ? body.workerId : undefined);
    return NextResponse.json(result);
  }
  if (["worker.start", "worker.complete", "worker.fail"].includes(body.action)) {
    return NextResponse.json(
      {error: "worker.start/complete/fail sind stillgelegt; Ausführung nur über den governed Zyklus (action=worker.cycle)"},
      {status: 409}
    );
  }
  return NextResponse.json({error: "unknown action"}, {status: 400});
}
