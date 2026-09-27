import {NextResponse} from "next/server";
import {guardOrDeny} from "@/lib/api/api-gate";
import {exportOfflineBundle, importOfflineBundle, listOfflineResources, offlineStatus, prepareOfflineSync, registerOfflineResource, verifyOfflineResource, verifyOfflineSync} from "@/lib/offline-fabric";

export const runtime="nodejs";
export const dynamic="force-dynamic";

export async function GET(request: Request) {
  const denied=guardOrDeny(request,{action:"offline:read"});
  if(denied) return denied;
  return NextResponse.json({status:offlineStatus(),resources:listOfflineResources()},{headers:{"Cache-Control":"no-store"}});
}
export async function POST(request: Request) {
  const denied=guardOrDeny(request,{action:"offline:manage",creatorOnly:true});
  if(denied) return denied;
  try {
    const body=await request.json();
    if(body.action==="register") return NextResponse.json({resource:registerOfflineResource(body.resource)},{status:201});
    if(body.action==="verify") return NextResponse.json({resource:verifyOfflineResource(String(body.id))});
    if(body.action==="sync.prepare") return NextResponse.json({sync:prepareOfflineSync(String(body.id),String(body.targetDigest))},{status:201});
    if(body.action==="sync.verify") return NextResponse.json({sync:verifyOfflineSync(String(body.id),String(body.targetDigest))});
    if(body.action==="bundle.export") return NextResponse.json({bundle:exportOfflineBundle(Array.isArray(body.resourceIds)?body.resourceIds.map(String):[],String(body.destination))},{status:201});
    if(body.action==="bundle.import") return NextResponse.json({bundle:importOfflineBundle(String(body.destination))},{status:201});
    return NextResponse.json({error:"unsupported offline action"},{status:400});
  } catch(error) { return NextResponse.json({error:error instanceof Error?error.message:"offline error"},{status:400}); }
}
