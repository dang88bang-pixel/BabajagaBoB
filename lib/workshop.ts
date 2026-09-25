import type {Risk} from "./types";
import {createStore} from "./persistence/store";
export type WorkshopKind="TOOL"|"SKILL"|"RUNTIME_ADAPTER"|"CONNECTOR"|"TEST_HARNESS"|"DEBUGGER"|"PARSER"|"COMPILER_ADAPTER";
export type WorkshopStage="IDEA"|"SPECIFICATION"|"PROTOTYPE"|"SANDBOX"|"TESTING"|"SECURITY_VALIDATION"|"EXPERIMENT"|"VALIDATED"|"REGISTERED"|"VERSIONED"|"FAILED";
export type WorkshopItem={id:string;kind:WorkshopKind;name:string;description:string;stage:WorkshopStage;version:string;capabilities:string[];risk:Risk;dependencies:string[];provenance:string;tests:string[];createdAt:string;updatedAt:string};
/** Werkstatt-Objekte sind Entwicklungszustand und werden persistiert. */
const store=createStore<{items:WorkshopItem[]}>("workshop",1,()=>({items:[]}));
const clone=<T,>(x:T):T=>structuredClone(x);
export function createWorkshopItem(x:Omit<WorkshopItem,"id"|"stage"|"createdAt"|"updatedAt">){
  // Ohne Art/Name/Beschreibung/Risiko ist ein Werkstatt-Objekt kein Objekt, sondern
  // ein Platzhalter. Solche Einträge sind im Control Center nicht bedienbar.
  if(!x||typeof x!=="object")throw new Error("workshop item required");
  const text=(v:unknown)=>typeof v==="string"&&v.trim().length>0;
  if(!text(x.kind))throw new Error("workshop kind required");
  if(!text(x.name))throw new Error("workshop name required");
  if(!text(x.description))throw new Error("workshop description required");
  if(!text(x.risk))throw new Error("workshop risk required");
  const now=new Date().toISOString();const item={...x,id:`WS-${Date.now()}`,stage:"IDEA" as const,createdAt:now,updatedAt:now};store.write({items:[...store.read().items,item]});return clone(item);
}
const allowed:Record<WorkshopStage,WorkshopStage[]>={
IDEA:["SPECIFICATION","FAILED"],SPECIFICATION:["PROTOTYPE","FAILED"],PROTOTYPE:["SANDBOX","FAILED"],SANDBOX:["TESTING","FAILED"],TESTING:["SECURITY_VALIDATION","FAILED"],SECURITY_VALIDATION:["EXPERIMENT","FAILED"],EXPERIMENT:["VALIDATED","FAILED"],VALIDATED:["REGISTERED"],REGISTERED:["VERSIONED"],VERSIONED:["VERSIONED"],FAILED:["IDEA"]
};
export function advanceWorkshop(id:string,next:WorkshopStage){const items=store.read().items;const item=items.find(x=>x.id===id);if(!item)throw new Error("workshop item not found");if(!allowed[item.stage].includes(next))throw new Error(`invalid transition ${item.stage} -> ${next}`);item.stage=next;item.updatedAt=new Date().toISOString();store.write({items});return clone(item)}
export function listWorkshop(){return store.read().items.map(clone)}
export function workshopStoreReport(){return store.integrity()}
