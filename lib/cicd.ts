import crypto from "node:crypto";
import {observe} from "./observability";
import {loadFabric,saveFabric} from "./fabric-store";
export type CheckKind="LINT"|"TYPECHECK"|"UNIT"|"INTEGRATION"|"SECURITY"|"BUILD"|"BROWSER"|"EVALUATION"|"SMOKE";
export type CheckResult={id:string;kind:CheckKind;status:"PENDING"|"RUNNING"|"PASSED"|"FAILED"|"SKIPPED";summary:string;startedAt?:string;finishedAt?:string};
export type PromotionStage="BRANCH"|"SANDBOX"|"VERIFY"|"PREVIEW"|"APPROVAL"|"STAGING"|"SMOKE"|"PRODUCTION"|"ROLLED_BACK";
export type Pipeline={id:string;taskId:string;runId?:string;branch:string;stage:PromotionStage;checks:CheckResult[];approvalId?:string;rollbackArtifactId?:string;createdAt:string;updatedAt:string};
const checkKinds:CheckKind[]=["LINT","TYPECHECK","UNIT","INTEGRATION","SECURITY","BUILD","BROWSER","EVALUATION","SMOKE"];
let pipelines=loadFabric<Pipeline[]>("cicd",[]);
const clone=<T,>(x:T):T=>structuredClone(x);
const persist=()=>saveFabric("cicd",pipelines);
export function createPipeline(x:{taskId:string;branch:string;runId?:string;approvalId?:string}){
 if(!x.taskId||!x.branch)throw new Error("taskId and branch are required");
 const now=new Date().toISOString();const p={id:`PIPE-${crypto.randomUUID()}`,...x,stage:"BRANCH" as const,checks:checkKinds.map(kind=>({id:`CHK-${kind}-${crypto.randomUUID()}`,kind,status:"PENDING" as const,summary:"Not executed"})),createdAt:now,updatedAt:now};
 pipelines.push(p);persist();observe({type:"pipeline.created",message:`Pipeline ${p.id} erstellt`,status:"QUEUED",actor:"ci",resource:p.id,taskId:p.taskId,action:"cicd.pipeline.create",argumentsValue:x});return clone(p);
}
export function updateCheck(pipelineId:string,kind:CheckKind,status:CheckResult["status"],summary:string){
 const p=pipelines.find(x=>x.id===pipelineId);if(!p)throw new Error("pipeline not found");const c=p.checks.find(x=>x.kind===kind);if(!c)throw new Error("check not found");
 c.status=status;c.summary=summary;if(status==="RUNNING")c.startedAt=new Date().toISOString();if(["PASSED","FAILED","SKIPPED"].includes(status))c.finishedAt=new Date().toISOString();p.updatedAt=new Date().toISOString();persist();
 observe({type:"ci.check.updated",message:`${kind}: ${status}`,status:status==="PASSED"?"COMPLETED":status==="FAILED"?"ERROR":"RUNNING",actor:"ci",resource:p.id,taskId:p.taskId,action:"cicd.check.update",argumentsValue:{kind,status,summary}});return clone(p);
}
export function promote(pipelineId:string,next:PromotionStage){
 const p=pipelines.find(x=>x.id===pipelineId);if(!p)throw new Error("pipeline not found");
 if(next==="PRODUCTION"&&p.checks.some(x=>x.status!=="PASSED"))throw new Error("production promotion blocked: verification incomplete");
 if(next==="PRODUCTION"&&p.stage!=="SMOKE")throw new Error("production requires smoke stage");
 if(next==="PRODUCTION"&&p.approvalId===undefined)throw new Error("production promotion requires approvalId");
 p.stage=next;p.updatedAt=new Date().toISOString();persist();
 observe({type:"deployment.stage.changed",message:`Pipeline ${pipelineId} → ${next}`,status:next==="PRODUCTION"?"COMPLETED":"RUNNING",actor:"operator",resource:p.id,taskId:p.taskId,action:"cicd.promote",argumentsValue:{next}});return clone(p);
}
export function listPipelines(){return clone(pipelines)}
