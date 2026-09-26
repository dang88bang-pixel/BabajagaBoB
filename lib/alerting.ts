import {renderPrometheusMetrics} from "./metrics";

/**
 * ============================================================================
 * Alarmierung (Alert-Regeln)
 * ============================================================================
 *
 * Die Regeln liegen im **Code**, nicht in einer gepflegten Nebendatei: dadurch
 * kann eine umbenannte oder entfernte Kennzahl nicht stillschweigend eine
 * wirkungslose Alarmregel hinterlassen. `validateAlertRules()` vergleicht jede
 * Regel mit den Kennzahlen, die `/api/metrics` tatsächlich ausliefert; ein
 * unbekannter Name ist ein Fehler (fail closed), kein Hinweis.
 *
 * Ausgeliefert wird:
 *  - `GET /api/alerts`                  → Regeln + Prüfergebnis (JSON)
 *  - `GET /api/alerts?format=prometheus` → fertige Regeldatei (YAML)
 *
 * Es gibt weiterhin **keinen** Scraper und keinen Alertmanager in dieser
 * Umgebung — das bleibt offen und wird als solches dokumentiert. Was hier
 * entsteht, ist die geprüfte Regelbasis, die ein Scraper abholen kann.
 */

export type AlertSeverity = "CRITICAL" | "WARNING" | "INFO";

export type AlertRule = {
  /** Stabile Kennung (Prometheus `alert:`). */
  id: string;
  /** PromQL-Ausdruck über die ausgelieferten `bob_*`-Kennzahlen. */
  expr: string;
  /** Wartezeit, bevor der Alarm auslöst (Prometheus `for`). */
  for: string;
  severity: AlertSeverity;
  summary: string;
  /** Konkreter Handlungsschritt für den Bereitschaftsdienst. */
  runbook: string;
};

/**
 * Regeln decken die Sicherheits- und Betriebsgrenzen ab: Integrität von Stores,
 * Audit-Kette und Event-Log, erzwungene Isolation, offene kritische Vorfälle,
 * Wiederholungen (Replay), ausgeschöpfte Queue, Kill Switch, unautorisierte
 * Objekte in der Flotte.
 */
