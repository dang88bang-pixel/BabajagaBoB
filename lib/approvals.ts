import {recordAudit} from "./audit";
import {observe} from "./observability";
import {loadApprovals,saveApprovals} from "./approval-store";
export type ApprovalRequest={id:string;taskId:string;requestedBy:string;changeSummary:string;why:string;expectedEffect:string;risks:string[];testResults:string[];rollbackPlan:string;files:string[];dbChanges:string[];networkEffects:string[];status:"PENDING"|"GRANTED"|"DENIED";createdAt:string;resolvedAt?:string;resolvedBy?:string};
const requests:ApprovalRequest[]=loadApprovals();const persist=()=>saveApprovals(requests);
const clone=<T,>(x:T):T=>structuredClone(x);
export function createApproval(x:Omit<ApprovalRequest,"id"|"status"|"createdAt">){const a={...x,id:`APR-${Date.now()}`,status:"PENDING" as const,createdAt:new Date().toISOString()};requests.push(a);persist();observe({type:"approval.requested",message:`Approval ${a.id} angefordert`,status:"APPROVAL_REQUIRED",actor:x.requestedBy,resource:a.id,taskId:a.taskId,action:"approval.request",decision:"REQUIRE_APPROVAL",argumentsValue:a});recordAudit({actor:x.requestedBy,action:"approval.requested",resource:a.id,decision:"REQUIRE_APPROVAL"},a);return clone(a)}
export function resolveApprovalRequest(id:string,status:"GRANTED"|"DENIED",actor:string){const a=requests.find(x=>x.id===id);if(!a)throw new Error("approval not found");if(a.status!=="PENDING")throw new Error("approval already resolved");a.status=status;a.resolvedAt=new Date().toISOString();a.resolvedBy=actor;persist();observe({type:`approval.${status.toLowerCase()}`,message:`Approval ${id}: ${status}`,status:status==="GRANTED"?"COMPLETED":"BLOCKED",actor,resource:id,taskId:a.taskId,action:`approval.${status.toLowerCase()}`,argumentsValue:a});recordAudit({actor,action:`approval.${status.toLowerCase()}`,resource:id,decision:status},a);return clone(a)}
export function getApproval(id:string){const a=requests.find(x=>x.id===id);return a?clone(a):null}
export function listApprovals(){return clone(requests)}
export function approvalGranted(id:string){return requests.some(x=>x.id===id&&x.status==="GRANTED")}
