import {NextResponse} from "next/server";
import type {ControlState} from "../../../lib/types";
import {DurableJsonControlStore} from "../../../lib/durable-store";

export const runtime="nodejs";
export const dynamic="force-dynamic";

const seed:ControlState={agents:[],missions:[],tasks:[],experiments:[],sandboxes:[],events:[],approvals:[],locked:false};
const store=()=>new DurableJsonControlStore(seed);

export async function GET(){
 const s=store();
 return NextResponse.json({provider:"local-json",integrity:s.integrity(),backups:"local-only"});
}

export async function POST(request:Request){
 try{
  const body=await request.json().catch(()=>({}));
  const s=store();
  if(body.action==="backup") return NextResponse.json({backup:s.backup()},{status:201});
  if(body.action==="restore"&&typeof body.path==="string"){s.restore(body.path);return NextResponse.json({ok:true,integrity:s.integrity()});}
  return NextResponse.json({error:"Unsupported persistence action"},{status:400});
 }catch(error){
  return NextResponse.json({error:error instanceof Error?error.message:"persistence error"},{status:400});
 }
}