# Laufende To-do-Liste und Fertigstellungs-Checkliste (P0 → P5)

**Zuletzt aktualisiert:** 2026-10-02.

`docs/acceptance/requirements.json` bleibt die Anforderungsquelle für alle 85 Einzelanforderungen. Diese Liste enthält die aktuell nicht vollständig abgenommenen Anforderungen, ordnet sie strikt nach Phase und hält Blocker sowie konkrete Abschlussnachweise fest. Ein Eintrag wird nur geschlossen, wenn seine Matrix-Anforderung `PASS` erreicht oder die Abhängigkeit ausdrücklich als extern blockiert dokumentiert ist; externe Blockaden werden dadurch **nicht** in `PASS` umgedeutet.

## Baseline

- Matrix-Snapshot nach dem fehlgeschlagenen echten OCI-CI-Nachweis: **80 PASS / 2 PARTIAL / 1 FAIL / 2 NOT_VERIFIED / 0 NOT_IMPLEMENTED**.
- P1: **20/20 PASS**.
- Lokales Gesamt-Gate nach den Änderungen: `BOB_CI=1 BOB_SANDBOX_RUNTIME=local npm run verify` — **Lint 0 Fehler/11 bestehende Warnungen, Typecheck und Build erfolgreich, 68 Testdateien mit 442 bestanden/1 übersprungen** (OCI-Lifecycle mangels lokalem Docker).
- CI-Wrapper lokal geprüft: `node scripts/ci-vitest-diagnostics.mjs test:integration` — **24 Dateien, 139 Tests bestanden/1 OCI-Test übersprungen**; synthetischer Fehlerlauf belegte Step-Summary, Check-Run-Annotation und Exit 1.
- Abnahme-Prüfer: `node scripts/acceptance.mjs` (**15/15 statische Prüfschritte bestanden**).
- GitHub Actions `37002968100` auf Commit `71b67ae`: **fehlgeschlagen**. Im OCI-Job waren Docker-Daemon und Image-Pull erfolgreich, der echte Lifecycle-Test endete mit Exit 1; auch der CI-Integrationsschritt endete mit Exit 1. Unit-Tests, Lint/Typecheck, Security/E2E, Sabotageproben und Produktionsbuild waren erfolgreich; das Verification Gate wurde übersprungen. Fehlerdetails der zwei Jobs waren wegen TLS/SSL-EOF beim Download des Actions-Logarchivs nicht abrufbar. Siehe `docs/evidence/oci-001-ci-failure-2026-10-02.json`.
- `OCI-001` ist deshalb `FAIL` (nicht `PASS` und nicht bloß lokal `NOT_VERIFIED`); die nächste CI-Ausführung sammelt bei Testfehlern Details in Check-Run-Annotation und Step-Summary.

## Aktuelle To-do-Liste (nach Phase geordnet; Status pro Fortsetzung aktualisieren)

| Reihenfolge | Requirement | Status | Nächster konkreter Schritt |
|---:|---|---|---|
| 1 | P0 `OCI-001` | `FAIL` — echter Lifecycle-Test in GitHub Actions fehlgeschlagen (Run `37002968100`, Commit `71b67ae`); Fehlerdetail noch nicht verfügbar | Diagnostik-Wrapper `scripts/ci-vitest-diagnostics.mjs` auf den festen Arena-Branch pushen; den nächsten Real-Docker-Lauf prüfen; konkrete fehlerhafte Docker-Operation/Assertion korrigieren und den Lifecycle-Test erfolgreich wiederholen, bevor der Matrixstatus geändert wird. |
| 2 | P2 `PROVF-002` | `NOT_VERIFIED` — extern blockiert | Provider/Endpoint auswählen, kontrollierten Egress freigeben und Credential ausschließlich per Secret Store anbinden; Live-Adapterlauf mit Telemetrie belegen. |
| 3 | P2 `CU-001` | `PARTIAL` | Kontrollierte, isolierte Browser-/Desktop-/CLI-Treiber bereitstellen; Broker-Erfolg und Negativ-/Recovery-Pfade real testen. |
| 4 | P3 `UI-003` | `NOT_VERIFIED` — extern blockiert | Browser-fähigen Runner bereitstellen; Login/Kernpfade real bedienen und Screenshots/Console-Evidence archivieren. |
| 5 | P4 `LOAD-001` | `PARTIAL` | Begrenzter 40-Run mit NAMESPACES und 5-Run-Negativkontrolle bestanden; jetzt Mehrstundendauer/Abbruchregeln festlegen und Soak-Bericht/Evidence wiederholbar in CI/Betrieb sichern. Defaults: 4 Worker, p95 ≤ 5 s, Erfolgsquote ≥ 100 %. |

