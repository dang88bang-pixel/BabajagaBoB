# Implementierungs-Roadmap

## Zweck

Diese Roadmap zerlegt `MASTER_COMPLETION_SPEC.md` in sequenziell ausführbare Arbeitspakete. Der Agent soll Pakete selbstständig abarbeiten, testen, dokumentieren und committen.

## Arbeitsregeln

Nach jedem Paket:

1. Bestand prüfen.
2. Implementieren.
3. Typecheck.
4. Unit-/Integrationstests.
5. Security-Regressionen.
6. E2E prüfen, soweit betroffen.
7. Dokumentation aktualisieren.
8. Commit erstellen.
9. Roadmap-Status aktualisieren.

Ein Paket gilt nur bei erfolgreicher Verifikation als abgeschlossen.

Status:
- `TODO`
- `IN_PROGRESS`
- `BLOCKED`
- `VERIFIED`
- `PARTIAL`

---

# P0 — Sicherheits- und Integrationsfundament

## P0.1 — Repository- und CI-Baseline

**Ziel:** reproduzierbaren Ausgangszustand herstellen.

Aufgaben:
- Workflow-Dateien untersuchen.
- Trigger für Feature-Branch/PR prüfen.
- Build, typecheck und vorhandene Tests ausführen.
- echtes Linting einrichten.
- fehlende Test-Infrastruktur einrichten.
- Node-/Next-Versionen und Lockfile prüfen.
- Security-relevante Buildfehler dokumentieren.

**Akzeptanz:**
- reproduzierbarer lokaler Build
- CI auf PR/Feature-Branch ausführbar
- typecheck erfolgreich
- lint erfolgreich
- Baseline-Testlauf dokumentiert

---

## P0.2 — API/Auth-Härtung

**Ziel:** Mutierende Control-Plane-APIs sicher absichern.

Aufgaben:
- `requireControlPlaneAuth` überprüfen.
- Actor-Identität nicht aus frei übergebenen Request-Feldern vertrauen.
- Capability-Binding für sensible Aktionen ergänzen.
- Task-/Sandbox-/Risk-Scope überall durchsetzen.
- Error-, Recovery-, Runtime-, Approval-, Governance- und Authority-APIs prüfen.
- öffentliche GET-Routen klar von mutierenden Routen trennen.

**Akzeptanz:**
- unauthentifizierte Mutation → DENIED
- falscher Actor → DENIED
- falsche Capability → DENIED
- falscher Task → DENIED
- falsche Sandbox → DENIED
- falsches Risk-Level → DENIED
- jede Ablehnung auditierbar

---

## P0.3 — Creator Bootstrap

**Ziel:** sichere Root Authority initialisieren.

Aufgaben:
- einmaligen Bootstrap definieren.
- Secret ausschließlich serverseitig.
- Creator Root Authority erzeugen.
- Bootstrap Event auditieren.
- Rotation und Revocation vorsehen.
- fehlende Bootstrap-Konfiguration → fail closed.

**Akzeptanz:**
- keine hardcodierten Secrets
- kein Root Token im Browser
- Creator Authority reproduzierbar initialisierbar
- Bootstrap auditierbar

---

## P0.4 — Event/Audit/Provenance-Konsolidierung

**Ziel:** eine konsistente Kausal- und Auditkette.

Aufgaben:
- Event Parent-Richtung vereinheitlichen.
- doppelte Eventpersistenz beseitigen.
- eindeutige Event-ID-Kette.
- eindeutige Run-ID in Provenance.
- Audit und Provenance sauber referenzieren.
- Integritätsprüfung ergänzen.
- Concurrent Write-Risiken dokumentieren/absichern.

**Akzeptanz:**
- jeder Run erzeugt nachvollziehbare Event-/Provenance-Kette
- keine widersprüchliche Parent-Richtung
- keine doppelte Eventkette
- beschädigte Daten werden erkannt

---

## P0.5 — Execution Gate/Broker End-to-End

**Ziel:** jede reale Ausführung durch genau eine sichere Kontrollkette führen.

Aufgaben:
- Task/Agent/Sandbox/Capability/Approval/Risk/Environment prüfen.
- Kill Switch integrieren.
- Execution Gate vereinheitlichen.
- Broker als einziger Ausführungspfad etablieren.
- direkte Runtime-Aufrufe aus APIs entfernen.
- Audit + Provenance nach erfolgreicher und abgelehnter Ausführung.

**Akzeptanz:**
- erlaubte Ausführung funktioniert
- jede unzulässige Kombination wird blockiert
- kein direkter Umgehungspfad

---

## P0.6 — OCI Runtime Hardening

**Ziel:** reale isolierte Ausführung belastbar machen.

