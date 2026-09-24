export type ScenarioState="DRAFT"|"MODELING"|"SIMULATING"|"EXPERIMENT"|"OBSERVING"|"VALIDATING"|"COMPLETED"|"FAILED";
export type VisualizationKind="ARCHITECTURE"|"FLOW"|"TIMELINE"|"STATE_MACHINE"|"DEPENDENCY"|"NETWORK"|"SCENE_3D";
export type Scenario={id:string;name:string;kind:VisualizationKind;state:ScenarioState;inputs:Record<string,unknown>;assumptions:string[];expectedStates:string[];result?:Record<string,unknown>;createdAt:string;updatedAt:string};
const scenarios:Scenario[]=[];
const clone=<T,>(v:T):T=>structuredClone(v);
export function createScenario(x:Omit<Scenario,"id"|"state"|"createdAt"|"updatedAt">){const now=new Date().toISOString();const s={...x,id:`SCN-${Date.now()}-${scenarios.length}`,state:"DRAFT" as const,createdAt:now,updatedAt:now};scenarios.unshift(s);return clone(s)}
export function advanceScenario(id:string,state:ScenarioState,result?:Record<string,unknown>){const s=scenarios.find(x=>x.id===id);if(!s)throw new Error("scenario not found");s.state=state;s.result=result??s.result;s.updatedAt=new Date().toISOString();return clone(s)}
export function listScenarios(){return clone(scenarios)}
