import {NextResponse} from "next/server";
import {addProvenanceEdge,addProvenanceNode,listProvenance} from "@/lib/provenance";
export async function GET(){return NextResponse.json(listProvenance(),{headers:{"Cache-Control":"no-store"}})}
export async function POST(req:Request){try{const b=await req.json();if(b.action==="node")return NextResponse.json({node:addProvenanceNode(b.value)},{status:201});if(b.action==="edge")return NextResponse.json({edge:addProvenanceEdge(b.value)},{status:201});return NextResponse.json({error:"unknown action"},{status:400})}catch(e){return NextResponse.json({error:e instanceof Error?e.message:"invalid request"},{status:400})}}
