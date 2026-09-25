import {NextResponse} from "next/server";
import {issueSecretLease,validateSecretLease,redact,revokeSecretLease} from "@/lib/secrets";
export async function POST(req:Request){
 const denied = (await import("@/lib/api/api-gate")).guardOrDeny(req, {action:"secret:manage", creatorOnly:true});
 if (denied) return denied;

 // Ein unlesbarer Body oder eine unzulässige Lease ist eine 400, kein 500.
 const b=(await req.json().catch(()=>({}))) as Record<string,unknown>;
 try{
  if(b.action==="issue")return NextResponse.json({lease:issueSecretLease(b.subjectId as string,b.taskId as string,(b.scopes??[]) as string[],b.ttlMs as number|undefined)});
  // Pflichtfelder: ohne Kennung lieferten `validate`/`revoke` früher 200 mit
  // `lease:null` bzw. `revoked:false` (stiller No-Op), `redact` einen leeren
  // „Erfolg". Jetzt: 400 mit Begründung, keine Scheinbestätigung.
  const requires=(name:string,value:unknown)=>{if(typeof value!=="string"||value.trim().length===0)throw new Error(`${name} required`)};
  // Die Lease wird als `{lease:{id}}` ausgestellt, geprüft wird also dieselbe
  // Kennung: `leaseId` ist der kanonische Name, `id` wird zusätzlich akzeptiert
  // (früher schlug die Prüfung mit der eigenen Ausgabekennung fehl).
  const leaseId=(b.leaseId??b.id) as unknown;
  if(b.action==="validate"){requires("leaseId",leaseId);requires("subjectId",b.subjectId);requires("taskId",b.taskId);
    const lease=validateSecretLease(leaseId as string,b.subjectId as string,b.taskId as string);
    if(!lease)throw new Error("secret lease not found or not valid for this subject");
    return NextResponse.json({lease});}
  if(b.action==="revoke"){requires("leaseId",leaseId);
    const revoked=revokeSecretLease(leaseId as string);
    if(!revoked)throw new Error("secret lease not found");
    return NextResponse.json({revoked});}
  if(b.action==="redact"){requires("value",b.value);
    return NextResponse.json({value:redact(b.value as string)});}
  return NextResponse.json({error:"unknown action"},{status:400});
 }catch(e){return NextResponse.json({error:e instanceof Error?e.message:"invalid secret request"},{status:400})}
}
