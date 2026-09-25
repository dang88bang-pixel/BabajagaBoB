# Gesamtstatus BabajagaBoB

**Stand:** 2026-09-25
**Branch:** `arena/01a0d635-babajagabob`

## Statuslegende

Jede Komponente wird mit einem belegbaren Reifegrad geführt – ohne Prozentzahlen und ohne behauptete
Produktionsreife:

- **ARCHITECTURE** – Vertrag/Typen/Doku vorhanden, Ausführung fehlt
- **IMPLEMENTED** – Code vorhanden, kompiliert, nicht durch Tests belegt
- **INTEGRATED** – im realen Ablauf verdrahtet (Routen/Worker/Broker)
- **TESTED** – durch automatisierte Tests nachgewiesen
- **VERIFIED** – zusätzlich gegen die reale Umgebung ausgeführt und reproduzierbar
- **UNVERIFIED / PARTIAL / BLOCKED** – ausdrücklich offen bzw. nicht prüfbar

## Plattform

| Komponente | Reifegrad | Nachweis / Hinweis |
|---|---|---|
| Control Plane (Mission/Objective/Task) | TESTED | `tests/unit/control-plane.test.ts` |
| Persistenz (Envelope, Digest, atomar) | TESTED | `tests/unit/persistence.test.ts` (Manipulation → fail closed) |
| Authority (Token, TTL, Bindung) | TESTED | `tests/security/authority.test.ts` |
| Bootstrap / Creator-Initialisierung | TESTED | einmaliger Bootstrap, Doppelaufruf verweigert |
| Server-Session + API-Guard | TESTED | `tests/security/api-guard.test.ts`, `tests/security/api-gate.test.ts` |
| Aktionsspezifische Routen-Guards | TESTED | `tests/security/route-guards.test.ts`: 428 vor Bootstrap, 401 ohne Auth, `CREATOR_ONLY` für Agenten-Schreibzugriff auf Provenance/Knowledge, `CAPABILITY_DENIED` für Runs ohne `run:manage`, CSRF-Origin |
| Store-Migration und Reparatur | TESTED | `tests/unit/store-migration.test.ts` (22 Tests): v1→v2 migriert und schreibt v2, Sicherungskopie, Journaleintrag, fehlende Kette oder neuere Datei → fail closed, leerer Envelope (`payload: null`) wird erkannt, als `<datei>.null-payload` gesichert und neu initialisiert, Store-Name im Digest, Backup-Zuordnung ohne Präfixverwechslung (`workshop` vs. `workshop-executions`) |
| Creator Inbox | TESTED | `tests/security/inbox-route.test.ts`: Anlegen (201), Beantworten ausschließlich durch Creator, doppelte Beantwortung abgelehnt, unbekannte Aktion 400, Sessionpflicht; live `GET /api/inbox` 200 (zuvor 500) |
| Routen-Guards je Methode | TESTED | `tests/security/api-route-contract.test.ts` prüft jede exportierte Methode einzeln; sechs GET-Routen (`authority`, `cicd`, `devices`, `governance`, `providers`, `worker`) hatten keinen Guard und sind jetzt `*:read`-geschützt |
| Live-Nachweis über HTTP | VERIFIED | `scripts/verify-live.sh`: **176 Prüfungen / 0 Fehler** gegen `npx next start` (frisch initialisiert, 2026-09-25; **169** bei bereits initialisierter Instanz; ohne cgroup-Delegation **168 / 166**; mit zweitem Faktor **177 / 175**), jeweils mit aktiver Kernel-Isolation und durchgesetzten Ressourcenlimits; alle drei §49-Abnahmen, Agentenweg über Capability-Token ohne Browser-Session, **Evidenz einer blockierten Autorisierung** (`kind=DENIAL`, Digest erneut geprüft, keine Klartext-Argumente), **Replay-Verweigerung** (zweiter Lauf mit demselben Token → 409 + Evidenz), **gemessene Kernel-Isolation** (Schritt 11), **Lockdown blockiert auch interne Läufe** (Schritt 7: `fix.verify` → 409 + Gate-Grund, nach Freigabe bestanden) und **TOTP live** (Schritt 12: Pflicht, Ablehnung, Akzeptanz, Replay) |
| Ressourcenlimits (kernel-seitig) | VERIFIED | `RLIMIT_CPU` (CPU-Zeit) und `RLIMIT_FSIZE` (Dateigröße) werden je Ausführung im Wrapper gesetzt; Überschreitung beendet den Prozess bzw. liefert `EFBIG` (Datei an der Grenze abgeschnitten). Speicher/Prozesse über delegierten cgroup-v2-Unterbaum (`BOB_CGROUP_DIR`) — dann `CGROUP_MEMORY_LIMIT`/`CGROUP_PIDS_LIMIT` in `isolation.enforced[]`; ohne Delegation `UNAVAILABLE`, und das wird so gemeldet. Limits sind über `POST /api/sandboxes {limits}` (Creator) setzbar und werden gegen `MAX_RESOURCE_LIMITS` geprüft. Tests: `tests/integration/ns-isolation.test.ts`; live: `verify-live.sh` Schritt 11 |
| Kernel-Isolation der Ausführung (`NAMESPACES`) | VERIFIED | `lib/ns-isolation.ts` + `scripts/ns-exec.sh`; Rootfs über `bash scripts/build-ns-rootfs.sh` (126 MB, Node + BusyBox). Gemessen im isolierten Prozess: `CapBnd`/`CapEff` = `0000000000000000`, `NoNewPrivs` = 1, 1 sichtbarer Prozess, Rootfs `EROFS`, `/work` schreibbar, nur `lo`, leere Routingtabelle. Belegt durch `tests/integration/ns-isolation.test.ts` (7 Tests) und `verify-live.sh` Schritt 11 |
| Capability-Token: Wiederholungssperre | TESTED | `lib/authority.ts` (`maxUses` Standard 1, `consumeCapabilityToken` **vor** der Ausführung); zweiter Lauf → 409 + Audit-DENY + `DENIAL`-Evidenz; Gate/Route prüfen nur vor (`precheckCapabilityToken`), entschieden wird im Broker; `tests/security/token-replay.test.ts` (5 Tests) |
| Backup mit Digest-Prüfung | TESTED | `tests/integration/metrics-backup.test.ts`: Kopien unter `<BOB_STORAGE_DIR>/backups` (0600), manipuliertes Backup → 409, Restore nur nach Version-/Digest-Prüfung |
| Backup-Automation (geplanter Lauf + Aufbewahrung) | TESTED | `lib/backup-policy.ts`: idempotenter Lauf (`BOB_BACKUP_INTERVAL_MS`, Vorgabe 1 h), Aufbewahrungsgrenze je Store (`BOB_BACKUP_KEEP`, Vorgabe 5) — es werden **nur** verifizierte Kopien jenseits der Grenze gelöscht, **nie** die neueste oder einzige; beschädigte Sicherungen werden gemeldet statt gelöscht; `POST /api/persistence {action:"backup.run"\|"backup.prune"}`, Store `backup-automation`, Ereignis + Audit je Lauf, UI-Panel unter Betrieb/Persistenz; `tests/integration/backup-automation.test.ts` (9 Tests). Ohne Scheduler-Daemon bleibt der Auslöser extern (`NOT_VERIFIED`) |
| Geräte-Registrierung (Enrollment) | TESTED | `lib/device-enrollment.ts` + `scripts/discover-host.mjs`: Discovery-Dienst meldet sich mit `BOB_DEVICE_ENROLLMENT_SECRET` (nur `enroll`/`heartbeat`), fail closed ohne Geheimnis, Konstantzeitvergleich, **kein** Selbst-Grant (Autorisierung bleibt Creator-Akt), Lebenszeichen ändert keine Rechte, enge Kennungsvalidierung; `tests/security/device-enrollment.test.ts` (8 Tests) |
| Service-Level / SLO-Bewertung | TESTED | `lib/slo.ts` + `GET/POST /api/slo`: zehn Messgrößen mit Zielwert, Warn- und kritischer Grenze gegen den echten Zustand (Warteschlange, Stores, Sicherungen, Readiness, Verweigerungen, Isolation, Audit-Kette, Agenten-Heartbeats); fehlender Messwert = `UNKNOWN` (nie „gesund“); `evaluate` meldet `BLOCK`/`ASK` in die Creator-Inbox, repariert aber nichts; UI-Abschnitt „Service-Level“; `tests/unit/slo.test.ts` (9 Tests), `audit-actions.mjs`-Kette, `audit-ui.mjs` B3. Bewertete Momentaufnahme der Frischinstanz: 9 gesund / 1 gewarnt / 0 verletzt / 0 ohne Messwert. Dauerbetrieb/SLO-Zusage bleibt `NOT_VERIFIED` |
| Betriebsmetriken (Prometheus-Text) | TESTED | `GET /api/metrics` (Session-pflichtig): Store-Integrität, Audit-Kette, Runs, Queue, Token, Incidents, Recovery, Wissen, Fabric, Kill Switches – nur Zahlen |
| Control Center (39 Abschnitte) | TESTED | `tests/ui/control-center.test.tsx` (vollständige Navigation, echte Daten, Anmeldemaske) und `tests/ui/control-center-api.test.tsx` (35 echte Routen-Handler, Metriken als Prometheus-Text, Secrets ohne Lesezugriff); jede Seite ist an eine reale Serverroute gebunden, leer = „keine Einträge“, fehlend = „nicht verfügbar“; live alle Routen mit 200 geprüft |
| Routenvertrag (strukturell) | TESTED | `tests/security/api-route-contract.test.ts`: jede Route außer `/api/auth` prüft eine konkrete Aktion, kein `publicAction` |
| API-Grenze (Middleware + Auth-Route) | TESTED | `middleware.ts`, `lib/api/api-gate.ts`, `app/api/auth/route.ts`; Creator-Login mit Sperre; live verifiziert (428/201/200/403) |
| Governance / Kill Switches | TESTED | `tests/security/route-guards.test.ts`, `tests/security/direct-route-denial.test.ts` und Live-Nachweis (Kill Switch blockiert Ausführung 409, Freigabe hebt Block auf) |
| Agent Fabric (11 Rollen, Autonomie-Vertrag) | TESTED | `tests/unit/agent-fabric.test.ts`: 11 Rollen aus der Control Plane, keine Selbstvergabe/Produktion/Infrastruktur, Heartbeat und Handoffs |
| Execution Gate + Broker | TESTED | `tests/e2e/*`, `tests/security/argv-policy.test.ts`, `tests/integration/load-broker.test.ts` (12 parallele Ausführungen, 6 verweigerte Fremdbindungen) |
| Sandbox Fabric (Task-/Agent-Bindung) | TESTED | `tests/integration/sandbox-runtime.test.ts` |
| Lokale Runtime (`REAL_LOCAL`) | TESTED | echte Prozesse, `argv[]`, `shell:false`, Timeout-Kill |
| Apps / App-Module | TESTED | Modul-Sandbox über die Fabric gebunden (Task+Agent), `tests/integration/app-module-sandbox.test.ts` |
| argv-Policy (keine Shell-Strings) | TESTED | `lib/argv-policy.ts`, Broker-DENY + Runtime-Enforcement |
| OCI Runtime (`REAL_OCI`) | UNVERIFIED | kein Docker/Podman in der Umgebung (apt-/Registry-/Release-Zugriff gesperrt); Härtungsflags ungeprüft. Ersatzweise **kernel-seitige** Isolation als `NAMESPACES` umgesetzt und gemessen — bewusst **nicht** als `CONTAINER` bezeichnet |
| Task Queue / Runs | IMPLEMENTED | Lease/Retry/Dead-Letter, kein eigener Test |
| Worker / Dispatcher | IMPLEMENTED | `worker.cycle` getestet indirekt nicht; kein eigener Test |

