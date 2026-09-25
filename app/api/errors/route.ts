import {NextResponse} from "next/server";
import {createErrorIncident,errorSummary,escalateError,establishRootCause,investigateError,learnFromError,listErrorIncidents,transitionError} from "@/lib/error-intelligence";
import {actionField,readJson,stringArray,stringField} from "@/lib/request-validation";
import type {ErrorLifecycle} from "@/lib/error-intelligence";
import {requireControlPlaneAuth} from "@/lib/control-auth";
export const runtime="nodejs"; export const dynamic="force-dynamic";
const LIFECYCLE:ErrorLifecycle[]=["DETECTED","TRIAGING","CONTAINED","REPRODUCING","DIAGNOSING","HYPOTHESIS","EXPERIMENTING","ROOT_CAUSE_FOUND","FIXING","VERIFYING","LEARNED","REGRESSION_LOCKED","ESCALATED"];
function lifecycleField(body:Record<string,unknown>):ErrorLifecycle{const value=stringField(body,"status",64);if(!LIFECYCLE.includes(value as ErrorLifecycle))throw new Error("invalid status");return value as ErrorLifecycle}
export async function GET(){return NextResponse.json({incidents:listErrorIncidents(),summary:errorSummary()},{headers:{"Cache-Control":"no-store"}})}
export async function POST(req:Request){
 try{
  requireControlPlaneAuth(req);
  const b=await readJson(req);
  const action=actionField(b,["create","transition","investigate","experiment","recovery","recovery.execute","recovery.verify","evidence","root_cause","learn","escalate"]);
  if(action==="create"){if(!b.input||typeof b.input!=="object"||Array.isArray(b.input))throw new Error("input required");return NextResponse.json(createErrorIncident(b.input as never),{status:201});}
  if(action==="transition")return NextResponse.json(transitionError(stringField(b,"id",128),lifecycleField(b),b.patch as never));
  if(action==="investigate")return NextResponse.json(await investigateError(stringField(b,"id",128)));
  if(action==="experiment"){const {startExperiment}=await import("@/lib/error-intelligence");return NextResponse.json(startExperiment(stringField(b,"id",128),stringField(b,"objectiveId",128)),{status:201});}
  if(action==="recovery"){const {prepareErrorRecovery}=await import("@/lib/error-intelligence");return NextResponse.json(await prepareErrorRecovery(stringField(b,"id",128)),{status:201});}
  if(action==="recovery.execute"){const {beginRecovery}=await import("@/lib/reliability");return NextResponse.json(await beginRecovery(stringField(b,"id",128)));}
  if(action==="recovery.verify"){const {verifyRecovery}=await import("@/lib/reliability");return NextResponse.json(await verifyRecovery(stringField(b,"id",128)));}
  if(action==="evidence"){const {recordExperimentEvidence}=await import("@/lib/error-intelligence");return NextResponse.json(recordExperimentEvidence(stringField(b,"id",128),stringField(b,"claim",4096),stringField(b,"value",4096)));}
  if(action==="root_cause")return NextResponse.json(establishRootCause(stringField(b,"id",128),stringField(b,"rootCause",4096),stringArray(b.evidenceIds,"evidenceIds")));
  if(action==="learn")return NextResponse.json(learnFromError(stringField(b,"id",128),stringField(b,"summary",4096),typeof b.regressionTestId==="string"?b.regressionTestId:undefined));
  return NextResponse.json(escalateError(stringField(b,"id",128),stringField(b,"reason",4096)));
 }catch(e){return NextResponse.json({error:e instanceof Error?e.message:"Error intelligence operation failed"},{status:400})}
}