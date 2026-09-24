import type {Risk} from "./types";
import {observe} from "./observability";

export type JobState="QUEUED"|"LEASED"|"RUNNING"|"SUCCEEDED"|"FAILED"|"CANCELLED";
export type Job={id:string;taskId:string;agentId:string;state:JobState;attempt:number;maxAttempts:number;risk:Risk;createdAt:string;leasedUntil?:string;lastHeartbeat?:string;error?:string;idempotencyKey?:string};
const now=()=>new Date().toISOString();
const jobs:Job[]=[
 {id:"JOB-104-A",taskId:"TASK-104-A",agentId:"AG-02",state:"SUCCEEDED",attempt:1,maxAttempts:3,risk:"LOW",createdAt:now()},
 {id:"JOB-105-A",taskId:"TASK-105-A",agentId:"AG-03",state:"QUEUED",attempt:0,maxAttempts:2,risk:"MODERATE",createdAt:now()},
 {id:"JOB-104-B",taskId:"TASK-104-B",agentId:"AG-01",state:"QUEUED",attempt:0,maxAttempts:3,risk:"LOW",createdAt:now()}
];
const clone=<T,>(v:T):T=>JSON.parse(JSON.stringify(v));
export function queueSnapshot(){return clone(jobs)}
export function enqueueJob(input:Omit<Job,"state"|"attempt"|"createdAt">){const existing=input.idempotencyKey?jobs.find(x=>x.idempotencyKey===input.idempotencyKey):undefined;if(existing)return clone(existing);const j={...input,state:"QUEUED" as const,attempt:0,createdAt:now()};jobs.push(j);observe({type:"job.enqueued",message:`Job ${j.id} eingereiht`,status:"QUEUED",actor:j.agentId,resource:j.id,taskId:j.taskId,action:"queue.enqueue",argumentsValue:input});return clone(j)}
export function leaseJob(id:string){
 const j=jobs.find(x=>x.id===id);
 if(!j||j.state!=="QUEUED")return null;
 if(j.attempt>=j.maxAttempts)return null;
 j.state="LEASED";j.attempt+=1;j.leasedUntil=new Date(Date.now()+60_000).toISOString();j.lastHeartbeat=now();observe({type:"job.leased",message:`Job ${id} geleast`,status:"RUNNING",actor:j.agentId,resource:id,taskId:j.taskId,action:"queue.lease",argumentsValue:{attempt:j.attempt}});
 return clone(j);
}
export function startJob(id:string){const j=jobs.find(x=>x.id===id);if(!j||j.state!=="LEASED")return null;j.state="RUNNING";j.lastHeartbeat=now();observe({type:"job.started",message:`Job ${id} gestartet`,status:"RUNNING",actor:j.agentId,resource:id,taskId:j.taskId,action:"queue.start"});return clone(j)}
export function heartbeatJob(id:string){
 const j=jobs.find(x=>x.id===id);if(!j||!["LEASED","RUNNING"].includes(j.state))return null;
 j.lastHeartbeat=now();j.leasedUntil=new Date(Date.now()+60_000).toISOString();observe({type:"job.heartbeat",message:`Heartbeat ${id}`,status:"RUNNING",actor:j.agentId,resource:id,taskId:j.taskId,action:"queue.heartbeat"});return clone(j)
}
export function completeJob(id:string){const j=jobs.find(x=>x.id===id);if(!j||!["LEASED","RUNNING"].includes(j.state))return null;j.state="SUCCEEDED";delete j.leasedUntil;observe({type:"job.completed",message:`Job ${id} erfolgreich`,status:"COMPLETED",actor:j.agentId,resource:id,taskId:j.taskId,action:"queue.complete"});return clone(j)}
export function failJob(id:string,error="job failed"){
 const j=jobs.find(x=>x.id===id);if(!j||["SUCCEEDED","FAILED","CANCELLED"].includes(j.state))return null;
 j.error=error;delete j.leasedUntil;
 if(j.attempt<j.maxAttempts){j.state="QUEUED"}else{j.state="FAILED"} observe({type:j.state==="QUEUED"?"job.retry":"job.failed",message:`Job ${id}: ${error}`,status:j.state==="QUEUED"?"QUEUED":"ERROR",actor:j.agentId,resource:id,taskId:j.taskId,action:j.state==="QUEUED"?"queue.retry":"queue.fail",decision:"ERROR",argumentsValue:{error,attempt:j.attempt}})
 return clone(j)
}
export function expireLeases(at=Date.now()){
 let expired=0;
 for(const j of jobs)if(["LEASED","RUNNING"].includes(j.state)&&j.leasedUntil&&new Date(j.leasedUntil).getTime()<=at){j.error="lease expired";j.state=j.attempt<j.maxAttempts?"QUEUED":"FAILED";delete j.leasedUntil;observe({type:"job.lease_expired",message:`Lease von ${j.id} abgelaufen`,status:j.state==="QUEUED"?"QUEUED":"ERROR",actor:j.agentId,resource:j.id,taskId:j.taskId,action:"queue.expire",decision:"ERROR"});expired++}
 return expired;
}
export function cancelJob(id:string){const j=jobs.find(x=>x.id===id);if(!j||["SUCCEEDED","FAILED","CANCELLED"].includes(j.state))return null;j.state="CANCELLED";delete j.leasedUntil;observe({type:"job.cancelled",message:`Job ${id} abgebrochen`,status:"CANCELLED",actor:j.agentId,resource:id,taskId:j.taskId,action:"queue.cancel"});return clone(j)}
