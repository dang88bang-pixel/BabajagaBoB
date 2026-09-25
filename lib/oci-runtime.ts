import {spawn} from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type {ResourceLimits,RuntimeHandle} from "./runtime";

export type OciContainerSpec={
 image:string; command:string[]; limits:ResourceLimits; network:"DENY"|"ALLOWLIST"; allowlist?:string[]; workingDirectory?:string; containerName?:string;
};
export type OciExecutionResult={accepted:boolean;exitCode:number|null;stdout:string;stderr:string;timedOut:boolean;message:string};
export type OciRuntimeObservation={sandboxId:string;containerId?:string;containerName?:string;state:"READY"|"RUNNING"|"PAUSED"|"FAILED"|"ORPHANED";managed:boolean;image?:string;observedAt:string};
type Persisted={handle:RuntimeHandle;image:string};
const root=()=>process.env.BOB_STORAGE_DIR??path.join(process.cwd(),".bob-data");
const file=()=>path.join(root(),"oci-runtime.json");
const handles=new Map<string,{handle:RuntimeHandle;image:string}>();

function assertSafeImage(image:string){if(!/^[a-zA-Z0-9][a-zA-Z0-9._/:@-]+$/.test(image))throw new Error("Invalid OCI image reference")}
function assertSafeName(name:string){if(!/^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,127}$/.test(name))throw new Error("Invalid OCI container name")}
function load(){try{const raw=JSON.parse(fs.readFileSync(file(),"utf8")) as Persisted[];for(const item of raw)handles.set(item.handle.sandboxId,item)}catch{/* no persisted handles yet */}}
function save(){fs.mkdirSync(root(),{recursive:true});const tmp=file()+".tmp";fs.writeFileSync(tmp,JSON.stringify([...handles.values()],null,2),{mode:0o600});fs.renameSync(tmp,file())}
function runDocker(args:string[],timeoutMs:number):Promise<{code:number|null;stdout:string;stderr:string;timedOut:boolean}>{
 return new Promise((resolve,reject)=>{const child=spawn("docker",args,{shell:false,stdio:["ignore","pipe","pipe"]});let stdout="",stderr="",timedOut=false;const timer=setTimeout(()=>{timedOut=true;child.kill("SIGKILL")},timeoutMs);child.stdout.on("data",c=>stdout+=String(c));child.stderr.on("data",c=>stderr+=String(c));child.once("error",e=>{clearTimeout(timer);reject(e)});child.once("close",code=>{clearTimeout(timer);resolve({code,stdout,stderr,timedOut})})})
}

