import {NextResponse} from "next/server";
import {listRuntimes,registerRuntime} from "@/lib/runtime-registry";
import {guardOrDeny} from "../../../lib/api/api-gate";
export async function GET(request:Request){const denied=guardOrDeny(request,{action:"runtime:registry:read"});if(denied)return denied;return NextResponse.json({runtimes:listRuntimes()},{headers:{"Cache-Control":"no-store"}})}
export async function POST(req:Request){
 const denied=guardOrDeny(req,{action:"runtime:registry:register",creatorOnly:true});if(denied)return denied;
 try{return NextResponse.json({runtime:registerRuntime(await req.json())},{status:201})}catch(e){return NextResponse.json({error:e instanceof Error?e.message:"invalid runtime"},{status:400})}}
