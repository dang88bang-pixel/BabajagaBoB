import {beforeAll, describe, expect, it, vi} from "vitest";
import {isolatedStorageRoot, TEST_BOOTSTRAP_SECRET} from "../helpers/runtime";

/**
 * Alarmierung (Alert-Regeln).
 *
 * Der Kern der Prüfung ist der **Vertrag zur Kennzahlenquelle**: jede Regel muss
 * Kennzahlen referenzieren, die `/api/metrics` tatsächlich ausliefert. Wird eine
 * Kennzahl umbenannt oder entfernt, schlägt der Test fehl — eine wirkungslose
 * Alarmregel kann so nicht unbemerkt entstehen. Erzeugt wird echte
 * Prometheus-Regeldatei-YAML (Struktur zeichengenau geprüft), ausgeliefert über
 * die geschützte Route.
 */

const root = isolatedStorageRoot("alerting");
void root;

const BASE = "http://localhost:3000";
let alerting: typeof import("../../lib/alerting");
let metrics: typeof import("../../lib/metrics");
let route: typeof import("../../app/api/alerts/route");
let cookie = "";

beforeAll(async () => {
  vi.resetModules();
  alerting = await import("../../lib/alerting");
  metrics = await import("../../lib/metrics");
  route = await import("../../app/api/alerts/route");
  const auth = await import("../../app/api/auth/route");
  const login = await auth.POST(
    new Request(`${BASE}/api/auth`, {
      method: "POST",
      headers: {"content-type": "application/json"},
      body: JSON.stringify({action: "bootstrap", secret: TEST_BOOTSTRAP_SECRET, creatorName: "Alert-Tester"})
    })
  );
  expect(login.status).toBe(201);
  cookie = (login.headers.get("set-cookie") ?? "").split(";")[0];
});

