import {recordAudit} from "./audit";
import {observe} from "./observability";
import {loadGovernance,saveGovernance} from "./governance-store";
export type KillScope="SYSTEM"|"AGENT"|"TASK"|"EXPERIMENT"|"SANDBOX"|"DEPLOYMENT";
export type KillSwitch={scope:KillScope;targetId:string;active:boolean;reason:string;updatedAt:string};
export type Delegation={id:string;from:string;to:string;capabilities:string[];taskId?:string;sandboxId?:string;expiresAt:string;status:"ACTIVE"|"REVOKED"};
const persisted=loadGovernance();const switches:KillSwitch[]=persisted.switches;const delegations:Delegation[]=persisted.delegations;const persist=()=>saveGovernance(switches,delegations);
const now=()=>new Date().toISOString();const clone=<T,>(v:T):T=>structuredClone(v);
export function setKillSwitch(scope:KillScope,targetId:string,active:boolean,reason:string){const existing=switches.find(x=>x.scope===scope&&x.targetId===targetId);if(existing){existing.active=active;existing.reason=reason;existing.updatedAt=now();observe({type:"governance.kill_switch",message:`${scope}/${targetId}: ${active?"aktiv":"inaktiv"}`,status:active?"ERROR":"COMPLETED",actor:"creator",resource:targetId,action:"governance.kill_switch",argumentsValue:{scope,targetId,active,reason}});persist();return clone(existing)}const x={scope,targetId,active,reason,updatedAt:now()};switches.push(x);persist();observe({type:"governance.kill_switch",message:`${scope}/${targetId}: ${active?"aktiv":"inaktiv"}`,status:active?"ERROR":"COMPLETED",actor:"creator",resource:targetId,action:"governance.kill_switch",argumentsValue:{scope,targetId,active,reason}});return clone(x)}
export function isKilled(scope:KillScope,targetId:string){return switches.some(x=>x.active&&(x.scope==="SYSTEM"||x.scope===scope&&x.targetId===targetId))}
export function listKillSwitches(){return clone(switches)}
export function createDelegation(d:Omit<Delegation,"id"|"status">){if(d.from===d.to)throw new Error("self delegation rejected");if(new Date(d.expiresAt)<=new Date())throw new Error("delegation expired");const x={...d,id:`DEL-${Date.now()}`,status:"ACTIVE" as const};delegations.push(x);persist();observe({type:"governance.delegation.created",message:`Delegation ${x.id} erstellt`,status:"COMPLETED",actor:x.from,resource:x.id,action:"governance.delegation.create",argumentsValue:x});return clone(x)}
export function revokeDelegation(id:string){const d=delegations.find(x=>x.id===id);if(!d)throw new Error("delegation not found");d.status="REVOKED";persist();observe({type:"governance.delegation.revoked",message:`Delegation ${id} widerrufen`,status:"BLOCKED",actor:"system",resource:id,action:"governance.delegation.revoke"});return clone(d)}
export function validateDelegation(id:string,capability:string){const d=delegations.find(x=>x.id===id);if(!d||d.status!=="ACTIVE"||new Date(d.expiresAt)<=new Date()||!d.capabilities.some(c=>c==="*"||c===capability||c.endsWith(":*")&&capability.startsWith(c.slice(0,-1))))return null;return clone(d)}
export function listDelegations(){return clone(delegations)}
export function auditGovernance(action:string,resource:string,result:string){return recordAudit({actor:"system",action,resource,decision:"ALLOW"},result)}

export function delegationIntegrity(){return {count:delegations.length,active:delegations.filter(x=>x.status==="ACTIVE").length,expired:delegations.filter(x=>new Date(x.expiresAt)<=new Date()).length}}
