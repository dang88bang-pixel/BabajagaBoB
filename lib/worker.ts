import {expireLeases,leaseJob,startJob,completeJob,failJob,heartbeatJob,queueSnapshot} from "./queue";
import {beginRecovery,getRun,listRuns,startRun,completeRun,failRun} from "./runs";
import {activeSandboxRuntime as sandboxRuntime,reconcileActiveRuntime,runtimeHandle,activeRuntimeMode} from "./runtime-factory";
import {createErrorIncident,transitionError,investigateError} from "./error-intelligence";
import {ensureExecutionCapability} from "./authority";
import {executeAuthorized} from "./execution-broker";

export type WorkerCycle={leased:string[];completed:string[];failed:string[];expired:number;recovered:string[]};

export async function runWorkerCycle():Promise<WorkerCycle>{
 const result:WorkerCycle={leased:[],completed:[],failed:[],expired:0,recovered:[]};
 result.expired=expireLeases();
 await reconcileActiveRuntime();

 for(const job of queueSnapshot()){
  if(job.state!=="QUEUED") continue;
  const run=getRun(listRuns().find(r=>r.jobId===job.id)?.id ?? "");
  if(!run) continue;
  if(run.state==="RUNNING"||run.state==="FAILED"){
   if(beginRecovery(run.id)) result.recovered.push(job.id);
  }
 }

 for(const job of queueSnapshot()){
  if(job.state!=="QUEUED") continue;
  const run=listRuns().find(r=>r.jobId===job.id);
  if(!run||!run.sandboxId) continue;
  const leased=leaseJob(job.id);
  if(!leased) continue;
  result.leased.push(job.id);

  if(!startJob(job.id)||!startRun(run.id)){
   failJob(job.id,"worker could not start job/run");
   failRun(run.id,"worker could not start job/run");
   result.failed.push(job.id);
   continue;
  }

  let heartbeat:ReturnType<typeof setInterval>|undefined;
  try{
   heartbeat=setInterval(()=>{heartbeatJob(job.id)},20_000);
   heartbeatJob(job.id);

   // In OCI mode, reconciliation is authoritative for sandbox liveness.
   // Never execute a run against a missing, stopped, paused, or failed container.
   if(activeRuntimeMode==="oci"){
    const handle=runtimeHandle(run.sandboxId);
    if(!handle||handle.state!=="RUNNING") throw new Error(`sandbox runtime is not executable: ${handle?.state??"MISSING"}`);
   }

   const capability=ensureExecutionCapability(run.agentId,run.taskId,run.sandboxId,queueSnapshot().find(x=>x.id===job.id)?.risk??"LOW");
   await executeAuthorized({taskId:run.taskId,agentId:run.agentId,sandboxId:run.sandboxId,capabilityTokenId:capability.id,argv:["agent-execution"]});
   completeJob(job.id);
   completeRun(run.id);
   result.completed.push(job.id);
  }catch(error){
   const message=error instanceof Error?error.message:String(error);
   const incident=createErrorIncident({severity:"HIGH",symptom:"Worker execution failed",incident:message,failureMode:"RUN_EXECUTION_FAILURE",contributingFactors:["worker execution path"],evidenceIds:[],taskId:run.taskId,runId:run.id,agentId:run.agentId,sandboxId:run.sandboxId,error:message});
   transitionError(incident.id,"TRIAGING");
   investigateError(incident.id);
   const nextJob=failJob(job.id,message);
   if(nextJob?.state==="QUEUED") beginRecovery(run.id);
   else failRun(run.id,message);
   result.failed.push(job.id);
  }finally{
   if(heartbeat) clearInterval(heartbeat);
  }
 }
 return result;
}

export function workerSnapshot(){
 return {jobs:queueSnapshot(),runs:listRuns()};
}
