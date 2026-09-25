import crypto from "node:crypto";
import {observe} from "./observability";
import {recordAudit} from "./audit";
import {approvalGranted} from "./approvals";
import {assertNoProtectedDataForThirdParty,type ProtectedDataClass} from "./data-boundary";
import {loadFabric,saveFabric} from "./fabric-store";

export type ProviderCategory="AGENT_RUNTIME"|"SANDBOX"|"WORKFLOW"|"CODE_AGENT"|"BUILD"|"COMPUTER"|"DEPLOYMENT"|"KNOWLEDGE"|"OTHER";
export type ProviderLifecycle="DISCOVERED"|"EVALUATING"|"AUTHORIZED"|"CONNECTING"|"CONNECTED"|"DEGRADED"|"BLOCKED"|"DISCONNECTED"|"REVOKED";
export type ProviderHealth="UNKNOWN"|"HEALTHY"|"DEGRADED"|"UNHEALTHY";
export type ProviderDefinition={id:string;name:string;category:ProviderCategory;version:string;adapter:string;capabilities:string[];environments:string[];network:"DENY"|"ALLOWLIST"|"INTERNET";lifecycle:ProviderLifecycle;health:ProviderHealth;endpoint?:string;credentialRef?:string;lastHeartbeat?:string;lastError?:string;enabled:boolean;autonomousManagement:boolean;requiresApproval:boolean;dataPolicy:"METADATA_ONLY"};
export type ProviderBinding={id:string;providerId:string;scope:"SYSTEM"|"AGENT"|"TASK"|"SANDBOX";scopeId:string;capabilities:string[];createdAt:string;active:boolean};
type ProviderStore={providers:ProviderDefinition[];bindings:ProviderBinding[];telemetry:Record<string,{time:string;health:ProviderHealth;latencyMs?:number;message?:string}>};

const catalog:ProviderDefinition[]=[
{id:"prov-openhands",name:"OpenHands",category:"AGENT_RUNTIME",version:"adapter-1",adapter:"openhands",capabilities:["code","terminal","browser","files","agent-actions"],environments:["sandbox","development","experiment"],network:"ALLOWLIST",lifecycle:"DISCOVERED",health:"UNKNOWN",enabled:false,autonomousManagement:true,requiresApproval:true,dataPolicy:"METADATA_ONLY"},
{id:"prov-daytona",name:"Daytona",category:"SANDBOX",version:"adapter-1",adapter:"daytona",capabilities:["sandbox","snapshot","restore","filesystem","network-policy"],environments:["development","experiment","test"],network:"ALLOWLIST",lifecycle:"DISCOVERED",health:"UNKNOWN",enabled:false,autonomousManagement:true,requiresApproval:true,dataPolicy:"METADATA_ONLY"},
{id:"prov-e2b",name:"E2B",category:"SANDBOX",version:"adapter-1",adapter:"e2b",capabilities:["sandbox","isolated-vm","snapshot","computer"],environments:["experiment","test"],network:"ALLOWLIST",lifecycle:"DISCOVERED",health:"UNKNOWN",enabled:false,autonomousManagement:true,requiresApproval:true,dataPolicy:"METADATA_ONLY"},
{id:"prov-temporal",name:"Temporal",category:"WORKFLOW",version:"adapter-1",adapter:"temporal",capabilities:["durable-execution","retry","resume","signals","timers"],environments:["control-plane"],network:"ALLOWLIST",lifecycle:"DISCOVERED",health:"UNKNOWN",enabled:false,autonomousManagement:true,requiresApproval:true,dataPolicy:"METADATA_ONLY"},
{id:"prov-langgraph",name:"LangGraph",category:"WORKFLOW",version:"adapter-1",adapter:"langgraph",capabilities:["agent-workflows","durable-state","human-in-loop"],environments:["control-plane","agent"],network:"ALLOWLIST",lifecycle:"DISCOVERED",health:"UNKNOWN",enabled:false,autonomousManagement:true,requiresApproval:true,dataPolicy:"METADATA_ONLY"},
{id:"prov-swe-agent",name:"SWE-agent",category:"CODE_AGENT",version:"adapter-1",adapter:"swe-agent",capabilities:["repository","issue-to-patch","tests","code-repair"],environments:["sandbox","development"],network:"ALLOWLIST",lifecycle:"DISCOVERED",health:"UNKNOWN",enabled:false,autonomousManagement:true,requiresApproval:true,dataPolicy:"METADATA_ONLY"},
{id:"prov-dagger",name:"Dagger",category:"BUILD",version:"adapter-1",adapter:"dagger",capabilities:["build","test","package","ci"],environments:["sandbox","ci"],network:"ALLOWLIST",lifecycle:"DISCOVERED",health:"UNKNOWN",enabled:false,autonomousManagement:true,requiresApproval:true,dataPolicy:"METADATA_ONLY"},
{id:"prov-celesto",name:"Celesto",category:"COMPUTER",version:"adapter-1",adapter:"celesto",capabilities:["browser","desktop","vm","computer-use"],environments:["browser","desktop","test"],network:"ALLOWLIST",lifecycle:"DISCOVERED",health:"UNKNOWN",enabled:false,autonomousManagement:true,requiresApproval:true,dataPolicy:"METADATA_ONLY"}
];

