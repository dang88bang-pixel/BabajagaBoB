# BabajagaBoB

**GUI-first, lokal-first Control Plane für eine autonome Full-Stack-Agent-Plattform.**

BabajagaBoB ist als ausführungsorientierte Agent-Plattform aufgebaut: Missionen werden in Tasks zerlegt, Tasks werden autorisiert und isoliert ausgeführt, Experimente werden reproduzierbar erfasst, Fehler werden diagnostiziert und Recovery-Pfade werden vorbereitet und verifiziert.

## Gesamtstatus

**Stand:** September 2026  
**Arbeitsbranch:** `feat/app-runtime-persistence`

| Bereich | Status | Fortschritt |
|---|---|---:|
| Control Center / GUI | implementiert | 85% |
| Agent Observatory | implementiert | 80% |
| Mission / Task-Modell | implementiert | 80% |
| Execution Queue | implementiert | 80% |
| Runs / Leases / Retry | implementiert | 75% |
| Capability / Authority | implementiert | 80% |
| Execution Gate / Broker | implementiert | 85% |
| Sandbox-Abstraktion | implementiert | 80% |
| OCI/Docker Runtime | vorhanden, eingeschränkt | 65% |
| Persistenter Control-Plane-State | implementiert | 75% |
| Audit / Event Store | implementiert | 75% |
| Provenance / Replay | implementiert | 70% |
| Experiment / Science Fabric | implementiert | 70% |
| Error Intelligence | implementiert | 75% |
| Recovery | vorbereitet + Sandbox-Checkpoint | 60% |
| Governance / Kill Switch | implementiert | 75% |
| Approval Center | implementiert | 75% |
| Privacy / Data Boundary | implementiert | 75% |
| Provider Fabric | Adapter-/Registry-Grundlage | 45% |
| Device Fabric | Modell-/Autorisierungsgrundlage | 40% |
| Knowledge Graph | Modell vorhanden | 35% |
| Simulation / 2D / 3D | Modell vorhanden | 30% |
| CI/CD / Promotion | Governance-Grundlage | 45% |
| Tests / Regression Harness | Grundlage vorhanden | 35% |
| echte verteilte Agent-Worker | noch nicht vollständig | 20% |

### Was bereits durchgängig funktioniert

`Task → Agent → Capability → Sandbox → Execution → Audit/Provenance → Error → Diagnosis → Recovery Checkpoint → Verification`

Die Execution-Grenze ist fail-closed aufgebaut:

- Control Plane vor Runtime.
- Task muss existieren und dem Agent zugewiesen sein.
- Sandbox muss registriert und an Task + Agent gebunden sein.
- Capability Token muss Subject, Task, Sandbox und Risiko abdecken.
- Kill Switch und Policy Gate können Ausführung blockieren.
- `CRITICAL` wird nicht autonom ausgeführt.
- Sandbox-Netzwerk ist standardmäßig `DENY`.
- Host-Shell wird durch den Mock-Adapter nicht exponiert.
- OCI-Ausführung verwendet strukturierte Argumente statt Shell-Interpolation.
- Externe Datenübertragung ist über eine explizite Data-Boundary vorgesehen.

## Architektur

```text
GUI / Control Center
        |
        v
   Control Plane
        |
        +--> Authority / Governance
        |
        +--> Approval Center
        |
        +--> Execution Broker
        |
        v
     Job Queue
        |
        v
    Agent Worker
        |
        v
 Sandbox Runtime
   |          |
 Mock       OCI/Docker
```

Zusätzliche Fabrics:

- **Science Fabric:** Baseline, Control, Replication, Evidence, Knowledge State.
- **Error Intelligence:** Detection → Containment → Reproduction → Diagnosis → Root Cause → Fix/Recovery → Learning.
- **Provenance Fabric:** Task, Run, Sandbox, Capability und daraus abgeleitete Beziehungen.
- **Governance Fabric:** Delegation, Capability Scope, Approval, Kill Switch.
- **Provider Fabric:** kontrollierte Integrationspunkte für externe Runtime-/Workflow-/Deployment-Anbieter.
- **Device Fabric:** autorisierte Computer-/Geräte-Ressourcen.
- **Visualization / Simulation Fabric:** Modelle, Szenarien und Replay.
- **Privacy Fabric:** lokal-first, externe Verarbeitung/Übertragung standardmäßig deaktiviert.

## Statusmodell

Alle relevanten Vorgänge verwenden explizite Zustände, unter anderem:

`QUEUED` · `PLANNING` · `RUNNING` · `THINKING` · `EXECUTING` · `EXPERIMENT` · `TESTING` · `WAITING` · `BLOCKED` · `APPROVAL_REQUIRED` · `ERROR` · `RECOVERING` · `ROLLING_BACK` · `COMPLETED` · `CANCELLED`

Die GUI stellt Status und Fortschritt sichtbar dar. Ereignisse werden mit Actor, Ressource, Task-Bezug und – soweit vorhanden – kausalem Vorgänger erfasst.

## Autonomie und Grenzen

Der Agent darf innerhalb delegierter Fähigkeiten selbstständig:

- Tasks planen und ausführen.
- isolierte Sandboxes anfordern/verwenden.
- Experimente durchführen.
- Tests und Diagnostik ausführen.
- Fehler reproduzieren und Evidenz sammeln.
- Recovery vorbereiten.
- verifizierte Erkenntnisse als Regression/„Never Again“-Wissen erfassen.

