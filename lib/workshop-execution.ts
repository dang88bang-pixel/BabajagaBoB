import crypto from "node:crypto";
import {advanceWorkshop,listWorkshop} from "@/lib/workshop";

import {registerSkill} from "@/lib/skills";
import type {Risk} from "@/lib/types";
export type WorkshopAction="SPECIFY"|"PROTOTYPE"|"SANDBOX"|"TEST"|"SECURITY_VALIDATE"|"EXPERIMENT"|"VALIDATE"|"REGISTER";
export type WorkshopExecution={id:string;workshopId:string;action:WorkshopAction;status:"RUNNING"|"BLOCKED"|"SUCCEEDED"|"FAILED";startedAt:string;finishedAt?:string;artifactDigest:string;message:string};
const runs:WorkshopExecution[]=[];
const digest=(v:unknown)=>crypto.createHash("sha256").update(JSON.stringify(v)).digest("hex");
const nextStage:Record<WorkshopAction,any>={SPECIFY:"SPECIFICATION",PROTOTYPE:"PROTOTYPE",SANDBOX:"SANDBOX",TEST:"TESTING",SECURITY_VALIDATE:"SECURITY_VALIDATION",EXPERIMENT:"EXPERIMENT",VALIDATE:"VALIDATED",REGISTER:"REGISTERED"};
export function executeWorkshopStep(workshopId:string,action:WorkshopAction){
 const item=listWorkshop().find(x=>x.id===workshopId); if(!item)throw new Error("workshop item not found");
 if(action==="REGISTER" && item.stage!=="VALIDATED") throw new Error("registration requires VALIDATED stage");
 const run={id:"WR-"+crypto.randomUUID(),workshopId,action,status:"RUNNING" as const,startedAt:new Date().toISOString(),artifactDigest:digest(item),message:"Workshop step started"};
 runs.push(run);
 try{
  const updated=advanceWorkshop(workshopId,nextStage[action]);
  run.status="SUCCEEDED";run.finishedAt=new Date().toISOString();run.artifactDigest=digest(updated);run.message=`Stage advanced to ${updated.stage}`;
  return structuredClone({run,item:updated});
 }catch(e){run.status="FAILED";run.finishedAt=new Date().toISOString();run.message=e instanceof Error?e.message:"workshop step failed";throw e}
}
export function listWorkshopExecutions(){return structuredClone(runs)}
