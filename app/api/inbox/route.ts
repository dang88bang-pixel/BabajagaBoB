import {NextResponse} from "next/server";
import {listInbox,notifyInbox,resolveInbox} from "../../../lib/inbox";
import type {InboxMode} from "../../../lib/inbox";
import {guardOrDeny} from "../../../lib/api/api-gate";

export const runtime="nodejs";export const dynamic="force-dynamic";

const MODES: InboxMode[] = ["INFORM", "ASK", "BLOCK", "ESCALATE"];

/**
 * Creator Inbox (Abschnitt 33).
 *
 * GET                      Liste (neueste zuerst)
 * POST {action:"notify"}   INFORM/ASK/BLOCK/ESCALATE eintragen (Agent oder Creator)
 * POST {action:"resolve"}  beantworten — ausschließlich Creator
 *
 * Wichtig: `resolve` ist ein eigener Zweig. Zuvor stand er hinter einem
 * `return` und war damit unerreichbar (jede Anfrage legte stattdessen einen
 * neuen Eintrag an).
 */
export async function GET(request:Request){
  const denied=guardOrDeny(request,{action:"inbox:read"});if(denied)return denied;
  return NextResponse.json({items:listInbox()},{headers:{"Cache-Control":"no-store"}});
}

export async function POST(request:Request){
  const body=await request.json().catch(()=>({}));
  const resolving=body.action==="resolve";
  if(body.action!=="notify"&&!resolving)return NextResponse.json({error:"Unsupported inbox action",supported:["notify","resolve"]},{status:400});
  const denied=guardOrDeny(request,{action:resolving?"inbox:resolve":"inbox:notify",creatorOnly:resolving});
  if(denied)return denied;
  try{
    if(resolving){
      if(typeof body.id!=="string"||body.id.length===0)return NextResponse.json({error:"id is required"},{status:400});
      const decision=typeof body.decision==="string"&&body.decision.length>0?body.decision:"ACKNOWLEDGED";
      return NextResponse.json({item:resolveInbox(body.id,"CREATOR",decision)}, {status:200});
    }
    const item=body.item;
    if(!item||typeof item!=="object"||Array.isArray(item))return NextResponse.json({error:"item is required"},{status:400});
    if(!MODES.includes(item.mode))return NextResponse.json({error:`mode must be one of ${MODES.join(", ")}`},{status:400});
    if(typeof item.title!=="string"||item.title.length===0)return NextResponse.json({error:"item.title is required"},{status:400});
    if(typeof item.message!=="string"||item.message.length===0)return NextResponse.json({error:"item.message is required"},{status:400});
    return NextResponse.json({item:notifyInbox(item)},{status:201});
  }catch(error){
    return NextResponse.json({error:error instanceof Error?error.message:"inbox error"},{status:400});
  }
}
