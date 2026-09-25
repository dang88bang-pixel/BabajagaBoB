import {NextResponse} from "next/server";
import {promotionGate} from "@/lib/promotion";
import {listPipelines} from "@/lib/cicd";
export async function POST(req:Request){
 const denied = (await import("@/lib/api/api-gate")).guardOrDeny(req, {action:"promotion:evaluate", creatorOnly:true});
 if (denied) return denied;
const b=(await req.json().catch(()=>({}))) as Record<string,unknown>;
 if(typeof b.pipelineId!=="string")return NextResponse.json({error:"invalid pipelineId"},{status:400});
 const p=listPipelines().find(x=>x.id===b.pipelineId);if(!p)return NextResponse.json({allowed:false,reasons:["pipeline not found"]},{status:404});
 try{const result=promotionGate(p,b.target as never);return NextResponse.json(result,{status:result.allowed?200:403})}catch(e){return NextResponse.json({error:e instanceof Error?e.message:"invalid promotion request"},{status:400})}}
