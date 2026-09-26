import {NextResponse} from "next/server";
import {bindProvider,connectProvider,disconnectProvider,heartbeatProvider,providerSnapshot,revokeProvider,setProviderState} from "@/lib/provider-fabric";
import {guardOrDeny} from "@/lib/api/api-gate";
export const runtime="nodejs";
export const dynamic="force-dynamic";
export async function GET(request:Request){const denied=guardOrDeny(request,{action:"provider:read"});if(denied)return denied;return NextResponse.json(providerSnapshot(),{headers:{"Cache-Control":"no-store"}})}
export async function POST(req:Request){
 const gate = await import("@/lib/api/api-gate");
 const body = (await req.clone().json().catch(() => ({}))) as {action?:string};
 const creatorOnly = ["connect","revoke","disconnect"].includes(String(body.action));
 const denied = gate.guardOrDeny(req, {action: creatorOnly ? "provider:connect" : "provider:manage", creatorOnly});
 if (denied) return denied;

 try{const b=await req.json();
 if(b.action==="connect")return NextResponse.json({provider:connectProvider(b.id,b.endpoint,b.credentialRef,b.approvalId)});
 if(b.action==="disconnect")return NextResponse.json({provider:disconnectProvider(b.id)});
 if(b.action==="revoke")return NextResponse.json({provider:revokeProvider(b.id)});
 if(b.action==="state")return NextResponse.json({provider:setProviderState(b.id,b.lifecycle,b.health,b.message)});
 if(b.action==="heartbeat")return NextResponse.json({provider:heartbeatProvider(b.id,{health:b.health,latencyMs:b.latencyMs,message:b.message})});
 if(b.action==="bind")return NextResponse.json({binding:bindProvider(b.providerId,b.scope,b.scopeId,b.capabilities)},{status:201});
 return NextResponse.json({error:"unknown action"},{status:400});
 }catch(e){return NextResponse.json({error:e instanceof Error?e.message:"invalid request"},{status:400})}
}
