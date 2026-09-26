import {NextResponse} from "next/server";
import {cancelJob,completeJob,expireLeases,failJob,heartbeatJob,leaseJob,queueSnapshot,startJob} from "../../../lib/queue";
import {guardOrDeny} from "../../../lib/api/api-gate";
export const runtime="nodejs";
export async function GET(req:Request){const denied=guardOrDeny(req,{action:"queue:read"});if(denied)return denied;expireLeases();return NextResponse.json({jobs:queueSnapshot()},{headers:{"Cache-Control":"no-store"}})}
export async function POST(req:Request){
 const body=await req.json().catch(()=>({}));
 const denied=guardOrDeny(req,{action:"queue:manage",taskId:typeof body.taskId==="string"?body.taskId:undefined});if(denied)return denied;
 const id=String(body.id||""); let result;
 switch(body.action){case "lease":result=leaseJob(id);break;case "start":result=startJob(id);break;case "heartbeat":result=heartbeatJob(id);break;case "complete":result=completeJob(id);break;case "fail":result=failJob(id,String(body.error||"job failed"));break;case "expire":expireLeases();return NextResponse.json({jobs:queueSnapshot()});case "cancel":result=cancelJob(id);break;default:return NextResponse.json({error:"Unsupported queue action"},{status:400})}
 if(!result)return NextResponse.json({error:"Invalid job transition"},{status:409});
 return NextResponse.json({job:result});
}
