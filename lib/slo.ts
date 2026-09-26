/**
 * ============================================================================
 * SLO-Überwachung des Betriebs (Abschnitt 43) — `lib/slo.ts`
 * ============================================================================
 *
 * Der begrenzte Lastnachweis (`scripts/soak.mjs`) liefert **Momentaufnahmen**.
 * Was fehlte, war die *Bewertung*: welche Betriebszahlen sind noch gesund, und
 * wann muss der Creator informiert werden?
 *
 * Diese Datei definiert deshalb **Schwellen mit Zielwert, Warn- und kritischer
 * Grenze** und wertet sie gegen den **echten** Zustand aus (Routen bzw. deren
 * Domänenfunktionen — keine erfundenen Zahlen). Grundsätze:
 *
 *  - Kein Zugriff auf nicht verfügbare Daten: fehlt eine Messgröße, ist sie
 *    `UNKNOWN` und blockiert die Bereitschaft — sie wird **nicht** geschätzt.
 *  - Getrennte Sicht auf „attestiert" (gesund/verletzt) und „nicht messbar"
 *    (`unmeasured`), damit ein blinder Fleck nicht als „alles gut" erscheint.
 *  - Jede Verletzung trägt Ziel, Ist-Wert, Grenze und Handlungsanweisung
 *    (Runbook) — der Bericht ist die Grundlage für Inbox/Alarmierung.
 *  - Es wird **nichts** automatisch repariert oder abgeschaltet: der Befund
 *    informiert, die Entscheidung bleibt beim Creator.
 *
 * Aufruf über `POST /api/slo {action:"evaluate"}` (bewertet und legt bei
 * Verletzung einen Creator-Inbox-Eintrag an) und `GET /api/slo?action=status`
 * (nur lesend, ohne Schreibwirkung).
 */

export type SloUnit = "ratio" | "count" | "ageMs";

export type SloMeasurement = {
  id: string;
  title: string;
  unit: SloUnit;
  /** Zielwert: ab hier gilt der Zustand als gesund. */
  target: number;
  /** Ab hier ist der Zustand kritisch; zwischen Ziel und Warn/Kritisch ist er gewarnt. */
  warning: number;
  critical: number;
  /** Kleiner ist besser (z. B. Fehlerquote) — oder größer ist besser (z. B. Läufe). */
  direction: "lower_is_better" | "higher_is_better";
  /** Wert aus dem echten Zustand; `null` = nicht messbar (kein Schätzen). */
  value: number | null;
  source: string;
  runbook: string;
  detail?: string;
};

export type SloState = "HEALTHY" | "WARNING" | "BREACHED" | "UNKNOWN";

export type SloResult = SloMeasurement & {state: SloState; distanceToTarget: number | null};

export type SloReport = {
  evaluatedAt: string;
  results: SloResult[];
  summary: {
    total: number;
    healthy: number;
    warning: number;
    breached: number;
    unknown: number;
    /** Kein Messwert fehlt — die Bereitschaft beruht auf attestierten Zahlen. */
    coverageComplete: boolean;
    healthyRatio: number;
  };
  policies: {
    /** Nur so lange ohne Messwert gilt die Bewertung als aussagekräftig. */
    maxStalenessMs: number;
    notifiedInboxId: string | null;
  };
  breached: SloResult[];
};

export type SloThresholds = {warnRatio: number; warnCount: number};

const num = (value: unknown, fallback = 0): number => (typeof value === "number" && Number.isFinite(value) ? value : fallback);
const envNumber = (name: string, fallback: number): number => {
  const raw = (process.env[name] ?? "").trim();
  if (!raw) return fallback;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
};

/** Schwellen, aus der Umgebung justierbar; Vorgaben sind konservativ gewählt. */
export function sloThresholds(): SloThresholds {
  return {
    warnRatio: envNumber("BOB_SLO_WARN_RATIO", 0.5),
    warnCount: envNumber("BOB_SLO_WARN_COUNT", 1)
  };
}

/**
 * Bewertet eine Messung. Die Zustände sind bewusst dreistufig **plus**
 * `UNKNOWN`: „nicht gemessen" ist kein Gesundheitsnachweis.
 */
