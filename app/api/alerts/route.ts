import {NextResponse} from "next/server";
import {guardOrDeny} from "../../../lib/api/api-gate";
import {ALERT_RULES, alertingReport, renderPrometheusRules, validateAlertRules} from "../../../lib/alerting";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Alarmregeln (Betrieb).
 *
 *   GET /api/alerts                     → JSON: Regeln + Prüfergebnis
 *   GET /api/alerts?format=prometheus   → YAML für Scraper/Alertmanager
 *
 * Fail closed: wenn eine Regel eine Kennzahl referenziert, die der Exporter
 * nicht ausliefert, wird die Regeldatei **nicht** ausgeliefert (500 mit Grund).
 * Eine wirkungslose Alarmregel ist gefährlicher als eine fehlende.
 */
export async function GET(request: Request) {
  const denied = guardOrDeny(request, {action: "alerts:read"});
  if (denied) return denied;
  const format = new URL(request.url).searchParams.get("format");
  try {
    if (format === "prometheus") {
      // Fail closed: eine Regel mit unbekannter Kennzahl wird nicht ausgeliefert.
      const validation = validateAlertRules();
      if (!validation.ok) {
        return NextResponse.json(
          {error: "alert rules reference unknown metrics", unknownMetrics: validation.unknownMetrics, duplicateIds: validation.duplicateIds},
          {status: 500}
        );
      }
      return new NextResponse(renderPrometheusRules(), {
        status: 200,
        headers: {
          "content-type": "application/yaml; charset=utf-8",
          "content-disposition": 'inline; filename="bob-alerts.yml"',
          "cache-control": "no-store"
        }
      });
    }
    return NextResponse.json(alertingReport(), {headers: {"Cache-Control": "no-store"}});
  } catch (error) {
    return NextResponse.json(
      {error: error instanceof Error ? error.message : "alert rules invalid", rules: ALERT_RULES.length, validation: alertingReport().validation},
      {status: 500}
    );
  }
}
