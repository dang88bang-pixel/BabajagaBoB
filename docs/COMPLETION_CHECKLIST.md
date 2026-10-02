# Laufende To-do-Liste und Fertigstellungs-Checkliste (P0 → P5)

**Zuletzt aktualisiert:** 2026-10-02.

`docs/acceptance/requirements.json` bleibt die Anforderungsquelle für alle 85 Einzelanforderungen. Diese Liste enthält die aktuell nicht vollständig abgenommenen Anforderungen, ordnet sie strikt nach Phase und hält Blocker sowie konkrete Abschlussnachweise fest. Ein Eintrag wird nur geschlossen, wenn seine Matrix-Anforderung `PASS` erreicht oder die Abhängigkeit ausdrücklich als extern blockiert dokumentiert ist; externe Blockaden werden dadurch **nicht** in `PASS` umgedeutet.

## Baseline

- Matrix-Snapshot nach dem erfolgreichen Real-OCI-Nachweis: **81 PASS / 2 PARTIAL / 0 FAIL / 2 NOT_VERIFIED / 0 NOT_IMPLEMENTED**.
- P1: **20/20 PASS**.
- Lokales Gesamt-Gate nach dem PID-Fix: `BOB_CI=1 BOB_SANDBOX_RUNTIME=local npm run verify` — **Lint 0 Fehler/11 bestehende Warnungen, Typecheck und Build erfolgreich, 68 Testdateien mit 442 bestanden/1 übersprungen** (OCI-Lifecycle mangels lokalem Docker).
- CI-Wrapper lokal geprüft: `node scripts/ci-vitest-diagnostics.mjs test:integration` — **24 Dateien, 139 Tests bestanden/1 OCI-Test übersprungen**; synthetischer Fehlerlauf belegte Step-Summary, Check-Run-Annotation und Exit 1.
- Stabilitätshinweis: Ein erster Voll-Gate-Lauf nach dem PID-Fix hatte einen 30-s-Timeout in `fault-injection-processes.test.ts`; der isolierte Prozessabbruch-Test bestand danach 5/5 und der unmittelbar folgende Voll-Gate-Lauf bestand 442/442 ausführbare Tests. Im GitHub-Integrationslauf wurde dieser Test nicht als Fehler gemeldet; bei Wiederholung beobachten.
- Abnahme-Prüfer: `node scripts/acceptance.mjs` (**15/15 statische Prüfschritte bestanden**).
- GitHub Actions `37002968100` auf `71b67ae` scheiterte mit generischem OCI-/Integrations-Exit 1; dessen Logarchiv war wegen TLS/SSL-EOF nicht abrufbar. Diagnostiklauf `37003972400` auf `03f5ea9` zeigte: Docker lehnt `--pid private` ab. Der PID-Default-Fix wurde auf `b9b9911` umgesetzt.
- GitHub Actions `37004817061` auf `b9b9911`: **dedizierter `Real OCI Runtime`-Job 110830491535 erfolgreich** — `docker version`, Pull von `alpine:3.20` und echter Lifecycle-Test alle erfolgreich. Der Gesamtworkflow blieb rot, weil der separate Integrationsjob den OCI-Test ohne vorab geladenes Image startete (`No such image: alpine:3.20`). Der Workflow-Opt-in `BOB_OCI_REAL_TEST=1` ist im Arbeitsstand jetzt nur am dedizierten, vorgeprüften OCI-Job gesetzt; der nächste Lauf muss die Gesamtsuite bestätigen.
- `OCI-001` ist anhand des echten, nicht übersprungenen Lifecycle-Jobs `PASS`. Positive und frühere negative CI-Nachweise: `docs/evidence/oci-001-ci-pass-2026-10-02.json` und `docs/evidence/oci-001-ci-failure-2026-10-02.json`.

## Aktuelle To-do-Liste (nach Phase geordnet; Status pro Fortsetzung aktualisieren)

| Reihenfolge | Requirement | Status | Nächster konkreter Schritt |
|---:|---|---|---|
| 1 | P2 `PROVF-002` | `NOT_VERIFIED` — extern blockiert | Provider/Endpoint auswählen, kontrollierten Egress freigeben und Credential ausschließlich per Secret Store anbinden; Live-Adapterlauf mit Telemetrie belegen. |
| 2 | P2 `CU-001` | `PARTIAL` | Kontrollierte, isolierte Browser-/Desktop-/CLI-Treiber bereitstellen; Broker-Erfolg und Negativ-/Recovery-Pfade real testen. |
| 3 | P3 `UI-003` | `NOT_VERIFIED` — extern blockiert | Browser-fähigen Runner bereitstellen; Login/Kernpfade real bedienen und Screenshots/Console-Evidence archivieren. |
| 4 | P4 `LOAD-001` | `PARTIAL` | Begrenzter 40-Run mit NAMESPACES und 5-Run-Negativkontrolle bestanden; jetzt Mehrstundendauer/Abbruchregeln festlegen und Soak-Bericht/Evidence wiederholbar in CI/Betrieb sichern. Defaults: 4 Worker, p95 ≤ 5 s, Erfolgsquote ≥ 100 %. |

