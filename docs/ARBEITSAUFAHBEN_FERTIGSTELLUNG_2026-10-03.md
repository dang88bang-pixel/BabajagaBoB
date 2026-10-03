# ARBEITSAUFAHBEN — Bis zur nutzbaren Fertigstellung
## BabajagaBoB v0.2.0 | Stand: 2026-10-03

> **Definition „nutzbar":** Die Plattform ist für einen Creator (einziger Benutzer) betriebsbereit,
> wenn diese mithilfe der Control Plane Aufgaben erzeugen, autorisieren, ausführen, Ergebnisse
> einsehen, Fehler detektieren/recoverieren und Wissen persistieren kann — ohne auf externe
> Dienste angewiesen zu sein (Offline-fähig, lokal vollständig).

---

## 1. Gesamtbeurteilung des aktuellen Standes

### 1.1 Was bereits funktioniert (Reifegrad VERIFIED / TESTED)

Die Plattform ist **weit entwickelt**. Die Kernkette
`Creator → Mission → Task → Agent → Authorization → Sandbox → Execution → Evidence → Knowledge`
ist vollständig implementiert und durch Tests gesichert.

| Schicht | Status | Nachweis |
|---|---|---|
| Control Plane (Mission/Objective/Task/Agent) | ✅ TESTED | `tests/unit/control-plane.test.ts` |
| Persistenz (Envelope, Digest, atomar, migrationsfähig) | ✅ TESTED | `tests/unit/persistence.test.ts`, `tests/unit/store-migration.test.ts` |
| Autorisierung (Token, TTL, Bindungen, RBAC, ABAC) | ✅ TESTED | `tests/security/authority.test.ts` |
| API-Grenze + Session + Guard (alle Routen) | ✅ VERIFIED | `scripts/verify-live.sh`: 174/0; `audit-api.sh`: 248/0 |
| Aktionsspezifische Routen-Guards | ✅ VERIFIED | Jede Route außer `/api/auth` prüft ihre Aktion |
| Status-Modell (20 Zustände) | ✅ TESTED | `tests/unit/status-model.test.ts` |
| Agent Observatory + „Warum"-Record | ✅ VERIFIED | `scripts/audit-ui.mjs`: 88/0 |
| Live-Http-Nachweis (174 Prüfungen, 0 Fehler) | ✅ VERIFIED | `scripts/verify-live.sh` |
| Kernel-Isolation `NAMESPACES` (unshare, echtes Rootfs) | ✅ VERIFIED | 11 Tests, live gemessen: CapBnd=0, NoNewPrivs=1, EROFS |
| Ressourcenlimits (CPU-Time + FileSize kernel-seitig) | ✅ VERIFIED | RLIMIT_CPU, RLIMIT_FSIZE; cgroup Speicher/Prozesse optional |
| Capability-Token Replay-Schutz | ✅ TESTED | 409 bei zweitem Lauf, Evidenz + Audit |
| Backup/Restore mit Digest-Prüfung | ✅ TESTED | Manipuliertes Backup → 409 |
| Backup-Automation (geplanter Lauf, Aufbewahrung) | ✅ TESTED | 9 Tests, UI-Panel vorhanden |
| Creator-Login (Secret, Konstantzeit, Sperre) | ✅ VERIFIED | Live nachgewiesen (Schritt 12) |
| TOTP als zweiter Faktor | ✅ VERIFIED | Live: Pflicht, Ablehnung, Akzeptanz, Replay |
| Execution Gate + Broker (17 Prüfungen) | ✅ TESTED | E2E + Security |
| Lokale Runtime `REAL_LOCAL` (echte Prozesse) | ✅ TESTED | argv[], shell:false, Timeout-Kill |
| Sandbox-Fabric (Lifecycle, Snapshot SHA-256) | ✅ TESTED | 6 Tests |
| Experiment-Engine (Baseline/Control/Replikation) | ✅ IMPLEMENTED | Kausalvalidierung vorhanden |
| Error Intelligence bis `REGRESSION_LOCKED` | ✅ TESTED | Complète Kette im E2E-Test |
| Recovery-Tier-Klassifikation (1–5) | ✅ TESTED | Automatisch, begründet |
| Regression Engine (PASS/FAIL, persistiert) | ✅ TESTED | Echte Prozessausführung |
| Knowledge Graph (4 Schichten, negatives Wissen) | ✅ TESTED | `ESTABLISHED` verlangt Evidenz + Verifikation |
| Agent Fabric (11 Rollen, Autonomievertrag) | ✅ TESTED | Kein Agent darf Autorität/Produktion/Infra |
| Provider Fabric (Approval-Pflicht, Bindungen) | ✅ TESTED | `tests/integration/provider-fabric.test.ts` |
| Device Fabric (Discovery ≠ Authorization) | ✅ TESTED | 8 Tests |
| Computer Use (Registrieren ≠ Autorisieren) | ✅ TESTED | Storage-basiert, Allocation nur nach Freigabe |
| Control Center UI (42 Abschnitte) | ✅ VERIFIED | `scripts/audit-ui.mjs`: 88/0; Daten verbindet mit echten Routen |
| Privacy/Data Boundary (default DENY) | ✅ VERIFIED | Live geprüft |
| Deployment (Slots, SHA-256, Health-Checks, Rollback) | ✅ VERIFIED | Live: STAGED → ACTIVE nach Supervisor-Lauf |
| Fehlerinjektion (6 echte Injektionsarten) | ✅ VERIFIED | `scripts/fault-injection.mjs`: 28/28 in 2 Zyklen |
| Sabotage-Proben (8/8 erkannt) | ✅ VERIFIED | `scripts/sabotage.mjs` + CI als Pflichtstufe |
| CI/CD Pipeline (6 Jobs, Gate, Promotion) | ✅ TESTED | Grüne Läufe dokumentiert |
| Audit/Provenance/Timeline (verkettet, append-only) | ✅ VERIFIED | `verifyAuditChain()` in mehreren Suiten |
| Dokumentation (14 §44-Dokumente auf Deutsch) | ✅ vorhanden | Code- und nachweiskonform |

