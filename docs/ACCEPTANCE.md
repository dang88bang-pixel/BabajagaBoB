# Abnahme-Matrix (generiert)

> **Diese Datei wird erzeugt** — Quelle ist `docs/acceptance/requirements.json`.
> Erzeugen: `node scripts/acceptance.mjs --write`. Prüfen: `node scripts/acceptance.mjs` (CI).

Eingefroren: 2026-09-25. Quellen: GESAMTAUFTRAG (53 Punkte); docs/MASTER_COMPLETION_SPEC.md; Auftrag „Abnahmeplan“ (P0–P5).

**Regel:** Kein PASS ohne Implementierung UND Test UND Nachweis. PARTIAL/NOT_* verlangen eine Begründung im Feld note.

## Übersicht

| Status | Anzahl | Bedeutung |
|---|---|---|
| ✅ PASS | 79 | Implementierung + Test + Nachweis vorhanden |
| 🟡 PARTIAL | 2 | Teilweise umgesetzt, Lücke benannt |
| ❌ FAIL | 0 | Umgesetzt, aber Nachweis fehlgeschlagen |
| ⚪ NOT_IMPLEMENTED | 1 | Bewusst nicht gebaut (Begründung) |
| 🔵 NOT_VERIFIED | 3 | Vorhanden, aber Umgebung erlaubt keinen Nachweis |
| ⛔ BLOCKED | 0 | Durch äußere Abhängigkeit blockiert |

## Zielkette

```
Creator → Mission → Agent → Plan → Sandbox → Experiment/Code → Execution Broker → Runtime → Beobachtung → Evidenz → Validierung → Artefakt → Test → Approval → Deployment → Monitoring → Recovery → Lernen
```

## P0 (16/17 PASS)

