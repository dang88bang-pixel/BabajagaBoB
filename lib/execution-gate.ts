import {approvalGranted} from "./approvals";
import {isKilled} from "./governance";
import {evaluateTask} from "./policy";
import type {Task} from "./types";
export type GateResult={allowed:boolean;reasons:string[]};
export function executionGate(task:Task,approvalId?:string,systemLocked=false,agentId?:string,experimentId?:string,sandboxId?:string):GateResult{
 if(systemLocked||isKilled("SYSTEM","SYSTEM"))return {allowed:false,reasons:["System lockdown is active"]};
 if(isKilled("TASK",task.id))return {allowed:false,reasons:["Task kill-switch is active"]};
 if(agentId&&isKilled("AGENT",agentId))return {allowed:false,reasons:["Agent kill-switch is active"]};
 if(experimentId&&isKilled("EXPERIMENT",experimentId))return {allowed:false,reasons:["Experiment kill-switch is active"]};
 if(sandboxId&&isKilled("SANDBOX",sandboxId))return {allowed:false,reasons:["Sandbox kill-switch is active"]};
 const policy=evaluateTask(task,false);
 if(policy.decision==="DENY")return {allowed:false,reasons:policy.reasons};
 if(policy.decision==="REQUIRE_APPROVAL"&&!approvalId)return {allowed:false,reasons:["Approval required"]};
 if(policy.decision==="REQUIRE_APPROVAL"&&!(approvalId&&approvalGranted(approvalId)))return {allowed:false,reasons:["Approval is not granted"]};
 return {allowed:true,reasons:policy.reasons};
}
