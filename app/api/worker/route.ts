import {runWorkerCycle,workerSnapshot} from "@/lib/worker";
import {guardOrDeny} from "@/lib/api/api-gate";

export const runtime="nodejs";
export const dynamic="force-dynamic";

export async function GET(request:Request){
 const denied=guardOrDeny(request,{action:"worker:read"});if(denied)return denied;
 return Response.json(workerSnapshot(),{headers:{"Cache-Control":"no-store"}});
}

export async function POST(request:Request){
 const denied = (await import("@/lib/api/api-gate")).guardOrDeny(request, {action:"worker:run", creatorOnly:true});
 if (denied) return denied;

 try{return Response.json(await runWorkerCycle())}
 catch(error){return Response.json({error:error instanceof Error?error.message:"worker failed"},{status:500})}
}