Aufgaben:
- Docker/OCI Lifecycle testen.
- Netzwerk DENY testen.
- CPU/Memory/PID Limits testen.
- read-only filesystem testen.
- no-new-privileges testen.
- capabilities drop testen.
- Timeout und Prozesscleanup testen.
- Orphan Detection testen.
- keine Shell-Injection über argv zulassen.

**Akzeptanz:**
- absichtliche Netzwerkzugriffe werden blockiert
- Resource Limits greifen
- Timeout beendet Prozesse
- Orphans werden erkannt
- Shell-Missbrauch ist nicht möglich

---

# P1 — Autonome Engineering-Fähigkeiten

## P1.1 — Job/Run/Worker Robustness

- Lease/Heartbeat vervollständigen.
- stale leases erkennen.
- Retry/Backoff.
- Idempotency.
- Cancellation.
- Worker ownership.
- Dead-letter state.
- Run-ID in Provenance.

**Akzeptanz:** reproduzierbarer Job-Lifecycle einschließlich Failure/Retry.

---

## P1.2 — Sandbox Lifecycle

- CREATE/CLONE/RESET/START/RUN/PAUSE/SNAPSHOT/RESTORE/DESTROY.
- State Machine validieren.
- ungültige Zustandsübergänge blockieren.
- Sandbox-Status UI.
- Sandbox-Provenance.
- Resource Policy.

**Akzeptanz:** vollständiger Sandbox-Lifecycle in Tests.

---

## P1.3 — Snapshot/Restore und Recovery

- Snapshot semantisch von Artifact trennen.
- Snapshot-Metadaten/Digest.
- Restore.
- Smoke Test.
- Regression Test.
- Recovery Plan.
- Recovery Status.

**Akzeptanz:** absichtlich beschädigte Sandbox wird wiederhergestellt und anschließend verifiziert.

---

## P1.4 — Error Intelligence

- Error Lifecycle vervollständigen.
- Diagnose-Sandbox.
- Failure Record.
- Root Cause.
- Evidence.
- Recovery Plan.
- Regression Test.
- Knowledge Link.

**Akzeptanz:** künstlicher Fehler durchläuft Detection → Root Cause → Recovery → Verification.

---

## P1.5 — Recovery Verification

- `beginRecovery` und `verifyRecovery` korrekt async behandeln.
- tatsächliche Smoke-/Regression-Checks.
- Verification Evidence.
- Recovery nur bei bestandenem Check als VERIFIED.

**Akzeptanz:** Restore ohne erfolgreichen Test bleibt FAILED/UNVERIFIED.

---

## P1.6 — Experiment Engine

- Baseline.
- Control.
- Replication.
- Evidence.
- Alternative Explanations.
- Confounders.
- Experiment Runs.
- Knowledge State.

**Akzeptanz:** ein Experiment kann vollständig erzeugt, ausgeführt, repliziert und ausgewertet werden.

---

## P1.7 — Causal Validation

- Evidence sufficiency.
- Reproduction requirement.
- Contradiction detection.
- Alternative explanation.
- UNKNOWN state.
- ESTABLISHED nur nach definierten Kriterien.

**Akzeptanz:** unzureichende Evidenz führt zu UNKNOWN/HYPOTHESIS, nicht zu ESTABLISHED.

---

## P1.8 — Regression Engine

- Regression Test Entity.
- Fehler → Regression Test.
- CI Integration.
- Regression Lock.
- Test Result Evidence.

**Akzeptanz:** bekannte Regression blockiert Promotion.

---

## P1.9 — Knowledge Persistence

- Knowledge Store.
- Digest/Integrity.
- Nodes/Edges.
- Evidence references.
- Source references.
- Contradictions.
- Negative Knowledge.
- Reproduction links.

**Akzeptanz:** Erkenntnis überlebt Neustart und bleibt provenance-verknüpft.

---

# P1 — Control Center und Observability

## P1.10 — Universal Status Fabric

Alle UI-Komponenten erhalten ein gemeinsames Statusmodell.

Pflichtinformationen:
- Status
- Progress
- Current Step
- Started
- Duration
- Agent
- Task
- Sandbox
- Risk
- Error
- Next Action

---

## P1.11 — Agent Observatory

Implementieren:
- Agent cards
- Live status
- current task
- current action
- sandbox
- resources
- experiments
- errors
- recovery
- capabilities
- provenance

---

## P1.12 — Timeline/Replay

- Live Timeline.
- Event Filter.
- Agent Filter.
- Task Filter.
- Run Filter.
- Sandbox Filter.
- Provenance navigation.
- Replay eines Runs.
- Integritätsstatus.