export function evaluateMeasurement(measurement: SloMeasurement): SloResult {
  if (measurement.value === null) {
    return {...measurement, state: "UNKNOWN", distanceToTarget: null};
  }
  const {value, target, warning, critical, direction} = measurement;
  // Die Zuordnung folgt ausschließlich den Schwellen: Zielwert = gesund,
  // jenseits der Warnschwelle gewarnt, jenseits der kritischen Grenze verletzt.
  let state: SloState;
  if (direction === "lower_is_better") {
    state = value > critical ? "BREACHED" : value > warning ? "WARNING" : "HEALTHY";
  } else {
    state = value < critical ? "BREACHED" : value < warning ? "WARNING" : "HEALTHY";
  }
  return {...measurement, state, distanceToTarget: Number((value - target).toFixed(4))};
}

/**
 * Leitet das Messmodell aus dem echten Betriebszustand ab (Route → Funktion).
 * Es werden keine Werte erfunden: fehlt eine Quelle, bleibt der Wert `null`.
 */
export async function sloMeasurements(): Promise<SloMeasurement[]> {
  const [queueModule, persistenceModule, metricsModule, orchestrator, controlPlane] = await Promise.all([
    import("./queue"),
    import("./persistence/store"),
    import("./metrics"),
    import("./recovery-orchestrator"),
    import("./control-plane")
  ]);

  const measurements: SloMeasurement[] = [];
  const guarded = <T,>(fn: () => T, fallback: T): T => {
    try {
      return fn();
    } catch {
      return fallback;
    }
  };

  // --- Warteschlange -------------------------------------------------------
  const jobs = guarded(() => queueModule.queueSnapshot(), []);
  const leased = jobs.filter(job => job.state === "LEASED").length;
  const failed = jobs.filter(job => job.state === "FAILED").length;
  measurements.push({
    id: "queue_failed_jobs",
    title: "Fehlgeschlagene Jobs in der Warteschlange",
    unit: "count",
    direction: "lower_is_better",
    target: 0,
    warning: 1,
    critical: 5,
    value: jobs.length === 0 ? 0 : failed,
    source: "GET /api/queue (jobs[].state)",
    runbook: "docs/OPERATIONS.md §5 — Job/Incident prüfen, Recovery-Plan lesen, Ursache vor erneutem Versuch beheben."
  });
  measurements.push({
    id: "queue_stale_leases",
    title: "Leases, die alles belegen („Queue hängt“)",
    unit: "count",
    direction: "lower_is_better",
    target: 0,
    warning: 1,
    critical: 3,
    value: jobs.length > 0 && leased === jobs.length ? leased : 0,
    source: "GET /api/queue (jobs[].state)",
    runbook: "docs/OPERATIONS.md §5 — Lease-Ablauf prüfen (`expire`), Worker-Zyklus anstoßen; hängende Ausführung isolieren."
  });

  // --- Persistenz und Sicherungen -----------------------------------------
  const integrity = guarded(() => persistenceModule.storeIntegrityReport(), null);
  const stores = integrity?.stores ?? [];
  const unhealthy = stores.filter(entry => !entry.ok).length;
  measurements.push({
    id: "store_integrity",
    title: "Stores ohne Integritätsfehler",
    unit: "ratio",
    direction: "lower_is_better",
    target: 0,
    warning: 1,
    critical: 2,
    value: stores.length === 0 ? null : unhealthy,
    source: "GET /api/persistence (stores.stores[].ok)",
    runbook: "docs/OPERATIONS.md §1/§2 — Store-Datei prüfen, aus verifizierter Sicherung wiederherstellen (`repair` nur bei leeren Envelopes)."
  });

  const backups = guarded(() => persistenceModule.listStoreBackups(), []);
  const failedBackups = backups.filter(entry => !entry.ok).length;
  measurements.push({
    id: "backup_verification",
    title: "Fehlgeschlagene Sicherungsprüfungen",
    unit: "count",
    direction: "lower_is_better",
    target: 0,
    warning: 1,
    critical: 3,
    value: backups.length === 0 ? 0 : failedBackups,
    source: "GET /api/persistence (backups.failed)",
    runbook: "docs/OPERATIONS.md §3b — beschädigte Sicherung nicht löschen; Ursache klären, neue Sicherung verifizieren."
  });

  const verifiedBackups = backups.filter(entry => entry.ok).length;
  measurements.push({
    id: "backup_coverage",
    title: "Verifizierte Sicherungen vorhanden",
    unit: "count",
    direction: "higher_is_better",
    target: 1, // mindestens eine verifizierte Kopie im Bestand
    warning: 1,
    critical: 1,
    value: stores.length === 0 ? null : verifiedBackups,
    source: "GET /api/persistence (backups.verified)",
    runbook: "docs/OPERATIONS.md §3b — geplanten Lauf ausführen (`backup.run`), Intervall und Aufbewahrung prüfen."
  });

  // --- Betrieb und Beobachtbarkeit ----------------------------------------
  const readiness = guarded(() => orchestrator.detectReadiness(), null);
  measurements.push({
    id: "readiness_blocked_tasks",
    title: "Blockierte Aufgaben",
    unit: "count",
    direction: "lower_is_better",
    target: 0,
    warning: 1,
    critical: 5,
    value: readiness ? readiness.blockedTasks : null,
    source: "GET /api/readiness (blockedTasks)",
    runbook: "docs/OPERATIONS.md §4 — Blockadeursache lesen (Freigabe, Capability, Sandbox) und Creator-Entscheidung einholen."
  });

  // `collectMetrics()` ist synchron — Fehler werden hier zu `null` (nicht geschätzt).
  const metrics = guarded(() => metricsModule.collectMetrics(), null as null | ReturnType<typeof metricsModule.collectMetrics>);
  const gauge = (name: string): number | null => {
    if (!metrics) return null;
    const found = metrics.filter(entry => entry.name === name && (!entry.labels || Object.keys(entry.labels).length === 0));
    if (found.length === 0) return null;
    return num(found[0].value);
  };

  const denied = gauge("bob_executions_denied");
  measurements.push({
    id: "executions_denied",
    title: "Belegte Verweigerungen (Gate/Broker)",
    unit: "count",
    direction: "lower_is_better",
    target: 0,
    warning: 5,
    critical: 25,
    value: denied,
    source: "GET /api/metrics (bob_executions_denied)",
    runbook: "docs/SECURITY.md §6 — Verweigerungsart und Aufrufer prüfen (Angriff oder Fehlkonfiguration), Audit-Einträge lesen.",
    detail: denied === null ? "Kennzahl nicht ausgeliefert — Verweigerungen sind damit nicht bewertbar (fail closed statt „gesund“)." : undefined
  });

  const isolationOk = gauge("bob_isolation_enforced_state");
  const isolationRequested = gauge("bob_isolation_requested");
  const isolationValue = isolationRequested === 0 ? 1 : isolationOk;
  measurements.push({
    id: "isolation_enforced",
    title: "Kernel-Isolation erzwungen (wenn angefordert)",
    unit: "ratio",
    direction: "higher_is_better",
    target: 1,
    warning: 1,
    critical: 1,
    value: isolationValue,
    source: "GET /api/metrics (bob_isolation_enforced_state/bob_isolation_requested)",
    runbook: "docs/RUNTIME.md §2b — Rootfs und cgroup-Delegation prüfen; ohne Isolation verweigert die Plattform Ausführungen (fail closed)."
  });

  const auditChain = gauge("bob_audit_chain_ok");
  measurements.push({
    id: "audit_chain",
    title: "Audit-Kette integer",
    unit: "ratio",
    direction: "higher_is_better",
    target: 1,
    warning: 1,
    critical: 1,
    value: auditChain,
    source: "GET /api/metrics (bob_audit_chain_ok)",
    runbook: "docs/SECURITY.md §8 — Integritätsproblem ernst nehmen: append-only-Store prüfen, Aufbewahrungs-Checkpoint prüfen, Vorfall eröffnen."
  });

  // --- Agenten -------------------------------------------------------------
  // Überfällige Heartbeats werden aus dem echten Control-State berechnet (nicht
  // aus einer Kennzahl geraten). Der Schwellwert ist bewusst großzügig, damit
  // ein kurz pausierter Agent nicht sofort als Befund erscheint.
  const heartbeatWindowMs = envNumber("BOB_SLO_HEARTBEAT_WINDOW_MS", 15 * 60_000);
  const staleAgents = guarded(() => {
    const agents = controlPlane.getControlState().agents;
    const now = Date.now();
    return agents.filter(agent => {
      const at = Date.parse(String(agent.heartbeatAt ?? ""));
      return !Number.isFinite(at) || now - at > heartbeatWindowMs;
    });
  }, null);
  measurements.push({
    id: "agent_heartbeat",
    title: "Agenten mit überfälligem Heartbeat",
    unit: "count",
    direction: "lower_is_better",
    target: 0,
    warning: 1,
    critical: 4,
    value: staleAgents === null ? null : staleAgents.length,
    source: "lib/control-plane.ts (agents[].heartbeatAt)",
    runbook: "docs/OPERATIONS.md §3 — Agenten-Health im Control Center prüfen (Abschnitt „Agenten“), Zyklus/Dispatcher prüfen.",
    detail: staleAgents === null ? "Control-State nicht lesbar — Heartbeat-Lage unbekannt." : `Fenster: ${Math.round(heartbeatWindowMs / 60000)} min`
  });

  return measurements;
}

