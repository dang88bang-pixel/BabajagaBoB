import {createStore} from "./persistence/store";
import {observe} from "./observability";
import {getControlState} from "./control-plane";

export type PlanStatus = "DRAFT" | "ACTIVE" | "COMPLETED" | "ABORTED";
export type PlanStep = {stepId:string; taskId:string; order:number; expectedEffect:string; abortCriteria:string[]};

export type ExecutionPlan = {
  planId:string;
  objectiveId:string;
  version:number;
  status:PlanStatus;
  steps:PlanStep[];
  expectedEffects:string[];
  abortCriteria:string[];
  createdBy:string;
  createdAt:string;
  updatedAt:string;
};

type Payload = {plans:ExecutionPlan[]; revisions:Record<string,number>};
const store=createStore<Payload>("plans",1,()=>({plans:[],revisions:{}}));

function requireText(value:unknown,name:string):string {
  if(typeof value!=="string" || value.trim().length===0) throw new Error(name+" is required");
  return value.trim();
}

export function listPlans(objectiveId?:string):ExecutionPlan[] {
  const plans=store.read().plans;
  return structuredClone(objectiveId ? plans.filter(p=>p.objectiveId===objectiveId) : plans);
}

export function getPlan(planId:string):ExecutionPlan|null {
  return structuredClone(store.read().plans.find(p=>p.planId===planId) ?? null);
}

export function createPlan(input:{
  objectiveId:string;
  taskIds:string[];
  expectedEffects:string[];
  abortCriteria:string[];
  createdBy:string;
}):ExecutionPlan {
  const objectiveId=requireText(input.objectiveId,"objectiveId");
  const createdBy=requireText(input.createdBy,"createdBy");
  if(!Array.isArray(input.taskIds) || input.taskIds.length===0) throw new Error("taskIds are required");
  if(!Array.isArray(input.expectedEffects) || input.expectedEffects.length===0) throw new Error("expectedEffects are required");
  if(!Array.isArray(input.abortCriteria) || input.abortCriteria.length===0) throw new Error("abortCriteria are required");
  const state=getControlState();
  const objective=state.objectives.find(o=>o.objectiveId===objectiveId);
  if(!objective) throw new Error("objective not found: "+objectiveId);
  const tasks=input.taskIds.map(id=>state.tasks.find(t=>t.taskId===id));
  if(tasks.some(t=>!t)) throw new Error("plan references an unknown task");
  if(tasks.some(t=>t!.objectiveId!==objectiveId)) throw new Error("all plan tasks must belong to the objective");
  const now=new Date().toISOString();
  const current=store.read();
  const version=(current.revisions[objectiveId] ?? 0)+1;
  const planId="PLAN-"+Date.now().toString(36).toUpperCase()+"-"+String(version).padStart(2,"0");
  const steps:PlanStep[]=input.taskIds.map((taskId,index)=>({
    stepId:planId+"-S"+String(index+1).padStart(2,"0"),
    taskId,
    order:index+1,
    expectedEffect:"Task "+taskId+" erfüllt den zugeordneten Objective-Schritt.",
    abortCriteria:input.abortCriteria
  }));
  const plan:ExecutionPlan={planId,objectiveId,version,status:"DRAFT",steps,expectedEffects:input.expectedEffects.map(requireText),abortCriteria:input.abortCriteria.map(requireText),createdBy,createdAt:now,updatedAt:now};
  store.update(next=>{next.plans.push(plan);next.revisions[objectiveId]=version;});
  observe({type:"plan.created",message:"Plan "+plan.planId+" für "+objectiveId+" erstellt",status:"PLANNING",actor:createdBy,action:"plan.create",resource:plan.planId,argumentsValue:{objectiveId,version,taskCount:plan.steps.length}});
  return structuredClone(plan);
}

export function activatePlan(planId:string, actor="CREATOR"):ExecutionPlan {
  const plan=store.read().plans.find(p=>p.planId===planId);
  if(!plan) throw new Error("plan not found: "+planId);
  if(plan.status!=="DRAFT") throw new Error("only DRAFT plans can be activated");
  plan.status="ACTIVE"; plan.updatedAt=new Date().toISOString();
  store.update(next=>{const index=next.plans.findIndex(p=>p.planId===planId);if(index>=0)next.plans[index]=plan;});
  observe({type:"plan.activated",message:"Plan "+planId+" aktiviert",status:"RUNNING",actor,action:"plan.activate",resource:planId});
  return structuredClone(plan);
}