export const ALERT_RULES: AlertRule[] = [
  {
    id: "BobStoreIntegrityBroken",
    expr: "bob_store_integrity_ok == 0",
    for: "1m",
    severity: "CRITICAL",
    summary: "Mindestens ein Store ist nicht integer (Digest-/Envelope-Prüfung fehlgeschlagen).",
    runbook: "docs/OPERATIONS.md §3: Store-Bericht lesen, betroffenen Store isolieren, aus verifiziertem Backup wiederherstellen (digest-geprüft), Ursache als Fehlerfall erfassen."
  },
  {
    id: "BobStoresUnhealthy",
    expr: "bob_stores_healthy < bob_stores_total",
    for: "5m",
    severity: "WARNING",
    summary: "Nicht alle registrierten Stores sind gesund.",
    runbook: "docs/OPERATIONS.md §3: Store-Integritätsbericht und Journal (Migration/Reparatur) prüfen."
  },
  {
    id: "BobAuditChainBroken",
    expr: "bob_audit_chain_ok == 0",
    for: "1m",
    severity: "CRITICAL",
    summary: "Die HMAC-Kette des Audit-Logs ist unterbrochen — Nachweisbarkeit gefährdet.",
    runbook: "docs/SECURITY.md §8: Audit-Kette prüfen (POST /api/audit {action:\"verify\"}), Kopf rekonstruieren, Ereignis dokumentieren; keine Schreibvorgänge fortsetzen, bis die Kette wieder integer ist."
  },
  {
    id: "BobAuditIssuesReported",
    expr: "bob_audit_issues > 0",
    for: "5m",
    severity: "WARNING",
    summary: "Der Audit-Store meldet Integritätsprobleme.",
    runbook: "docs/SECURITY.md §8: `bob_audit_issues` und den Persistenzbericht auswerten, betroffene Einträge benennen."
  },
  {
    id: "BobEventStoreBroken",
    expr: "bob_event_store_ok == 0",
    for: "5m",
    severity: "WARNING",
    summary: "Das Ereignis-Log ist nicht integer (Kausalität nicht mehr gesichert).",
    runbook: "docs/OPERATIONS.md §3: Event-Store-Bericht prüfen, Kette wiederherstellen."
  },
  {
    id: "BobIsolationNotEnforced",
    expr: "bob_isolation_namespaces_ok == 0",
    for: "5m",
    severity: "CRITICAL",
    summary: "Kernel-Isolation ist angefordert, aber nicht aktiv — Ausführungen sind gesperrt.",
    runbook: "docs/SANDBOX.md/documents OPERATIONS §1: Rootfs bauen (scripts/build-ns-rootfs.sh), User-Namespaces prüfen; ohne Isolation wird nichts ausgeführt (fail closed)."
  },
  {
    id: "BobIsolationFailed",
    expr: "bob_isolation_enforced_state == 0 and bob_isolation_requested == 1",
    for: "5m",
    severity: "WARNING",
    summary: "Isolation angefordert, aber nicht erzwungen (Zwischenzustand vor dem Sperren).",
    runbook: "docs/SANDBOX.md: Isolationsbericht (GET /api/runtime) und Voraussetzungen prüfen."
  },
  {
    id: "BobKillSwitchActive",
    expr: "bob_kill_switches_active > 0",
    for: "0m",
    severity: "WARNING",
    summary: "Mindestens ein Kill Switch ist aktiv — Ausführungen werden blockiert.",
    runbook: "docs/OPERATIONS.md §4: Kill-Switch-Liste prüfen; Freigabe ist ein Creator-Akt."
  },
  {
    id: "BobCriticalIncidentOpen",
    expr: "bob_error_incidents_critical_open > 0",
    for: "5m",
    severity: "CRITICAL",
    summary: "Offener Fehlerfall mit Schweregrad CRITICAL.",
    runbook: "docs/RECOVERY.md: Fehlerfall über die Kette führen (Diagnose → Experiment → Root Cause → Fix → Verifikation → Regression)."
  },
  {
    id: "BobIncidentsEscalated",
    expr: "bob_error_incidents_escalated > 0",
    for: "15m",
    severity: "WARNING",
    summary: "Eskalierte Fehlerfälle warten auf Entscheidung.",
    runbook: "docs/RECOVERY.md + Creator-Inbox: Eskalation beantworten (BLOCK/ESCALATE)."
  },
  {
    id: "BobQueueBacklog",
    expr: "bob_queue_jobs - bob_queue_leased > 10",
    for: "15m",
    severity: "WARNING",
    summary: "Die Warteschlange wächst schneller, als Jobs beansprucht werden.",
    runbook: "docs/OPERATIONS.md §5: Worker-Zyklus prüfen (POST /api/worker), Leases abräumen, Delegationskante CREATOR → SYSTEM-WORKER prüfen."
  },
  {
    id: "BobQueueLeasesStale",
    expr: "bob_queue_leased > 0 and bob_queue_jobs == bob_queue_leased",
    for: "15m",
    severity: "WARNING",
    summary: "Alle Jobs sind beansprucht — keine Arbeit wird fortgesetzt.",
    runbook: "docs/OPERATIONS.md §5: Leases abräumen (queue cleanup), Worker-Zyklus anstoßen."
  },
  {
    id: "BobSandboxFailures",
    expr: "bob_sandboxes - bob_sandboxes_running > 5",
    for: "30m",
    severity: "INFO",
    summary: "Viele Sandboxes sind nicht im Zustand RUNNING.",
    runbook: "docs/SANDBOX.md: Lebenszyklus und Snapshot-Zustand der Sandboxes prüfen."
  },
  {
    id: "BobRecoveryRejected",
    expr: "bob_recovery_rejected > 0",
    for: "30m",
    severity: "WARNING",
    summary: "Ein Recovery-Plan wurde abgelehnt (Verifikation nicht bestanden).",
    runbook: "docs/RECOVERY.md: Ablehnungsgrund lesen, Fix korrigieren, Verifikation wiederholen; kein Lernen ohne bestandene Verifikation."
  },
  {
    id: "BobDeviceUnauthorizedInUse",
    expr: "bob_devices > bob_devices_authorized",
    for: "60m",
    severity: "INFO",
    summary: "Es sind Geräte bekannt, die nicht autorisiert sind (Discovery ≠ Autorisierung).",
    runbook: "docs/DEVICES.md: Erwartet, solange Geräte ungenutzt sind; nur bei Allocation-Versuchen handeln."
  },
  {
    id: "BobExecutionsDenied",
    expr: "bob_executions_denied > 5",
    for: "15m",
    severity: "WARNING",
    summary: "Verweigerungen an Gate/Broker häufen sich — möglicher Fehlkonfigurations- oder Angriffsversuch.",
    runbook: "docs/SECURITY.md §6: Verweigerungsevidenz (kind=DENIAL) und Audit-DECISION=DENY auswerten, Agenten-/Tokenbindung prüfen."
  }
];

