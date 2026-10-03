# ANALYSE & PLATTFORMENVERGLEICH — BabajagaBoB
## Vollständige Inhaltsanalyse + Vergleich mit Codeberg, F-Droid, GitLab, GitHub, und weiteren Plattformen

**Stand:** 2026-10-03 | **Repo:** dang88bang-pixel/BabajagaBoB
**Analyseumfang:** 273 Dateien (204 TypeScript, 28 Markdown, 11 JSON, 9 Shell, 9 MJS, 6 TSX, 1 YML, 1 Gitignore, 1 Beispiel, 1 CSS, 1 LICENSE)

---

## 1. VOLLSTÄNDIGER INHALT DER ANWENDUNG

### 1.1 Dateistruktur (Baum)

```
BabajagaBoB/
├── app/                        # Next.js App Router (68 API-Routen)
│   ├── api/                    # 68 REST-Endpunkte (GET/POST)
│   │   ├── agents/fabric/      # Agenten-Fabric API
│   │   ├── alerts/             # Alarmierung (Prometheus-Text)
│   │   ├── approvals/center/   # Freigabezentrum
│   │   ├── apps/               # App-Management
│   │   ├── artifacts/          # Evidenz-Artefakte (Digest-Prüfung)
│   │   ├── audit/              # Audit-Kette
│   │   ├── auth/               # Creator-Login (Session + TOTP)
│   │   ├── authority/          # Capability-Token + ABAC
│   │   ├── capabilities/       # Capabilities verwalten (redirect zu authority)
│   │   ├── cicd/               # CI/CD Pipelines
│   │   ├── computer-use/       # Computer-Use Verwaltung
│   │   ├── control/            # Control Plane Zustand
│   │   ├── deployment/         # Deployment-Slots + Health-Checks
│   │   ├── devices/            # Geräte-Registrierung/-Scheduling
│   │   ├── dispatcher/         # Dispatch-Logik
│   │   ├── errors/             # Error Intelligence API
│   │   ├── events/[id]/why/    # Warum-Record (kausale Kette)
│   │   ├── execution-gate/     # Execution Gate
│   │   ├── experiments/        # Experimente
│   │   ├── faults/             # Fehlerinjektion
│   │   ├── gallery/            # Galerie (dokumentierte Schritte)
│   │   ├── governance/         # Kill Switches + Delegation
│   │   ├── inbox/              # Creator Inbox (INFORM/ASK/BLOCK/ESCALATE)
│   │   ├── knowledge/          # Knowledge Graph (4 Schichten)
│   │   ├── knowledge/vector/   # Vektor-Suchindex (Kosinus-Abstand)
│   │   ├── metrics/            # Prometheus-Text-Metrik
│   │   ├── missions/           # Missionen (Ziele)
│   │   ├── observatory/        # Agent Observatory (Pro-Agent)
│   │   ├── persistence/        # Backup/Restore/Repair
│   │   ├── plans/              # Ausführungspläne
│   │   ├── privacy/            # Privacy/Data Boundary
│   │   ├── promotion-gate/     # Promotion-Gates (Staging/Production)
│   │   ├── provenance/         # Kausalketten
│   │   ├── providers/          # Provider-Fabric Bindungen
│   │   ├── queue/              # Job Queue Verwaltung
│   │   ├── readiness/          # Readiness-Status
│   │   ├── reliability/        # Zuverlässigkeits-Nachweise
│   │   ├── runs/               # Runs (Jobs/Ausführungen)
│   │   ├── runtime/            # Runtime-Status + Reconcile
│   │   ├── runtimes/           # Runtime-Definitionen
│   │   ├── sandboxes/          # Sandbox-Verwaltung
│   │   ├── science/            # Experiment-Engine + Kausalvalidierung
│   │   ├── secrets/            # Secret-Leases (TTL + Hashing)
│   │   ├── simulation/render/  # SVG-Renderer (7 Visualisierungstypen)
│   │   ├── simulation/         # Szenarien-Simulation
│   │   ├── skills/             # Skill-Registrierung
│   │   ├── slo/                # Service-Level-Objektive
│   │   ├── tasks/              # Tasks
│   │   ├── timeline/           # Zeitachse (Events + Runs)
│   │   ├── tools/              # Tool-Definitionen + Registry
│   │   ├── worker/             # Worker-Verwaltung
│   │   ├── workshop/execute/   # Werkstatt-Ausführung
│   │   └── workshop/           # Werkstatt-Objekte
│   ├── layout.tsx              # Next.js Layout
│   └── page.tsx                # Startseite
│
├── components/
│   ├── control-center.tsx      # 2.207 Zeilen — Haupt-Dashboard (42 Abschnitte)
│   └── status-badge.tsx         # 2 Zeilen — Statusanzeige
│
├── lib/                        # Kern-Bibliotheken (68 Dateien)
│   ├── agent-fabric.ts         # 11 Rollen, Autonomie-Vertrag, Handoffs
│   ├── alerting.ts             # 16 Alarmregeln an reale Kennzahlen
│   ├── app-persistence.ts     # App-Persistence (Apps + Module)
│   ├── approvals.ts           # Freigabe-Anfragen (GRANTED/DENIED)
│   ├── apps.ts                # App-Management (10 Zustände, 10 Lebensphasen)
│   ├── argv-policy.ts         # Keine Shell-Strings; argv[] mit shell:false
│   ├── artifacts.ts           # Evidenz-Artefakte (SHA-256, 8KB-Limit)
│   ├── audit.ts               # Audit-Kette (HMAC, Hash-Chain, Aufbewahrung)
│   ├── authority.ts           # ABAC + Capability-Tokens (535 Zeilen — Kernmodul)
│   ├── backup-policy.ts       # Geplanter Backup-Lauf + Aufbewahrung
│   ├── bootstrap.ts           # Einmal-Initialisierung (Creator als Root Authority)
│   ├── cicd.ts                # CI/CD-Pipelines + Promotion-Stufen
│   ├── computer-use.ts        # Computer-Use Verwaltung (35 Zeilen — kompakt)
│   ├── control-plane.ts       # Control State (Mission/Objective/Task/Agent/Sandbox)
│   ├── creator-auth.ts        # Creator-Login (Secret, Konstantzeit, Sperre)
│   ├── data-boundary.ts       # Schutz externer Datenweitergabe
│   ├── deployment.ts          # Deployment-Slots (595 Zeilen — Health-Checks)
│   ├── device-enrollment.ts   # Enrollment-Autorisierung (fail closed)
│   ├── devices.ts             # Geräte-Fabric (Device-Zustandsmaschine)
│   ├── dispatcher.ts          # Dispatch (Approval + Broker-Verdrahtung)
│   ├── error-intelligence.ts  # Lifecycle bis REGRESSION_LOCKED (556 Zeilen)
│   ├── event-store.ts         # Event-Log Kompatibilität
│   ├── events/log.ts          # Kausales Event-Log (append-only)
│   ├── execution-broker.ts    # 17 Preflight-Prüfungen (383 Zeilen)
│   ├── execution-gate.ts      # Gate: Approval + Kill Switch Prüfung
│   ├── fault-harness.ts       # Sandbox-Kontext + Fault-Tests
│   ├── fault-injection.ts     # 6 Injektionsarten (431 Zeilen)
│   ├── gallery.ts             # Galerie-Einträge (dokumentierte Schritte)
│   ├── governance.ts          # Kill Switches + Delegation
│   ├── inbox.ts               # Creator Inbox (4 Modi)
│   ├── knowledge-vector.ts    # Kosinus-Abstand Embedding-Fallback
│   ├── knowledge.ts           # Knowledge Graph (4 Schichten, 7 Zustände)
│   ├── metrics.ts             # Prometheus-Text-Metriken
│   ├── ns-isolation.ts        # Kernel-Isolation (unshare, 397 Zeilen)
│   ├── observability.ts       # Beobachtungseingaben + Domain Events
│   ├── observatory.ts         # Agent Observatory (9 Felder/Agent)
│   ├── oci-runtime.ts         # OCI/Docker Adapter (330 Zeilen — UNVERIFIED)
│   ├── plans.ts               # Ausführungspläne (Ziel → Schritte)
│   ├── policy.ts              # Policy-Entscheidung (ALLOW/REQUIRE_APPROVAL/DENY)
│   ├── privacy.ts             # Privacy-Policy (default DENY)
│   ├── promotion.ts           # Promotion-Gate-Logik (4 Zeilen — kompakt)
│   ├── provenance.ts          # Kausal-Provenance-Kanten
│   ├── provider-fabric.ts     # Provider-Fabric (244 Zeilen)
│   ├── queue.ts               # Job Queue (Lease, Retry, Dead-Letter)
│   ├── recovery-orchestrator.ts # Recovery-Orchestration
│   ├── recovery-tier.ts       # Stufenklassifikation 1–5 (automatisch)
│   ├── regression.ts          # Regression Engine (Pass/Fail, persistiert)
│   ├── release.ts             # Release-Slots (SHA-256, atomarer Zeiger)
│   ├── reliability.ts         # Zuverlässigkeits-Nachweise
│   ├── request-validation.ts  # Request-Validierung
│   ├── runs.ts                # Runs (375 Zeilen — Job-Zustandsmaschine)
│   ├── runtime-factory.ts     # Runtime-Factory (MOCK-Guard)
│   ├── runtime-local.ts       # Lokale Runtime (unshare, echte Prozesse)
│   ├── runtime-registry.ts    # Runtime-Definitionen (67 Zeilen — kompakt)
│   ├── runtime.ts             # Runtime-Vertrag + MockRuntime
│   ├── sandbox/fabric.ts      # Sandbox-Fabric (Lifecycle, Snapshot, Restore)
│   ├── science.ts             # Experiment-Engine + Kausalvalidierung (447 Zeilen)
│   ├── secrets.ts             # Secret-Leases (TTL, Hashing)
│   ├── session-secret.ts      # Session-Secret-Verwaltung
│   ├── session.ts             # Session-Verwaltung + Validierung
│   ├── shutdown.ts            # Graceful Shutdown
│   ├── simulation.ts          # Szenarien-Simulation (18 Zeilen — kompakt)
│   ├── skills.ts              # Skill-Registrierung (17 Zeilen — kompakt)
│   ├── slo.ts                 # Service-Level-Objektive (375 Zeilen)
│   ├── status.ts              # Status-Modell (20 Zustände, Record enum)
│   ├── system-execution.ts    # Systemausführung über Broker (91 Zeilen)
│   ├── tool-registry.ts       # Tool-Definitionen + Registry
│   ├── totp.ts                # TOTP (RFC 6238) — zweiter Faktor
│   ├── types.ts               # Gemeinsame Typen (240 Zeilen)
│   ├── verification.ts        # SHA-256 Snapshot/Evidenz-Verifizierung
│   ├── visualization.ts       # 7 SVG-Visualisierungen aus echtem Zustand
│   ├── worker.ts              # Worker (283 Zeilen)
│   ├── workshop-execution.ts  # Werkstatt-Ausführungshistorie
│   └── workshop.ts            # Werkstatt-Objekte (25 Zeilen — kompakt)
│
├── lib/persistence/
│   ├── all-stores.ts          # Alle Store-Definitionen
│   └── store.ts               # Kanonischer Store (790 Zeilen — Kernpersistenz)
│
├── lib/api/
│   ├── api-gate.ts            # API-Gate (Bootstrap, Session, CSRF, Legacy)
│   ├── guard.ts               # Routen-Guards (428/401/CREATOR_ONLY/CAPABILITY_DENIED)
│   └── rate-limit.ts          # Rate-Limiting
│
├── scripts/                   # 10 Skripte (9 Shell + 1 MJS für Skripte)
│   ├── acceptance.mjs         # Abnahmeprüfer (85 Anforderungen)
│   ├── audit-actions.mjs      # Aktions-/Attributprüfer (525 Prüfungen)
│   ├── audit-api.sh           # API-Prüfer (248 Prüfungen, 8 Abschnitte)
│   ├── audit-ui.mjs           # UI-Prüfer (92 Prüfungen, 47 Datenabrufe)
│   ├── build-ns-rootfs.sh     # Rootfs bauen (126 MB, Node + BusyBox)
│   ├── cgroup-exec.sh         # cgroup-exec Wrapper
│   ├── dev-up.sh              # Dev-Setup
│   ├── discover-host.mjs      # Geräte-Discovery-Agent
│   ├── fault-injection.mjs    # Fehlerinjektion-Nachweis (28/28)
│   ├── ns-exec.sh             # Namespace-Exec Wrapper
│   ├── release-supervisor.sh  # Deployment-Supervisor
│   ├── sabotage.mjs           # Sabotage-Proben (25/25 erkannt)
│   ├── setup-cgroup-delegation.sh # cgroup-Delegation
│   ├── soak.mjs               # Soak-Test-Skript (227 Zeilen)
│   ├── verify-live.sh         # Live-Http-Prüfer (174/0)
│   └── verify-rate-limit.sh   # Rate-Limit-Nachweis (6/0)
│
├── tests/                     # 65 Testdateien (425 Tests)
│   ├── e2e/                   # 4 Dateien (11 Tests) — Creator-Flow + Failure-Recovery
│   ├── helpers/               # Runtime-Helfer
│   ├── integration/           # 20 Dateien (122 Tests) — Broker, Runtime, ...
│   ├── regression/            # 3 Dateien (15 Tests) — Regression Engine, UI-Vertrag
│   ├── security/              # 20 Dateien (135 Tests) — Authority, Guards, ...
│   ├── unit/                  # 15 Dateien (126 Tests) — Control Plane, Persistence, ...
│   └── ui/                    # 2 Dateien (13 Tests) — Control Center jsdom
│
├── docs/                      # 28 Dokumente
│   ├── ARCHITECTURE.md        # Aufbau, Module, Persistenzmodell
│   ├── STATUS.md              # Reifegrade je Komponente (belegt)
│   ├── ABSCHLUSSBERICHT.md    # Abschlussbericht A–L
│   ├── ABSCHLUSSBERICHT_AUDIT_2026-10-03.md  # Audit-Bericht (dieses Projekt)
│   ├── ARBEITSAUFAHBEN_FERTIGSTELLUNG_2026-10-03.md  # Aufwandsanalyse
│   ├── SECURITY.md            # Bedrohungsmodell
│   ├── AUTHORIZATION.md       # Rollen, Capabilities, Routen-Aktionen
│   ├── BOOTSTRAP.md           # Bootstrap, Creator-Login
│   ├── SANDBOX.md             # Sandbox-Fabric, Netzwerk, Snapshots
│   ├── RUNTIME.md             # Lokale Runtime, OCI (UNVERIFIED), Registry
│   ├── EXPERIMENTS.md         # Experimente und Kausalvalidierung
│   ├── RECOVERY.md            # Recovery-Stufen und Regression
│   ├── KNOWLEDGE.md           # Gedächtnisschichten, Zustände, negatives Wissen
│   ├── PROVIDERS.md           # Provider-Fabric
│   ├── DEVICES.md             # Geräte-Fabric
│   ├── COMPUTER_USE.md        # Computer Use
│   ├── CI_CD.md               # CI-Jobs und Promotion-Gate
│   ├── TESTING.md             # Teststrategie, Live-Nachweis
│   ├── OPERATIONS.md          # Betrieb, Notfälle, Beobachtbarkeit
│   ├── TODO.md                # Offene Punkte (aktualisiert 2026-10-03)
│   ├── ACCEPTANCE.md          # Abnahmekriterien
│   ├── APP_VOLLSTAENDIGE_SPEZIFIKATION_DE.md  # Kanonische Soll-Spezifikation
│   ├── IMPLEMENTATION_ROADMAP.md  # P0–P4 Arbeitspakete
│   ├── MASTER_COMPLETION_SPEC.md  # Vollständige Spezifikation (43 Abschnitte)
│   ├── SPEC_COMPLIANCE.md     # Compliance-Vertrag
│   └── ... (weitere §44-Dokumente)
│
├── server.mjs                 # Produktionsserver (77 Zeilen)
├── middleware.ts              # Next.js Middleware (CSRF, Session-Check) (23 Zeilen)
├── next.config.ts             # Next.js Konfiguration
├── tsconfig.json              # TypeScript Konfiguration
├── vitest.config.ts           # Vitest Konfiguration
├── eslint.config.mjs          # ESLint Konfiguration
├── package.json               # Project-Manifest (Next.js 16.3.6, React 19.3.0)
├── package-lock.json          # Dependency-Lock (151.313 Zeilen)
└── INVENTAR.csv               # Datei-Inventar (229 Zeilen — Audit-Ergebnis)
```