Keine private Chain-of-Thought-Anzeige.

---

## P1.13 — Why View

Strukturierte Darstellung:

`Objective → Observation → Assumption → Hypothesis → Plan → Action → Expected Result → Observed Result → Evidence → Conclusion → Next Action`

---

## P1.14 — Approval Center

- Approval Detail.
- Capability check.
- Risk.
- Files.
- DB Changes.
- Network Effects.
- Rollback.
- Test Results.
- immutable decision record.

---

# P2 — Erweiterte autonome Infrastruktur

## P2.1 — Runtime Registry

Implementieren:
- Runtime definitions
- versioning
- platform
- architecture
- compiler/interpreter
- package manager
- build/test/debug
- sandbox compatibility

---

## P2.2 — Tool Registry und Agent Workshop

Implementieren:

`Problem → Spec → Prototype → Sandbox → Test → Security → Experiment → Validation → Registration → Version`

Keine automatische Privilegierung.

---

## P2.3 — Provider Fabric

- Provider persistence.
- lifecycle.
- health.
- credentials metadata.
- approval.
- revoke.
- privacy policy.
- network policy.
- failure isolation.

Zunächst mit sicheren Adapter-/Mock-Schnittstellen; reale Provider nur nach expliziter Integration.

---

## P2.4 — Device Fabric

- Device persistence.
- discovery.
- identity.
- trust.
- authorization.
- allocation.
- execution.
- release.
- resource monitoring.
- provenance.

Discovery darf niemals Authorization ersetzen.

---

## P2.5 — Computer Use

Browser/CLI/Desktop abstrahieren.

Jede Computer Instance benötigt:
- identity
- OS
- resources
- network policy
- permissions
- snapshot
- logs
- provenance

---

## P2.6 — Simulation Fabric

- Scenario persistence.
- Visualization model.
- Simulation model.
- experiment link.
- replay.
- validation.
- provenance.

---

## P2.7 — Offline Fabric

- Task package.
- offline execution.
- artifact bundle.
- evidence.
- delayed sync.
- provenance merge.
- conflict handling.

---

# P2 — Production Readiness

## P2.8 — Persistent Storage Abstraction

Alle Stores über ein konsistentes Interface.

Ziel:
- lokale JSON Stores für Entwicklung
- austauschbare Datenbank für Produktion
- Migration
- Backup
- Restore
- integrity check

---

## P2.9 — Operational Recovery

- verified backups
- disaster recovery
- orphan cleanup
- corrupted store handling
- startup reconciliation
- health checks
- readiness checks

---

## P2.10 — Security Regression Suite

Dauerhafte Tests für:

- privilege escalation
- self delegation
- token replay
- expiry bypass
- revocation bypass
- task mismatch
- sandbox mismatch
- risk mismatch
- approval bypass
- kill-switch bypass
- network bypass
- secret leakage
- direct runtime bypass

---

## P2.11 — E2E System Test

Pflichtlauf:

`Creator → Mission → Objective → Task → Agent → Authorization → Sandbox → Execution → Evidence → Audit → Provenance → Result`

Fehlerlauf:

`Failure → Detection → Diagnosis → Root Cause → Recovery → Verification → Regression → Knowledge`

Angriffslauf:

`Unauthorized Action → DENIED → Audit → Evidence`

---

# Abschluss-Gate

Der Agent darf den Gesamtauftrag erst als abgeschlossen markieren, wenn:

- P0 vollständig VERIFIED
- P1 Kernpfade VERIFIED
- P2 verbleibende Punkte explizit dokumentiert
- CI nachvollziehbar
- Security Suite bestanden
- E2E Kernpfad bestanden
- Recovery E2E bestanden
- Dokumentation aktuell
- keine bekannten kritischen Sicherheitslücken offen
- keine Fake-/Mock-Funktion als REAL gekennzeichnet
- Production Readiness für jeden Bereich separat mit PASS/PARTIAL/FAIL/NOT_IMPLEMENTED/NOT_VERIFIED angegeben ist.

## Abschlussbericht

Erzeuge abschließend:

1. System Completion Matrix
2. offene Risiken
3. offene technische Schulden
4. getestete Flows
5. Security Results
6. Runtime Results
7. Recovery Results
8. CI Results
9. Persistenzstatus
10. Provider/Device Status
11. Production Readiness Matrix
12. nächste verbleibende Arbeiten

## Agenten-Leitregel

Nicht auf "grün" optimieren.

Auf **nachweisbare Funktion, Sicherheit, Reproduzierbarkeit und Kausalität** optimieren.

Bei Unsicherheit:

`UNKNOWN / UNVERIFIED / BLOCKED`

statt einer erfundenen Erfolgsmeldung.