`OFF-001` ist in diesem Lauf mit `PASS` abgeschlossen (Details unten). Diese To-do-Liste bleibt die laufende Arbeitsliste; in jeder Fortsetzung werden Reihenfolge, Status, Blocker und nächste Aktion aktualisiert und im Chat wieder ausgegeben. Externe Blockaden bleiben `NOT_VERIFIED` und werden nie in `PASS` umgedeutet.

## In diesem Durchlauf abgenommen

### P2 — `OFF-001`: Offline-Arbeit und provenance-erhaltender Sync

**Status: PASS (2026-10-02).** `npm run test:offline:isolated` bestanden (4/4): temporäres Rootfs + `NAMESPACES`, Creator-geschützter Paketimport und lokale Aktivierung gegen Task-/Plan-/Sandbox-Bindungen in einem separaten Receiver-Storage-Root sowie lokale Broker-Ausführung mit einem digest-gepinnten, vom Betreiber gestagten Asset. Der Receiver exportierte signierte Evidence und Provenance; der Rückimport prüft Evidence-, Receiver-Task-/Sandbox- und Paket-IDs, deren Provenance-Kanten sowie den bewahrten Paket-Zeitstempel. `npm run test:offline` bestanden (10/10); `npm run verify` bestanden (68 Testdateien, 442 bestanden, 1 übersprungen; der OCI-Runtime-Test wird ohne Docker übersprungen).

**Umfangsgrenze:** Der Receiver ist eine separate-Storage-Integration im selben Prozess, kein physischer Mehrhost-Transporttest. Betreiber stagen lokale Assets über vertrauenswürdige Offline-Medien. Anwendungsseitiger Asset-Transport und OCI-Asset-Mounting sind separate Scopes und keine OFF-001-Blocker.

## Geordnete Restliste

### 1. P0 — `OCI-001`: echte Docker-Abnahme

**Status: FAIL (geprüft 2026-10-02).** Auf Commit `71b67aee09f46f9541408b0bcc20027d24ac33b3` lief der echte GitHub-Docker-Job: `docker version` und der Pull von `alpine:3.20` waren erfolgreich, aber `npm run test:oci` endete im Schritt „OCI lifecycle against real Docker“ mit Exit 1. Damit liegt ein fehlgeschlagener Real-OCI-Nachweis vor; er wird weder als PASS noch als bloß fehlende Docker-Abhängigkeit verbucht. Die Logs liefern über die verfügbaren Check-Run-Annotationen nur „Process completed with exit code 1“; der Job-Logdownload endete nach dem Redirect zum Actions-Result-Blob-Store mit TLS/SSL-EOF. Die festgehaltenen Job-/Step-Ergebnisse und Abrufgrenze stehen in `docs/evidence/oci-001-ci-failure-2026-10-02.json`. Lokal ist kein Docker-Daemon verfügbar; dort werden die zwei Command-Contract-Tests ausgeführt, während der Lifecycle-Test übersprungen wird. Das ist kein OCI-Lifecycle-Nachweis.

Abschlussfolge:
1. Den CI-Diagnostik-Wrapper `scripts/ci-vitest-diagnostics.mjs` auf den festen Arena-Branch übertragen; bei Fehlern schreibt er den Testausschnitt in Step-Summary und Check-Run-Annotation.
2. Den nächsten Real-Docker-Lauf samt Annotation/Summary auswerten, die konkrete fehlgeschlagene Operation oder Assertion beheben und den Test wiederholen.
3. `OCI-001` erst auf `PASS` setzen, wenn der echte Lifecycle-Test in Docker ohne Skip vollständig erfolgreich ist; Run-URL und Commit dann als positive Evidence dokumentieren.

**Blocker:** Ursache des CI-Testfehlers ist unbekannt, weil das Actions-Logarchiv in dieser Umgebung nicht abrufbar ist. Der nächste Schritt ist Diagnose und Reparatur, nicht eine externe Freigabe oder eine Statusanhebung.

### 2. P2 — `PROVF-002`: live Provider-Verbindung

**Status: EXTERN BLOCKIERT / NOT_VERIFIED (geprüft 2026-10-02).** Der Netzwerkpfad bleibt gemäß Vorgabe `DENY`; es gibt in dieser Abnahme keinen ausgewählten Provider/Endpoint, keine Creator-freigegebene Egress-Grenze und keine Secret-Store-Referenz für ein Live-Credential. Es wurde kein externer Aufruf versucht.

