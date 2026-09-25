# Recovery und Regression

**Stand:** 2026-09-25
**Module:** `lib/reliability.ts` (Pläne, Failures, Verifikation),
`lib/regression.ts` (Regressionstests), `lib/error-intelligence.ts` (Anbindung an
den Fehler-Lebenszyklus), `lib/recovery-orchestrator.ts` (Bereitschaft)

**Grundsatz:** Recovery gilt erst als erfolgreich, wenn sie **verifiziert** ist.
Ohne Snapshot und bestandene Regression gibt es kein `ACCEPT` – im Zweifel
`REJECTED`, nie ein stiller Erfolg.

## 1. Zustände

| Gegenstand | Zustände |
|---|---|
| Failure | `OPEN` → `ANALYZING` → `CONTAINED` → `RESOLVED` / `VERIFIED` (`lib/reliability.ts`) |
| Recovery-Plan | `PREPARED` → `EXECUTING` → `VERIFIED` / `REJECTED` |
| Fehler-Incident (Anbindung) | `DETECTED` → `DIAGNOSING` → `EXPERIMENTING` → `ROOT_CAUSE_FOUND` → `FIXING` → `VERIFYING` → `LEARNED` → `REGRESSION_LOCKED` |

## 2. Gestufte Recovery (`RecoveryTier`)

Die Stufen beschreiben den Eingriffsumfang; der Plan hält `tier`, `steps`,
`checkpointSnapshotId`, `diagnosticSandboxId` und `verificationPlan` fest
(Default-Tier 2, Default-Verifikationsplan „smoke test" + „regression suite").

| Tier | Bedeutung (Eingriffstiefe) |
|---|---|
| 1 | Beobachtung/Zustandswechsel ohne Eingriff (z. B. Retry, Rollback einer Transaktion) |
| 2 | Wiederherstellung aus Snapshot im Diagnosesandbox (Standard) |
| 3 | Eingriff in die Sandbox/Umgebung (Reset, Neuaufbau des Workspace) |
| 4 | Eingriff in Code/Artefakt (Fix + erneute Ausführung) |
| 5 | Eingriff in Struktur (Task, Sandbox, Pipeline) – immer Creator-gebunden |

Abgrenzung: Tier 4/5 erzeugen Änderungen und müssen über Approval laufen; die
Module selbst erzwingen den Nachweis (Verifikation), die Freigabe kommt aus
`lib/approvals.ts`/`lib/governance.ts`.

## 3. Ablauf (`lib/reliability.ts`)

```
recordFailure(...) → createCheckpoint({failureId, sandboxId})
   → prepareRecovery({failureId, steps, verificationPlan, diagnosticSandboxId, tier, checkpointSnapshotId})
   → beginRecovery(recoveryId)          # restoreSandbox(diagnosticSandboxId, snapshot)
   → verifyRecovery(recoveryId)         # verifySandboxState + Regression
   → resolveFailure(failureId, rootCause, regressionId)
   → lockRegressionFromFailure(failureId, argv)
```

- `beginRecovery` verlangt `status === "PREPARED"` und setzt den Failure auf
  `CONTAINED`; der Restore nutzt den echten Workspace-Snapshot mit Digest-Prüfung.
- `verifyRecovery` verlangt `status === "EXECUTING"` und einen Diagnosesandbox;
  `verifySandboxState` führt Smoke-/Regressionstests real aus. Nur `ACCEPT`
  ergibt `VERIFIED`, sonst `REJECTED` und der Failure fällt auf `ANALYZING`
  zurück. Beide Ausgänge werden beobachtet (`recovery.verified` bzw.
  `recovery.rejected`).
- `lockRegressionFromFailure` erzeugt einen dauerhaften Regressionstest („Never
  Again") mit `argv[]` – kein Shell-String.

## 4. Regression Engine (`lib/regression.ts`)

- Tests werden mit `argv[]` registriert und laufen über die echte Runtime
  (argv-Policy gilt auch hier); kein Mock, keine Shell.
- `runRegressionSuite` wertet PASS/FAIL aus; eine **leere Suite gilt als
  Fehlschlag** (fail closed) – „keine Tests" ist kein Nachweis.
- Ergebnis: `passedCount`, `total`, `failed[]`, Digest-gebundene Evidenz.

## 5. Anbindung an Error Intelligence

`prepareErrorRecovery` legt den Plan an, `executeRecoveryForIncident` führt ihn
aus (Incident → `FIXING`), `verifyRecoveryForIncident` verifiziert und führt den
Incident nach `VERIFYING`. `verifyFix` führt die Regression im Diagnosesandbox
aus; nur bei Erfolg wird der Incident `LEARNED` (und danach über
`learnFromError` → `REGRESSION_LOCKED`). `verifyFix` ist idempotent, damit ein
wiederholter Nachweis möglich bleibt.

## 6. Bereitschaft (`lib/recovery-orchestrator.ts`)

`detectReadiness()` (über `GET /api/readiness`) meldet, ob die Voraussetzungen für
eine Wiederherstellung erfüllt sind (Runtime, Sandbox-Bindung, Snapshot,
Regression, Store-Integrität). Fehlt eine Voraussetzung, ist der Zustand
ausdrücklich „nicht bereit" – ein Recovery-Lauf ohne Snapshot wird nicht
versucht.

## 7. Verifikation

- `tests/e2e/failure-recovery.test.ts`: echter Fehllauf (Exit 7) → Recovery →
  Regression → `REGRESSION_LOCKED`; Failure-Status `VERIFIED`, Plan `VERIFIED`,
  genau ein Regressionstest pro Incident.
- `tests/regression/regression-engine.test.ts`: argv-Policy, PASS/FAIL,
  leere Suite = Fehlschlag, Persistenz.
- `scripts/verify-live.sh` Schritt 6: dieselbe Kette über HTTP.

## 8. Offen (PARTIAL)

- Tier-Zuordnung ist eine Konvention im Plan, keine automatische Klassifikation;
  die Auswahl des minimal nötigen Tiers ist nicht erzwungen.
- Kein automatischer Rollback von Code-Artefakten (Tier 4) ohne Creator-Aktion.
