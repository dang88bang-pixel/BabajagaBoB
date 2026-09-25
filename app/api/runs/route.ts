import {NextResponse} from "next/server";
import {listRuns,createRun,startRun,completeRun,failRun,cancelRun,beginRecovery,rollbackRun,attachExecution} from "@/lib/runs";
import type {Risk} from "@/lib/types";
export async function GET(){return NextResponse.json({runs:listRuns()},{headers:{"Cache-Control":"no-store"}})}
export async function POST(req:Request){
  const b=await req.json(); let result=null;
  if(b.action==="create"){const run=createRun({taskId:b.taskId,agentId:b.agentId,risk:b.risk as Risk,sandboxId:b.sandboxId});if(run&&typeof b.jobId==="string"&&typeof b.sandboxId==="string")attachExecution(run.runId,b.jobId,b.sandboxId);result=run}
  if(b.action==="start")result=startRun(b.runId);
  if(b.action==="complete")result=completeRun(b.runId);
  if(b.action==="fail")result=failRun(b.runId,b.error);
  if(b.action==="cancel")result=cancelRun(b.runId);
  if(b.action==="recover")result=beginRecovery(b.runId);
  if(b.action==="rollback")result=rollbackRun(b.runId,b.artifactId);
  return result?NextResponse.json({run:result}):NextResponse.json({error:"invalid transition"},{status:409});
}
