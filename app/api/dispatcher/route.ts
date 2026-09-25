import {requireControlPlaneAuth} from "@/lib/control-auth";
import {NextResponse} from "next/server";
import {dispatchTask,workerStart,workerComplete,workerFail} from "@/lib/dispatcher";
import type {Risk} from "@/lib/types";

export async function POST(req:Request){
 requireControlPlaneAuth(req);
  const body=await req.json();
  if(body.action==="dispatch"){
    const result=await dispatchTask({taskId:body.taskId,agentId:body.agentId,risk:body.risk as Risk,sandboxType:body.sandboxType});
    return NextResponse.json(result,{status:201});
  }
  if(body.action==="worker.start"){
    const result=workerStart(body.runId,body.jobId);
    return result?NextResponse.json({run:result}):NextResponse.json({error:"worker start rejected"},{status:409});
  }
  if(body.action==="worker.complete"){
    const result=workerComplete(body.runId,body.jobId);
    return result?NextResponse.json({run:result}):NextResponse.json({error:"worker completion rejected"},{status:409});
  }
  if(body.action==="worker.fail"){
    const result=workerFail(body.runId,body.jobId,body.error??"worker failure");
    return result?NextResponse.json({run:result}):NextResponse.json({error:"worker failure transition rejected"},{status:409});
  }
  return NextResponse.json({error:"unknown action"},{status:400});
}
