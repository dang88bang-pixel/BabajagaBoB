import crypto from "node:crypto";
import {observe} from "./observability";
import {recordAudit} from "./audit";

export type ProviderCategory="AGENT_RUNTIME"|"SANDBOX"|"WORKFLOW"|"CODE_AGENT"|"BUILD"|"COMPUTER"|"DEPLOYMENT"|"KNOWLEDGE"|"OTHER";
export type ProviderLifecycle="DISCOVERED"|"EVALUATING"|"AUTHORIZED"|"CONNECTING"|"CONNECTED"|"DEGRADED"|"BLOCKED"|"DISCONNECTED"|"REVOKED";
export type ProviderHealth="UNKNOWN"|"HEALTHY"|"DEGRADED"|"UNHEALTHY";
export type ProviderDefinition={id:string;name:string;category:ProviderCategory;version:string;adapter:string;capabilities:string[];environments:string[];network:"DENY"|"ALLOWLIST"|"INTERNET";lifecycle:ProviderLifecycle;health:ProviderHealth;endpoint?:string;credentialRef?:string;lastHeartbeat?:string;lastError?:string;enabled:boolean;autonomousManagement:boolean;requiresApproval:boolean};
export type ProviderBinding={id:string;providerId:string;scope:"SYSTEM"|"AGENT"|"TASK"|"SANDBOX";scopeId:string;capabilities:string[];createdAt:string;active:boolean};

const catalog:ProviderDefinition[]=[
{id:"prov-openhands",name:"OpenHands",category:"AGENT_RUNTIME",version:"adapter-1",adapter:"openhands",capabilities:["code","terminal","browser","files","agent-actions"],environments:["sandbox","development","experiment"],network:"ALLOWLIST",lifecycle:"DISCOVERED",health:"UNKNOWN",enabled:false,autonomousManagement:true,requiresApproval:true},
{id:"prov-daytona",name:"Daytona",category:"SANDBOX",version:"adapter-1",adapter:"daytona",capabilities:["sandbox","snapshot","restore","filesystem","network-policy"],environments:["development","experiment","test"],network:"ALLOWLIST",lifecycle:"DISCOVERED",health:"UNKNOWN",enabled:false,autonomousManagement:true,requiresApproval:true},
{id:"prov-e2b",name:"E2B",category:"SANDBOX",version:"adapter-1",adapter:"e2b",capabilities:["sandbox","isolated-vm","snapshot","computer"],environments:["experiment","test"],network:"ALLOWLIST",lifecycle:"DISCOVERED",health:"UNKNOWN",enabled:false,autonomousManagement:true,requiresApproval:true},
{id:"prov-temporal",name:"Temporal",category:"WORKFLOW",version:"adapter-1",adapter:"temporal",capabilities:["durable-execution","retry","resume","signals","timers"],environments:["control-plane"],network:"ALLOWLIST",lifecycle:"DISCOVERED",health:"UNKNOWN",enabled:false,autonomousManagement:true,requiresApproval:true},
{id:"prov-langgraph",name:"LangGraph",category:"WORKFLOW",version:"adapter-1",adapter:"langgraph",capabilities:["agent-workflows","durable-state","human-in-loop"],environments:["control-plane","agent"],network:"ALLOWLIST",lifecycle:"DISCOVERED",health:"UNKNOWN",enabled:false,autonomousManagement:true,requiresApproval:true},
{id:"prov-swe-agent",name:"SWE-agent",category:"CODE_AGENT",version:"adapter-1",adapter:"swe-agent",capabilities:["repository","issue-to-patch","tests","code-repair"],environments:["sandbox","development"],network:"ALLOWLIST",lifecycle:"DISCOVERED",health:"UNKNOWN",enabled:false,autonomousManagement:true,requiresApproval:true},
{id:"prov-dagger",name:"Dagger",category:"BUILD",version:"adapter-1",adapter:"dagger",capabilities:["build","test","package","ci"],environments:["sandbox","ci"],network:"ALLOWLIST",lifecycle:"DISCOVERED",health:"UNKNOWN",enabled:false,autonomousManagement:true,requiresApproval:true},
{id:"prov-celesto",name:"Celesto",category:"COMPUTER",version:"adapter-1",adapter:"celesto",capabilities:["browser","desktop","vm","computer-use"],environments:["browser","desktop","test"],network:"ALLOWLIST",lifecycle:"DISCOVERED",health:"UNKNOWN",enabled:false,autonomousManagement:true,requiresApproval:true}
];
const bindings:ProviderBinding[]=[];
const telemetry=new Map<string,{time:string;health:ProviderHealth;latencyMs?:number;message?:string}>();

