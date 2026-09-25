import {NextResponse} from "next/server";
import {listReliability,prepareRecovery,recordFailure,resolveFailure,verifyRecovery} from "@/lib/reliability";
import {guardOrDeny} from "../../../lib/api/api-gate";
import {objectField} from "@/lib/request-validation";
export async function GET(request:Request){const denied=guardOrDeny(request,{action:"reliability:read"});if(denied)return denied;return NextResponse.json(listReliability(),{headers:{"Cache-Control":"no-store"}})}
export async function POST(req:Request){
 const b=await req.json().catch(()=>({}));
 const denied=guardOrDeny(req,{action:"reliability:manage",creatorOnly:["resolve","lock-regression"].includes(String(b.action))});if(denied)return denied;
 // Pflichtfelder vor der Zustandsänderung prüfen: ein fehlendes `id` führte
 // früher zu "recovery plan not found" (404-Semantik) statt zu einem 400.
 const requiredId=(value:unknown)=>{if(typeof value!=="string"||value.length===0)return NextResponse.json({error:"id is required"},{status:400});return null};
 if(b.action==="verify"){const missing=requiredId(b.id);if(missing)return missing;}
 if(b.action==="resolve"){const missing=requiredId(b.id);if(missing)return missing;
   if(typeof b.rootCause!=="string"||b.rootCause.length<5)return NextResponse.json({error:"rootCause is required"},{status:400});}
 if(b.action==="prepare"){if(!b.value||typeof b.value!=="object")return NextResponse.json({error:"value is required"},{status:400});}
 try{if(b.action==="failure")return NextResponse.json({failure:recordFailure(objectField(b,"value") as never)},{status:201});if(b.action==="prepare")return NextResponse.json({plan:prepareRecovery(b.value)},{status:201});if(b.action==="resolve")return NextResponse.json({failure:resolveFailure(b.id,b.rootCause,b.regressionTestId)});// Verifikation ist async und führt echte Läufe aus: ohne await wäre die Antwort
 // ein leeres Plan-Objekt, und eine Verweigerung (z. B. Lockdown) bliebe unsichtbar.
 if(b.action==="verify")return NextResponse.json({plan:await verifyRecovery(b.id)});return NextResponse.json({error:"unknown action"},{status:400})}catch(e){
  // Verifikation fuehrt echte Laeufe aus; eine Verweigerung (Lockdown, Kill Switch,
  // fehlende Autorisierung) ist kein fehlerhafter Request, sondern 409.
  if(e instanceof Error&&e.name==="ExecutionDeniedError")return NextResponse.json({error:e.message,denied:true},{status:409});
  return NextResponse.json({error:e instanceof Error?e.message:"invalid request"},{status:400})}}
