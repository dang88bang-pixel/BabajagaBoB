import {NextResponse} from "next/server";
import {gallerySnapshot,listGallery} from "@/lib/gallery";
export const runtime="nodejs";export const dynamic="force-dynamic";
export async function GET(req:Request){
 const u=new URL(req.url);return NextResponse.json(u.searchParams.toString()?listGallery({appId:u.searchParams.get("appId")??undefined,taskId:u.searchParams.get("taskId")??undefined,moduleId:u.searchParams.get("moduleId")??undefined}):gallerySnapshot(),{headers:{"Cache-Control":"no-store"}});
}