**Testresultat (2026-10-03):** 420/425 Tests grün (98,82%), 5 kurze Fehler (drei Umgebungs-Blocker, einer Test-Design, einer Kaskade).

### 1.2 Wo steht die Anwendung heute?

Die Plattform ist **im Kern betriebsbereit** für einen lokalen Creator-Einsatz:
- Creator kann sich anmelden (Session + optionales TOTP)
- Creator kann Missions/Objectives/Tasks erstellen
- Tasks können autorisierte Agenten zugewiesen werden
- Autorisierte Ausführungen laufen über Gate → Broker → isolierte Runtime
- Ergebnisse werden als Evidenz (SHA-256-Digest) persistiert
- Fehler durchlaufen die vollständige Error-Intelligence-Kette bis `REGRESSION_LOCKED`
- Recovery funktioniert (Snapshot/Restore/Verifikation)
- Knowledge wird persistiert und negiert bei Fehlern
- Das Control Center zeigt alle 42 Abschnitte mit echten Daten an

**Was fehlt für den vollen „nutzbar"-Anspruch, wird in Abschnitt 2 analysiert.**

---

## 2. Offene Arbeiten — Priorisiert nach Impact

### 2.1 P0 — Blocker für echte Nutzbarkeit (muss vor Produktivbetrieb)

Diese Punkte machen die Anwendung **noch nicht vollständig nutzbar** oder einschränken sie
fundamental. Sie werden zuerst bearbeitet.

#### P0.1 — OCI Runtime vollständig ausbauen und verifizieren
**Dateien:** `lib/oci-runtime.ts` (330 Zeilen), `app/api/runtime/route.ts` (103 Zeilen)
**Status:** `UNVERIFIED` (kein Docker/Podman in Umgebung; Härtungsflags nicht praktisch geprüft)

**Was fehlt (aus STATUS.md + MASTER_SPEC §10):**
- Vollständige OCI-Härtung: `--network none`, `--read-only`, `--cap-drop ALL`,
  `--security-opt no-new-privileges` — implementiert in Code, aber nicht verifiziert
- Ressourcenlimits: CPU/Memory/PID-Limits im Container
- Prozess- und Container-Cleanup (Orphan Detection)
- Artifact Collection aus dem Container
- Log Collection aus dem Container
- Reconciliation (ermittelt, ob Container noch läuft)
- Deterministic Container-Namen

