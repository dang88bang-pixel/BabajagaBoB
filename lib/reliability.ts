export type FailureRecord={id:string;taskId?:string;runId?:string;symptom:string;incident:string;failureMode:string;rootCause?:string;contributingFactors:string[];prevention:string[];regressionTestId?:string;status:"OPEN"|"ANALYZING"|"RESOLVED"|"VERIFIED";createdAt:string};
export type RecoveryPlan={id:string;failureId:string;steps:string[];rollbackArtifactId?:string;diagnosticSandboxId?:string;verification:string[];status:"PREPARED"|"EXECUTING"|"VERIFIED"|"FAILED"};
const failures:FailureRecord[]=[];const plans:RecoveryPlan[]=[];
const clone=<T,>(x:T):T=>structuredClone(x);
export function recordFailure(x:Omit<FailureRecord,"id"|"createdAt"|"status">){const f={...x,id:`FAIL-${Date.now()}`,createdAt:new Date().toISOString(),status:"OPEN" as const};failures.push(f);return clone(f)}
export function prepareRecovery(x:Omit<RecoveryPlan,"id"|"status">){const p={...x,id:`REC-${Date.now()}`,status:"PREPARED" as const};plans.push(p);return clone(p)}
export function resolveFailure(id:string,rootCause:string,regressionTestId?:string){const f=failures.find(x=>x.id===id);if(!f)throw new Error("failure not found");f.rootCause=rootCause;f.regressionTestId=regressionTestId;f.status="RESOLVED";return clone(f)}
export function verifyRecovery(id:string){const p=plans.find(x=>x.id===id);if(!p)throw new Error("recovery plan not found");p.status="VERIFIED";return clone(p)}
export function listReliability(){return clone({failures,plans})}
