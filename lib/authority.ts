import crypto from "node:crypto";
import type {Risk} from "./types";
export type AuthorityEdge={id:string;from:string;to:string;kind:"DELEGATES"|"SCOPES"|"BINDS";capabilities:string[];expiresAt:string|null};
export type CapabilityToken={id:string;subject:string;taskId:string;sandboxId:string;capabilities:string[];risk:Risk;issuedBy:string;expiresAt:string;revocable:boolean};
const edges:AuthorityEdge[]=[],tokens=new Map<string,CapabilityToken>();
export function addAuthorityEdge(edge:AuthorityEdge){if(edge.from===edge.to)throw new Error("self delegation is forbidden");edges.push(structuredClone(edge));return structuredClone(edge)}
export function authorityGraph(){return edges.map(structuredClone)}
export function issueCapabilityToken(input:Omit<CapabilityToken,"id">){if(input.issuedBy===input.subject)throw new Error("self-grant is forbidden");const token={...input,id:`CAP-${crypto.randomUUID()}`};tokens.set(token.id,structuredClone(token));return structuredClone(token)}
export function revokeCapabilityToken(id:string){const token=tokens.get(id);if(!token)return false;token.revocable=false;tokens.set(id,token);return true}
export function validateCapabilityToken(id:string,required:string[]){const token=tokens.get(id);if(!token)return {valid:false,reason:"token not found"};if(new Date(token.expiresAt).getTime()<Date.now())return {valid:false,reason:"token expired"};if(!required.every(c=>token.capabilities.includes(c)))return {valid:false,reason:"capability not delegated"};return {valid:true,reason:"capability delegated"}}
export function capabilityTokens(){return [...tokens.values()].map(structuredClone)}