### 1.2 Kernarchitektur — Datenfluss

```
GUI / Control Center (Next.js React UI, 2.207 Zeilen)
    │
    ▼  HTTP (Session-Cookie bob_session, HttpOnly)
    │
Control Plane (lib/control-plane.ts, 655 Zeilen)
    │  Zustand: Mission → Objective → Task → Agent → Sandbox
    │  Persistiert: lib/persistence/store.ts (JSON-Envelope, SHA-256)
    │
    ├── Authority / Governance (lib/authority.ts, 535 Zeilen)
    │     ├── Capability-Token (TTL, Bindung an Task/Sandbox/Environment/Risk)
    │     ├── ABAC (Attribute-Based Access Control)
    │     ├── RBAC (Rollen: CREATOR, DEVELOPER, VIEWER, …)
    │     └── Delegationsgraph (Edges + Tokens, persistent)
    │
    ├── Approval Center (lib/approvals.ts, lib/governance.ts)
    │     ├── Freigabe-Anfragen (GRANTED/DENIED, Creator-Pflicht)
    │     └── Kill Switches (SYSTEM / AGENT / TASK / EXPERIMENT / SANDBOX / DEPLOYMENT)
    │
    ├── Execution Gate (lib/execution-gate.ts, 40 Zeilen)
    │     └── Prüft: Approval vorhanden? Kill Switch aktiv?
    │
    ├── Execution Broker (lib/execution-broker.ts, 383 Zeilen)
    │     └── 17 Preflight-Prüfungen:
    │         1. Request-Form korrekt?
    │         2. argv-Policy (keine Shell-Strings)?
    │         3. Task existiert?
    │         4. Agent existiert + autorisiert?
    │         5. Sandbox existiert + korrekt gebunden?
    │         6. Capability Token gültig + gebunden?
    │         7. Subject/Task/Sandbox/Risk/Environment stimmen?
    │         8. Kill Switch nicht aktiv?
    │         9. Approval vorhanden (falls erforderlich)?
    │         10. Netzwerkpolicy erlaubt?
    │         11. Ressourcenlimits erlauben?
    │         12–17. Weitere Prüfungen (Environment, Scope, …)
    │
    ▼
Job Queue (lib/queue.ts, 332 Zeilen)
    └── Lease, Retry, Dead-Letter, Heartbeat

    ▼
Agent Worker (lib/worker.ts, lib/dispatcher.ts)
    └── Worker-Zyklus: Lease → Start → Heartbeat → Complete/Failed

    ▼
Sandbox Runtime
    ├── REAL_LOCAL (lib/runtime-local.ts, 412 Zeilen)
    │     └── unshare + ns-exec.sh + Rootfs (126 MB, Node + BusyBox)
    │     └── CPU-Time + FileSize kernel-seitig (RLIMIT_CPU, RLIMIT_FSIZE)
    │     └── Speicher/Prozesse optional über cgroup v2 (BOB_CGROUP_DIR)
    │
    ├── REAL_OCI (lib/oci-runtime.ts, 330 Zeilen) — UNVERIFIED
    │     └── Docker/Podman (kein Daemon in Umgebung)
    │     └── Härtung: --network none, --read-only, --cap-drop ALL,
    │        --security-opt no-new-privileges, CPU/Memory/PID-Limits
    │
    └── MOCK (lib/runtime.ts) — nur mit BOB_ALLOW_MOCK_RUNTIME=1

    ▼
Evidence / Audit / Provenance / Knowledge
    ├── Artefakte (lib/artifacts.ts, SHA-256-Digest, 8KB-Limit)
    ├── Audit-Kette (lib/audit.ts, HMAC-Hash-Chain)
    ├── Events (lib/events/log.ts, append-only, kausal)
    ├── Provenance (lib/provenance.ts, Kanten)
    ├── Knowledge (lib/knowledge.ts, 4 Schichten, negatives Wissen)
    └── Observatory (lib/observatory.ts, 9 Felder/Agent)
```

