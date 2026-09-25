import {createStore} from "./persistence/store";
import {observe} from "./observability";

export type RuntimeKind="CONTAINER"|"VM"|"BROWSER"|"DESKTOP"|"CUSTOM";
export type RuntimeDefinition={
  id:string;
  name:string;
  version:string;
  kind:RuntimeKind;
  platforms:string[];
  architectures:string[];
  buildCommands:string[];
  testCommands:string[];
  debugger?:string;
  packageManager?:string;
  sandboxSupport:boolean;
  networkDefault:"DENY"|"ALLOWLIST";
};

type Payload={runtimes:RuntimeDefinition[]};
const SEED:RuntimeDefinition[]=[
  {id:"runtime.node",name:"Node.js",version:"22",kind:"CONTAINER",platforms:["linux","windows","macos"],architectures:["x64","arm64"],buildCommands:["npm run build"],testCommands:["npm test"],packageManager:"npm",sandboxSupport:true,networkDefault:"DENY"},
  {id:"runtime.python",name:"Python",version:"3.13",kind:"CONTAINER",platforms:["linux","windows","macos"],architectures:["x64","arm64"],buildCommands:[],testCommands:["pytest"],packageManager:"pip",sandboxSupport:true,networkDefault:"DENY"},
  {id:"runtime.container.custom",name:"Custom OCI Runtime",version:"1",kind:"CONTAINER",platforms:["linux"],architectures:["x64","arm64"],buildCommands:[],testCommands:[],sandboxSupport:true,networkDefault:"DENY"}
];
const store=createStore<Payload>("runtime-registry",1,()=>({runtimes:structuredClone(SEED)}));

const text=(value:unknown)=>typeof value==="string"&&value.trim().length>0;
const validArray=(value:unknown)=>Array.isArray(value)&&value.every(item=>typeof item==="string"&&item.trim().length>0);

function validateRuntime(runtime:RuntimeDefinition){
  if(!runtime||typeof runtime!=="object")throw new Error("runtime definition required");
  for(const key of ["id","name","version","kind"] as const) if(!text(runtime[key]))throw new Error("runtime "+key+" required");
  if(!/^[A-Za-z0-9._-]{2,128}$/.test(runtime.id))throw new Error("runtime id has invalid format");
  if(!/^[A-Za-z0-9._+:-]{1,64}$/.test(runtime.version))throw new Error("runtime version has invalid format");
  if(!["CONTAINER","VM","BROWSER","DESKTOP","CUSTOM"].includes(runtime.kind))throw new Error("runtime kind is invalid");
  if(!validArray(runtime.platforms)||runtime.platforms.length===0)throw new Error("runtime platforms required");
  if(!validArray(runtime.architectures)||runtime.architectures.length===0)throw new Error("runtime architectures required");
  if(!validArray(runtime.buildCommands)||!validArray(runtime.testCommands))throw new Error("runtime commands must be string arrays");
  if(runtime.debugger!==undefined&&!text(runtime.debugger))throw new Error("runtime debugger must be non-empty when provided");
  if(runtime.packageManager!==undefined&&!text(runtime.packageManager))throw new Error("runtime packageManager must be non-empty when provided");
  if(typeof runtime.sandboxSupport!=="boolean")throw new Error("runtime sandboxSupport must be boolean");
  if(runtime.networkDefault!=="DENY"&&runtime.networkDefault!=="ALLOWLIST")throw new Error("runtime networkDefault must be DENY or ALLOWLIST");
  if(runtime.networkDefault==="ALLOWLIST")throw new Error("runtime ALLOWLIST requires a controlled egress adapter and is fail-closed");
}

export function listRuntimes(){return structuredClone(store.read().runtimes)}

export function registerRuntime(runtime:RuntimeDefinition){
  validateRuntime(runtime);
  const payload=store.read();
  if(payload.runtimes.some(x=>x.id===runtime.id&&x.version===runtime.version))throw new Error("runtime version already exists");
  const registered=structuredClone(runtime);
  store.update(next=>{next.runtimes.push(registered);});
  observe({type:"runtime.registered",message:"Runtime "+registered.id+"@"+registered.version+" registriert",status:"COMPLETED",actor:"CREATOR",action:"runtime.register",resource:registered.id,argumentsValue:{version:registered.version,kind:registered.kind,platforms:registered.platforms,architectures:registered.architectures}});
  return registered;
}

export function getRuntime(id:string,version?:string){
  const matches=store.read().runtimes.filter(x=>x.id===id);
  if(version!==undefined)return structuredClone(matches.find(x=>x.version===version)??null);
  return structuredClone(matches.at(-1)??null);
}

export function runtimeVersions(id:string){return structuredClone(store.read().runtimes.filter(x=>x.id===id).map(x=>x.version))}

export function runtimeStoreReport(){return store.integrity()}
