import {NextResponse} from "next/server";
import {listSkills,registerSkill,transitionSkill} from "@/lib/skills";
import {guardOrDeny} from "../../../lib/api/api-gate";
export async function GET(request:Request){const denied=guardOrDeny(request,{action:"skill:read"});if(denied)return denied;return NextResponse.json({skills:listSkills()},{headers:{"Cache-Control":"no-store"}})}
export async function POST(req:Request){
 const denied=guardOrDeny(req,{action:"skill:manage",creatorOnly:true});if(denied)return denied;
 try{const b=await req.json();if(b.action==="register")return NextResponse.json({skill:registerSkill(b.skill)},{status:201});if(b.action==="transition")return NextResponse.json({skill:transitionSkill(b.id,b.lifecycle)});return NextResponse.json({error:"unknown action"},{status:400})}catch(e){return NextResponse.json({error:e instanceof Error?e.message:"invalid skill"},{status:400})}}
