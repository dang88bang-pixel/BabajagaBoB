import {NextResponse} from "next/server";
import {advanceScenario,createScenario,listScenarios} from "../../../lib/simulation";
import {actionField,readJson,stringField} from "../../../lib/request-validation";
import {requireControlPlaneAuth} from "../../../lib/control-auth";

export const runtime="nodejs";
export const dynamic="force-dynamic";

export async function GET(){
 return NextResponse.json({scenarios:listScenarios()},{headers:{"Cache-Control":"no-store"}});
}

export async function POST(request:Request){
 try{
  requireControlPlaneAuth(request);
  const b=await readJson(request);
  const action=actionField(b,["create","advance"]);
  if(action==="create"){
   if(!b.scenario||typeof b.scenario!=="object"||Array.isArray(b.scenario))throw new Error("scenario object required");
   return NextResponse.json(createScenario(b.scenario as Parameters<typeof createScenario>[0]),{status:201});
  }
  const id=stringField(b,"id",128);
  return NextResponse.json(advanceScenario(
   id,
   b.state as Parameters<typeof advanceScenario>[1],
   b.result as Parameters<typeof advanceScenario>[2]
  ));
 }catch(e){
  return NextResponse.json({error:e instanceof Error?e.message:"simulation error"},{status:400});
 }
}