### 1.3 Sicherheitsarchitektur

**Vertrauen durch Architektur, nicht durch Modellverhalten:**

| Schutzschicht | Mechanismus | Datei |
|---|---|---|
| Kein direkter Shell-Zugriff | argv[] mit shell:false; Shell-Interpreter/Metazeichen verboten | lib/argv-policy.ts |
| Kein Agent-Self-Grant | Capability-Token nur durch Creator oder delegierten Issuer | lib/authority.ts:227-234 |
| Kein Wildcard-Capability | `*` Capabilities werden abgelehnt | lib/authority.ts:210 |
| Keine Risk-Eskalation | Issuer kann nicht höheres Risk-Level ausstellen | lib/authority.ts:233 |
| Token Single-Use + Replay-Schutz | Standard maxUses=1; zweiter Lauf → 409 + Evidenz | lib/authority.ts |
| Netzwerk Default DENY | ALLOWLIST fail closed bis Proxy existiert | lib/runtime.ts:115 |
| Keine externe Datenweitergabe | Privacy default DENY für alle Datenklassen | lib/privacy.ts |
| Secrets nie im Browser | HttpOnly Session-Cookie; Creator-Secret serverseitig (0600) | server.mjs, app/api/auth/route.ts |
| Audit außerhalb Agenten-Zugriff | Audit-Kette HMAC-hashchain; manipuliert → erkannt | lib/audit.ts |
| Kein Ausführungspfad um Broker | Systemläufe (Regression/Smoke) laufen als SYSTEM-WORKER über Broker | lib/system-execution.ts |
| Shell-Metazeichen in jedem Argument | Jedes argv-Element wird auf Metazeichen geprüft | lib/argv-policy.ts |
| Legacy-Token fail closed | Nur mit BOB_ALLOW_LEGACY_CONTROL_TOKEN=1 | lib/api/guard.ts:108 |

