import {activeSandboxRuntime,activeRuntimeMode,reconcileActiveRuntime} from "../../../lib/runtime-factory";
import {executeAuthorized} from "../../../lib/execution-broker";
import {actionField,readJson,stringArray,stringField,requireCapability} from "../../../lib/request-validation";
import {requireControlPlaneAuth} from "../../../lib/control-auth";
export const runtime="nodejs";
export const dynamic="force-dynamic";
export async function GET(){
 try{
  if(activeRuntimeMode!=="oci") return Response.json({mode:activeRuntimeMode,health:"READY",network:"DENY",observations:[],summary:{total:0,running:0,ready:0,paused:0,failed:0,orphaned:0}});
  const observations=await reconcileActiveRuntime();
  const summary={total:observations.length,running:observations.filter(x=>x.state==="RUNNING").length,ready:observations.filter(x=>x.state==="READY").length,paused:observations.filter(x=>x.state==="PAUSED").length,failed:observations.filter(x=>x.state==="FAILED").length,orphaned:observations.filter(x=>x.state==="ORPHANED").length};
  return Response.json({mode:activeRuntimeMode,health:summary.failed>0||summary.orphaned>0?"DEGRADED":"READY",network:"DENY",observations,summary,adapter:"docker/oci"},{headers:{"Cache-Control":"no-store"}});
 }catch(error){return Response.json({mode:activeRuntimeMode,health:"ERROR",error:error instanceof Error?error.message:"runtime status failed"},{status:503});}
}
export async function POST(request:Request){
 try{requireControlPlaneAuth(request);
  const body=await readJson(request); const action=actionField(body,["create","clone","reset","snapshot","restore","destroy","execute","reconcile"]);
  const token=typeof body.capabilityTokenId==="string"?body.capabilityTokenId:undefined;
  if(["create","clone","reset","snapshot","restore","destroy"].includes(action))requireCapability(token,"sandbox:admin");
  if(action==="create"){if(!body.spec||typeof body.spec!=="object"||Array.isArray(body.spec))throw new Error("sandbox spec required");return Response.json({runtime:await activeSandboxRuntime.create(body.spec as never)},{status:201});}
  if(action==="clone"){return Response.json({runtime:await activeSandboxRuntime.clone(stringField(body,"sourceSandboxId",128),body.spec as never)},{status:201});}
  if(action==="reset")return Response.json({runtime:await activeSandboxRuntime.reset(stringField(body,"sandboxId",128))});
  if(action==="snapshot")return Response.json({snapshot:await activeSandboxRuntime.snapshot(stringField(body,"sandboxId",128))},{status:201});
  if(action==="restore")return Response.json({runtime:await activeSandboxRuntime.restore(stringField(body,"sandboxId",128),stringField(body,"snapshotId",128))});
  if(action==="destroy"){await activeSandboxRuntime.destroy(stringField(body,"sandboxId",128));return Response.json({ok:true});}
  if(action==="execute"){
   const taskId=stringField(body,"taskId",128),agentId=stringField(body,"agentId",128),sandboxId=stringField(body,"sandboxId",128),capabilityTokenId=stringField(body,"capabilityTokenId",128);
   const argv=stringArray(body.argv,"argv",64,4096); return Response.json(await executeAuthorized({taskId,agentId,sandboxId,capabilityTokenId,approvalId:typeof body.approvalId==="string"?body.approvalId:undefined,argv}));
  }
  return Response.json({mode:activeRuntimeMode,observations:await reconcileActiveRuntime()});
 }catch(error){return Response.json({error:error instanceof Error?error.message:"runtime error"},{status:409})}
}
