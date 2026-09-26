import {NextResponse} from "next/server";
import {createPipeline,listPipelines,promote,updateCheck} from "@/lib/cicd";
import {guardOrDeny} from "@/lib/api/api-gate";
import {objectField} from "@/lib/request-validation";
export async function GET(request:Request){const denied=guardOrDeny(request,{action:"cicd:read"});if(denied)return denied;return NextResponse.json({pipelines:listPipelines()},{headers:{"Cache-Control":"no-store"}})}
export async function POST(req:Request){
 const denied = (await import("@/lib/api/api-gate")).guardOrDeny(req, {action:"cicd:manage", creatorOnly:true});
 if (denied) return denied;
try{const b=await req.json();if(b.action==="create")return NextResponse.json({pipeline:createPipeline(objectField(b,"value") as unknown as Parameters<typeof createPipeline>[0])},{status:201});if(b.action==="check")return NextResponse.json({pipeline:updateCheck(b.pipelineId,b.kind,b.status,b.summary??"")});if(b.action==="promote")return NextResponse.json({pipeline:promote(b.pipelineId,b.stage)});return NextResponse.json({error:"unknown action"},{status:400})}catch(e){return NextResponse.json({error:e instanceof Error?e.message:"invalid request"},{status:400})}}
