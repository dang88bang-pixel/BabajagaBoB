import {NextResponse} from "next/server";
import {listRuntimes,registerRuntime} from "@/lib/runtime-registry";
import {guardOrDeny} from "../../../lib/api/api-gate";
export async function GET(request:Request){const denied=guardOrDeny(request,{action:"runtime:registry:read"});if(denied)return denied;return NextResponse.json({runtimes:listRuntimes()},{headers:{"Cache-Control":"no-store"}})}
export async function POST(req:Request){
 const denied=guardOrDeny(req,{action:"runtime:registry:register",creatorOnly:true});if(denied)return denied;
 try{
  const body=await req.json();
  // Vertrag: {action:"register", input:{…}} oder {action:"register", …definition}.
  // Früher wurde der ganze Body als Laufzeit gespeichert — inklusive `action`-Schlüssel.
  if(body?.action!=="register")return NextResponse.json({error:"unsupported action"},{status:400});
  const definition=(body.input&&typeof body.input==="object"&&!Array.isArray(body.input))?body.input:Object.fromEntries(Object.entries(body).filter(([key])=>key!=="action"));
  return NextResponse.json({runtime:registerRuntime(definition as Parameters<typeof registerRuntime>[0])},{status:201});
 }catch(e){return NextResponse.json({error:e instanceof Error?e.message:"invalid runtime"},{status:400})}}
