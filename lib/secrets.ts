export type SecretLease={id:string;subjectId:string;taskId:string;expiresAt:string;scopes:string[]};
const leases=new Map<string,SecretLease>();
const now=()=>new Date();
export function issueSecretLease(subjectId:string,taskId:string,scopes:string[],ttlMs=300000){
 const lease:SecretLease={id:`SEC-${Date.now()}`,subjectId,taskId,expiresAt:new Date(Date.now()+ttlMs).toISOString(),scopes};
 leases.set(lease.id,lease); return structuredClone(lease);
}
export function validateSecretLease(id:string,subjectId:string,taskId:string){
 const l=leases.get(id); if(!l||l.subjectId!==subjectId||l.taskId!==taskId||new Date(l.expiresAt)<=now())return null; return structuredClone(l);
}
export function redact(value:string){return value.replace(/(Bearer|token|password|secret|api[_-]?key)\s*[:=]\s*[^\s,;]+/gi,"$1=[REDACTED]")}
export function revokeSecretLease(id:string){return leases.delete(id)}
