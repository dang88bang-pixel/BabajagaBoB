import {NextResponse} from "next/server";
import {abacAllows,roleAllows} from "@/lib/authority";
import type {Role,SubjectContext,PolicyContext} from "@/lib/authority";

export async function POST(req:Request){
 const body=await req.json();
 if(body.mode==="role-check"){
  const allowed=roleAllows(body.role as Role,body.capability);
  return NextResponse.json({allowed,reason:allowed?"role grants capability":"role does not grant capability"});
 }
 if(body.mode==="authorize"){
  const subject=body.subject as SubjectContext, policy=body.policy as PolicyContext;
  const result=abacAllows(subject,policy);
  return NextResponse.json(result,{status:result.allowed?200:403});
 }
 return NextResponse.json({error:"mode must be role-check or authorize"},{status:400});
}

import {authorityGraph,capabilityTokens,issueCapabilityToken,addAuthorityEdge} from "../../../lib/authority";

export async function GET(){return Response.json({edges:authorityGraph(),tokens:capabilityTokens()})}
export async function POST(request:Request){
 try{
  const body=await request.json();
  if(body.kind==="EDGE")return Response.json({edge:addAuthorityEdge(body.edge)},{status:201});
  if(body.kind==="TOKEN")return Response.json({token:issueCapabilityToken(body.token)},{status:201});
  return Response.json({error:"kind must be EDGE or TOKEN"},{status:400});
 }catch(error){
  return Response.json({error:error instanceof Error?error.message:"invalid capability request"},{status:400});
 }
}
