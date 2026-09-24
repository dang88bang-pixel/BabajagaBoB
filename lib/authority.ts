import crypto from "node:crypto";
import type {Risk} from "./types";
import {loadAuthority,saveAuthority,authorityIntegrity} from "./authority-store";
export type AuthorityEdge={id:string;from:string;to:string;kind:"DELEGATES"|"SCOPES"|"BINDS";capabilities:string[];expiresAt:string|null};
export type CapabilityToken={id:string;subject:string;taskId:string;sandboxId:string;capabilities:string[];risk:Risk;issuedBy:string;expiresAt:string;revocable:boolean;revoked?:boolean};
const persisted=loadAuthority();
const edges:AuthorityEdge[]=persisted.edges;
const tokens=new Map<string,CapabilityToken>(persisted.tokens.map(x=>[x.id,x]));
const persist=()=>saveAuthority(edges,[...tokens.values()]);
export function addAuthorityEdge(edge:AuthorityEdge){if(!edge.id||edge.from===edge.to)throw new Error("invalid authority edge");if(!edge.capabilities.length)throw new Error("authority capabilities required");if(edge.expiresAt!==null&&new Date(edge.expiresAt)<=new Date())throw new Error("authority edge expired");if(edges.some(e=>e.id===edge.id))throw new Error("authority edge already exists");if(edge.from!=="CREATOR"){const parents=edges.filter(e=>e.to===edge.from&&(e.expiresAt===null||new Date(e.expiresAt)>new Date()));if(!parents.some(e=>e.capabilities.includes("*")||edge.capabilities.every(c=>e.capabilities.some(g=>matches(g,c)))))throw new Error("issuer lacks authority to delegate requested capabilities")}edges.push(structuredClone(edge));persist();return structuredClone(edge)}
export function authorityGraph(){return edges.map(x=>structuredClone(x))}
export function issueCapabilityToken(input:Omit<CapabilityToken,"id">){if(input.issuedBy===input.subject)throw new Error("self-grant is forbidden");if(input.capabilities.length===0)throw new Error("capability set must not be empty");if(new Date(input.expiresAt)<=new Date())throw new Error("capability token expired");const issuerEdges=edges.filter(e=>e.to===input.issuedBy&&(e.expiresAt===null||new Date(e.expiresAt)>new Date()));const issuerCanDelegate=input.issuedBy==="CREATOR"||issuerEdges.some(e=>e.capabilities.includes("*")||input.capabilities.every(cap=>e.capabilities.some(g=>matches(g,cap))));if(!issuerCanDelegate)throw new Error("issuer lacks authority to delegate requested capabilities");const token={...input,id:`CAP-${crypto.randomUUID()}`};tokens.set(token.id,structuredClone(token));persist();return structuredClone(token)}
export function revokeCapabilityToken(id:string){const token=tokens.get(id);if(!token)return false;token.revoked=true;tokens.set(id,token);persist();return true}
export function validateCapabilityToken(id:string,required:string[]){const token=tokens.get(id);if(!token)return {valid:false,reason:"token not found"};if(token.revoked)return {valid:false,reason:"token revoked"};if(new Date(token.expiresAt).getTime()<Date.now())return {valid:false,reason:"token expired"};if(!required.every(c=>token.capabilities.includes(c)))return {valid:false,reason:"capability not delegated"};return {valid:true,reason:"capability delegated"}}
export function capabilityTokens(){return [...tokens.values()].map(x=>structuredClone(x))}
export function authorityStoreIntegrity(){return authorityIntegrity()}
export function ensureExecutionCapability(agentId:string,taskId:string,sandboxId:string,risk:Risk){const existing=[...tokens.values()].find(t=>!t.revoked&&t.subject===agentId&&t.taskId===taskId&&t.sandboxId===sandboxId&&t.risk===risk&&t.capabilities.includes("task:execute")&&t.capabilities.includes("sandbox:run")&&new Date(t.expiresAt)>new Date());if(existing)return structuredClone(existing);return issueCapabilityToken({subject:agentId,taskId,sandboxId,capabilities:["task:execute","sandbox:run"],risk,issuedBy:"CREATOR",expiresAt:new Date(Date.now()+15*60_000).toISOString(),revocable:true})}

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
