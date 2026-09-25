import {NextResponse} from "next/server";
import {createErrorIncident,errorSummary,escalateError,establishRootCause,investigateError,learnFromError,listErrorIncidents,transitionError} from "@/lib/error-intelligence";
import {actionField,readJson,stringArray,stringField} from "@/lib/request-validation";
import type {ErrorLifecycle} from "@/lib/error-intelligence";
export const runtime="nodejs"; export const dynamic="force-dynamic";
import {guardRequest, toDeniedResponse} from "@/lib/api/guard";
const LIFECYCLE:ErrorLifecycle[]=["DETECTED","TRIAGING","CONTAINED","REPRODUCING","DIAGNOSING","HYPOTHESIS","EXPERIMENTING","ROOT_CAUSE_FOUND","FIXING","VERIFYING","LEARNED","REGRESSION_LOCKED","ESCALATED"];
function lifecycleField(body:Record<string,unknown>):ErrorLifecycle{const value=stringField(body,"status",64);if(!LIFECYCLE.includes(value as ErrorLifecycle))throw new Error("invalid status");return value as ErrorLifecycle}
export async function GET(req:Request){try{guardRequest(req,{action:"error:read"});return NextResponse.json({incidents:listErrorIncidents(),summary:errorSummary()},{headers:{"Cache-Control":"no-store"}})}catch(error){const denied=toDeniedResponse(error);if(denied)return denied;throw error}}
export async function POST(req:Request){
 try{
  guardRequest(req,{action:"error:manage"});
  const b=await readJson(req);
  const action=actionField(b,["create","transition","investigate","hypothesis","experiment","fix.verify","recovery","recovery.execute","recovery.verify","regression","evidence","root_cause","learn","escalate"]);
  if(action==="create"){if(!b.input||typeof b.input!=="object"||Array.isArray(b.input))throw new Error("input required");return NextResponse.json(createErrorIncident(b.input as never),{status:201});}
  if(action==="transition")return NextResponse.json(transitionError(stringField(b,"id",128),lifecycleField(b),b.patch as never));
  if(action==="investigate")return NextResponse.json(await investigateError(stringField(b,"id",128)));
  if(action==="hypothesis"){const {formHypothesis}=await import("@/lib/error-intelligence");return NextResponse.json(formHypothesis(stringField(b,"id",128),stringField(b,"hypothesis",4096)));}
  if(action==="experiment"){const {startExperiment}=await import("@/lib/error-intelligence");const objectiveId=typeof b.objectiveId==="string"?b.objectiveId:undefined;return NextResponse.json(objectiveId?startExperiment(stringField(b,"id",128),objectiveId):startExperiment(stringField(b,"id",128)),{status:201});}
  if(action==="recovery"){const {prepareErrorRecovery}=await import("@/lib/error-intelligence");return NextResponse.json(await prepareErrorRecovery(stringField(b,"id",128)),{status:201});}
  if(action==="recovery.execute"){const {executeRecoveryForIncident}=await import("@/lib/error-intelligence");return NextResponse.json(await executeRecoveryForIncident(stringField(b,"id",128)));}
  if(action==="recovery.verify"){const {verifyRecoveryForIncident}=await import("@/lib/error-intelligence");return NextResponse.json(await verifyRecoveryForIncident(stringField(b,"id",128)));}
  if(action==="fix.verify"){const {verifyFix}=await import("@/lib/error-intelligence");return NextResponse.json(await verifyFix(stringField(b,"id",128)));}
  if(action==="regression"){const {createRegressionTest}=await import("@/lib/error-intelligence");return NextResponse.json(createRegressionTest(stringField(b,"id",128),stringArray(b.argv,"argv",64,4096),typeof b.createdBy==="string"?b.createdBy:"AG-QA"),{status:201});}
  if(action==="evidence"){const {recordExperimentEvidence}=await import("@/lib/error-intelligence");return NextResponse.json(recordExperimentEvidence(stringField(b,"id",128),stringField(b,"claim",4096),stringField(b,"value",4096)));}
  if(action==="root_cause")return NextResponse.json(establishRootCause(stringField(b,"id",128),stringField(b,"rootCause",4096),stringArray(b.evidenceIds,"evidenceIds")));
  if(action==="learn")return NextResponse.json(learnFromError(stringField(b,"id",128),stringField(b,"summary",4096),typeof b.regressionTestId==="string"?b.regressionTestId:undefined));
  return NextResponse.json(escalateError(stringField(b,"id",128),stringField(b,"reason",4096)));
 }catch(e){
  // Verweigerungen sind Verweigerungen: der Broker/Gate lehnt ab (z. B. Kill Switch),
  // das ist kein fehlerhafter Request, sondern eine autorisierte Ablehnung.
  const denied=toDeniedResponse(e);
  if(denied)return denied;
  if(e instanceof Error&&e.name==="ExecutionDeniedError")return NextResponse.json({error:e.message,denied:true},{status:409});
  return NextResponse.json({error:e instanceof Error?e.message:"Error intelligence operation failed"},{status:400})
 }
}