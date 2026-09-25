# BabajagaBoB — Architektur (Deutsch)

## 1. Systemgrenze

```text
GUI / Control Center
        |
        v
Control Plane API
        |
        +--> Authority / Governance / Approval
        |
        v
Execution Broker
        |
        v
Job Queue
        |
        v
Agent Worker
        |
        v
Sandbox Runtime
   |             |
 Mock        OCI/Docker
```

Der Browser führt keine Shell-Kommandos aus und erhält keine Roh-Secrets.

## 2. Autorisierung

Eine operative Ausführung benötigt eine konsistente Kette:

`Creator/Delegation → Agent → Task → Sandbox → Capability → Execution Gate → Broker`

Dabei werden Subject, Task, Sandbox, Capability und Risiko geprüft.

Der Agent kann keine höhere Autorität durch Selbstdelegation oder Selbst-Ausstellung erzeugen. Kill Switches und Policy-Gates können Ausführung fail-closed stoppen.

## 3. Sandbox

Jede Sandbox besitzt:

- eindeutige ID
- Typ
- Task-Bindung
- Agent-Bindung
- Netzwerkpolicy
- Ressourcenlimits
- Runtime-Zustand
- Audit-/Provenance-Bezug

Diagnostic-Sandboxes werden über das Control Plane registriert und nicht als freie Runtime-Ressourcen behandelt.

## 4. Runtime

### Mock
Die Mock Runtime dient Entwicklung und Tests. Sie modelliert Create/Clone/Reset/Snapshot/Restore/Destroy/Execute und erzwingt Netzwerk-DENY für typische Netzwerkbefehle.

### OCI
Der OCI-Adapter nutzt Docker/OCI ohne Shell-Interpolation und mit restriktiven Container-Einstellungen. Snapshot/Restore, echte Storage-Quotas und kontrollierter Allowlist-Egress benötigen noch ein produktionsfähiges Backend.

## 5. Persistenz

Der Control Plane State wird über den kanonischen `DurableStore` (`lib/persistence/store.ts`) lokal persistiert. Jede Store-Datei besitzt Versionsfeld und SHA-256-Digest; Schreiben erfolgt atomar (temporäre Datei, `rename`, Rechte 0600), und ein Digest- oder Versionsfehler wird fail closed abgewiesen (`StoreIntegrityError`).

Zusätzlich existieren getrennte persistente Stores für u. a. Jobs/Queue, Runs, Events, Audit, Provenance, Authority, Governance, Bootstrap, Sessions, Approvals, Sandbox Snapshots, Verifikationen, Regression, Science, Reliability, Errors, Knowledge, Inbox, Devices, Simulation, Computer Use, Apps/Gallery und Provider.

Die früheren Parallel-Stores (`lib/store.ts`, `lib/durable-store.ts`, `lib/execution-store.ts`, `lib/error-store.ts`, `lib/reliability-store.ts`, `lib/science-store.ts`, `lib/approval-store.ts`, `lib/authority-store.ts`) sowie die Legacy-Authentifizierung (`lib/control-auth.ts`) und der Broker-Umgehungspfad `/api/container` (`lib/container-runtime.ts`) sind entfernt; es gibt genau einen Schreibpfad pro Domäne.

Die Architektur bleibt bewusst lokal-first. Für horizontale Mehrprozess-/Produktionslast sind transaktionale DB, Locking und objektbasierte Artifact-Speicherung erforderlich.

## 6. Causal / Provenance Fabric

Ereignisse enthalten Actor, Zeit, Status, Ressource und optional einen kausalen Vorgänger. Provenance-Beziehungen modellieren unter anderem:

- CAUSED_BY
- EXECUTED_IN
- AUTHORIZED_BY
- DERIVED_FROM
- TESTED_BY
- PRODUCED

Kausalität darf nicht allein aus zeitlicher Reihenfolge abgeleitet werden. Für wissenschaftliche Aussagen werden Baseline, Control, Replication, Evidence und alternative Erklärungen geführt.

Verborgene Modellgedanken werden nicht gespeichert oder visualisiert.

## 7. Science / Learning

Experiment-Lifecycle:

`Objective → Hypothesis → Baseline/Control → Experiment → Observation → Evidence → Validation → Knowledge`

Knowledge States:

`OBSERVED, SUPPORTED, ESTABLISHED, HYPOTHESIS, UNVERIFIED, CONTRADICTED, REJECTED, UNKNOWN`

Fehler-Lifecycle:

`DETECTED → CONTAINED → REPRODUCING → DIAGNOSING → ROOT_CAUSE_FOUND → RECOVERING → LEARNED → REGRESSION_LOCKED`

Ein Root Cause darf nicht als etabliert gelten, wenn die erforderliche Evidenz fehlt.

## 8. Recovery

Recovery besteht aus:

1. Fehler erfassen.
2. Diagnose isolieren.
3. bekannten Zustand/Checkpoint erzeugen.
4. Recovery Plan vorbereiten.
5. autorisiert ausführen.
6. Regression/Smoke-Verifikation durchführen.
7. Recovery als verifiziert oder fehlgeschlagen markieren.

Der Mock Runtime kann Checkpoints simulieren. OCI Restore benötigt noch Image-/Volume-Infrastruktur.

## 9. Privacy

Default:

- Netzwerk DENY.
- externe Verarbeitung DENY.
- externe Speicherung DENY.
- externes Training DENY.
- Analytics/Tracking/Advertising deaktiviert.
- geschützte Daten werden nicht implizit an Provider weitergegeben.

Die Policy ist eine technische Boundary innerhalb der Anwendung. Absolute Nichtweitergabe muss zusätzlich auf Infrastruktur-, Hosting-, Backup-, Log- und Provider-Ebene gewährleistet werden.

## 10. Agent / Provider / Device Fabric

Agent-Rollen umfassen Supervisor, Planner, Builder, Research, Scientist, QA, Browser, Guardian, Operator, Recovery und Integrator.

Provider und Devices sind Discovery-/Registry-/Autorisierungsmodelle. Discovery bedeutet ausdrücklich nicht Authorization.

Reale externe Provider- oder Geräteausführung darf erst über explizite Adapter, Credentials, Policy und Capability-Gates erfolgen.

## 11. UI / Observability

Das Control Center zeigt:

- Agenten
- Missionen
- Tasks
- Queue
- Approvals
- Experimente
- Sandboxes
- Errors
- Runtime
- Security
- Integrations
- Devices
- Knowledge
- Simulation
- Replay

Jeder operative Zustand soll sichtbar sein: `RUNNING`, `EXPERIMENT`, `TESTING`, `APPROVAL_REQUIRED`, `BLOCKED`, `ERROR`, `RECOVERING`, `COMPLETED`.

## 12. Grundsatz

`UI → Control Plane → Authorization → Execution Gate → Broker → Sandbox → Evidence/Audit/Provenance`

Kein direkter GUI→Shell-Pfad und keine implizite Autorität durch technische Verfügbarkeit.