| ID | Bereich | Anforderung | Implementierung | Test | Nachweis | UI | Status |
|---|---|---|---|---|---|---|---|
| SPEC-001 | Abnahme | Die Gesamtspezifikation ist als maschinenlesbare Requirement-Matrix eingefroren; kein Status ohne Nachweis. | `docs/acceptance/requirements.json`<br>`scripts/acceptance.mjs` | `tests/unit/acceptance-matrix.test.ts` (4) | `scripts/acceptance.mjs` | — | ✅ |
| CI-001 | Lieferkette | CI führt Lint/Typecheck, Unit/Integration/Regression, Security/E2E, Build und Promotion-Gate als blockierende Stufen aus. | `.github/workflows/ci.yml` | `tests/security/api-route-contract.test.ts` (5) | `GET /api/cicd` | — | ✅ |
| AUTH-001 | Autorisierung | Authority ist fail closed: Bindung an Task, Sandbox, Umgebung, Risiko, Ablauf; keine Selbstvergabe, keine Wildcards. | `lib/authority.ts`<br>`lib/policy.ts` | `tests/security/authority.test.ts` (13) | `GET /api/authority` | — | ✅ |
| AUTH-002 | Autorisierung | Capability-Token sind einmalig nutzbar (Wiederholungssperre, Vorprüfung ≠ Verbrauch). | `lib/authority.ts`<br>`lib/execution-gate.ts` | `tests/security/token-replay.test.ts` (5) | `GET /api/authority` | — | ✅ |
| AUTH-003 | Autorisierung | Leseantworten liefern keine Token-Hashes (Leseprojektion). | `lib/authority.ts` | `tests/security/token-read-projection.test.ts` (4) | `GET /api/capabilities` | Security | ✅ |
| AUTH-004 | Autorisierung | Jede Route prüft je Methode eine konkrete Aktion; direkter Handler-Aufruf ohne Gate ist verweigert. | `lib/api/guard.ts`<br>`lib/api/api-gate.ts`<br>`app/api/approvals/center/route.ts`<br>`app/api/workshop/execute/route.ts` | `tests/security/api-route-contract.test.ts` (5)<br>`tests/security/direct-route-denial.test.ts` (4)<br>`tests/security/route-guards.test.ts` (6) | `scripts/verify-live.sh`<br>`scripts/audit-api.sh` | — | ✅ |
| BOOT-001 | Creator-Bootstrap | Bootstrap genau einmal, ohne Hardcoding, mit Session-Kopplung und Creator-Authority. | `lib/bootstrap.ts`<br>`lib/creator-auth.ts`<br>`app/api/auth/route.ts` | `tests/security/creator-login.test.ts` (5) | `GET /api/auth` | Overview | ✅ |
| BOOT-002 | Creator-Bootstrap | Zweiter Faktor (TOTP) und Sperre nach Fehlversuchen sind erzwungen. | `lib/totp.ts`<br>`lib/creator-auth.ts` | `tests/security/creator-totp.test.ts` (9)<br>`tests/security/creator-login-lockout.test.ts` (1) | `scripts/verify-live.sh` | — | ✅ |
| EVT-001 | Event-Fabric | Ein kanonisches, append-only Ereignis-Log mit Sequenz, Kausalrichtung und Integritätskette; keine zweite Wahrheit. | `lib/events/log.ts`<br>`lib/event-store.ts`<br>`lib/observability.ts` | `tests/integration/event-audit-linkage.test.ts` (2) | `GET /api/events` | Timeline | ✅ |
| EVT-002 | Event-Fabric | Das Ereignis-Log erkennt Manipulation und verliert bei Aufbewahrung nicht die Kettenintegrität (Checkpoint statt Bruch). | `lib/events/log.ts`<br>`lib/observability.ts` | `tests/integration/event-audit-linkage.test.ts` (2) | `GET /api/events` | — | ✅ |
| AUD-001 | Audit | Audit ist append-only, hash-verkettet und manipulationserkennbar; Kürzung nur mit Checkpoint. | `lib/audit.ts` | `tests/unit/audit-retention.test.ts` (4) | `GET /api/audit` | Audit | ✅ |
| AUD-002 | Audit | Audit-Einträge und Beobachtungen sind an das kanonische Ereignis gekoppelt (eine Kausalkette, nicht drei). | `lib/audit.ts`<br>`lib/observability.ts` | `tests/integration/event-audit-linkage.test.ts` (2) | `GET /api/audit` | Audit, Timeline | ✅ |
| PROV-001 | Provenance | Provenance-Knoten/-Kanten sind echt (keine synthetischen Kennungen) und werden je Aktion geschrieben. | `lib/provenance.ts` | `tests/integration/execution-evidence.test.ts` (5) | `GET /api/provenance` | Provenance | ✅ |
| GATE-001 | Execution Gate | Kein Ausführungspfad um Gate und Broker herum — auch interne Läufe nicht. | `lib/execution-gate.ts`<br>`lib/execution-broker.ts`<br>`lib/system-execution.ts` | `tests/security/gate-bypass.test.ts` (3) | `POST /api/execution-gate` | Runs, Approvals | ✅ |
| GATE-002 | Execution Gate | Verweigerungen erzeugen Evidenz (Denial-Artefakt) samt Audit und ohne Klartext-Argumente. | `lib/artifacts.ts`<br>`lib/execution-gate.ts` | `tests/integration/execution-evidence.test.ts` (5) | `GET /api/artifacts` | Evidence | ✅ |
| GATE-003 | Execution Gate | Keine Shell-Strings: argv[] mit shell:false; Interpreter und Metazeichen sind verboten. | `lib/argv-policy.ts`<br>`lib/runtime-local.ts` | `tests/security/argv-policy.test.ts` (6) | `scripts/verify-live.sh` | — | ✅ |
| OCI-001 | OCI-Härtung | OCI-Sandbox mit Härtungsflags, Snapshot/Restore und Quota-Durchsetzung.<br><small>Kein Container-Daemon in der Umgebung (Docker/Podman-Downloads gesperrt); Flags sind definiert, aber nicht real ausgeführt.</small> | `lib/oci-runtime.ts` | — | — | — | 🔵 |

## P1 (20/20 PASS)