export function listProviders(){return structuredClone(catalog)}
export function getProvider(id:string){return catalog.find(p=>p.id===id)??null}
export function bindProvider(providerId:string,scope:ProviderBinding["scope"],scopeId:string,capabilities:string[]){
 const p=getProvider(providerId);if(!p)throw new Error("provider not found");
 if(!p.enabled||p.lifecycle!=="CONNECTED")throw new Error("provider is not connected");
 const binding={id:"bind-"+crypto.randomUUID(),providerId,scope,scopeId,capabilities,createdAt:new Date().toISOString(),active:true};
 recordAudit({actor:"agent",action:"provider.bind",resource:providerId,decision:"ALLOW"},{scope,scopeId,capabilities});
 return structuredClone(binding);
}
export function listBindings(){return structuredClone(bindings)}
export function setProviderState(id:string,lifecycle:ProviderLifecycle,health:ProviderHealth,message?:string){
 const p=getProvider(id);if(!p)throw new Error("provider not found");
 p.lifecycle=lifecycle;p.health=health;p.lastHeartbeat=new Date().toISOString();p.lastError=message;
 observe({type:"provider.state",message:message??(p.name+" -> "+lifecycle),status:lifecycle==="CONNECTED"?"COMPLETED":lifecycle==="DEGRADED"?"ERROR":"RUNNING",actor:"provider-manager",resource:id,action:"provider.state",decision:"ALLOW"});
 return structuredClone(p);
}
export function connectProvider(id:string,endpoint?:string,credentialRef?:string){
 const p=getProvider(id);if(!p)throw new Error("provider not found");
 if(p.lifecycle==="REVOKED")throw new Error("provider is revoked");
 p.endpoint=endpoint;p.credentialRef=credentialRef;p.lifecycle="CONNECTED";p.health="HEALTHY";p.enabled=true;p.lastHeartbeat=new Date().toISOString();p.lastError=undefined;
 return setProviderState(id,"CONNECTED","HEALTHY",p.name+" connected through managed adapter");
}
export function disconnectProvider(id:string){
 const p=getProvider(id);if(!p)throw new Error("provider not found");
 p.enabled=false;p.lifecycle="DISCONNECTED";p.health="UNKNOWN";
 for(const b of bindings)if(b.providerId===id)b.active=false;
 return setProviderState(id,"DISCONNECTED","UNKNOWN",p.name+" disconnected");
}
export function revokeProvider(id:string){
 const p=getProvider(id);if(!p)throw new Error("provider not found");
 p.enabled=false;p.lifecycle="REVOKED";p.health="UNKNOWN";
 for(const b of bindings)if(b.providerId===id)b.active=false;
 return setProviderState(id,"REVOKED","UNKNOWN",p.name+" revoked");
}
export function heartbeatProvider(id:string,input:{health:ProviderHealth;latencyMs?:number;message?:string}){
 const p=getProvider(id);if(!p)throw new Error("provider not found");
 p.health=input.health;p.lastHeartbeat=new Date().toISOString();p.lastError=input.message;
 telemetry.set(id,{time:p.lastHeartbeat,health:input.health,latencyMs:input.latencyMs,message:input.message});
 if(input.health==="HEALTHY"&&p.lifecycle!=="REVOKED"&&p.lifecycle!=="DISCONNECTED")p.lifecycle="CONNECTED";
 if(input.health==="DEGRADED"&&p.lifecycle==="CONNECTED")p.lifecycle="DEGRADED";
 if(input.health==="UNHEALTHY"&&p.lifecycle!=="REVOKED"&&p.lifecycle!=="DISCONNECTED")p.lifecycle="BLOCKED";
 observe({type:"provider.heartbeat",message:p.name+" health="+input.health,status:input.health==="HEALTHY"?"RUNNING":"ERROR",actor:"provider-monitor",resource:id,action:"provider.heartbeat",decision:"ALLOW"});
 return structuredClone(p);
}
export function providerSnapshot(){return {providers:listProviders(),bindings:listBindings(),telemetry:Object.fromEntries(telemetry.entries())}}
