import {NextResponse} from "next/server";import {snapshot} from "../../../lib/control-plane";export const runtime="nodejs";export async function GET(){return NextResponse.json(snapshot().events)}
