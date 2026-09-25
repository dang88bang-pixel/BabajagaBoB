# Spezifikations-Compliance-Vertrag

## Zweck

Dieses Dokument ist ein verbindlicher Compliance-Vertrag für die Umsetzung von:

- `docs/MASTER_COMPLETION_SPEC.md`
- `docs/IMPLEMENTATION_ROADMAP.md`

Die Master-Spezifikation ist die fachliche Quelle der Anforderungen. Die Roadmap ist nur deren technische Zerlegung.

**Die Roadmap darf die Master-Spezifikation nicht abschwächen, ersetzen oder inhaltlich verändern.**

## 1. Verbindliche Reihenfolge

Der Agent muss vor jeder größeren Implementierungsänderung:

1. `MASTER_COMPLETION_SPEC.md` lesen.
2. `IMPLEMENTATION_ROADMAP.md` lesen.
3. die betroffenen Anforderungen identifizieren.
4. die bestehende Implementierung dagegen prüfen.
5. die Änderung implementieren.
6. Tests für die Anforderung ergänzen.
7. Security- und Regressionstests ausführen.
8. Dokumentation aktualisieren.
9. Compliance-Status aktualisieren.

## 2. Keine stille Interpretation

Wenn Code und Spezifikation voneinander abweichen, gilt:

**Spezifikation vor bestehender Implementierung.**

Wenn eine Anforderung technisch unklar ist:

- nicht eigenmächtig abschwächen,
- nicht entfernen,
- nicht als erledigt markieren,
- als `UNVERIFIED` oder `BLOCKED` dokumentieren,
- konkrete technische Frage bzw. Abhängigkeit festhalten.

## 3. Keine stillen Scope-Reduktionen

Der Agent darf keine dieser Maßnahmen selbstständig vornehmen:

- Anforderungen löschen
- Anforderungen verkürzen
- Sicherheitsanforderungen abschwächen
- Approval-Grenzen entfernen
- Network-DENY-Default entfernen
- Auditpflicht entfernen
- Provenance entfernen
- Evidence-Anforderungen reduzieren
- Recovery-Verifikation überspringen
- Regressionstests entfernen
- Creator-Governance umgehen
- autonome Fähigkeiten aus Sicherheitsgründen heimlich in Mocks umwandeln
- Mocks als reale Implementierung deklarieren

Eine technische Vereinfachung ist nur zulässig, wenn sie nachweislich dieselbe spezifizierte Sicherheits- und Funktionssemantik erhält.

## 4. Traceability

Jede wesentliche Implementierung muss auf mindestens eine Spezifikationsanforderung zurückführbar sein.

Empfohlene Struktur:

| Requirement | Implementierung | Test | Status | Evidence |
|---|---|---|---|---|
| SPEC-... | Datei/Funktion | Test | ... | Commit/Testlauf |

Für größere Änderungen muss diese Zuordnung aktualisiert werden.

## 5. Definition von "fertig"

Eine Anforderung ist nicht `VERIFIED`, nur weil Code existiert.

Mögliche Zustände:

- `SPECIFIED`
- `IMPLEMENTED`
- `INTEGRATED`
- `TESTED`
- `VERIFIED`
- `BLOCKED`
- `PARTIAL`
- `NOT_IMPLEMENTED`
- `NOT_VERIFIED`

Nur `VERIFIED` darf als abgeschlossen gelten.

## 6. Sicherheitsanforderungen haben Vorrang

Folgende Regeln sind unverhandelbar:

`Creator Authority > Agent Authority`

`Safety/Governance > Agent Objective`

`Evidence > Assumption`

`Verification > Assertion`

`Fail Closed > Unsafe Execution`

## 7. Autonomie

Der Agent soll innerhalb seiner delegierten Capability selbstständig:

- planen
- Tasks zerlegen
- Sandboxes erstellen
- Experimente planen
- Experimente ausführen
- Tools verwenden
- Tools entwickeln
- Tests schreiben
- Fehler reproduzieren
- Diagnosen durchführen
- Recovery vorbereiten
- Regressionstests erzeugen
- Wissen dokumentieren

dürfen.

Der Agent darf dabei niemals:

- eigene Root Authority erzeugen
- eigene Capabilities erweitern
- Governance ändern
- Creator imitieren
- Audit manipulieren
- Sicherheitsgrenzen entfernen
- Produktionsfreigaben selbst erzwingen
- Secrets weitergeben
- Netzwerkgrenzen umgehen

