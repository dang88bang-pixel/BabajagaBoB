import type {Risk} from "./types";
import {observe} from "./observability";

export type RunState="CREATED"|"QUEUED"|"RUNNING"|"PAUSED"|"SUCCEEDED"|"FAILED"|"CANCELLED"|"RECOVERING"|"ROLLED_BACK";

export type Run={
  id:string; taskId:string; agentId:string; sandboxId?:string; jobId?:string;
  state:RunState; attempt:number; risk:Risk; createdAt:string; startedAt?:string;
  finishedAt?:string; error?:string; rollbackArtifactId?:string;
};

const runs:Run[]=[];
const now=()=>new Date().toISOString();
const clone=<T,>(v:T):T=>JSON.parse(JSON.stringify(v));

export function createRun(input:Pick<Run,"taskId"|"agentId"|"risk"> & Partial<Pick<Run,"sandboxId"|"jobId">>):Run{
  const run:Run={id:`RUN-${String(runs.length+1).padStart(4,"0")}`,...input,state:"CREATED",attempt:0,createdAt:now()};
  runs.push(run); observe({type:"run.created",message:`Run ${run.id} erstellt`,status:"QUEUED",actor:run.agentId,resource:run.id,taskId:run.taskId,action:"run.create",argumentsValue:input}); return clone(run);
}
export function listRuns(){return clone(runs)}
export function getRun(id:string){const r=runs.find(x=>x.id===id);return r?clone(r):null}
export function attachExecution(runId:string,jobId:string,sandboxId:string){const r=runs.find(x=>x.id===runId);if(!r)throw new Error("run not found");r.jobId=jobId;r.sandboxId=sandboxId;observe({type:"run.execution.attached",message:`Run ${id} mit Job und Sandbox verknüpft`,status:"PLANNING",actor:r.agentId,resource:id,taskId:r.taskId,action:"run.attach",argumentsValue:{jobId,sandboxId}});return clone(r)}

export function startRun(id:string){const r=runs.find(x=>x.id===id);if(!r||!["CREATED","QUEUED","RECOVERING"].includes(r.state))return null;r.state="RUNNING";r.attempt++;r.startedAt=now();observe({type:"run.started",message:`Run ${id} gestartet`,status:"RUNNING",actor:r.agentId,resource:id,taskId:r.taskId,action:"run.start",argumentsValue:{attempt:r.attempt}});return clone(r)}
export function queueRun(id:string){const r=runs.find(x=>x.id===id);if(!r||!["CREATED","PAUSED"].includes(r.state))return null;r.state="QUEUED";observe({type:"run.queued",message:`Run ${id} in Queue`,status:"QUEUED",actor:r.agentId,resource:id,taskId:r.taskId,action:"run.queue"});return clone(r)}
export function completeRun(id:string){const r=runs.find(x=>x.id===id);if(!r||!["RUNNING","RECOVERING"].includes(r.state))return null;r.state="SUCCEEDED";r.finishedAt=now();observe({type:"run.completed",message:`Run ${id} erfolgreich`,status:"COMPLETED",actor:r.agentId,resource:id,taskId:r.taskId,action:"run.complete"});return clone(r)}
export function failRun(id:string,error="run failed"){const r=runs.find(x=>x.id===id);if(!r||["SUCCEEDED","FAILED","CANCELLED","ROLLED_BACK"].includes(r.state))return null;r.state="FAILED";r.error=error;r.finishedAt=now();observe({type:"run.failed",message:`Run ${id} fehlgeschlagen: ${error}`,status:"ERROR",actor:r.agentId,resource:id,taskId:r.taskId,action:"run.fail",decision:"ERROR",argumentsValue:{error}});return clone(r)}
export function cancelRun(id:string){const r=runs.find(x=>x.id===id);if(!r||["SUCCEEDED","FAILED","CANCELLED","ROLLED_BACK"].includes(r.state))return null;r.state="CANCELLED";r.finishedAt=now();observe({type:"run.cancelled",message:`Run ${id} abgebrochen`,status:"CANCELLED",actor:r.agentId,resource:id,taskId:r.taskId,action:"run.cancel"});return clone(r)}
export function beginRecovery(id:string){const r=runs.find(x=>x.id===id);if(!r||!["FAILED","RUNNING"].includes(r.state))return null;r.state="RECOVERING";observe({type:"run.recovering",message:`Recovery für Run ${id} gestartet`,status:"RECOVERING",actor:r.agentId,resource:id,taskId:r.taskId,action:"run.recover"});return clone(r)}
export function rollbackRun(id:string,artifactId?:string){const r=runs.find(x=>x.id===id);if(!r)return null;r.state="ROLLED_BACK";r.rollbackArtifactId=artifactId;r.finishedAt=now();observe({type:"run.rolled_back",message:`Run ${id} zurückgerollt`,status:"ROLLING_BACK",actor:r.agentId,resource:id,taskId:r.taskId,action:"run.rollback",argumentsValue:{artifactId}});return clone(r)}
