# BabajagaBoB

**GUI-first, lokal-first Control Plane für eine autonome Full-Stack-Agent-Plattform.**

BabajagaBoB ist als ausführungsorientierte Agent-Plattform aufgebaut: Missionen werden in Tasks zerlegt, Tasks werden autorisiert und isoliert ausgeführt, Experimente werden reproduzierbar erfasst, Fehler werden diagnostiziert und Recovery-Pfade werden vorbereitet und verifiziert.

## Gesamtstatus

**Stand:** 2026-09-25
**Arbeitsbranch:** `arena/01a0d635-babajagabob`

Es werden **keine künstlichen Fortschrittswerte** geführt. Jede Komponente hat
einen belegbaren Reifegrad:

- **ARCHITECTURE** – Vertrag/Typen/Doku vorhanden, Ausführung fehlt
- **IMPLEMENTED** – Code vorhanden, kompiliert, nicht durch Tests belegt
- **INTEGRATED** – im realen Ablauf verdrahtet (Routen/Worker/Broker)
- **TESTED** – durch automatisierte Tests nachgewiesen
- **VERIFIED** – zusätzlich real ausgeführt und reproduzierbar
- **UNVERIFIED / PARTIAL / BLOCKED / NOT_IMPLEMENTED** – ausdrücklich offen

Vollständige, belegte Liste: `docs/STATUS.md`. Zusammenfassung mit Bewertung:
`docs/ABSCHLUSSBERICHT.md` (Struktur A–L).

### Was nachweislich durchgängig funktioniert

`Creator → Mission → Objective → Task → Agent → Authorization → Sandbox →
Experiment/Execution → Evidence → Validation → Audit → Provenance → Knowledge →
Recovery`

- Autorisierung ist fail closed: Session oder Capability-Token, Bindung an Task,
  Sandbox, Umgebung und Risiko; kein Agent kann sich Rechte geben.
- Keine Shell-Strings: `argv[]` mit `shell:false`; Shell-Interpreter und
  Metazeichen sind in jedem Argument verboten (Broker **und** Runtime).
- Netzwerk default `DENY`; `ALLOWLIST` ist fail closed, bis ein Egress-Proxy existiert.
- Erfolg nur mit Nachweis: Root Cause verlangt Evidenz, Recovery verlangt einen
  verifizierten Snapshot **und** bestandene Regression, `LEARNED` verlangt `fix.verify`.
- Angriffe werden blockiert **und** auditiert (fremdes Token, Shell-Programm,
  Shell-Metazeichen, fremde Sandbox-Bindung, Lockdown).
- Nachweis: **43 Testdateien / 279 Tests** sowie die Live-Prüfungen
  `scripts/verify-live.sh` (**176 / 0**), `scripts/audit-actions.mjs` (**502 / 0**),
  `scripts/audit-api.sh` (**204 / 0**) und `scripts/audit-ui.mjs` (**88 / 0**) — jeweils
  auf der Frischinstanz `:3100` mit Kernel-Isolation und cgroup-Limits.

## Dokumentation

| Datei | Inhalt |
|---|---|
| `docs/ARCHITECTURE.md` | Aufbau, Module, Persistenzmodell |
| `docs/STATUS.md` | Reifegrade je Komponente (belegt) |
| `docs/ABSCHLUSSBERICHT.md` | Abschlussbericht A–L mit `PASS/PARTIAL/FAIL` |
| `docs/SECURITY.md` | Bedrohungsmodell und Grenzen |
| `docs/AUTHORIZATION.md` | Rollen, Capabilitys, Routen-Aktionen |
| `docs/BOOTSTRAP.md` | Bootstrap, Creator-Login, Betriebsgrenzen |
| `docs/SANDBOX.md` | Sandbox-Fabric, Netzwerk, Snapshots |
| `docs/RUNTIME.md` | Lokale Runtime, OCI (UNVERIFIED), Registry |
| `docs/EXPERIMENTS.md` | Experimente und Kausalvalidierung |
| `docs/RECOVERY.md` | Recovery-Stufen und Regression |
| `docs/KNOWLEDGE.md` | Gedächtnisschichten, Zustände, negatives Wissen |
| `docs/PROVIDERS.md` | Provider-Fabric und Approval-Pflicht |
| `docs/DEVICES.md` | Geräte-Fabric (Discovery ≠ Autorisierung) |
| `docs/COMPUTER_USE.md` | Computer Use und Simulation |
| `docs/CI_CD.md` | CI-Jobs und Promotion-Gate |
| `docs/TESTING.md` | Teststrategie, Live-Nachweis |
| `docs/OPERATIONS.md` | Betrieb, Notfälle, Beobachtbarkeit |
| `docs/TODO.md` | offene Punkte und `PARTIAL`-Liste |

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

Die tatsächlichen offenen Punkte werden in `docs/TODO.md` und `docs/STATUS.md`
geführt – u. a.:

1. OCI-Runtime mit echtem Daemon verifizieren (bisher `UNVERIFIED`).
2. Egress-Proxy für kontrollierte `ALLOWLIST`-Netzwerke implementieren.
3. Provider real anbinden (mit Allowlist + Approval) statt nur zu beschreiben.
4. Browser-/Desktop-Treiber für Computer Use; Geräte-Discovery ist als
   selbstmeldender Enrollment-Agent umgesetzt (aktiver Netz-Scan fehlt weiterhin).
5. Browser-E2E-Tests für das Control Center (`NOT_VERIFIED`: in der Umgebung steht kein
   Browser zur Verfügung); ersatzweise jsdom-Tests gegen echte Routen-Handler.
6. ~~Metrik-/Alerting-Export und Backup-Automation~~ — erledigt: 16 Alarmregeln an reale
   Kennzahlen gebunden (`/api/alerts`), geplanter Sicherungslauf mit Aufbewahrungsgrenze.
7. ~~Last- und Langzeittests mit definierten SLOs~~ — teilweise erledigt: Schwellen für den
   begrenzten Lastnachweis (`SOAK_SLO_P95_MS`) und betriebsweite SLO-Bewertung
   (`lib/slo.ts`, `/api/slo`, UI „Service-Level“); ein Dauerlauf bleibt `NOT_VERIFIED`.

## Sicherheitsprinzip

**Kein direkter GUI → Shell-Zugriff.**

Jede operative Aktion muss über:

`UI → Control Plane → Authorization → Execution Gate → Broker → Sandbox/Runtime → Evidence/Audit`

laufen.
