import {NextResponse} from "next/server";
import {guardOrDeny} from "@/lib/api/api-gate";
import {addProvenanceEdge,addProvenanceNode,listProvenance} from "@/lib/provenance";
export async function GET(req:Request){const denied=guardOrDeny(req,{action:"provenance:read"});if(denied)return denied;return NextResponse.json(listProvenance(),{headers:{"Cache-Control":"no-store"}})}
export async function POST(req:Request){try{const denied=guardOrDeny(req,{action:"provenance:write",creatorOnly:true});if(denied)return denied;const b=await req.json();if(b.action==="node")return NextResponse.json({node:addProvenanceNode(b.value)},{status:201});if(b.action==="edge")return NextResponse.json({edge:addProvenanceEdge(b.value)},{status:201});return NextResponse.json({error:"unknown action"},{status:400})}catch(e){return NextResponse.json({error:e instanceof Error?e.message:"invalid request"},{status:400})}}
