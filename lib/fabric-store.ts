import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

const root=process.env.BOB_STORAGE_DIR?path.resolve(process.env.BOB_STORAGE_DIR):path.join(process.cwd(),".bob-data");
const clone=<T,>(value:T):T=>structuredClone(value);

function digest(payload:unknown){
 return crypto.createHash("sha256").update(JSON.stringify(payload)).digest("hex");
}

type Envelope<T>={version:1;writtenAt:string;data:T;digest:string};

function fileFor(name:string){return path.join(root,`${name}.json`);}

export function loadFabric<T>(name:string,initial:T):T{
 fs.mkdirSync(root,{recursive:true});
 const file=fileFor(name);
 if(!fs.existsSync(file)){
  saveFabric(name,initial);
  return clone(initial);
 }
 const envelope=JSON.parse(fs.readFileSync(file,"utf8")) as Envelope<T>;
 if(envelope.version!==1||!envelope.data||envelope.digest!==digest({version:envelope.version,writtenAt:envelope.writtenAt,data:envelope.data})){
  throw new Error(`Fabric store integrity check failed: ${name}`);
 }
 return clone(envelope.data);
}

export function saveFabric<T>(name:string,data:T){
 fs.mkdirSync(root,{recursive:true});
 const file=fileFor(name);
 const payload={version:1 as const,writtenAt:new Date().toISOString(),data:clone(data)};
 const envelope={...payload,digest:digest(payload)};
 const tmp=`${file}.${process.pid}.${Date.now()}.tmp`;
 fs.writeFileSync(tmp,JSON.stringify(envelope,null,2),{mode:0o600});
 fs.chmodSync(tmp,0o600);
 fs.renameSync(tmp,file);
}

export function fabricStorePath(name:string){return fileFor(name);}
