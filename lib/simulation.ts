import {createStore} from "./persistence/store";
import {observe} from "./observability";
export type ScenarioState="DRAFT"|"MODELING"|"SIMULATING"|"EXPERIMENT"|"OBSERVING"|"VALIDATING"|"COMPLETED"|"FAILED";
export type VisualizationKind="ARCHITECTURE"|"FLOW"|"TIMELINE"|"STATE_MACHINE"|"DEPENDENCY"|"NETWORK"|"SCENE_3D";
export type Scenario={id:string;name:string;kind:VisualizationKind;state:ScenarioState;inputs:Record<string,unknown>;assumptions:string[];expectedStates:string[];result?:Record<string,unknown>;createdAt:string;updatedAt:string};
type Payload={scenarios:Scenario[]};
const store=createStore<Payload>("simulation",1,()=>({scenarios:[]}));
const scenarios:Scenario[]=store.read().scenarios;
const persist=()=>store.write({scenarios});
const clone=<T,>(v:T):T=>structuredClone(v);
export function createScenario(x:Omit<Scenario,"id"|"state"|"createdAt"|"updatedAt">){const now=new Date().toISOString();const s={...x,id:`SCN-${Date.now()}-${scenarios.length}`,state:"DRAFT" as const,createdAt:now,updatedAt:now};scenarios.unshift(s);persist();observe({type:"simulation.scenario.created",message:`Szenario ${s.id} erstellt`,status:"PLANNING",actor:"AG-SCIENTIST",agentId:"AG-SCIENTIST",action:"simulation.create",resource:s.id,argumentsValue:{kind:s.kind}});return clone(s)}
export function advanceScenario(id:string,state:ScenarioState,result?:Record<string,unknown>){const s=scenarios.find(x=>x.id===id);if(!s)throw new Error("scenario not found");s.state=state;s.result=result??s.result;s.updatedAt=new Date().toISOString();persist();observe({type:"simulation.scenario.state",message:`Szenario ${id}: ${state}`,status:state==="COMPLETED"?"COMPLETED":"RUNNING",actor:"AG-SCIENTIST",agentId:"AG-SCIENTIST",action:"simulation.advance",resource:id,argumentsValue:{state}});return clone(s)}
export function simulationStoreReport(){return store.integrity()}
export function listScenarios(){return clone(scenarios)}
