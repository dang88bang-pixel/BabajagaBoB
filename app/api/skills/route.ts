import {NextResponse} from "next/server";
import {listSkills,registerSkill,transitionSkill} from "@/lib/skills";
export async function GET(){return NextResponse.json({skills:listSkills()},{headers:{"Cache-Control":"no-store"}})}
export async function POST(req:Request){try{const b=await req.json();if(b.action==="register")return NextResponse.json({skill:registerSkill(b.skill)},{status:201});if(b.action==="transition")return NextResponse.json({skill:transitionSkill(b.id,b.lifecycle)});return NextResponse.json({error:"unknown action"},{status:400})}catch(e){return NextResponse.json({error:e instanceof Error?e.message:"invalid skill"},{status:400})}}
