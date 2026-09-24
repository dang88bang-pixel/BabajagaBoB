import crypto from "node:crypto";
export type AuditRecord={id:string;time:string;actor:string;action:string;resource?:string;decision:string;argumentHash:string;causalParentId?:string};
const records:AuditRecord[]=[];
export function recordAudit(input:Omit<AuditRecord,"id"|"time"|"argumentHash">,argumentsValue:unknown){const argumentHash=crypto.createHash("sha256").update(JSON.stringify(argumentsValue??null)).digest("hex");const r={...input,id:crypto.randomUUID(),time:new Date().toISOString(),argumentHash,causalParentId:records[0]?.id};records.unshift(r);records.splice(100);return r}
export function auditSnapshot(){return [...records]}
