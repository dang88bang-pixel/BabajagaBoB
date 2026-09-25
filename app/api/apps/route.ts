import {NextResponse} from "next/server";
import {createApp,listApps,listModules,registerExecutableModule,setAppState,installExecutableModule} from "@/lib/apps";
import {listGallery} from "@/lib/gallery";
export const runtime="nodejs";export const dynamic="force-dynamic";
export async function GET(req:Request){
 const url=new URL(req.url);const appId=url.searchParams.get("appId")??undefined;
 return NextResponse.json({apps:listApps(),modules:listModules(appId),gallery:listGallery({appId})},{headers:{"Cache-Control":"no-store"}});
}
export async function POST(req:Request){try{
 const b=await req.json();
 if(b.action==="create")return NextResponse.json({app:createApp(b.value)},{status:201});
 if(b.action==="state")return NextResponse.json({app:setAppState(b.appId,b.state,b.progress,b.taskId)});
 if(b.action==="register-module")return NextResponse.json({module:registerExecutableModule(b.value)},{status:201});
 if(b.action==="install-module")return NextResponse.json(installExecutableModule(b.moduleId,b.approvalId,b.taskId));
 return NextResponse.json({error:"unknown action"},{status:400});
}catch(e){return NextResponse.json({error:e instanceof Error?e.message:"invalid request"},{status:400})}}
