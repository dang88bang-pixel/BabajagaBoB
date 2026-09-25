import {NextResponse} from "next/server";
import {addAuthorityEdge,authorityGraph,authorityStoreIntegrity,capabilityTokens,issueCapabilityToken,revokeCapabilityToken} from "@/lib/authority";
import {actionField,readJson,stringArray,stringField,requireCapability} from "@/lib/request-validation";
import type {Risk} from "@/lib/types";
import {requireControlPlaneAuth} from "@/lib/control-auth";
export const runtime="nodejs"; export const dynamic="force-dynamic";
export async function GET(){return NextResponse.json({edges:authorityGraph(),tokens:capabilityTokens(),integrity:authorityStoreIntegrity()},{headers:{"Cache-Control":"no-store"}})}
export async function POST(req:Request){try{requireControlPlaneAuth(req);const b=await readJson(req);const action=actionField(b,["delegate","issue","revoke"]);const token=typeof b.capabilityTokenId==="string"?b.capabilityTokenId:undefined;requireCapability(token,action==="delegate"?"authority:delegate":action==="issue"?"authority:issue":"authority:revoke");
if(action==="delegate"){if(!b.edge||typeof b.edge!=="object"||Array.isArray(b.edge))throw new Error("edge required");const e=b.edge as Record<string,unknown>;return NextResponse.json(addAuthorityEdge({id:stringField(e,"id",128),from:stringField(e,"from",128),to:stringField(e,"to",128),kind:stringField(e,"kind",32) as "DELEGATES"|"SCOPES"|"BINDS",capabilities:stringArray(e.capabilities,"capabilities"),maxRisk:(typeof e.maxRisk==="string"?e.maxRisk:"MODERATE") as Risk,expiresAt:e.expiresAt===null?null:stringField(e,"expiresAt",64)}))}
if(action==="issue"){if(!b.input||typeof b.input!=="object"||Array.isArray(b.input))throw new Error("input required");return NextResponse.json(issueCapabilityToken(b.input as never))}
return NextResponse.json({revoked:revokeCapabilityToken(stringField(b,"id",128))})
}catch(error){return NextResponse.json({error:error instanceof Error?error.message:"Authority operation failed"},{status:403})}}
