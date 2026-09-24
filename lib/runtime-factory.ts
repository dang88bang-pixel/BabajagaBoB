import {sandboxRuntime, type SandboxRuntime, type SandboxSpec, type RuntimeHandle, type RuntimeSnapshot} from "./runtime";
import {ociContainerRuntime} from "./oci-runtime";

class OciSandboxRuntimeAdapter implements SandboxRuntime{
 async create(spec:SandboxSpec):Promise<RuntimeHandle>{
  return ociContainerRuntime.create({
   image:process.env.BOB_OCI_IMAGE??"alpine:3.20",
   command:["sleep","infinity"],
   limits:spec.limits,
   network:spec.network.mode,
   allowlist:spec.network.allowlist
  });
 }
 async start(id:string){return ociContainerRuntime.start(id)}
 async pause(id:string){return ociContainerRuntime.execute(id,["kill","-STOP","1"]).then(r=>({sandboxId:id,state:"PAUSED" as const,network:{mode:"DENY" as const,allowlist:[]},limits:{cpuMillicores:1000,memoryMb:1024,storageMb:4096,timeoutMs:300000,processes:32}}))}
 async execute(id:string,operation:string){
  const result=await ociContainerRuntime.execute(id,["/bin/sh","-lc",operation]);
  if(!result.accepted) throw new Error(result.stderr||result.message);
  return {accepted:true,message:result.stdout.trim()||result.message};
 }
 async clone(){throw new Error("OCI clone is not implemented; create a fresh sandbox instead")}
 async reset(){throw new Error("OCI reset is not implemented; destroy and recreate the sandbox")}
 async snapshot(){throw new Error("OCI snapshot requires an image/volume backend and is not enabled")}
 async restore(){throw new Error("OCI restore requires an image/volume backend and is not enabled")}
 async destroy(id:string){return ociContainerRuntime.destroy(id)}
}

export const activeSandboxRuntime:SandboxRuntime=process.env.BOB_SANDBOX_RUNTIME==="oci"?new OciSandboxRuntimeAdapter():sandboxRuntime;
export const activeRuntimeMode=process.env.BOB_SANDBOX_RUNTIME==="oci"?"oci":"mock";
