import {activeSandboxRuntime,activeRuntimeMode,reconcileActiveRuntime} from "../../../lib/runtime-factory";
import {executeAuthorized} from "../../../lib/execution-broker";

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
 try{
  const body=await request.json();
  switch(body.action){
   case "create": return Response.json({runtime:await activeSandboxRuntime.create(body.spec)},{status:201});
   case "clone": return Response.json({runtime:await activeSandboxRuntime.clone(body.sourceSandboxId,body.spec)},{status:201});
   case "reset": return Response.json({runtime:await activeSandboxRuntime.reset(body.sandboxId)});
   case "snapshot": return Response.json({snapshot:await activeSandboxRuntime.snapshot(body.sandboxId)},{status:201});
   case "restore": return Response.json({runtime:await activeSandboxRuntime.restore(body.sandboxId,body.snapshotId)});
   case "destroy": await activeSandboxRuntime.destroy(body.sandboxId); return Response.json({ok:true});
   case "execute": return Response.json(await executeAuthorized({taskId:body.taskId,agentId:body.agentId,sandboxId:body.sandboxId,capabilityTokenId:body.capabilityTokenId,approvalId:body.approvalId,argv:body.argv}),{status:200});
   case "reconcile": return Response.json({mode:activeRuntimeMode,observations:await reconcileActiveRuntime()});
   default: return Response.json({error:"unsupported runtime action"},{status:400});
  }
 }catch(error){return Response.json({error:error instanceof Error?error.message:"runtime error"},{status:409})}
}
