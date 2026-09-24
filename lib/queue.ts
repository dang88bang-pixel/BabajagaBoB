import type {Risk,Status} from "./types";
export type JobState="QUEUED"|"LEASED"|"RUNNING"|"SUCCEEDED"|"FAILED"|"CANCELLED";
export type Job={id:string;taskId:string;agentId:string;state:JobState;attempt:number;maxAttempts:number;risk:Risk;createdAt:string;leasedUntil?:string};
const now=()=>new Date().toISOString();
const jobs:Job[]=[
 {id:"JOB-104-A",taskId:"TASK-104-A",agentId:"AG-02",state:"SUCCEEDED",attempt:1,maxAttempts:3,risk:"LOW",createdAt:now()},
 {id:"JOB-105-A",taskId:"TASK-105-A",agentId:"AG-03",state:"QUEUED",attempt:0,maxAttempts:2,risk:"MODERATE",createdAt:now()},
 {id:"JOB-104-B",taskId:"TASK-104-B",agentId:"AG-01",state:"QUEUED",attempt:0,maxAttempts:3,risk:"LOW",createdAt:now()}
];
const clone=<T,>(v:T):T=>JSON.parse(JSON.stringify(v));
export function queueSnapshot(){return clone(jobs)}
export function leaseJob(id:string){const j=jobs.find(x=>x.id===id);if(!j||j.state!=="QUEUED")return null;j.state="LEASED";j.attempt+=1;j.leasedUntil=new Date(Date.now()+60_000).toISOString();return clone(j)}
export function cancelJob(id:string){const j=jobs.find(x=>x.id===id);if(!j||["SUCCEEDED","FAILED","CANCELLED"].includes(j.state))return null;j.state="CANCELLED";return clone(j)}
