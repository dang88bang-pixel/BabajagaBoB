import {createStore} from "./persistence/store";
import {observe} from "./observability";
export type DeviceTrust="LOCAL_TRUSTED"|"MANAGED"|"EPHEMERAL"|"EXPERIMENTAL"|"RESTRICTED"|"OBSERVATION_ONLY";
export type DeviceNetwork="INTERNET"|"LAN"|"VPN"|"NONE"|"ALLOWLIST";
export type DeviceState="UNKNOWN"|"DISCOVERED"|"IDENTIFIED"|"TRUSTED"|"AUTHORIZED"|"AVAILABLE"|"ALLOCATED"|"EXECUTING"|"RESULT"|"RELEASED";
export type Device={id:string;name:string;os:string;arch:string;cpu:number;ramMb:number;gpu?:string;network:DeviceNetwork;trust:DeviceTrust;state:DeviceState;capabilities:string[];authorized:boolean;currentTaskId?:string;lastSeen:string};
type Payload={devices:Device[]};
const store=createStore<Payload>("devices",1,()=>({devices:[
 {id:"DEV-LOCAL",name:"Control Host",os:"linux",arch:"x64",cpu:8,ramMb:16384,gpu:"none",network:"NONE",trust:"LOCAL_TRUSTED",state:"AVAILABLE",capabilities:["node","python","container"],authorized:true,lastSeen:new Date().toISOString()}
]}));
const devices:Device[]=store.read().devices;
const persist=()=>store.write({devices});
const clone=<T,>(v:T):T=>structuredClone(v);
export function listDevices(){return clone(devices)}
export function discoverDevice(device:Omit<Device,"authorized"|"state">){const existing=devices.find(d=>d.id===device.id);if(existing)return clone(existing);const d={...device,authorized:false,state:"DISCOVERED" as const};devices.push(d);persist();observe({type:"device.discovered",message:`Gerät ${d.id} entdeckt (Discovery ≠ Autorisierung)`,status:"WAITING",actor:"AG-INT",agentId:"AG-INT",action:"device.discover",resource:d.id,argumentsValue:{os:d.os,capabilities:d.capabilities}});return clone(d)}
export function authorizeDevice(id:string,authorized=true,actor="CREATOR"){const d=devices.find(x=>x.id===id);if(!d)throw new Error("device not found");if(actor!=="CREATOR")throw new Error("device authorization requires Creator authority");if(d.state==="UNKNOWN"||d.state==="DISCOVERED"||d.state==="IDENTIFIED")d.state=authorized?"AUTHORIZED":"RELEASED";d.authorized=authorized;persist();observe({type:authorized?"device.authorized":"device.revoked",message:`Gerät ${id}: ${authorized?"autorisiert":"widerrufen"}`,status:authorized?"COMPLETED":"BLOCKED",actor,action:"device.authorize",resource:id,decision:authorized?"ALLOW":"DENY"});return clone(d)}
export function allocateDevice(id:string,taskId:string){const d=devices.find(x=>x.id===id);if(!d)throw new Error("device not found");if(!d.authorized||!["AUTHORIZED","AVAILABLE"].includes(d.state))throw new Error("device is not authorized/available");d.state="ALLOCATED";d.currentTaskId=taskId;persist();observe({type:"device.allocated",message:`Gerät ${id} an ${taskId} gebunden`,status:"RUNNING",actor:"AG-OPS",agentId:"AG-OPS",taskId,action:"device.allocate",resource:id});return clone(d)}
export function releaseDevice(id:string){const d=devices.find(x=>x.id===id);if(!d)throw new Error("device not found");d.state="RELEASED";delete d.currentTaskId;persist();observe({type:"device.released",message:`Gerät ${id} freigegeben`,status:"COMPLETED",actor:"AG-OPS",agentId:"AG-OPS",action:"device.release",resource:id});return clone(d)}
export function deviceSummary(){return {total:devices.length,authorized:devices.filter(d=>d.authorized).length,allocated:devices.filter(d=>d.state==="ALLOCATED").length}}
export function deviceStoreReport(){return store.integrity()}
