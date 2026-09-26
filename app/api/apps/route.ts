import {NextResponse} from "next/server";
import {createApp,listApps,listModules,registerExecutableModule,setAppState,installExecutableModule} from "@/lib/apps";
import {listGallery} from "@/lib/gallery";
export const runtime="nodejs";export const dynamic="force-dynamic";
import {guardOrDeny} from "@/lib/api/api-gate";
import {objectField} from "@/lib/request-validation";
export async function GET(req:Request){
 const deniedRead=guardOrDeny(req,{action:"app:read"});if(deniedRead)return deniedRead;
 const url=new URL(req.url);const appId=url.searchParams.get("appId")??undefined;
 return NextResponse.json({apps:listApps(),modules:listModules(appId),gallery:listGallery({appId})},{headers:{"Cache-Control":"no-store"}});
}
export async function POST(req:Request){
 // Apps und ausfuehrbare Module veraendern die Laufzeitumgebung: Creator-Aktion.
 const denied=guardOrDeny(req,{action:"app:manage",creatorOnly:true});if(denied)return denied;
 try{
 const b=await req.json();
 if(b.action==="create")return NextResponse.json({app:createApp(objectField(b,"value") as unknown as Parameters<typeof createApp>[0])},{status:201});
 if(b.action==="state")return NextResponse.json({app:setAppState(b.appId,b.state,b.progress,b.taskId)});
 if(b.action==="register-module")return NextResponse.json({module:registerExecutableModule(b.value)},{status:201});
 // `installExecutableModule` ist async: ohne await lieferte die Route HTTP 200 mit
 // leerem Objekt und Fehler (Modul fehlt, nicht validiert, Freigabe fehlt) waren
 // unbeobachtbar.
 if(b.action==="install-module")return NextResponse.json(await installExecutableModule(b.moduleId,b.approvalId,b.taskId));
 return NextResponse.json({error:"unknown action"},{status:400});
}catch(e){return NextResponse.json({error:e instanceof Error?e.message:"invalid request"},{status:400})}}
