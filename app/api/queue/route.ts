import {requireControlPlaneAuth} from "@/lib/control-auth";
import {NextResponse} from "next/server";
import {cancelJob,completeJob,expireLeases,failJob,heartbeatJob,leaseJob,queueSnapshot,startJob} from "../../../lib/queue";
export const runtime="nodejs";
export async function GET(){expireLeases();return NextResponse.json({jobs:queueSnapshot()},{headers:{"Cache-Control":"no-store"}})}
export async function POST(req:Request){
 requireControlPlaneAuth(req);

 const body=await req.json().catch(()=>({})); const id=String(body.id||""); let result;
 switch(body.action){case "lease":result=leaseJob(id);break;case "start":result=startJob(id);break;case "heartbeat":result=heartbeatJob(id);break;case "complete":result=completeJob(id);break;case "fail":result=failJob(id,String(body.error||"job failed"));break;case "expire":expireLeases();return NextResponse.json({jobs:queueSnapshot()});case "cancel":result=cancelJob(id);break;default:return NextResponse.json({error:"Unsupported queue action"},{status:400})}
 if(!result)return NextResponse.json({error:"Invalid job transition"},{status:409});
 return NextResponse.json({job:result});
}