## Lernen / Wissenschaft

| Komponente | Reifegrad | Nachweis / Hinweis |
|---|---|---|
| Experiment Engine (Baseline/Control/Replikation) | IMPLEMENTED | Kausalvalidierung vorhanden, kein eigener Test |
| Evidence Store | TESTED | `tests/e2e/failure-recovery.test.ts` (Evidenzpflicht) |
| Knowledge Graph (4 Schichten, negatives Wissen) | TESTED | Negatives Wissen nach Fehlerfall, `ESTABLISHED` verlangt Evidenz + Verifikation |
| Error Intelligence (Lifecycle bis `REGRESSION_LOCKED`) | TESTED | vollständige Kette in `tests/e2e/failure-recovery.test.ts` |
| Regression Engine | TESTED | echte Prozessausführung, Pass/Fail, leere Suite = fail closed |

## Recovery

| Komponente | Reifegrad | Nachweis / Hinweis |
|---|---|---|
| Failure Records | TESTED | Status `VERIFIED` erst nach Verifikation |
| Recovery Plan (Tier, Schritte, Verifikationsplan) | TESTED | Tier wird automatisch aus dem Fehlerbild abgeleitet (`lib/recovery-tier.ts`), `EXECUTING` → `VERIFIED` inkl. Snapshot-Restore; Stufe 4/5 nur mit Creator-Freigabe |
| Snapshot / Restore (echter Workspace, SHA-256) | TESTED | Digest-Prüfung, Restore-Verifikation |
| Recovery-Verifikation | TESTED | ohne Snapshot/Regression kein `ACCEPT` |

