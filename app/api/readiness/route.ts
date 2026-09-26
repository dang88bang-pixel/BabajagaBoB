import {NextResponse} from "next/server";import {detectReadiness} from "../../../lib/recovery-orchestrator";
import {guardOrDeny} from "../../../lib/api/api-gate";
export const runtime="nodejs";export const dynamic="force-dynamic";
/** Bereitschaft ist ein Betriebsdetail und bleibt Session-gebunden (kein oeffentlicher Probe-Endpunkt). */
export async function GET(request:Request){const denied=guardOrDeny(request,{action:"readiness:read"});if(denied)return denied;return NextResponse.json(detectReadiness(),{headers:{"Cache-Control":"no-store"}})}