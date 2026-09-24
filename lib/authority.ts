import crypto from "node:crypto";
import type {Risk} from "./types";
export type AuthorityEdge={id:string;from:string;to:string;kind:"DELEGATES"|"SCOPES"|"BINDS";capabilities:string[];expiresAt:string|null};
export type CapabilityToken={id:string;subject:string;taskId:string;sandboxId:string;capabilities:string[];risk:Risk;issuedBy:string;expiresAt:string;revocable:boolean;revoked?:boolean};
const edges:AuthorityEdge[]=[],tokens=new Map<string,CapabilityToken>();
export function addAuthorityEdge(edge:AuthorityEdge){if(edge.from===edge.to)throw new Error("self delegation is forbidden");edges.push(structuredClone(edge));return structuredClone(edge)}
export function authorityGraph(){return edges.map(x=>structuredClone(x))}
export function issueCapabilityToken(input:Omit<CapabilityToken,"id">){if(input.issuedBy===input.subject)throw new Error("self-grant is forbidden");const token={...input,id:`CAP-${crypto.randomUUID()}`};tokens.set(token.id,structuredClone(token));return structuredClone(token)}
export function revokeCapabilityToken(id:string){const token=tokens.get(id);if(!token)return false;token.revoked=true;tokens.set(id,token);return true}
export function validateCapabilityToken(id:string,required:string[]){const token=tokens.get(id);if(!token)return {valid:false,reason:"token not found"};if(token.revoked)return {valid:false,reason:"token revoked"};if(new Date(token.expiresAt).getTime()<Date.now())return {valid:false,reason:"token expired"};if(!required.every(c=>token.capabilities.includes(c)))return {valid:false,reason:"capability not delegated"};return {valid:true,reason:"capability delegated"}}
export function capabilityTokens(){return [...tokens.values()].map(x=>structuredClone(x))}

export type Role="OWNER"|"ADMIN"|"DEVELOPER"|"REVIEWER"|"OPERATOR"|"VIEWER";
export type SubjectContext={actorId:string;role:Role;agentId?:string;taskId?:string;sandboxId?:string;environment:string;capabilities:string[]};
export type PolicyContext={action:string;resource:string;risk:Risk;requiresApproval:boolean;environment:string;now?:string};

const roleCapabilities:Record<Role,string[]>={
 OWNER:["*"],ADMIN:["mission:*","task:*","agent:*","approval:*","deployment:*","security:*"],
 DEVELOPER:["mission:read","task:read","task:execute","repo:branch","sandbox:run","artifact:write"],
 REVIEWER:["mission:read","task:read","approval:read","approval:resolve","audit:read"],
 OPERATOR:["task:read","task:execute","sandbox:run","deployment:execute"],VIEWER:["mission:read","task:read","agent:read","audit:read"]
};
const matches=(granted:string,needed:string)=>granted==="*"||granted===needed||granted.endsWith(":*")&&needed.startsWith(granted.slice(0,-1));
export function roleAllows(role:Role,capability:string){return roleCapabilities[role].some(x=>matches(x,capability))}
export function abacAllows(subject:SubjectContext,policy:PolicyContext){
 if(!roleAllows(subject.role,policy.action))return {allowed:false,reason:"RBAC capability denied"};
 if(subject.environment!==policy.environment)return {allowed:false,reason:"Environment boundary mismatch"};
 if(policy.risk==="CRITICAL")return {allowed:false,reason:"Critical action requires higher-level execution path"};
 if(policy.requiresApproval||policy.risk==="HIGH")return {allowed:false,reason:"Approval gate required"};
 if(!subject.capabilities.some(x=>matches(x,policy.action)))return {allowed:false,reason:"Delegated capability missing"};
 return {allowed:true,reason:"RBAC + ABAC + delegated capability satisfied"};
}
