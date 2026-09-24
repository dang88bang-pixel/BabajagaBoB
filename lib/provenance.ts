export type ProvenanceNode={id:string;kind:string;label:string;createdAt:string};
export type ProvenanceEdge={id:string;from:string;to:string;relation:"DERIVED_FROM"|"TESTED_BY"|"EXECUTED_IN"|"AUTHORIZED_BY"|"CAUSED_BY"|"PRODUCED"};
const nodes:ProvenanceNode[]=[];const edges:ProvenanceEdge[]=[];
const clone=<T,>(x:T):T=>structuredClone(x);
export function addProvenanceNode(n:Omit<ProvenanceNode,"createdAt">){const x={...n,createdAt:new Date().toISOString()};nodes.push(x);return clone(x)}
export function addProvenanceEdge(e:Omit<ProvenanceEdge,"id">){if(!nodes.some(x=>x.id===e.from)||!nodes.some(x=>x.id===e.to))throw new Error("provenance endpoint missing");const x={...e,id:`PE-${Date.now()}`};edges.push(x);return clone(x)}
export function listProvenance(){return clone({nodes,edges})}
