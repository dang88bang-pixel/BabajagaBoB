import {NextResponse} from "next/server";
import {executionGate} from "@/lib/execution-gate";
import {getControlState} from "@/lib/control-plane";
import {guardOrDeny} from "@/lib/api/api-gate";
export async function POST(req:Request){
 const b=await req.json();
 const denied=guardOrDeny(req,{action:"gate:evaluate",taskId:typeof b.taskId==="string"?b.taskId:undefined});if(denied)return denied;const task=getControlState().tasks.find(x=>x.taskId===b.taskId);if(!task)return NextResponse.json({allowed:false,reasons:["Task not found"]},{status:404});const result=executionGate(task,b.approvalId,getControlState().locked);return NextResponse.json(result,{status:result.allowed?200:403})}
