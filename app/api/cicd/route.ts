import {NextResponse} from "next/server";
import {createPipeline,listPipelines,promote,updateCheck} from "@/lib/cicd";
import {actionField,readJson,stringField} from "@/lib/request-validation";
import {requireControlPlaneAuth} from "@/lib/control-auth";

export const runtime="nodejs";
export const dynamic="force-dynamic";

export async function GET(){
 return NextResponse.json({pipelines:listPipelines()},{headers:{"Cache-Control":"no-store"}});
}

export async function POST(req:Request){
 try{
  requireControlPlaneAuth(req);
  const b=await readJson(req);
  const action=actionField(b,["create","check","promote"]);
  if(action==="create"){
   if(!b.value||typeof b.value!=="object"||Array.isArray(b.value))throw new Error("pipeline value object required");
   return NextResponse.json({pipeline:createPipeline(b.value as Parameters<typeof createPipeline>[0])},{status:201});
  }
  if(action==="check"){
   return NextResponse.json({pipeline:updateCheck(
    stringField(b,"pipelineId",128),
    b.kind as Parameters<typeof updateCheck>[1],
    b.status as Parameters<typeof updateCheck>[2],
    typeof b.summary==="string"?b.summary:""
   )});
  }
  return NextResponse.json({pipeline:promote(
   stringField(b,"pipelineId",128),
   b.stage as Parameters<typeof promote>[1]
  )});
 }
 catch(e){
  return NextResponse.json({error:e instanceof Error?e.message:"invalid request"},{status:400});
 }
}
