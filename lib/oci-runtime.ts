import {spawn} from "node:child_process";
import crypto from "node:crypto";
import type {ResourceLimits,RuntimeHandle} from "./runtime";

export type OciContainerSpec={
  image:string;
  command:string[];
  limits:ResourceLimits;
  network:"DENY"|"ALLOWLIST";
  allowlist?:string[];
  workingDirectory?:string;
};

export type OciExecutionResult={
  accepted:boolean;
  exitCode:number|null;
  stdout:string;
  stderr:string;
  timedOut:boolean;
  message:string;
};

const handles=new Map<string,{handle:RuntimeHandle;image:string}>();
const now=()=>new Date().toISOString();

function assertSafeImage(image:string){
  if(!/^[a-zA-Z0-9][a-zA-Z0-9._\-/:@]+$/.test(image)) throw new Error("Invalid OCI image reference");
}

function runDocker(args:string[],timeoutMs:number):Promise<{code:number|null;stdout:string;stderr:string;timedOut:boolean}>{
  return new Promise((resolve,reject)=>{
    const child=spawn("docker",args,{shell:false,stdio:["ignore","pipe","pipe"]});
    let stdout="",stderr="",timedOut=false;
    child.stdout.on("data",chunk=>{stdout+=String(chunk)});
    child.stderr.on("data",chunk=>{stderr+=String(chunk)});
    const timer=setTimeout(()=>{timedOut=true;child.kill("SIGKILL")},timeoutMs);
    child.once("error",error=>{clearTimeout(timer);reject(error)});
    child.once("close",code=>{clearTimeout(timer);resolve({code,stdout,stderr,timedOut})});
  });
}

export class OciContainerRuntimeAdapter{
  async create(spec:OciContainerSpec):Promise<RuntimeHandle>{
    assertSafeImage(spec.image);
    if(spec.limits.timeoutMs<=0||spec.limits.memoryMb<=0||spec.limits.cpuMillicores<=0||spec.limits.processes<=0) throw new Error("Invalid sandbox resource limits");
    if(spec.network==="ALLOWLIST") throw new Error("OCI ALLOWLIST networking is fail-closed until an egress proxy is configured");

    const sandboxId=`OCI-${cryptoRandomId()}`;
    const args=[
      "create","--name",sandboxId,
      "--network",spec.network==="DENY"?"none":"bridge",
      "--cpus",String(spec.limits.cpuMillicores/1000),
      "--memory",`${spec.limits.memoryMb}m`,
      "--pids-limit",String(spec.limits.processes),
      "--read-only",
      "--cap-drop","ALL",
      "--security-opt","no-new-privileges",
      "--tmpfs","/tmp:rw,noexec,nosuid,size=64m",
      ...(spec.workingDirectory?["--workdir",spec.workingDirectory]:[]),
      spec.image,
      ...spec.command
    ];
    const result=await runDocker(args,Math.min(spec.limits.timeoutMs,30_000));
    if(result.timedOut||result.code!==0) throw new Error(`OCI create failed: ${result.stderr||result.stdout||"unknown error"}`);
    const handle:RuntimeHandle={sandboxId,state:"READY",network:{mode:spec.network,allowlist:spec.allowlist??[]},limits:spec.limits};
    handles.set(sandboxId,{handle,image:spec.image});
    return structuredClone(handle);
  }

  async start(sandboxId:string){
    const item=handles.get(sandboxId);if(!item)throw new Error("OCI sandbox not found");
    const r=await runDocker(["start",sandboxId],Math.min(item.handle.limits.timeoutMs,30_000));
    if(r.timedOut||r.code!==0)throw new Error(`OCI start failed: ${r.stderr||r.stdout||"unknown error"}`);
    item.handle.state="RUNNING";return structuredClone(item.handle);
  }

  async execute(sandboxId:string,command:string[]):Promise<OciExecutionResult>{
    const item=handles.get(sandboxId);if(!item)throw new Error("OCI sandbox not found");
    if(command.length===0)throw new Error("Execution command is empty");
    const r=await runDocker(["exec",sandboxId,...command],item.handle.limits.timeoutMs);
    const accepted=r.code===0&&!r.timedOut;
    return {accepted,exitCode:r.code,stdout:r.stdout,stderr:r.stderr,timedOut:r.timedOut,message:accepted?"Execution completed":"Execution failed"};
  }

  async destroy(sandboxId:string){
    const item=handles.get(sandboxId);if(!item)return;
    await runDocker(["rm","-f",sandboxId],30_000).catch(()=>undefined);
    handles.delete(sandboxId);
  }
}

function cryptoRandomId(){
  return Math.random().toString(36).slice(2,12);
}

export const ociContainerRuntime=new OciContainerRuntimeAdapter();