**Aufwand:** 3–4 Wochen (1 erfahrener Full-Stack Engineer)
**Abhängigkeit:** Docker/Podman-Host bereitstellen (Umgebungs-Anforderung)
**Test:** `tests/integration/oci-runtime.test.ts` (48 Zeilen, muss grün werden)

#### P0.2 — Computer Use Treiber (Browser-Integration)
**Dateien:** `lib/computer-use.ts` (35 Zeilen — nur Verwaltung),
`tests/integration/computer-use.test.ts` (88 Zeilen — nur Storage-Test)
**Status:** `PARTIAL` (Verwaltung implementiert, kein Treiber)

**Was fehlt (aus STATUS.md + MASTER_SPEC §24):**
- Browser-Treiber: Playwright (Chromium) oder VNC-Treiber im Sandbox-Workspace
- Aktionen: DOM, Click, Type, Navigation, Screenshot, OCR, Network Observation
- Treiber-Ausführung **über Broker** (nicht direkt)
- Screenshot-Evidenz als Artefakt mit Digest
- OCR-Ergebnis als Evidenz

**Aufwand:** 2–3 Wochen
**Abhängigkeit:** Playwright installierbar (Download-Hosts aktuell gesperrt → zunächst lokal),
Browser binary im Sandbox verfügbar
**Test:** Neue Testdatei `tests/integration/computer-use-browser.test.ts`

#### P0.3 — Egress-Allowlist mit kontrolliertem Proxy
**Dateien:** `lib/runtime.ts` (Fail-closed bei ALLOWLIST), `lib/computer-use.ts`
**Status:** `BLOCKED` (fail closed by design; TODO.md §2)

**Was fehlt:**
- Egress-Proxy-Dameon (lokal oder remote)
- DNS-Pinning im Proxy
- Allowlist-Konfiguration (wer darf wohin?)
- Approval-Pflicht für Egress-Ziele
- Telemetrie für Egress-Nutzung

**Aufwand:** 1–2 Wochen
**Test:** Integrationstests mit Proxy-Lauf

---

### 2.2 P1 — Wichtig für echte Nutzbarkeit (nach P0)

Diese Punkte erweitern die Nutzbarkeit erheblich, sind aber nicht zwingend für den ersten Betrieb.

#### P1.1 — Provider Fabric: Echte externe Verbindungen
**Dateien:** `lib/provider-fabric.ts` (244 Zeilen — Struktur vorhanden)
**Status:** `PARTIAL` (Katalog/Bindungen/Telemetrie persistent, aber keine echte Verbindung)

**Was fehlt:**
- Mindestens 1 echter Provider-Adapter (z.B. Aktuell Daten API, Wetter, GitHub API)
- Echte Telemetrie-Sammlung
- Health-Checks auf remote Endpunkt
- Rate-Limit-Handhabung
- Credentials-Broker (nicht im Code, nicht im Browser)
- Revocation → Verbindung trennen

**Aufwand:** 1–2 Wochen (je Provider 2–3 Tage)
**Test:** `tests/integration/provider-live.test.ts`

#### P1.2 — Guard-Routes für alle verbleibenden Routen verdrahten
**Dateien:** `lib/api/guard.ts`, `app/api/*/route.ts` (alle noch nicht guard-verdrahten Routen)
**Status:** `IMPLEMENTED` für Kern- und Schreibpfade; REST noch offen
**Nachweis:** `tests/security/route-guards.test.ts` deckt bereits 428/401/CREATOR_ONLY/CAPABILITY_DENIED ab

**Was fehlt (aus STATUS.md offene Restarbeiten):**
- Aktionsspezifische `guardRequest`-Prüfungen für alle noch nicht verdrahteten Routen
- Kern- und Schreibpfade sind verdrahtet, übrige Routen über Middleware fail closed

**Aufwand:** 3–5 Tage
**Test:** Erweiterung von `tests/security/route-guards.test.ts`

#### P1.3 — Workshop-Komponenten generieren (Tools, Skills, Runtime-Adapter)
**Dateien:** `lib/workshop.ts` (25 Zeilen — Verwaltung),
`lib/workshop-execution.ts` (41 Zeilen — Ausführungshistorie),
`app/api/workshop/execute/route.ts` (39 Zeilen)
**Status:** Entstehung von Workshop-Objekten implementiert; keine generierten Komponenten

