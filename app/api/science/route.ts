import {NextResponse} from "next/server";
import {addEvidence,createDecision,createExperiment,createObjective,listScience,runExperiment,updateExperiment,validateCausalChain} from "@/lib/science";
import {actionField,readJson,stringArray,stringField} from "@/lib/request-validation";
export const runtime="nodejs";
export const dynamic="force-dynamic";
export async function GET(){return NextResponse.json(listScience(),{headers:{"Cache-Control":"no-store"}})}
export async function POST(req:Request){
 try{
  const b=await readJson(req); const action=actionField(b,["objective","experiment","experiment.update","experiment.run","experiment.validate","evidence","decision"]);
  if(action==="objective"||action==="experiment"||action==="evidence"||action==="decision"){
   if(!b.value||typeof b.value!=="object"||Array.isArray(b.value))throw new Error("value required");
  }
  if(action==="objective")return NextResponse.json({objective:createObjective(b.value as never)},{status:201});
  if(action==="experiment")return NextResponse.json({experiment:createExperiment(b.value as never)},{status:201});
  if(action==="experiment.update"){const id=stringField(b,"id",128);if(!b.patch||typeof b.patch!=="object"||Array.isArray(b.patch))throw new Error("patch required");return NextResponse.json({experiment:updateExperiment(id,b.patch as never)});}
  if(action==="experiment.run"){
   const id=stringField(b,"id",128), kind=stringField(b,"kind",16), sandboxId=stringField(b,"sandboxId",128), agentId=stringField(b,"agentId",128), taskId=stringField(b,"taskId",128), capabilityTokenId=stringField(b,"capabilityTokenId",128);
   if(!["BASELINE","CONTROL","REPLICATION"].includes(kind))throw new Error("invalid experiment run kind");
   const argv=stringArray(b.argv,"argv",64,4096);
   return NextResponse.json({run:await runExperiment(id,kind as "BASELINE"|"CONTROL"|"REPLICATION",sandboxId,argv,agentId,taskId,capabilityTokenId,typeof b.approvalId==="string"?b.approvalId:undefined)},{status:201});
  }
  if(action==="experiment.validate")return NextResponse.json({validation:validateCausalChain(stringField(b,"id",128))});
  if(action==="evidence")return NextResponse.json({evidence:addEvidence(b.value as never)},{status:201});
  return NextResponse.json({decision:createDecision(b.value as never)},{status:201});
 }catch(e){return NextResponse.json({error:e instanceof Error?e.message:"invalid request"},{status:400})}
}
