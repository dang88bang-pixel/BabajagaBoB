import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type {AuthorityEdge, CapabilityToken} from "./authority";

type Envelope={version:1;writtenAt:string;edges:AuthorityEdge[];tokens:CapabilityToken[];digest:string};
const dir=process.env.BOB_STORAGE_DIR||path.join(process.cwd(),".bob-data");
const file=path.join(dir,"authority.json");
const digest=(edges:AuthorityEdge[],tokens:CapabilityToken[])=>crypto.createHash("sha256").update(JSON.stringify({edges,tokens})).digest("hex");
function ensure(){fs.mkdirSync(dir,{recursive:true});try{fs.chmodSync(dir,0o700)}catch{/* chmod is best effort on non-POSIX filesystems */}}
export function loadAuthority(){ensure();if(!fs.existsSync(file))return {edges:[] as AuthorityEdge[],tokens:[] as CapabilityToken[]};const e=JSON.parse(fs.readFileSync(file,"utf8")) as Envelope;if(e.version!==1||e.digest!==digest(e.edges,e.tokens))throw new Error("authority store integrity check failed");return {edges:e.edges,tokens:e.tokens}}
export function saveAuthority(edges:AuthorityEdge[],tokens:CapabilityToken[]){ensure();const envelope:Envelope={version:1,writtenAt:new Date().toISOString(),edges,tokens,digest:digest(edges,tokens)};const tmp=file+".tmp";fs.writeFileSync(tmp,JSON.stringify(envelope,null,2),{mode:0o600});fs.renameSync(tmp,file);try{fs.chmodSync(file,0o600)}catch{/* chmod is best effort on non-POSIX filesystems */}}
export function authorityIntegrity(){ensure();if(!fs.existsSync(file))return {exists:false,verified:true};const e=JSON.parse(fs.readFileSync(file,"utf8")) as Envelope;return {exists:true,verified:e.version===1&&e.digest===digest(e.edges,e.tokens),writtenAt:e.writtenAt}}
