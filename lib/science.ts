import type {Experiment,KnowledgeState,Risk} from "./types";
import {observe} from "./observability";
import crypto from "node:crypto";
import {activeSandboxRuntime} from "./runtime-factory";
export type EvidenceKind="OBSERVATION"|"MEASUREMENT"|"TEST_RESULT"|"SOURCE"|"REPRODUCTION";
export type Objective={id:string;missionId:string;title:string;description:string;status:"PLANNED"|"ACTIVE"|"COMPLETED"|"BLOCKED"};
export type ExperimentRecord=Experiment&{missionId:string;objectiveId:string;baseline:string;control:string;variables:string[];expectedResult:string;observedResult?:string;evidenceIds:string[];alternativeExplanations:string[]};
export type Evidence={id:string;experimentId:string;kind:EvidenceKind;claim:string;value:string;source?:string;observedAt:string;knowledgeState:KnowledgeState};
export type ExperimentRun={id:string;experimentId:string;kind:"BASELINE"|"CONTROL"|"REPLICATION";sandboxId:string;argv:string[];accepted:boolean;message:string;observedAt:string};
export type DecisionRecord={id:string;taskId:string;objective:string;observations:string[];assumptions:string[];hypothesis:string;options:string[];chosenExperiment?:string;expectedResult:string;observedResult?:string;evidenceIds:string[];nextAction:string;createdAt:string};
const objectives:Objective[]=[];
const experiments:ExperimentRecord[]=[];
const evidence:Evidence[]=[];
const decisions:DecisionRecord[]=[];
const experimentRuns:ExperimentRun[]=[];
const clone=<T,>(x:T):T=>structuredClone(x);
export function createObjective(x:Omit<Objective,"status">){const o={...x,status:"PLANNED" as const};objectives.push(o);observe({type:"science.objective.created",message:`Objective ${o.id} erstellt`,status:"PLANNING",actor:"scientist",resource:o.id,action:"science.objective.create",argumentsValue:o});return clone(o)}
export function createExperiment(x:Omit<ExperimentRecord,"evidenceIds"|"status"|"progress"|"knowledgeState">){const e={...x,evidenceIds:[],status:"PLANNING" as const,progress:0,knowledgeState:"HYPOTHESIS" as KnowledgeState};experiments.push(e);observe({type:"experiment.created",message:`Experiment ${e.id} erstellt`,status:"PLANNING",actor:"scientist",resource:e.id,action:"science.experiment.create",argumentsValue:e});return clone(e)}
export function updateExperiment(id:string,patch:Partial<Pick<ExperimentRecord,"status"|"progress"|"expectedResult"|"observedResult"|"knowledgeState"|"alternativeExplanations">>){const e=experiments.find(e=>e.id===id);if(!e)throw new Error("experiment not found");Object.assign(e,patch);observe({type:"experiment.updated",message:`Experiment ${id} aktualisiert`,status:e.status,actor:"scientist",resource:id,action:"science.experiment.update",argumentsValue:patch});return clone(e)}
export function addEvidence(x:Omit<Evidence,"id"|"observedAt">){const ev={...x,id:`EVD-${Date.now()}`,observedAt:new Date().toISOString()};evidence.push(ev);observe({type:"experiment.evidence",message:`Evidence ${ev.id} erfasst`,status:"TESTING",actor:"scientist",resource:ev.experimentId,action:"science.evidence.add",argumentsValue:ev});const e=experiments.find(e=>e.id===ev.experimentId);if(e)e.evidenceIds.push(ev.id);return clone(ev)}
export async function runExperiment(id:string,kind:"BASELINE"|"CONTROL"|"REPLICATION",sandboxId:string,argv:string[]){
 const e=experiments.find(x=>x.id===id);if(!e)throw new Error("experiment not found");if(!sandboxId)throw new Error("sandbox required");if(!Array.isArray(argv)||argv.length===0)throw new Error("argv required");
 const result=await activeSandboxRuntime.execute(sandboxId,argv);
 const run={id:`XR-${crypto.randomUUID().slice(0,8).toUpperCase()}`,experimentId:id,kind,sandboxId,argv,accepted:result.accepted,message:result.message,observedAt:new Date().toISOString()};
 experimentRuns.push(run);e.progress=Math.min(100,e.progress+Math.floor(100/3));e.status=kind==="REPLICATION"&&e.progress>=100?"COMPLETED":"EXPERIMENT";e.observedResult=result.message;e.knowledgeState=result.accepted?"SUPPORTED":"CONTRADICTED";
 observe({type:"experiment.run",message:`Experiment ${id} ${kind}`,status:e.status,actor:"scientist",resource:id,action:"science.experiment.run",argumentsValue:run});return clone(run);
}
export function listExperimentRuns(){return clone(experimentRuns)}
export type CausalValidation={experimentId:string;valid:boolean;knowledgeState:KnowledgeState;baselineRuns:number;controlRuns:number;replicationRuns:number;replicationAgreement:number;alternativeExplanations:string[];reasons:string[]};
export function validateCausalChain(id:string):CausalValidation{
 const e=experiments.find(x=>x.id===id);if(!e)throw new Error("experiment not found");
 const runs=experimentRuns.filter(r=>r.experimentId===id);
 const b=runs.filter(r=>r.kind==="BASELINE"),c=runs.filter(r=>r.kind==="CONTROL"),r=runs.filter(r=>r.kind==="REPLICATION");
 const reasons:string[]=[];
 if(b.length===0)reasons.push("baseline missing");
 if(c.length===0)reasons.push("control missing");
 if(r.length===0)reasons.push("replication missing");
 const signatures=r.map(x=>x.accepted+"|"+x.message);
 const agreement=r.length?new Set(signatures).size===1?1:signatures.filter(x=>x===signatures[0]).length/signatures.length:0;
 if(r.length>1&&agreement<1)reasons.push("replications disagree");
 const valid=b.length>0&&c.length>0&&r.length>0&&agreement===1&&e.evidenceIds.length>0;
 const state:KnowledgeState=valid?"ESTABLISHED":(r.length>0||e.evidenceIds.length>0?"SUPPORTED":"HYPOTHESIS");
 const result={experimentId:id,valid,knowledgeState:state,baselineRuns:b.length,controlRuns:c.length,replicationRuns:r.length,replicationAgreement:agreement,alternativeExplanations:e.alternativeExplanations,reasons};
 e.knowledgeState=state;if(valid)e.status="COMPLETED";return clone(result);
}
export function createDecision(x:Omit<DecisionRecord,"id"|"createdAt">){const d={...x,id:`ADR-${Date.now()}`,createdAt:new Date().toISOString()};decisions.push(d);observe({type:"agent.decision.recorded",message:`Decision Record ${d.id} erfasst`,status:"COMPLETED",actor:"agent",resource:d.id,taskId:d.taskId,action:"science.decision.create",argumentsValue:d});return clone(d)}
export function listScience(){return clone({objectives,experiments,evidence,decisions,experimentRuns})}
