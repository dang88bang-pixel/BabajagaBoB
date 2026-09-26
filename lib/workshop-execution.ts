import crypto from "node:crypto";
import {advanceWorkshop,listWorkshop} from "@/lib/workshop";
import {appendDomainEvent} from "@/lib/events/log";
import {recordAudit} from "@/lib/audit";
import {addProvenanceNode,addProvenanceEdge} from "@/lib/provenance";
import type {WorkshopStage} from "@/lib/workshop";
import {createStore} from "@/lib/persistence/store";
export type WorkshopAction="SPECIFY"|"PROTOTYPE"|"SANDBOX"|"TEST"|"SECURITY_VALIDATE"|"EXPERIMENT"|"VALIDATE"|"REGISTER";
export type WorkshopExecution={id:string;workshopId:string;action:WorkshopAction;status:"RUNNING"|"BLOCKED"|"SUCCEEDED"|"FAILED";startedAt:string;finishedAt?:string;artifactDigest:string;message:string};
/** Ausführungshistorie der Werkstatt (Nachweis, kein Cache). */
const runStore=createStore<{runs:WorkshopExecution[]}>("workshop-executions",1,()=>({runs:[]}));
const persistRun=(run:WorkshopExecution)=>{runStore.update(payload=>{const i=payload.runs.findIndex(x=>x.id===run.id);if(i===-1)payload.runs.push(run);else payload.runs[i]=run})};
const digest=(v:unknown)=>crypto.createHash("sha256").update(JSON.stringify(v)).digest("hex");
const nextStage:Record<WorkshopAction,WorkshopStage>={SPECIFY:"SPECIFICATION",PROTOTYPE:"PROTOTYPE",SANDBOX:"SANDBOX",TEST:"TESTING",SECURITY_VALIDATE:"SECURITY_VALIDATION",EXPERIMENT:"EXPERIMENT",VALIDATE:"VALIDATED",REGISTER:"REGISTERED"};
export function executeWorkshopStep(workshopId:string,action:WorkshopAction){
 const item=listWorkshop().find(x=>x.id===workshopId);if(!item)throw new Error("workshop item not found");
 if(action==="REGISTER"&&item.stage!=="VALIDATED")throw new Error("registration requires VALIDATED stage");
 const run:WorkshopExecution={id:"WR-"+crypto.randomUUID(),workshopId,action,status:"RUNNING",startedAt:new Date().toISOString(),artifactDigest:digest(item),message:"Workshop step started"};persistRun(run);
 addProvenanceNode({id:workshopId,kind:"WORKSHOP_ITEM",label:item.name});
 addProvenanceNode({id:run.id,kind:"RUN",label:`${action} ${item.name}`});
 addProvenanceEdge({from:run.id,to:workshopId,relation:"DERIVED_FROM"});
 const event=appendDomainEvent({type:"workshop.execution.started",message:`Workshop ${item.name}: ${action} gestartet`,status:"RUNNING",actor:"agent-workshop",outputRef:run.id});
 if(event){addProvenanceNode({id:event.eventId,kind:"EVENT",label:event.type});addProvenanceEdge({from:event.eventId,to:run.id,relation:"CAUSED_BY"});}
 recordAudit({actor:"agent-workshop",action:"workshop.step",resource:run.id,decision:"ALLOW"}, {workshopId,action,stage:item.stage});
 try{
  const updated=advanceWorkshop(workshopId,nextStage[action]);
  run.status="SUCCEEDED";run.finishedAt=new Date().toISOString();run.artifactDigest=digest(updated);run.message=`Stage advanced to ${updated.stage}`;
  addProvenanceNode({id:`ART-${run.id}`,kind:"ARTIFACT",label:run.artifactDigest});
  addProvenanceEdge({from:run.id,to:`ART-${run.id}`,relation:"PRODUCED"});
  addProvenanceEdge({from:run.id,to:workshopId,relation:"CAUSED_BY"});
  const done=appendDomainEvent({type:"workshop.execution.completed",message:`Workshop ${item.name}: ${updated.stage}`,status:"COMPLETED",actor:"agent-workshop",outputRef:run.id,causalParentId:event?.eventId});
  if(done){addProvenanceNode({id:done.eventId,kind:"EVENT",label:done.type});addProvenanceEdge({from:done.eventId,to:run.id,relation:"CAUSED_BY"});}
  return structuredClone({run,item:updated});
 }catch(e){
  run.status="FAILED";run.finishedAt=new Date().toISOString();run.message=e instanceof Error?e.message:"workshop step failed";
  const failed=appendDomainEvent({type:"workshop.execution.failed",message:`Workshop ${item.name}: ${run.message}`,status:"ERROR",actor:"agent-workshop",outputRef:run.id,causalParentId:event?.eventId});
  if(failed){addProvenanceNode({id:failed.eventId,kind:"EVENT",label:failed.type});addProvenanceEdge({from:failed.eventId,to:run.id,relation:"CAUSED_BY"});}
  recordAudit({actor:"agent-workshop",action:"workshop.step",resource:run.id,decision:"ERROR"},{workshopId,action,error:run.message});
  throw e;
 }
}
export function listWorkshopExecutions(){return runStore.read().runs.map(run=>structuredClone(run))}