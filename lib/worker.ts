import {expireLeases,leaseJob,startJob,completeJob,failJob,queueSnapshot} from "./queue";
import {getRun,listRuns,startRun,completeRun,failRun} from "./runs";
import {sandboxRuntime} from "./runtime";

export type WorkerCycle={leased:string[];completed:string[];failed:string[];expired:number};

export async function runWorkerCycle():Promise<WorkerCycle>{
 const result:WorkerCycle={leased:[],completed:[],failed:[],expired:expireLeases()};
 for(const job of queueSnapshot()){
  if(job.state!=="QUEUED") continue;
  const run=listRuns().find(r=>r.jobId===job.id);
  if(!run||!run.sandboxId) continue;
  const leased=leaseJob(job.id);
  if(!leased) continue;
  result.leased.push(job.id);
  if(!startJob(job.id)||!startRun(run.id)) { failJob(job.id,"worker could not start job/run"); failRun(run.id,"worker could not start job/run"); result.failed.push(job.id); continue; }
  try{
   await sandboxRuntime.execute(run.sandboxId,"agent-execution");
   completeJob(job.id); completeRun(run.id); result.completed.push(job.id);
  }catch(error){
   const message=error instanceof Error?error.message:String(error);
   failJob(job.id,message); failRun(run.id,message); result.failed.push(job.id);
  }
 }
 return result;
}

export function workerSnapshot(){
 return {jobs:queueSnapshot(),runs:listRuns()};
}
