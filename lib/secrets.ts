export type SecretLease={id:string;subjectId:string;taskId:string;expiresAt:string;scopes:string[]};
const leases=new Map<string,SecretLease>();
const now=()=>new Date();
export function issueSecretLease(subjectId:string,taskId:string,scopes:string[],ttlMs=300000){
 // Eine Lease ohne Subjekt und Aufgabe ist nicht prüfbar (validate vergleicht
 // beides) und damit wertlos — sie wird gar nicht erst ausgestellt.
 if(typeof subjectId!=="string"||subjectId.trim().length===0)throw new Error("secret lease requires a subject");
 if(typeof taskId!=="string"||taskId.trim().length===0)throw new Error("secret lease requires a task");
 if(!Array.isArray(scopes))throw new Error("secret lease scopes required");
 if(typeof ttlMs!=="number"||!Number.isFinite(ttlMs)||ttlMs<=0||ttlMs>86_400_000)throw new Error("secret lease ttl must be between 1ms and 24h");
 const lease:SecretLease={id:`SEC-${Date.now()}`,subjectId,taskId,expiresAt:new Date(Date.now()+ttlMs).toISOString(),scopes};
 leases.set(lease.id,lease); return structuredClone(lease);
}
export function validateSecretLease(id:string,subjectId:string,taskId:string){
 const l=leases.get(id); if(!l||l.subjectId!==subjectId||l.taskId!==taskId||new Date(l.expiresAt)<=now())return null; return structuredClone(l);
}
export function redact(value:string){return value.replace(/(Bearer|token|password|secret|api[_-]?key)\s*[:=]\s*[^\s,;]+/gi,"$1=[REDACTED]")}
export function revokeSecretLease(id:string){return leases.delete(id)}