| ID | Bereich | Anforderung | Implementierung | Test | Nachweis | UI | Status |
|---|---|---|---|---|---|---|---|
| Q-001 | Worker/Queue | Durable Queue mit Lease, Heartbeat, Timeout, Retry, Dead-Letter, Cancel und Orphan-Erkennung. | `lib/queue.ts`<br>`lib/worker.ts`<br>`lib/dispatcher.ts` | `tests/integration/worker-recovery.test.ts` (8) | `GET /api/queue` | Queue | ✅ |
| Q-002 | Worker/Queue | Lease-Ablauf führt zur Rückstellung, nicht zum Versuchsverbrauch; fehlgeschlagene Jobs bleiben sichtbar. | `lib/queue.ts`<br>`lib/worker.ts` | `tests/integration/worker-recovery.test.ts` (8) | `GET /api/metrics` | — | ✅ |
| Q-003 | Worker/Queue | Nebenläufige autorisierte Ausführungen bleiben an ihre Sandbox gebunden; Fremdbindungen werden unter Last verweigert. | `lib/execution-broker.ts`<br>`lib/sandbox/fabric.ts` | `tests/integration/load-broker.test.ts` (2) | `scripts/soak.mjs` | — | ✅ |
| SB-001 | Sandbox | Sandbox-Lebenszyklus mit echter Prozessausführung, Snapshot, Digest und Verifikation. | `lib/sandbox/fabric.ts`<br>`lib/runtime-local.ts` | `tests/integration/sandbox-runtime.test.ts` (6) | `GET /api/sandboxes` | Sandboxes | ✅ |
| SB-002 | Sandbox | Kernel-Isolation (Namespaces, read-only Rootfs, no_new_privs, leere Capabilities) ist gemessen, nicht behauptet. | `lib/ns-isolation.ts`<br>`scripts/ns-exec.sh` | `tests/integration/ns-isolation.test.ts` (11) | `GET /api/runtime` | Runtimes | ✅ |
| SB-003 | Sandbox | Ressourcenlimits (CPU-Zeit, Dateigröße, Speicher, Prozesse) greifen kernel-seitig; ohne Limits wird fail closed verweigert. | `lib/ns-isolation.ts`<br>`lib/runtime-local.ts` | `tests/integration/ns-isolation.test.ts` (11) | `scripts/verify-live.sh` | — | ✅ |
| SB-004 | Sandbox | ALLOWLIST-Netzwerke sind fail closed, solange kein kontrollierter Egress existiert; Vorgabe ist DENY. | `lib/runtime.ts`<br>`lib/runtime-local.ts`<br>`lib/oci-runtime.ts` | `tests/integration/sandbox-runtime.test.ts` (6) | `scripts/verify-live.sh` | — | ✅ |
| EXP-001 | Experimente | Experiment-Engine mit Baseline, Control, Intervention, Replikation und Beobachtungen. | `lib/science.ts` | `tests/security/causal-integrity.test.ts` (3) | `GET /api/experiments`<br>`GET /api/science` | Experiments, Science | ✅ |
| SCI-001 | Science/Kausalität | Kausalvalidierung verlangt Evidenz, Replikation und Beobachtungen; kein direkter Sprung auf ESTABLISHED. | `lib/science.ts` | `tests/security/causal-integrity.test.ts` (3) | `GET /api/science` | Science | ✅ |
| ERR-001 | Fehlerintelligenz | Fehlerkette von DETECTED über Root Cause und Fix bis REGRESSION_LOCKED, mit Experiment und Evidenz. | `lib/error-intelligence.ts`<br>`lib/worker.ts` | `tests/integration/worker-recovery.test.ts` (8)<br>`tests/e2e/failure-recovery.test.ts` (2) | `GET /api/errors` | Errors | ✅ |
| REC-001 | Recovery | Recovery-Pläne mit Checkpoint, Tier-Klassifikation und Verifikation; abgelehnte Verifikation ist sichtbar. | `lib/recovery-orchestrator.ts`<br>`lib/recovery-tier.ts`<br>`lib/reliability.ts` | `tests/unit/recovery-tier.test.ts` (6) | `GET /api/reliability` | Recovery | ✅ |
| REG-001 | Regression | Regression-Engine: leere Suite ist ein Fehlschlag, Fehlschlag blockiert die Promotion, Tests sind dauerhaft registriert. | `lib/regression.ts`<br>`lib/promotion.ts` | `tests/regression/regression-engine.test.ts` (5) | `GET /api/cicd` | Regression | ✅ |
| KNO-001 | Wissen | Knowledge Graph mit vier Schichten, negativem Wissen („Never Again“) und Herkunftsbindung. | `lib/knowledge.ts` | `tests/unit/control-plane.test.ts` (7) | `GET /api/knowledge` | Knowledge | ✅ |
| STA-001 | Status-Modell | Ein einheitliches Status-Modell für Aktionen und Ressourcen, das in der Oberfläche durchgängig verwendet wird. | `lib/types.ts`<br>`lib/status.ts` | `tests/unit/status-model.test.ts` (5)<br>`tests/regression/ui-contract.test.ts` (6) | `GET /api/observatory` | Queue, Runs, Agents, Observatory | ✅ |
| OBS-001 | Agent Observatory | Observatory je Aktivität: Objective, Observation, Hypothese, Aktion, Erwartung, Ergebnis, Evidenz, Schlussfolgerung, nächster Schritt. | `lib/observatory.ts`<br>`app/api/observatory/route.ts`<br>`lib/events/log.ts`<br>`lib/science.ts` | `tests/integration/observatory-why.test.ts` (8) | `GET /api/observatory`<br>`scripts/audit-api.sh` | Timeline, Agents, Observatory | ✅ |
| TL-001 | Timeline/Replay | Zeitachse und Replay einer Kausalkette sind über API und UI abrufbar. | `lib/events/log.ts`<br>`lib/observability.ts` | `tests/integration/event-audit-linkage.test.ts` (2) | `GET /api/timeline` | Timeline | ✅ |
| WHY-001 | Why-Record | Strukturierte Begründung je Aktion (Zweck, Entscheidung, Referenzen, Kausalkette) statt verborgener Gedankenkette. | `lib/observatory.ts`<br>`lib/events/log.ts`<br>`app/api/events/[id]/why/route.ts` | `tests/integration/observatory-why.test.ts` (8) | `scripts/audit-api.sh` | Timeline | ✅ |
| APR-001 | Approval Center | Kritische Änderungen verlangen Freigabe mit Was/Warum/Wirkung/Risiken/Tests/Rollback; ohne Freigabe keine Wirkung. | `lib/approvals.ts`<br>`app/api/approvals/center/route.ts` | `tests/security/api-route-contract.test.ts` (5) | `GET /api/approvals`<br>`GET /api/approvals/center` | Approvals | ✅ |
| INB-001 | Creator-Inbox | Die Creator-Inbox kennt INFORM/ASK/BLOCK/ESCALATE und kann nur vom Creator beantwortet werden. | `lib/inbox.ts` | `tests/security/inbox-route.test.ts` (4) | `GET /api/inbox` | Inbox | ✅ |
| GOV-001 | Governance | Kill Switches wirken auf den gesamten Ausführungspfad bis in interne Läufe; Lockdown hält Ausführung an. | `lib/governance.ts`<br>`lib/system-execution.ts` | `tests/security/gate-bypass.test.ts` (3) | `GET /api/governance` | Governance | ✅ |