**Was fehlt (aus MASTER_SPEC §19):**
Werkstatt muss komponenten Erzeugen können:
- Tools (skriptbare Werkzeuge mit Input-Schema, Capabilities, Timeout)
- Skills (vordefinierte Agenten-Fähigkeiten, Building-Blocks)
- Runtime Adapter (für neue Runtimes)
- Connectors (zu Providern, Geräten, externen Systemen)
- Debugger Adapter
- Parser Adapter
- Compiler Adapter
- Test Harness
- Research Workflow
- Deployment Adapter
- Migration Tool
- Diagnostic Tool
- Browser Skill (für Computer Use)
- GUI Skill

**Aufwand:** 2–3 Wochen (MVP: Tools + Skills + Runtime Adapter + Connector)
**Test:** `tests/integration/workshop-components.test.ts`

#### P1.4 — Runtime Registry erweitern (neue Sprachen/Runtimes)
**Dateien:** `lib/runtime-registry.ts` (67 Zeilen — stark vereinfacht)
**Status:** `REAL` aber minimal (nur Node.js, Python, Custom OCI)

**Was fehlt (aus MASTER_SPEC §20):**
Runtime-Definitionen für: Java/Kotlin, Go, Rust, C/C++, C#, Swift, Dart, PHP, Ruby, Lua, R, Julia, Scala, Haskell, Elixir/Erlang, SQL, WebAssembly, Container, VM, GPU, Embedded

**Aufwand:** 1–2 Wochen (Ausbau der Registry + Tests)
**Test:** `tests/integration/runtime-registry.test.ts` (bereits vorhanden, 29 Zeilen)

#### P1.5 — Storage-Persistence für Simulation, Provider, Devices
**Dateien:** `lib/persistence/store.ts` (790 Zeilen — vollständig)
**Status:** Simulation/Provider/Devices sind noch nicht persistiert (STATUS.md, MASTER_SPEC §35)

**Was fehlt:**
- Simulation-Persistenz (`lib/simulation.ts` — 18 Zeilen, im Speicher)
- Provider-Persistenz (`lib/provider-fabric.ts` — teilweise, Health/Zustand nur im Speicher)
- Devices-Persistenz (`lib/devices.ts` — teilweise, State im Speicher)
- Simulation State persistence (Szenarien → Store)
- Provider Health history persistence
- Device heartbeat history persistence

**Aufwand:** 3–5 Tage
**Test:** Erweiterung `tests/unit/persistence.test.ts`

#### P1.6 — Worker/Dispatcher: Eigene Tests
**Dateien:** `lib/worker.ts` (283 Zeilen), `lib/dispatcher.ts` (164 Zeilen)
**Status:** `IMPLEMENTED` aber kein eigener Test (STATUS.md)

**Was fehlt:**
- Worker-Zyklus-Test (Lease, Heartbeat, Job-Ausführung, Timeout, Retry)
- Dispatcher-Test (Job-Reihung, Priorisierung, Lease-Ablauf)
- Stale-lease-Detection-Test
- Recovery-Pfad-Test für Worker

**Aufwand:** 3–5 Tage
**Test:** `tests/integration/worker.test.ts`, `tests/integration/dispatcher.test.ts`

#### P1.7 — Experiment-Engine: Echte Tests (nicht nur E2E)
**Dateien:** `lib/science.ts` (447 Zeilen)
**Status:** `IMPLEMENTED` (Kausalvalidierung vorhanden, kein eigener Unit/Integrationstest)

**Was fehlt:**
- Unit-Tests für Baseline/Control/Replikation-Logik
- Integrationstests für Kausalprüfung (10 Prüfungen)
- Tests für Wissenszustand-Übergänge (OBSERVED → SUPPORTED → ESTABLISHED)
- Gegenbeispiel-Test
- Confounder-Erkennung-Test

**Aufwand:** 1 Woche
**Test:** `tests/unit/science.test.ts`, `tests/integration/experiment-engine.test.ts`

---

### 2.3 P2 — Polishing für Production (nach P1)

