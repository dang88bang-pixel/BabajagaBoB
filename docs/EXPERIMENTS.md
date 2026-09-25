# Experimentierfabric mit kausaler Validierung — Abschnitt 14/21

Implementierung: `lib/science.ts`, `app/api/science/route.ts`, `app/api/experiments/route.ts`,
`lib/error-intelligence.ts` (Fehlerexperimente).

## 1. Objekte

| Objekt | Funktion |
|---|---|
| Objective | `createObjective()` — Ziel innerhalb einer Mission |
| Experiment | `createExperiment()` — Hypothese + Sandbox + Metriken + Konfunder + Alternativerklärungen |
| Lauf | `runExperiment()` — führt einen Lauf in der Sandbox aus (über den Broker) |
| Evidenz | `addEvidence()` — digestgebundene Beobachtung zum Experiment |
| Entscheidung | `createDecision()` — dokumentierte Entscheidung mit Begründung |
| Validierung | `validateCausalChain()` — bewertet Baseline/Kontrolle/Replikation |

## 2. Zustandsmodell (KnowledgeState)

Erlaubte Zustände: `OBSERVED | SUPPORTED | ESTABLISHED | HYPOTHESIS | UNVERIFIED |
CONTRADICTED | REJECTED | UNKNOWN`.

Regeln in `validateCausalChain`:

- Ohne Baseline, Kontrollgruppe, Replikation oder Evidenz bleibt es `HYPOTHESIS`
  bzw. `SUPPORTED` (Gründe werden im Ergebnis mitgeliefert).
- **Ein einzelner erfolgreicher Lauf setzt niemals `ESTABLISHED`.**
- `ESTABLISHED` nur, wenn Baseline, Kontrolle und Replikation vorliegen, die
  Replikationen **vollständig übereinstimmen** (`replicationAgreement === 1`),
  Evidenz vorhanden ist, Baseline vor der Kontrolle beobachtet wurde und für alle
  Konfunder Alternativerklärungen dokumentiert sind.
- Widerspricht eine Kontrollbedingung oder ist der Zustand bereits `CONTRADICTED`,
  bleibt der Zustand `CONTRADICTED` — unabhängig von sonstigen Erfolgen.
- Jeder Ablehnungsgrund steht als Text in `reasons[]`; es gibt keinen stillen „Bestanden"-Pfad.

## 3. Kontrollierte Bedingungen

`runExperiment` erzeugt Läufe mit `kind` `BASELINE`, `CONTROL`, `REPLICATION`
(und Messläufe). Die Zuordnung wird persistiert (`science`-Store und `experiments`-Store).
Ausführung erfolgt immer über den Execution Broker mit Capability-Token; ein
Experiment kann die Sandbox- und Risikogrenzen nicht umgehen.

## 4. Verbindung zum Fehlerpfad

`POST /api/errors {action:"experiment"}` legt zu einem Fehler ein Experiment an,
`{action:"evidence"}` nimmt Messwerte auf, `{action:"root_cause"}` bindet die
Ursache an Evidenz-IDs. Der Zustand des Fehlers folgt der Fehlerintelligenz
(`docs/RECOVERY.md`), der Wissensteil dem Knowledge Graph (`docs/KNOWLEDGE.md`).

## 5. Visualisierung

`lib/simulation.ts` erzeugt Szenarien (Zeitverlauf, Varianten, Vergleichsläufe,
Was-wäre-wenn) und `POST /api/simulation {action:"advance"}` schaltet sie weiter.
Die Simulation ist ausdrücklich **SIMULATED** — sie ersetzt keine Messung und
liefert keine Evidenz im Sinne von `lib/artifacts.ts`.

## 6. Grenzen

- Keine statistische Signifikanzberechnung (kein p-Wert). Bewertet wird
  Übereinstimmung der Replikationen und Vollständigkeit der Bedingungen —
  das ist eine strukturelle, keine statistische Aussage (`UNVERIFIED` bzgl. Signifikanz).
- Läufe sind lokal begrenzt (Timeout/Limits); sehr lange Experimente sind nicht möglich.

## 7. Tests

- `tests/e2e/failure-recovery.test.ts` — Experiment + Evidenz im Fehlerpfad.
- `tests/regression/regression-engine.test.ts` — Regression aus Erkenntnis.
- `scripts/verify-live.sh` — Experiment- und Wissenschaftsrouten über HTTP.
