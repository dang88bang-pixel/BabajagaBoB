import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import type {Event} from "./types";
const root=process.env.BOB_STORAGE_DIR??path.join(process.cwd(),".bob-data");
const file=path.join(root,"events.json");
const digest=(v:unknown)=>crypto.createHash("sha256").update(JSON.stringify(v)).digest("hex");
type Envelope={version:1;events:Event[];digest:string};
const clone=<T,>(v:T):T=>structuredClone(v);
function read():Envelope{
 fs.mkdirSync(root,{recursive:true});
 if(!fs.existsSync(file)){const payload={version:1 as const,events:[]};const e={...payload,digest:digest(payload)};fs.writeFileSync(file,JSON.stringify(e,null,2),{mode:0o600});return e;}
 const e=JSON.parse(fs.readFileSync(file,"utf8")) as Envelope;const {digest:stored,...payload}=e;if(stored!==digest(payload))throw new Error("Event store integrity check failed");return e;
}
function write(events:Event[]){const payload={version:1 as const,events:clone(events).slice(0,500)};const e={...payload,digest:digest(payload)};const tmp=path.join(root,`.events.${process.pid}.${Date.now()}.tmp`);fs.writeFileSync(tmp,JSON.stringify(e,null,2),{mode:0o600});fs.renameSync(tmp,file);}
export function loadEvents(){return clone(read().events);}
export function appendEventPersistent(event:Event){const e=read();e.events.unshift(clone(event));write(e.events);return clone(event);}
export function eventStoreIntegrity(){const e=read();const {digest:stored,...payload}=e;return {ok:stored===digest(payload),digest:stored,version:e.version,count:e.events.length};}