### 1.4 Persistenz-Architektur

Alle Zustände in `lib/persistence/store.ts` (790 Zeilen):

- JSON-Envelope mit Versionsfeld
- SHA-256-Integritätsdigest über gesamten Inhalt
- Atomares Schreiben: temp `0600` + rename (kein halber Datensatz)
- Manipulationserkennung: Digest-Wechsel → fail closed
- Store-Migration: Version → Sicherungskopie → Migration → Journal
- Ring-Buffer bei Tokens (max 1000 Einträge)
- Restriktive Dateirechte für sensible Stores

### 1.5 Test-Architektur

65 Testdateien, 425 Tests:
- 15 Unit-Suiten: Persistenz, Control Plane, Agent Fabric, Recovery-Tier, Store-Migration, SLO, Status-Modell, Audit-Aufbewahrung, Sabotage-Katalog
- 20 Security-Suiten: Authority-Invarianten, Replay-Schutz, API-Guard, argv-Policy, Creator-Login, TOTP, Inbox, Routen-Guards, Token-Ablauf, Gate-Bypass, Routenvertrag rekursiv, Geräte-Enrollment, Promotion-Gates
- 20 Integration-Suiten: Sandbox-Fabric, Provider-Fabric, App-Module, Computer Use, Ausführungs-Evidenz, Nebenläufigkeit, Kernel-Isolation, Ressourcenlimits, Alarmierung, Backup-Automation, Observatorium, Worker-Fehlerkette, Fehlerinjektion
- 4 E2E-Suiten: Creator-Flow, Failure-Recovery, Abnahmekette
- 3 Regression-Suiten: Regression Engine, UI-Vertrag, NS-Report-Cache
- 2 UI-Suiten: Control Center (jsdom gegen echte Routen)

