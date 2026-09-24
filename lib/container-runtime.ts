import type {ResourceLimits,SandboxSpec,RuntimeHandle} from "./runtime";
import {sandboxRuntime} from "./runtime";

export type ContainerLaunchSpec={image:string;command:string[];limits:ResourceLimits;network:"DENY"|"ALLOWLIST";allowlist?:string[]};

export interface ContainerRuntimeAdapter{
 create(spec:ContainerLaunchSpec):Promise<RuntimeHandle>;
 execute(sandboxId:string,command:string[],timeoutMs:number):Promise<{accepted:boolean;message:string;timedOut?:boolean}>;
 destroy(sandboxId:string):Promise<void>;
}

export class IsolatedContainerRuntimeAdapter implements ContainerRuntimeAdapter{
 async create(spec:ContainerLaunchSpec){
  const id=`CTR-${Date.now()}`;
  return sandboxRuntime.create({id,type:"container",network:{mode:spec.network,allowlist:spec.allowlist??[]},limits:spec.limits,risk:"LOW"});
 }
 async execute(sandboxId:string,command:string[],timeoutMs:number){
  if(timeoutMs<=0)return {accepted:false,message:"timeout must be positive",timedOut:true};
  const operation=command.join(" ");
  const result=await sandboxRuntime.execute(sandboxId,command);
  return {...result,timedOut:false};
 }
 async destroy(sandboxId:string){return sandboxRuntime.destroy(sandboxId)}
}
export const containerRuntime=new IsolatedContainerRuntimeAdapter();
