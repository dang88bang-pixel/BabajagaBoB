import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import type {FailureRecord,RecoveryPlan} from "./reliability";
export type ReliabilityStore={failures:FailureRecord[];plans:RecoveryPlan[]};
type Envelope={version:1;writtenAt:string;data:ReliabilityStore;digest:string};
const root=process.env.BOB_STORAGE_DIR??path.join(process.cwd(),".bob-data"),file=path.join(root,"reliability.json");
const digest=(v:unknown)=>crypto.createHash("sha256").update(JSON.stringify(v)).digest("hex");
export function loadReliability():ReliabilityStore{fs.mkdirSync(root,{recursive:true});if(!fs.existsSync(file))return {failures:[],plans:[]};const e=JSON.parse(fs.readFileSync(file,"utf8")) as Envelope;const {digest:stored,...payload}=e;if(stored!==digest(payload))throw new Error("Reliability store integrity check failed");return payload.data}
export function saveReliability(data:ReliabilityStore){fs.mkdirSync(root,{recursive:true});const payload={version:1 as const,writtenAt:new Date().toISOString(),data};const e={...payload,digest:digest(payload)};const tmp=path.join(root,`.reliability.${process.pid}.${Date.now()}.tmp`);fs.writeFileSync(tmp,JSON.stringify(e,null,2),{mode:0o600});fs.renameSync(tmp,file)}
export function reliabilityStoreIntegrity(){try{loadReliability();return {valid:true,file}}catch(error){return {valid:false,file,error:error instanceof Error?error.message:"integrity failure"}}}