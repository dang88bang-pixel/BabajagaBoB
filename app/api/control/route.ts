import {NextResponse} from "next/server";
import {resolveApproval,runGuardian,setLockdown,snapshot} from "@/lib/control-plane";
import {actionField,readJson,stringField} from "@/lib/request-validation";
export const runtime="nodejs"; export const dynamic="force-dynamic";
export async function GET(){return NextResponse.json(snapshot(),{headers:{"Cache-Control":"no-store"}})}
export async function POST(req:Request){
 try{
  const body=await readJson(req);
  const action=actionField(body,["guardian","lockdown","approval"]);
  if(action==="guardian")return NextResponse.json(runGuardian());
  if(action==="lockdown"){
   if(typeof body.locked!=="boolean")throw new Error("locked must be boolean");
   return NextResponse.json(setLockdown(body.locked));
  }
  return NextResponse.json(resolveApproval(stringField(body,"id",128),body.grant===true));
 }catch(e){return NextResponse.json({error:e instanceof Error?e.message:"Control operation failed"},{status:400})}
}