import crypto from "node:crypto";
import {recordAudit} from "./audit";
import {documentStep} from "./gallery";
import {addKnowledge} from "./knowledge";

export type ErrorLifecycle="DETECTED"|"TRIAGING"|"CONTAINED"|"REPRODUCING"|"DIAGNOSING"|"HYPOTHESIS"|"EXPERIMENTING"|"ROOT_CAUSE_FOUND"|"FIXING"|"VERIFYING"|"RECOVERING"|"LEARNED"|"REGRESSION_LOCKED"|"ESCALATED";
export type ErrorSeverity="LOW"|"MEDIUM"|"HIGH"|"CRITICAL";
export type ErrorIncident={id:string;timestamp:string;status:ErrorLifecycle;severity:ErrorSeverity;symptom:string;incident:string;failureMode?:string;rootCause?:string;contributingFactors:string[];hypothesis?:string;evidenceIds:string[];taskId?:string;runId?:string;agentId?:string;sandboxId?:string;recoveryPlanId?:string;regressionTestId?:string;knowledgeId?:string;error?:string};
const incidents=new Map<string,ErrorIncident>();
const rank:Record<ErrorSeverity,number>={LOW:1,MEDIUM:2,HIGH:3,CRITICAL:4};
const newId=()=>`ERR-${crypto.randomUUID().slice(0,8).toUpperCase()}`;
export function createErrorIncident(input:Omit<ErrorIncident,"id"|"timestamp"|"status">){const x:ErrorIncident={...input,id:newId(),timestamp:new Date().toISOString(),status:"DETECTED"};incidents.set(x.id,x);recordAudit({actor:x.agentId||"SYSTEM",action:"error.detected",resource:x.id,decision:"ALLOW"},x);documentStep({kind:"ERROR",title:x.id+": "+x.symptom,description:x.incident,status:"DETECTED",actor:x.agentId||"SYSTEM",taskId:x.taskId});return structuredClone(x)}
export function transitionError(id:string,status:ErrorLifecycle,patch:Partial<ErrorIncident>={}){const x=incidents.get(id);if(!x)throw new Error("Error incident not found");x.status=status;Object.assign(x,patch);incidents.set(id,x);recordAudit({actor:x.agentId||"SYSTEM",action:"error.transition",resource:id,decision:"ALLOW"},{status,...patch});return structuredClone(x)}
export function investigateError(id:string){const x=incidents.get(id);if(!x)throw new Error("Error incident not found");if(rank[x.severity]>=3)transitionError(id,"CONTAINED");transitionError(id,"REPRODUCING");return transitionError(id,"DIAGNOSING")}
export function establishRootCause(id:string,rootCause:string,evidenceIds:string[]=[]){return transitionError(id,"ROOT_CAUSE_FOUND",{rootCause,evidenceIds})}
export function learnFromError(id:string,summary:string,regressionTestId?:string){const x=incidents.get(id);if(!x)throw new Error("Error incident not found");const k=addKnowledge({title:"Never Again: "+x.id,content:summary,layer:"NEGATIVE",state:"ESTABLISHED",sourceIds:x.evidenceIds,relations:[]});x.knowledgeId=k.id;x.regressionTestId=regressionTestId;x.status=regressionTestId?"REGRESSION_LOCKED":"LEARNED";incidents.set(id,x);recordAudit({actor:x.agentId||"SYSTEM",action:"error.learned",resource:id,decision:"ALLOW"},{knowledgeId:k.id,regressionTestId});return structuredClone(x)}
export function escalateError(id:string,reason:string){return transitionError(id,"ESCALATED",{error:reason})}
export function listErrorIncidents(){return [...incidents.values()].sort((a,b)=>b.timestamp.localeCompare(a.timestamp)).map(structuredClone)}
export function errorSummary(){const all=listErrorIncidents();return {total:all.length,detected:all.filter(x=>x.status==="DETECTED").length,investigating:all.filter(x=>["TRIAGING","CONTAINED","REPRODUCING","DIAGNOSING","HYPOTHESIS","EXPERIMENTING"].includes(x.status)).length,critical:all.filter(x=>x.severity==="CRITICAL"&&x.status!=="REGRESSION_LOCKED"&&x.status!=="LEARNED").length,learned:all.filter(x=>["LEARNED","REGRESSION_LOCKED"].includes(x.status)).length}}