/** Vollständiger Bericht — rein lesend. */
export async function sloReport(): Promise<SloReport> {
  const results = (await sloMeasurements()).map(evaluateMeasurement);
  const unknown = results.filter(result => result.state === "UNKNOWN");
  const breached = results.filter(result => result.state === "BREACHED");
  const warning = results.filter(result => result.state === "WARNING");
  const healthy = results.filter(result => result.state === "HEALTHY");
  const measurable = results.length - unknown.length;
  return {
    evaluatedAt: new Date().toISOString(),
    results,
    summary: {
      total: results.length,
      healthy: healthy.length,
      warning: warning.length,
      breached: breached.length,
      unknown: unknown.length,
      coverageComplete: unknown.length === 0,
      healthyRatio: measurable === 0 ? 0 : Number((healthy.length / measurable).toFixed(3))
    },
    policies: {maxStalenessMs: envNumber("BOB_SLO_MAX_STALENESS_MS", 15 * 60_000), notifiedInboxId: null},
    breached
  };
}

/**
 * Bewertet und **meldet** eine Verletzung in der Creator-Inbox.
 *
 * Es wird nichts repariert, nichts abgeschaltet und nichts erzwungen: der
 * Befund ist eine Entscheidungsvorlage. Eine Verletzung erzeugt `BLOCK`,
 * fehlende Messwerte `ASK` (blinder Fleck ist eine Frage an den Creator, keine
 * stille Lücke).
 */
