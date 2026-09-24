import {NextResponse} from "next/server";
import {listRuntimes,registerRuntime} from "@/lib/runtime-registry";
export async function GET(){return NextResponse.json({runtimes:listRuntimes()},{headers:{"Cache-Control":"no-store"}})}
export async function POST(req:Request){try{return NextResponse.json({runtime:registerRuntime(await req.json())},{status:201})}catch(e){return NextResponse.json({error:e instanceof Error?e.message:"invalid runtime"},{status:400})}}
