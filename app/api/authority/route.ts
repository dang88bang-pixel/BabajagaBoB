import {NextResponse} from "next/server";
import {addAuthorityEdge,authorityGraph,authorityStoreIntegrity,capabilityTokens,issueCapabilityToken,revokeCapabilityToken} from "@/lib/authority";
import {actionField,readJson,stringArray,stringField} from "@/lib/request-validation";
import {guardRequest} from "@/lib/api/guard";
import type {Risk} from "@/lib/types";
import {guardOrDeny} from "@/lib/api/api-gate";
export const runtime="nodejs"; export const dynamic="force-dynamic";
export async function GET(request:Request){const denied=guardOrDeny(request,{action:"authority:read"});if(denied)return denied;return NextResponse.json({edges:authorityGraph(),tokens:capabilityTokens(),integrity:authorityStoreIntegrity()},{headers:{"Cache-Control":"no-store"}})}
export async function POST(req:Request){try{const b=await readJson(req);const action=actionField(b,["delegate","issue","revoke"]);
// Capability-Vergabe ist ein Creator-Akt: Agenten sind hier gesperrt (Selbstvergabe verboten).
guardRequest(req,{action:action==="delegate"?"authority:delegate":action==="issue"?"authority:issue":"authority:revoke",creatorOnly:true});
if(action==="delegate"){if(!b.edge||typeof b.edge!=="object"||Array.isArray(b.edge))throw new Error("edge required");const e=b.edge as Record<string,unknown>;return NextResponse.json(addAuthorityEdge({id:stringField(e,"id",128),from:stringField(e,"from",128),to:stringField(e,"to",128),kind:stringField(e,"kind",32) as "DELEGATES"|"SCOPES"|"BINDS",capabilities:stringArray(e.capabilities,"capabilities"),maxRisk:(typeof e.maxRisk==="string"?e.maxRisk:"MODERATE") as Risk,expiresAt:e.expiresAt===null?null:stringField(e,"expiresAt",64)}))}
if(action==="issue"){if(!b.input||typeof b.input!=="object"||Array.isArray(b.input))throw new Error("input required");return NextResponse.json(issueCapabilityToken(b.input as never))}
return NextResponse.json({revoked:revokeCapabilityToken(stringField(b,"id",128))})
}catch(error){if(error instanceof Error&&"status" in error){const d=error as {status:number;code?:string;message:string};return NextResponse.json({error:d.code??"DENIED",message:d.message},{status:d.status})}return NextResponse.json({error:error instanceof Error?error.message:"Authority operation failed"},{status:403})}}
