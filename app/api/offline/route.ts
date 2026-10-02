import {NextResponse} from "next/server";
import {guardOrDeny} from "@/lib/api/api-gate";
import {guardRequest, parseCapabilityHeader, toDeniedResponse} from "@/lib/api/guard";
import {verifyCapabilitySecret} from "@/lib/authority";
import {stringArray} from "@/lib/request-validation";
import {createOfflineEvidenceBundle, importOfflineEvidenceBundle, offlineFabricReport, offlineSyncHistory} from "@/lib/offline-fabric";
import {listOfflineAssets, offlineAssetStoreReport, registerOfflineAsset, verifyOfflineAsset} from "@/lib/offline-assets";
import {
  activateOfflineTaskPackage,
  createOfflineTaskPackage,
  getOfflineTaskPackageImport,
  importOfflineTaskPackage,
  offlineTaskPackageExecutionBinding,
  offlineTaskPackageHistory,
  offlineTaskPackageImportHistory,
  offlineTaskPackageStoreReport,
  validateOfflineTaskPackage,
  type OfflineTaskPackage
} from "@/lib/offline-task-packages";
import {getControlState} from "@/lib/control-plane";
import {executeAuthorized} from "@/lib/execution-broker";
import {activeRuntimeMode} from "@/lib/runtime-factory";
import {isolationReport} from "@/lib/ns-isolation";
import {addProvenanceEdge} from "@/lib/provenance";
import {observe} from "@/lib/observability";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const MAX_REQUEST_BYTES = 2_100_000;

export async function GET(request: Request) {
  const denied = guardOrDeny(request, {action: "offline:read", creatorOnly: true});
  if (denied) return denied;
  return NextResponse.json({
    status: offlineFabricReport(),
    imports: offlineSyncHistory(),
    assets: listOfflineAssets(),
    assetCatalog: offlineAssetStoreReport(),
    taskPackages: offlineTaskPackageHistory(),
    taskPackageImports: offlineTaskPackageImportHistory(),
    taskPackageCatalog: offlineTaskPackageStoreReport()
  }, {headers: {"Cache-Control": "no-store"}});
}

