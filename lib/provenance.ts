import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

export type ProvenanceRelation="DERIVED_FROM"|"TESTED_BY"|"EXECUTED_IN"|"AUTHORIZED_BY"|"CAUSED_BY"|"PRODUCED";
export type ProvenanceNode={id:string;kind:string;label:string;createdAt:string};
export type ProvenanceEdge={id:string;from:string;to:string;relation:ProvenanceRelation;createdAt:string};
type Envelope={version:1;nodes:ProvenanceNode[];edges:ProvenanceEdge[];digest:string};
const root=process.env.BOB_STORAGE_DIR??path.join(process.cwd(),".bob-data");
const file=path.join(root,"provenance.json");
const digest=(v:unknown)=>crypto.createHash("sha256").update(JSON.stringify(v)).digest("hex");
const clone=<T,>(x:T):T=>structuredClone(x);
function read():Envelope{
 fs.mkdirSync(root,{recursive:true});
 if(!fs.existsSync(file)){const payload={version:1 as const,nodes:[],edges:[]};const e={...payload,digest:digest(payload)};fs.writeFileSync(file,JSON.stringify(e,null,2),{mode:0o600});return e;}
 const e=JSON.parse(fs.readFileSync(file,"utf8")) as Envelope;const {digest:stored,...payload}=e;if(stored!==digest(payload))throw new Error("Provenance integrity check failed");return e;
}
function write(nodes:ProvenanceNode[],edges:ProvenanceEdge[]){
 const payload={version:1 as const,nodes:clone(nodes),edges:clone(edges)};const e={...payload,digest:digest(payload)};const tmp=path.join(root,`.provenance.${process.pid}.${Date.now()}.tmp`);fs.writeFileSync(tmp,JSON.stringify(e,null,2),{mode:0o600});fs.renameSync(tmp,file);
}
export function addProvenanceNode(n:Omit<ProvenanceNode,"createdAt">){const e=read();const x={...n,createdAt:new Date().toISOString()};e.nodes.push(x);write(e.nodes,e.edges);return clone(x);}
export function addProvenanceEdge(e0:Omit<ProvenanceEdge,"id"|"createdAt">){const e=read();if(!e.nodes.some(x=>x.id===e0.from)||!e.nodes.some(x=>x.id===e0.to))throw new Error("provenance endpoint missing");const x={...e0,id:"PE-"+crypto.randomUUID(),createdAt:new Date().toISOString()};e.edges.push(x);write(e.nodes,e.edges);return clone(x);}
export function listProvenance(){const e=read();return clone({nodes:e.nodes,edges:e.edges});}