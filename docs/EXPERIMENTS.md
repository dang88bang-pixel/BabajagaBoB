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

### 5a. Renderer (`lib/visualization.ts`)

Szenarien werden **deterministisch als SVG gerendert** — aus dem echten
Plattformzustand, nicht aus Beispielwerten:

| Art | Inhalt | Quelle |
|---|---|---|
| `ARCHITECTURE` | Durchsetzungskette Intent → Policy → Authorization → Execution Gate → Broker → Isolated Runtime → Evidence | Control Plane, Authority, Runs, Sandboxes, Events |
| `FLOW` | Creator → Mission → Objective → Task → Agent → Sandbox → Run → Evidence | Control Plane, Runs |
| `TIMELINE` | die jüngsten Ereignisse mit Zeitstempel | Event-Log (kausal) |
| `STATE_MACHINE` | Fehler-Lebenszyklus mit den **erlaubten** Übergängen und Vorkommen je Zustand | `ERROR_TRANSITIONS`, offene Vorfälle |
| `DEPENDENCY` | Laufzeiten mit Art, Version, Netzwerk-Default, Sandbox-Unterstützung | Runtime-Registry |
| `NETWORK` | Anteil der Objekte ohne externen Pfad (Sandboxes, Geräte, Provider, Computer) | Sandbox-/Device-/Provider-/Computer-Use-Fabric |
| `SCENE_3D` | axonometrische Projektion der Sandbox-Flotte, Höhe = Lebenszykluszustand | Sandbox-Fabric |

Aufruf:

```bash
# Bild (passiv, für <img>; ohne Skriptausführung im Browser)
GET  /api/simulation/render?id=<SCN-…>&kind=<ART>
# Render + Evidenzartefakt mit SHA-256-Digest (Creator-Akt)
POST /api/simulation {action:"render", id:"SCN-…", kind:"ARCHITECTURE"}
```

Sicherheitsgrenzen:

- **Escaping + Prüfung:** jeder eingefügte Wert wird XML-escaped; `assertPassiveSvg`
  prüft zusätzlich auf `<script`, `javascript:`, Ereignis-Attribute in Tag-Innenräumen,
  externe `href`/`src`, `<!ENTITY`, `<?xml-stylesheet`, `iframe`/`object`/`embed`/`foreignObject`
  und `data:text/html`. Ein Verstoß bricht den Render ab (fail closed).
- **Größe:** die Ausgabe bleibt unter 75 % von `MAX_CONTENT_BYTES`, damit sie als
  **vollständiges** Evidenzartefakt gespeichert wird; bei zu vielen Objekten werden
  Knoten weggelassen, nicht das Bild abgeschnitten (max. 24 Knoten je Bild).
- **Auslieferung:** `content-type: image/svg+xml`, `Content-Security-Policy: default-src 'none'`,
  `x-content-type-options: nosniff`. Das Bildroute-Ergebnis ist eine passive Ressource
  und wird in der Oberfläche als `<img>` eingebunden — nicht als eingebettetes Markup.
- Der Kopf jedes Bildes nennt Szenario und Zustand („Szenario SCN-… (DRAFT)") und trägt
  den Vermerk **SIMULATION — kein Nachweis**.

## 6. Grenzen

- Keine statistische Signifikanzberechnung (kein p-Wert). Bewertet wird
  Übereinstimmung der Replikationen und Vollständigkeit der Bedingungen —
  das ist eine strukturelle, keine statistische Aussage (`UNVERIFIED` bzgl. Signifikanz).
- Läufe sind lokal begrenzt (Timeout/Limits); sehr lange Experimente sind nicht möglich.

## 7. Tests

- `tests/e2e/failure-recovery.test.ts` — Experiment + Evidenz im Fehlerpfad.
- `tests/regression/regression-engine.test.ts` — Regression aus Erkenntnis.
- `tests/integration/visualization.test.ts` (11 Tests) — jede der sieben Arten wird als
  **XML geparst**, Determinismus, Escaping feindlicher Szenarionamen, Größenlimit,
  Evidenzartefakt mit Digest, Route-Verträge (`image/svg+xml`, CSP, 401/428, 404, 400).
- `scripts/verify-live.sh` — Experiment- und Wissenschaftsrouten über HTTP.
- `scripts/audit-actions.mjs` — jede Visualisierungsart wird gerendert und als
  passives SVG über die Bildroute geprüft.