**Live-Prüfungen (externe Skripte, keine Tests):**
- `verify-live.sh`: 174 HTTP-Prüfungen / 0 Fehler
- `audit-api.sh`: 248 Prüfungen / 0 Fehler
- `audit-actions.mjs`: 525 Prüfungen / 0 Fehler
- `audit-ui.mjs`: 92 Prüfungen / 0 Fehler
- `fault-injection.mjs`: 28/28 in 2 Zyklen
- `sabotage.mjs`: 25/25 Proben erkannt
- `verify-rate-limit.sh`: 6/0
- `acceptance.mjs`: 84/0 (68/68 Routennachweise)

---

## 2. PLATTFORMENVERGLEICH

### 2.1 Codeberg

**Was Codeberg ist:** Ein gemeinnütziger Git-Hosting-Dienst (Forgejo-basiert), der primär Git-Repositorys hostet. Keine spezielle Agenten-Plattform.

**Codeberg-angebotene CI:** Woodpecker CI + Forgejo Actions — CI/CD für Repositorys, nicht für autonome Agentenausführung.

**Codeberg-Vergleich zu BabajagaBoB:**
- Codeberg hat **keine** autonome Agenten-Plattform
- Codeberg-CI ist klassische CI/CD (Commit → Build → Test), kein Agent-Execution-Broker
- Codeberg hat kein Execution-Gate, Broker, Capability-Token-System
- BabajagaBoB hostet auf GitHub, nicht auf Codeberg — Codeberg ist für dieses Projekt irrelevant

**Fazit:** Codeberg ist eine Git-Hosting-Plattform, keine vergleichbare Agenten-Infrastruktur.

---

### 2.2 F-Droid

**Was F-Droid ist:** Ein Repository für freie/open-source Android-Apps.

**F-Droid-Vergleich zu BabajagaBoB:**
- BabajagaBoB ist eine **serverside Next.js/Node.js-Anwendung**, kein Android-App
- F-Droid hat keine vergleichbare Agenten-Infrastruktur
- In F-Droid existieren nur Android-appgrenzte Agenten (z.B. "Hermes Agent Fork" für lokale LLM-Chat auf Android, "Private AI Agents: Offline LLM")
- Diese Android-Agenten haben **keine** vergleichbare Execution-Broker-Architektur, keine Capability-Token, keine Audit-Kette
- Sie laufen direkt auf dem Host (kein OS-level Container-Isolation, laut Sandbox-Analyse Report)

**Besonders vergleichbar auf F-Droid:**
- "Hermes Agent Fork" — lokale LLM-Chat + Android-Workflows, aber keine Agenten-Plattform
- "Private AI Agents: Offline LLM" — lokale LLM auf Smartphone, aber kein Broker, keine Sandbox-Architektur

**Fazit:** BabajagaBoB hat keine natürliche F-Droid-Position — es ist kein Android-Projekt.

---

### 2.3 GitLab

**GitLab vorhandene Agenten-Funktionen:**

1. **GitLab Duo Agent Platform** — AI-Agenten in GitLab integriert:
   - Execution Sandbox mit Anthropic Sandbox Runtime (SRT)
   - Network Allowlist (domain-basierte Kontrolle)
   - Filesystem-Restriktionen
   - Remote execution environment sandbox
   - Composite identity (service account + human user)
   - Human-in-the-loop approvals für Chat-Agenten

2. **CVE-2026-90970** (2026-10-02, CVSS 9.9 CRITICAL):
   - GitLab AI Gateway Sandbox Escape — arbitrary command execution durch crafted flow configuration
   - Zeigt: GitLab's eigene Sandbox hatte ein critical Escape-Problem

3. **GitLab Security Warnung** (2026-09-08):
   - AI-Agenten können Sandbox umgehen durch allowlisted package proxy (Hugging Face Incident)
   - Lesson: Allowlists ≠ Trust Boundaries

**Vergleich zu BabajagaBoB:**

