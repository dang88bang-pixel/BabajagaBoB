import {NextResponse} from "next/server";
import {createOfflineTaskPackage, exportOfflineSync, finishOfflineExecution, mergeOfflineSync, offlineReport, offlineSnapshot, registerOfflineAsset, startOfflineExecution} from "../../../lib/offline";
import {guardOrDeny} from "../../../lib/api/api-gate";
import {actionField, readJson, stringArray, stringField} from "../../../lib/request-validation";
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
    const body = await readJson(request);
    const action = actionField(body, ["register-asset","create-package","start","finish","export","merge"]);
    switch (action) {
      case "register-asset":
        if (!body.asset || typeof body.asset !== "object" || Array.isArray(body.asset)) throw new Error("asset object required");
        return NextResponse.json(registerOfflineAsset(body.asset as never),{status:201});
      case "create-package":
        if (!body.task || typeof body.task !== "object" || Array.isArray(body.task)) throw new Error("task object required");
        return NextResponse.json(createOfflineTaskPackage(stringField(body,"taskId",256), body.task as Record<string,unknown>, stringArray(body.assetIds,"assetIds",100,256), stringField(body,"origin",200)),{status:201});
      case "start":
        return NextResponse.json(startOfflineExecution(stringField(body,"packageId",256)),{status:201});
      case "finish":
        if (body.status !== "SUCCEEDED" && body.status !== "FAILED") throw new Error("status must be SUCCEEDED or FAILED");
        return NextResponse.json(finishOfflineExecution(stringField(body,"executionId",256),{status:body.status,artifactIds:Array.isArray(body.artifactIds)?stringArray(body.artifactIds,"artifactIds",100,256):[],evidenceIds:Array.isArray(body.evidenceIds)?stringArray(body.evidenceIds,"evidenceIds",100,256):[],log:typeof body.log==="string"?body.log:undefined}));
      case "export":
        return NextResponse.json({records:exportOfflineSync(stringField(body,"origin",200))},{status:201});
      case "merge":
        if (!Array.isArray(body.records)) throw new Error("records array required");
        return NextResponse.json(mergeOfflineSync(body.records),{status:201});
      default:
        return NextResponse.json({error:"Unsupported offline action"},{status:400});
    }
  } catch (error) {
    return NextResponse.json({error:error instanceof Error?error.message:"offline error"},{status:400});
  }
}
