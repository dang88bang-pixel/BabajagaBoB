import crypto from "node:crypto";
import {addProvenanceEdge,addProvenanceNode} from "./provenance";
import {appendEventPersistent} from "./event-store";
import {recordAudit} from "./audit";
import type {Event,Status} from "./types";
export function observe(input:{type:string;message:string;status:Status;actor:string;resource?:string;taskId?:string;causalParentId?:string;action:string;decision?:string;argumentsValue?:unknown;from?:string;to?:string;relation?:"DERIVED_FROM"|"TESTED_BY"|"EXECUTED_IN"|"AUTHORIZED_BY"|"CAUSED_BY"|"PRODUCED"}){
 const event:Event={id:`evt-${crypto.randomUUID()}`,type:input.type,message:input.message,status:input.status,time:new Date().toISOString(),actor:input.actor,resource:input.resource,taskId:input.taskId,causalParentId:input.causalParentId};
 appendEventPersistent(event);
 addProvenanceNode({id:event.id,kind:"EVENT",label:event.type});
 if(input.from&&input.to&&input.relation)addProvenanceEdge({from:input.from,to:input.to,relation:input.relation});
 if(input.resource){addProvenanceNode({id:input.resource,kind:"RESOURCE",label:input.resource});addProvenanceEdge({from:event.id,to:input.resource,relation:"CAUSED_BY"});}
 recordAudit({actor:input.actor,action:input.action,resource:input.resource,decision:input.decision??"ALLOW",causalParentId:input.causalParentId},input.argumentsValue??null);
 return event;
}