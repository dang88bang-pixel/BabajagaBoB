import type {Risk} from "./types";
export type WorkshopKind="TOOL"|"SKILL"|"RUNTIME_ADAPTER"|"CONNECTOR"|"TEST_HARNESS"|"DEBUGGER"|"PARSER"|"COMPILER_ADAPTER";
export type WorkshopStage="IDEA"|"SPECIFICATION"|"PROTOTYPE"|"SANDBOX"|"TESTING"|"SECURITY_VALIDATION"|"EXPERIMENT"|"VALIDATED"|"REGISTERED"|"VERSIONED"|"FAILED";
export type WorkshopItem={id:string;kind:WorkshopKind;name:string;description:string;stage:WorkshopStage;version:string;capabilities:string[];risk:Risk;dependencies:string[];provenance:string;tests:string[];createdAt:string;updatedAt:string};
const items:WorkshopItem[]=[];
const clone=<T,>(x:T):T=>structuredClone(x);
export function createWorkshopItem(x:Omit<WorkshopItem,"id"|"stage"|"createdAt"|"updatedAt">){const now=new Date().toISOString();const item={...x,id:`WS-${Date.now()}`,stage:"IDEA" as const,createdAt:now,updatedAt:now};items.push(item);return clone(item)}
const allowed:Record<WorkshopStage,WorkshopStage[]>={
IDEA:["SPECIFICATION","FAILED"],SPECIFICATION:["PROTOTYPE","FAILED"],PROTOTYPE:["SANDBOX","FAILED"],SANDBOX:["TESTING","FAILED"],TESTING:["SECURITY_VALIDATION","FAILED"],SECURITY_VALIDATION:["EXPERIMENT","FAILED"],EXPERIMENT:["VALIDATED","FAILED"],VALIDATED:["REGISTERED"],REGISTERED:["VERSIONED"],VERSIONED:["VERSIONED"],FAILED:["IDEA"]
};
export function advanceWorkshop(id:string,next:WorkshopStage){const item=items.find(x=>x.id===id);if(!item)throw new Error("workshop item not found");if(!allowed[item.stage].includes(next))throw new Error(`invalid transition ${item.stage} -> ${next}`);item.stage=next;item.updatedAt=new Date().toISOString();return clone(item)}
export function listWorkshop(){return clone(items)}
