import {NextResponse} from "next/server";
import {addAuthorityEdge,authorityGraph,authorityStoreIntegrity,capabilityTokens,issueCapabilityToken,revokeCapabilityToken} from "@/lib/authority";
export const runtime="nodejs";
export const dynamic="force-dynamic";
export async function GET(){return NextResponse.json({edges:authorityGraph(),tokens:capabilityTokens(),integrity:authorityStoreIntegrity()},{headers:{"Cache-Control":"no-store"}})}
export async function POST(req:Request){try{const body=await req.json();switch(body.action){case "delegate":return NextResponse.json(addAuthorityEdge(body.edge));case "issue":return NextResponse.json(issueCapabilityToken(body.input));case "revoke":return NextResponse.json({revoked:revokeCapabilityToken(body.id)});default:return NextResponse.json({error:"Unsupported authority action"},{status:400})}}catch(error){return NextResponse.json({error:error instanceof Error?error.message:"Authority operation failed"},{status:403})}}
