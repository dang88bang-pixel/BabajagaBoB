import {NextResponse} from "next/server";import {runGuardian,setLockdown,snapshot} from "../../../lib/control-plane";
export const runtime="nodejs";
export async function GET(){return NextResponse.json(snapshot())}
export async function POST(req:Request){const body=await req.json().catch(()=>({}));if(body.action==="guardian")return NextResponse.json(runGuardian());if(body.action==="lockdown")return NextResponse.json(setLockdown(Boolean(body.locked)));return NextResponse.json({error:"Unsupported control action"},{status:400})}