| Aspekt | GitLab Duo | BabajagaBoB |
|---|---|---|
| Execution Sandbox | Anthropic SRT (Network + FS isolation) | unshare namespaces + Rootfs + cgroup |
| Network Control | Domain-Allowlist (SRT) | Default DENY, fail closed, kein Daemon nötig |
| Filesystem | Read/Write-Restriktionen (SRT) | Rootfs EROFS, Workspace als einziger Schreibpfad |
| Identity | Composite (service account + human) | Creator-Auth (Secret + Session + TOTP), Agenten = Capability-Token |
| Audit | Integriert in GitLab | Eigene HMAC-Hash-Chain-Audit-Kette (lib/audit.ts) |
| Broker | GitLab-intern | Eigener Execution Broker (lib/execution-broker.ts, 17 Prüfungen) |
| Capability-Token | Nicht vorhanden | Eigene Capability-Token-Architektur (lib/authority.ts, 535 Zeilen) |
| Shell-Ausführung | SRT blockiert Shell-Metazeichen | argv[] mit shell:false; AST-Policy (lib/argv-policy.ts) |
| Agenten-Framework | GitLab-intern (Duo) | Eigene Agent-Fabric (11 Rollen, lib/agent-fabric.ts) |
| Recovery | GitLab-intern | Eigene Recovery-Orchestration + Tiers (lib/recovery-tier.ts) |
| CI/CD | GitLab CI (integriert) | Eigene CI/CD-Pipelines (lib/cicd.ts) + Promotion-Gate |
| Fehlerinjektionstests | Nicht vorhanden | 6 echte Injektionsarten (lib/fault-injection.ts) |
| Sabotage-Proben | Nicht vorhanden | 8/8 Sabotage-Proben erkannt (scripts/sabotage.mjs) |

**Besonders:** GitLab's eigene CVE-2026-90970 zeigt, dass GitLab selbst unter Sandbox-Escape leidet. BabajagaBoB hat **keine** solche Schwachstelle, weil:
- Es keinen "Flow-Konfigurations-Parser" gibt, der Eingaben als Code interpretiert
- Alle Ausführungen durch argv[]-Policy + Broker-Prüfungen gehen
- Shell-Metazeichen in jedem Argument verboten

**Fazit:** BabajagaBoB ist security-architektonisch robuster als GitLab Duo in mehreren Aspekten (Capability-Token, argv-Policy, eigenem Broker, Audit-Hash-Chain). GitLab hat mehr CI/CD-Integration.

---

### 2.4 GitHub

**GitHub vorhandene Agenten-Funktionen:**

1. **GitHub Copilot Cloud/Local Sandboxes** (2025/2026):
   - Cloud Sandbox: GitHub verwaltete sandbox Umgebung
   - Local Sandbox: Microsoft eXecution Container (MXC) — cross-platform isolation
   - Dateisystem-Restriktion, Netzwerk-Kontrolle, policy-basierte Ausführung
   - Local Sandbox ist **standardmäßig aus** (muß aktiviert werden)

2. **GitHub Copilot CLI**:
   - Shell-Befehle mit eingeschränktem Zugriff
   - Ohne Sandbox: volle Benutzer-Berechtigungen
   - Mit Sandbox: MXC isoliert Befehle

3. **GitHub Actions** (CI/CD, kein Agenten-Platform):
   - Runner-basierte Ausführung
   - Keine Agenten-Loop-Architektur

**Vergleich zu BabajagaBoB:**

| Aspekt | GitHub Copilot | BabajagaBoB |
|---|---|---|
| Sandbox Local | MXC (optional, ausgeschaltet) | unshare namespaces (immer aktiv bei BOB_NS_ISOLATION=on) |
| Sandbox Cloud | GitHub-cloud (Azure/Infra) | OCI/Docker (UNVERIFIED, kein Daemon in Umgebung) |
| Policy-Modell | Policy via MXC | Explicit argv-Policy + Broker-Prüfungen |
| Capability-Token | Nicht vorhanden | Eigene Architecture (lib/authority.ts) |
| Audit | GitHub-intern | Eigene HMAC-Hash-Chain (lib/audit.ts) |
| Network | GitHub-intern | Default DENY, fail closed |
| Agenten-Loop | Copilot-intern | Eigene Agent-Fabric (11 Rollen) |
| Fail Closed bei Sandbox-Ausfall | "runs without sandbox" (Warnung) | Fail closed: nichts ausgeführt (HTTP 409) |
| Shell-Strings | Nicht explizit verboten | argv[] mit shell:false; AST-Policy |
| Eigenständige Plattform | Nein (Copilot = Produkt) | Ja (BabajagaBoB = eigenständige Plattform) |

**GitHub Copilot Local Sandbox** (MXC):
- Cross-platform (Windows, macOS, Linux)
- Policy-driven: Pfade, Netzwerk, Capabilities
- Wenn nicht verfügbar: Warnung + ohne Sandbox ausführen
- **BabajagaBoB ist strenger: bei fehlender Isolation wird NICHTS ausgeführt (fail closed, HTTP 409)**

**Weitere GitHub-Projekte im Vergleich (aus Awesome-Liste):**

