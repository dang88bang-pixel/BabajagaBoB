import {runWorkerCycle,workerSnapshot} from "@/lib/worker";

export const runtime="nodejs";
export const dynamic="force-dynamic";

export async function GET(){
 return Response.json(workerSnapshot(),{headers:{"Cache-Control":"no-store"}});
}

export async function POST(request:Request){
 const denied = (await import("@/lib/api/api-gate")).guardOrDeny(request, {action:"worker:run", creatorOnly:true});
 if (denied) return denied;

 try{return Response.json(await runWorkerCycle())}
 catch(error){return Response.json({error:error instanceof Error?error.message:"worker failed"},{status:500})}
}