## P2 (10/13 PASS)

| ID | Bereich | Anforderung | Implementierung | Test | Nachweis | UI | Status |
|---|---|---|---|---|---|---|---|
| RT-001 | Runtime Registry | Laufzeiten sind als Registry mit Identität, Version, Plattform, Architektur, Build-/Testkommandos und Sandbox-Unterstützung geführt. | `lib/runtime-registry.ts` | `tests/unit/runtime-persistence.test.ts` (5) | `GET /api/runtimes` | Runtimes | ✅ |
| TOOL-001 | Tool Registry | Werkzeuge werden registriert und laufen ausschließlich über Gate und Broker. | `lib/tool-registry.ts` | `tests/security/gate-bypass.test.ts` (3) | `GET /api/tools` | Tools | ✅ |
| SKILL-001 | Skills | Skills orchestrieren Werkzeuge, sind versioniert und durchlaufen einen Lifecycle. | `lib/skills.ts` | `tests/security/api-route-contract.test.ts` (5) | `GET /api/skills` | Skills | ✅ |
| WS-001 | Werkstatt | Werkstatt-Objekte durchlaufen Discovery → Spezifikation → Umsetzung → Validierung → Registrierung. | `lib/workshop.ts`<br>`lib/workshop-execution.ts` | `tests/security/api-route-contract.test.ts` (5) | `GET /api/workshop` | Workshop | ✅ |
| PROVF-001 | Provider Fabric | Provider haben Lifecycle, Health, Bindungen und Credential-Referenzen; Verbindung nur mit Freigabe. | `lib/provider-fabric.ts` | `tests/integration/provider-fabric.test.ts` (8) | `GET /api/providers` | Providers | ✅ |
| PROVF-002 | Provider Fabric | Echte externe Verbindung eines Providers (live) inklusive Telemetrie.<br><small>Netzwerk ist per Vorgabe DENY und die Umgebung erlaubt keine externen Dienstverbindungen; ein Adapterlauf ist damit nicht belegbar.</small> | `lib/provider-fabric.ts` | — | — | — | 🔵 |
| DEV-001 | Device Fabric | Geräte-Lebenszyklus mit Discovery ≠ Autorisierung, Allokation nur mit Creator-Freigabe. | `lib/devices.ts`<br>`app/api/devices/route.ts` | `tests/integration/computer-use.test.ts` (6) | `GET /api/devices` | Devices | ✅ |
| DEV-002 | Device Fabric | Selbstmeldende Geräte-Registrierung (Enrollment) ist minimal berechtigt, fail closed und ohne Selbst-Grant. | `lib/device-enrollment.ts`<br>`scripts/discover-host.mjs` | `tests/security/device-enrollment.test.ts` (8) | `GET /api/devices` | Devices | ✅ |
| CU-001 | Computer Use | Browser-, Desktop- und CLI-Instanzen sind registriert, erzwungen unautorisiert und nur über Gate/Broker nutzbar.<br><small>Registrierung, Autorisierung und Belegungsgrenze sind umgesetzt; echte Treiber (Browser-Automation, Desktop-Eingabe, Screenshots) fehlen, deshalb kein Ausführungsnachweis.</small> | `lib/computer-use.ts` | `tests/integration/computer-use.test.ts` (4) | `GET /api/computer-use` | ComputerUse | 🟡 |
| SIM-001 | Simulation/Visualisierung | Visualisierung erzeugt aus dem echten Zustand passive Artefakte (7 Arten) mit Digest und Szenario-Bezug. | `lib/visualization.ts` | `tests/integration/visualization.test.ts` (11) | `GET /api/simulation`<br>`GET /api/simulation/render` | Simulation, Gallery | ✅ |
| OFF-001 | Offline Fabric | Arbeiten ohne Internet mit lokalem Paket-/Modell-/Wissensbestand und späterem, herkunftstreuem Abgleich.<br><small>Es gibt keinen Offline-Paketbestand, keinen lokalen Modell-/Vektorindex und keinen Sync-/Merge-Pfad.</small> | — | — | — | — | ⚪ |
| OPR-001 | Betriebliche Wiederherstellung | Sicherungen laufen geplant und verifiziert, mit Aufbewahrungsgrenze und schützendem Verhalten für das neueste Backup. | `lib/backup-policy.ts`<br>`lib/persistence/store.ts` | `tests/integration/backup-automation.test.ts` (9) | `GET /api/persistence` | Operations | ✅ |
| OPR-002 | Persistenz | Jeder Store ist ein digest-geprüfter Envelope mit atomarem Schreiben, Migration und Reparaturpfad. | `lib/persistence/store.ts` | `tests/unit/persistence.test.ts` (5)<br>`tests/unit/store-migration.test.ts` (22) | `GET /api/persistence` | — | ✅ |

