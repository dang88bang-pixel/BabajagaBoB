import {recordAudit} from "./audit";
export type KillScope="SYSTEM"|"AGENT"|"TASK"|"EXPERIMENT"|"SANDBOX"|"DEPLOYMENT";
export type KillSwitch={scope:KillScope;targetId:string;active:boolean;reason:string;updatedAt:string};
export type Delegation={id:string;from:string;to:string;capabilities:string[];taskId?:string;sandboxId?:string;expiresAt:string;status:"ACTIVE"|"REVOKED"};
const switches:KillSwitch[]=[];const delegations:Delegation[]=[];
const now=()=>new Date().toISOString();const clone=<T,>(v:T):T=>structuredClone(v);
export function setKillSwitch(scope:KillScope,targetId:string,active:boolean,reason:string){const existing=switches.find(x=>x.scope===scope&&x.targetId===targetId);if(existing){existing.active=active;existing.reason=reason;existing.updatedAt=now();return clone(existing)}const x={scope,targetId,active,reason,updatedAt:now()};switches.push(x);return clone(x)}
export function isKilled(scope:KillScope,targetId:string){return switches.some(x=>x.active&&(x.scope==="SYSTEM"||x.scope===scope&&x.targetId===targetId))}
export function listKillSwitches(){return clone(switches)}
export function createDelegation(d:Omit<Delegation,"id"|"status">){if(d.from===d.to)throw new Error("self delegation rejected");if(new Date(d.expiresAt)<=new Date())throw new Error("delegation expired");const x={...d,id:`DEL-${Date.now()}`,status:"ACTIVE" as const};delegations.push(x);return clone(x)}
export function revokeDelegation(id:string){const d=delegations.find(x=>x.id===id);if(!d)throw new Error("delegation not found");d.status="REVOKED";return clone(d)}
export function validateDelegation(id:string,capability:string){const d=delegations.find(x=>x.id===id);if(!d||d.status!=="ACTIVE"||new Date(d.expiresAt)<=new Date()||!d.capabilities.some(c=>c==="*"||c===capability||c.endsWith(":*")&&capability.startsWith(c.slice(0,-1))))return null;return clone(d)}
export function listDelegations(){return clone(delegations)}
export function auditGovernance(action:string,resource:string,result:string){return recordAudit({actor:"system",action,resource,decision:"ALLOW"},result)}
