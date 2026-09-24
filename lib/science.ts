import type {Experiment,KnowledgeState,Risk} from "./types";
import {observe} from "./observability";
export type EvidenceKind="OBSERVATION"|"MEASUREMENT"|"TEST_RESULT"|"SOURCE"|"REPRODUCTION";
export type Objective={id:string;missionId:string;title:string;description:string;status:"PLANNED"|"ACTIVE"|"COMPLETED"|"BLOCKED"};
export type ExperimentRecord=Experiment&{missionId:string;objectiveId:string;baseline:string;control:string;variables:string[];expectedResult:string;observedResult?:string;evidenceIds:string[];alternativeExplanations:string[]};
export type Evidence={id:string;experimentId:string;kind:EvidenceKind;claim:string;value:string;source?:string;observedAt:string;knowledgeState:KnowledgeState};
export type DecisionRecord={id:string;taskId:string;objective:string;observations:string[];assumptions:string[];hypothesis:string;options:string[];chosenExperiment?:string;expectedResult:string;observedResult?:string;evidenceIds:string[];nextAction:string;createdAt:string};
const objectives:Objective[]=[];
const experiments:ExperimentRecord[]=[];
const evidence:Evidence[]=[];
const decisions:DecisionRecord[]=[];
const clone=<T,>(x:T):T=>structuredClone(x);
export function createObjective(x:Omit<Objective,"status">){const o={...x,status:"PLANNED" as const};objectives.push(o);observe({type:"science.objective.created",message:`Objective ${o.id} erstellt`,status:"PLANNING",actor:"scientist",resource:o.id,action:"science.objective.create",argumentsValue:o});return clone(o)}
export function createExperiment(x:Omit<ExperimentRecord,"evidenceIds"|"status"|"progress"|"knowledgeState">){const e={...x,evidenceIds:[],status:"PLANNING" as const,progress:0,knowledgeState:"HYPOTHESIS" as KnowledgeState};experiments.push(e);observe({type:"experiment.created",message:`Experiment ${e.id} erstellt`,status:"PLANNING",actor:"scientist",resource:e.id,action:"science.experiment.create",argumentsValue:e});return clone(e)}
export function updateExperiment(id:string,patch:Partial<Pick<ExperimentRecord,"status"|"progress"|"expectedResult"|"observedResult"|"knowledgeState"|"alternativeExplanations">>){const e=experiments.find(e=>e.id===ev.experimentId);if(!e)throw new Error("experiment not found");Object.assign(e,patch);observe({type:"experiment.updated",message:`Experiment ${id} aktualisiert`,status:e.status,actor:"scientist",resource:id,action:"science.experiment.update",argumentsValue:patch});return clone(e)}
export function addEvidence(x:Omit<Evidence,"id"|"observedAt">){const ev={...x,id:`EVD-${Date.now()}`,observedAt:new Date().toISOString()};evidence.push(ev);observe({type:"experiment.evidence",message:`Evidence ${ev.id} erfasst`,status:"TESTING",actor:"scientist",resource:ev.experimentId,action:"science.evidence.add",argumentsValue:ev});const e=experiments.find(e=>e.id===ev.experimentId);if(e)e.evidenceIds.push(ev.id);return clone(ev)}
export function createDecision(x:Omit<DecisionRecord,"id"|"createdAt">){const d={...x,id:`ADR-${Date.now()}`,createdAt:new Date().toISOString()};decisions.push(d);observe({type:"agent.decision.recorded",message:`Decision Record ${d.id} erfasst`,status:"COMPLETED",actor:"agent",resource:d.id,taskId:d.taskId,action:"science.decision.create",argumentsValue:d});return clone(d)}
export function listScience(){return clone({objectives,experiments,evidence,decisions})}
