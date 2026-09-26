import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

export type AppPersistenceState<TApp,TModule>={version:1;writtenAt:string;apps:TApp[];modules:TModule[];digest:string};

const root=()=>process.env.BOB_STORAGE_DIR??path.join(process.cwd(),".bob-data");
const file=()=>path.join(root(),"apps.json");
const digest=(value:unknown)=>crypto.createHash("sha256").update(JSON.stringify(value)).digest("hex");

export function loadAppPersistence<TApp,TModule>():{apps:TApp[];modules:TModule[]}{
 fs.mkdirSync(root(),{recursive:true});
 const target=file();
 if(!fs.existsSync(target)) return {apps:[],modules:[]};
 const raw=JSON.parse(fs.readFileSync(target,"utf8")) as AppPersistenceState<TApp,TModule>;
 const {digest:stored,...payload}=raw;
 if(stored!==digest(payload)) throw new Error("App persistence integrity check failed");
 return {apps:structuredClone(raw.apps),modules:structuredClone(raw.modules)};
}

export function saveAppPersistence<TApp,TModule>(apps:TApp[],modules:TModule[]){
 fs.mkdirSync(root(),{recursive:true});
 const payload={version:1 as const,writtenAt:new Date().toISOString(),apps:structuredClone(apps),modules:structuredClone(modules)};
 const envelope={...payload,digest:digest(payload)};
 const target=file();
 const tmp=path.join(root(),`.apps.${process.pid}.${Date.now()}.tmp`);
 fs.writeFileSync(tmp,JSON.stringify(envelope,null,2),{encoding:"utf8",mode:0o600});
 fs.renameSync(tmp,target);
}

export function appPersistenceIntegrity(){
 try{
  const raw=JSON.parse(fs.readFileSync(file(),"utf8")) as AppPersistenceState<unknown,unknown>;
  const {digest:stored,...payload}=raw;
  return {ok:stored===digest(payload),digest:stored,version:raw.version,writtenAt:raw.writtenAt};
 }catch{return {ok:false,digest:"",version:1 as const,writtenAt:""}}
}
