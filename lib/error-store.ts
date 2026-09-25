import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import type {ErrorIncident} from "./error-intelligence";

type Envelope={version:1;writtenAt:string;items:ErrorIncident[];digest:string};
const root=process.env.BOB_STORAGE_DIR??path.join(process.cwd(),".bob-data");
const file=path.join(root,"errors.json");
const digest=(v:unknown)=>crypto.createHash("sha256").update(JSON.stringify(v)).digest("hex");
function ensure(){fs.mkdirSync(root,{recursive:true,mode:0o700});}
export function loadErrors():ErrorIncident[]{ensure();if(!fs.existsSync(file))return [];const e=JSON.parse(fs.readFileSync(file,"utf8")) as Envelope;const {digest:stored,...payload}=e;if(stored!==digest(payload))throw new Error("Error intelligence integrity check failed");if(e.version!==1||!Array.isArray(e.items))throw new Error("Invalid error intelligence store");return structuredClone(e.items);}
export function saveErrors(items:ErrorIncident[]){ensure();const bounded=items.slice(0,500);const payload={version:1 as const,writtenAt:new Date().toISOString(),items:structuredClone(bounded)};const e={...payload,digest:digest(payload)};const tmp=path.join(root,`.errors.${process.pid}.${Date.now()}.tmp`);fs.writeFileSync(tmp,JSON.stringify(e,null,2),{mode:0o600});fs.chmodSync(tmp,0o600);fs.renameSync(tmp,file);}
export function errorStoreIntegrity(){const items=loadErrors();return {count:items.length,verified:true};}