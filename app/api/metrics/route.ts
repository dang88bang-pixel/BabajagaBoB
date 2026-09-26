import {renderPrometheusMetrics} from "../../../lib/metrics";
import {guardOrDeny} from "../../../lib/api/api-gate";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Betriebsmetriken (Prometheus-Textformat).
 *
 * Der Endpunkt ist **geschlossen** (Session erforderlich): Metriken verraten
 * Betriebszustände und dürfen nicht anonym abrufbar sein. Es werden nur Zähler
 * exponiert – keine Token-IDs, Subjekte oder Inhalte.
 */
export async function GET(request: Request) {
  const denied = guardOrDeny(request, {action: "metrics:read"});
  if (denied) return denied;
  return new Response(renderPrometheusMetrics(), {
    status: 200,
    headers: {"content-type": "text/plain; version=0.0.4; charset=utf-8", "Cache-Control": "no-store"}
  });
}
