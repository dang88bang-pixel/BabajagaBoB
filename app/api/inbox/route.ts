import {NextResponse} from "next/server";import {listInbox,notifyInbox,resolveInbox} from "../../../lib/inbox";
export const runtime="nodejs";export const dynamic="force-dynamic";
import {guardOrDeny} from "../../../lib/api/api-gate";
export async function GET(request:Request){const denied=guardOrDeny(request,{action:"inbox:read"});if(denied)return denied;return NextResponse.json({items:listInbox()},{headers:{"Cache-Control":"no-store"}})}
export async function POST(request:Request){
  const b=await request.json().catch(()=>({}));
  const denied=guardOrDeny(request,{action:b.action==="resolve"?"inbox:resolve":"inbox:notify",creatorOnly:b.action==="resolve"});if(denied)return denied;
  try{return NextResponse.json(notifyInbox(b.item),{status:201});if(b.action==="resolve")return NextResponse.json(resolveInbox(String(b.id)));return NextResponse.json({error:"Unsupported inbox action"},{status:400})}catch(e){return NextResponse.json({error:e instanceof Error?e.message:"inbox error"},{status:400})}}