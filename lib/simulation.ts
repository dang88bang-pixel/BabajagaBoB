import {loadFabric,saveFabric} from "./fabric-store";
export type ScenarioState="DRAFT"|"MODELING"|"SIMULATING"|"EXPERIMENT"|"OBSERVING"|"VALIDATING"|"COMPLETED"|"FAILED";
export type VisualizationKind="ARCHITECTURE"|"FLOW"|"TIMELINE"|"STATE_MACHINE"|"DEPENDENCY"|"NETWORK"|"SCENE_3D";
export type Scenario={id:string;name:string;kind:VisualizationKind;state:ScenarioState;inputs:Record<string,unknown>;assumptions:string[];expectedStates:string[];result?:Record<string,unknown>;createdAt:string;updatedAt:string};
const clone=<T,>(v:T):T=>structuredClone(v);
let scenarios=loadFabric<Scenario[]>("simulation",[]);
const persist=()=>saveFabric("simulation",scenarios);
const validTransitions:Record<ScenarioState,ScenarioState[]>={
 DRAFT:["MODELING","FAILED"],MODELING:["SIMULATING","EXPERIMENT","FAILED"],SIMULATING:["OBSERVING","FAILED"],EXPERIMENT:["OBSERVING","FAILED"],OBSERVING:["VALIDATING","FAILED"],VALIDATING:["COMPLETED","SIMULATING","EXPERIMENT","FAILED"],COMPLETED:[],FAILED:["DRAFT","MODELING"]
};
export function createScenario(x:Omit<Scenario,"id"|"state"|"createdAt"|"updatedAt">){
 if(!x.name?.trim()||!x.inputs||!Array.isArray(x.assumptions)||!Array.isArray(x.expectedStates))throw new Error("invalid scenario");
 const now=new Date().toISOString();const s={...x,id:`SCN-${Date.now()}-${crypto.randomUUID()}`,state:"DRAFT" as const,createdAt:now,updatedAt:now};scenarios.unshift(s);persist();return clone(s);
}
export function advanceScenario(id:string,state:ScenarioState,result?:Record<string,unknown>){
 const s=scenarios.find(x=>x.id===id);if(!s)throw new Error("scenario not found");
 if(!validTransitions[s.state].includes(state)&&state!==s.state)throw new Error(`invalid scenario transition ${s.state} -> ${state}`);
 s.state=state;s.result=result??s.result;s.updatedAt=new Date().toISOString();persist();return clone(s);
}
export function listScenarios(){return clone(scenarios)}
