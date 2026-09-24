import {getControlState} from "./control-plane";
import {executionGate} from "./execution-gate";
import {validateCapabilityToken} from "./authority";
import {recordAudit} from "./audit";
import {activeSandboxRuntime} from "./runtime-factory";

export type ExecutionRequest={taskId:string;agentId:string;sandboxId:string;capabilityTokenId:string;approvalId?:string;argv:string[]};

export async function executeAuthorized(request:ExecutionRequest){
 if(request.argv.length===0) throw new Error("Execution argv is empty");
 const state=getControlState();
 const task=state.tasks.find(x=>x.id===request.taskId);
 if(!task) throw new Error("Task not found");
 const token=validateCapabilityToken(request.capabilityTokenId,["task:execute","sandbox:run"]);
 if(!token.valid) throw new Error(token.reason);
 const tokenRecord=state.agents.find(x=>x.id===request.agentId);
 if(!tokenRecord) throw new Error("Agent not found");
 const gate=executionGate(task,request.approvalId,state.locked,request.agentId,undefined,request.sandboxId);
 if(!gate.allowed) throw new Error(gate.reasons.join("; "));
 const result=await activeSandboxRuntime.execute(request.sandboxId,request.argv);
 recordAudit({actor:request.agentId,action:"sandbox.execute",resource:request.sandboxId,decision:result.accepted?"ALLOW":"DENY"},request);
 return result;
}
