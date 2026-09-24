import {NextResponse} from "next/server";
import {issueSecretLease,validateSecretLease,redact,revokeSecretLease} from "@/lib/secrets";
export async function POST(req:Request){
 const b=await req.json();
 if(b.action==="issue")return NextResponse.json({lease:issueSecretLease(b.subjectId,b.taskId,b.scopes??[],b.ttlMs)});
 if(b.action==="validate")return NextResponse.json({lease:validateSecretLease(b.leaseId,b.subjectId,b.taskId)});
 if(b.action==="revoke")return NextResponse.json({revoked:revokeSecretLease(b.leaseId)});
 if(b.action==="redact")return NextResponse.json({value:redact(String(b.value??""))});
 return NextResponse.json({error:"unknown action"},{status:400});
}
