import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import type {Event} from "./types";

const root=process.env.BOB_STORAGE_DIR??path.join(process.cwd(),".bob-data");
const file=path.join(root,"events.json");
const lock=path.join(root,"events.lock");
const digest=(v:unknown)=>crypto.createHash("sha256").update(JSON.stringify(v)).digest("hex");
type Envelope={version:1;events:Event[];digest:string};
const clone=<T,>(v:T):T=>structuredClone(v);
const sleep=(ms:number)=>new Promise(resolve=>setTimeout(resolve,ms));

function read():Envelope{
 fs.mkdirSync(root,{recursive:true});
 if(!fs.existsSync(file)){
  const payload={version:1 as const,events:[]};
  const e={...payload,digest:digest(payload)};
  fs.writeFileSync(file,JSON.stringify(e,null,2),{mode:0o600});
  return e;
 }
 try{
  const e=JSON.parse(fs.readFileSync(file,"utf8")) as Envelope;
  const {digest:stored,...payload}=e;
  if(stored!==digest(payload))throw new Error("Event store integrity check failed");
  return e;
 }catch(error){
  if(error instanceof SyntaxError)throw new Error("Event store contains invalid JSON");
  throw error;
 }
}

async function acquireLock(timeoutMs=5000){
 fs.mkdirSync(root,{recursive:true});
 const started=Date.now();
 while(true){
  try{
   fs.mkdirSync(lock);
   fs.writeFileSync(path.join(lock,"owner"),JSON.stringify({pid:process.pid,time:new Date().toISOString()}),{mode:0o600});
   return;
  }catch(error){
   if(!error || typeof error!=="object" || !("code" in error) || (error as NodeJS.ErrnoException).code!=="EEXIST")throw error;
   try{
    const stat=fs.statSync(lock);
    if(Date.now()-stat.mtimeMs>30_000)fs.rmSync(lock,{recursive:true,force:true});
   }catch{}
   if(Date.now()-started>=timeoutMs)throw new Error("Event store lock acquisition timed out");
   await sleep(25);
  }
 }
}

function releaseLock(){fs.rmSync(lock,{recursive:true,force:true});}

function write(events:Event[]){
 const payload={version:1 as const,events:clone(events).slice(0,500)};
 const e={...payload,digest:digest(payload)};
 const tmp=path.join(root,`.events.${process.pid}.${crypto.randomUUID()}.tmp`);
 const fd=fs.openSync(tmp,"w",{mode:0o600});
 try{
  fs.writeFileSync(fd,JSON.stringify(e,null,2),"utf8");
  fs.fsyncSync(fd);
 }finally{fs.closeSync(fd);}
 fs.renameSync(tmp,file);
}

export function loadEvents(){return clone(read().events);}

export async function appendEventPersistent(event:Event){
 await acquireLock();
 try{
  const e=read();
  e.events.unshift(clone(event));
  write(e.events);
  return clone(event);
 }finally{releaseLock();}
}

export function eventStoreIntegrity(){
 const e=read();
 const {digest:stored,...payload}=e;
 return {ok:stored===digest(payload),digest:stored,version:e.version,count:e.events.length};
}