const initial:ProviderStore={providers:catalog,bindings:[],telemetry:{}};
let store=loadFabric<ProviderStore>("providers",initial);
const persist=()=>saveFabric("providers",store);
const clone=<T,>(v:T):T=>structuredClone(v);

export function assertProviderPayloadAllowed(providerId:string,dataClass:ProtectedDataClass){
 const p=getProvider(providerId);if(!p)throw new Error("provider not found");
 if(p.dataPolicy==="METADATA_ONLY")assertNoProtectedDataForThirdParty(dataClass);
 return true;
}
export function listProviders(){return clone(store.providers)}
export function getProvider(id:string){return store.providers.find(p=>p.id===id)??null}
export function bindProvider(providerId:string,scope:ProviderBinding["scope"],scopeId:string,capabilities:string[]){
 const p=getProvider(providerId);if(!p)throw new Error("provider not found");
 if(!p.enabled||p.lifecycle!=="CONNECTED")throw new Error("provider is not connected");
 if(!scopeId||capabilities.length===0)throw new Error("provider binding scope and capabilities are required");
 if(capabilities.some(c=>!p.capabilities.includes(c)))throw new Error("provider binding requests unsupported capability");
 const binding={id:"bind-"+crypto.randomUUID(),providerId,scope,scopeId,capabilities,createdAt:new Date().toISOString(),active:true};
 store.bindings.push(binding);persist();
 recordAudit({actor:"agent",action:"provider.bind",resource:providerId,decision:"ALLOW"},{scope,scopeId,capabilities});
 return clone(binding);
}
export function listBindings(){return clone(store.bindings)}
export function setProviderState(id:string,lifecycle:ProviderLifecycle,health:ProviderHealth,message?:string){
 const p=getProvider(id);if(!p)throw new Error("provider not found");
 p.lifecycle=lifecycle;p.health=health;p.lastHeartbeat=new Date().toISOString();p.lastError=message;persist();
 observe({type:"provider.state",message:message??(p.name+" -> "+lifecycle),status:lifecycle==="CONNECTED"?"COMPLETED":lifecycle==="DEGRADED"?"ERROR":"RUNNING",actor:"provider-manager",resource:id,action:"provider.state",decision:"ALLOW"});
 return clone(p);
}
export function connectProvider(id:string,endpoint?:string,credentialRef?:string,approvalId?:string){
 const p=getProvider(id);if(!p)throw new Error("provider not found");
 if(p.lifecycle==="REVOKED")throw new Error("provider is revoked");
 if(p.requiresApproval&&!approvalId)throw new Error("third-party provider connection requires explicit approval");
 if(p.requiresApproval&&approvalId&&!approvalGranted(approvalId))throw new Error("provider connection approval is not granted");
 if(endpoint&&endpoint.length>2048)throw new Error("endpoint too long");
 p.endpoint=endpoint;p.credentialRef=credentialRef;p.lifecycle="CONNECTED";p.health="HEALTHY";p.enabled=true;p.lastHeartbeat=new Date().toISOString();p.lastError=undefined;persist();
 return setProviderState(id,"CONNECTED","HEALTHY",p.name+" connected through managed adapter");
}
export function disconnectProvider(id:string){
 const p=getProvider(id);if(!p)throw new Error("provider not found");
 p.enabled=false;p.lifecycle="DISCONNECTED";p.health="UNKNOWN";for(const b of store.bindings)if(b.providerId===id)b.active=false;persist();
 return setProviderState(id,"DISCONNECTED","UNKNOWN",p.name+" disconnected");
}
export function revokeProvider(id:string){
 const p=getProvider(id);if(!p)throw new Error("provider not found");
 p.enabled=false;p.lifecycle="REVOKED";p.health="UNKNOWN";for(const b of store.bindings)if(b.providerId===id)b.active=false;persist();
 return setProviderState(id,"REVOKED","UNKNOWN",p.name+" revoked");
}
export function heartbeatProvider(id:string,input:{health:ProviderHealth;latencyMs?:number;message?:string}){
 const p=getProvider(id);if(!p)throw new Error("provider not found");
 if(input.latencyMs!==undefined&&(!Number.isFinite(input.latencyMs)||input.latencyMs<0))throw new Error("invalid latencyMs");
 p.health=input.health;p.lastHeartbeat=new Date().toISOString();p.lastError=input.message;
 store.telemetry[id]={time:p.lastHeartbeat,health:input.health,latencyMs:input.latencyMs,message:input.message};
 if(input.health==="HEALTHY"&&p.lifecycle!=="REVOKED"&&p.lifecycle!=="DISCONNECTED")p.lifecycle="CONNECTED";
 if(input.health==="DEGRADED"&&p.lifecycle==="CONNECTED")p.lifecycle="DEGRADED";
 if(input.health==="UNHEALTHY"&&p.lifecycle!=="REVOKED"&&p.lifecycle!=="DISCONNECTED")p.lifecycle="BLOCKED";
 persist();
 observe({type:"provider.heartbeat",message:p.name+" health="+input.health,status:input.health==="HEALTHY"?"RUNNING":"ERROR",actor:"provider-monitor",resource:id,action:"provider.heartbeat",decision:"ALLOW"});
 return clone(p);
}
export function providerSnapshot(){return {providers:listProviders(),bindings:listBindings(),telemetry:clone(store.telemetry)}}
