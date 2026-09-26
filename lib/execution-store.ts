import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import type {Job} from "./queue";
import type {Run} from "./runs";

type Envelope<T>={version:1;writtenAt:string;items:T[];digest:string};

const root=()=>process.env.BOB_STORAGE_DIR??path.join(process.cwd(),".bob-data");
const digest=(value:unknown)=>crypto.createHash("sha256").update(JSON.stringify(value)).digest("hex");

function load<T>(name:string,defaults:T[]):T[]{
  fs.mkdirSync(root(),{recursive:true});
  const file=path.join(root(),name);
  if(!fs.existsSync(file)) return structuredClone(defaults);
  const raw=JSON.parse(fs.readFileSync(file,"utf8")) as Envelope<T>;
  const {digest:stored,...payload}=raw;
  if(stored!==digest(payload)) throw new Error(`Execution persistence integrity check failed: ${name}`);
  return structuredClone(raw.items);
}

function save<T>(name:string,items:T[]){
  fs.mkdirSync(root(),{recursive:true});
  const payload={version:1 as const,writtenAt:new Date().toISOString(),items:structuredClone(items)};
  const envelope={...payload,digest:digest(payload)};
  const file=path.join(root(),name);
  const tmp=path.join(root(),`.${name}.${process.pid}.${Date.now()}.tmp`);
  fs.writeFileSync(tmp,JSON.stringify(envelope,null,2),{encoding:"utf8",mode:0o600});
  fs.renameSync(tmp,file);
}

export function loadJobs(defaults:Job[]){return load("queue.json",defaults)}
export function saveJobs(items:Job[]){save("queue.json",items)}
export function loadRuns(defaults:Run[]){return load("runs.json",defaults)}
export function saveRuns(items:Run[]){save("runs.json",items)}
