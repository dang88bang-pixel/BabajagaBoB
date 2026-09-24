import {NextResponse} from "next/server";import {cancelJob,leaseJob,queueSnapshot} from "../../../lib/queue";
export const dynamic="force-dynamic";
export async function GET(){return NextResponse.json({jobs:queueSnapshot()},{headers:{"Cache-Control":"no-store"}})}
export async function POST(req:Request){const body=await req.json().catch(()=>({}));if(body.action==="lease"&&typeof body.id==="string"){const job=leaseJob(body.id);return job?NextResponse.json(job):NextResponse.json({error:"Job cannot be leased"}, {status:409})}if(body.action==="cancel"&&typeof body.id==="string"){const job=cancelJob(body.id);return job?NextResponse.json(job):NextResponse.json({error:"Job cannot be cancelled"}, {status:409})}return NextResponse.json({error:"Unsupported queue action"},{status:400})}
