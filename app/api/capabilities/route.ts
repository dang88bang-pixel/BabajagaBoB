import {NextResponse} from "next/server";
import {abacAllows,roleAllows,authorityGraph,capabilityTokens,issueCapabilityToken,addAuthorityEdge} from "@/lib/authority";
import type {Role,SubjectContext,PolicyContext} from "@/lib/authority";
import {guardOrDeny} from "@/lib/api/api-gate";
export const runtime="nodejs";
export async function GET(req:Request){const denied=guardOrDeny(req,{action:"authority:read"});if(denied)return denied;return NextResponse.json({edges:authorityGraph(),tokens:capabilityTokens()})}
export async function POST(req:Request){
 try{
  const body=await req.json();
  // Rechte ausstellen/delegieren ist ausschliesslich Creator-Sache.
  const denied=guardOrDeny(req,{action:body.kind==="TOKEN"?"authority:issue":body.kind==="EDGE"?"authority:delegate":"authority:read",creatorOnly:body.kind==="TOKEN"||body.kind==="EDGE"});if(denied)return denied;
  if(body.mode==="role-check"){const allowed=roleAllows(body.role as Role,body.capability);return NextResponse.json({allowed,reason:allowed?"role grants capability":"role does not grant capability"});}
  if(body.mode==="authorize"){const result=abacAllows(body.subject as SubjectContext,body.policy as PolicyContext);return NextResponse.json(result,{status:result.allowed?200:403});}
  if(body.kind==="EDGE")return NextResponse.json({edge:addAuthorityEdge(body.edge)},{status:201});
  if(body.kind==="TOKEN")return NextResponse.json({token:issueCapabilityToken(body.token)},{status:201});
  return NextResponse.json({error:"unsupported capability request"},{status:400});
 }catch(error){return NextResponse.json({error:error instanceof Error?error.message:"invalid capability request"},{status:400});}
}