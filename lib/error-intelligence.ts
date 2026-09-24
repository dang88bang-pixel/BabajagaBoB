import crypto from "node:crypto";
import {recordAudit} from "./audit";
import {recordFailure,prepareRecovery,resolveFailure,verifyRecovery} from "./reliability";
import {createExperiment,addEvidence,updateExperiment} from "./science";
import {documentStep} from "./gallery";
import {upsertKnowledge} from "./knowledge";
import {loadErrors,saveErrors} from "./error-store";
import {activeSandboxRuntime} from "./runtime-factory";
import {getControlState,registerSandbox,updateSandboxStatus} from "./control-plane";

export type ErrorLifecycle="DETECTED"|"TRIAGING"|"CONTAINED"|"REPRODUCING"|"DIAGNOSING"|"HYPOTHESIS"|"EXPERIMENTING"|"ROOT_CAUSE_FOUND"|"FIXING"|"VERIFYING"|"RECOVERING"|"LEARNED"|"REGRESSION_LOCKED"|"ESCALATED";
export type ErrorSeverity="LOW"|"MEDIUM"|"HIGH"|"CRITICAL";
export type ErrorIncident={id:string;timestamp:string;status:ErrorLifecycle;severity:ErrorSeverity;symptom:string;incident:string;failureMode?:string;rootCause?:string;contributingFactors:string[];hypothesis?:string;evidenceIds:string[];taskId?:string;runId?:string;agentId?:string;sandboxId?:string;recoveryPlanId?:string;regressionTestId?:string;knowledgeId?:string;error?:string};
const incidents=new Map<string,ErrorIncident>(loadErrors().map(x=>[x.id,x]));
const persist=()=>saveErrors([...incidents.values()]);
const rank:Record<ErrorSeverity,number>={LOW:1,MEDIUM:2,HIGH:3,CRITICAL:4};
const newId=()=>`ERR-${crypto.randomUUID().slice(0,8).toUpperCase()}`;
export function createErrorIncident(input:Omit<ErrorIncident,"id"|"timestamp"|"status">){const x:ErrorIncident={...input,id:newId(),timestamp:new Date().toISOString(),status:"DETECTED"};incidents.set(x.id,x);persist();recordAudit({actor:x.agentId||"SYSTEM",action:"error.detected",resource:x.id,decision:"ALLOW"},x);documentStep({kind:"ERROR",title:x.id+": "+x.symptom,description:x.incident,status:"ERROR",actor:x.agentId||"SYSTEM",taskId:x.taskId});return structuredClone(x)}
export function transitionError(id:string,status:ErrorLifecycle,patch:Partial<ErrorIncident>={}){const x=incidents.get(id);if(!x)throw new Error("Error incident not found");x.status=status;Object.assign(x,patch);incidents.set(id,x);persist();recordAudit({actor:x.agentId||"SYSTEM",action:"error.transition",resource:id,decision:"ALLOW"},{status,...patch});return structuredClone(x)}
export async function investigateError(id:string){const x=incidents.get(id);if(!x)throw new Error("Error incident not found");if(rank[x.severity]>=3)transitionError(id,"CONTAINED");transitionError(id,"REPRODUCING");if(!x.sandboxId){
 const task=getControlState().tasks.find(t=>t.id===x.taskId);
 if(task||x.severity==="CRITICAL"){
  const sandboxId=`DIAG-${x.id}`;
  await activeSandboxRuntime.create({id:sandboxId,type:"diagnostic",network:{mode:"DENY",allowlist:[]},limits:{cpuMillicores:500,memoryMb:512,storageMb:1024,timeoutMs:120000,processes:32},risk:x.severity==="CRITICAL"?"HIGH":"LOW"});
  registerSandbox({id:sandboxId,type:"diagnostic",status:"COMPLETED",network:"DENY",task:task!.id,agentId:x.agentId||task!.assignedAgent});
  x.sandboxId=sandboxId; incidents.set(id,x); persist();
 }
} else {try{await activeSandboxRuntime.start(x.sandboxId); try{updateSandboxStatus(x.sandboxId,"RUNNING")}catch{}}catch{} }const f=recordFailure({taskId:x.taskId,runId:x.runId,symptom:x.symptom,incident:x.incident,failureMode:x.failureMode||"UNKNOWN",contributingFactors:x.contributingFactors,prevention:[]});x.status="DIAGNOSING";x.error=f.id;incidents.set(id,x);persist();return structuredClone(x)}
export function establishRootCause(id:string,rootCause:string,evidenceIds:string[]=[]){const x=incidents.get(id);if(!x)throw new Error("Error incident not found");if(evidenceIds.length===0&&x.evidenceIds.length===0)throw new Error("Root cause requires evidence");const merged=[...new Set([...x.evidenceIds,...evidenceIds])];const updated=transitionError(id,"ROOT_CAUSE_FOUND",{rootCause,evidenceIds:merged});if(x.error)resolveFailure(x.error,rootCause,updated.regressionTestId);return updated}
export function learnFromError(id:string,summary:string,regressionTestId?:string){const x=incidents.get(id);if(!x)throw new Error("Error incident not found");const knowledgeState=x.status==="ROOT_CAUSE_FOUND"&&x.rootCause&&x.evidenceIds.length>0?"ESTABLISHED":"HYPOTHESIS"; const k=upsertKnowledge({subject:"Never Again: "+x.id,predicate:"prevention",object:summary,layer:"NEGATIVE",state:knowledgeState,sourceIds:x.evidenceIds});x.knowledgeId=k.id;x.regressionTestId=regressionTestId;x.status=regressionTestId?"REGRESSION_LOCKED":"LEARNED";incidents.set(id,x);persist();recordAudit({actor:x.agentId||"SYSTEM",action:"error.learned",resource:id,decision:"ALLOW"},{knowledgeId:k.id,regressionTestId});return structuredClone(x)}
export function startExperiment(id:string,objectiveId:string){const x=incidents.get(id);if(!x)throw new Error("Error incident not found");const e=createExperiment({id:`EXP-${id}`,missionId:x.taskId||"INCIDENT",objectiveId, title:`Reproduce ${id}`, sandbox:x.sandboxId||"diagnostic-pending", hypothesis:x.hypothesis||"failure condition is reproducible", baseline:"known-good execution",control:"unchanged execution",variables:["suspected failure condition"],expectedResult:"reproduce the observed failure",alternativeExplanations:["environmental variance","dependency failure"],taskId:x.taskId||"UNASSIGNED",agentId:x.agentId||"AG-03"});transitionError(id,"EXPERIMENTING");return e}
export function recordExperimentEvidence(id:string,evidenceId:string){
 const x=incidents.get(id);if(!x)throw new Error("Error incident not found");
 const expId=`EXP-${id}`;const ev=addEvidence({experimentId:expId,kind:"REPRODUCTION",claim:"Error condition evidence",value:evidenceId,knowledgeState:"OBSERVED"});
 x.evidenceIds=[...new Set([...x.evidenceIds,ev.id])];incidents.set(id,x);persist();return structuredClone(x)
}
export function prepareErrorRecovery(id:string){const x=incidents.get(id);if(!x)throw new Error("Error incident not found");if(x.severity==="CRITICAL")transitionError(id,"CONTAINED"); const p=prepareRecovery({failureId:x.error||id,steps:["isolate affected execution","collect diagnostics","restore known-good artifact","rerun regression and smoke verification"],verification:["regression test","smoke verification"]});x.recoveryPlanId=p.id;x.status="RECOVERING";incidents.set(id,x);persist();return structuredClone(x)}
export function escalateError(id:string,reason:string){return transitionError(id,"ESCALATED",{error:reason})}
export function listErrorIncidents(){return [...incidents.values()].sort((a,b)=>b.timestamp.localeCompare(a.timestamp)).map(x=>structuredClone(x))}
export function errorSummary(){const all=listErrorIncidents();return {total:all.length,detected:all.filter(x=>x.status==="DETECTED").length,investigating:all.filter(x=>["TRIAGING","CONTAINED","REPRODUCING","DIAGNOSING","HYPOTHESIS","EXPERIMENTING"].includes(x.status)).length,critical:all.filter(x=>x.severity==="CRITICAL"&&x.status!=="REGRESSION_LOCKED"&&x.status!=="LEARNED").length,learned:all.filter(x=>["LEARNED","REGRESSION_LOCKED"].includes(x.status)).length}}