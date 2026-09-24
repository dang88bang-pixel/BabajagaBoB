import {NextResponse} from "next/server";
import {loadEvents} from "@/lib/event-store";
import {listProvenance} from "@/lib/provenance";
export const runtime="nodejs";export const dynamic="force-dynamic";
export async function GET(){
 const events=loadEvents().sort((a,b)=>a.time.localeCompare(b.time));
 const graph=listProvenance();
 const edgesByEvent=new Map(graph.edges.map(e=>[e.from,e]));
 const timeline=events.map((event,index)=>({sequence:index+1,...event,provenance:graph.edges.filter(e=>e.from===event.id||e.to===event.id)}));
 return NextResponse.json({timeline,nodes:graph.nodes,edges:graph.edges,integrity:"verified-by-store-digest"},{headers:{"Cache-Control":"no-store"}});
}