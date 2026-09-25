import {NextResponse} from "next/server";import {auditIntegrity,auditSnapshot,verifyAuditChain} from "../../../lib/audit";
import {guardOrDeny} from "../../../lib/api/api-gate";
export const dynamic="force-dynamic";
export async function GET(request:Request){const denied=guardOrDeny(request,{action:"audit:read"});if(denied)return denied;return NextResponse.json({records:auditSnapshot(),integrity:auditIntegrity(),chain:verifyAuditChain()},{headers:{"Cache-Control":"no-store"}})}
/**
 * Audit-Aktionen: `verify` ist ein Lesevorgang und Session-gebunden. Loeschen ist
 * ausdruecklich nicht vorgesehen (append-only).
 */
export async function POST(request:Request){
 const body=await request.json().catch(()=>({}));
 const denied=guardOrDeny(request,{action:"audit:read"});if(denied)return denied;
 if(body.action==="verify")return NextResponse.json({chain:verifyAuditChain(),integrity:auditIntegrity()});
 return NextResponse.json({error:"unsupported audit action",note:"audit is append-only"},{status:400});
}
