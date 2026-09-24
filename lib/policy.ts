import type {Risk,Task} from "./types";
export type Decision="ALLOW"|"REQUIRE_APPROVAL"|"DENY";
export type PolicyDecision={decision:Decision;risk:Risk;reasons:string[]};
export function evaluateTask(task:Task,locked:boolean):PolicyDecision{
 if(locked)return {decision:"DENY",risk:task.risk,reasons:["Emergency lockdown is active"]};
 if(task.risk==="CRITICAL")return {decision:"DENY",risk:task.risk,reasons:["Critical actions require an explicit higher-level execution path"]};
 if(task.requiresApproval||task.risk==="HIGH")return {decision:"REQUIRE_APPROVAL",risk:task.risk,reasons:["Delegated approval is required before execution"]};
 return {decision:"ALLOW",risk:task.risk,reasons:["Task is within its declared risk and approval boundary"]};
}
