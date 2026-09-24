import type {Agent,Event,Experiment,Mission,Sandbox,Status} from "./types";

type ControlState={agents:Agent[];missions:Mission[];experiments:Experiment[];sandboxes:Sandbox[];events:Event[];locked:boolean};
const state:ControlState={
 agents:[
  {id:"AG-01",name:"Supervisor",role:"Orchestrator",status:"RUNNING",progress:72,task:"Coordinating T-104"},
  {id:"AG-02",name:"Builder",role:"Engineering",status:"EXPERIMENT",progress:48,task:"GUI state experiment"},
  {id:"AG-03",name:"Guardian",role:"Security",status:"WAITING",progress:0,task:"Capability validation"}
 ],
 missions:[
  {id:"T-104",title:"Build GUI foundation",status:"RUNNING",progress:72,owner:"Builder"},
  {id:"T-105",title:"Validate capability model",status:"WAITING",progress:20,owner:"Guardian"},
  {id:"T-106",title:"Regression harness",status:"COMPLETED",progress:100,owner:"QA"}
 ],
 experiments:[
  {id:"EXP-004",title:"UI state transition",status:"EXPERIMENT",progress:48,sandbox:"SB-03"},
  {id:"EXP-003",title:"Recovery rehearsal",status:"COMPLETED",progress:100,sandbox:"SB-02"}
 ],
 sandboxes:[
  {id:"SB-01",type:"development",status:"RUNNING",network:"DENY",task:"GUI foundation"},
  {id:"SB-02",type:"recovery",status:"COMPLETED",network:"DENY",task:"Rollback rehearsal"},
  {id:"SB-03",type:"experiment",status:"EXPERIMENT",network:"ALLOWLIST",task:"UI transition"}
 ],
 events:[
  {id:"evt-1",message:"Control Plane gestartet",status:"RUNNING",time:"now"},
  {id:"evt-2",message:"Sandbox SB-01 bereitgestellt",status:"COMPLETED",time:"1m ago"},
  {id:"evt-3",message:"Builder: Experiment 04 gestartet",status:"EXPERIMENT",time:"2m ago"},
  {id:"evt-4",message:"Guardian: Capability Check wartet",status:"WAITING",time:"4m ago"}
 ],
 locked:false
};
const clone=<T,>(v:T):T=>JSON.parse(JSON.stringify(v));
export function snapshot(){return clone(state)}
export function appendEvent(message:string,status:Status){state.events.unshift({id:crypto.randomUUID(),message,status,time:"now"});state.events=state.events.slice(0,50)}
export function runGuardian(){if(state.locked)return snapshot();state.agents=state.agents.map(a=>a.id==="AG-03"?{...a,status:"RUNNING",progress:18}:a);appendEvent("Guardian aktiviert — Capability Check läuft","RUNNING");return snapshot()}
export function setLockdown(locked:boolean){state.locked=locked;appendEvent(locked?"Emergency Lockdown aktiviert":"Emergency Lockdown aufgehoben",locked?"ERROR":"COMPLETED");return snapshot()}
