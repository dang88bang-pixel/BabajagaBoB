import {NextResponse} from "next/server";
import {privacySnapshot} from "../../../lib/privacy";
import {dataBoundarySnapshot} from "../../../lib/data-boundary";
export const runtime="nodejs";
export const dynamic="force-dynamic";
export async function GET(){
 return NextResponse.json({
  ...privacySnapshot(),
  dataBoundary:dataBoundarySnapshot(),
  analytics:false,
  advertising:false,
  tracking:false,
  silentTelemetry:false
 });
}