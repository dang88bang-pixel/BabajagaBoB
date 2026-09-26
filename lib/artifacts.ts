import crypto from "node:crypto";
import type {KnowledgeState} from "./types";
export type Artifact={id:string;name:string;kind:string;taskId:string;runId:string;sandboxId:string;agentId:string;digest:string;producedAt:string;knowledgeState:KnowledgeState;parentEventId?:string};
const artifacts:Artifact[]=[];
export function recordArtifact(input:Omit<Artifact,"id"|"producedAt"|"digest">,contentDigest:string){const artifact={...input,id:`ART-${crypto.randomUUID()}`,producedAt:new Date().toISOString(),digest:contentDigest};artifacts.unshift(artifact);return structuredClone(artifact)}
export function artifactSnapshot(){return artifacts.map(x=>structuredClone(x))}
