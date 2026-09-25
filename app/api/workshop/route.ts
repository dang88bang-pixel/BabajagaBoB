import {NextResponse} from "next/server";
import {advanceWorkshop,createWorkshopItem,listWorkshop} from "@/lib/workshop";
import {guardOrDeny} from "../../../lib/api/api-gate";
export async function GET(request:Request){const denied=guardOrDeny(request,{action:"workshop:read"});if(denied)return denied;return NextResponse.json({items:listWorkshop()},{headers:{"Cache-Control":"no-store"}})}
export async function POST(req:Request){
 const denied=guardOrDeny(req,{action:"workshop:manage",creatorOnly:true});if(denied)return denied;
 try{const b=await req.json();if(b.action==="create")return NextResponse.json({item:createWorkshopItem(b.value)},{status:201});if(b.action==="advance")return NextResponse.json({item:advanceWorkshop(b.id,b.stage)});return NextResponse.json({error:"unknown action"},{status:400})}catch(e){return NextResponse.json({error:e instanceof Error?e.message:"invalid request"},{status:400})}}
