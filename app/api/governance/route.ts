import {NextResponse} from "next/server";
import {auditGovernance,createDelegation,isKilled,listDelegations,listKillSwitches,revokeDelegation,setKillSwitch,validateDelegation,delegationIntegrity,governanceStoreIntegrity} from "@/lib/governance";
import {actionField,readJson,stringArray,stringField,requireCapability} from "@/lib/request-validation";
export const runtime="nodejs";
export const dynamic="force-dynamic";
export async function GET(){return NextResponse.json({killSwitches:listKillSwitches(),delegations:listDelegations(),integrity:{...delegationIntegrity(),store:governanceStoreIntegrity()}},{headers:{"Cache-Control":"no-store"}})}
export async function POST(req:Request){
 try{
  const b=await readJson(req); const action=actionField(b,["kill","release","is-killed","delegate","revoke","validate"]);
  const token=typeof b.capabilityTokenId==="string"?b.capabilityTokenId:undefined;
  if(action!=="is-killed"&&action!=="validate")requireCapability(token,action==="delegate"?"governance:delegate":action==="revoke"?"governance:revoke":"governance:kill");
  let result:unknown;
  if(action==="kill"||action==="release"){
   const scope=stringField(b,"scope",32); const targetId=stringField(b,"targetId",128); const reason=typeof b.reason==="string"?b.reason:"manual governance change";
   const validScopes=["SYSTEM","AGENT","TASK","EXPERIMENT","SANDBOX","DEPLOYMENT"];
   if(!validScopes.includes(scope))throw new Error("invalid kill scope");
   result=setKillSwitch(scope as Parameters<typeof setKillSwitch>[0],targetId,action==="kill",reason);
  }else if(action==="is-killed"){result={killed:isKilled(stringField(b,"scope",32) as Parameters<typeof isKilled>[0],stringField(b,"targetId",128))}}
  else if(action==="delegate"){
   const value=b.value;if(!value||typeof value!=="object"||Array.isArray(value))throw new Error("delegation value required"); const v=value as Record<string,unknown>;
   result=createDelegation({from:stringField(v,"from",128),to:stringField(v,"to",128),capabilities:stringArray(v.capabilities,"capabilities"),taskId:typeof v.taskId==="string"?v.taskId:undefined,sandboxId:typeof v.sandboxId==="string"?v.sandboxId:undefined,expiresAt:stringField(v,"expiresAt",64)});
  }else if(action==="revoke")result=revokeDelegation(stringField(b,"id",128));
  else result={delegation:validateDelegation(stringField(b,"id",128),stringField(b,"capability",256))};
  auditGovernance(action,typeof b.targetId==="string"?b.targetId:typeof b.id==="string"?b.id:"delegation",JSON.stringify(result));
  return NextResponse.json(result);
 }catch(e){return NextResponse.json({error:e instanceof Error?e.message:"invalid request"},{status:403})}
}