export class OciContainerRuntimeAdapter{
 constructor(){load()}
 getHandle(sandboxId:string){const item=handles.get(sandboxId);return item?structuredClone(item.handle):undefined}
 async create(spec:OciContainerSpec):Promise<RuntimeHandle>{
  assertSafeImage(spec.image);
  if(spec.limits.timeoutMs<=0||spec.limits.memoryMb<=0||spec.limits.cpuMillicores<=0||spec.limits.processes<=0)throw new Error("Invalid sandbox resource limits");
  if(spec.network==="ALLOWLIST")throw new Error("OCI ALLOWLIST networking is fail-closed until an egress proxy is configured");
  const sandboxId=spec.containerName??`oci-${crypto.randomUUID()}`;assertSafeName(sandboxId);
  const args=["create","--name",sandboxId,"--label","com.bob.managed=true","--label",`com.bob.sandbox-id=${sandboxId}`,"--network","none","--cpus",String(spec.limits.cpuMillicores/1000),"--memory",`${spec.limits.memoryMb}m`,"--pids-limit",String(spec.limits.processes),"--read-only","--cap-drop","ALL","--security-opt","no-new-privileges","--tmpfs","/tmp:rw,noexec,nosuid,size=64m",...(spec.workingDirectory?["--workdir",spec.workingDirectory]:[]),spec.image,...spec.command];
  const result=await runDocker(args,Math.min(spec.limits.timeoutMs,30_000));if(result.timedOut||result.code!==0)throw new Error(`OCI create failed: ${result.stderr||result.stdout||"unknown error"}`);
  const handle:RuntimeHandle={sandboxId,state:"READY",network:{mode:"DENY",allowlist:[]},limits:spec.limits};handles.set(sandboxId,{handle,image:spec.image});save();return structuredClone(handle);
 }
 async reconcile():Promise<OciRuntimeObservation[]>{
  const observedAt=new Date().toISOString();
  const observations:OciRuntimeObservation[]=[];
  const listed=await runDocker(["ps","-a","--filter","label=com.bob.managed=true","--format","{{json .}}"],10_000).catch(()=>({code:1,stdout:"",stderr:"",timedOut:false}));
  const actual=new Map<string,{id:string;name:string;image:string;state:string}>();
  if(listed.code===0&&!listed.timedOut){for(const line of listed.stdout.split("\\n").filter(Boolean)){try{const row=JSON.parse(line) as {ID?:string;Names?:string;Image?:string;State?:string};if(row.ID&&row.Names)actual.set(row.Names,{id:row.ID,name:row.Names,image:row.Image??"",state:row.State??""});}catch{/* skip unparsable docker ps row */}}}
  for(const [id,item] of handles){
   const r=await runDocker(["inspect","--format","{{.State.Status}}",id],10_000).catch(()=>({code:1,stdout:"",stderr:"",timedOut:false}));
   if(r.code!==0){item.handle.state="FAILED";observations.push({sandboxId:id,state:"FAILED",managed:true,observedAt});continue}
   const status=r.stdout.trim();
   item.handle.state=status==="running"?"RUNNING":status==="created"?"READY":status==="paused"?"PAUSED":"FAILED";
   const row=actual.get(id);
   observations.push({sandboxId:id,containerId:row?.id,containerName:row?.name??id,state:item.handle.state,managed:true,image:item.image,observedAt});
  }
  for(const row of actual.values()){
   if(handles.has(row.name))continue;
   observations.push({sandboxId:row.name,containerId:row.id,containerName:row.name,state:"ORPHANED",managed:true,image:row.image,observedAt});
  }
  save();return observations
 }
 async start(sandboxId:string){
  const item=handles.get(sandboxId);if(!item)throw new Error("OCI sandbox not found");
  const r=await runDocker(["start",sandboxId],Math.min(item.handle.limits.timeoutMs,30_000));if(r.timedOut||r.code!==0)throw new Error(`OCI start failed: ${r.stderr||r.stdout||"unknown error"}`);
  item.handle.state="RUNNING";save();return structuredClone(item.handle)
 }
 async pause(sandboxId:string){
  const item=handles.get(sandboxId);if(!item)throw new Error("OCI sandbox not found");
  const r=await runDocker(["pause",sandboxId],30_000);if(r.timedOut||r.code!==0)throw new Error(`OCI pause failed: ${r.stderr||r.stdout||"unknown error"}`);
  item.handle.state="PAUSED";save();return structuredClone(item.handle)
 }
 async execute(sandboxId:string,command:string[]):Promise<OciExecutionResult>{
  const item=handles.get(sandboxId);if(!item)throw new Error("OCI sandbox not found");
  if(command.length===0)throw new Error("Execution command is empty");
  if(item.handle.state!=="RUNNING")throw new Error(`OCI sandbox is not executable in state ${item.handle.state}`);
  const r=await runDocker(["exec",sandboxId,...command],item.handle.limits.timeoutMs);
  const accepted=r.code===0&&!r.timedOut;return{accepted,exitCode:r.code,stdout:r.stdout,stderr:r.stderr,timedOut:r.timedOut,message:accepted?"Execution completed":"Execution failed"}
 }
 async destroy(sandboxId:string){const item=handles.get(sandboxId);if(!item)return;await runDocker(["rm","-f",sandboxId],30_000).catch(()=>undefined);handles.delete(sandboxId);save()}
}
export const ociContainerRuntime=new OciContainerRuntimeAdapter();
