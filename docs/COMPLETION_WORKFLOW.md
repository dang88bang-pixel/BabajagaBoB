# BabajagaBoB – Fortlaufender Completion-Workflow

## Zweck
Der Workflow führt die Fertigstellung ohne manuelle Bestätigung zwischen erfolgreichen Arbeitspaketen fort.

Grundregel: Implementieren → statisch prüfen → testen → Sicherheits-/Integrationsprüfung → Acceptance-Evidence → Status aktualisieren → nächstes Arbeitspaket.

Ein Arbeitspaket gilt erst als abgeschlossen, wenn Implementierung, Tests und reproduzierbarer Verifikationsnachweis vorhanden sind. Mocks dürfen keinen PASS/VERIFIED-Status erzeugen.

## Reihenfolge

### W0 – Baseline
- Branch/Commit feststellen.
- Acceptance-Matrix, Lint, Typecheck, Unit, Integration, Regression, UI, Security und E2E ausführen.
- Keine neuen Regressionen zulassen.

### W1 – Computer Use: kanonischer Execution-Pfad
`Computer Action → Permission/Capability → Execution Gate → Execution Broker → Driver → Observation → Audit/Event/Provenance → Verification`.
Capability an Computer, Task, Agent, Sandbox und Risiko binden; Einmal-Token, Replay-Schutz, shell:false, Timeout, Output-Limits, Minimal-Environment, Digest-Audit und Denial-Evidence erzwingen.
Gate: CU-EXEC-001 = PASS.

### W2 – Realer Browser-Driver
Isolierter Chromium/Chrome-Driver mit kontrollierter Navigation, Click/Type/Select/Screenshot/OCR, Allowlist-Egress und reproduzierbarem CI-Nachweis.
Gate: CU-001 und Browser-E2E = PASS.

### W3 – Device Fabric
Discovery, Identifikation, Attestierung, Trust State, Creator-Autorisierung, Scheduler, Revocation, Heartbeat/Timeout, reale Hardware-Ausführung und Audit/Provenance.
Gate: reproduzierbarer Device-Nachweis.

### W4 – Offline Fabric vollständig
Bundle-Export/Import für Modelle, Dokumentation, Packages, Git, Images, SDKs, Datasets, Vector Index und Knowledge Graph; Digest, Provenance, Konfliktauflösung und herkunftstreuer Merge.
Gate: OFF-001 = PASS.

### W5 – Provider Fabric
Capability Discovery, Credential Binding, Health Probe, Allowlist, SSRF-Schutz, Timeout, Datenklassifizierung, Redaction, Audit, Revocation, Contract Test und – sofern sicher verfügbar – echter Live-Adapter.
Kein künstlicher PASS ohne echte externe Evidenz.

### W6 – Browser/UI E2E
Creator Login, Control Center, Mission/Task, Agent, Sandbox, Run, Experiment, Evidence, Timeline, Approval, Deployment, Recovery, Security/Audit, Offline und Computer Use als reale Bedienpfade prüfen.
Gate: UI-003 = PASS.

### W7 – Dauer-/Lastnachweis
Mehrstündiger Lauf mit parallelen Runs, Queue/Lease, Worker, Heartbeat, Retry, Recovery, Audit/Event Chain, Store Integrity, Ressourcenverbrauch und SLO-Messung.
Gate: LOAD-001 = PASS.

### W8 – Gesamtregression
Lint, Typecheck, Unit, Integration, Regression, Security, Sabotage, E2E, UI, OCI, Fault Injection, API Audit, Action/Attribute Audit, Acceptance, Live Verification und Build.

### W9 – Release-Gate
Reproduzierbarer Build, Runtime-Health, Datenintegrität, Audit-Kette, Security, Recovery, Rollback und keine offenen FAILs. Production-Promotion bleibt Creator-gebunden.

## Statusmaschine
`NOT_IMPLEMENTED → IMPLEMENTED → TESTED → VERIFIED → PRODUCTION_READY → DONE`
`TESTED → FAILED → BUG → FIXING → TESTED`
`FAILED → RECOVERING → VALIDATING → VERIFIED`

## Automatisierungsregel
Der Workflow darf erfolgreiche Arbeitspakete ohne weitere Bestätigung fortsetzen, solange die Aktion innerhalb bereits erteilter Autorität liegt.

Automatisch anhalten bei: neuer Authority/Permission, Credential, externer Verarbeitung/Speicherung, Production Deployment, nicht erlaubtem Egress, nicht autorisiertem Gerät oder verletzter Sicherheitsgrenze.

Beim Anhalten wird ein maschinenlesbarer Blocker mit Requirement-ID und benötigter Creator-Aktion erzeugt.

## Artefakte
Jedes Arbeitspaket erzeugt Start-Event, Task-ID, Änderungen, Testlauf, Resultat, Evidence-IDs, Audit/Event-Verknüpfung und Acceptance-Status bzw. Blocker.

## Abschluss
READY TO USE wird erst gesetzt, wenn der vereinbarte Release-Scope vollständig implementiert, integriert, getestet und reproduzierbar verifiziert ist. Die Acceptance-Matrix bleibt die autoritative Quelle.