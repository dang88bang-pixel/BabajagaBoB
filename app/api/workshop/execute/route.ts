import {NextResponse} from "next/server";
import {executeWorkshopStep,listWorkshopExecutions} from "@/lib/workshop-execution";
export const runtime="nodejs";export const dynamic="force-dynamic";
export async function GET(){return NextResponse.json({executions:listWorkshopExecutions()},{headers:{"Cache-Control":"no-store"}})}
export async function POST(req:Request){try{const b=await req.json();const result=executeWorkshopStep(b.workshopId,b.action);return NextResponse.json(result)}catch(e){return NextResponse.json({error:e instanceof Error?e.message:"workshop execution failed"},{status:400})}}
