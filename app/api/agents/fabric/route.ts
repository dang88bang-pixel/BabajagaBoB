import {NextResponse} from "next/server";
import {heartbeatAgent,listAgentNodes,listHandoffs,requestHandoff,resolveHandoff,updateAgentStatus} from "@/lib/agent-fabric";
import {actionField,readJson,stringField} from "@/lib/request-validation";
import {requireControlPlaneAuth} from "@/lib/control-auth";

export async function GET(){
 return NextResponse.json({agents:listAgentNodes(),handoffs:listHandoffs()},{headers:{"Cache-Control":"no-store"}});
}

export async function POST(req:Request){
 try{
  requireControlPlaneAuth(req);
  const b=await readJson(req);
  const action=actionField(b,["heartbeat","status","handoff","resolve"]);
  if(action==="heartbeat")return NextResponse.json({agent:heartbeatAgent(stringField(b,"id",128))});
  if(action==="status")return NextResponse.json({agent:updateAgentStatus(
   stringField(b,"id",128),
   b.status as Parameters<typeof updateAgentStatus>[1],
   typeof b.progress==="number"?b.progress:undefined,
   typeof b.task==="string"?b.task:undefined
  )});
  if(action==="handoff")return NextResponse.json({handoff:requestHandoff(
   stringField(b,"fromAgentId",128),
   stringField(b,"toAgentId",128),
   stringField(b,"taskId",128),
   stringField(b,"reason",4096)
  )},{status:201});
  return NextResponse.json({handoff:resolveHandoff(
   stringField(b,"id",128),
   b.status as Parameters<typeof resolveHandoff>[1]
  )});
 }catch(e){
  return NextResponse.json({error:e instanceof Error?e.message:"invalid request"},{status:400});
 }
}