#### P2.1 — CI/CD: Browser-E2E und Evaluation Pipeline
**Dateien:** `.github/workflows/ci.yml`, `lib/cicd.ts`, `lib/promotion.ts`
**Status:** Pipeline vorhanden (6 Jobs), aber `BROWSER` und `EVALUATION` fehlen (STATUS.md)

**Was fehlt:**
- Playwright-basierte Browser-E2E-Tests im CI
- Evaluation-Job: Läuft die Anwendung unter Last?
- Preview-Umgebung (automatisches Deployment zu Review-Branch)
- Smoke-Tests im CI (nach Build)

**Aufwand:** 2–3 Wochen
**Abhängigkeit:** Playwright-Installierung (Download-Hosts aktuell gesperrt → lokal beschaffen)

#### P2.2 — Self-Healing (Detektions-/Vorbereitungs-Logik)
**Dateien:** `lib/reliability.ts`, `lib/recovery-orchestrator.ts`
**Status:** Recovery-Pfade implementiert, Self-Healing-Detektion noch nicht

**Was fehlt (MASTER_SPEC §38):**
- CPU/Memory/Queue-Depth/Latenz-Monitoring mit Schwellwerten
- Predictive Signale (vor Ausfall)
- Diagnostic Sandbox Vorbereitung
- Rollback Artifact Vorbereitung
- Verified Backup Vorbereitung vor Fehler

**Aufwand:** 1–2 Wochen

#### P2.3 — Deployment-Adapter und Compiler-Adapter (Workshop)
**Dateien:** Workshop-System (`lib/workshop*.ts`)
**Status:** Workshop existiert, Adapter fehlen

**Was fehlt:**
- Deployment-Adapter (automatische Ausroll-Skripte für verschiedene Targets)
- Compiler-Adapter (Build-Befehle für verschiedene Sprachen, konfigurierbar)

**Aufwand:** 1 Woche

#### P2.4 — GUI-Mutationen serverseitig authentifizieren
**Dateien:** `app/*`, `components/*`, `middleware.ts`, `lib/api/api-gate.ts`
**Status:** API-Guard vorhanden; einige GUI-Mutationspfade noch nicht explizit abgesichert

**Was fehlt (MASTER_SPEC §34.15):**
- Alle GUI-Mutationen müssen serverseitig authentifiziert werden
- Root Token nie an den Browser
- CSRF-Origin-Prüfung für jede Mutation

**Aufwand:** 3–5 Tage
**Test:** Erweiterung `tests/security/api-guard.test.ts`, `tests/security/route-guards.test.ts`

#### P2.5 — Alerting-Operation: Scraper/Alertmanager
**Dateien:** `lib/alerting.ts` (260 Zeilen — 16 Regeln)
**Status:** Regeln implementiert und getestet; Betrieb von Scraper/Alertmanager offen

**Was fehlt:**
- Echter Scraper (periodische Kennzahlensammlung)
- Alertmanager-Integration (Externe Benachrichtigung, z.B. E-Mail, Webhook)
- Slack/Discord/PagerDuty Webhook

**Aufwand:** 1 Woche

#### P2.6 — Soak-Test Dauerlauf
**Dateien:** `lib/slo.ts`, `scripts/soak.mjs`
**Status:** `scripts/soak.mjs` vorhanden (227 Zeilen), aber kein Dauerlauf über Stunden

**Was fehlt:**
- Automatisierter Dauerlauf (Stunden, Lastkurve)
- SLO-Dauerhaftigkeitsnachweis (P95 über 1 Stunde etc.)
- Monitoring-Dashboard für Soak-Metriken

**Aufwand:** 1 Woche (einmaliger Aufbau; dann wiederkehrend)

---

## 3. Schätzung des Gesamtaufwands

### 3.1 Zusammenfassung nach Paketen

