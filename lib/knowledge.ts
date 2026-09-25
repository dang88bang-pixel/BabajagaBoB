import crypto from "node:crypto";
import {loadFabric,saveFabric} from "./fabric-store";

export type MemoryLayer="WORKING"|"EPISODIC"|"SEMANTIC"|"NEGATIVE";
export type KnowledgeRelation="SUPPORTS"|"CONTRADICTS"|"DERIVED_FROM"|"REPRODUCED_BY"|"DEPENDS_ON";
export type KnowledgeState="OBSERVED"|"SUPPORTED"|"ESTABLISHED"|"HYPOTHESIS"|"UNVERIFIED"|"CONTRADICTED"|"REJECTED"|"UNKNOWN";
export type KnowledgeRecord={id:string;layer:MemoryLayer;subject:string;predicate:string;object:string;state:KnowledgeState;sourceIds:string[];createdAt:string;updatedAt:string};
export type KnowledgeEdge={id:string;from:string;to:string;relation:KnowledgeRelation;createdAt:string};
type KnowledgeStateStore={records:KnowledgeRecord[];edges:KnowledgeEdge[]};
const initial:KnowledgeStateStore={records:[],edges:[]};
const clone=<T,>(v:T):T=>structuredClone(v);
let store=loadFabric("knowledge",initial);
const persist=()=>saveFabric("knowledge",store);

export function upsertKnowledge(x:Omit<KnowledgeRecord,"id"|"createdAt"|"updatedAt">){
 if(!x.subject?.trim()||!x.predicate?.trim()||!x.object?.trim())throw new Error("knowledge subject, predicate and object are required");
 const now=new Date().toISOString();
 const r={...x,id:`KN-${Date.now()}-${crypto.randomUUID()}`,createdAt:now,updatedAt:now};
 store.records.unshift(r);persist();return clone(r);
}
export function updateKnowledge(id:string,patch:Partial<Pick<KnowledgeRecord,"state"|"sourceIds"|"object">>){
 const r=store.records.find(x=>x.id===id);if(!r)throw new Error("knowledge record not found");
 Object.assign(r,patch,{updatedAt:new Date().toISOString()});persist();return clone(r);
}
export function linkKnowledge(from:string,to:string,relation:KnowledgeRelation){
 if(!store.records.some(x=>x.id===from)||!store.records.some(x=>x.id===to))throw new Error("knowledge endpoints not found");
 if(from===to)throw new Error("knowledge self-links are not allowed");
 const e={id:`KEDGE-${Date.now()}-${crypto.randomUUID()}`,from,to,relation,createdAt:new Date().toISOString()};
 store.edges.unshift(e);persist();return clone(e);
}
export function searchKnowledge(query:string){
 const q=query.trim().toLowerCase();if(!q)return clone(store.records);
 return clone(store.records.filter(r=>[r.subject,r.predicate,r.object,r.state].some(v=>v.toLowerCase().includes(q))));
}
export function listKnowledge(){return clone(store);}