## Infrastruktur

| Komponente | Reifegrad | Nachweis / Hinweis |
|---|---|---|
| Audit Store (Kette + Aufbewahrung) | TESTED | `verifyAuditChain()` in mehreren Suiten; `tests/unit/audit-retention.test.ts`: append-only ohne Kürzung, Kürzung nur mit Checkpoint, Rekonstruktion des Kopfes bei Altbeständen, Datei- und Ketten-Manipulation erkannt |
| Event Store (append-only, kausal) | TESTED | `tests/e2e/failure-recovery.test.ts` prüft Eventtypen |
| Provenance | TESTED | Kanten im E2E-Erfolgspfad und im Live-Lauf (§4a in `docs/TESTING.md`); Schreibzugriff ist Creator-Aktion |
| Privacy / Data Boundary | TESTED | default `DENY`, live geprüft (`GET /api/privacy`: Policy, Regeln, Grenze, kein Silent-Telemetry/Tracking/Advertising) |
| Provider Fabric | TESTED | Katalog/Bindungen/Telemetrie persistent, Approval-gebundene Verbindung (`tests/integration/provider-fabric.test.ts`) |
| Device Fabric / Computer Use | PARTIAL | persistent; Computer Use in `tests/integration/computer-use.test.ts` (Registrieren **erzwingt** unauthorisiert, Autorisierung nur durch Creator, danach Allocation); Geräte-Discovery über selbstmeldenden Enrollment-Agenten (`scripts/discover-host.mjs`, fail closed, ohne Selbst-Grant). Offen: aktiver Netz-Scan und Attestierung sind `NOT_IMPLEMENTED` |
| Simulation / Visualisierung | TESTED | Szenarien persistent (`lib/simulation.ts`); Renderer `lib/visualization.ts` erzeugt SVG aus dem echten Zustand (7 Arten), `assertPassiveSvg` verhindert aktive Inhalte, Größenlimit sichert vollständige Evidenzartefakte; Oberfläche zeigt Vorschau, Artefakt-ID, Digest und erneute Prüfung; `tests/integration/visualization.test.ts` (11 Tests), `scripts/audit-actions.mjs` rendert jede Art |
| CI/CD (`ci.yml`) | TESTED | 5 Jobs (Lint/Typecheck, Unit/Integration/Regression, Security/E2E, Build, Promotion-Gate); grüne Läufe dokumentiert in `docs/CI_CD.md` |
| Automatisierte Testsuiten | TESTED | **48 Dateien / 294 Tests grün** (Unit 66, Security 106, Integration 88, Regression 14, UI 12, E2E 8), siehe `docs/TESTING.md` |
| Betriebsprüfung aller Routen | VERIFIED | `scripts/audit-api.sh`: **204 Prüfungen / 0 Fehler**, Exit 0 (8 Abschnitte, wiederholbar; Routen mit Pflichtparametern werden als 4xx korrekt bewertet); siehe `docs/TESTING.md` §4b |
| Alarmierung (Regeln) | TESTED | `lib/alerting.ts`: 16 Regeln im Code, bei jeder Abfrage gegen die **real ausgelieferten** Kennzahlen geprüft (unbekannte Kennzahl → Regel ungültig, YAML-Ausgabe 500 = fail closed); `GET /api/alerts[?format=prometheus]`, sichtbar unter Metriken → Alarmregeln; `tests/integration/alerting.test.ts` (8 Tests) |
| Oberflächenprüfung des Control Centers | VERIFIED | `scripts/audit-ui.mjs`: **88 Prüfungen / 0 Fehler**, Exit 0 — Quellvertrag, Auslieferung, Visualisierungs-Bildroute (passives SVG) und Datenvertrag je Abschnitt, kein Geheimnis im Browser; siehe `docs/TESTING.md` §4d |
| Vollständige Aktions-/Attributprüfung | VERIFIED | `scripts/audit-actions.mjs`: **502 Prüfungen / 0 Fehler**, Exit 0 — Matrix aus dem Quellcode, Robustheit je Aktion, Attributtypen, 14 Interaktionsketten bis `REGRESSION_LOCKED` inkl. aller Visualisierungsarten; siehe `docs/TESTING.md` §4c |
| Kein Ausführungspfad um den Broker | VERIFIED | `lib/system-execution.ts`: Regression und Smoke-Test laufen als SYSTEM-WORKER über Gate, Broker, Replay-Sperre und Evidenz (Capability aus `CREATOR → SYSTEM-WORKER`, Zweck `REGRESSION`/`SMOKE_TEST` im Ereignis); Kill Switch blockiert sie, ohne Delegation wird nichts ausgeführt; `tests/security/gate-bypass.test.ts` + live in `scripts/verify-live.sh` Schritt 7 |
| Systemausstellung ohne Replay | TESTED | `ensureExecutionCapability` gibt kein erschöpftes Token mehr heraus (`uses < maxUses`), sonst hätte der Broker den Folge lauf als Replay verweigert; Test in `tests/security/authority.test.ts` |

