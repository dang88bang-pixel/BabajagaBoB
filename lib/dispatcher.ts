import {enqueueJob,leaseJob,startJob,completeJob,failJob} from "./queue";
import {createRun,startRun,completeRun,failRun,getRun,attachExecution} from "./runs";
import {sandboxRuntime} from "./runtime";
import type {Risk} from "./types";
import {getControlState} from "./control-plane";
import {executionGate} from "./execution-gate";

export type DispatchInput={taskId:string;agentId:string;risk:Risk;sandboxType?:string;idempotencyKey?:string;approvalId?:string;experimentId?:string;sandboxId?:string};

export async function dispatchTask(input:DispatchInput){
 const task=getControlState().tasks.find(t=>t.id===input.taskId);if(!task)throw new Error("task not found");
 const gate=executionGate(task,input.approvalId,getControlState().locked,input.agentId,input.experimentId,input.sandboxId);if(!gate.allowed)throw new Error(`execution blocked: ${gate.reasons.join("; ")}`);
 const run=createRun({taskId:input.taskId,agentId:input.agentId,risk:input.risk});
 const job=enqueueJob({id:`JOB-${run.id}`,taskId:input.taskId,agentId:input.agentId,maxAttempts:3,risk:input.risk,idempotencyKey:input.idempotencyKey??run.id});
 const sandbox=await sandboxRuntime.create({id:`SB-RUN-${run.id}`,type:input.sandboxType??"development",network:{mode:"DENY",allowlist:[]},risk:input.risk,limits:{cpuMillicores:1000,memoryMb:1024,storageMb:4096,timeoutMs:300000,processes:32}});
 attachExecution(run.id,job.id,sandbox.sandboxId);
 return {run:{...run,jobId:job.id,sandboxId:sandbox.sandboxId},job,sandbox};
}
export function workerStart(runId:string,jobId:string){const run=getRun(runId);if(!run)return null;const leased=leaseJob(jobId);if(!leased)return null;if(!startJob(jobId))return null;return startRun(runId)}
export function workerComplete(runId:string,jobId:string){const result=completeJob(jobId);if(!result)return null;return completeRun(runId)}
export function workerFail(runId:string,jobId:string,error:string){const result=failJob(jobId,error);if(!result)return null;return failRun(runId,error)}
