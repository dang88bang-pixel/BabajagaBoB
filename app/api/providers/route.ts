import {NextResponse} from "next/server";
import {bindProvider,connectProvider,disconnectProvider,heartbeatProvider,providerSnapshot,revokeProvider,setProviderState} from "@/lib/provider-fabric";
import {actionField,readJson,stringField,stringArray} from "@/lib/request-validation";
import {requireControlPlaneAuth} from "@/lib/control-auth";

export const runtime="nodejs";
export const dynamic="force-dynamic";

export async function GET(){
 return NextResponse.json(providerSnapshot(),{headers:{"Cache-Control":"no-store"}});
}

export async function POST(req:Request){
 try{
  requireControlPlaneAuth(req);
  const b=await readJson(req);
  const action=actionField(b,["connect","disconnect","revoke","state","heartbeat","bind"]);
  const id=stringField(b,"id",128);
  if(action==="connect"){
   return NextResponse.json({provider:connectProvider(id,typeof b.endpoint==="string"?b.endpoint:undefined,typeof b.credentialRef==="string"?b.credentialRef:undefined,typeof b.approvalId==="string"?b.approvalId:undefined)});
  }
  if(action==="disconnect")return NextResponse.json({provider:disconnectProvider(id)});
  if(action==="revoke")return NextResponse.json({provider:revokeProvider(id)});
  if(action==="state")return NextResponse.json({provider:setProviderState(
   id,
   b.lifecycle as Parameters<typeof setProviderState>[1],
   b.health as Parameters<typeof setProviderState>[2],
   typeof b.message==="string"?b.message:undefined
  )});
  if(action==="heartbeat")return NextResponse.json({provider:heartbeatProvider(id,{
   health:b.health as Parameters<typeof heartbeatProvider>[1]["health"],
   latencyMs:typeof b.latencyMs==="number"?b.latencyMs:undefined,
   message:typeof b.message==="string"?b.message:undefined
  })});
  return NextResponse.json({binding:bindProvider(
   stringField(b,"providerId",128),
   b.scope as Parameters<typeof bindProvider>[1],
   stringField(b,"scopeId",256),
   stringArray(b.capabilities,"capabilities")
  )},{status:201});
 }catch(e){
  return NextResponse.json({error:e instanceof Error?e.message:"invalid request"},{status:400});
 }
}
