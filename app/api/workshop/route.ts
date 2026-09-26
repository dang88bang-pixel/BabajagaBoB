import {requireControlPlaneAuth} from "@/lib/control-auth";
import {NextResponse} from "next/server";
import {advanceWorkshop,createWorkshopItem,listWorkshop} from "@/lib/workshop";
export async function GET(){return NextResponse.json({items:listWorkshop()},{headers:{"Cache-Control":"no-store"}})}
export async function POST(req:Request){
 requireControlPlaneAuth(req);
try{const b=await req.json();if(b.action==="create")return NextResponse.json({item:createWorkshopItem(b.value)},{status:201});if(b.action==="advance")return NextResponse.json({item:advanceWorkshop(b.id,b.stage)});return NextResponse.json({error:"unknown action"},{status:400})}catch(e){return NextResponse.json({error:e instanceof Error?e.message:"invalid request"},{status:400})}}
