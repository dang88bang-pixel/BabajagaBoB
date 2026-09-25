import {createStore} from "./persistence/store";
import {observe} from "./observability";
import type {Risk} from "./types";
export type ComputerUseKind="BROWSER"|"DESKTOP"|"CLI";
export type ComputerUseAction="NAVIGATE"|"CLICK"|"TYPE"|"SELECT"|"SCREENSHOT"|"OCR"|"PROCESS_READ"|"FILE_READ"|"TERMINAL_EXECUTE";
export type ComputerCapability={kind:ComputerUseKind;actions:ComputerUseAction[];environments:string[];network:"DENY"|"ALLOWLIST"|"INTERNET";risk:Risk};
export type ComputerInstance={id:string;name:string;kind:ComputerUseKind;os:string;arch:string;network:"DENY"|"ALLOWLIST"|"INTERNET";capabilities:ComputerCapability[];authorized:boolean;state:"AVAILABLE"|"ALLOCATED"|"EXECUTING"|"PAUSED"|"FAILED"|"RELEASED";sandboxId?:string;taskId?:string};
type Payload={instances:ComputerInstance[]};
const store=createStore<Payload>("computer-use",1,()=>({instances:[{
 id:"CMP-LOCAL-BROWSER",name:"Browser Sandbox",kind:"BROWSER",os:"sandbox",arch:"x64",network:"DENY",
 capabilities:[{kind:"BROWSER",actions:["NAVIGATE","CLICK","TYPE","SELECT","SCREENSHOT","OCR"],environments:["browser","test","experiment"],network:"DENY",risk:"MODERATE"}],
 authorized:false,state:"AVAILABLE"
}]}));
const instances:ComputerInstance[]=store.read().instances;
const persist=()=>store.write({instances});
const clone=<T,>(x:T):T=>structuredClone(x);
export function registerComputer(input:Omit<ComputerInstance,"id"|"state">){const x={...input,id:"CMP-"+Date.now(),state:"AVAILABLE" as const};instances.push(x);persist();observe({type:"computer.registered",message:`Computer ${x.id} registriert`,status:"COMPLETED",actor:"CREATOR",action:"computer.register",resource:x.id});return clone(x)}
export function allocateComputer(id:string,taskId:string,sandboxId?:string){const x=instances.find(i=>i.id===id);if(!x||!x.authorized)throw new Error("computer is not authorized");if(x.state!=="AVAILABLE")throw new Error("computer is not available");x.state="ALLOCATED";x.taskId=taskId;x.sandboxId=sandboxId;persist();observe({type:"computer.allocated",message:`Computer ${id} an ${taskId} gebunden`,status:"RUNNING",actor:"AG-BROWSER",agentId:"AG-BROWSER",taskId,sandboxId,action:"computer.allocate",resource:id});return clone(x)}
export function startComputer(id:string){const x=instances.find(i=>i.id===id);if(!x)throw new Error("computer not found");if(x.state!=="ALLOCATED")throw new Error("computer must be allocated first");x.state="EXECUTING";persist();observe({type:"computer.executing",message:`Computer ${id} führt aus`,status:"EXECUTING",actor:"AG-BROWSER",agentId:"AG-BROWSER",taskId:x.taskId,sandboxId:x.sandboxId,action:"computer.start",resource:id});return clone(x)}
export function authorizeComputer(id:string,authorized=true,actor="CREATOR"){const x=instances.find(i=>i.id===id);if(!x)throw new Error("computer not found");x.authorized=authorized;persist();observe({type:"computer.authorized",message:`Computer ${id} ${authorized?"autorisiert":"Autorisierung entzogen"}`,status:"COMPLETED",actor,action:"computer.authorize",resource:id,decision:authorized?"ALLOW":"DENY",argumentsValue:{authorized}});return clone(x)}
export function releaseComputer(id:string){const x=instances.find(i=>i.id===id);if(!x)throw new Error("computer not found");x.state="RELEASED";x.taskId=undefined;x.sandboxId=undefined;persist();return clone(x)}
export function computerUseStoreReport(){return store.integrity()}
export function listComputers(){return clone(instances)}
