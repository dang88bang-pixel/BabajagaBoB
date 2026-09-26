import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import type {ApprovalRequest} from "./approvals";
type Envelope={version:1;writtenAt:string;requests:ApprovalRequest[];digest:string};
const root=process.env.BOB_STORAGE_DIR??path.join(process.cwd(),".bob-data"),file=path.join(root,"approvals.json");
const digest=(v:unknown)=>crypto.createHash("sha256").update(JSON.stringify(v)).digest("hex");
export function loadApprovals():ApprovalRequest[]{fs.mkdirSync(root,{recursive:true});if(!fs.existsSync(file))return [];const e=JSON.parse(fs.readFileSync(file,"utf8")) as Envelope;const {digest:stored,...payload}=e;if(stored!==digest(payload))throw new Error("Approval store integrity check failed");return payload.requests}
export function saveApprovals(requests:ApprovalRequest[]){fs.mkdirSync(root,{recursive:true});const payload={version:1 as const,writtenAt:new Date().toISOString(),requests};const e={...payload,digest:digest(payload)};const tmp=path.join(root,`.approvals.${process.pid}.${Date.now()}.tmp`);fs.writeFileSync(tmp,JSON.stringify(e,null,2),{mode:0o600});fs.renameSync(tmp,file)}
export function approvalStoreIntegrity(){try{loadApprovals();return {valid:true,file}}catch(error){return {valid:false,file,error:error instanceof Error?error.message:"integrity failure"}}}