`OFF-001` und `OCI-001` sind mit `PASS` abgenommen (Details unten). Der CI-Isolationsfix (`BOB_OCI_REAL_TEST=1` nur im dedizierten OCI-Job) steht im Arbeitsstand; als unmittelbarer technischer Folgeschritt den Gesamtworkflow erneut ausführen und dessen Gate bestätigen. Danach die Restliste in Phasenreihenfolge fortsetzen. Diese Liste bleibt dauerhaft maßgeblich; externe Blockaden bleiben `NOT_VERIFIED` und werden nie in `PASS` umgedeutet.

## In diesem Durchlauf abgenommen

### P0 — `OCI-001`: echte Docker-Abnahme

**Status: PASS (2026-10-02).** GitHub Actions `37004817061`, Commit `b9b991139ccf6d33a39b051cb3f6024fd5bd1667`, dedizierter Job `Real OCI Runtime` (`110830491535`): Docker-Daemon, Pull von `alpine:3.20` und Lifecycle-Schritt alle erfolgreich. Der Test lief real (Docker war erreichbar; in diesem Lauf war er nicht skip-fähig durch fehlenden Daemon) und durchlief Container-Create/Start/Inspect, PID-/IPC-/Netzwerkisolation, Read-only-Rootfs, /tmp-Quota, Execute, Timeout-Stop, Reset, Snapshot, Destroy und Restore. Maschinenlesbare Evidence: `docs/evidence/oci-001-ci-pass-2026-10-02.json`.

**Getrennte CI-Störung:** Derselbe Gesamtworkflow scheiterte im allgemeinen Integration-Job, weil dieser den Real-OCI-Test ohne Image-Pull erneut ausführte (`No such image: alpine:3.20`). Das entwertet nicht den erfolgreichen, vorgeprüften OCI-spezifischen Job; der Integration-Test ist jetzt auf `BOB_OCI_REAL_TEST=1` begrenzt und der vollständige Workflow wird erneut geprüft.

### P2 — `OFF-001`: Offline-Arbeit und provenance-erhaltender Sync

**Status: PASS (2026-10-02).** `npm run test:offline:isolated` bestanden (4/4): temporäres Rootfs + `NAMESPACES`, Creator-geschützter Paketimport und lokale Aktivierung gegen Task-/Plan-/Sandbox-Bindungen in einem separaten Receiver-Storage-Root sowie lokale Broker-Ausführung mit einem digest-gepinnten, vom Betreiber gestagten Asset. Der Receiver exportierte signierte Evidence und Provenance; der Rückimport prüft Evidence-, Receiver-Task-/Sandbox- und Paket-IDs, deren Provenance-Kanten sowie den bewahrten Paket-Zeitstempel. `npm run test:offline` bestanden (10/10); `npm run verify` bestanden (68 Testdateien, 442 bestanden, 1 übersprungen; der OCI-Runtime-Test wird ohne Docker übersprungen).

**Umfangsgrenze:** Der Receiver ist eine separate-Storage-Integration im selben Prozess, kein physischer Mehrhost-Transporttest. Betreiber stagen lokale Assets über vertrauenswürdige Offline-Medien. Anwendungsseitiger Asset-Transport und OCI-Asset-Mounting sind separate Scopes und keine OFF-001-Blocker.

## Geordnete Restliste

### 1. P2 — `PROVF-002`: live Provider-Verbindung

**Status: EXTERN BLOCKIERT / NOT_VERIFIED (geprüft 2026-10-02).** Der Netzwerkpfad bleibt gemäß Vorgabe `DENY`; es gibt in dieser Abnahme keinen ausgewählten Provider/Endpoint, keine Creator-freigegebene Egress-Grenze und keine Secret-Store-Referenz für ein Live-Credential. Es wurde kein externer Aufruf versucht.

Abschlussfolge:
1. Einen konkreten Provider und eine kontrollierte, Creator-freigegebene Egress-Grenze bestimmen.
2. Credentials ausschließlich über Secret-Store zuführen; Netzwerkzugriff bleibt bis dahin `DENY`.
3. Einen echten Adapterlauf mit Telemetrie, Fehlerpfad, Audit und Provenance nachweisen.
4. Erst dann `PROVF-002` einzeln auf `PASS` setzen.

