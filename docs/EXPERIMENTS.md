# Experimente und Kausalität

**Stand:** 2026-09-25
**Module:** `lib/science.ts` (Experiment-Engine), `lib/error-intelligence.ts`
(Fehler-getriebene Experimente), `lib/regression.ts` (Nachweis)

**Grundsatz:** Ein Experiment behauptet nichts. Es läuft über den Broker in einer
Sandbox, erzeugt Evidenz, und erst die strukturierte Kausalprüfung erlaubt einen
höheren Wissenszustand.

## 1. Ablauf

```
createObjective → createExperiment → runExperiment(BASELINE)
   → runExperiment(CONTROL) → runExperiment(REPLICATION, n×)
   → addEvidence(...) → validateCausalChain(...) → createDecision(...)
```

Jeder `runExperiment`-Aufruf geht durch `executeAuthorized` (Broker, 17 Prüfungen)
und verlangt ein Capability-Token. Fehlt die Autorisierung, wird der Lauf nicht
ausgeführt – es entsteht kein „weiches" Ergebnis.

## 2. Laufarten (`ExperimentRun.kind`)

| Art | Zweck |
|---|---|
| `BASELINE` | Ausgangszustand ohne Intervention (muss zuerst beobachtet werden) |
| `CONTROL` | Kontrollbedingung; ein nicht akzeptierter Kontrolllauf ist ein Widerspruch |
| `REPLICATION` | Wiederholung; `repeat` steuert die Anzahl |

Fortschritt: drei Arten = 100 % (`progress` in `createExperiment`/`runExperiment`).

## 3. Kausalprüfung (`validateCausalChain`)

Geprüft werden neun Gesichtspunkte; jeder fehlende Punkt ist ein `reason` und
verhindert `valid: true`:

1. zeitliche Reihenfolge (Baseline vor Kontrolle),
2. notwendige Vorbedingungen (Baseline vorhanden),
3. Intervention (Kontrollbedingung vorhanden),
4. Kontrollgruppe,
5. Reproduktion (mindestens eine Replikation),
6. Übereinstimmung der Replikationen (`replicationAgreement`, Abweichung → Fehler),
7. dokumentierte alternative Erklärungen bei vorhandenen Confoundern,
8. unabhängige Evidenz (mindestens eine Evidenz-ID),
9. Gegenbeispiel/Widerspruch (nicht akzeptierter Kontrolllauf).
Zusätzlich fließen `confounders` und `alternativeExplanations` in das Ergebnis ein.

Wissenszustand des Experiments:

| Situation | Zustand |
|---|---|
| Widerspruch (Kontrolllauf nicht akzeptiert oder bereits `CONTRADICTED`) | `CONTRADICTED` |
| alle Prüfungen bestanden | `ESTABLISHED` |
| Replikation oder Evidenz vorhanden, aber Lücken | `SUPPORTED` |
| nur Hypothese | `HYPOTHESIS` |

Ergebnis und Gründe werden als `science.causal.validation` beobachtet
(`decision: DENY` bei `valid: false`) – der Nachweis der Ablehnung ist damit
genauso sichtbar wie der Erfolg.

## 4. Fehlergetriebene Experimente (`lib/error-intelligence.ts`)

```
createErrorIncident → investigateError (Diagnosesandbox)
   → formHypothesis → startExperiment(incidentId, objectiveId)
   → recordExperimentEvidence → establishRootCause (Evidenzpflicht!)
   → prepareErrorRecovery → executeRecoveryForIncident → createRegressionTest
   → verifyRecoveryForIncident (→ VERIFYING) → verifyFix (→ LEARNED)
   → learnFromError (→ REGRESSION_LOCKED)
```

- `startExperiment` wechselt nach `EXPERIMENTING` und verlangt ein Objective
  (Default `OBJ-003`, über HTTP als `objectiveId` übergebbar).
- `establishRootCause` verweigert ohne Evidenz (`/evidence/i`).
- `verifyFix` ist idempotent: eine verifizierte Recovery führt den Incident nach
  `VERIFYING`; ein bereits gelernter Fix bleibt `LEARNED`. Wiederholte
  Verifikation ist damit möglich, ohne Statusfehler.
- `learnFromError` ist ausschließlich aus `LEARNED` möglich.

## 5. Schnittstellen

| Zugriff | Wirkung |
|---|---|
| `GET /api/science`, `GET /api/experiments` | Experimente, Läufe, Evidenz |
| `POST /api/errors {action:"create"\|"investigate"\|"hypothesis"\|"experiment"\|"evidence"\|"root_cause"\|"recovery.prepare"\|"recovery.execute"\|"recovery.verify"\|"fix.verify"\|"regression"\|"learn"\|"transition"}` | Lifecycle-Schritte |
| `GET /api/errors` | Incidents + Zusammenfassung |

## 6. Verifikation

- `tests/e2e/failure-recovery.test.ts`: vollständige Kette bis
  `REGRESSION_LOCKED`, Evidenzpflicht negativ geprüft.
- `scripts/verify-live.sh` Schritt 6: dieselbe Kette über HTTP inkl.
  `fix.verify`.
- `tests/regression/regression-engine.test.ts`: Regression als Nachweis
  (`docs/RECOVERY.md`).

## 7. Offen

- Kein statistischer Test (Signifikanz/Effektstärke); die Prüfung ist strukturell.
- `runExperiment` verlangt einen explizit übergebenen Sandbox- und Task-Bezug;
  automatische Sandbox-Provisionierung je Experiment fehlt.
