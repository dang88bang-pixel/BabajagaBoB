import type {Risk} from "./types";
export type ToolDefinition={id:string;version:string;name:string;description:string;inputSchema:Record<string,unknown>;capabilities:string[];allowedEnvironments:string[];risk:Risk;timeoutMs:number;resourceLimits:{cpuMillicores:number;memoryMb:number};network:"DENY"|"ALLOWLIST"|"INTERNET";sideEffects:string[];reversible:boolean;approvalRequired:boolean};
const tools=new Map<string,ToolDefinition>();
export function registerTool(tool:ToolDefinition){
  // Ein Werkzeug ohne Identität/Version oder ohne Umgebungen wäre nicht
  // ausführbar und würde `toolCanRun` immer verneinen.
  if(!tool||typeof tool!=="object")throw new Error("tool definition required");
  const text=(v:unknown)=>typeof v==="string"&&v.trim().length>0;
  for(const key of ["id","version","name","description"] as const){
    if(!text(tool[key]))throw new Error(`tool ${key} required`);
  }
  if(!Array.isArray(tool.capabilities))throw new Error("tool capabilities required");
  if(!Array.isArray(tool.allowedEnvironments))throw new Error("tool allowedEnvironments required");
  const key=`${tool.id}@${tool.version}`;if(tools.has(key))throw new Error("tool version already registered");
  tools.set(key,structuredClone(tool));return structuredClone(tool);
}
export function listTools(){return [...tools.values()].map(x=>structuredClone(x))}
export function getTool(id:string,version?:string){const candidates=[...tools.values()].filter(t=>t.id===id);if(version)return candidates.find(t=>t.version===version);return candidates.sort((a,b)=>b.version.localeCompare(a.version))[0]}
export function toolCanRun(tool:ToolDefinition,environment:string,capabilities:string[]){return tool.allowedEnvironments.includes(environment)&&tool.capabilities.every(c=>capabilities.includes(c))}
registerTool({id:"tool.runtime.snapshot",version:"1.0.0",name:"Sandbox Snapshot",description:"Create a recoverable sandbox snapshot",inputSchema:{sandboxId:{type:"string"}},capabilities:["sandbox.snapshot"],allowedEnvironments:["development","experiment","test","recovery"],risk:"LOW",timeoutMs:30000,resourceLimits:{cpuMillicores:500,memoryMb:256},network:"DENY",sideEffects:["snapshot"],reversible:true,approvalRequired:false});
