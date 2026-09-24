import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

export type AuditRecord={id:string;time:string;actor:string;action:string;resource?:string;decision:string;argumentHash:string;causalParentId?:string};
type Envelope={version:1;records:AuditRecord[];digest:string};
const root=process.env.BOB_STORAGE_DIR??path.join(process.cwd(),".bob-data");
const file=path.join(root,"audit.json");
const digest=(v:unknown)=>crypto.createHash("sha256").update(JSON.stringify(v)).digest("hex");
const clone=<T,>(x:T):T=>structuredClone(x);
function read():Envelope{
 fs.mkdirSync(root,{recursive:true});
 if(!fs.existsSync(file)){const payload={version:1 as const,records:[]};const e={...payload,digest:digest(payload)};fs.writeFileSync(file,JSON.stringify(e,null,2),{mode:0o600});return e;}
 const e=JSON.parse(fs.readFileSync(file,"utf8")) as Envelope;const {digest:stored,...payload}=e;if(stored!==digest(payload))throw new Error("Audit integrity check failed");return e;
}
function write(records:AuditRecord[]){
 const payload={version:1 as const,records:clone(records.slice(0,500))};const e={...payload,digest:digest(payload)};const tmp=path.join(root,`.audit.${process.pid}.${Date.now()}.tmp`);fs.writeFileSync(tmp,JSON.stringify(e,null,2),{mode:0o600});fs.renameSync(tmp,file);
}
export function recordAudit(input:Omit<AuditRecord,"id"|"time"|"argumentHash">,argumentsValue:unknown){
 const e=read();const argumentHash=crypto.createHash("sha256").update(JSON.stringify(argumentsValue??null)).digest("hex");
 const r={...input,id:crypto.randomUUID(),time:new Date().toISOString(),argumentHash,causalParentId:e.records[0]?.id};
 e.records.unshift(r);write(e.records);return clone(r);
}
export function auditSnapshot(){return clone(read().records);}
export function auditIntegrity(){const e=read();return {verified:true,count:e.records.length,digest:e.digest};}