describe("Alarmregeln", () => {
  it("referenziert ausschließlich Kennzahlen, die der Exporter ausliefert", () => {
    const available = alerting.exportedMetricNames(metrics.renderPrometheusMetrics());
    const validation = alerting.validateAlertRules(alerting.ALERT_RULES, available);
    expect(validation.unknownMetrics).toEqual([]);
    expect(validation.duplicateIds).toEqual([]);
    expect(validation.missingRunbook).toEqual([]);
    expect(validation.invalidFor).toEqual([]);
    expect(validation.ok).toBe(true);
    expect(validation.rules).toBeGreaterThanOrEqual(14);
    expect(validation.metrics).toBeGreaterThan(30);
  });

  it("erkennt eine erfundene Kennzahl (Negativtest)", () => {
    const invented = [{...alerting.ALERT_RULES[0], id: "BobErfunden", expr: "bob_gibt_es_nicht > 0"}];
    const validation = alerting.validateAlertRules(invented, alerting.exportedMetricNames());
    expect(validation.ok).toBe(false);
    expect(validation.unknownMetrics).toEqual([{rule: "BobErfunden", metric: "bob_gibt_es_nicht"}]);
  });

  it("erkennt doppelte Kennungen, fehlendes Runbook und falsche Wartezeit", () => {
    const broken = [
      {...alerting.ALERT_RULES[0], runbook: "kurz"},
      {...alerting.ALERT_RULES[1], id: alerting.ALERT_RULES[0].id, for: "1 Minute"}
    ];
    const validation = alerting.validateAlertRules(broken, alerting.exportedMetricNames());
    expect(validation.ok).toBe(false);
    expect(validation.duplicateIds.length).toBeGreaterThan(0);
    expect(validation.missingRunbook.length).toBeGreaterThan(0);
    expect(validation.invalidFor).toEqual([alerting.ALERT_RULES[0].id]);
  });

  it("deckt Integrität, Audit, Isolation, Vorfälle, Warteschlange und Verweigerungen ab", () => {
    const ids = alerting.ALERT_RULES.map(rule => rule.id);
    for (const required of [
      "BobStoreIntegrityBroken",
      "BobAuditChainBroken",
      "BobIsolationNotEnforced",
      "BobCriticalIncidentOpen",
      "BobKillSwitchActive",
      "BobQueueBacklog",
      "BobExecutionsDenied"
    ]) {
      expect(ids).toContain(required);
    }
    // Jede Regel trägt eine Handlungsanweisung, die auf Dokument oder Route zeigt.
    for (const rule of alerting.ALERT_RULES) {
      expect(rule.runbook).toMatch(/docs\/|\/api\//);
      expect(["CRITICAL", "WARNING", "INFO"]).toContain(rule.severity);
    }
  });

  it("erzeugt strukturell gültige Prometheus-Regeln und ist deterministisch", () => {
    const yaml = alerting.renderPrometheusRules();
    expect(alerting.renderPrometheusRules()).toBe(yaml);
    expect(yaml).not.toMatch(/\t/);
    expect(yaml.split("\n").every(line => line === line.replace(/\s+$/, ""))).toBe(true);
    expect(yaml).toMatch(/^groups:\n {2}- name: babajagabob\n {4}rules:\n/m);
    for (const rule of alerting.ALERT_RULES) {
      expect(yaml).toContain(`      - alert: ${rule.id}`);
      expect(yaml).toContain(`        expr: ${rule.expr}`);
      expect(yaml).toContain(`        for: ${rule.for}`);
      expect(yaml).toContain(`          severity: ${rule.severity}`);
    }
    // Jede Regel muss genau die vier Prometheus-Blöcke tragen.
    expect((yaml.match(/^ {6}- alert: /gm) ?? []).length).toBe(alerting.ALERT_RULES.length);
    expect((yaml.match(/^ {8}expr: /gm) ?? []).length).toBe(alerting.ALERT_RULES.length);
    expect((yaml.match(/^ {8}for: /gm) ?? []).length).toBe(alerting.ALERT_RULES.length);
    expect((yaml.match(/^ {10}summary: /gm) ?? []).length).toBe(alerting.ALERT_RULES.length);
    expect((yaml.match(/^ {10}runbook: /gm) ?? []).length).toBe(alerting.ALERT_RULES.length);
  });

  it("misst die neuen Kennzahlen aus echten Quellen", () => {
    const rendered = metrics.renderPrometheusMetrics();
    const names = alerting.exportedMetricNames(rendered);
    for (const name of ["bob_queue_leased", "bob_queue_failed", "bob_executions_denied", "bob_isolation_requested", "bob_isolation_enforced_state"]) {
      expect(names).toContain(name);
    }
    // Werte sind Zahlen, keine Platzhalter — und es leckt kein Geheimnis.
    expect(rendered).toMatch(/bob_queue_leased \d+/);
    expect(rendered).not.toMatch(/CAP-|secretHash|Bearer /i);
  });
});

describe("Alarm-Route", () => {
  it("liefert Regeln, Prüfergebnis und YAML mit Session", async () => {
    const response = await route.GET(new Request(`${BASE}/api/alerts`, {headers: {cookie}}));
    expect(response.status).toBe(200);
    const body = (await response.json()) as {rules: unknown[]; validation: {ok: boolean}; yaml: string};
    expect(body.validation.ok).toBe(true);
    expect(body.rules.length).toBe(alerting.ALERT_RULES.length);
    expect(body.yaml).toContain("groups:");

    const yamlResponse = await route.GET(new Request(`${BASE}/api/alerts?format=prometheus`, {headers: {cookie}}));
    expect(yamlResponse.status).toBe(200);
    expect(yamlResponse.headers.get("content-type")).toContain("application/yaml");
    expect(yamlResponse.headers.get("cache-control")).toBe("no-store");
    expect(await yamlResponse.text()).toBe(alerting.renderPrometheusRules());
  });

  it("verweigert Zugriff ohne Session", async () => {
    const response = await route.GET(new Request(`${BASE}/api/alerts`));
    expect([401, 428]).toContain(response.status);
  });
});
