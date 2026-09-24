import {approvalGranted} from "./approvals";
import {isKilled} from "./governance";
import {evaluateTask} from "./policy";
import type {Task} from "./types";
export type GateResult={allowed:boolean;reasons:string[]};
export function executionGate(task:Task,approvalId?:string):GateResult{
 if(isKilled("TASK",task.id))return {allowed:false,reasons:["Task kill-switch is active"]};
 const policy=evaluateTask(task,false);
 if(policy.decision==="DENY")return {allowed:false,reasons:policy.reasons};
 if(policy.decision==="REQUIRE_APPROVAL"&&!approvalId)return {allowed:false,reasons:["Approval required"]};
 if(policy.decision==="REQUIRE_APPROVAL"&&!approvalGranted(approvalId!))return {allowed:false,reasons:["Approval is not granted"]};
 return {allowed:true,reasons:policy.reasons};
}
