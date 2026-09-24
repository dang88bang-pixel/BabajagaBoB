import {NextResponse} from "next/server";import {resolveApproval,runGuardian,setLockdown,snapshot} from "../../../lib/control-plane";
export const runtime="nodejs";
export async function GET(){return NextResponse.json(snapshot(),{headers:{"Cache-Control":"no-store"}})}
export async function POST(req:Request){const body=await req.json().catch(()=>({}));if(body.action==="guardian")return NextResponse.json(runGuardian());if(body.action==="lockdown")return NextResponse.json(setLockdown(Boolean(body.locked)));if(body.action==="approval")return NextResponse.json(resolveApproval(String(body.id),Boolean(body.grant)));return NextResponse.json({error:"Unsupported control action"},{status:400})}
