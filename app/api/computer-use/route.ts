import {NextResponse} from "next/server";
import {listComputers,registerComputer,allocateComputer,startComputer,releaseComputer} from "@/lib/computer-use";
export const runtime="nodejs"; export const dynamic="force-dynamic";
export async function GET(){return NextResponse.json({computers:listComputers()},{headers:{"Cache-Control":"no-store"}})}
export async function POST(req:Request){
 try{const b=await req.json();
  if(b.action==="register")return NextResponse.json({computer:registerComputer(b.computer)},{status:201});
  if(b.action==="allocate")return NextResponse.json({computer:allocateComputer(b.id,b.taskId,b.sandboxId)});
  if(b.action==="start")return NextResponse.json({computer:startComputer(b.id)});
  if(b.action==="release")return NextResponse.json({computer:releaseComputer(b.id)});
  return NextResponse.json({error:"unsupported computer action"},{status:400});
 }catch(e){return NextResponse.json({error:e instanceof Error?e.message:"invalid request"},{status:400})}
}