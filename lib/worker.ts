import {expireLeases,leaseJob,startJob,completeJob,failJob,heartbeatJob,queueSnapshot} from "./queue";
import {beginRecovery,getRun,listRuns,startRun,completeRun,failRun} from "./runs";
import {activeSandboxRuntime as sandboxRuntime,reconcileActiveRuntime} from "./runtime-factory";

export type WorkerCycle={leased:string[];completed:string[];failed:string[];expired:number;recovered:string[]};

export async function runWorkerCycle():Promise<WorkerCycle>{
 const result:WorkerCycle={leased:[],completed:[],failed:[],expired:0,recovered:[]};
 result.expired=expireLeases();
 await reconcileActiveRuntime();

 // Restart/retry reconciliation: a requeued job may still point to a run that
 // was RUNNING when its previous worker disappeared. Move that run into the
 // explicit recovery state before allowing the new worker attempt to start.
 for(const job of queueSnapshot()){
  if(job.state!=="QUEUED") continue;
  const run=getRun(listRuns().find(r=>r.jobId===job.id)?.id ?? "");
  if(!run) continue;
  if(run.state==="RUNNING"){
   if(beginRecovery(run.id)) result.recovered.push(job.id);
  }else if(run.state==="FAILED"){
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

  if(!startJob(job.id)||!startRun(run.id)) {
   failJob(job.id,"worker could not start job/run");
   failRun(run.id,"worker could not start job/run");
   result.failed.push(job.id);
   continue;
  }

  let heartbeat:ReturnType<typeof setInterval>|undefined;
  try{
   heartbeat=setInterval(()=>{heartbeatJob(job.id)},20_000);
   heartbeatJob(job.id);
   await sandboxRuntime.execute(run.sandboxId,"agent-execution");
   completeJob(job.id);
   completeRun(run.id);
   result.completed.push(job.id);
  }catch(error){
   const message=error instanceof Error?error.message:String(error);
   const nextJob=failJob(job.id,message);
   if(nextJob?.state==="QUEUED"){
    beginRecovery(run.id);
   }else{
    failRun(run.id,message);
   }
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