Nicht selbst delegierbar sind:

- Creator-/Root-Autorität.
- Umgehen des Execution Gate.
- Selbst-Ausstellung höherer Rechte.
- Manipulation oder Fälschung der Autorisierungshistorie.
- Ausführung kritischer Aktionen ohne die dafür erforderliche Freigabe.
- implizite Netzwerk- oder Drittanbieterfreigabe.

## Persistenz

Lokaler Speicher liegt standardmäßig unter `.bob-data/`.

Persistente Stores verwenden:

- JSON-Envelope mit Versionsfeld.
- SHA-256-Integritätsdigest.
- atomisches Schreiben über temporäre Datei + Rename.
- Dateirechte `0600` für sensible Stores.
- begrenzte Historien/Backups.

`BOB_STORAGE_DIR` kann einen anderen lokalen Speicherpfad setzen.

**Wichtig:** Das ist derzeit eine lokale/serverseitige Persistenzschicht. Für echte horizontale Produktion werden Datenbank, verteilte Locks, Transaktionen und objektsichere Artifact Stores benötigt.

## Runtime

Standardmäßig läuft die Anwendung mit dem Mock-Sandbox-Runtime.

Für OCI/Docker:

```text
BOB_SANDBOX_RUNTIME=oci
BOB_OCI_IMAGE=alpine:3.20
```

Der OCI-Adapter setzt u. a.:

- `--network none`
- CPU-/Memory-Limits
- PID-Limit
- read-only Root-Filesystem
- `cap-drop ALL`
- `no-new-privileges`
- begrenztes `/tmp`
- verwaltete Container-Labels

OCI-Snapshot/Restore, echte Storage-Quotas und Allowlist-Egress sind noch offen.

## Datenschutz

Default:

- Netzwerk: DENY.
- Analytics: deaktiviert.
- Advertising: deaktiviert.
- Tracking: deaktiviert.
- Silent Telemetry: deaktiviert.
- externe Verarbeitung: deaktiviert.
- externes Training: deaktiviert.
- externe Speicherung geschützter Daten: deaktiviert.

Diese Regeln sind eine technische Policy-Grenze. Eine absolute Nichtweitergabe setzt zusätzlich voraus, dass Hosting, Backups, Logs und alle später angebundenen Provider diese Grenze ebenfalls einhalten.

## APIs

Wesentliche Endpunkte:

- `/api/control`
- `/api/timeline`
- `/api/runtime`
- `/api/errors`
- `/api/governance`
- `/api/approvals/center`
- `/api/authority`
- `/api/providers`
- `/api/devices`
- `/api/simulation`
- `/api/privacy`
- `/api/persistence`
- `/api/apps`
- `/api/gallery`
- `/api/tools`

Die gesamte API-Oberfläche ist standardmäßig geschlossen: jede Route außer
`/api/auth` verlangt eine gültige Server-Session. Der Browser erhält nur ein
HttpOnly-Cookie (`bob_session`), niemals Creator-Secrets oder Provider-Schlüssel.
Einmaliger Bootstrap mit `BOB_BOOTSTRAP_SECRET`, danach Login mit
`BOB_CREATOR_LOGIN_SECRET` (oder `<BOB_STORAGE_DIR>/creator-token`, 0600).
Agenten nutzen ausschließlich den Broker-Weg `POST /api/runtime` mit einem
Capability-Token (`Authorization: Bobcap <tokenId>.<secret>`, gebunden an Task,
Sandbox, Environment, Risiko). Details: `docs/BOOTSTRAP.md`, `docs/SECURITY.md`.
Der Legacy-Token `BOB_CONTROL_PLANE_TOKEN` ist fail closed und nur mit
`BOB_ALLOW_LEGACY_CONTROL_TOKEN=1` für lokale Administration aktiv.

## Lokaler Start

```bash
npm install
npm run typecheck
npm run build
npm run dev
```

## Umgebungsvariablen

Siehe `.env.example`.

Nie echte Secrets committen.

## Nächste Abschlussarbeiten

1. echte Test-/Regression-Suite mit reproduzierbaren Failure Cases.
2. Control-Plane-Transaktionen und verteilte Locking-Strategie.
3. echte Agent-Worker-Prozesse und Job-Leases.
4. OCI Snapshot/Restore über Image-/Volume-Backend.
5. Egress-Proxy für kontrollierte Allowlist-Netzwerke.
6. Capability-gebundene Authentifizierung statt gemeinsamem Control-Plane-Bearer für UI-Aktionen.
7. persistenter Knowledge Graph und Reproduktionsindex.
8. reale Provider-/Device-Adapter erst nach expliziter Konfiguration.
9. vollständige 2D/3D-Simulation und Causal Replay.
10. Browser-/Desktop-Computer-Use in isolierten Ausführungsumgebungen.
11. CI/CD mit realen Build-, Security-, Browser- und Promotion-Gates.
12. UI-Vervollständigung aller Module mit einheitlichen Live-Status-/Progress-Komponenten.

## Sicherheitsprinzip

**Kein direkter GUI → Shell-Zugriff.**

Jede operative Aktion muss über:

`UI → Control Plane → Authorization → Execution Gate → Broker → Sandbox/Runtime → Evidence/Audit`

laufen.
