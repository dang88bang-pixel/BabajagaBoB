import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import type {Objective,ExperimentRecord,Evidence,DecisionRecord,ExperimentRun} from "./science";

export type ScienceStore={objectives:Objective[];experiments:ExperimentRecord[];evidence:Evidence[];decisions:DecisionRecord[];experimentRuns:ExperimentRun[]};
type Envelope={version:1;writtenAt:string;data:ScienceStore;digest:string};
const root=process.env.BOB_STORAGE_DIR??path.join(process.cwd(),".bob-data");
const file=path.join(root,"science.json");
const digest=(v:unknown)=>crypto.createHash("sha256").update(JSON.stringify(v)).digest("hex");
const empty=():ScienceStore=>({objectives:[],experiments:[],evidence:[],decisions:[],experimentRuns:[]});
export function loadScience():ScienceStore{
 fs.mkdirSync(root,{recursive:true});
 if(!fs.existsSync(file))return empty();
 const e=JSON.parse(fs.readFileSync(file,"utf8")) as Envelope;
 const {digest:stored,...payload}=e;
 if(stored!==digest(payload))throw new Error("Science store integrity check failed");
 return payload.data;
}
export function saveScience(data:ScienceStore){
 fs.mkdirSync(root,{recursive:true});
 const payload={version:1 as const,writtenAt:new Date().toISOString(),data};
 const e={...payload,digest:digest(payload)};
 const tmp=path.join(root,`.science.${process.pid}.${Date.now()}.tmp`);
 fs.writeFileSync(tmp,JSON.stringify(e,null,2),{mode:0o600});
 fs.renameSync(tmp,file);
}
export function scienceStoreIntegrity(){
 try{loadScience();return {valid:true,file,checkedAt:new Date().toISOString()}}
 catch(error){return {valid:false,file,error:error instanceof Error?error.message:"integrity failure"}}
}