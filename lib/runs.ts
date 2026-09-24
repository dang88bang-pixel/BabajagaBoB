import type {Risk} from "./types";

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
  runs.push(run); return clone(run);
}
export function listRuns(){return clone(runs)}
export function getRun(id:string){const r=runs.find(x=>x.id===id);return r?clone(r):null}
export function attachExecution(runId:string,jobId:string,sandboxId:string){const r=runs.find(x=>x.id===runId);if(!r)throw new Error("run not found");r.jobId=jobId;r.sandboxId=sandboxId;return clone(r)}

export function startRun(id:string){const r=runs.find(x=>x.id===id);if(!r||!["CREATED","QUEUED","RECOVERING"].includes(r.state))return null;r.state="RUNNING";r.attempt++;r.startedAt=now();return clone(r)}
export function queueRun(id:string){const r=runs.find(x=>x.id===id);if(!r||!["CREATED","PAUSED"].includes(r.state))return null;r.state="QUEUED";return clone(r)}
export function completeRun(id:string){const r=runs.find(x=>x.id===id);if(!r||!["RUNNING","RECOVERING"].includes(r.state))return null;r.state="SUCCEEDED";r.finishedAt=now();return clone(r)}
export function failRun(id:string,error="run failed"){const r=runs.find(x=>x.id===id);if(!r||["SUCCEEDED","FAILED","CANCELLED","ROLLED_BACK"].includes(r.state))return null;r.state="FAILED";r.error=error;r.finishedAt=now();return clone(r)}
export function cancelRun(id:string){const r=runs.find(x=>x.id===id);if(!r||["SUCCEEDED","FAILED","CANCELLED","ROLLED_BACK"].includes(r.state))return null;r.state="CANCELLED";r.finishedAt=now();return clone(r)}
export function beginRecovery(id:string){const r=runs.find(x=>x.id===id);if(!r||!["FAILED","RUNNING"].includes(r.state))return null;r.state="RECOVERING";return clone(r)}
export function rollbackRun(id:string,artifactId?:string){const r=runs.find(x=>x.id===id);if(!r)return null;r.state="ROLLED_BACK";r.rollbackArtifactId=artifactId;r.finishedAt=now();return clone(r)}
