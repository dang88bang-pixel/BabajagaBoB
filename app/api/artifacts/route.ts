import {artifactSnapshot,recordArtifact} from "../../../lib/artifacts";

import {guardOrDeny} from "../../../lib/api/api-gate";
export async function GET(request:Request){const denied=guardOrDeny(request,{action:"artifact:read"});if(denied)return denied;return Response.json({artifacts:artifactSnapshot()})}
export async function POST(request:Request){
  const denied=guardOrDeny(request,{action:"artifact:write"});if(denied)return denied;
 try{
  const body=await request.json();
  if(typeof body.contentDigest!=="string")return Response.json({error:"contentDigest is required"},{status:400});
  return Response.json({artifact:recordArtifact(body.artifact,body.contentDigest)},{status:201});
 }catch(error){
  return Response.json({error:error instanceof Error?error.message:"invalid artifact"},{status:400});
 }
}