## Aktuelle Sicherheitsgrenzen

1. Kein GUI-direkter Shell-Zugriff; jede Ausführung läuft über Gate und Broker.
2. Task, Agent und Sandbox müssen zusammenpassen; Fremdbindung ist ein Fehler.
3. Capability Token muss zu Subjekt, Task, Sandbox, Umgebung und Risiko passen.
4. Selbstvergabe, Wildcards, TTL-Überschreitung und Risk-Eskalation sind verboten.
5. Kill Switch blockiert Execution; Freigabe nur durch CREATOR.
6. Netzwerk ist standardmäßig deaktiviert; `ALLOWLIST` ist fail closed.
7. Shell-Interpreter und Shell-Metazeichen sind in jedem `argv`-Element verboten.
8. Legacy-Administrationstoken ist standardmäßig deaktiviert und nie Creator.
9. OCI-Nutzung ohne Shell-Interpolation; Härtungsflags unverifiziert. Ist `BOB_NS_ISOLATION=on` gesetzt,
   wird ohne verfügbare Kernel-Isolation **nichts** ausgeführt (fail closed, HTTP 409).
10. Geschützte Daten gehen nicht implizit an externe Provider.

## Offene Restarbeiten (faktisch, ohne Wertung)

- Aktionsspezifische `guardRequest`-Prüfungen für die restlichen, noch nicht verdrahteten Routen ergänzen
  (Kern- und Schreibpfade sind verdrahtet, übrige Routen sind über die Middleware fail closed).
