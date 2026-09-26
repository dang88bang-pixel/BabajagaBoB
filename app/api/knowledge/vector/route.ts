import {NextResponse} from "next/server";
import {listKnowledge} from "../../../../lib/knowledge";
import {searchKnowledgeVector, vectorIndexReport} from "../../../../lib/knowledge-vector";
import {guardOrDeny} from "../../../../lib/api/api-gate";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const denied = guardOrDeny(request, {action: "knowledge:read"});
  if (denied) return denied;
  const url = new URL(request.url);
  const q = url.searchParams.get("q")?.trim() ?? "";
  if (!q) return NextResponse.json(vectorIndexReport(), {headers: {"Cache-Control": "no-store"}});
  const limit = Number(url.searchParams.get("limit") ?? "20");
  const nodes = listKnowledge().nodes;
  const matches = searchKnowledgeVector(nodes, q, limit);
  const byId = new Map(nodes.map(node => [node.knowledgeId, node]));
  return NextResponse.json(
    {query: q, matches: matches.map(match => ({score: match.score, record: byId.get(match.knowledgeId)}))},
    {headers: {"Cache-Control": "no-store"}}
  );
}
