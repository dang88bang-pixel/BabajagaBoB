# Recovery-Engine mit Stufen — Abschnitt 15

Implementierung: `lib/recovery-tier.ts` (Klassifikation), `lib/reliability.ts`
(Pläne, Checkpoints, Ausführung, Verifikation), `lib/error-intelligence.ts`
(Fehlerlebenszyklus), `lib/recovery-orchestrator.ts` (Readiness, Isolation),
`lib/regression.ts` (Regression Lock), Routen `app/api/reliability/route.ts`,
`app/api/errors/route.ts`, `app/api/readiness/route.ts`.

## 1. Automatische Stufenklassifikation

`classifyRecoveryTier(input)` (`lib/recovery-tier.ts`) leitet die Stufe aus dem
Fehlerbild ab und **begründet** sie in `reasons[]`. Sie ist konservativ: im Zweifel
wird die eingriffstiefere Stufe gewählt. Sie erteilt **keine** Berechtigung —
ab Stufe 4 verlangt sie ausdrücklich Creator-Freigabe
(`requiresCreatorApproval = tier >= 4`).

| Stufe | Bedeutung | typische Auslöser | Schritte |
|---|---|---|---|
| 1 | Beobachtung/Zustandswechsel ohne Eingriff | Wiederholung, Timeout in einem Versuch, fehlende Telemetrie | beobachten, protokollieren, erneut prüfen |
| 2 | Wiederherstellung aus Snapshot in der Diagnosesandbox | reproduzierbarer Fehllauf mit vorhandenem Checkpoint | Snapshot wählen, in Diagnosesandbox wiederherstellen, verifizieren |
| 3 | Eingriff in Sandbox/Umgebung (Reset, Neuaufbau) | Umgebungs-/Ressourcenfehler, beschädigter Workspace, erneuter Fehler nach Restore | isolieren, Workspace neu aufbauen, erneut ausführen |
| 4 | Eingriff in Code/Artefakt (Fix + erneute Ausführung) | Ursache im Artefakt/Code | Fix vorbereiten, Regressionstest, erneut ausführen |
| 5 | Eingriff in Struktur (Task, Sandbox, Pipeline) | kritische oder sicherheitsrelevante Ursache, Änderung außerhalb der Sandbox | eskalieren, Struktur ändern, Freigabe einholen |

Eingangssignale: `severity`, `failureMode`, `symptom`, `incident`, `rootCause`,
`contributingFactors`, `hasCheckpoint`, `hasDiagnosticSandbox`,
`previousRecoveryVerified`, `securityRelated`. Die Stichwortlisten sind im Code
dokumentiert (`ENVIRONMENT_HINTS`, `CODE_HINTS`, …); bewusst enthält `CODE_HINTS`
**nicht** das Wort „code", damit „Exit-Code 7" nicht als Codefix fehlklassifiziert wird.
Auch `lib/reliability.ts#prepareRecovery` nutzt die Klassifikation, wenn keine Stufe
übergeben wird (Standard war zuvor fest 2).

## 2. Ablauf

```
recordFailure → prepareRecovery → createCheckpoint → beginRecovery
              → verifyRecovery → resolveFailure → lockRegressionFromFailure
```

- `recordFailure` protokolliert Betriebsfehler (`lib/reliability.ts`), `listFailures`/`updateFailure` verwalten sie.
- `createCheckpoint(sandboxId)` legt einen echten Snapshot an und bindet ihn an den Plan.
- `beginRecovery(recoveryId)` führt die Schritte aus und wechselt in den Zustand `RUNNING` (mit Isolation über den Kill Switch der Task, `lib/recovery-orchestrator.ts#recoverFailure`).
- `verifyRecovery(recoveryId)` prüft den Plan gegen den Checkpoint: Digest, Workspace-Zustand und Verifikationsschritte. Erst danach ist ein Plan `VERIFIED`.
- `resolveFailure` schließt den Fehler ab; `lockRegressionFromFailure` überführt die Erkenntnis in eine Regression (`docs/KNOWLEDGE.md`).

Ein Recovery gilt nur dann als erfolgreich, wenn die Verifikation bestanden ist —
ein „gestarteter" Plan zählt nicht.

## 3. Kopplung an den Fehlerlebenszyklus

`lib/error-intelligence.ts` speichert an jedem Incident
`recoveryTier`, `recoveryReasons` und `recoveryRequiresApproval`. Der Übergang
nach `VERIFYING` erfolgt durch `verifyRecoveryForIncident`; `verifyFix` bleibt für
den manuellen Pfad (Regression/Fix-Verifikation) nutzbar. Stufe 4/5 ohne
Creator-Freigabe endet in `ESCALATED` (Creator Inbox, `docs/OPERATIONS.md`).

## 4. Kill Switch und Isolation

`recoverFailure` setzt einen Task-Kill-Switch (`Recovery isolation`) bevor
wiederhergestellt wird. Der Execution Gate verweigert danach jede weitere
Ausführung dieser Task, bis der Switch wieder gelöst ist. System-Lockdown
(`engageSystemLockdown`) sperrt zusätzlich alles.

## 5. Readiness

`detectReadiness()` liefert `{activeTasks, blockedTasks, lockdown, ready}`;
`ready` ist nur wahr, wenn kein Lockdown aktiv ist **und** keine Task blockiert ist.

## 6. Grenzen

- Pläne sind lokal und synchron; es gibt keine verteilte Wiederaufnahme über mehrere Knoten.
- Ein Rollback wird als eigenes Artefakt geführt (`rollbackArtifactId` am Run); ein
  automatischer Rollback von Fremdsystemen (Deployments) ist `NOT_IMPLEMENTED`.
- `previousRecoveryVerified` wird aus den Plänen abgeleitet und ist nur so gut wie
  die dokumentierte Verifikation.

## 7. Tests

- `tests/unit/recovery-tier.test.ts` — 6 Fälle der Klassifikation inkl. Sicherheits-/Kritikalitätspfad.
- `tests/e2e/failure-recovery.test.ts` — Fehler → Untersuchung → Recovery → Verifikation → Regression → Wissen.
- `tests/regression/regression-engine.test.ts` — Regression Lock aus Fehlern.
- `scripts/verify-live.sh` — Fehler-, Reliability- und Readiness-Routen über HTTP.
