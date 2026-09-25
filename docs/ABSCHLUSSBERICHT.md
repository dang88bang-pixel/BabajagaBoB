# Abschlussbericht (Abschnitt 50, Struktur A–L)

**Stand:** 2026-09-25
**Branch:** `arena/01a0d635-babajagabob`
**Bewertungsmaßstab:** `PASS | PARTIAL | FAIL | NOT_IMPLEMENTED | NOT_VERIFIED`
**Grundlage:** dieser Bericht beschreibt ausschließlich, was im Repository
nachweisbar ist (Code, Tests, CI-Läufe, Live-Nachweis). Produktionsreife wird
nicht behauptet.

---

## A. Auftrag und Vorgehen

Der Auftrag war der vollständige Aufbau einer autonomen Agentenplattform entlang
der Kette

```
Creator → Mission → Objective → Task → Agent → Authorization → Sandbox →
Experiment/Execution → Evidence → Validation → Audit → Provenance → Knowledge →
Recovery
```

mit den Leitprinzipien `Creator Authority > Agent Authority`,
`Safety/Governance > Agent Objective`, `Evidence > Assumption`,
`Verification > Assertion`, `Fail Closed > Unsafe Execution`.

Vorgehen je Abschnitt: analysieren → implementieren → typecheck → testen →
integrieren → Security prüfen → dokumentieren → committen → Status aktualisieren.
Fehler wurden nach `REPRODUCE → TRIAGE → ROOT CAUSE → FIX → REGRESSIONSTEST →
VERIFY` behandelt; Tests wurden nie abgeschwächt, um grün zu werden.

## B. Implementiert (PASS)

