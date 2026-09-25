import {requireControlPlaneAuth} from "@/lib/control-auth";
import {NextResponse} from "next/server";import {listInbox,notifyInbox,resolveInbox} from "../../../lib/inbox";
export const runtime="nodejs";export const dynamic="force-dynamic";
export async function GET(){return NextResponse.json({items:listInbox()},{headers:{"Cache-Control":"no-store"}})}
export async function POST(request:Request){
 requireControlPlaneAuth(req);
try{const b=await request.json();if(b.action==="notify")return NextResponse.json(notifyInbox(b.item),{status:201});if(b.action==="resolve")return NextResponse.json(resolveInbox(String(b.id)));return NextResponse.json({error:"Unsupported inbox action"},{status:400})}catch(e){return NextResponse.json({error:e instanceof Error?e.message:"inbox error"},{status:400})}}