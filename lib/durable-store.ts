import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import type {ControlState} from "./types";
import type {Artifact} from "./artifacts";
import type {AuditRecord} from "./audit";
import type {ControlStore} from "./store";

type PersistedEnvelope={version:1;writtenAt:string;state:ControlState;audits:AuditRecord[];artifacts:Artifact[];digest:string};

const digest=(value:unknown)=>crypto.createHash("sha256").update(JSON.stringify(value)).digest("hex");

export class DurableJsonControlStore implements ControlStore{
 private readonly filePath:string;
 private readonly backupDir:string;
 private envelope:PersistedEnvelope;

 constructor(initial:ControlState, root=process.env.BOB_STORAGE_DIR??path.join(process.cwd(),".bob-data")){
  this.filePath=path.join(root,"control-store.json");
  this.backupDir=path.join(root,"backups");
  fs.mkdirSync(this.backupDir,{recursive:true});
  this.envelope=this.readOrCreate(initial);
 }

 private readOrCreate(initial:ControlState):PersistedEnvelope{
  if(!fs.existsSync(this.filePath)){
   const e=this.build(initial,[],[]);
   this.atomicWrite(e);
   return e;
  }
  const raw=JSON.parse(fs.readFileSync(this.filePath,"utf8")) as PersistedEnvelope;
  const {digest:stored,...payload}=raw;
  if(stored!==digest(payload)) throw new Error("Control store integrity check failed");
  return raw;
 }

 private build(state:ControlState,audits:AuditRecord[],artifacts:Artifact[]):PersistedEnvelope{
  const payload={version:1 as const,writtenAt:new Date().toISOString(),state:structuredClone(state),audits:structuredClone(audits),artifacts:structuredClone(artifacts)};
  return {...payload,digest:digest(payload)};
 }

 private atomicWrite(next:PersistedEnvelope){
  const dir=path.dirname(this.filePath);
  const tmp=path.join(dir,`.control-store.${process.pid}.${Date.now()}.tmp`);
  fs.writeFileSync(tmp,JSON.stringify(next,null,2),{encoding:"utf8",mode:0o600});
  fs.renameSync(tmp,this.filePath);
 }

 private commit(state:ControlState,audits=this.envelope.audits,artifacts=this.envelope.artifacts){
  const next=this.build(state,audits,artifacts);
  this.atomicWrite(next);
  this.envelope=next;
 }

 getControlState(){return structuredClone(this.envelope.state)}
 saveControlState(state:ControlState){this.commit(state)}
 appendAudit(record:AuditRecord){this.commit(this.envelope.state,[...this.envelope.audits,structuredClone(record)],this.envelope.artifacts)}
 listAudit(){return structuredClone(this.envelope.audits)}
 appendArtifact(artifact:Artifact){this.commit(this.envelope.state,this.envelope.audits,[...this.envelope.artifacts,structuredClone(artifact)])}
 listArtifacts(){return structuredClone(this.envelope.artifacts)}

 transaction(mutator:(draft:{state:ControlState;audits:AuditRecord[];artifacts:Artifact[]})=>void){
  const draft={state:this.getControlState(),audits:this.listAudit(),artifacts:this.listArtifacts()};
  mutator(draft);
  this.commit(draft.state,draft.audits,draft.artifacts);
 }

 backup(){
  const stamp=new Date().toISOString().replaceAll(":","-");
  const target=path.join(this.backupDir,`control-store-${stamp}.json`);
  fs.copyFileSync(this.filePath,target);
  this.pruneBackups(20);
  return target;
 }

 restore(backupPath:string){
  const resolved=path.resolve(backupPath);
  const allowed=path.resolve(this.backupDir)+path.sep;
  if(!resolved.startsWith(allowed)) throw new Error("Backup path outside configured backup directory");
  const candidate=JSON.parse(fs.readFileSync(resolved,"utf8")) as PersistedEnvelope;
  const {digest:stored,...payload}=candidate;
  if(stored!==digest(payload)) throw new Error("Backup integrity check failed");
  this.atomicWrite(candidate);
  this.envelope=candidate;
 }

 integrity(){
  const {digest:stored,...payload}=this.envelope;
  return {ok:stored===digest(payload),digest:stored,version:this.envelope.version,writtenAt:this.envelope.writtenAt};
 }

 private pruneBackups(max:number){
  const files=fs.readdirSync(this.backupDir).filter(x=>x.endsWith(".json")).sort();
  for(const file of files.slice(0,Math.max(0,files.length-max))) fs.rmSync(path.join(this.backupDir,file));
 }
}