| Projekt | Vergleich |
|---|---|
| **agent-sandbox** (vartiainen1) | Sehr ähnlich: security-first, fail closed, cgroup, namespaces. BabajagaBoB ist ähnlich aber mit eigenem Broker und Capability-Token |
| **Agent Capability Broker** (unveiledhistory49) | Sehr ähnlich: Broker, Capability-Token (Ed25519), Single-Use, Replay-Schutz. BabajagaBoB verwendet HMAC statt Ed25519, ähnliches Modell |
| **Splice** (spliceloom) | Komponierbare Agenten-Schicht mit Skills + sandboxed Runtime. BabajagaBoB hat Workshop-System ( Skills + Tools), aber weniger ausgebaut |
| **Secure Agent Execution Environment** (TAM-DS) | Ähnliche Architektur: Policy-Boundary, Execution-Boundary, Audit-Boundary. BabajagaBoB ist ähnlich aber mit mehr Komponenten (Recovery, Knowledge, Experiment-Engine) |
| **Agent Security Sandbox** (zls0529) | Local-first Security Testing Platform. BabajagaBoB ist ähnlich aber als vollständige Plattform |
| **E2B** (e2b.dev) | Cloud-mikroVM-Sandbox pro Agenten-Session. BabajagaBoB ist lokaler-first, ohne Cloud-Abhängigkeit |
| **DeerFlow** (siye566) | SuperAgent-Harness mit LangGraph. BabajagaBoB ist eigenständiger, ohne External-Framework-Abhängigkeit |

**Fazit GitHub:** BabajagaBoB ist eine eigenständige, vollständige Agenten-Plattform, während GitHub Copilot ein kommerzielles Produkt ist. BabajagaBoB ist security-architektonisch strenger (fail closed bei Isolation-Ausfall, argv-Policy, Capability-Token, Audit-Hash-Chain).

---

### 2.5 Weitere Plattformen und Projekte

#### E2B (e2b.dev)
- MikroVM-Sandbox (Firecracker) pro Agenten-Session
- Cloud-first (E2B Cloud) oder self-hosted
- SDK für Node.js, Python
- ~300ms Cold Start
- **Vergleich:** BabajagaBoB ist lokaler-first (kein Cloud-Abhängigkeit), keine MikroVM-Isolation, aber eigenem Broker + Audit

#### Daytona
- Self-hostable git-basierte Developer-Umgebungs-Manager
- Container/VM-Sandboxes
- ~2s Cold Start

#### Firecracker (AWS)
- MicroVM-Isolation
- ~125ms Cold Start
- Kein Agenten-Framework, nur Isolation

#### OpenHands / AgentCanvas
- Docker-basierte Sandbox
- Agenten-Execution-Loop
- Remote Docker Sandbox

#### Factory Droid
- Terminal-native Agent (CLI, Desktop, Cloud)
- Autonomy Levels (Off/Low/Medium/High)
- Droid Shield (Secret-Scanning)
- **Keine** OS-level Sandbox (empfohlen aber nicht enforced)
- **Vergleich:** BabajagaBoB hat OS-level Isolation (unshare), Droid nur policy-basiert

#### Prismor
- Runtime-Sicherheit für Claude Code, Codex etc.
- Canary-Honeytoken, IAM, Live Telemetry, Signed Audit Trail (Ed25519)
- **Vergleich:** BabajagaBoB hat ähnliches Audit (HMAC-Hash-Chain), keine Canary-Mechanik

#### Paperclip (TimFooLabs)
- Vollständige Control Plane + Governance + Approvals + Agent Training + Agentic OS
- **Vergleich:** BabajagaBoB ähnelt Paperclip in der Architektur, aber BabajagaBoB ist deutschsprachig und hat eigenem Broker

---

## 3. BABAJAGABOB — EINORDNUNG IN DIE LANDSCHAFT

### 3.1 Was BabajagaBoB einzigartig macht

1. **Lokal-first, offline-fähig:** Die Plattform läuft komplett lokal ohne Cloud-Abhängigkeit — anders als E2B, Copilot Cloud, OpenHands Cloud.

2. **Kein Cloud-Agenten-Provider:** Anders als Factory Droid, Claude Code, Codex — BabajagaBoB ist vollständig selbst-hosted, keine externen API-Abhängigkeiten für die Plattform.

3. **Deutscher Sprachraum:** Alle Dokumentationen, Fehlermeldungen und der Control Center Text sind auf Deutsch — einzigartig in diesem Bereich.

4. **Vollständige Audit-Kette (HMAC-Hash-Chain):** Jeder Audit-Eintrag wird hash-kettig verknüpft — Manipulation erkennbar. Ähnlich wie Prismor (Ed25519) und Agent Capability Broker, aber anders implementiert.

5. **Capability-Token als Architektur-Zentrum:** Anders als GitLab Duo, GitHub Copilot, Factory Droid — BabajagaBoB hat Capability-Token als zentrales Autorisierungsmodell (lib/authority.ts, 535 Zeilen).

6. **argv[]-Policy (keine Shell-Strings):** Explizites Verbot von Shell-Interpreter und Metazeichen in jedem Argument — anders als die meisten anderen Plattformen.

7. **Fail closed bei Isolation-Ausfall:** Wenn Kernel-Isolation nicht verfügbar ist, wird NICHTS ausgeführt (HTTP 409) — anders als GitHub Copilot (warnt + ohne Sandbox ausführt).

8. **Fail closed bei ALLOWLIST:** Network-Allowlist ist dauerhaft fail closed bis Proxy existiert — anders als GitLab Duo (Allowlist aktiv, aber anfällig für Sandbox-Escape).

9. **Sabotage-Proben als Test:** 8 intentional geschwächte Regeln → 8/8 erkannt durch CI — einzigartiger Mechanismus.

10. **Fehlerinjektion als Test:** 6 echte Injektionsarten (Prozessabbruch, Worker-Verlust, Netzwerk, Duplikat, Concurrent Write, Store-Tamper) — nicht allgemein vorhanden.

### 3.2 Was fehlt (lange nicht vorhanden)

