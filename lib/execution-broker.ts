import {getControlState} from "./control-plane";
import {executionGate} from "./execution-gate";
import {capabilityTokens,validateCapabilityToken} from "./authority";
import {recordAudit} from "./audit";
import {activeSandboxRuntime} from "./runtime-factory";\nimport {observe} from "./observability";\nimport {addProvenanceNode,addProvenanceEdge} from "./provenance";
import type {Risk} from "./types";

export type ExecutionRequest={taskId:string;agentId:string;sandboxId:string;capabilityTokenId:string;approvalId?:string;argv:string[]};
const riskRank:Record<Risk,number>={SAFE:0,LOW:1,MODERATE:2,HIGH:3,CRITICAL:4};
function deny(request:ExecutionRequest,reason:string):never{recordAudit({actor:request.agentId||"UNKNOWN",action:"sandbox.execute",resource:request.sandboxId||"UNKNOWN",decision:"DENY"}, {...request,reason});throw new Error(reason)}

export async function executeAuthorized(request:ExecutionRequest){
 if(!request||!request.taskId||!request.agentId||!request.sandboxId||!request.capabilityTokenId) return deny(request||({agentId:"UNKNOWN",sandboxId:"UNKNOWN"} as ExecutionRequest),"Malformed execution request");
 if(!Array.isArray(request.argv)||request.argv.length===0)return deny(request,"Execution argv is empty");
 if(request.argv.some(x=>typeof x!=="string"||x.length===0||x.length>4096))return deny(request,"Invalid execution argument");
 const state=getControlState();
 const task=state.tasks.find(x=>x.id===request.taskId); if(!task)return deny(request,"Task not found");
 const agent=state.agents.find(x=>x.id===request.agentId); if(!agent)return deny(request,"Agent not found");
 if(task.assignedAgent!==request.agentId)return deny(request,"Agent is not assigned to task");
 const sandbox=state.sandboxes.find(x=>x.id===request.sandboxId);
 if(!sandbox){return deny(request,"Sandbox not found");}
 if(sandbox.task!==request.taskId)return deny(request,"Sandbox is not bound to task");
 if(sandbox.agentId!==request.agentId)return deny(request,"Sandbox is not bound to agent");
 const validation=validateCapabilityToken(request.capabilityTokenId,["task:execute","sandbox:run"]); if(!validation.valid)return deny(request,validation.reason);
 const token=capabilityTokens().find(x=>x.id===request.capabilityTokenId); if(!token)return deny(request,"Token not found");
 if(token.subject!==request.agentId)return deny(request,"Token subject mismatch");
 if(token.taskId!==request.taskId)return deny(request,"Token task scope mismatch");
 if(token.sandboxId!==request.sandboxId)return deny(request,"Token sandbox scope mismatch");
 if(riskRank[token.risk]<riskRank[task.risk])return deny(request,"Token risk scope is insufficient");
 const gate=executionGate(task,request.approvalId,state.locked,request.agentId,undefined,request.sandboxId);
 if(!gate.allowed)return deny(request,gate.reasons.join("; "));
 const result=await activeSandboxRuntime.execute(request.sandboxId,request.argv);
 recordAudit({actor:request.agentId,action:"sandbox.execute",resource:request.sandboxId,decision:result.accepted?"ALLOW":"DENY"},request);
 return result;
}
