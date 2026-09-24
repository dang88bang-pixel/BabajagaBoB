import {createRun,startRun,completeRun,failRun,getRun} from "./runs";
import {leaseJob,startJob,completeJob,failJob} from "./queue";
import {createSandbox} from "./runtime";
import type {Risk} from "./types";

export type DispatchInput={taskId:string;agentId:string;risk:Risk;sandboxType?:string};

export function dispatchTask(input:DispatchInput){
  const run=createRun({taskId:input.taskId,agentId:input.agentId,risk:input.risk});
  const jobId=`JOB-${run.id}`;
  const job={id:jobId,taskId:input.taskId,agentId:input.agentId,state:"QUEUED" as const,attempt:0,maxAttempts:3,risk:input.risk,createdAt:new Date().toISOString()};
  // Queue currently has a fixed registry; dispatch therefore creates the run and
  // returns the integration contract for a durable worker queue.
  const sandbox=createSandbox({type:input.sandboxType??"development",task:input.taskId,agentId:input.agentId,network:"DENY"});
  return {run,job,sandbox};
}

export function workerStart(runId:string,jobId:string){
  const run=getRun(runId); if(!run)return null;
  const leased=leaseJob(jobId); if(!leased)return null;
  if(!startJob(jobId))return null;
  return startRun(runId);
}

export function workerComplete(runId:string,jobId:string){
  const result=completeJob(jobId); if(!result)return null;
  return completeRun(runId);
}

export function workerFail(runId:string,jobId:string,error:string){
  failJob(jobId,error); return failRun(runId,error);
}
