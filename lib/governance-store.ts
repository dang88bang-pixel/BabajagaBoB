import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import type {KillSwitch,Delegation} from "./governance";
type Envelope={version:1;writtenAt:string;switches:KillSwitch[];delegations:Delegation[];digest:string};
const root=process.env.BOB_STORAGE_DIR??path.join(process.cwd(),".bob-data"),file=path.join(root,"governance.json");
const digest=(v:unknown)=>crypto.createHash("sha256").update(JSON.stringify(v)).digest("hex");
export function loadGovernance(){fs.mkdirSync(root,{recursive:true});if(!fs.existsSync(file))return {switches:[] as KillSwitch[],delegations:[] as Delegation[]};const e=JSON.parse(fs.readFileSync(file,"utf8")) as Envelope;const {digest:stored,...payload}=e;if(stored!==digest(payload))throw new Error("Governance store integrity check failed");return {switches:payload.switches,delegations:payload.delegations}}
export function saveGovernance(switches:KillSwitch[],delegations:Delegation[]){fs.mkdirSync(root,{recursive:true});const payload={version:1 as const,writtenAt:new Date().toISOString(),switches,delegations};const e={...payload,digest:digest(payload)};const tmp=path.join(root,`.governance.${process.pid}.${Date.now()}.tmp`);fs.writeFileSync(tmp,JSON.stringify(e,null,2),{mode:0o600});fs.renameSync(tmp,file)}
export function governanceStoreIntegrity(){try{loadGovernance();return {valid:true,file}}catch(error){return {valid:false,file,error:error instanceof Error?error.message:"integrity failure"}}}