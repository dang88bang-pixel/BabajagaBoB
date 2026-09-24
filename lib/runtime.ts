import type {Risk} from "./types";
export type SandboxRuntimeState="CREATED"|"READY"|"RUNNING"|"PAUSED"|"SNAPSHOTTED"|"RESTORED"|"DESTROYED"|"FAILED";
export type NetworkPolicy={mode:"DENY"|"ALLOWLIST";allowlist:string[]};
export type ResourceLimits={cpuMillicores:number;memoryMb:number;storageMb:number;timeoutMs:number;processes:number};
export type SandboxSpec={id:string;type:string;network:NetworkPolicy;limits:ResourceLimits;risk:Risk};
export type RuntimeSnapshot={id:string;sandboxId:string;createdAt:string;state:SandboxRuntimeState;digest:string};
export type RuntimeHandle={sandboxId:string;state:SandboxRuntimeState;network:NetworkPolicy;limits:ResourceLimits};
export interface SandboxRuntime{start(sandboxId:string):Promise<RuntimeHandle>;pause(sandboxId:string):Promise<RuntimeHandle>;create(spec:SandboxSpec):Promise<RuntimeHandle>;clone(sourceSandboxId:string,target:SandboxSpec):Promise<RuntimeHandle>;reset(sandboxId:string):Promise<RuntimeHandle>;snapshot(sandboxId:string):Promise<RuntimeSnapshot>;restore(sandboxId:string,snapshotId:string):Promise<RuntimeHandle>;destroy(sandboxId:string):Promise<void>;execute(sandboxId:string,operation:string):Promise<{accepted:boolean;message:string}>}
const handles=new Map<string,RuntimeHandle>(), snapshots=new Map<string,RuntimeSnapshot>();
const digest=(value:unknown)=>Buffer.from(JSON.stringify(value)).toString("base64url");
export class MockSandboxRuntime implements SandboxRuntime{
 async create(spec:SandboxSpec){const h={sandboxId:spec.id,state:"READY" as const,network:spec.network,limits:spec.limits};handles.set(spec.id,h);return structuredClone(h)}
 async clone(sourceSandboxId:string,target:SandboxSpec){if(!handles.has(sourceSandboxId))throw new Error("source sandbox not found");return this.create(target)}
 async reset(sandboxId:string){const h=handles.get(sandboxId);if(!h)throw new Error("sandbox not found");h.state="READY";return structuredClone(h)}
 async snapshot(sandboxId:string){const h=handles.get(sandboxId);if(!h)throw new Error("sandbox not found");const id=`SNP-${Date.now()}`;const s={id,sandboxId,createdAt:new Date().toISOString(),state:"SNAPSHOTTED" as const,digest:digest(h)};snapshots.set(id,s);h.state="SNAPSHOTTED";return structuredClone(s)}
 async restore(sandboxId:string,snapshotId:string){const h=handles.get(sandboxId),s=snapshots.get(snapshotId);if(!h||!s||s.sandboxId!==sandboxId)throw new Error("snapshot not found");h.state="RESTORED";return structuredClone(h)}
 async destroy(sandboxId:string){handles.delete(sandboxId)}
 async start(sandboxId:string){const h=handles.get(sandboxId);if(!h)throw new Error("sandbox not found");h.state="RUNNING";return structuredClone(h)}
 async pause(sandboxId:string){const h=handles.get(sandboxId);if(!h)throw new Error("sandbox not found");h.state="PAUSED";return structuredClone(h)}
 async execute(sandboxId:string,operation:string){const h=handles.get(sandboxId);if(!h)throw new Error("sandbox not found");if(h.network.mode==="DENY"&&/^(curl|wget|nc|ssh|scp|ftp)\b/i.test(operation.trim()))return {accepted:false,message:"Network operation rejected by sandbox policy"};h.state="RUNNING";return {accepted:true,message:"Operation accepted by runtime adapter; no host shell is exposed by this adapter"}}
}
export const sandboxRuntime=new MockSandboxRuntime();