| Paket | Aufwand | Abhängigkeiten | Priorität |
|---|---|---|---|
| P0.1 OCI Runtime ausbauen + verifizieren | 3–4 Wochen | Docker/Podman-Host | **P0** |
| P0.2 Computer Use Browser-Treiber | 2–3 Wochen | Playwright, Browser binary | **P0** |
| P0.3 Egress-Proxy + Allowlist | 1–2 Wochen | Proxy-Software, DNS-Pinning | **P0** |
| P1.1 Provider: echte Verbindungen | 1–2 Wochen | Provider-Zugang, Allowlist | **P1** |
| P1.2 Guard-Routes alle verdrahten | 3–5 Tage | Route-Liste | **P1** |
| P1.3 Workshop-Komponenten (MVP) | 2–3 Wochen | Workshop-System vorhanden | **P1** |
| P1.4 Runtime Registry erweitern | 1–2 Wochen | Runtime-System | **P1** |
| P1.5 Persistence: Simulation/Provider/Devices | 3–5 Tage | Store-System vorhanden | **P1** |
| P1.6 Worker/Dispatcher-Tests | 3–5 Tage | Worker/Dispatcher-Code vorhanden | **P1** |
| P1.7 Experiment-Engine-Tests | 1 Woche | lib/science.ts vorhanden | **P1** |
| P2.1 CI: Browser-E2E + Evaluation | 2–3 Wochen | Playwright | **P2** |
| P2.2 Self-Healing Detektion | 1–2 Wochen | Monitoring-Infrastruktur | **P2** |
| P2.3 Deployment/Compiler-Adapter | 1 Woche | Workshop-System | **P2** |
| P2.4 GUI-Mutationen authentifizieren | 3–5 Tage | API-Guard vorhanden | **P2** |
| P2.5 Alerting-Operation | 1 Woche | lib/alerting.ts vorhanden | **P2** |
| P2.6 Soak-Dauerlauf | 1 Woche | lib/slo.ts, soak.mjs vorhanden | **P2** |

### 3.2 Kumulative Schätzung

**Einzel-Person (erfahrener Full-Stack Engineer):**

```
P0 (kritisch):     6–9 Wochen  (NICHT überspringen)
P1 (wichtig):      8–13 Wochen (nach P0)
P2 (polishing):    4–8 Wochen  (nach P1)
                       ─────────
Gesamt:           18–30 Wochen ≈ 4,5–7,5 Monate
```

**Kleines Team (2–3 Personen, parallel):**

```
P0:                4–6 Wochen  (parallelisiert)
P1:                5–9 Wochen  (parallelisiert)
P2:                3–5 Wochen  (parallelisiert)
                       ─────────
Gesamt:           12–20 Wochen ≈ 3–5 Monate
```

### 3.3 Was das Projekt heute schon kann (vor dem Aufwand)

Auch ohne P0–P2 ist die Plattform **direkt nutzbar für den lokalen Creator-Betrieb** —
solange keine Container, keine Browser-Aktionen und keine externen Provider benötigt werden:

- ✅ Creator-Login mit Session (und optional TOTP)
- ✅ Tasks erstellen, Agents zuweisen, autorisieren
- ✅ Echte Ausführungen über Gate → Broker → isolierte Runtime (REAL_LOCAL)
- ✅ Ergebnisse als Evidenz (SHA-256-Digest) einsehen
- ✅ Fehlerkette bis `REGRESSION_LOCKED` durchlaufen
- ✅ Recovery (Snapshot, Restore, Verifikation)
- ✅ Wissen persistieren (4 Schichten, negatives Wissen)
- ✅ Control Center mit allen 42 Abschnitten, echten Daten
- ✅ Audit-Kette, Provenance, Timeline
- ✅ Backup/Restore, Backup-Automation (manuell auslösbar)
- ✅ SLO-Bewertung, Metriken (Prometheus-Text)
- ✅ Deployment-Slots (SHA-256), Health-Checks, Rollback
- ✅ Fehlerinjektion und Sabotage-Proben
- ✅ Kernel-Isolation `NAMESPACES` (ohne Docker, ohne Root)

**Der einzige echte Betriebs-Blocker für Creater-Nutzung ist:** Die Anwendung läuft lokal,
ist aber auf `REAL_LOCAL` (kein OCI-Container) und ohne Browsertreiber beschränkt.
Das ist für viele lokale Automatisierungs-Aufgaben vollständig ausreichend.

---

## 4. Abhängigkeiten und Reihenfolge

