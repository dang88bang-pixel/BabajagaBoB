import type {Agent,Status} from "./types";
export type AgentKind="SUPERVISOR"|"PLANNER"|"BUILDER"|"RESEARCH"|"SCIENTIST"|"QA"|"BROWSER"|"GUARDIAN"|"OPERATOR"|"RECOVERY"|"INTEGRATOR";
export type AutonomyProfile={initiative:boolean;experimentation:boolean;codeChanges:boolean;sandboxCreation:boolean;externalNetwork:boolean;production:boolean;infrastructure:boolean;authorityChanges:boolean};
export type AgentNode=Agent&{kind:AgentKind;profile:AutonomyProfile;heartbeatAt:string;health:"HEALTHY"|"STALE"|"BLOCKED"};
export type Handoff={id:string;fromAgentId:string;toAgentId:string;taskId:string;reason:string;createdAt:string;status:"REQUESTED"|"ACCEPTED"|"COMPLETED"|"REJECTED"};
const base:AutonomyProfile={initiative:true,experimentation:true,codeChanges:true,sandboxCreation:true,externalNetwork:false,production:false,infrastructure:false,authorityChanges:false};
const agents:AgentNode[]=[
{id:"AG-INT",name:"Integrator",role:"Third-party Provider Management",kind:"INTEGRATOR",status:"WAITING",progress:0,task:"Discover, connect and monitor delegated providers",capabilities:["provider.discover","provider.evaluate","provider.connect","provider.bind","provider.monitor","provider.revoke"],profile:{...base,externalNetwork:true,infrastructure:true},heartbeatAt:new Date().toISOString(),health:"HEALTHY"},
{id:"AG-SUP",name:"Supervisor",role:"Orchestration",kind:"SUPERVISOR",status:"RUNNING",progress:0,task:"Routing and coordination",capabilities:["task.dispatch","provider.discover","provider.evaluate","provider.monitor"],profile:{...base,codeChanges:false,sandboxCreation:false},heartbeatAt:new Date().toISOString(),health:"HEALTHY"},
{id:"AG-PLAN",name:"Planner",role:"Planning",kind:"PLANNER",status:"WAITING",progress:0,task:"Decompose missions",capabilities:["mission.plan","provider.discover","provider.evaluate"],profile:{...base,codeChanges:false,sandboxCreation:false},heartbeatAt:new Date().toISOString(),health:"HEALTHY"},
{id:"AG-BUILD",name:"Builder",role:"Engineering",kind:"BUILDER",status:"WAITING",progress:0,task:"Implement changes",capabilities:["repo.branch","artifact.write","sandbox.run","provider.bind"],profile:{...base},heartbeatAt:new Date().toISOString(),health:"HEALTHY"},
{id:"AG-QA",name:"QA",role:"Verification",kind:"QA",status:"WAITING",progress:0,task:"Verify artifacts",capabilities:["test.run","artifact.read"],profile:{...base,codeChanges:false,sandboxCreation:false},heartbeatAt:new Date().toISOString(),health:"HEALTHY"},
{id:"AG-GUARD",name:"Guardian",role:"Security",kind:"GUARDIAN",status:"WAITING",progress:0,task:"Policy enforcement",capabilities:["policy.read","audit.read","approval.request"],profile:{...base,experimentation:false,codeChanges:false,sandboxCreation:false},heartbeatAt:new Date().toISOString(),health:"HEALTHY"}
];
const handoffs:Handoff[]=[];
export function listAgentNodes(){return structuredClone(agents)}
export function heartbeatAgent(id:string){const a=agents.find(x=>x.id===id);if(!a)return null;a.heartbeatAt=new Date().toISOString();a.health="HEALTHY";return structuredClone(a)}
export function updateAgentStatus(id:string,status:Status,progress:number,task?:string){const a=agents.find(x=>x.id===id);if(!a)return null;a.status=status;a.progress=progress;if(task)a.task=task;a.heartbeatAt=new Date().toISOString();return structuredClone(a)}
export function requestHandoff(fromAgentId:string,toAgentId:string,taskId:string,reason:string){if(fromAgentId===toAgentId)throw new Error("self handoff rejected");if(!agents.some(x=>x.id===fromAgentId)||!agents.some(x=>x.id===toAgentId))throw new Error("agent not found");const h={id:`HO-${Date.now()}`,fromAgentId,toAgentId,taskId,reason,createdAt:new Date().toISOString(),status:"REQUESTED" as const};handoffs.push(h);return structuredClone(h)}
export function resolveHandoff(id:string,status:Handoff["status"]){const h=handoffs.find(x=>x.id===id);if(!h)throw new Error("handoff not found");h.status=status;return structuredClone(h)}
export function listHandoffs(){return structuredClone(handoffs)}
