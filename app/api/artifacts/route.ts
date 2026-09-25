import {artifactSnapshot,getArtifact,recordArtifact,verifyArtifact} from "../../../lib/artifacts";

import {guardOrDeny} from "../../../lib/api/api-gate";
/**
 * Evidenz/Artefakte (Abschnitt 4).
 *
 * GET  ?taskId=&runId=&sandboxId=&kind=   Liste (optional gefiltert)
 * GET  ?verify=ART-…                      Digest-Prüfung eines Datensatzes
 * POST {artifact:{…}, content:"…"}        Evidenz aufnehmen (Digest bildet der Server)
 *
 * Ein vom Aufrufer gelieferter Digest wird bewusst **nicht** akzeptiert: er wäre
 * nicht überprüfbar. Der Inhalt ist Pflicht.
 */
export async function GET(request:Request){
  const denied=guardOrDeny(request,{action:"artifact:read"});if(denied)return denied;
  const url=new URL(request.url);
  const verify=url.searchParams.get("verify");
  if(verify){
    const artifact=getArtifact(verify);
    if(!artifact)return Response.json({error:"artifact not found"},{status:404});
    return Response.json({verification:verifyArtifact(verify), artifact});
  }
  const artifacts=artifactSnapshot({
    taskId:url.searchParams.get("taskId")??undefined,
    runId:url.searchParams.get("runId")??undefined,
    sandboxId:url.searchParams.get("sandboxId")??undefined,
    kind:url.searchParams.get("kind")??undefined
  });
  return Response.json({artifacts, count:artifacts.length});
}
export async function POST(request:Request){
  const denied=guardOrDeny(request,{action:"artifact:write"});if(denied)return denied;
 try{
  const body=await request.json();
  if(typeof body.content!=="string")return Response.json({error:"content is required (digest is computed server-side)"},{status:400});
  if(!body.artifact||typeof body.artifact!=="object"||Array.isArray(body.artifact))return Response.json({error:"artifact is required"},{status:400});
  return Response.json({artifact:recordArtifact(body.artifact,body.content)},{status:201});
 }catch(error){
  return Response.json({error:error instanceof Error?error.message:"invalid artifact"},{status:400});
 }
}
