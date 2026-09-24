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
