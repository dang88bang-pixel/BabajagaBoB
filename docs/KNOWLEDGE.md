# Wissen und Gedächtnis

**Stand:** 2026-09-25
**Modul:** `lib/knowledge.ts`, Store `knowledge` (Envelope mit Digest)
**Grundsatz:** Wissen ohne Nachweis ist kein Wissen. Der Zustand eines Knotens
wird nicht behauptet, sondern über Quellen und Evidenz klassifiziert.

## 1. Vier Gedächtnisschichten (`MemoryLayer`)

| Schicht | Inhalt | Beispiel |
|---|---|---|
| `WORKING` | aktueller Arbeitskontext, kurzlebig | laufende Hypothese eines Tasks |
| `EPISODIC` | Ereignisse/Erfahrungen einzelner Läufe | „Lauf RUN-… scheiterte mit Exit 7" |
| `SEMANTIC` | Ursache-Wirkungs-Aussagen | `failureMode "…" → rootCause "…"` |
| `NEGATIVE` | „Never Again"-Wissen: was nicht funktioniert hat | Präventionsregel aus einem Incident |

## 2. Zustände (`KnowledgeState`)

`OBSERVED`, `SUPPORTED`, `ESTABLISHED`, daneben `HYPOTHESIS`, `UNVERIFIED`,
`CONTRADICTED` und `REJECTED` (`lib/types.ts`). Widersprüche werden erkannt
(`contradictions()`) und nicht stillschweigend überschrieben; ein widerlegter
Knoten bleibt als `CONTRADICTED`/`REJECTED` sichtbar.

**Klassifikation der Belegqualität** (`classify`, im Knoten als `confidence`):

| Klasse | Bedingung |
|---|---|
| `EVIDENCE_BASED` | mindestens eine Evidenz-ID vorhanden |
| `SINGLE_SOURCE` | nur Quellen, keine Evidenz |
| `UNVERIFIED` | weder Quelle noch Evidenz |

## 3. Kanten (`KnowledgeRelation`)

`SUPPORTS`, `CONTRADICTS`, `DERIVED_FROM`, `REPRODUCED_BY`, `DEPENDS_ON`,
`OBSERVED_IN` – gesetzt über `linkKnowledge(from, to, relation)`. Der Graph ist
durchsuchbar (`searchKnowledge`), nach Schicht filterbar (`knowledgeByLayer`)
und als Ganzes lesbar (`GET /api/knowledge` → `{nodes, edges}`).

## 4. Negatives Wissen

`learnFromError(incidentId, summary, verification)` ist **nur** aus dem Zustand
`LEARNED` möglich, also erst nach:

1. verifizierter Recovery (`verifyRecovery` → `VERIFIED`),
2. bestandener Regression im Diagnosesandbox (`verifyFix`).

Erzeugt wird ein `NEGATIVE`-Knoten (`Never Again: <Incident>`, Prädikat
`prevention`) und – bei bekannter Ursache – ein verknüpfter `SEMANTIC`-Knoten
(`DERIVED_FROM`). Der Zustand ist `ESTABLISHED` nur mit Root Cause **und**
Evidenz **und** Verifikation, sonst `SUPPORTED`.

## 5. Schnittstellen

| Zugriff | Wirkung |
|---|---|
| `GET /api/knowledge` | `{nodes, edges}` |
| `GET /api/knowledge?q=…` | `{records}` (Suche) |
| `POST /api/knowledge {action:"upsert"\|"update"\|"link"}` | **Creator-Aktion** (`knowledge:write`) |
| `knowledgeSummary()`, `negativeKnowledge()`, `unverifiedKnowledge()`, `contradictions()` | Auswertungen für UI und Berichte |
| `knowledgeStoreReport()` | Integritätsbericht des Stores |

Agenten dürfen Wissen lesen, aber nicht schreiben: Wissen ist Evidenz und darf
nicht von dem Subjekt erzeugt werden, das bewertet wird (`tests/security/route-guards.test.ts`).

## 6. Verifikation

- `tests/e2e/failure-recovery.test.ts`: negativer Knoten mit `ESTABLISHED`,
  semantische Ursache, Link, `knowledgeSummary().total > 0`.
- `scripts/verify-live.sh` Schritt 6: `fix.verify` → `LEARNED` → Lernen →
  `REGRESSION_LOCKED`, Knowledge-Graph enthält den negativen Knoten.

## 7. Offen

- Kein Vektor-/Embedding-Index: Suche ist Text-/Feldbasiert.
- Keine automatische Alterung/Verfallsprüfung von Wissen (Re-Verifikation über Zeit).