/** Kennzahlen, die in einem Ausdruck referenziert werden (nur `bob_*`). */
export function metricsInExpression(expr: string): string[] {
  return [...new Set(expr.match(/\bbob_[a-z0-9_]+/g) ?? [])];
}

/** Kennzahlen, die der Exporter tatsächlich ausliefert (ohne Labels). */
export function exportedMetricNames(rendered = renderPrometheusMetrics()): string[] {
  const names = new Set<string>();
  for (const line of rendered.split("\n")) {
    const match = /^([a-zA-Z_:][a-zA-Z0-9_:]*)(?:\{| )/.exec(line);
    if (match && !line.startsWith("#")) names.add(match[1]);
  }
  return [...names].sort();
}

export type AlertValidation = {
  ok: boolean;
  rules: number;
  metrics: number;
  unknownMetrics: Array<{rule: string; metric: string}>;
  duplicateIds: string[];
  missingRunbook: string[];
  invalidFor: string[];
};

/** Prüft die Regeln gegen die real ausgelieferten Kennzahlen. */
export function validateAlertRules(rules: AlertRule[] = ALERT_RULES, available = exportedMetricNames()): AlertValidation {
  const known = new Set(available);
  const unknownMetrics = rules.flatMap(rule => metricsInExpression(rule.expr).filter(metric => !known.has(metric)).map(metric => ({rule: rule.id, metric})));
  const seen = new Set<string>();
  const duplicateIds: string[] = [];
  for (const rule of rules) {
    if (seen.has(rule.id)) duplicateIds.push(rule.id);
    seen.add(rule.id);
  }
  const missingRunbook = rules.filter(rule => rule.runbook.trim().length < 10 || !/\bdocs\/|\/api\//.test(rule.runbook)).map(rule => rule.id);
  const invalidFor = rules.filter(rule => !/^\d+[smhd]$/.test(rule.for)).map(rule => rule.id);
  return {
    ok: unknownMetrics.length === 0 && duplicateIds.length === 0 && missingRunbook.length === 0 && invalidFor.length === 0 && rules.length > 0,
    rules: rules.length,
    metrics: available.length,
    unknownMetrics,
    duplicateIds,
    missingRunbook,
    invalidFor
  };
}

/**
 * Erzeugt die Prometheus-Regeldatei. Der Serialisierer kennt nur das hier
 * verwendete YAML-Teilmenge (Skalare, Listen, verschachtelte Abbildungen) —
 * dadurch gibt es keine Überraschungen durch einen Fremdparser, und ein Test
 * kann die Struktur zeichengenau prüfen.
 */
export function renderPrometheusRules(rules: AlertRule[] = ALERT_RULES): string {
  const lines: string[] = [
    "# Erzeugt aus lib/alerting.ts — nicht von Hand bearbeiten.",
    "# Abholbar über GET /api/alerts?format=prometheus (Session erforderlich).",
    "# Prüfung: jede Kennzahl muss im Exporter GET /api/metrics existieren.",
    "groups:",
    "  - name: babajagabob",
    "    rules:"
  ];
  for (const rule of rules) {
    lines.push(`      - alert: ${rule.id}`);
    lines.push(`        expr: ${rule.expr}`);
    lines.push(`        for: ${rule.for}`);
    lines.push("        labels:");
    lines.push(`          severity: ${rule.severity}`);
    lines.push("        annotations:");
    lines.push(`          summary: ${JSON.stringify(rule.summary)}`);
    lines.push(`          runbook: ${JSON.stringify(rule.runbook)}`);
  }
  return `${lines.join("\n")}\n`;
}

export function alertingReport(available = exportedMetricNames()) {
  const validation = validateAlertRules(ALERT_RULES, available);
  return {
    rules: ALERT_RULES,
    validation,
    // Der Scraper sammelt ohnehin nur Zahlen; die Regeln enthalten keine
    // Geheimnisse, sondern Ausdrücke und Handlungsanweisungen.
    yaml: renderPrometheusRules()
  };
}
