import {NextResponse} from "next/server";
import {
  cloneSandbox,
  createSandbox,
  destroySandbox,
  listSandboxes,
  pauseSandbox,
  resetSandbox,
  restoreSandbox,
  snapshotSandbox,
  startSandbox
} from "../../../lib/sandbox/fabric";
import {guardRequest} from "../../../lib/api/guard";
import type {Risk, SandboxType} from "../../../lib/types";

/**
 * Sandbox-Lebenszyklus über die Fabric (Abschnitt 11).
 *
 * Schreiben ist Creator-only: Sandboxes sind autorisierte Ausführungsumgebungen,
 * ihre Erzeugung, Snapshots und Wiederherstellungen sind Governance-Akte.
 * Die eigentliche Ausführung (argv[]) läuft ausschließlich über den Broker
 * (`POST /api/runtime`) mit Capability-Token.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const TYPES: SandboxType[] = ["development", "experiment", "test", "browser", "security", "migration", "staging", "recovery", "diagnostic"];
const RISKS: Risk[] = ["SAFE", "LOW", "MODERATE", "HIGH", "CRITICAL"];

export async function GET(req: Request) {
  guardRequest(req, {action: "sandbox:read"});
  return NextResponse.json({sandboxes: listSandboxes()}, {headers: {"Cache-Control": "no-store"}});
}

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as Record<string, unknown>;
    const action = String(body.action ?? "");
    const sandboxId = typeof body.sandboxId === "string" ? body.sandboxId : undefined;

    if (action === "create" || action === "clone") {
      const taskId = String(body.taskId ?? "");
      const risk = (RISKS.includes(body.risk as Risk) ? body.risk : "LOW") as Risk;
      guardRequest(req, {action: `sandbox:${action}`, creatorOnly: true, taskId, risk});
      const request = {
        sandboxId,
        type: (TYPES.includes(body.type as SandboxType) ? body.type : "development") as SandboxType,
        taskId,
        agentId: String(body.agentId ?? ""),
        risk,
        image: typeof body.image === "string" ? body.image : undefined
      };
      const sandbox = action === "create" ? await createSandbox(request) : await cloneSandbox(String(body.sourceSandboxId ?? ""), request);
      return NextResponse.json({sandbox}, {status: 201});
    }

    if (action === "snapshot") {
      guardRequest(req, {action: "sandbox:snapshot", creatorOnly: true, sandboxId});
      const snapshot = await snapshotSandbox(String(sandboxId), "CREATOR");
      return NextResponse.json({snapshot}, {status: 201});
    }

    if (action === "restore") {
      guardRequest(req, {action: "sandbox:restore", creatorOnly: true, sandboxId});
      const sandbox = await restoreSandbox(String(sandboxId), String(body.snapshotId ?? ""), "CREATOR");
      return NextResponse.json({sandbox});
    }

    if (["start", "pause", "reset", "destroy"].includes(action)) {
      guardRequest(req, {action: `sandbox:${action}`, creatorOnly: true, sandboxId});
      if (action === "start") return NextResponse.json({sandbox: await startSandbox(String(sandboxId))});
      if (action === "pause") return NextResponse.json({sandbox: await pauseSandbox(String(sandboxId))});
      if (action === "reset") return NextResponse.json({sandbox: await resetSandbox(String(sandboxId))});
      await destroySandbox(String(sandboxId));
      return NextResponse.json({destroyed: true});
    }

    return NextResponse.json({error: "unknown action", supported: ["create", "clone", "start", "pause", "reset", "snapshot", "restore", "destroy"]}, {status: 400});
  } catch (error) {
    if (error instanceof Error && "status" in error) {
      const denied = error as {status: number; code?: string; message: string};
      return NextResponse.json({error: denied.code ?? "DENIED", message: denied.message}, {status: denied.status});
    }
    return NextResponse.json({error: error instanceof Error ? error.message : "invalid request"}, {status: 400});
  }
}
