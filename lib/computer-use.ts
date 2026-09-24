import type {Risk} from "./types";
export type ComputerUseKind="BROWSER"|"DESKTOP"|"CLI";
export type ComputerUseAction="NAVIGATE"|"CLICK"|"TYPE"|"SELECT"|"SCREENSHOT"|"OCR"|"PROCESS_READ"|"FILE_READ"|"TERMINAL_EXECUTE";
export type ComputerCapability={kind:ComputerUseKind;actions:ComputerUseAction[];environments:string[];network:"DENY"|"ALLOWLIST"|"INTERNET";risk:Risk};
export type ComputerInstance={id:string;name:string;kind:ComputerUseKind;os:string;arch:string;network:"DENY"|"ALLOWLIST"|"INTERNET";capabilities:ComputerCapability[];authorized:boolean;state:"AVAILABLE"|"ALLOCATED"|"EXECUTING"|"PAUSED"|"FAILED"|"RELEASED";sandboxId?:string;taskId?:string};
const instances:ComputerInstance[]=[{
 id:"CMP-LOCAL-BROWSER",name:"Browser Sandbox",kind:"BROWSER",os:"sandbox",arch:"x64",network:"DENY",
 capabilities:[{kind:"BROWSER",actions:["NAVIGATE","CLICK","TYPE","SELECT","SCREENSHOT","OCR"],environments:["browser","test","experiment"],network:"DENY",risk:"MODERATE"}],
 authorized:true,state:"AVAILABLE"
}];
const clone=<T,>(x:T):T=>structuredClone(x);
export function registerComputer(input:Omit<ComputerInstance,"id"|"state">){const x={...input,id:"CMP-"+Date.now(),state:"AVAILABLE" as const};instances.push(x);return clone(x)}
export function allocateComputer(id:string,taskId:string,sandboxId?:string){const x=instances.find(i=>i.id===id);if(!x||!x.authorized)throw new Error("computer is not authorized");if(x.state!=="AVAILABLE")throw new Error("computer is not available");x.state="ALLOCATED";x.taskId=taskId;x.sandboxId=sandboxId;return clone(x)}
export function startComputer(id:string){const x=instances.find(i=>i.id===id);if(!x)throw new Error("computer not found");if(x.state!=="ALLOCATED")throw new Error("computer must be allocated first");x.state="EXECUTING";return clone(x)}
export function releaseComputer(id:string){const x=instances.find(i=>i.id===id);if(!x)throw new Error("computer not found");x.state="RELEASED";x.taskId=undefined;x.sandboxId=undefined;return clone(x)}
export function listComputers(){return clone(instances)}
