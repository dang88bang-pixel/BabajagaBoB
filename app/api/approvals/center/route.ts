import {NextResponse} from "next/server";
import {approvalGranted,createApproval,getApproval,listApprovals,resolveApprovalRequest} from "@/lib/approvals";
import {actionField,readJson,stringArray,stringField,requireCapability} from "@/lib/request-validation";
import {guardOrDeny} from "@/lib/api/api-gate";
export const runtime="nodejs";
export const dynamic="force-dynamic";
/**
 * Freigabe-Center (Abschnitt 20). Beide Methoden prüfen ihre Aktion selbst:
 * `GET` verlangt `approval:read`, `POST` verlangt `approval:write`. Zuvor fehlte
 * diese Prüfung (nur die Middleware schützte die Route) — der strukturelle
 * Routenvertrag hat die Lücke aufgedeckt.
 */
export async function GET(request:Request){
 const denied=guardOrDeny(request,{action:"approval:read"});if(denied)return denied;
 return NextResponse.json({approvals:listApprovals()},{headers:{"Cache-Control":"no-store"}});
}
export async function POST(req:Request){
 const denied=guardOrDeny(req,{action:"approval:write"});if(denied)return denied;
 try{
  const b=await readJson(req);
  const action=actionField(b,["create","resolve","check"]);
  if(action==="create"){
   const value=b.value;
   if(!value||typeof value!=="object"||Array.isArray(value))throw new Error("approval value required");
   const v=value as Record<string,unknown>;
   const approval=createApproval({
    taskId:stringField(v,"taskId",128),requestedBy:stringField(v,"requestedBy",128),
    changeSummary:stringField(v,"changeSummary",4000),why:stringField(v,"why",4000),
    expectedEffect:stringField(v,"expectedEffect",4000),risks:stringArray(v.risks,"risks"),
    testResults:stringArray(v.testResults,"testResults"),rollbackPlan:stringField(v,"rollbackPlan",4000),
    files:stringArray(v.files,"files"),dbChanges:stringArray(v.dbChanges,"dbChanges"),
    networkEffects:stringArray(v.networkEffects,"networkEffects"),
    affectedSystems:Array.isArray(v.affectedSystems)?stringArray(v.affectedSystems,"affectedSystems"):[]
   });
   return NextResponse.json({approval},{status:201});
  }
  const id=stringField(b,"id",128);
  if(action==="check")return NextResponse.json({granted:approvalGranted(id),approval:getApproval(id)});
  const status=stringField(b,"status",16);
  if(status!=="GRANTED"&&status!=="DENIED")throw new Error("invalid approval status");
  const actor=stringField(b,"actor",128);
  requireCapability(typeof b.capabilityTokenId==="string"?b.capabilityTokenId:undefined,"approval:resolve");
  return NextResponse.json({approval:resolveApprovalRequest(id,status as "GRANTED"|"DENIED",actor)});
 }catch(e){return NextResponse.json({error:e instanceof Error?e.message:"invalid request"},{status:400})}
}
