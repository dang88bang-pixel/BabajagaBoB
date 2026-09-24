import {sandboxRuntime} from "../../../lib/runtime";

export async function POST(request:Request){
 try{
  const body=await request.json();
  switch(body.action){
   case "create": return Response.json({runtime:await sandboxRuntime.create(body.spec)},{status:201});
   case "clone": return Response.json({runtime:await sandboxRuntime.clone(body.sourceSandboxId,body.spec)},{status:201});
   case "reset": return Response.json({runtime:await sandboxRuntime.reset(body.sandboxId)});
   case "snapshot": return Response.json({snapshot:await sandboxRuntime.snapshot(body.sandboxId)},{status:201});
   case "restore": return Response.json({runtime:await sandboxRuntime.restore(body.sandboxId,body.snapshotId)});
   case "destroy": await sandboxRuntime.destroy(body.sandboxId); return Response.json({ok:true});
   case "execute": return Response.json(await sandboxRuntime.execute(body.sandboxId,body.operation));
   default: return Response.json({error:"unsupported runtime action"},{status:400});
  }
 }catch(error){return Response.json({error:error instanceof Error?error.message:"runtime error"},{status:409})}
}