## P3 (2/3 PASS)

| ID | Bereich | Anforderung | Implementierung | Test | Nachweis | UI | Status |
|---|---|---|---|---|---|---|---|
| UI-001 | Control Center | Alle Navigationsabschnitte sind an echte Serverrouten gebunden und zeigen echte Zustände (kein Platzhalter). | `components/control-center.tsx` | `tests/ui/control-center.test.tsx` (10)<br>`tests/ui/control-center-api.test.tsx` (2) | `scripts/audit-ui.mjs` | Overview, Missions, Slo | ✅ |
| UI-002 | Control Center | Die Oberfläche enthält keine Geheimnisse; Auslieferung, Quell- und Datenvertrag sind automatisiert geprüft. | `components/control-center.tsx`<br>`scripts/audit-ui.mjs` | `tests/regression/ui-contract.test.ts` (5) | `scripts/audit-ui.mjs` | — | ✅ |
| UI-003 | Control Center | Verifikation in einem echten Browser (Rendering, Interaktion, Screenshots als Evidenz).<br><small>In der Umgebung existiert kein Browser und kein Playwright-Cache; die Hosts für Browser-Downloads sind gesperrt. Ersatzweise jsdom + HTTP-Audit.</small> | — | `tests/ui/control-center-api.test.tsx` (2) | — | — | 🔵 |

## P4 (27/28 PASS)

