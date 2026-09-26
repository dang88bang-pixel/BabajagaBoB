import {NextResponse} from "next/server";
import {guardOrDeny} from "../../../../lib/api/api-gate";
import {RENDER_KINDS, renderScenarioSvg} from "../../../../lib/visualization";
import type {RenderKind} from "../../../../lib/visualization";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Liefert die Visualisierung eines Szenarios als SVG-Bild.
 *
 * Die Oberfläche bindet diese Route als `<img src=…>` ein — Bilder führen kein
 * Skript aus, und die Antwort ist zusätzlich als passive Ressource deklariert
 * (`Content-Security-Policy: default-src 'none'`). Der Renderer selbst entfernt
 * aktive Inhalte fail closed (`lib/visualization.ts`).
 */
export async function GET(request: Request) {
  const denied = guardOrDeny(request, {action: "simulation:read"});
  if (denied) return denied;
  const url = new URL(request.url);
  const id = url.searchParams.get("id") ?? "";
  const kind = (url.searchParams.get("kind") ?? "ARCHITECTURE") as RenderKind;
  if (!RENDER_KINDS.includes(kind)) {
    return NextResponse.json({error: "unknown visualization kind", kinds: RENDER_KINDS}, {status: 400});
  }
  try {
    const rendered = renderScenarioSvg(id, kind);
    return new NextResponse(rendered.svg, {
      status: 200,
      headers: {
        "content-type": "image/svg+xml; charset=utf-8",
        "content-disposition": `inline; filename="${kind.toLowerCase()}.svg"`,
        "content-security-policy": "default-src 'none'; style-src 'unsafe-inline'; sandbox",
        "x-content-type-options": "nosniff",
        "cache-control": "no-store"
      }
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "visualization failed";
    return NextResponse.json({error: message}, {status: message === "scenario not found" ? 404 : 400});
  }
}
