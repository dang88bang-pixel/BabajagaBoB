import {NextResponse} from "next/server";import {auditSnapshot} from "../../../lib/audit";
export const dynamic="force-dynamic";
export async function GET(){return NextResponse.json({records:auditSnapshot()},{headers:{"Cache-Control":"no-store"}})}
