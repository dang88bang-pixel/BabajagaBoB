import {NextResponse} from "next/server";
import {listReliability,prepareRecovery,recordFailure,resolveFailure,verifyRecovery} from "@/lib/reliability";
import {guardOrDeny} from "../../../lib/api/api-gate";
export async function GET(request:Request){const denied=guardOrDeny(request,{action:"reliability:read"});if(denied)return denied;return NextResponse.json(listReliability(),{headers:{"Cache-Control":"no-store"}})}
export async function POST(req:Request){
 const b=await req.json().catch(()=>({}));
 const denied=guardOrDeny(req,{action:"reliability:manage",creatorOnly:["resolve","lock-regression"].includes(String(b.action))});if(denied)return denied;
 try{if(b.action==="failure")return NextResponse.json({failure:recordFailure(b.value)},{status:201});if(b.action==="prepare")return NextResponse.json({plan:prepareRecovery(b.value)},{status:201});if(b.action==="resolve")return NextResponse.json({failure:resolveFailure(b.id,b.rootCause,b.regressionTestId)});if(b.action==="verify")return NextResponse.json({plan:verifyRecovery(b.id)});return NextResponse.json({error:"unknown action"},{status:400})}catch(e){
  // Verifikation fuehrt echte Laeufe aus; eine Verweigerung (Lockdown, Kill Switch,
  // fehlende Autorisierung) ist kein fehlerhafter Request, sondern 409.
  if(e instanceof Error&&e.name==="ExecutionDeniedError")return NextResponse.json({error:e.message,denied:true},{status:409});
  return NextResponse.json({error:e instanceof Error?e.message:"invalid request"},{status:400})}}
