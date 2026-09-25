import {requireControlPlaneAuth} from "@/lib/control-auth";
import {NextResponse} from "next/server";
import {containerRuntime} from "@/lib/container-runtime";
export async function POST(req:Request){
 requireControlPlaneAuth(req);
 const b=await req.json();
 if(b.action==="create")return NextResponse.json({handle:await containerRuntime.create(b.spec)},{status:201});
 if(b.action==="execute")return NextResponse.json(await containerRuntime.execute(b.sandboxId,b.command??[],b.timeoutMs??300000));
 if(b.action==="destroy"){await containerRuntime.destroy(b.sandboxId);return NextResponse.json({destroyed:true})}
 return NextResponse.json({error:"unknown action"},{status:400});
}