| Bereich | Aussage | Belege |
|---|---|---|
| Control Plane | Mission, Objective, Task, Agent-Zuweisung, Approval, Lockdown persistent; alles über HTTP schreibbar | `lib/control-plane.ts`, `app/api/missions`, `app/api/tasks`, `tests/unit/control-plane.test.ts` |
| Persistenz | kanonischer Store mit Envelope (Version + SHA-256-Digest), atomarem Schreiben (tmp `0600` + rename), Manipulationserkennung | `lib/persistence/store.ts`, `tests/unit/persistence.test.ts` |
| Autorisierung | Capability-Token mit TTL-/Bindungs-/Risikogrenzen, RBAC/ABAC, kein Selbstausstellen, keine Wildcards | `lib/authority.ts`, `tests/security/authority.test.ts` |
| API-Grenze | jede `/api/*`-Route außer `/api/auth` verlangt Session; agentenspezifischer Sonderweg nur `POST /api/runtime`; CSRF-Origin-Prüfung; Legacy-Token fail closed | `middleware.ts`, `lib/api/api-gate.ts`, `tests/security/api-guard.test.ts`, `tests/security/api-gate.test.ts` |
| Aktionsprüfung pro Route | **jede** Route außer `/api/auth` prüft ihre konkrete Aktion (Creator-Pflicht für Kern-/Schreibpfade, `sandbox:run`, `task:execute`, `run:manage`; Provenance-/Knowledge-Schreiben nur Creator); strukturell im Test erzwungen | `lib/api/guard.ts`, `app/api/*/route.ts`, `tests/security/route-guards.test.ts`, `tests/security/api-route-contract.test.ts` |
| Betriebsmetriken | Prometheus-Text unter `GET /api/metrics` (Session-pflichtig), aus Stores/Integritätsprüfungen, nur Zahlen | `lib/metrics.ts`, `tests/integration/metrics-backup.test.ts` |
| Datenintegrität (aus Live-Prüfung) | **gefundener Fehler behoben:** der Backup-Pfad legte für noch nie beschriebene Stores einen Envelope mit `payload: null` und gültigem Digest an; `/api/inbox` lieferte dadurch 500. Jetzt: Schreiben von `null` wird verweigert, Lesen erkennt und repariert den Zustand (journalliert), `POST /api/persistence {action:"repair"}` saniert alle Stores (auditiert) | `lib/persistence/store.ts`, `app/api/persistence/route.ts`, `tests/unit/store-migration.test.ts` |
| Control Center an echte Daten | Alle **38 Abschnitte** gebunden; die Bereiche aus §26 der Spezifikation sind vollständig enthalten (Dashboard→Übersicht, Artifacts→Evidenz, Activity/Timeline/Replay→Timeline / Replay, Deployments→CI/CD-Pipeline, Settings→Betrieb/Persistenz); leer = „keine Einträge“, fehlend = „nicht verfügbar“; live alle 35 Routen mit 200 geprüft | `components/control-center.tsx`, `tests/ui/control-center.test.tsx`, `tests/ui/control-center-api.test.tsx` |
| Supply Chain | GitHub-Actions auf Commit-SHAs gepinnt (checkout v4.3.0, setup-node v4.4.0) | `.github/workflows/ci.yml` |
| Creator Inbox | `POST {action:"resolve"}` war unerreichbar (stand hinter einem `return`): jede Anfrage legte einen neuen Eintrag an. Jetzt eigener Zweig, Creator-Pflicht, Validierung, Ablehnung doppelter Beantwortung | `app/api/inbox/route.ts`, `tests/security/inbox-route.test.ts` |
| Ausführungs-Evidenz | jede autorisierte Ausführung erzeugt einen **digestgebundenen, persistenten** Evidenzdatensatz (`ART-…`, SHA-256 über den gespeicherten Inhalt), verknüpft in Provenance (Knoten `EVIDENCE` + Kante) und Audit (`evidence.record` mit Digest); `GET /api/artifacts?verify=…` prüft erneut; Inhalte > 8 KiB werden sichtbar gekürzt (`truncated`) | `lib/artifacts.ts`, `lib/execution-broker.ts`, `tests/integration/execution-evidence.test.ts` |
| Schema-Migration | registrierte Migration je Store: Digest-Prüfung → Sicherungskopie `*.pre-v{N}.bak` (0600) → Migration → Journal `migrations.jsonl`; fehlende Kette oder neuere Datei → fail closed; ältere Sicherungen werden als migrierbar erkannt und migrierend wiederhergestellt | `lib/persistence/store.ts`, `lib/creator-auth.ts`, `tests/unit/store-migration.test.ts` |
| Zweiter Faktor | TOTP (RFC 6238) über `BOB_CREATOR_TOTP_SECRET`: gesetzt ⇒ **verpflichtend** (403 `TOTP_REQUIRED`), Fenster ±1 × 30 s, Replay-Schutz über `totpUsedSteps`, Lockout unverändert 423, Status über `GET /api/auth` (`secondFactor`); **live über HTTP nachgewiesen** (Schritt 12: Pflicht, Ablehnung ohne/mit falschem Code, Akzeptanz, Replay-Ablehnung; drei aufeinanderfolgende Läufe ohne Sperre) | `lib/totp.ts`, `lib/creator-auth.ts`, `app/api/auth/route.ts`, `tests/security/creator-totp.test.ts`, `scripts/verify-live.sh` |
| Persistenz aller Betriebszustände | CI/CD-Pipelines, Skills, Werkstatt-Objekte, Werkstatt-Läufe und Agenten-Übergaben sind persistent (zuvor nur im Speicher); Nachweis durch Neuladen der Laufzeit | `lib/cicd.ts`, `lib/skills.ts`, `lib/workshop*.ts`, `lib/agent-fabric.ts`, `tests/unit/runtime-persistence.test.ts` |
| Backup/Wiederherstellbarkeit | digest-/versionsgeprüfte Kopien unter `<BOB_STORAGE_DIR>/backups`, Restore nur nach Prüfung, manipuliert → 409 | `lib/persistence/store.ts`, `app/api/persistence/route.ts`, `tests/integration/metrics-backup.test.ts` |
| Creator-Zugang | einmaliger Bootstrap, danach Login mit server-seitigem Secret (Datei 0600 oder Env), Konstantzeitvergleich, Sperre nach 5 Fehlversuchen (423, 15 min), Rotation | `lib/bootstrap.ts`, `lib/creator-auth.ts`, `app/api/auth/route.ts`, `tests/security/creator-login*.test.ts` |
| Execution Gate + Broker | 17 Preflight-Prüfungen (Request-Form, argv-Policy, Task/Agent/Sandbox-Bindung, Risiko, Token, Umgebung, Kill Switches, Approval, Netzwerk, Limits) mit Audit + Observation je Verweigerung | `lib/execution-gate.ts`, `lib/execution-broker.ts`, `tests/e2e/creator-flow.test.ts` |
| argv-Policy | kein Shell-String: `spawn(argv, {shell:false})`; Shell-Interpreter und Metazeichen in jedem Argument verboten, in Broker **und** Runtime erzwungen | `lib/argv-policy.ts`, `lib/runtime-local.ts`, `tests/security/argv-policy.test.ts` |
| Sandbox-Fabric | Task-/Agent-Bindung, Lebenszyklus, Clone, echte Workspace-Snapshots mit SHA-256-Digest, Restore mit Digest-Prüfung | `lib/sandbox/fabric.ts`, `tests/integration/sandbox-runtime.test.ts` |
| Lokale Runtime | echte Kindprozesse in eigener Prozessgruppe, reduziertes Environment, Timeout mit Gruppen-Kill, Netzwerk default `DENY`, `ALLOWLIST` fail closed | `lib/runtime-local.ts`, `tests/integration/sandbox-runtime.test.ts` |
| Experiment-Engine | Baseline/Kontrolle/Replikation, Evidenzpflicht, neunstufige Kausalprüfung mit Gründen und Wissenszustand | `lib/science.ts`, `tests/e2e/failure-recovery.test.ts` |
| Error Intelligence | `DETECTED → DIAGNOSING → EXPERIMENTING → ROOT_CAUSE_FOUND → FIXING → VERIFYING → LEARNED → REGRESSION_LOCKED` inkl. Diagnosesandbox, Evidenzpflicht und idempotenter Fix-Verifikation | `lib/error-intelligence.ts`, `app/api/errors/route.ts` |
| Recovery | **automatische, begründete Stufenklassifikation** (Tier 1–5, `requiresCreatorApproval` ab Stufe 4), Checkpoint, Restore, Verifikation mit echten Smoke-/Regressionstests, `REJECTED` statt Scheinerfolg | `lib/recovery-tier.ts`, `lib/reliability.ts`, `tests/unit/recovery-tier.test.ts`, `docs/RECOVERY.md` |
| Regression Engine | registrierte `argv[]`-Tests, PASS/FAIL, leere Suite = Fehlschlag, Persistenz | `lib/regression.ts`, `tests/regression/regression-engine.test.ts` |
| Knowledge/Memory | vier Schichten, sieben Zustände, Kanten, negatives Wissen („Never Again") erst nach verifiziertem Fix | `lib/knowledge.ts`, `docs/KNOWLEDGE.md` |
| Agent Fabric | 11 Rollen aus der Control Plane mit Autonomie-Vertrag; kein Agent darf Autorität, Produktion oder Infrastruktur | `lib/agent-fabric.ts`, `tests/unit/agent-fabric.test.ts` |
| Provider Fabric | entdecken ≠ verbinden; Verbindung nur mit freigegebener Approval; Bindungen mit expliziten Fähigkeiten; Widerruf deaktiviert Bindungen | `lib/provider-fabric.ts`, `tests/integration/provider-fabric.test.ts` |
| Privacy/Data Boundary | default `DENY`, `METADATA_ONLY` verweigert geschützte Datenklassen an Dritte; Secret-Leases mit TTL und `redact()` | `lib/privacy.ts`, `lib/data-boundary.ts`, `lib/secrets.ts` |
| Device Fabric | Discovery ≠ Autorisierung, Zustandsmaschine, Allocation nur für autorisierte Geräte | `lib/devices.ts` |
| Computer Use | Registrieren ≠ Autorisieren, Allocation nur nach Creator-Freigabe, Netzwerk `DENY` | `lib/computer-use.ts`, `tests/integration/computer-use.test.ts` |
| Audit/Provenance/Timeline | verkettetes Audit (`verifyAuditChain`, HMAC mit Schlüssel), append-only Events, kausale Provenance-Kanten, **Aufbewahrung ohne falschen Alarm** (keine Kürzung ohne `BOB_AUDIT_MAX_RECORDS`; Kürzung nur mit Checkpoint, Rekonstruktion ausgewiesen) | `lib/audit.ts`, `lib/events/log.ts`, `lib/provenance.ts` |
| CI/CD | 5 Jobs mit Gate; Promotion nur mit bestandenen Checks, Smoke-Stufe und Creator-Approval | `.github/workflows/ci.yml`, `lib/cicd.ts`, `lib/promotion.ts` |
| Dokumentation | 14 §44-Dokumente auf Deutsch, code- und nachweiskonform | `docs/*.md` |

## C. Verifiziert (PASS)

| Nachweis | Ergebnis |
|---|---|
| Automatisierte Tests | **35 Dateien / 212 Tests grün** (`npx vitest run`; Unit 53, Security 89, Integration 55, Regression 5, UI 6, E2E 4) |
| Betriebsprüfung aller Routen | `scripts/audit-api.sh`: **184 Prüfungen / 0 Fehler** (Exit 0), 6 Abschnitte inkl. autonomer Fehlerkette; wiederholbar gegen dieselbe Instanz |
| Vollständige Aktions-/Attributprüfung | `scripts/audit-actions.mjs`: **433 Prüfungen / 0 Fehler** (Exit 0) — Matrix aus dem Quellcode (38 POST-Routen, 116 Aktionen), Attributtypen, 14 Interaktionsketten bis `REGRESSION_LOCKED` |
| Statische Gates | `npx tsc --noEmit` fehlerfrei; `npx eslint .` 0 Fehler (10 Warnungen); `npm run build` erfolgreich (Exit-Code geprüft, nicht nur Ausgabe) |
| Live über HTTP | `scripts/verify-live.sh` gegen `npx next start`: **171 PASS / 0 FAIL** (frisch initialisiert; 169 bei bereits initialisierter Instanz; ohne cgroup-Delegation 168 / 166; mit verpflichtendem zweitem Faktor 177 / 175), jeweils mit aktiver Kernel-Isolation und durchgesetzten Ressourcenlimits – Auth fail closed (428/401/403/201/200), Kette bis Knowledge, Sandbox + Snapshot + Capability, autorisierte Ausführung (`argv`, stdout `live-ok`), Angriffsblockaden mit Audit, Fehlerkette bis `REGRESSION_LOCKED`, Lockdown/Privacy/Provider/Geräte, Restore/Persistenz/Readiness, **Schritt 10: Agentenweg über Capability-Token ohne Browser-Session**, **Evidenz der blockierten Autorisierung** (`kind=DENIAL`, Digest erneut geprüft, ohne Klartext-Argumente), **Replay-Verweigerung** (zweiter Lauf mit demselben Token → 409 + Evidenz), **Schritt 11: kernel-gemessene Isolation** (`CapBnd`/`CapEff` = 0, `NoNewPrivs` = 1, `EROFS`, nur `lo`, leere Routingtabelle) und **Schritt 12: zweiter Faktor live** (Pflicht, Ablehnung ohne/mit falschem Code, Akzeptanz, Replay-Ablehnung) |
| Ressourcenlimits | kernel-seitig: CPU-Zeit (`RLIMIT_CPU`) und Dateigröße (`RLIMIT_FSIZE`) immer, Speicher und Prozesse über delegierten cgroup-v2-Unterbaum (`BOB_CGROUP_DIR`); ohne Delegation `UNAVAILABLE` statt Behauptung; Limits per `POST /api/sandboxes {limits}` setzbar (Creator, gegen Obergrenzen geprüft) |
| Kernel-Isolation der Ausführung | `NAMESPACES` (real gemessen): User-/Netzwerk-/PID-/IPC-/UTS-/Mount-Namespace, Rootfs `EROFS`, nur `/work` schreibbar, leeres Capability-Bounding-Set, `NoNewPrivs` = 1; `scripts/build-ns-rootfs.sh` (126 MB), `lib/ns-isolation.ts`, `scripts/ns-exec.sh`; `BOB_NS_ISOLATION=on` verweigert ohne Rootfs jede Ausführung (fail closed) |
| §49-Abnahme 1 (Erfolgspfad) | `tests/e2e/creator-flow.test.ts` + Live-Schritte 2–4 |
| §49-Abnahme 2 (bewusster Fehler) | `tests/e2e/failure-recovery.test.ts` (Exit-Code 7) + Live-Schritt 6 |
| §49-Abnahme 3 (blockierter Angriff) | fremder Sandbox-Bindungsversuch 409, unbekanntes Token 409, Shell-Programm/-Metazeichen 409, Audit-DENY + Evidenz; `tests/e2e/creator-flow.test.ts` Test 2, Live-Schritt 5 |
| Kein Ausführungspfad um den Broker | Regression und Smoke-Test laufen über `lib/system-execution.ts` als SYSTEM-WORKER durch Gate, Broker, Replay-Sperre und Evidenz (Kill Switch blockiert sie; ohne `CREATOR → SYSTEM-WORKER` wird nichts ausgeführt; Zweck im Ereignis); `tests/security/gate-bypass.test.ts`, Live-Schritt 7 |
| Gefundene und behobene Fehler (Aktions-/Attributprüfung) | **Inhaltslose Mission:** `createMission` akzeptierte leeren Titel/Ziel und legte eine Mission mit `title:""`, `objective:""` an (201) — jetzt Pflichtfelder in Bibliothek **und** Route (400). **Stille No-Ops bei Secrets:** `validate`/`revoke`/`redact` bestätigten ohne Kennung bzw. Wert mit 200 (`lease:null`, `revoked:false`, leerer Wert) — jetzt 400; die Lease-Kennung aus der eigenen Ausgabe (`lease.id`) wird von `validate`/`revoke` zusätzlich zu `leaseId` akzeptiert. **Unbekannte Rolle:** `roleAllows` warf einen TypeError aus dem Rechte-Modul (als 400 durchgereicht) — jetzt fail closed (`false`) und in der Route ein Klartext-400 mit Rollenliste. **`runs.start` unbenutzbar:** ein über die API angelegter Lauf war `CREATED`, `startRun` verlangte `LEASED` → "invalid run transition CREATED -> RUNNING"; die Route führt jetzt Queue und Lease mit aus. **`root_cause` verlangte `evidenceIds`** (weil `stringArray` bei fehlendem Feld wirft), obwohl die Bibliothek die Evidenz des Incidents zusammenführt — Feld ist optional, die Nachweispflicht bleibt. Jeder Fix mit Regressionstest und Live-Nachweis | `lib/control-plane.ts`, `lib/authority.ts`, `app/api/{missions,secrets,capabilities,runs,errors}/route.ts`, `tests/unit/control-plane.test.ts`, `tests/security/{input-validation,authority}.test.ts` |
| Gefundene und behobene Fehler (Worker/Recovery-Kette) | **Lease fehlte:** `runWorkerCycle` startete Runs direkt aus `QUEUED`, `startRun` warf `invalid run transition QUEUED -> RUNNING` — die Ausnahme brach den **gesamten** Zyklus ab, alle weiteren Jobs blieben unbearbeitet; jetzt Lease (`QUEUED → LEASED → RUNNING`) und Job-Kapselung mit `jobFailures`-Meldung. **Unvollständige Fehlerkette:** der Worker sprang aus `DIAGNOSING` direkt nach `FIXING` (`invalid error transition DIAGNOSING -> FIXING`) — jetzt führt `establishRootCauseFromFailure` Hypothese → Experiment → Evidenz → Root Cause. **Retry nach der Verifikation:** `scheduleRetry` lief aus `VERIFYING` (`invalid run transition VERIFYING -> QUEUED`) — jetzt wird der Job stattdessen zurückgestellt (`deferJob`, Versuch bleibt unverbraucht, wachsende Wartezeit), und Läufe in Behandlung werden nicht erneut gestartet. **Pflichtfelder:** `/api/reliability` antwortete auf fehlendes `id` mit „recovery plan not found" statt 400. Jeder Fix mit Regressionstest und Live-Nachweis | `lib/worker.ts`, `lib/queue.ts`, `lib/error-intelligence.ts`, `app/api/reliability/route.ts`, `tests/integration/worker-recovery.test.ts` |
| Gefundene und behobene Fehler (ältere Runden) | Upgrade-Blocker (Schemaerhöhung sperrte die Anmeldung aus, 500 → 201 nach Migration), Broker-Bypass für interne Läufe (Regression/Smoke liefen an Gate und Evidenz vorbei), erneute Ausgabe erschöpfter System-Token, Store-Vergiftung (`payload: null`), unerreichbarer Inbox-`resolve`-Zweig, fehlende Umgebungsbindung des Agentenwegs (`/api/runtime` erzwang `development`), ungeschützte GET-Methoden in sechs Routen, **Audit-Kürzung ohne Checkpoint** (falscher Alarm `sequence gap`/`chain break`, live gefunden → Checkpoint + Rekonstruktion), **Verweigerungsevidenz fehlte** (§49 verlangt Nachweis, nicht nur Log) — jeder Fix mit Regressionstest |
| Begrenzter Lastnachweis | `scripts/soak.mjs` (echte HTTP-Oberfläche, Kernel-Isolation aktiv): 2 × 120 autorisierte Ausführungen, 0 Fehler; p50 1,31 s / p95 2,33 s bei Nebenläufigkeit 4, p50 4,84 s / p95 6,66 s bei 8; Audit-Kette und Store-Integrität danach gültig. **Keine** SLO-Aussage (siehe `docs/OPERATIONS.md` §5a) |
| CI | Läufe `36111364798`, `36111369562` (Commit `d7cc37a`), `36110172943`, `36110176872` (Commit `4df8a00`), `36108086985`, `36108091312` (Commit `1d219c2`), `36107372935`, `36107377587` (Commit `b2391bc`), davor `36104924399`, `36104927512`, `36104319789`, `36104323205`, `36097553143`, `36090732676`, `36090186817`, `36086611264` – alle grün |

## D. Teilimplementiert (PARTIAL)

| Bereich | Grenze |
|---|---|
| OCI-Runtime | Implementiert mit Härtungsflags (`--network none`, `--read-only`, `--cap-drop ALL`, `no-new-privileges`), in dieser Umgebung **nicht** praktisch ausgeführt → `UNVERIFIED` |
| Netzwerk-Allowlist | Bewusst fail closed: kein kontrollierter Egress-Proxy vorhanden |
| Provider-Fabric | Katalog, Lifecycle, Bindungen und Approval-Pflicht persistent; **keine** echte Verbindung zu externen Anbietern (Egress `DENY`) |
| Device Fabric | Zustandsmaschine und Autorisierung vollständig; kein echter Discovery-Dienst, keine Attestierung |
| Computer Use | Vertrag + Zustandsmaschine + Autorisierung; kein Browser-/Desktop-Treiber angebunden |
| Simulation/Visualisierung | Szenarien und Visualisierungsarten persistent, aber keine Renderer/Ausführung |
| Runtime-Registry | 3 Definitionen (Node 22, Python 3.13, Custom OCI), erweiterbar; kein automatisches Provisionieren |
| Control Center UI | 38 Abschnitte, jeder an echte Serverdaten gebunden (kein Platzhalterzustand), jsdom-Renderingtests gegen echte Routen-Handler; Browser-E2E offen |
| Metrik-Alarmierung | Export und Empfehlungen vorhanden; kein Scraper/Alertmanager im Repository |
| Backup-Automation | Backup/Restore implementiert und geprüft; kein geplanter Job und keine Rotation |
| Legacy-Token | Standardmäßig deaktiviert; Aktivierung nur mit ausdrücklicher Freigabe (dokumentiert, nicht empfohlen) |

## E. Nicht implementiert (NOT_IMPLEMENTED)

- WebAuthn/Multifaktor-Geräteverwaltung (TOTP ist implementiert, siehe Abschnitt B).
- Automatisches Deployment/Produktionsfreigabe (Promotion ist bewusst manuell und Creator-gebunden).
- Alarmierung/Scraping (Prometheus-Server, Alertmanager) und geplante Backups mit Aufbewahrungsregel.
- Vektor-/Embedding-Suche im Knowledge Graph.
- Statistische Signifikanzprüfung in der Kausalvalidierung (strukturell, nicht frequentistisch).

## F. Nicht verifiziert (NOT_VERIFIED)

- OCI-Sandbox-Laufzeit (kein Container-Daemon in der Umgebung verfügbar).
- Nebenläufigkeitsgrenzen sind getestet (12 parallele autorisierte Ausführungen, 6 verweigerte Fremdbindungen: `tests/integration/load-broker.test.ts`), ein Durchsatz-/SLO- oder Langzeitnachweis ist es **nicht**.
- Verhalten über lange Betriebszeit (kein Langzeit-/Soak-Test).
- Echte Browser-Darstellung des Control Centers (Playwright/Browser-E2E). Das Rendering ist unter jsdom getestet (`tests/ui/control-center.test.tsx`: 38 Abschnitte, echte Daten, „nicht verfügbar“-Meldung, Anmeldemaske; `tests/ui/control-center-api.test.tsx`: echte Routen-Handler, Metriken und Secret-Grenze).

## G. Sicherheitsgrenzen

1. Kein GUI- oder Agentenweg direkt zur Shell; jede Ausführung läuft über Gate und Broker.
2. Keine Selbstvergabe von Rechten (`issueCapabilityToken` verweigert `issuedBy === subject`, `issuedByKind: "AGENT"`).
3. Keine Wildcards in Capability-Listen; TTL maximal 15 min (Creator) / 5 min (Agent).
4. Bindung an Subjekt, Task, Sandbox, Umgebung und Risiko; Fremdbindung → 409.
5. Shell-Interpreter und Metazeichen sind in **jedem** `argv`-Element verboten (Broker + Runtime).
6. Netzwerk default `DENY`; `ALLOWLIST` fail closed.
7. Kill Switches wirken sofort; Ausführung bei aktivem Lockdown → 409 am Gate; Freigabe nur durch Creator.
8. Audit ist HMAC-verkettet und wird regelmäßig verifiziert; Verweigerungen sind auditiert.
9. Browser erhält nur ein HttpOnly-Session-Cookie – niemals Creator-, Provider-, Geräte- oder Runtime-Secrets.
10. Geschützte Daten verlassen die Plattform nicht implizit; `METADATA_ONLY` verweigert sie an Dritte.
11. Provenance- und Knowledge-Schreibzugriff sind Creator-Aktionen: Evidenz und Wissen können nicht von den bewerteten Subjekten erzeugt werden.
12. Entdeckte Geräte/Provider/Computer sind nicht autorisiert; Autorisierung ist ein eigener Creator-Akt.

## H. Runtime real vs. simuliert

| Modus | Kennzeichnung | Einsatz | Nachweis |
|---|---|---|---|
| `REAL_LOCAL` | real | Standard in Tests, CI und Live-Nachweis: echte Kindprozesse, echte Snapshots mit SHA-256 | `tests/integration/*`, `scripts/verify-live.sh` |
| `REAL_OCI` | implementiert, **UNVERIFIED** | gehärtete Container-Isolation, ohne Daemon ungeprüft | `lib/oci-runtime.ts` |
| `REAL_LOCAL` + Kernel-Isolation | real, gemessen (`NAMESPACES`) | ohne Daemon verfügbare Kernel-Grenzen (Namespaces, read-only Rootfs, Capabilities 0, `RLIMIT_CPU`/`RLIMIT_FSIZE`, mit delegiertem cgroup-Unterbaum auch Speicher/Prozesse); **kein** OCI-Image, kein `runc` | `lib/ns-isolation.ts`, `tests/integration/ns-isolation.test.ts`, `scripts/verify-live.sh` §11 |
| `MOCK` | MOCK/SIMULATED | nur Entwicklung, nur mit `BOB_ALLOW_MOCK_RUNTIME=1` | `lib/runtime.ts` |

Keine Erfolgsaussage stützt sich auf Mock-Verhalten; Simulationen
(`lib/simulation.ts`) sind ausdrücklich keine Nachweise.

## I. Tests und Ergebnisse

- Unit (**7 Dateien / 53 Tests**): Persistenz, Store-Migration, Control Plane, Agent Fabric (11 Rollen,
  harte Grenzen), Recovery-Tier, Betriebszustand, Audit-Aufbewahrung.
- Integration (**12 / 84**): Sandbox-Runtime, Provider-Fabric, App-Modul-Sandbox, Computer Use
  (Registrierung erzwingt unauthorisiert, Autorisierung nur als Creator-Akt), Ausführungs- und
  Verweigerungs-Evidenz, Backup/Metriken, Nebenläufigkeit, Kernel-Isolation (11 Tests), Worker-Fehlerkette,
  Visualisierung (7 Renderarten) sowie **Alarmierung** (16 Regeln an reale Kennzahlen gebunden) und
  **Backup-Automation** (idempotenter Lauf, Aufbewahrung schützt das neueste Backup).
- Security (**16 / 103**): Authority-Invarianten (inkl. Token-Ablauf als Pflicht), API-Guard, API-Gate,
  Routen-Guards, direkt aufgerufene Routen ohne Gate, argv-Policy, Creator-Login, Lockout, TOTP, Inbox,
  Routenvertrag, Token-Leseprojektion ohne `secretHash`, **Geräte-Registrierung** (fail closed, kein
  Selbst-Grant, Lebenszeichen ohne Rechteänderung).
- E2E (2 / 4): Erfolgskette Creator → Knowledge; Fehlerkette bis `REGRESSION_LOCKED`.
- UI (2 / 11): Control Center unter jsdom mit vollständiger Navigation, echten Routen-Handlern,
  ausgewiesener Geräte-Autorisierung und Backup-Automation.
- Regression (**3 / 14**): Regression Engine sowie Quellvertrag der Oberfläche
  (`ui-contract.test.ts`) und der Isolationsbericht (`ns-report-cache.test.ts`).
- Live auf der Frischinstanz `:3100` (cgroup-delegiert, Kernel-Isolation): `scripts/verify-live.sh`
  (**174 / 0**), `scripts/audit-actions.mjs` (**488 / 0**, inkl. Kette „Alarmierung/Backup"),
  `scripts/audit-api.sh` (**201 / 0**), `scripts/audit-ui.mjs` (**82 / 0**).
- Gesamt: **42 Dateien / 269 Tests grün**.

Details und Befehle: `docs/TESTING.md`.

## J. CI-Zustand und Repository

- `.github/workflows/ci.yml`, fünf Jobs: Lint/Typecheck → Unit/Integration/Regression,
  Security/E2E, Produktionsbuild → Verification Gate.
- Letzte grüne Läufe (Branch `arena/01a0d635-babajagabob`): `36097024859`, `36097027228`, `36097375658`, `36097378964`.
- Arbeitsweise: Feature-Branch → Commit → CI → PR → Review → Merge; `main` bleibt unberührt.
- Keine Secrets, keine `.bob-data`-Laufzeitdaten im Repository (`.gitignore`).
- Supply Chain: Die Actions sind auf Commit-SHAs gepinnt (`actions/checkout@11d5960a…` v4.3.0, `actions/setup-node@49933ea5…` v4.4.0) statt auf bewegliche Tags.

## K. Persistenz, Recovery, Provider, Device Fabric

- **Persistenz:** alle Stores als digest-geprüfte Envelopes, atomares Schreiben mit
  `0600`; Manipulation führt zu `StoreIntegrityError` (fail closed). Backups sind
  digest-/versionsgeprüfte Kopien (kein zweiter Live-Zustand); ein manipuliertes
  Backup wird beim Restore mit 409 abgelehnt.
- **Evidenz:** nichts wird angenommen, was nicht nachweisbar ist: jede autorisierte
  Ausführung hinterlässt einen erneut prüfbaren Nachweis (Digest über stdout/stderr/
  Exit-Code); gekürzte Inhalte sind als gekürzt gekennzeichnet.
- **Upgrades:** Schemawechsel migrieren registriert, sichern vorher und protokollieren;
  eine bestehende Installation wird dadurch nicht ausgesperrt (live an einem realen
  v1-Store nachgewiesen: Login vorher 500, nach der Migration 201 ohne Datenverlust).
- **Recovery:** Checkpoint → Plan (Tier/Steps/Verifikationsplan) → Restore →
  Verifikation mit echten Tests; nur `ACCEPT` ergibt `VERIFIED`, sonst `REJECTED`.
- **Provider:** Discovery ohne Rechte, Verbindung nur mit freigegebener Approval,
  Bindungen mit expliziten Fähigkeiten, Widerruf deaktiviert alle Bindungen,
  keine echte Netzwerkverbindung (Egress `DENY`).
- **Device Fabric:** Discovery ≠ Autorisierung, Autorisierung und Allocation sind
  getrennte Creator-Akte; Computer Use folgt demselben Muster.

## L. Production Readiness

| Dimension | Bewertung | Begründung |
|---|---|---|
| Autorisierung/Sicherheitsgrenzen | **PASS** | Invarianten implementiert, getestet und live nachgewiesen; Angriffe blockiert und auditiert |
| Persistenz/Integrität | **PASS** | Digest-Envelope, atomare Schreibvorgänge, Manipulationserkennung getestet |
| Kernkette E2E | **PASS** | Erfolgs-, Fehler- und Angriffsweg in Tests und live belegt |
| Lokale Runtime | **PASS** | echte Prozesse, Bindung, Snapshot/Restore, argv-Policy verifiziert |
| OCI-Runtime | **NOT_VERIFIED** | Härtungscode vorhanden, ohne Daemon nicht praktisch geprüft |
| Netzwerk/Egress-Allowlist | **PARTIAL** | bewusst fail closed, kein Egress-Proxy implementiert |
| Provider/Device/Computer Use | **PARTIAL** | Verträge, Zustandsmaschinen und Autorisierung vollständig; keine echten externen Verbindungen/Treiber |
| UI/Control Center | **PARTIAL** | Funktion vorhanden, keine Browser-E2E-Abdeckung |
| Beobachtbarkeit/Betrieb | **PARTIAL** | Statusrouten, Events, Audit, Readiness, Prometheus-Export und geprüftes Backup vorhanden; kein Scraper/Alertmanager, keine geplante Rotation |
| Last/Robustheit über Zeit | **PARTIAL / NOT_VERIFIED** | Nebenläufigkeitsgrenze geprüft (12 parallel, `load-broker`) und begrenzter Lastnachweis (2 × 120 Ausführungen, `scripts/soak.mjs`); **keine** SLO-Schwellen, keine Lastkurve, kein Dauerlauf |

**Gesamtaussage:** Die Plattform erfüllt die Sicherheits- und Nachweisziele des
Auftrags (`PASS` für Autorisierung, Persistenz, Kernkette, lokale Runtime). Sie ist
**nicht** als produktionsreif gekennzeichnet: OCI-Runtime, externe Provider,
Geräte-/Computer-Integration, UI-Automatisierung, Last- und Langzeitverhalten
bleiben `PARTIAL`/`NOT_VERIFIED`. Alle offenen Punkte sind in `docs/STATUS.md`,
`docs/TODO.md` und `docs/SPEC_COMPLIANCE.md` gelistet.
