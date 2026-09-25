import {NextResponse} from "next/server";
import {abacAllows,roleAllows,authorityGraph,capabilityTokenViews,issueCapabilityToken,addAuthorityEdge} from "@/lib/authority";
import type {Role,SubjectContext,PolicyContext} from "@/lib/authority";
import {guardOrDeny} from "@/lib/api/api-gate";
import {KNOWN_ROLES} from "@/lib/authority";
export const runtime="nodejs";
export async function GET(req:Request){const denied=guardOrDeny(req,{action:"authority:read"});if(denied)return denied;return NextResponse.json({edges:authorityGraph(),tokens:capabilityTokenViews()})}
export async function POST(req:Request){
 try{
  const body=await req.json();
  // Rechte ausstellen/delegieren ist ausschliesslich Creator-Sache.
  const denied=guardOrDeny(req,{action:body.kind==="TOKEN"?"authority:issue":body.kind==="EDGE"?"authority:delegate":"authority:read",creatorOnly:body.kind==="TOKEN"||body.kind==="EDGE"});if(denied)return denied;
  if(body.mode==="role-check"){
    // Unbekannte Rolle ist ein Aufruffehler (400 mit Klartext), keine Ausnahme
    // aus dem Rechte-Modul und keine stille Verweigerung ohne Begründung.
    if(typeof body.role!=="string"||!KNOWN_ROLES.includes(body.role))return NextResponse.json({error:"unknown role",known:KNOWN_ROLES},{status:400});
    if(typeof body.capability!=="string"||body.capability.length===0)return NextResponse.json({error:"capability is required"},{status:400});
    const allowed=roleAllows(body.role as Role,body.capability);return NextResponse.json({allowed,reason:allowed?"role grants capability":"role does not grant capability"});
  }
  if(body.mode==="authorize"){
    const subject=body.subject as SubjectContext|undefined;
    if(!subject||typeof subject!=="object"||typeof subject.role!=="string"||!KNOWN_ROLES.includes(subject.role))return NextResponse.json({error:"subject with a known role is required",known:KNOWN_ROLES},{status:400});
    if(!body.policy||typeof body.policy!=="object")return NextResponse.json({error:"policy is required"},{status:400});
    const result=abacAllows(subject,body.policy as PolicyContext);return NextResponse.json(result,{status:result.allowed?200:403});
  }
  if(body.kind==="EDGE")return NextResponse.json({edge:addAuthorityEdge(body.edge)},{status:201});
  if(body.kind==="TOKEN")return NextResponse.json({token:issueCapabilityToken(body.token)},{status:201});
  return NextResponse.json({error:"unsupported capability request"},{status:400});
 }catch(error){return NextResponse.json({error:error instanceof Error?error.message:"invalid capability request"},{status:400});}
}