# Knowledge Graph und Gedächtnis — Abschnitt 19/20/33

Implementierung: `lib/knowledge.ts`, `lib/regression.ts`, `lib/artifacts.ts`,
`lib/provenance.ts`, Routen `app/api/knowledge/route.ts`, `app/api/gallery/route.ts`.

## 1. Vier Gedächtnisebenen

`MemoryLayer = WORKING | EPISODIC | SEMANTIC | NEGATIVE`

| Ebene | Inhalt |
|---|---|
| `WORKING` | aktueller Task/Arbeitsstand |
| `EPISODIC` | was konkret passiert ist (Ereignisse, Läufe, Vorfälle) |
| `SEMANTIC` | verallgemeinerte Erkenntnisse |
| `NEGATIVE` | **Negativwissen**: bekannte Fehlversuche, Grenzen, „Was funktioniert nicht" |

Wissen ist ein Graph: Knoten (`subject`, `predicate`, `object`) und Kanten
(`SUPPORTS | CONTRADICTS | DERIVED_FROM | REPRODUCED_BY | DEPENDS_ON | OBSERVED_IN`).
Jeder Knoten trägt `state` (`KnowledgeState`) und eine **Evidenzklasse** statt einer
„magischen" Konfidenzzahl:

```
EVIDENCE_BASED  – mindestens eine Evidence-ID
SINGLE_SOURCE   – nur Quellenangabe
UNVERIFIED      – weder noch
```

Klassifikation erfolgt automatisch in `classify(sourceIds, evidenceIds)`.

## 2. Wissenszustände

`OBSERVED | SUPPORTED | ESTABLISHED | HYPOTHESIS | UNVERIFIED | CONTRADICTED |
REJECTED | UNKNOWN`

Herkunft der Zustände:

- Aus **Experimenten**: `lib/science.ts#validateCausalChain` setzt `HYPOTHESIS`,
  `SUPPORTED`, `ESTABLISHED` oder `CONTRADICTED` nach den dort dokumentierten Regeln
  (ein einzelner erfolgreicher Lauf reicht nie für `ESTABLISHED`).
- Aus **Fehlern**: `lib/error-intelligence.ts` überführt verifizierte Fixes in
  Erkenntnisse (`learn`) und Negativwissen.
- Aus **Regressionen**: `lib/regression.ts` erzeugt einen Regressionstest mit
  Referenz auf den auslösenden Vorfall.

## 3. Negativwissen und Widersprüche

`negativeKnowledge()` und `contradictions()` liefern die entsprechenden Sichten.
Ein widersprüchlicher Knoten wird **nicht** stillschweigend überschrieben: die
Kante `CONTRADICTS` bleibt bestehen, beide Zustände sind sichtbar. Damit ist auch
eine widerlegte Annahme nachvollziehbar — sie wird nicht „aufgeräumt".

## 4. Regression Lock

`lockRegressionFromFailure` (in `lib/reliability.ts`) und der Regression-Engine-Pfad
(`lib/regression.ts`) erzeugen einen Test, der an den Vorfall gebunden ist. Der
Fehlerlebenszyklus endet erst in `REGRESSION_LOCKED`, wenn ein solcher Test
existiert und verifiziert wurde. Die CI führt die Regressionstests aus
(`tests/regression/regression-engine.test.ts` und die generierten Einträge).

## 5. Bezug zur Provenance

Jede Erkenntnis verweist über `evidenceIds` auf Evidenz aus `lib/artifacts.ts`
(digestgebunden, persistent) und über `sourceIds` auf Läufe/Experimente/Vorfälle.
Der Provenance-Graph (`lib/provenance.ts`) führt Knoten der Art `EVIDENCE`,
`KNOWLEDGE`, `INCIDENT`, `RECOVERY`, `REGRESSION` und verknüpft sie kausal
(`CAUSED_BY`, `DERIVED_FROM`, `PRODUCED`, `TESTED_BY`, `SUPPORTED`/`CONTRADICTED_BY`).

## 6. Grenzen

- Es gibt keine automatische Wissenskompression oder Embedding-Suche; die Suche ist
  eine Teilstring-/Feldabfrage (`searchKnowledge`).
- Wissen wächst lokal; Export/Import in externe Wissensspeicher ist `NOT_IMPLEMENTED`.

## 7. Tests

- `tests/e2e/failure-recovery.test.ts` — Fehler → Erkenntnis → Regression.
- `tests/regression/regression-engine.test.ts` — Regressionsexport in die Wissensschicht.
- `tests/integration/execution-evidence.test.ts` — Evidenzbindung.
- `scripts/verify-live.sh` — Knowledge-Routen über HTTP.
