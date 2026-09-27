import {NextResponse} from "next/server";
import {
  createOfflinePackage,
  executeOfflinePackage,
  importRemoteAsset,
  listOfflineAssets,
  listOfflinePackages,
  listOfflineRuns,
  listOfflineSyncs,
  offlineFabricSummary,
  planOfflineSync,
  registerOfflineAsset,
  resolveOfflineConflict,
  type OfflineAssetKind,
  type RemoteManifest
} from "../../../lib/offline/offline-fabric";
import {guardRequest, toDeniedResponse, type GuardedRequest} from "../../../lib/api/guard";

/**
 * Offline Fabric (MASTER §36 / OFF-001, Phase 4 / 7.4).
 *
 * Lesen: authentifizierte Session. Bestands-/Paket-/Sync-Aktionen sind
 * Creator-Aktionen (`offline:manage`); die Ausführung selbst läuft nicht hier,
 * sondern ausschließlich über den autorisierten Systempfad in einer
 * DENY-Sandbox.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  try {
    guardRequest(req, {action: "offline:read"});
    return NextResponse.json(
      {
        summary: offlineFabricSummary(),
        assets: listOfflineAssets().slice(-200),
        packages: listOfflinePackages().slice(-100),
        runs: listOfflineRuns().slice(-100),
        syncs: listOfflineSyncs().slice(-50)
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
    guarded = guardRequest(req, {action: "offline:manage", creatorOnly: true, risk: "MODERATE"});
  } catch (error) {
    const denied = toDeniedResponse(error);
    if (denied) return denied;
    throw error;
  }
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const action = String(body.action ?? "");
  const actor = guarded.actor.actorId;
  try {
    if (action === "register-asset") {
      if (typeof body.name !== "string" || typeof body.version !== "string" || typeof body.kind !== "string" || typeof body.content !== "string") {
        return NextResponse.json({error: "kind, name, version and content are required"}, {status: 400});
      }
      const asset = registerOfflineAsset({
        kind: body.kind as OfflineAssetKind,
        name: body.name,
        version: body.version,
        content: body.content,
        source: typeof body.source === "string" ? body.source : "manual",
        addedBy: actor
      });
      return NextResponse.json({asset}, {status: 201});
    }
    if (action === "create-package") {
      if (typeof body.taskId !== "string" || !Array.isArray(body.assets)) {
        return NextResponse.json({error: "taskId and assets are required"}, {status: 400});
      }
      const pkg = createOfflinePackage({
        taskId: body.taskId,
        assets: body.assets as Array<{kind: OfflineAssetKind; name: string; version: string}>,
        ...(Array.isArray(body.argv) ? {argv: body.argv as string[]} : {}),
        createdBy: actor
      });
      return NextResponse.json({package: pkg}, {status: 201});
    }
    if (action === "execute") {
      if (typeof body.packageId !== "string" || typeof body.sandboxId !== "string" || !Array.isArray(body.argv)) {
        return NextResponse.json({error: "packageId, sandboxId and argv are required"}, {status: 400});
      }
      const run = await executeOfflinePackage({
        packageId: body.packageId,
        sandboxId: body.sandboxId,
        argv: body.argv as string[],
        ...(typeof body.timeoutMs === "number" ? {timeoutMs: body.timeoutMs} : {})
      });
      return NextResponse.json({run});
    }
    if (action === "sync") {
      const manifest = body.manifest as RemoteManifest | undefined;
      if (!manifest || typeof manifest.source !== "string" || !Array.isArray(manifest.items)) {
        return NextResponse.json({error: "manifest with source and items is required"}, {status: 400});
      }
      const sync = planOfflineSync(manifest, actor);
      return NextResponse.json({sync});
    }
    if (action === "resolve-conflict") {
      if (typeof body.syncId !== "string" || typeof body.kind !== "string" || typeof body.name !== "string" || typeof body.version !== "string") {
        return NextResponse.json({error: "syncId, kind, name and version are required"}, {status: 400});
      }
      const resolution = body.resolution === "ACCEPT_REMOTE" ? "ACCEPT_REMOTE" : "KEEP_LOCAL";
      const decision = resolveOfflineConflict(body.syncId, {kind: body.kind as OfflineAssetKind, name: body.name, version: body.version}, resolution, actor);
      return NextResponse.json({decision});
    }
    if (action === "import-remote") {
      const item = body.item as {kind: OfflineAssetKind; name: string; version: string; digest: string} | undefined;
      if (!item || typeof body.content !== "string") {
        return NextResponse.json({error: "item and content are required"}, {status: 400});
      }
      const asset = importRemoteAsset({item, content: body.content, source: typeof body.source === "string" ? body.source : "remote", addedBy: actor});
      return NextResponse.json({asset}, {status: 201});
    }
    return NextResponse.json({error: "unknown action"}, {status: 400});
  } catch (error) {
    return NextResponse.json({error: error instanceof Error ? error.message : "offline action failed"}, {status: 400});
  }
}
