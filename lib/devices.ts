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
export function discoverDevice(device:Omit<Device,"authorized"|"state">){
  // Ein Gerät ohne Identität ist nicht adressierbar: es kann nie autorisiert,
  // zugeteilt oder freigegeben werden und erscheint als Phantom in der Flotte.
  // Discovery darf keinen solchen Datensatz erzeugen (Discovery ≠ Autorisierung,
  // aber Discovery heißt auch: das Gerät ist ansprechbar).
  if(!device||typeof device!=="object")throw new Error("device required");
  const text=(v:unknown)=>typeof v==="string"&&v.trim().length>0;
  if(!text(device.id))throw new Error("device id required");
  if(!text(device.name))throw new Error("device name required");
  if(!text(device.os))throw new Error("device os required");
  const existing=devices.find(d=>d.id===device.id);if(existing)return clone(existing);const d={...device,authorized:false,state:"DISCOVERED" as const};devices.push(d);persist();observe({type:"device.discovered",message:`Gerät ${d.id} entdeckt (Discovery ≠ Autorisierung)`,status:"WAITING",actor:"AG-INT",agentId:"AG-INT",action:"device.discover",resource:d.id,argumentsValue:{os:d.os,capabilities:d.capabilities}});return clone(d)}
export function authorizeDevice(id:string,authorized=true,actor="CREATOR"){const d=devices.find(x=>x.id===id);if(!d)throw new Error("device not found");if(actor!=="CREATOR")throw new Error("device authorization requires Creator authority");if(d.state==="UNKNOWN"||d.state==="DISCOVERED"||d.state==="IDENTIFIED")d.state=authorized?"AUTHORIZED":"RELEASED";d.authorized=authorized;persist();observe({type:authorized?"device.authorized":"device.revoked",message:`Gerät ${id}: ${authorized?"autorisiert":"widerrufen"}`,status:authorized?"COMPLETED":"BLOCKED",actor,action:"device.authorize",resource:id,decision:authorized?"ALLOW":"DENY"});return clone(d)}
export function allocateDevice(id:string,taskId:string){const d=devices.find(x=>x.id===id);if(!d)throw new Error("device not found");if(!d.authorized||!["AUTHORIZED","AVAILABLE"].includes(d.state))throw new Error("device is not authorized/available");d.state="ALLOCATED";d.currentTaskId=taskId;persist();observe({type:"device.allocated",message:`Gerät ${id} an ${taskId} gebunden`,status:"RUNNING",actor:"AG-OPS",agentId:"AG-OPS",taskId,action:"device.allocate",resource:id});return clone(d)}

/** Wählt deterministisch das am besten geeignete autorisierte, verfügbare Gerät. */
export function scheduleDevice(taskId:string,requirements:{cpu?:number;ramMb?:number;gpu?:string;os?:string;arch?:string;capabilities?:string[];network?:DeviceNetwork}={}){
 if(typeof taskId!=="string"||taskId.trim().length===0)throw new Error("taskId required");
 const cpu=Math.max(1,Number(requirements.cpu??1)); const ramMb=Math.max(1,Number(requirements.ramMb??1));
 const requiredCaps=(requirements.capabilities??[]).map(String).filter(Boolean);
 const candidates=devices.filter(d=>d.authorized&&["AUTHORIZED","AVAILABLE"].includes(d.state)&&d.cpu>=cpu&&d.ramMb>=ramMb&&(requirements.gpu===undefined||requirements.gpu==="none"||d.gpu===requirements.gpu)&&(requirements.os===undefined||d.os===requirements.os)&&(requirements.arch===undefined||d.arch===requirements.arch)&&(requirements.network===undefined||d.network===requirements.network)&&requiredCaps.every(c=>d.capabilities.includes(c)));
 if(candidates.length===0)throw new Error("no authorized device satisfies requirements");
 const score=(d:Device)=>{const cpuSlack=d.cpu-cpu;const ramSlack=d.ramMb-ramMb;const load=d.state==="AVAILABLE"?0:1;return load*1_000_000+cpuSlack*1000+ramSlack;};
 candidates.sort((a,b)=>score(a)-score(b)||a.id.localeCompare(b.id));
 return allocateDevice(candidates[0].id,taskId);
}
export function releaseDevice(id:string){const d=devices.find(x=>x.id===id);if(!d)throw new Error("device not found");d.state="RELEASED";delete d.currentTaskId;persist();observe({type:"device.released",message:`Gerät ${id} freigegeben`,status:"COMPLETED",actor:"AG-OPS",agentId:"AG-OPS",action:"device.release",resource:id});return clone(d)}
/**
 * Lebenszeichen eines gemeldeten Geräts.
 *
 * Setzt ausschließlich `lastSeen` (und bei Bedarf die gemeldeten Fähigkeiten).
 * **Nicht** änderbar sind hier `authorized`, `state` und `currentTaskId` — ein
 * Heartbeat darf keine Autorisierung erzeugen oder verändern (Discovery ≠
 * Autorisierung).
 */
export function heartbeatDevice(id:string,reported?:{capabilities?:string[];network?:DeviceNetwork}){
  const d=devices.find(x=>x.id===id);if(!d)throw new Error("device not found");
  d.lastSeen=new Date().toISOString();
  if(reported?.capabilities&&Array.isArray(reported.capabilities))d.capabilities=reported.capabilities.slice(0,32).map(String);
  if(reported?.network&&["INTERNET","LAN","VPN","NONE","ALLOWLIST"].includes(reported.network))d.network=reported.network;
  persist();
  observe({type:"device.heartbeat",message:`Gerät ${id} meldet sich (nicht autorisiert: ${!d.authorized})`,status:"COMPLETED",actor:"AGENT-ENROLLMENT",agentId:"AGENT-ENROLLMENT",action:"device.heartbeat",resource:id});
  return clone(d);
}

export function deviceSummary(){return {total:devices.length,authorized:devices.filter(d=>d.authorized).length,allocated:devices.filter(d=>d.state==="ALLOCATED").length}}
export function deviceStoreReport(){return store.integrity()}