Abschlussfolge:
1. Einen konkreten Provider und eine kontrollierte, Creator-freigegebene Egress-Grenze bestimmen.
2. Credentials ausschließlich über Secret-Store zuführen; Netzwerkzugriff bleibt bis dahin `DENY`.
3. Einen echten Adapterlauf mit Telemetrie, Fehlerpfad, Audit und Provenance nachweisen.
4. Erst dann `PROVF-002` einzeln auf `PASS` setzen.

**Blocker:** Es gibt weder einen freigegebenen Provider/Secret noch kontrollierten Egress in dieser Umgebung.

### 3. P2 — `CU-001`: kontrollierte Browser-/Desktop-/CLI-Treiber

**Status: PARTIAL / EXTERNE TREIBER FEHLEN (geprüft 2026-10-02).** Registrierung, Autorisierung, Broker und Adaptergrenze sind vorhanden; Adaptertests ersetzen keinen echten Treiber. Lokaler Verfügbarkeitscheck fand keine Chromium/Chrome/Firefox-/Playwright-/Desktop-Binaries, kein `DISPLAY` und keine installierten Playwright-/Puppeteer-Module. Es wurden keine Treiber heruntergeladen; beliebiger Host-Treiber wäre zudem keine Isolation.

Abschlussfolge:
1. Browser-, Desktop- und CLI-Treiber mit festgelegter Betreiber-Identität und isoliertem Netzwerk/Dateisystem bereitstellen.
2. Capability-Profile pro Instanz und Aktion begrenzen; Screenshots/OCR und Eingaben datenschutzgerecht behandeln.
3. Erfolgs-, Verweigerungs-, Timeout-, Crash- und Lease-Recovery-Pfade über den Execution Broker testen.
4. Reale Treiber-Ausführung mit Audit/Evidence/Provenance nachweisen; erst dann `CU-001` auf `PASS`.

**Blocker:** Kein realer, kontrolliert isolierter Browser-/Desktop-Treiber ist verfügbar. Der konfigurierbare Testadapter gilt nicht als Realgeräte-Nachweis.

### 4. P3 — `UI-003`: echter Browser-Nachweis

**Status: EXTERN BLOCKIERT / NOT_VERIFIED (geprüft 2026-10-02).** Es gibt in dieser Umgebung kein Browser-Binary, kein `DISPLAY` und kein Playwright/Puppeteer-Modul. jsdom-/HTTP-Tests ersetzen keinen echten Rendering-/Interaktionsnachweis; es wurde kein Browser heruntergeladen.

Abschlussfolge:
1. Verfügbaren, kontrollierten Browser/Playwright-Runner bereitstellen; keine Browser-Downloads oder externen Origins ohne Freigabe.
2. Produktivbuild starten und Kernpfade (Login, Control Center, Aktionen, Fehlerzustände, Responsive Layout) real bedienen.
3. Screenshots und Browser-/Console-Ergebnisse als Evidence archivieren.
4. `UI-003` erst mit reproduzierbarem Browser-Lauf auf `PASS` setzen.

**Blocker:** In der aktuellen Umgebung fehlen Browser-Binary und verifizierter Browser-Runner.

### 5. P4 — `LOAD-001`: Dauer-Lastnachweis

**Status: PARTIAL (fokussiert geprüft 2026-10-02).** Frischer begrenzter Production-HTTP-Lauf mit disposable Store/Rootfs: 40/40 erfolgreich bei Nebenläufigkeit 4, p95 503 ms / Budget 5.000 ms, `NAMESPACES`, Audit `FULL_CHAIN`, Store-Integrität 1. Eine 5-Run-Kontrolle mit 1-ms-Budget wurde erwartungsgemäß `BREACHED` (Exit 1), ohne Ausführungsfehler. JSON-Evidence und Messwerte sind in `docs/evidence/` und `docs/OPERATIONS.md` hinterlegt. Das erfüllt den begrenzten Nachweis, nicht den geforderten mehrstündigen Dauerlauf/Lastkurve.

Abschlussfolge:
1. Dauer, Lastprofil, p95-Latenz, Erfolgsquote, Fehlerbudget und Abbruchschwellen vor dem Lauf festlegen.
2. Mehrstündigen Lauf gegen den realen Build mit positiver und negativer Kontrollprobe ausführen.
3. Rohmetriken, SLO-Auswertung, Fehler und Recovery als unveränderliche Evidence speichern.
4. Wiederholbarkeit in einer geeigneten CI-/Betriebsumgebung belegen und erst dann `LOAD-001` auf `PASS` setzen.

## Abschluss-Gate

Nach jedem Einzelpunkt: fokussierte Tests → `npm run verify` → `node scripts/acceptance.mjs` → Matrix und Bericht aktualisieren. Keine Sammel-Abnahme: jeder Requirement-ID wird separat verifiziert. Keine `PASS`-Änderung aufgrund von Code-Existenz allein.