**Blocker:** Es gibt weder einen freigegebenen Provider/Secret noch kontrollierten Egress in dieser Umgebung.

### 2. P2 — `CU-001`: kontrollierte Browser-/Desktop-/CLI-Treiber

**Status: PARTIAL / EXTERNE TREIBER FEHLEN (geprüft 2026-10-02).** Registrierung, Autorisierung, Broker und Adaptergrenze sind vorhanden; Adaptertests ersetzen keinen echten Treiber. Lokaler Verfügbarkeitscheck fand keine Chromium/Chrome/Firefox-/Playwright-/Desktop-Binaries, kein `DISPLAY` und keine installierten Playwright-/Puppeteer-Module. Es wurden keine Treiber heruntergeladen; beliebiger Host-Treiber wäre zudem keine Isolation.

Abschlussfolge:
1. Browser-, Desktop- und CLI-Treiber mit festgelegter Betreiber-Identität und isoliertem Netzwerk/Dateisystem bereitstellen.
2. Capability-Profile pro Instanz und Aktion begrenzen; Screenshots/OCR und Eingaben datenschutzgerecht behandeln.
3. Erfolgs-, Verweigerungs-, Timeout-, Crash- und Lease-Recovery-Pfade über den Execution Broker testen.
4. Reale Treiber-Ausführung mit Audit/Evidence/Provenance nachweisen; erst dann `CU-001` auf `PASS`.

**Blocker:** Kein realer, kontrolliert isolierter Browser-/Desktop-Treiber ist verfügbar. Der konfigurierbare Testadapter gilt nicht als Realgeräte-Nachweis.

### 3. P3 — `UI-003`: echter Browser-Nachweis

**Status: EXTERN BLOCKIERT / NOT_VERIFIED (geprüft 2026-10-02).** Es gibt in dieser Umgebung kein Browser-Binary, kein `DISPLAY` und kein Playwright/Puppeteer-Modul. jsdom-/HTTP-Tests ersetzen keinen echten Rendering-/Interaktionsnachweis; es wurde kein Browser heruntergeladen.

Abschlussfolge:
1. Verfügbaren, kontrollierten Browser/Playwright-Runner bereitstellen; keine Browser-Downloads oder externen Origins ohne Freigabe.
2. Produktivbuild starten und Kernpfade (Login, Control Center, Aktionen, Fehlerzustände, Responsive Layout) real bedienen.
3. Screenshots und Browser-/Console-Ergebnisse als Evidence archivieren.
4. `UI-003` erst mit reproduzierbarem Browser-Lauf auf `PASS` setzen.

**Blocker:** In der aktuellen Umgebung fehlen Browser-Binary und verifizierter Browser-Runner.

### 4. P4 — `LOAD-001`: Dauer-Lastnachweis

**Status: PARTIAL (fokussiert geprüft 2026-10-02).** Frischer begrenzter Production-HTTP-Lauf mit disposable Store/Rootfs: 40/40 erfolgreich bei Nebenläufigkeit 4, p95 503 ms / Budget 5.000 ms, `NAMESPACES`, Audit `FULL_CHAIN`, Store-Integrität 1. Eine 5-Run-Kontrolle mit 1-ms-Budget wurde erwartungsgemäß `BREACHED` (Exit 1), ohne Ausführungsfehler. JSON-Evidence und Messwerte sind in `docs/evidence/` und `docs/OPERATIONS.md` hinterlegt. Das erfüllt den begrenzten Nachweis, nicht den geforderten mehrstündigen Dauerlauf/Lastkurve.

Abschlussfolge:
1. Dauer, Lastprofil, p95-Latenz, Erfolgsquote, Fehlerbudget und Abbruchschwellen vor dem Lauf festlegen.
2. Mehrstündigen Lauf gegen den realen Build mit positiver und negativer Kontrollprobe ausführen.
3. Rohmetriken, SLO-Auswertung, Fehler und Recovery als unveränderliche Evidence speichern.
4. Wiederholbarkeit in einer geeigneten CI-/Betriebsumgebung belegen und erst dann `LOAD-001` auf `PASS` setzen.

## Abschluss-Gate

Nach jedem Einzelpunkt: fokussierte Tests → `npm run verify` → `node scripts/acceptance.mjs` → Matrix und Bericht aktualisieren. Keine Sammel-Abnahme: jeder Requirement-ID wird separat verifiziert. Keine `PASS`-Änderung aufgrund von Code-Existenz allein.