| ID | Bereich | Anforderung | Implementierung | Test | Nachweis | UI | Status |
|---|---|---|---|---|---|---|---|
| TEST-001 | Teststrategie | Pyramide aus Unit-, Integrations-, Security-, Regression-, UI- und E2E-Suiten ist in CI blockierend verdrahtet. | `package.json`<br>`.github/workflows/ci.yml` | `tests/unit/control-plane.test.ts` (7)<br>`tests/integration/sandbox-runtime.test.ts` (6) | `.github/workflows/ci.yml` | — | ✅ |
| TEST-002 | Teststrategie | Regressionstests sind je Fehlerfall dauerhaft registriert und blockieren eine Promotion. | `lib/regression.ts`<br>`lib/promotion.ts` | `tests/regression/regression-engine.test.ts` (5) | `GET /api/cicd` | Regression | ✅ |
| TEST-003 | Teststrategie | Fehlerinjektion (Prozessabsturz, Worker-Verlust, Netzwerkverlust, doppelte Jobs, konkurrierende Schreibvorgänge).<br><small>Zwei Ebenen: (1) Injektions-Harness im eigenen Prozess (Prozessabbruch im Sandkasten, Worker-Verlust, Netzwerkverlust, doppelter Job, konkurrierende Schreibvorgänge, manipulierter Store) und (2) echte Betriebssystemprozesse: SIGKILL mitten im Schreibvorgang (Datensatz integer, Store danach beschreibbar, keine tmp-Reste), vier gleichzeitige Writer-Prozesse mit 240/240 Einträgen (Gegenprobe mit unbedingtem Überschreiben verliert Einträge), Lease-Ablauf mit Requeue und ein verschwindendes Netzwerkziel über den echten Pfad dispatchTask → runOnce → Broker mit Lauf FAILED und digest-gebundener Evidenz.</small> | `lib/fault-harness.ts`<br>`lib/fault-injection.ts`<br>`lib/persistence/store.ts`<br>`lib/queue.ts`<br>`lib/worker.ts`<br>`tests/helpers/concurrent-writer.ts` | `tests/integration/fault-injection.test.ts` (10)<br>`tests/integration/worker-recovery.test.ts` (8)<br>`tests/integration/fault-injection-processes.test.ts` (5) | `docs/TESTING.md`<br>`tests/integration/fault-injection-processes.test.ts` | Faults | ✅ |
| TEST-004 | Teststrategie | Sabotageproben belegen, dass die Suiten Schwächungen tatsächlich erkennen.<br><small>25 automatisierte Sabotageproben (`node scripts/sabotage.mjs`, Pflichtstufe in CI): jede entfernt gezielt eine Schutzregel aus dem Produktionscode und verlangt, dass die zuständigen Suiten rot werden — Ergebnis 25/25 erkannt. Vor der ersten Mutation läuft eine Grundprobe über alle betroffenen Suiten (ohne sie wäre ein ohnehin rotes Repository als „Erkennung“ fehlinterpretierbar); nach jeder Probe werden die Dateien byteweise wiederhergestellt und per SHA-256 geprüft. Regeln auf zwei redundanten Ebenen werden in beiden entfernt (`edits`), sonst belegt die Probe nichts. Der Katalog ist durch `tests/unit/sabotage-plan.test.ts` abgesichert (Anker genau einmal vorhanden, Testdateien existieren, Prüfer hängt in der CI).</small> | `docs/acceptance/sabotage-probes.json`<br>`scripts/sabotage.mjs` | `tests/unit/sabotage-plan.test.ts` (6)<br>`tests/security/promotion-gates.test.ts` (10) | `scripts/sabotage.mjs`<br>`.github/workflows/ci.yml` | Faults | ✅ |
| LIVE-001 | Betriebsnachweis | Live-Prüfungen gegen den Produktionsserver: Verifikation, Aktions-/Attributmatrix, Routenprüfung, Oberflächenprüfung. | `scripts/verify-live.sh`<br>`scripts/audit-actions.mjs`<br>`scripts/audit-api.sh`<br>`scripts/audit-ui.mjs` | `tests/security/api-route-contract.test.ts` (5) | `scripts/verify-live.sh`<br>`scripts/audit-actions.mjs` | — | ✅ |
| LOAD-001 | Betriebsnachweis | Begrenzter Lastnachweis mit definierten Schwellen (p95-Budget, Erfolgsquote) und wirksamem Negativpfad.<br><small>Der begrenzte Lauf hat Schwellen und einen Negativnachweis; ein Dauerlauf über Stunden (Lastkurve, SLO-Zusage) fehlt.</small> | `scripts/soak.mjs`<br>`lib/slo.ts` | `tests/unit/slo.test.ts` (9) | `scripts/soak.mjs` | — | 🟡 |
| ACC-001 | Abnahme §49 | E2E-Erfolgspfad: Creator → Mission → Task → Sandbox → Token → Ausführung → Evidenz → Audit → Provenance. | `tests/e2e/creator-flow.test.ts` | `tests/e2e/creator-flow.test.ts` (2) | `tests/e2e/creator-flow.test.ts` | — | ✅ |
| ACC-002 | Abnahme §49 | Bewusster Fehler durchläuft Error Intelligence, Recovery, Regression und Knowledge bis REGRESSION_LOCKED. | `tests/e2e/failure-recovery.test.ts` | `tests/e2e/failure-recovery.test.ts` (2) | `tests/e2e/failure-recovery.test.ts` | — | ✅ |
| ACC-003 | Abnahme §49 | Blockierte Autorisierung endet als DENIED mit Audit- und Evidenznachweis (Angriff belegt). | `tests/integration/execution-evidence.test.ts`<br>`scripts/verify-live.sh` | `tests/integration/execution-evidence.test.ts` (5) | `tests/integration/execution-evidence.test.ts` | — | ✅ |
| ACC-004 | Abnahme §49 | Die vollständige Zielkette (18 Stufen) ist in einem Test durchlaufen und je Stufe über API, Persistenz, Audit und Provenance belegt. | `tests/e2e/acceptance-chain.test.ts` | `tests/e2e/acceptance-chain.test.ts` (3) | `scripts/acceptance.mjs` | — | ✅ |
| CH-01 | Zielkette | Creator: Creator-Sitzung mit Autorität, ohne Selbstvergabe | `lib/creator-auth.ts` | `tests/security/creator-login.test.ts` (5) | `GET /api/auth` | Overview | ✅ |
| CH-02 | Zielkette | Mission: Mission mit Objective und Task (Planungsgerüst) | `lib/control-plane.ts` | `tests/unit/control-plane.test.ts` (7) | `GET /api/missions` | Missions | ✅ |
| CH-03 | Zielkette | Agent: Agent aus der Fabric mit Rolle, Capabilities und Autonomiegrenze | `lib/agent-fabric.ts` | `tests/unit/agent-fabric.test.ts` (4) | `GET /api/agents` | Agents | ✅ |
| CH-04 | Zielkette | Plan: Aufgabenplanung durch den Planner (Objective → Tasks), nachvollziehbar<br><small>Versionierter, persistenter Plan-Datensatz je Objective mit gebundenen Tasks, erwarteter Wirkung und expliziten Abbruchkriterien; Aktivierung ist Creator-gebunden und wird über den kanonischen Event-/Audit-Pfad beobachtet.</small> | `lib/plans.ts`<br>`lib/dispatcher.ts` | `tests/unit/plans.test.ts` (6) | `GET /api/plans` | Plans | ✅ |
| CH-05 | Zielkette | Sandbox: Sandbox mit Isolation, Limits und Snapshot | `lib/sandbox/fabric.ts` | `tests/integration/sandbox-runtime.test.ts` (6) | `GET /api/sandboxes` | Sandboxes | ✅ |
| CH-06 | Zielkette | Experiment/Code: Experiment mit Baseline/Control/Replikation und Codeausführung im Sandbox | `lib/science.ts`<br>`lib/runtime-local.ts` | `tests/integration/visualization.test.ts` (11)<br>`tests/security/causal-integrity.test.ts` (3) | `GET /api/experiments` | Experiments | ✅ |
| CH-07 | Zielkette | Execution Broker: Autorisierte Ausführung über Gate und Broker, keine Umgehung | `lib/execution-gate.ts`<br>`lib/execution-broker.ts` | `tests/security/gate-bypass.test.ts` (3) | `POST /api/execution-gate` | Runs | ✅ |
| CH-08 | Zielkette | Runtime: Runtime führt argv ohne Shell aus und liefert Ergebnis + Digest | `lib/runtime-local.ts`<br>`lib/runtime-factory.ts` | `tests/integration/sandbox-runtime.test.ts` (6) | `GET /api/runtime` | Runtimes | ✅ |
| CH-09 | Zielkette | Beobachtung: Ereignisse mit Akteur, Zweck, Entscheidung und Kausalkette | `lib/observability.ts`<br>`lib/events/log.ts` | `tests/integration/event-audit-linkage.test.ts` (2) | `GET /api/events` | Timeline | ✅ |
| CH-10 | Zielkette | Evidenz: Artefakt mit Digest, Provenance-Knoten und Audit-Eintrag | `lib/artifacts.ts`<br>`lib/provenance.ts` | `tests/integration/execution-evidence.test.ts` (5) | `GET /api/artifacts` | Evidence | ✅ |
| CH-11 | Zielkette | Validierung: Kausalvalidierung mit Knowledge-State, kein Selbstaufstieg | `lib/science.ts` | `tests/security/causal-integrity.test.ts` (3) | `GET /api/science` | Science | ✅ |
| CH-12 | Zielkette | Artefakt: Ausgabeartefakte (u. a. Visualisierung) digest-geprüft und abrufbar | `lib/artifacts.ts`<br>`lib/visualization.ts` | `tests/integration/visualization.test.ts` (11) | `GET /api/gallery` | Gallery | ✅ |
| CH-13 | Zielkette | Test: Regressionstest je Fehlerfall, blockierend für die Promotion | `lib/regression.ts` | `tests/regression/regression-engine.test.ts` (5) | `GET /api/cicd` | Regression | ✅ |
| CH-14 | Zielkette | Approval: Freigabe mit Was/Warum/Risiko/Rollback vor kritischer Wirkung | `lib/approvals.ts` | `tests/security/api-route-contract.test.ts` (5) | `GET /api/approvals/center` | Approvals | ✅ |
| CH-15 | Zielkette | Deployment: Promotion über Stufen mit Gates (Ausrollen/Rollback fehlt)<br><small>Der im Anforderungstext genannte fehlende Teil ist umgesetzt: Ausrollen und Rückroll laufen über die Promotion-Gates (Staging verlangt LINT/TYPECHECK/UNIT/INTEGRATION/SECURITY/BUILD bestanden und verlangt für BROWSER/EVALUATION eine ausdrückliche Quittung mit Begründung; PRODUCTION verlangt weiterhin alle Prüfungen PASSED und bleibt hier deshalb blockiert). Ausgerollt gilt erst nach gemessener Build-ID aus dem Slot.</small> | `lib/promotion.ts`<br>`lib/cicd.ts`<br>`lib/release.ts`<br>`lib/deployment.ts`<br>`app/api/deployment/route.ts` | `tests/e2e/deployment-release.test.ts` (3)<br>`tests/integration/deployment.test.ts` (7) | `POST /api/promotion-gate`<br>`POST /api/deployment` | Pipeline, Deployment | ✅ |
| CH-16 | Zielkette | Monitoring: Metriken, Alarmregeln, Service-Level und Bereitschaft | `lib/metrics.ts`<br>`lib/alerting.ts`<br>`lib/slo.ts` | `tests/integration/alerting.test.ts` (8)<br>`tests/unit/slo.test.ts` (9) | `GET /api/metrics` | Metrics, Slo | ✅ |
| CH-17 | Zielkette | Recovery: Recovery mit Checkpoint, Tier und Verifikation; Restore verifiziert | `lib/recovery-orchestrator.ts`<br>`lib/reliability.ts` | `tests/unit/recovery-tier.test.ts` (6) | `GET /api/reliability` | Recovery | ✅ |
| CH-18 | Zielkette | Lernen: Negatives Wissen („Never Again“) aus verifiziertem Fix | `lib/knowledge.ts` | `tests/e2e/failure-recovery.test.ts` (2) | `GET /api/knowledge` | Knowledge | ✅ |