## 8. Experimentelle Autonomie

Experimentelle Autonomie ist ausdrücklich Teil der Spezifikation.

Ein Agent darf innerhalb autorisierter Grenzen:

`Hypothesis → Sandbox → Baseline → Control → Experiment → Replication → Evidence → Analysis`

selbstständig durchführen.

Die Sicherheitsgrenzen bleiben unveränderbar.

## 9. Causal Integrity

Keine automatische Schlussfolgerung aus bloßer zeitlicher Korrelation.

Für relevante Kausalbehauptungen müssen soweit möglich berücksichtigt werden:

- Baseline
- Control
- Intervention
- Replication
- Alternative Explanations
- Confounders
- Evidence
- Regression

Bei unzureichender Evidenz:

`UNKNOWN`

oder

`HYPOTHESIS`

statt `ESTABLISHED`.

## 10. Error-to-Knowledge Contract

Relevante Fehler müssen grundsätzlich die Möglichkeit haben, diesen Ablauf zu durchlaufen:

`Detection → Containment → Reproduction → Diagnosis → Root Cause → Fix → Verification → Regression → Knowledge`

Aus einem bestätigten Fehler soll dauerhaft verwertbares Wissen bzw. eine Regression entstehen.

## 11. Recovery Contract

Recovery gilt nur als erfolgreich, wenn:

`Restore → Verification → Smoke/Regression → Evidence`

erfolgreich abgeschlossen ist.

Ein technischer `restore()`-Aufruf allein ist kein Recovery-Nachweis.

## 12. Persistenz Contract

Zustands- und sicherheitsrelevante Informationen dürfen nicht ausschließlich im RAM existieren.

Mindestens erforderlich sind persistente Zustände für:

- Control State
- Jobs
- Runs
- Events
- Audit
- Provenance
- Authority
- Governance
- Approvals
- Science
- Errors
- Recovery
- Apps
- Gallery
- Providers
- Devices
- Knowledge
- Simulation

## 13. Privacy Contract

Default:

`NETWORK = DENY`

und:

- External Processing = DENY
- External Storage = DENY
- External Training = DENY
- Tracking = OFF
- Analytics = OFF
- Advertising = OFF
- Silent Telemetry = OFF

Secrets dürfen niemals unbeabsichtigt in Logs, Events, Prompt-Kontexten, Artefakten oder Provider-Payloads erscheinen.

## 14. UI Contract

Jede relevante Aktion muss ihren Zustand sichtbar machen.

Mindestens:

- Status
- Progress
- Current Step
- Agent
- Task
- Sandbox
- Risk
- Error
- Next Action

Systemkritische Aktionen benötigen klar erkennbare Zustände wie:

- RUNNING
- EXPERIMENT
- TESTING
- APPROVAL REQUIRED
- BLOCKED
- ERROR
- RECOVERING
- ROLLING BACK
- COMPLETED

## 15. Keine Fake-Implementierungen

Folgende Begriffe müssen im System eindeutig unterscheidbar sein:

- MOCK
- SIMULATED
- REAL
- VERIFIED

Ein Mock darf niemals als reale Integration bezeichnet werden.

## 16. Keine Production-Behauptung ohne Evidenz

Production Readiness wird pro Bereich festgestellt.

Erlaubte Werte:

- PASS
- PARTIAL
- FAIL
- NOT_IMPLEMENTED
- NOT_VERIFIED

Keine globale "fertig"-Behauptung ohne entsprechende Evidenz.

## 17. Änderungs-Gate

Vor jedem Commit mit wesentlichen Änderungen muss der Agent prüfen:

### Spezifikation
- Welche Anforderungen werden erfüllt?
- Welche werden verändert?
- Welche bleiben offen?

### Sicherheit
- Wurde eine Boundary abgeschwächt?
- Gibt es einen neuen Privilege-Escalation-Pfad?
- Gibt es einen direkten Runtime-Bypass?
- Werden Secrets geschützt?

### Nachvollziehbarkeit
- Event vorhanden?
- Audit vorhanden?
- Provenance vorhanden?
- Evidence vorhanden?

### Tests
- Unit?
- Integration?
- Security?
- Regression?
- E2E, falls betroffen?

### Dokumentation
- README aktuell?
- Architecture aktuell?
- Status aktuell?
- Traceability aktuell?

## 18. Abschluss-Gate

Das Gesamtprojekt darf erst als spezifikationskonform bezeichnet werden, wenn:

