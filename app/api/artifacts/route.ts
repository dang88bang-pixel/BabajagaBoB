import {requireControlPlaneAuth} from "@/lib/control-auth";
import {artifactSnapshot,recordArtifact} from "../../../lib/artifacts";

export async function GET(){return Response.json({artifacts:artifactSnapshot()})}
export async function POST(request:Request){
 requireControlPlaneAuth(request);
 try{
  const body=await request.json();
  if(typeof body.contentDigest!=="string")return Response.json({error:"contentDigest is required"},{status:400});
  return Response.json({artifact:recordArtifact(body.artifact,body.contentDigest)},{status:201});
 }catch(error){
  return Response.json({error:error instanceof Error?error.message:"invalid artifact"},{status:400});
 }
}