- OCI-Runtime gegen einen echten Daemon verifizieren (`REAL_OCI`); solange das nicht möglich ist, gilt
  die gemessene Stufe `NAMESPACES` (kein Image-Format, kein `runc`).
- Ressourcenlimits kernel-seitig: CPU-Zeit (`RLIMIT_CPU`) und Dateigröße (`RLIMIT_FSIZE`) sind immer
  aktiv; Speicher und Prozesse werden über einen delegierten cgroup-v2-Unterbaum (`BOB_CGROUP_DIR`)
  durchgesetzt und sind ohne ihn `UNAVAILABLE` (nicht behauptet). Beleg:
  `tests/integration/ns-isolation.test.ts` (11 Tests).
- Browser-/UI-E2E für das Control Center.
- §44-Dokumente sind vollständig (14 Dateien): `SECURITY.md`, `AUTHORIZATION.md`, `SANDBOX.md`,
  `RUNTIME.md`, `EXPERIMENTS.md`, `RECOVERY.md`, `KNOWLEDGE.md`, `PROVIDERS.md`, `DEVICES.md`,
  `COMPUTER_USE.md`, `CI_CD.md`, `TESTING.md`, `OPERATIONS.md`, `BOOTSTRAP.md`; Abschlussbericht:
  `docs/ABSCHLUSSBERICHT.md` (Struktur A–L).

Eine Produktionsreife-Aussage wird bewusst nicht getroffen; maßgeblich sind die oben belegten Reifegrade.