1. alle Muss-Anforderungen der Master-Spezifikation mindestens `VERIFIED` sind;
2. offene Punkte explizit als `PARTIAL`, `BLOCKED`, `NOT_IMPLEMENTED` oder `NOT_VERIFIED` markiert sind;
3. keine sicherheitskritische Anforderung still reduziert wurde;
4. Kern-E2E-Flows erfolgreich sind;
5. Security Regression Suite erfolgreich ist;
6. Recovery nachweisbar verifiziert ist;
7. Audit und Provenance konsistent sind;
8. UI-Systemzustände sichtbar sind;
9. Dokumentation den realen Zustand widerspiegelt.

### Status des Abschluss-Gates (2026-09-25)

| Kriterium | Zustand |
|---|---|
| 1. Muss-Anforderungen `VERIFIED` | **PARTIAL** – Autorisierung (inkl. Wiederholungssperre für Capability-Token), Persistenz, Kernkette, Verweigerungsevidenz, Audit-Aufbewahrung, lokale Runtime **mit gemessener Kernel-Isolation `NAMESPACES`** sind `VERIFIED`; OCI-Runtime ist `NOT_VERIFIED` (kein Daemon beschaffbar), Provider/Device/Computer-Use-Integration ist `PARTIAL` (kein Egress, keine Treiber) |
| 2. Offene Punkte markiert | **PASS** – `docs/STATUS.md`, `docs/TODO.md`, `docs/ABSCHLUSSBERICHT.md` §D/§E/§F |
| 3. Keine stille Sicherheitsreduktion | **PASS** – Netzwerk `DENY`, `ALLOWLIST` fail closed, Audit-/Provenance-Pflicht, Evidenz-/Verifikationspflicht unverändert |
| 4. Kern-E2E-Flows | **PASS** – `tests/e2e/creator-flow.test.ts`, `tests/e2e/failure-recovery.test.ts`, Live-Schritte 2–6 |
| 5. Security Regression Suite | **PASS** – 17 Security-Dateien / 113 Tests, Live-Angriffsblockaden (Schritt 5) samt Evidenz der Verweigerung (`kind=DENIAL`) |
| 6. Recovery verifiziert | **PASS** – Restore + Regression + `fix.verify` bis `REGRESSION_LOCKED` |
| 7. Audit/Provenance konsistent | **PASS** – `verifyAuditChain()` in Tests und Live-Lauf grün |
| 8. UI-Systemzustände sichtbar | **PARTIAL** – 40 Abschnitte mit sichtbaren Zuständen, gegen echte Routen-Handler getestet (`tests/ui/control-center-api.test.tsx`), aber ohne automatisierte Browser-E2E-Prüfung |
| Zusatz: Betriebsnachweis | **PASS** – `/api/metrics` (nur Zahlen), Backup mit Digest-Prüfung (manipuliert → 409) inkl. Migration älterer Sicherungen, Audit-Verifikation über POST und Aufbewahrungszustand, **174 / 227 / 503 / 89 Live-Prüfungen** (verify-live / audit-api / audit-actions / audit-ui, je 0 Fehler) sowie **82 Matrix-Nachweise** über `node scripts/acceptance.mjs --live` |
| 9. Dokumentation = realer Zustand | **PASS** – 14 §44-Dokumente plus Abschlussbericht, gegen Code und Nachweise geprüft |

Das Gesamtprojekt ist daher **nicht** als spezifikationskonform abgeschlossen zu
bezeichnen: Kriterium 1 und 8 bleiben offen (siehe `docs/ABSCHLUSSBERICHT.md` §L).
Kriterium 8 ist funktional belegt (Control Center mit vollständiger Navigation gegen echte
Routen-Handler), es fehlt weiterhin die automatisierte **Browser**-Darstellung.

## 19. Konfliktregel

Falls eine spätere technische Entscheidung einer früheren Spezifikationsanforderung widerspricht:

**Nicht still überschreiben.**

Stattdessen:

`CONFLICT → DOCUMENT → BLOCK IMPLEMENTATION → REQUEST/RECORD DECISION`

Bis zur Klärung gilt die strengere Sicherheitsanforderung.

## 20. Ziel

Die Spezifikation soll nicht lediglich als Wunschliste dienen.

Sie ist der verbindliche technische Zielvertrag für die Fertigstellung von BabajagaBoB.

Der Agent soll daher nicht "möglichst viel implementieren", sondern:

**jede definierte Anforderung nachweisbar, sicher, integriert und getestet umsetzen.**
