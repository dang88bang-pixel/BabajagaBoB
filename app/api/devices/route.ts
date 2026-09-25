import {NextResponse} from "next/server";import {allocateDevice,authorizeDevice,discoverDevice,listDevices,releaseDevice} from "../../../lib/devices";
import {guardOrDeny} from "@/lib/api/api-gate";
export const runtime="nodejs";export const dynamic="force-dynamic";
export async function GET(request:Request){const denied=guardOrDeny(request,{action:"device:read"});if(denied)return denied;return NextResponse.json({devices:listDevices()},{headers:{"Cache-Control":"no-store"}})}
export async function POST(request:Request){
 const gate = await import("@/lib/api/api-gate");
 const body = (await request.clone().json().catch(() => ({}))) as {action?:string};
 const creatorOnly = ["authorize","discover","allocate","release"].includes(String(body.action));
 const denied = gate.guardOrDeny(request, {action: creatorOnly ? "device:authorize" : "device:manage", creatorOnly});
 if (denied) return denied;
try{const b=await request.json();if(b.action==="discover")return NextResponse.json(discoverDevice(b.device),{status:201});if(b.action==="authorize")return NextResponse.json(authorizeDevice(String(b.id),Boolean(b.authorized)));if(b.action==="allocate")return NextResponse.json(allocateDevice(String(b.id),String(b.taskId)));if(b.action==="release")return NextResponse.json(releaseDevice(String(b.id)));return NextResponse.json({error:"Unsupported device action"},{status:400})}catch(e){return NextResponse.json({error:e instanceof Error?e.message:"device error"},{status:400})}}