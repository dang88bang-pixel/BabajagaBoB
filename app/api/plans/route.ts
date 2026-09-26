import {NextResponse} from "next/server";
import {createPlan, listPlans, activatePlan} from "../../../lib/plans";
import {guardRequest, toDeniedResponse} from "../../../lib/api/guard";
export const runtime="nodejs";
export const dynamic="force-dynamic";

export async function GET(req:Request) {
  try {
    guardRequest(req,{action:"plan:read"});
    const objectiveId=new URL(req.url).searchParams.get("objectiveId") ?? undefined;
    return NextResponse.json({plans:listPlans(objectiveId)},{headers:{"Cache-Control":"no-store"}});
  } catch(error) {
    const denied=toDeniedResponse(error); if(denied)return denied; throw error;
  }
}

export async function POST(req:Request) {
  try {
    const body=(await req.json()) as Record<string,unknown>;
    const action=String(body.action??"");
    if(action==="create") {
      const guard=guardRequest(req,{action:"plan:create",creatorOnly:true});
      const plan=createPlan({
        objectiveId:String(body.objectiveId??""),
        taskIds:Array.isArray(body.taskIds)?body.taskIds.filter((v):v is string=>typeof v==="string"):[],
        expectedEffects:Array.isArray(body.expectedEffects)?body.expectedEffects.filter((v):v is string=>typeof v==="string"):[],
        abortCriteria:Array.isArray(body.abortCriteria)?body.abortCriteria.filter((v):v is string=>typeof v==="string"):[],
        createdBy:guard.actor.actorId
      });
      return NextResponse.json({plan},{status:201});
    }
    if(action==="activate") {
      const guard=guardRequest(req,{action:"plan:activate",creatorOnly:true});
      return NextResponse.json({plan:activatePlan(String(body.planId??""),guard.actor.actorId)});
    }
    return NextResponse.json({error:"unknown action",supported:["create","activate"]},{status:400});
  } catch(error) {
    const denied=toDeniedResponse(error); if(denied)return denied;
    return NextResponse.json({error:error instanceof Error?error.message:"invalid request"},{status:400});
  }
}
