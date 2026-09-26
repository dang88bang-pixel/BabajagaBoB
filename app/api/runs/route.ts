import {requireControlPlaneAuth} from "@/lib/control-auth";
import {NextResponse} from "next/server";
import {listRuns,createRun,startRun,completeRun,failRun,cancelRun,beginRecovery,rollbackRun} from "@/lib/runs";
import type {Risk} from "@/lib/types";
export async function GET(){return NextResponse.json({runs:listRuns()},{headers:{"Cache-Control":"no-store"}})}
export async function POST(req:Request){
 requireControlPlaneAuth(req);

  const b=await req.json(); let result=null;
  if(b.action==="create")result=createRun({taskId:b.taskId,agentId:b.agentId,risk:b.risk as Risk,sandboxId:b.sandboxId,jobId:b.jobId});
  if(b.action==="start")result=startRun(b.runId);
  if(b.action==="complete")result=completeRun(b.runId);
  if(b.action==="fail")result=failRun(b.runId,b.error);
  if(b.action==="cancel")result=cancelRun(b.runId);
  if(b.action==="recover")result=beginRecovery(b.runId);
  if(b.action==="rollback")result=rollbackRun(b.runId,b.artifactId);
  return result?NextResponse.json({run:result}):NextResponse.json({error:"invalid transition"},{status:409});
}
