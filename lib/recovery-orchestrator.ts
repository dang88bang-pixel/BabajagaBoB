import {getControlState} from "./control-plane";
import {recordFailure,prepareRecovery,resolveFailure,verifyRecovery,listReliability} from "./reliability";
import {setKillSwitch} from "./governance";
import type {Risk} from "./types";
import {runningBuildId} from "./release";

export function detectReadiness(){
 const s=getControlState();
 const active=s.tasks.filter(t=>["RUNNING","EXECUTING","EXPERIMENT","TESTING"].includes(t.status)).length;
 const blocked=s.tasks.filter(t=>t.status==="BLOCKED"||t.status==="ERROR").length;
 // Ausgelieferter Stand: Das Deployment braucht eine messbare Build-ID, sonst
 // bliebe "aktiv" eine Behauptung. Der Wert ist ein Betriebsdetail, kein Geheimnis.
 const running=runningBuildId();
 return {activeTasks:active,blockedTasks:blocked,lockdown:s.locked,ready:!s.locked&&blocked===0,
   buildId:running.buildId,releaseId:running.releaseId,workingDirectory:running.cwd};
}
export function recoverFailure(failureId:string,taskId:string,risk:Risk){
 const plan=prepareRecovery({failureId,steps:["isolate affected execution","collect diagnostics","restore known-good artifact","rerun verification"],verificationPlan:["regression test","smoke verification"]});
 setKillSwitch("TASK",taskId,true,"Recovery isolation");
 return {plan,isolated:true,risk};
}
export {recordFailure,resolveFailure,verifyRecovery,listReliability};
