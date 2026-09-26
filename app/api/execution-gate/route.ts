import {NextResponse} from "next/server";
import {executionGate} from "@/lib/execution-gate";
import {getControlState} from "@/lib/control-plane";
import {guardOrDeny} from "@/lib/api/api-gate";
export async function POST(req:Request){
 // Zuerst tolerant lesen (Guard-Entscheidung braucht taskId), dann streng prüfen:
 // ein unlesbarer Body ist eine 400, kein 500.
 const b=(await req.clone().json().catch(()=>({}))) as Record<string,unknown>;
 const denied=guardOrDeny(req,{action:"gate:evaluate",taskId:typeof b.taskId==="string"?b.taskId:undefined});if(denied)return denied;
 if(typeof b.taskId!=="string"||b.taskId.trim().length===0)return NextResponse.json({error:"taskId is required"},{status:400});
 const task=getControlState().tasks.find(x=>x.taskId===b.taskId);if(!task)return NextResponse.json({allowed:false,reasons:["Task not found"]},{status:404});if(b.action!==undefined&&b.action!=="evaluate")return NextResponse.json({error:"unsupported action"},{status:400});
 const result=executionGate(task,typeof b.approvalId==="string"?b.approvalId:undefined,getControlState().locked);return NextResponse.json(result,{status:result.allowed?200:403})}
