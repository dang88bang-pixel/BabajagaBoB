import {sandboxRuntime, type SandboxRuntime, type SandboxSpec, type RuntimeHandle, type RuntimeSnapshot} from "./runtime";
import {ociContainerRuntime} from "./oci-runtime";

class OciSandboxRuntimeAdapter implements SandboxRuntime{
 async create(spec:SandboxSpec):Promise<RuntimeHandle>{
  return ociContainerRuntime.create({image:process.env.BOB_OCI_IMAGE??"alpine:3.20",command:["sleep","infinity"],limits:spec.limits,network:spec.network.mode,allowlist:spec.network.allowlist});
 }
 async start(id:string){return ociContainerRuntime.start(id)}
 async pause(id:string){
  const result=await ociContainerRuntime.execute(id,["kill","-STOP","1"]);
  if(!result.accepted) throw new Error(result.stderr||result.message);
  return {sandboxId:id,state:"PAUSED" as const,network:{mode:"DENY" as const,allowlist:[]},limits:{cpuMillicores:1000,memoryMb:1024,storageMb:4096,timeoutMs:300000,processes:32}};
 }
 async execute(id:string,operation:string){
  const result=await ociContainerRuntime.execute(id,["/bin/sh","-lc",operation]);
  if(!result.accepted) throw new Error(result.stderr||result.message);
  return {accepted:true,message:result.stdout.trim()||result.message};
 }
 async clone(sourceSandboxId:string,target:SandboxSpec):Promise<RuntimeHandle>{void target;throw new Error(`OCI clone is not implemented for ${sourceSandboxId}; create a fresh sandbox instead`)}
 async reset(sandboxId:string):Promise<RuntimeHandle>{throw new Error(`OCI reset is not implemented for ${sandboxId}; destroy and recreate the sandbox`)}
 async snapshot(sandboxId:string):Promise<RuntimeSnapshot>{throw new Error(`OCI snapshot is not implemented for ${sandboxId}; image/volume backend required`)}
 async restore(sandboxId:string,snapshotId:string):Promise<RuntimeHandle>{throw new Error(`OCI restore is not implemented for ${sandboxId} from ${snapshotId}; image/volume backend required`)}
 async destroy(id:string){return ociContainerRuntime.destroy(id)}
}

export const activeSandboxRuntime:SandboxRuntime=process.env.BOB_SANDBOX_RUNTIME==="oci"?new OciSandboxRuntimeAdapter():sandboxRuntime;
export const activeRuntimeMode=process.env.BOB_SANDBOX_RUNTIME==="oci"?"oci":"mock";
