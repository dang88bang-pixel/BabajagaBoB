import {requireControlPlaneAuth} from "@/lib/control-auth";
import {NextResponse} from "next/server";
import {promotionGate} from "@/lib/promotion";
import {listPipelines} from "@/lib/cicd";
export async function POST(req:Request){
 requireControlPlaneAuth(req);const b=await req.json();const p=listPipelines().find(x=>x.id===b.pipelineId);if(!p)return NextResponse.json({allowed:false,reasons:["pipeline not found"]},{status:404});const result=promotionGate(p,b.target);return NextResponse.json(result,{status:result.allowed?200:403})}