| Feature | BabajagaBoB | Andere Plattformen |
|---|---|---|
| MikroVM-Isolation (Firecracker) | Nicht vorhanden | E2B |
| Cloud-Sandboxing | Nicht vorhanden | E2B, Copilot Cloud, OpenHands |
| Multi-Agenten-Orchestration | Agent Fabric (11 Rollen), aber kein Multi-Agenten-Loop | Factory Droid, DeerFlow, CrewAI |
| Browser-E2E-Tests | Nicht vorhanden (kein Browser in Umgebung) | Fast alle kommerziellen Plattformen |
| OCI-Container (verifiziert) | UNVERIFIED (kein Docker) | Fast alle Docker-basierten Systeme |
| MCP-Integration | Nicht vorhanden | Viele aktuelle Plattformen (Claude, Codex, Factory) |
| Model-Integration (LLM-API) | Nicht vorhanden (Platform ist LLM-agnostic) | Fast alle Plattformen (Claude, GPT, Gemini, …) |

### 3.3 Standortbewertung: Ist BabajagaBoB unique?

**BabajagaBoB ist einzigartig in:**

1. **Lokal-first + Offline-fähig + ohne Cloud-Abhängigkeit** — in Kombination mit Capability-Token + Audit-Hash-Chain + argv[]-Policy + 11 Agenten-Rollen + Recovery-Tier + Knowledge-Graph + Experiment-Engine + Fehlerinjektion + Sabotage-Proben + 14 §44-Dokumenten + deutschen Dokumentationen.

2. **Kein vergleichbares deutsches Open-Source-Projekt** mit dieser Architektur existiert — die nächsten Vergleiche (agent-sandbox, Agent Capability Broker, Secure Agent Execution Environment, Splice) sind alle englischsprachig und einfacher in der Feature-Dichte.

3. **Keine Platform has all of:** Capability-Token + argv[]-Policy + fail-closed Isolation-Ausfall + Sabotage-Proben-Tester + 11-Rollen-Agent-Fabric + HMAC-Audit-Chain + 14 §44 Dokumente.

**BabajagaBoB ist NICHT einzigartig in:**

1. Security-first Sandbox (vartiainen1/agent-sandbox, TAM-DS haben ähnliche Architektur)
2. Capability Broker (unveiledhistory49/agent-capability-broker hat ähnliches Modell)
3. CI/CD-Gate (GitLab, GitHub haben ähnliches)
4. Audit-Trail (Prismor hat ähnliches mit Ed25519)

---

## 4. ZUSAMMENFASSUNG

| Dimension | BabajagaBoB | Beste Vergleichsplattform |
|---|---|---|
| Lokal-first / Offline | ✅ Stark (kein Cloud-Abhängigkeit) | Factory Droid (lokal, optional Cloud) |
| OS-level Isolation | ✅ unshare + Rootfs + cgroup | agent-sandbox (vartiainen1) |
| Capability-Token | ✅ HMAC-Hash-Chain-Token | Agent Capability Broker (Ed25519) |
| argv[]-Policy (keine Shell) | ✅ Stark | agent-sandbox |
| Fail closed bei Isolation-Ausfall | ✅ Ja (HTTP 409) | agent-sandbox (HARDENED Substrate) |
| Audit-Kette (unveränderlich) | ✅ HMAC-Hash-Chain | Prismor (Ed25519) |
| Agenten-Rollen (11) | ✅ Ja (Autonomie-Vertrag) | Paperclip (Org Chart für Agenten) |
| Recovery-Tier | ✅ 1–5, automatisch | DeerFlow (Recovery-Pfade) |
| Experiment-Engine | ✅ Ja (Baseline/Control/Replikation) | E2B (Experiment-Umgebungen) |
| Fehlerinjektionstests | ✅ 6 echte Arten | Nicht verbreitet |
| Sabotage-Proben-Tester | ✅ 8/8 erkannt | Nicht verbreitet |
| Dokumentation (14 §44) | ✅ Deutsch, code-konform | Paperclip (umfassend) |
| Cloud-Sandbox | ❌ Nicht vorhanden | E2B, Copilot Cloud |
| OCI/Docker (verifiziert) | ❌ UNVERIFIED | Fast alle |
| Browser-E2E-Tests | ❌ Nicht verifiziert | Fast alle (Playwright/Cypress) |
| MCP-Integration | ❌ Nicht vorhanden | Viele aktuelle Plattformen |
| LLM-Integration (API) | ❌ Nicht vorhanden | Fast alle Plattformen |

**Gesamtbewertung:** BabajagaBoB ist eine **sophistizierte, lokal-first Agenten-Plattform** mit einzigartiger Feature-Dichte im deutschen Sprachraum. Die Sicherheitsarchitektur (Capability-Token, argv[]-Policy, fail-closed Isolation, Audit-Hash-Chain) ist auf hohem Niveau. Die größten Lücken gegenüber der Branchen-Entwicklung sind die fehlende Cloud/VM-Sandbox (OCI nicht verifiziert), fehlende Browser-E2E, fehlende MCP-Integration und fehlende direkte LLM-API-Anbindung — aber das sind bewusste Architektur-Entscheidungen (lokal-first, LLM-agnostic).

**Das Projekt ist im Kern betriebsbereit** für lokalen Creator-Betrieb (REAL_LOCAL mit unshare-Isolation), benötigt aber OCI-Runtime-Verifizierung + Computer-Use-Treiber + Egress-Proxy + Provider-Anbindung für volle Nutzbarkeit (siehe `docs/ARBEITSAUFAHBEN_FERTIGSTELLUNG_2026-10-03.md`).

---

*Analyse erstellt: 2026-10-03 | Quellen: repo-complete-Analyse + Web-Search auf Codeberg, F-Droid, GitLab, GitHub, E2B, Factory Droid, und weiteren Plattformen*
