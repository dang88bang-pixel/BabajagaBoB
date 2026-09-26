import {NextResponse} from "next/server";import {advanceScenario,createScenario,listScenarios} from "../../../lib/simulation";
import {RENDER_KINDS,renderScenarioArtifact} from "../../../lib/visualization";
import type {RenderKind} from "../../../lib/visualization";
export const runtime="nodejs";export const dynamic="force-dynamic";
import {guardOrDeny} from "../../../lib/api/api-gate";
import {objectField} from "@/lib/request-validation";
export async function GET(request:Request){const denied=guardOrDeny(request,{action:"simulation:read"});if(denied)return denied;return NextResponse.json({scenarios:listScenarios()},{headers:{"Cache-Control":"no-store"}})}
export async function POST(request:Request){
 const denied=guardOrDeny(request,{action:"simulation:manage",creatorOnly:true});if(denied)return denied;
 try{const b=await request.json();if(b.action==="create")return NextResponse.json(createScenario(objectField(b,"scenario") as unknown as Parameters<typeof createScenario>[0]),{status:201});if(b.action==="advance")return NextResponse.json(advanceScenario(String(b.id),b.state,b.result));
  // Visualisierung: rendert deterministisch aus dem echten Plattformzustand und
  // legt das SVG als Evidenz-Artefakt ab (Digest, Ereignis, Audit).
  if(b.action==="render"){
   const kind=String(b.kind??"ARCHITECTURE") as RenderKind;
   if(!RENDER_KINDS.includes(kind))return NextResponse.json({error:"unknown visualization kind",kinds:RENDER_KINDS},{status:400});
   return NextResponse.json({render:renderScenarioArtifact(String(b.id),kind)},{status:201});
  }
  return NextResponse.json({error:"Unsupported simulation action"},{status:400})}catch(e){
  // Ein unbekanntes Szenario ist „nicht gefunden" (404), kein Aufruffeber —
  // die Bildroute verhält sich genauso; sonst wäre derselbe Zustand je nach
  // Route unterschiedlich klassifiziert.
  const message=e instanceof Error?e.message:"simulation error";
  return NextResponse.json({error:message},{status:/not found/i.test(message)?404:400})}}