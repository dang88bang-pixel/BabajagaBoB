import {NextResponse} from "next/server";
import {dispatchTask} from "@/lib/dispatcher";
import {runWorkerCycle} from "@/lib/worker";
import type {Risk} from "@/lib/types";
import {guardOrDeny} from "@/lib/api/api-gate";

/**
 * Dispatcher-/Worker-Endpunkt.
 *
 * Der frühere direkte Worker-Pfad (`worker.start`/`worker.complete`/`worker.fail`)
 * ist stillgelegt: Diese Übergänge hätten Execution Gate, Broker und
 * Capability-Prüfung umgangen. Ausführung läuft ausschließlich über den
 * governed Worker-Zyklus (`worker.cycle`) oder den Dispatcher (`dispatch`).
 */
export async function POST(req: Request) {
  // Tolerant parsen: ein unlesbarer Body darf keinen 500er erzeugen (und erst
  // recht nicht, bevor der Guard geprüft hat).
  const body = (await req.clone().json().catch(() => ({}))) as Record<string, unknown>;
  const denied = guardOrDeny(req, {
    action: body.action === "dispatch" ? "task:dispatch" : "worker:cycle",
    taskId: typeof body.taskId === "string" ? body.taskId : undefined,
    risk: typeof body.risk === "string" ? (body.risk as Risk) : undefined
  });
  if (denied) return denied;
  if (body.action === "dispatch") {
    // Pflichtfelder explizit prüfen: `undefined` in der Dispatch-Anfrage wäre
    // ein Lauf gegen eine nicht existierende Aufgabe.
    if (typeof body.taskId !== "string" || typeof body.agentId !== "string") {
      return NextResponse.json({error: "taskId and agentId are required"}, {status: 400});
    }
    try {
      const result = await dispatchTask({
        taskId: body.taskId,
        agentId: body.agentId,
        risk: body.risk as Risk,
        sandboxType: body.sandboxType as Parameters<typeof dispatchTask>[0]["sandboxType"]
      });
      return NextResponse.json(result, {status: 201});
    } catch (error) {
      return NextResponse.json({error: error instanceof Error ? error.message : "dispatch failed"}, {status: 400});
    }
  }
  if (body.action === "worker.cycle") {
    try {
      const result = await runWorkerCycle(typeof body.workerId === "string" ? body.workerId : undefined);
      return NextResponse.json(result);
    } catch (error) {
      return NextResponse.json({error: error instanceof Error ? error.message : "worker cycle failed"}, {status: 400});
    }
  }
  if (["worker.start", "worker.complete", "worker.fail"].includes(String(body.action))) {
    return NextResponse.json(
      {error: "worker.start/complete/fail sind stillgelegt; Ausführung nur über den governed Zyklus (action=worker.cycle)"},
      {status: 409}
    );
  }
  return NextResponse.json({error: "unknown action"}, {status: 400});
}