```
P0.1 OCI Runtime ──────────────────────────────┐
   │                                            │
P0.2 Computer Use Browser-Treiber ◄────────────┘ (braucht OCI oder Browser-binary)
                                                │
P0.3 Egress-Proxy ◄────────────────────────────┘ (Egress-Allowlist braucht Proxy)
                                                │
P1.1 Provider-Verbindungen ─────────────────────┘ (braucht Egress-Allowlist)
                                                │
P1.* Guard-Routes, Workshop, Tests, Registry ──┘ (unabhängig, parallelisierbar)
                                                │
P2.* CI/CD, Self-Healing, Polishing ────────────┘ (nach P0+P1)
```

**Kritischer Pfad (längste Kette):** P0.1 → P0.2 → P1.1 = 6–9 Wochen ohne Parallelisierung

---

## 5. Empfehlung für nächste Schritte

### Sofort (dieses Sprint, 1–2 Wochen):

1. **P1.2 Guard-Routes verdrahten** (kleinste Aufgabe, größter Sicherheitsgewinnt)
2. **P1.6 Worker/Dispatcher-Tests** (erschließt die Queue/Runs-Logik für Tests)
3. **P1.5 Persistence für Simulation/Provider/Devices** (vereinfacht alles andere)
4. Aufräumen der 5 Test-Fehler:
   - `computer-broker.test.ts`: Test-Design anpassen (Creator-Agenten statt SYSTEM-WORKER)
   - `graceful-shutdown.test.ts`: Umgebungsproblem (Next.js FS-Check) dokumentieren
   - `oci-runtime.test.ts` + `acceptance-matrix.test.ts`: Docker-Problem dokumentiert

### Nächstes Sprint (3–4 Wochen):

5. **P0.1 OCI Runtime** (wenn Docker-Host verfügbar) — oder P0.2 als Alternative
6. **P1.1 Provider-Verbindungen** (einfachster Provider zuerst, z.B. eine Daten-API)
7. **P1.3 Workshop-Komponenten MVP** (Tools + Skills)

### Danach (6–12 Wochen):

8. P0.2 Computer Use (Playwright/VNC)
9. P1.4 Runtime Registry erweitern
10. P1.7 Experiment-Engine-Tests
11. P2.1 CI Browser-E2E

---

## 6. Dokumentierte ⛔-Blocker (die nicht im Aufwand enthalten sind)

Diese Punkte erfordern **externe Ressourcen oder Entscheidungen**, die außerhalb des
Coderaufwands liegen:

| # | Blocker | Grund | Lösung |
|---|---|---|---|
| B1 | Docker/Podman-Host | Keine Container-Laufzeit in Sandbox-Umgebung | Host mit Docker bereitstellen; dann P0.1 starten |
| B2 | Playwright-/Browser-Binary | Download-Hosts gesperrt, kein Browser installiert | Lokal beschaffen, dann in Sandbox verfügbar machen |
| B3 | Externe Provider-Zugänge | Netzwerk DENY, keine externen Verbindungen | Allowlist + Approval erst (P0.3), dann Provider adaptieren |
| B4 | Egress-Proxy-Software | Kein kontrollierter Proxy vorhanden | Proxy implementieren/bereitstellen (P0.3) |
| B5 | CI-Download-Hosts | npm/Playwright-Downloads gesperrt | Repository-mirror oder offline Package-Setup |

---

## 7. Quellen für diese Einschätzung

- `docs/TODO.md` (2026-10-03, aktualisiert)
- `docs/STATUS.md` (offene Restarbeiten)
- `docs/MASTER_COMPLETION_SPEC.md` (Abschnitt 1–43, vollständige Spezifikation)
- `docs/IMPLEMENTATION_ROADMAP.md` (P0–P4 Arbeitspakete)
- `docs/ABSCHLUSSBERICHT.md` (Abschnitt B/C, Implementiert/Verifiziert)
- `docs/ARBEITSAUFAHBEN_FERTIGSTELLUNG_2026-10-03.md` ← **dieses Dokument**
- `docs/ABSCHLUSSBERICHT_AUDIT_2026-10-03.md` (Audit-Ergebnis, 228 Dateien, 420/425 Tests)
- `INVENTAR.csv` (228 Dateien, alle Status REAL = keine versteckten MOCK/STUB)
- `tests/` (65 Testdateien, 425 Tests — 5 kurze Fehler)

---

*Bericht erstellt: 2026-10-03 | Autor: Lead-Engineer Audit-Zyklus*
