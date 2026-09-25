export type RuntimeKind="CONTAINER"|"VM"|"BROWSER"|"DESKTOP"|"CUSTOM";
export type RuntimeDefinition={id:string;name:string;version:string;kind:RuntimeKind;platforms:string[];architectures:string[];buildCommands:string[];testCommands:string[];debugger?:string;packageManager?:string;sandboxSupport:boolean;networkDefault:"DENY"|"ALLOWLIST"};
const runtimes:RuntimeDefinition[]=[
{id:"runtime.node",name:"Node.js",version:"22",kind:"CONTAINER",platforms:["linux","windows","macos"],architectures:["x64","arm64"],buildCommands:["npm run build"],testCommands:["npm test"],packageManager:"npm",sandboxSupport:true,networkDefault:"DENY"},
{id:"runtime.python",name:"Python",version:"3.13",kind:"CONTAINER",platforms:["linux","windows","macos"],architectures:["x64","arm64"],buildCommands:[],testCommands:["pytest"],packageManager:"pip",sandboxSupport:true,networkDefault:"DENY"},
{id:"runtime.container.custom",name:"Custom OCI Runtime",version:"1",kind:"CONTAINER",platforms:["linux"],architectures:["x64","arm64"],buildCommands:[],testCommands:[],sandboxSupport:true,networkDefault:"DENY"}
];
export function listRuntimes(){return structuredClone(runtimes)}
export function registerRuntime(runtime:RuntimeDefinition){
  // Eine Laufzeit ohne Identität/Name/Version/Art ist nicht benutzbar; früher
  // konnte hier der **gesamte Request-Body** (`{action:"register",…}`) landen.
  if(!runtime||typeof runtime!=="object")throw new Error("runtime definition required");
  const text=(v:unknown)=>typeof v==="string"&&v.trim().length>0;
  for(const key of ["id","name","version","kind"] as const){
    if(!text(runtime[key]))throw new Error(`runtime ${key} required`);
  }
  if(!Array.isArray(runtime.platforms))throw new Error("runtime platforms required");
  if(!Array.isArray(runtime.architectures))throw new Error("runtime architectures required");
  if(runtime.networkDefault!=="DENY"&&runtime.networkDefault!=="ALLOWLIST")throw new Error("runtime networkDefault must be DENY or ALLOWLIST");
  if(runtimes.some(x=>x.id===runtime.id))throw new Error("runtime already exists");
  runtimes.push(runtime);return structuredClone(runtime);
}
export function getRuntime(id:string){const r=runtimes.find(x=>x.id===id);return r?structuredClone(r):null}
