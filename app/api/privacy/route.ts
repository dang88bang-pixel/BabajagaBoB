import {NextResponse} from "next/server";
import {privacySnapshot} from "../../../lib/privacy";
import {dataBoundarySnapshot} from "../../../lib/data-boundary";
export const runtime="nodejs";
import {guardOrDeny} from "../../../lib/api/api-gate";
export const dynamic="force-dynamic";
export async function GET(request:Request){
 const denied=guardOrDeny(request,{action:"privacy:read"});if(denied)return denied;
 return NextResponse.json({
  ...privacySnapshot(),
  dataBoundary:dataBoundarySnapshot(),
  analytics:false,
  advertising:false,
  tracking:false,
  silentTelemetry:false
 });
}