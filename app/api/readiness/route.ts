import {NextResponse} from "next/server";import {detectReadiness} from "../../../lib/recovery-orchestrator";
export const runtime="nodejs";export const dynamic="force-dynamic";
export async function GET(){return NextResponse.json(detectReadiness(),{headers:{"Cache-Control":"no-store"}})}