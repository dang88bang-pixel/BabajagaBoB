import {NextResponse} from "next/server";import {privacySnapshot} from "../../../../lib/privacy";
export const runtime="nodejs";export const dynamic="force-dynamic";
export async function GET(){return NextResponse.json({mode:"LOCAL_FIRST",rules:privacySnapshot(),analytics:false,advertising:false,tracking:false,silentTelemetry:false,networkDefault:"DENY"})}