import {NextResponse} from "next/server";
import {bindProvider,connectProvider,disconnectProvider,heartbeatProvider,providerSnapshot,revokeProvider,setProviderState} from "@/lib/provider-fabric";
export const runtime="nodejs";
export const dynamic="force-dynamic";
export async function GET(){return NextResponse.json(providerSnapshot(),{headers:{"Cache-Control":"no-store"}})}
export async function POST(req:Request){
 try{const b=await req.json();
 if(b.action==="connect")return NextResponse.json({provider:connectProvider(b.id,b.endpoint,b.credentialRef)});
 if(b.action==="disconnect")return NextResponse.json({provider:disconnectProvider(b.id)});
 if(b.action==="revoke")return NextResponse.json({provider:revokeProvider(b.id)});
 if(b.action==="state")return NextResponse.json({provider:setProviderState(b.id,b.lifecycle,b.health,b.message)});
 if(b.action==="heartbeat")return NextResponse.json({provider:heartbeatProvider(b.id,{health:b.health,latencyMs:b.latencyMs,message:b.message})});
 if(b.action==="bind")return NextResponse.json({binding:bindProvider(b.providerId,b.scope,b.scopeId,b.capabilities)},{status:201});
 return NextResponse.json({error:"unknown action"},{status:400});
 }catch(e){return NextResponse.json({error:e instanceof Error?e.message:"invalid request"},{status:400})}
}