## P5 (4/4 PASS)

| ID | Bereich | Anforderung | Implementierung | Test | Nachweis | UI | Status |
|---|---|---|---|---|---|---|---|
| OPS-001 | Betrieb | Metriken, Alarmregeln (an reale Kennzahlen gebunden) und Service-Level-Bewertung sind verfügbar. | `lib/metrics.ts`<br>`lib/alerting.ts`<br>`lib/slo.ts` | `tests/integration/alerting.test.ts` (8)<br>`tests/unit/slo.test.ts` (9) | `GET /api/metrics`<br>`GET /api/alerts`<br>`GET /api/slo` | Metrics, Slo | ✅ |
| OPS-002 | Betrieb | Bereitschaft und Lockdown sind maschinell abfragbar; blockierte Aufgaben sind sichtbar. | `lib/recovery-orchestrator.ts` | `tests/security/api-route-contract.test.ts` (5) | `GET /api/readiness` | Overview | ✅ |
| OPS-003 | Betrieb | Deployment-Ausführung mit Rollback und Upgrade-Pfad.<br><small>Ausrollen ist real ausgeführt und gemessen: Release-Slots mit sha256-Digest, Gates (Staging mit quittierten Lücken, PRODUCTION weiter gesperrt), Health-Checks vor dem Zeigerwechsel, Build-ID-Messung gegen den laufenden Prozess; Rückroll nur mit unversehrtem Vorgänger und anschließender Neumessung. Live belegt: Vorgang STAGED → Supervisor startet aus dem Slot → Datensatz ACTIVE. Grenzen bleiben offen: kein Supervisor-Daemon/Watchdog, kein Zero-Downtime-Blau/Grün, und der Produktions-Rollout bleibt blockiert, solange BROWSER/EVALUATION nicht real bestanden sind.</small> | `lib/release.ts`<br>`lib/deployment.ts`<br>`lib/cicd.ts`<br>`lib/promotion.ts`<br>`app/api/deployment/route.ts`<br>`scripts/release-supervisor.sh` | `tests/integration/deployment.test.ts` (7)<br>`tests/e2e/deployment-release.test.ts` (3)<br>`tests/unit/release.test.ts` (6)<br>`tests/security/route-guards.test.ts` (12) | `GET /api/deployment`<br>`scripts/release-supervisor.sh` | Deployment | ✅ |
| OPS-004 | Betrieb | Produktionshärtung: Rate Limits, Graceful Shutdown, Upgrade-/Rollback-Pfad, Externalisierung der Sitzungsgeheimnisse.<br><small>Rate-Limits (zwei Budgetklassen: `api` 120, `auth` 30 je 60-s-Fenster), Graceful Shutdown und Externalisierung des Session-HMAC-Schlüssels sind implementiert und live belegt. In Produktion ist BOB_SESSION_SECRET verpflichtend; fehlt es, startet die Session-Schicht fail closed. Abweisungen über dem Budget liefern 429 mit Retry-After und werden als DENY auditiert — an der API-Grenze und am Anmeldeendpunkt (Kennung nur als Digest). Live gegen eine zweite Instanz mit Standardbudget (`bash scripts/verify-rate-limit.sh`): 30 Versuche erlaubt, der 31. wird abgewiesen, `retry-after: 60`, Audit-DENY vorhanden, Kette unversehrt (6/0). Der Drain ist durch einen echten Prozesstest belegt (`tests/integration/graceful-shutdown.test.ts`: SIGTERM -> draining -> Exit 0). Ein nicht lesbarer Store wird als Lesefehler und nicht als Beschädigung gemeldet.</small> | `lib/api/rate-limit.ts`<br>`lib/shutdown.ts`<br>`server.mjs`<br>`lib/session-secret.ts` | `tests/unit/ops-hardening.test.ts` (8)<br>`tests/security/ops-enforcement.test.ts` (7)<br>`tests/integration/graceful-shutdown.test.ts` (2) | `POST /api/auth`<br>`server.mjs`<br>`lib/session-secret.ts`<br>`scripts/verify-rate-limit.sh` | Operations | ✅ |

## Prüfer

| Prüfung | Ergebnis |
|---|---|
| Statische Matrix-Prüfung (`node scripts/acceptance.mjs`) | **0 Verstöße** |
| Live-Routennachweise (`--live`) | nicht ausgeführt (statischer Modus) |

Details: `docs/ABNAHMEPLAN.md`, `docs/TESTING.md`.
