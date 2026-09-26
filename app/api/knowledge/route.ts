import {NextResponse} from "next/server";
import {linkKnowledge,listKnowledge,searchKnowledge,updateKnowledge,upsertKnowledge} from "../../../lib/knowledge";
import {actionField,readJson,stringField} from "../../../lib/request-validation";
import {requireControlPlaneAuth} from "../../../lib/control-auth";

export const runtime="nodejs";
export const dynamic="force-dynamic";

export async function GET(request:Request){
 const q=new URL(request.url).searchParams.get("q");
 return NextResponse.json(q?{records:searchKnowledge(q)}:listKnowledge(),{headers:{"Cache-Control":"no-store"}});
}

export async function POST(request:Request){
 try{
  requireControlPlaneAuth(request);
  const b=await readJson(request);
  const action=actionField(b,["upsert","update","link"]);
  if(action==="upsert"){
   if(!b.record||typeof b.record!=="object"||Array.isArray(b.record))throw new Error("record object required");
   return NextResponse.json(upsertKnowledge(b.record as Parameters<typeof upsertKnowledge>[0]),{status:201});
  }
  if(action==="update"){
   return NextResponse.json(updateKnowledge(stringField(b,"id",128),b.patch as Parameters<typeof updateKnowledge>[1]));
  }
  return NextResponse.json(linkKnowledge(
   stringField(b,"from",128),
   stringField(b,"to",128),
   b.relation as Parameters<typeof linkKnowledge>[2]
  ),{status:201});
 }catch(e){
  return NextResponse.json({error:e instanceof Error?e.message:"knowledge error"},{status:400});
 }
}
