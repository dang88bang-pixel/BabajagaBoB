import crypto from "node:crypto";
import type {Agent,Approval,ControlState,Event,Experiment,Mission,Sandbox,Status,Task} from "./types";
import {evaluateTask} from "./policy";
import {recordAudit} from "./audit";
const now=()=>new Date().toISOString();
const state:ControlState={
 agents:[
  {id:"AG-01",name:"Supervisor",role:"Orchestrator",status:"RUNNING",progress:72,task:"Coordinating T-104",capabilities:["mission.read","task.dispatch","event.write"]},
  {id:"AG-02",name:"Builder",role:"Engineering",status:"EXPERIMENT",progress:48,task:"GUI state experiment",capabilities:["repo.branch","sandbox.run","artifact.write"]},
  {id:"AG-03",name:"Guardian",role:"Security",status:"WAITING",progress:0,task:"Capability validation",capabilities:["policy.read","audit.read","approval.request"]}
 ],
 missions:[
  {id:"T-104",title:"Build GUI foundation",status:"RUNNING",progress:72,owner:"Builder",objective:"Establish the executable Control Plane foundation"},
  {id:"T-105",title:"Validate capability model",status:"WAITING",progress:20,owner:"Guardian",objective:"Validate delegated capabilities and fail-closed boundaries"},
  {id:"T-106",title:"Regression harness",status:"COMPLETED",progress:100,owner:"QA",objective:"Prevent recurrence of verified failures"}
 ],
 tasks:[
  {id:"TASK-104-A",missionId:"T-104",title:"Connect GUI to Control Plane",status:"COMPLETED",progress:100,risk:"LOW",assignedAgent:"AG-02",requiresApproval:false},
  {id:"TASK-105-A",missionId:"T-105",title:"Run capability validation",status:"WAITING",progress:20,risk:"MODERATE",assignedAgent:"AG-03",requiresApproval:true},
  {id:"TASK-104-B",missionId:"T-104",title:"Define persistence boundary",status:"PLANNING",progress:10,risk:"LOW",assignedAgent:"AG-01",requiresApproval:false}
 ],
 experiments:[
  {id:"EXP-004",title:"UI state transition",status:"EXPERIMENT",progress:48,sandbox:"SB-03",hypothesis:"API-backed state remains coherent during repeated refreshes",knowledgeState:"HYPOTHESIS"},
  {id:"EXP-003",title:"Recovery rehearsal",status:"COMPLETED",progress:100,sandbox:"SB-02",hypothesis:"Lockdown prevents execution actions",knowledgeState:"SUPPORTED"}
 ],
 sandboxes:[
  {id:"SB-01",type:"development",status:"RUNNING",network:"DENY",task:"GUI foundation",agentId:"AG-02"},
  {id:"SB-02",type:"recovery",status:"COMPLETED",network:"DENY",task:"Rollback rehearsal",agentId:"AG-01"},
  {id:"SB-03",type:"experiment",status:"EXPERIMENT",network:"ALLOWLIST",task:"UI transition",agentId:"AG-02"}
 ],
 events:[
  {id:"evt-1",type:"control.started",message:"Control Plane gestartet",status:"RUNNING",time:now(),actor:"system"},
  {id:"evt-2",type:"sandbox.created",message:"Sandbox SB-01 bereitgestellt",status:"COMPLETED",time:now(),actor:"AG-02",resource:"SB-01"},
  {id:"evt-3",type:"experiment.started",message:"Builder: Experiment 04 gestartet",status:"EXPERIMENT",time:now(),actor:"AG-02",resource:"EXP-004"},
  {id:"evt-4",type:"approval.requested",message:"Guardian: Capability Check wartet auf Freigabe",status:"APPROVAL_REQUIRED",time:now(),actor:"AG-03",taskId:"TASK-105-A"}
 ],
 approvals:[{id:"APR-001",taskId:"TASK-105-A",status:"PENDING",reason:"Capability validation may change execution permissions"}],
 locked:false
};
const clone=<T,>(v:T):T=>JSON.parse(JSON.stringify(v));
export function snapshot(){return clone(state)}
export function appendEvent(type:string,message:string,status:Status,actor="system",meta:Partial<Event>={}):Event{const parent=state.events[0]?.id;const event:Event={id:crypto.randomUUID(),type,message,status,time:now(),actor,causalParentId:parent,...meta};state.events.unshift(event);state.events=state.events.slice(0,100);return clone(event)}
export function runGuardian(){if(state.locked){recordAudit({actor:"AG-03",action:"guardian.check",decision:"DENY"},{});return snapshot()}const task=state.tasks.find(t=>t.id==="TASK-105-A");if(task){const policy=evaluateTask(task,state.locked);recordAudit({actor:"AG-03",action:"guardian.check",resource:task.id,decision:policy.decision},task);if(policy.decision==="DENY"){task.status="BLOCKED";appendEvent("agent.blocked","Guardian: Policy denied task execution","BLOCKED","AG-03",{taskId:task.id});return snapshot()}if(policy.decision==="REQUIRE_APPROVAL"){task.status="APPROVAL_REQUIRED";appendEvent("approval.requested","Guardian: Capability Check benötigt Creator-Freigabe","APPROVAL_REQUIRED","AG-03",{taskId:task.id});return snapshot()}return snapshot()}}
export function resolveApproval(id:string,grant:boolean){const a=state.approvals.find(x=>x.id===id);if(!a)return snapshot();a.status=grant?"GRANTED":"DENIED";const t=state.tasks.find(x=>x.id===a.taskId);if(t){t.status=grant?"RUNNING":"BLOCKED";t.progress=grant?25:t.progress}appendEvent(grant?"approval.granted":"approval.denied",grant?"Creator-Freigabe erteilt":"Creator-Freigabe verweigert",grant?"RUNNING":"BLOCKED","creator",{taskId:a.taskId});return snapshot()}
export function setLockdown(locked:boolean){state.locked=locked;recordAudit({actor:"creator",action:locked?"control.lockdown":"control.unlock",decision:"ALLOW"}, {locked});state.agents=state.agents.map(a=>a.id==="AG-02"?{...a,status:locked?"BLOCKED":"EXPERIMENT"}:a);appendEvent(locked?"control.lockdown":"control.unlock",locked?"Emergency Lockdown aktiviert":"Emergency Lockdown aufgehoben",locked?"ERROR":"COMPLETED");return snapshot()}
