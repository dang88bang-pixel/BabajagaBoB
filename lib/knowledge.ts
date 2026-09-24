export type MemoryLayer="WORKING"|"EPISODIC"|"SEMANTIC"|"NEGATIVE";
export type KnowledgeRelation="SUPPORTS"|"CONTRADICTS"|"DERIVED_FROM"|"REPRODUCED_BY"|"DEPENDS_ON";
export type KnowledgeRecord={id:string;layer:MemoryLayer;subject:string;predicate:string;object:string;state:"OBSERVED"|"SUPPORTED"|"ESTABLISHED"|"HYPOTHESIS"|"UNVERIFIED"|"CONTRADICTED"|"REJECTED"|"UNKNOWN";sourceIds:string[];createdAt:string;updatedAt:string};
export type KnowledgeEdge={id:string;from:string;to:string;relation:KnowledgeRelation;createdAt:string};
const records:KnowledgeRecord[]=[];
const edges:KnowledgeEdge[]=[];
const clone=<T,>(v:T):T=>structuredClone(v);
export function upsertKnowledge(x:Omit<KnowledgeRecord,"id"|"createdAt"|"updatedAt">){
 const now=new Date().toISOString();const r={...x,id:`KN-${Date.now()}-${records.length}`,createdAt:now,updatedAt:now};records.unshift(r);return clone(r);
}
export function updateKnowledge(id:string,patch:Partial<Pick<KnowledgeRecord,"state"|"sourceIds"|"object">>){
 const r=records.find(x=>x.id===id);if(!r)throw new Error("knowledge record not found");Object.assign(r,patch,{updatedAt:new Date().toISOString()});return clone(r);
}
export function linkKnowledge(from:string,to:string,relation:KnowledgeRelation){
 if(!records.some(x=>x.id===from)||!records.some(x=>x.id===to))throw new Error("knowledge endpoints not found");
 const e={id:`KEDGE-${Date.now()}-${edges.length}`,from,to,relation,createdAt:new Date().toISOString()};edges.unshift(e);return clone(e);
}
export function searchKnowledge(query:string){
 const q=query.toLowerCase();return clone(records.filter(r=>[r.subject,r.predicate,r.object,r.state].some(v=>v.toLowerCase().includes(q))));
}
export function listKnowledge(){return clone({records,edges})}