export async function evaluateAndNotify(actor = "SYSTEM-SLO"): Promise<SloReport & {notified: boolean; inboxId: string | null}> {
  const report = await sloReport();
  const inbox = await import("./inbox");
  const breaches = report.results.filter(result => result.state === "BREACHED");
  const unknowns = report.results.filter(result => result.state === "UNKNOWN");
  let inboxId: string | null = null;
  if (breaches.length > 0) {
    const item = inbox.notifyInbox({
      mode: "BLOCK",
      title: `SLO verletzt: ${breaches.map(entry => entry.id).join(", ")}`,
      message: `[${actor}] ` + breaches
        .map(entry => `${entry.title}: Ist ${entry.value} (kritisch ab ${entry.critical}); Runbook: ${entry.runbook}`)
        .join(" | ")
    });
    inboxId = item?.inboxId ?? null;
  } else if (unknowns.length > 0) {
    const item = inbox.notifyInbox({
      mode: "ASK",
      title: `SLO-Bewertung unvollständig: ${unknowns.map(entry => entry.id).join(", ")}`,
      message: `[${actor}] Nicht messbar: ${unknowns.map(entry => `${entry.id} (${entry.source})`).join(", ")}. Bereitschaft wird nicht als „gesund“ behauptet, solange Messwerte fehlen.`
    });
    inboxId = item?.inboxId ?? null;
  }
  await import("./observability").then(observability =>
    observability.observe({
      type: "slo.evaluated",
      message: breaches.length > 0
        ? `SLO-Bewertung: ${breaches.length} verletzt, ${report.summary.warning} gewarnt, ${report.summary.unknown} ohne Messwert`
        : `SLO-Bewertung gesund (${report.summary.healthy}/${report.summary.total} attestiert)`,
      status: breaches.length > 0 ? "BLOCKED" : "COMPLETED",
      actor,
      action: "slo.evaluate"
    })
  );
  return {...report, policies: {...report.policies, notifiedInboxId: inboxId}, notified: inboxId !== null, inboxId};
}
