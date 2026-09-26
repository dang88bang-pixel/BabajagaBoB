import {NextResponse} from "next/server";import {snapshot} from "../../../lib/control-plane";
import {guardOrDeny} from "../../../lib/api/api-gate";
export const runtime="nodejs";
export async function GET(request:Request){const denied=guardOrDeny(request,{action:"event:read"});if(denied)return denied;return NextResponse.json(snapshot().events)}
