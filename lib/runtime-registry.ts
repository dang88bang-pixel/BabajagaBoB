export type RuntimeKind="CONTAINER"|"VM"|"BROWSER"|"DESKTOP"|"CUSTOM";
export type RuntimeDefinition={id:string;name:string;version:string;kind:RuntimeKind;platforms:string[];architectures:string[];buildCommands:string[];testCommands:string[];debugger?:string;packageManager?:string;sandboxSupport:boolean;networkDefault:"DENY"|"ALLOWLIST"};
const runtimes:RuntimeDefinition[]=[
{id:"runtime.node",name:"Node.js",version:"22",kind:"CONTAINER",platforms:["linux","windows","macos"],architectures:["x64","arm64"],buildCommands:["npm run build"],testCommands:["npm test"],packageManager:"npm",sandboxSupport:true,networkDefault:"DENY"},
{id:"runtime.python",name:"Python",version:"3.13",kind:"CONTAINER",platforms:["linux","windows","macos"],architectures:["x64","arm64"],buildCommands:[],testCommands:["pytest"],packageManager:"pip",sandboxSupport:true,networkDefault:"DENY"},
{id:"runtime.container.custom",name:"Custom OCI Runtime",version:"1",kind:"CONTAINER",platforms:["linux"],architectures:["x64","arm64"],buildCommands:[],testCommands:[],sandboxSupport:true,networkDefault:"DENY"}
];
export function listRuntimes(){return structuredClone(runtimes)}
export function registerRuntime(runtime:RuntimeDefinition){if(runtimes.some(x=>x.id===runtime.id))throw new Error("runtime already exists");runtimes.push(runtime);return structuredClone(runtime)}
export function getRuntime(id:string){const r=runtimes.find(x=>x.id===id);return r?structuredClone(r):null}