export async function POST(request: Request) {
  const declaredLength = Number(request.headers.get("content-length") ?? 0);
  if (Number.isFinite(declaredLength) && declaredLength > MAX_REQUEST_BYTES) {
    return NextResponse.json({error: "offline request exceeds the size limit"}, {status: 413});
  }
  try {
    const raw = await request.text();
    if (Buffer.byteLength(raw, "utf8") > MAX_REQUEST_BYTES) return NextResponse.json({error: "offline request exceeds the size limit"}, {status: 413});
    const body = JSON.parse(raw) as Record<string, unknown>;

    if (body.action === "package.execute") {
      const candidate = body.taskPackage as Partial<OfflineTaskPackage> | null;
      const task = candidate?.task;
      const sandbox = candidate?.sandbox;
      if (!candidate || typeof candidate.packageId !== "string" || !task || !sandbox || typeof task.taskId !== "string") {
        return NextResponse.json({error: "a signed, activated taskPackage is required"}, {status: 400});
      }
      const capability = parseCapabilityHeader(request.headers.get("authorization"));
      if (!capability) return NextResponse.json({error: "agent capability token is required for package execution"}, {status: 401});
      if (!verifyCapabilitySecret(capability.tokenId, capability.secret)) return NextResponse.json({error: "capability token secret is invalid"}, {status: 403});

      const activation = getOfflineTaskPackageImport(candidate.packageId);
      if (!activation || activation.status !== "ACTIVE" || !activation.localBindings) {
        return NextResponse.json({error: "OFFLINE_PACKAGE_NOT_ACTIVATED", message: "a Creator must import and activate this package against local task, plan and sandbox bindings first"}, {status: 409, headers: {"Cache-Control": "no-store"}});
      }
      if (activation.payloadDigest !== candidate.payloadDigest || activation.originNodeId !== candidate.originNodeId) {
        return NextResponse.json({error: "OFFLINE_PACKAGE_BINDING_MISMATCH"}, {status: 409, headers: {"Cache-Control": "no-store"}});
      }
      const localState = getControlState();
      const localTask = localState.tasks.find(value => value.taskId === activation.localBindings?.taskId);
      const localSandbox = localState.sandboxes.find(value => value.sandboxId === activation.localBindings?.sandboxId);
      if (!localTask || !localSandbox || !localTask.assignedAgent) {
        return NextResponse.json({error: "OFFLINE_PACKAGE_LOCAL_BINDING_MISSING"}, {status: 409, headers: {"Cache-Control": "no-store"}});
      }
      const authorization = guardRequest(request, {
        action: "sandbox:run",
        requireAgentCapability: "task:execute",
        taskId: localTask.taskId,
        sandboxId: localSandbox.sandboxId,
        environment: localSandbox.type,
        risk: localTask.risk
      });
      const validation = await validateOfflineTaskPackage(candidate, {actor: authorization.actor.actorId});
      const binding = offlineTaskPackageExecutionBinding(candidate);
      const taskPackage = candidate as OfflineTaskPackage;
      const isolatedRuntimeAvailable = (activeRuntimeMode === "oci" && binding.runtimeMode === "real-oci") ||
        (activeRuntimeMode === "local" && binding.runtimeMode === "real-local" && isolationReport().level === "NAMESPACES");
      if (!isolatedRuntimeAvailable) {
        observe({
          type: "offline.task-package.execution-denied",
          message: "Offline-Ausführung verweigert: keine nachgewiesene Netzwerk-/Runtime-Isolation",
          status: "BLOCKED",
          actor: authorization.actor.actorId,
          taskId: binding.localTaskId,
          sandboxId: binding.localSandboxId,
          action: "offline.task-package.execute",
          resource: taskPackage.packageId,
          decision: "DENY",
          authorizationRef: capability.tokenId,
          argumentsValue: {runtimeMode: activeRuntimeMode, sandboxRuntimeMode: binding.runtimeMode, isolation: isolationReport().level}
        });
        return NextResponse.json({error: "OFFLINE_ISOLATION_UNAVAILABLE", message: "offline task execution requires a verified OCI or NAMESPACES-isolated runtime"}, {status: 503, headers: {"Cache-Control": "no-store"}});
      }
      if (taskPackage.assets.length > 0 && activeRuntimeMode !== "local") {
        return NextResponse.json({error: "OFFLINE_ASSET_STAGING_UNAVAILABLE", message: "the selected isolated runtime does not expose a workspace for pinned asset staging"}, {status: 503, headers: {"Cache-Control": "no-store"}});
      }
      const argv = stringArray(body.argv, "argv", 64, 4096);
      const timeoutMs = body.timeoutMs;
      if (timeoutMs !== undefined && (typeof timeoutMs !== "number" || !Number.isSafeInteger(timeoutMs))) {
        return NextResponse.json({error: "timeoutMs must be an integer"}, {status: 400});
      }
      const runId = body.runId;
      if (runId !== undefined && (typeof runId !== "string" || runId.length === 0 || runId.length > 128)) {
        return NextResponse.json({error: "runId must be a non-empty string of at most 128 characters"}, {status: 400});
      }
      const result = await executeAuthorized({
        taskId: binding.localTaskId,
        agentId: binding.localAgentId,
        sandboxId: binding.localSandboxId,
        capabilityTokenId: capability.tokenId,
        approvalId: binding.localApprovalId ?? undefined,
        argv,
        timeoutMs: timeoutMs as number | undefined,
        runId: runId as string | undefined,
        purpose: `OFFLINE_TASK_PACKAGE:${taskPackage.packageId}`,
        offlineTaskPackage: {packageId: taskPackage.packageId, assets: taskPackage.assets}
      });
      if (result.evidence?.artifactId) {
        addProvenanceEdge({from: result.evidence.artifactId, to: taskPackage.packageId, relation: "DERIVED_FROM", note: "Broker execution under signed offline task package"});
      }
      observe({
        type: result.accepted ? "offline.task-package.executed" : "offline.task-package.execution-failed",
        message: `Offline-Task-Paket ${validation.packageId} über den Execution Broker ausgeführt`,
        status: result.accepted ? "COMPLETED" : "ERROR",
        actor: authorization.actor.actorId,
        taskId: binding.localTaskId,
        sandboxId: binding.localSandboxId,
        action: "offline.task-package.execute",
        resource: taskPackage.packageId,
        decision: result.accepted ? "ALLOW" : "ERROR",
        authorizationRef: capability.tokenId,
        outputRef: result.evidence?.artifactId,
        argumentsValue: {payloadDigest: taskPackage.payloadDigest, evidenceId: result.evidence?.artifactId ?? null, argvCount: argv.length, accepted: result.accepted, localTaskId: binding.localTaskId}
      });
      return NextResponse.json({validation, result}, {headers: {"Cache-Control": "no-store"}});
    }

    const denied = guardOrDeny(request, {action: "offline:sync", creatorOnly: true});
    if (denied) return denied;

    if (body.action === "asset.register") {
      if (typeof body.kind !== "string" || typeof body.name !== "string" || typeof body.relativePath !== "string") {
        return NextResponse.json({error: "kind, name and relativePath are required"}, {status: 400});
      }
      const result = await registerOfflineAsset({kind: body.kind as Parameters<typeof registerOfflineAsset>[0]["kind"], name: body.name, relativePath: body.relativePath});
      return NextResponse.json(result, {status: result.duplicate ? 200 : 201, headers: {"Cache-Control": "no-store"}});
    }
    if (body.action === "asset.verify") {
      if (typeof body.assetId !== "string") return NextResponse.json({error: "assetId is required"}, {status: 400});
      const verification = await verifyOfflineAsset(body.assetId);
      return NextResponse.json({verification}, {status: verification.valid ? 200 : 409, headers: {"Cache-Control": "no-store"}});
    }
    if (body.action === "package.create") {
      if (typeof body.taskId !== "string" || typeof body.planId !== "string" || (body.assetIds !== undefined && (!Array.isArray(body.assetIds) || body.assetIds.some(id => typeof id !== "string"))) || (body.knowledgeIds !== undefined && (!Array.isArray(body.knowledgeIds) || body.knowledgeIds.some(id => typeof id !== "string")))) {
        return NextResponse.json({error: "taskId and planId are required; assetIds and knowledgeIds must be string arrays"}, {status: 400});
      }
      const taskPackage = await createOfflineTaskPackage({taskId: body.taskId, planId: body.planId, assetIds: body.assetIds as string[] | undefined, knowledgeIds: body.knowledgeIds as string[] | undefined});
      return NextResponse.json({taskPackage}, {status: 201, headers: {"Cache-Control": "no-store"}});
    }
    if (body.action === "package.validate") {
      if (!Object.hasOwn(body, "taskPackage") || (body.requireLocalBindings !== undefined && typeof body.requireLocalBindings !== "boolean")) {
        return NextResponse.json({error: "taskPackage and an optional boolean requireLocalBindings are required"}, {status: 400});
      }
      const result = await validateOfflineTaskPackage(body.taskPackage, {requireLocalBindings: body.requireLocalBindings === true});
      return NextResponse.json({result}, {headers: {"Cache-Control": "no-store"}});
    }
    if (body.action === "package.import") {
      if (!Object.hasOwn(body, "taskPackage")) return NextResponse.json({error: "taskPackage is required"}, {status: 400});
      const creator = guardRequest(request, {action: "offline:sync", creatorOnly: true});
      const result = await importOfflineTaskPackage(body.taskPackage, creator.actor.actorId);
      return NextResponse.json(result, {status: result.duplicate ? 200 : 201, headers: {"Cache-Control": "no-store"}});
    }
    if (body.action === "package.activate") {
      if (!Object.hasOwn(body, "taskPackage") || typeof body.localTaskId !== "string" || typeof body.localPlanId !== "string" || typeof body.localSandboxId !== "string" || (body.localApprovalId !== undefined && typeof body.localApprovalId !== "string")) {
        return NextResponse.json({error: "taskPackage, localTaskId, localPlanId and localSandboxId are required; localApprovalId is optional"}, {status: 400});
      }
      const creator = guardRequest(request, {action: "offline:sync", creatorOnly: true});
      const result = await activateOfflineTaskPackage({
        taskPackage: body.taskPackage,
        localTaskId: body.localTaskId,
        localPlanId: body.localPlanId,
        localSandboxId: body.localSandboxId,
        localApprovalId: body.localApprovalId as string | undefined,
        actor: creator.actor.actorId
      });
      return NextResponse.json(result, {status: 200, headers: {"Cache-Control": "no-store"}});
    }
    if (body.action === "export") {
      if (!Array.isArray(body.artifactIds) || body.artifactIds.some(id => typeof id !== "string")) {
        return NextResponse.json({error: "artifactIds must be an array of artifact ids"}, {status: 400});
      }
      return NextResponse.json({bundle: createOfflineEvidenceBundle(body.artifactIds)}, {status: 201, headers: {"Cache-Control": "no-store"}});
    }
    if (body.action === "import") {
      return NextResponse.json({result: importOfflineEvidenceBundle(body.bundle)}, {status: 200, headers: {"Cache-Control": "no-store"}});
    }
    return NextResponse.json({error: "unsupported offline action"}, {status: 400});
  } catch (error) {
    const denied = toDeniedResponse(error);
    if (denied) return denied;
    return NextResponse.json({error: error instanceof Error ? error.message : "offline request failed"}, {status: 400});
  }
}
