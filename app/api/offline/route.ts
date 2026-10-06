import {NextResponse} from "next/server";
import {createOfflineTaskPackage, exportOfflineSync, finishOfflineExecution, mergeOfflineSync, offlineReport, offlineSnapshot, registerOfflineAsset, startOfflineExecution} from "../../../lib/offline";
import {guardOrDeny} from "../../../lib/api/api-gate";
export const runtime="nodejs";
export const dynamic="force-dynamic";

export async function GET(request: Request) {
  const denied = guardOrDeny(request, {action:"offline:read"});
  if (denied) return denied;
  return NextResponse.json({report:offlineReport(), ...offlineSnapshot()},{headers:{"Cache-Control":"no-store"}});
}

export async function POST(request: Request) {
  try {
    const denied = guardOrDeny(request, {action:"offline:write", creatorOnly:true});
    if (denied) return denied;
    const body = await request.json();
    switch (body.action) {
      case "register-asset":
        return NextResponse.json(registerOfflineAsset(body.asset),{status:201});
      case "create-package":
        return NextResponse.json(createOfflineTaskPackage(String(body.taskId), body.task, Array.isArray(body.assetIds)?body.assetIds.map(String):[], String(body.origin)),{status:201});
      case "start":
        return NextResponse.json(startOfflineExecution(String(body.packageId)),{status:201});
      case "finish":
        return NextResponse.json(finishOfflineExecution(String(body.executionId),{status:body.status,artifactIds:Array.isArray(body.artifactIds)?body.artifactIds.map(String):[],evidenceIds:Array.isArray(body.evidenceIds)?body.evidenceIds.map(String):[],log:typeof body.log==="string"?body.log:undefined}));
      case "export":
        return NextResponse.json({records:exportOfflineSync(String(body.origin))},{status:201});
      case "merge":
        return NextResponse.json(mergeOfflineSync(body.records),{status:201});
      default:
        return NextResponse.json({error:"Unsupported offline action"},{status:400});
    }
  } catch (error) {
    return NextResponse.json({error:error instanceof Error?error.message:"offline error"},{status:400});
  }
}
