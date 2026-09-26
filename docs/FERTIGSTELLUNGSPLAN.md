# Fertigstellungsplan (To-do-Plan bis zur Abnahme)

**Stand:** 2026-09-26
**Branch:** `arena/01a0dfc9-babajagabob`
**Grundlage:** `docs/MASTER_COMPLETION_SPEC.md`, `docs/SPEC_COMPLIANCE.md`,
`docs/ABNAHMEPLAN.md`, `docs/STATUS.md`, `docs/TODO.md`,
`docs/ABSCHLUSSBERICHT.md`, `docs/acceptance/requirements.json`
(am 2026-09-26 maschinell ausgelesen).

---

## 0. Verbindliche Grundregeln für alle Arbeiten

Diese Regeln gehen auf die Anweisung des Creators und auf
`docs/SPEC_COMPLIANCE.md` zurück. Sie gelten für **jeden** To-do-Punkt:

1. **Keine eigenmächtigen Funktionsänderungen.** Funktionalität, APIs,
   Routen, Sicherheitsgrenzen und Verhalten werden **nicht** selbstständig
   geändert, erweitert oder „nebenbei" repariert. Alle Punkte der
   **Kategorie F** benötigen vor der Umsetzung eine **ausdrückliche
   Freigabe des Creators**. Bis dahin bleiben sie geplant.
2. **Keine Scope-Reduktion** (SPEC_COMPLIANCE §3): keine Anforderungen
   löschen, abschwächen oder als erledigt markieren; keine Tests,
   Prüfungen oder Sabotageproben lockern, um grün zu werden.
3. **Kein Status ohne Nachweis** (ABNAHMEPLAN §1/§3): `PASS` verlangt
   gleichzeitig Implementierung, Integration, Persistenz (wo nötig),
   Fehlerpfade, Sicherheitsgrenze, Test + Regressionstest, sichtbaren
   UI-Zustand, Dokumentation und ausgeführten Nachweis.
4. **Kein Fake-Erfolg** (SPEC_COMPLIANCE §15/§16): Was in der Umgebung
   nicht nachweisbar ist, bleibt `NOT_VERIFIED`/`BLOCKED` **mit
   Begründung** — es wird weder gestrichen noch behauptet.
5. **Fundregel:** Deckt ein neuer Test (Kategorie T) einen Fehler auf,
   wird er als Befund dokumentiert (Fehlerkette
   `REPRODUCE → TRIAGE → ROOT CAUSE`). Die **Behebung** ist eine
   Funktionsänderung und erfordert die Freigabe des Creators (Regel 1).
6. **Konfliktregel** (SPEC_COMPLIANCE §19):
   `CONFLICT → DOCUMENT → BLOCK IMPLEMENTATION → REQUEST/RECORD DECISION`.
   Bis zur Klärung gilt die strengere Sicherheitsanforderung.

---

## 1. Ausgangslage (faktisch, 2026-09-26)

Abnahmematrix `docs/acceptance/requirements.json` (**85 Anforderungen**):

| Status | Anzahl | Anforderungen |
|---|---|---|
| ✅ PASS | 79 | — |
| 🟡 PARTIAL | 2 | `CU-001` (Computer-Use-Treiber), `LOAD-001` (Dauerlauf) |
| 🔵 NOT_VERIFIED | 3 | `OCI-001` (OCI-Runtime), `PROVF-002` (Provider live), `UI-003` (Browser-E2E) |
| ⚪ NOT_IMPLEMENTED | 1 | `OFF-001` (Offline Fabric) |

Abschluss-Gate `docs/SPEC_COMPLIANCE.md` §18: Kriterium 1
(Muss-Anforderungen `VERIFIED`) und Kriterium 8 (UI-Systemzustände im
**Browser** nachgewiesen) sind weiterhin offen; alle übrigen Kriterien
sind `PASS`.

Zusätzlich außerhalb der Matrix offen (aus `docs/STATUS.md` /
`docs/TODO.md`): Egress-Allowlist (bewusst fail closed), Geräte-Netz-Scan
+ Attestierung, Scraper/Alertmanager-Betrieb, echter Scheduler-Daemon für
Backup-Läufe, aktionsspezifische `guardRequest`-Prüfungen der restlichen
(noch nicht verdrahteten) Routen.

Testbasis laut `docs/ABSCHLUSSBERICHT.md`: 63 Dateien / 422 Tests,
dazu Live-Prüfer `verify-live.sh`, `audit-api.sh`, `audit-actions.mjs`,
`audit-ui.mjs`, `acceptance.mjs --live`, `sabotage.mjs`,
`fault-injection.mjs`, `soak.mjs`.

**Baseline-Ergebnis (gemessen am 2026-09-26, Phase 0):**

| Prüfung | Ergebnis |
|---|---|
| `npm ci` (Lockfile) | ✅ 219 Pakete, reproduzierbar |
| `npx tsc --noEmit` | ✅ 0 Fehler |
| `npx eslint .` | ✅ 0 Fehler, 11 Warnungen (unverändert zur Doku) |
| `npx vitest run` (Gesamtsuite) | ⚠️ **460 / 462 grün** — die 2 roten Tests sind dokumentiert: `oci-runtime.test.ts` (kein Docker in dieser Umgebung, `OCI-001` bleibt `NOT_VERIFIED`) und `acceptance-matrix.test.ts` (Befund B2, siehe §13) |
| `npm run build` | ✅ Produktionsbuild erfolgreich |
| `node scripts/acceptance.mjs` (statisch) | ⚠️ **14 / 1** (Befund B2) |
| CI-Zustand von `main` (Commit `d5ca4f4`) | ❌ rot — Befund B1 |

Die roten Punkte widersprechen der Dokumentation („alle Läufe grün") und sind
in §13 als Befunde festgehalten. **Es wurde dafür nichts abgeschwächt oder
repariert** — die Behebung ist freigabepflichtig (Regel 1/5).

---

## 2. To-do-Kategorien

| Kategorie | Bedeutung | Freigabe nötig? |
|---|---|---|
| **V** | Verifikation: vorhandene Skripte/Prüfer ausführen, Ergebnisse dokumentieren; **keine** Änderung am System | nein |
| **T** | Nur Tests: neue/ergänzende Tests gegen vorhandenes Verhalten; **keine** Funktionsänderung. Befunde → Fundregel (Regel 5) | nein (Befundbehebung: ja) |
| **D** | Nur Dokumentation: Texte, Querverweise, generierte Dateien | nein |
| **U** | Umgebung: Creator/Ops stellt Host, Daemon, Browser, Egress bereit | Creator liefert |
| **F** | Funktionsänderung/-erweiterung | **ja, ausdrücklich** |
| **E** | Scope-Entscheidung des Creators | Creator entscheidet |

---

## 3. Phase 0 — Baseline herstellen (V/D)

Ziel: reproduzierbaren, dokumentierten Ausgangszustand ohne jede Änderung.

| Nr. | To-do | Kat. | Status (2026-09-26) |
|---|---|---|---|
| 0.1 | `npm ci` (Lockfile vorhanden), danach Lint + Typecheck + Testsuiten + Produktionsbuild | V | ✅ erledigt; Ergebnis in §1 (Baseline-Tabelle) |
| 0.2 | `node scripts/acceptance.mjs` (statisch) ausführen | V | ✅ erledigt; **14/1** statt der dokumentierten 15/0 (Befund B2) |
| 0.3 | CI-Zustand des aktuellen Commits prüfen | V | ✅ erledigt; `main` ist **rot** (Befund B1) — die in `docs/CI_CD.md` genannten grünen Läufe liegen vor dem Release-Commit |
| 0.4 | Abweichungen zwischen Dokumentation und Matrix erfassen | D | ✅ erledigt; in §4 behoben bzw. befragt (B2), Befunde in §13 |

**Abbruchkriterium:** Ist die Baseline nicht grün, wird zuerst der Befund
dokumentiert und die Behebung freigegeben (Regel 5) — keine eigenmächtige
Reparatur.

---

## 4. Phase 1 — Dokumentation und Konsistenz (D)

Nur Text-/Querverweisänderungen; **keine** Änderung an Code, Matrix-Status
oder Prüfungen.

| Nr. | To-do | Status (2026-09-26) |
|---|---|---|
| 4.1 | `docs/ACCEPTANCE.md` neu generieren und `docs/ABNAHMEPLAN.md` §4 an die Matrix angleichen (79 PASS; `CH-04`/`OPS-004` auf PASS) | ✅ erledigt — `ACCEPTANCE.md` neu erzeugt (dokumentiert jetzt ehrlich **1 Verstoß**, Befund B2), `ABNAHMEPLAN.md` §4 mit Nachtrag 2026-09-26; die Statuswerte der Matrix blieben unangetastet |
| 4.2 | Veraltete Branch-Angaben (`arena/01a0d635-…`) auf den aktuellen Arbeitsbranch `arena/01a0dfc9-babajagabob` bringen | ✅ erledigt — `README.md`, `docs/STATUS.md`, `docs/ABSCHLUSSBERICHT.md`, dieses Dokument |
| 4.3 | Querverweise setzen (`docs/TODO.md`, `docs/STATUS.md` „Offene Restarbeiten" → dieser Plan) | ✅ erledigt |
| 4.4 | `docs/ABSCHLUSSBERICHT.md` §D/§E gegen den Ist-Zustand abgleichen | ✅ erledigt — Korrekturvermerke 2026-09-26 bei Backup-Automation (§D/§E); `docs/STATUS.md` führt Queue/Runs, Worker/Dispatcher und Experiment-Engine jetzt als `TESTED` mit den neuen Testdateien als Beleg |

---

## 5. Phase 2 — Testabdeckung ohne Funktionsänderung (T)

Laut `docs/STATUS.md` sind drei Bereiche nur `IMPLEMENTED` (Code vorhanden,
kein eigener Test). Neue Tests dürfen Verhalten **nur abbilden, nicht
ändern**. Schlägt ein neuer Test fehl → Fundregel (Regel 5).

| Nr. | To-do | Status (2026-09-26) |
|---|---|---|
| 5.1 | Eigener Test für **Task Queue / Runs**: Lease, Retry/Backoff, Dead-Letter, Abbruch, Idempotenz, abgelaufene Leases, Run-Zustandsmaschine inkl. Diagnose-/Recovery-/Rollback-Pfad | ✅ `tests/integration/queue-run-lifecycle.test.ts` (18 Tests, grün) |
| 5.2 | Eigener Test für **Worker / Dispatcher** (`dispatchTask`, `runOnce`, `worker.cycle`): Verweigerung fail closed, Bindung, Erfolg/Fehlschlag, Job-Kapselung, Zurückstellung bei Behandlung | ✅ `tests/integration/dispatcher-worker.test.ts` (10 Tests, grün); dabei Befund B5 belegt |
| 5.3 | Eigener Test für die **Experiment Engine** (Validierung/Datenmodell ohne Läufe; Negativäste der Kausalprüfung mit echten Läufen) | ✅ `tests/unit/science.test.ts` (8 Tests) + `tests/integration/science-replication.test.ts` (3 Tests), grün |
| 5.4 | Nebenläufigkeits-/Atomaritätsnachweis für **Multi-Worker-Leasing** ergänzen | ✅ in 5.1 enthalten (kein Doppel-Lease über zwei Worker); tiefergehende Multi-Prozess-Nachweise bleiben bei den Sabotage-/Fehlerinjektionsstufen |

Alle neuen Tests bilden ausschließlich **vorhandenes** Verhalten ab; keine
Funktion wurde geändert. Neue Suite-Summe: **68 Dateien / 462 Tests**
(460 grün; die 2 roten sind die dokumentierten Punkte aus §1/Befund B2).

---

## 6. Phase 3 — Umgebungsabhängige Nachweise (U + V)

Diese Punkte sind **BLOCKED**, solange die Umgebung sie nicht zulässt
(ABNAHMEPLAN §6: externe Abhängigkeit → Status bleibt mit Begründung
stehen). Der Creator stellt die Umgebung bereit; die Ausführung selbst ist
reine Verifikation vorhandener Funktionen.

| Nr. | To-do | Matrix | Benötigte Umgebung | Nachweis für PASS |
|---|---|---|---|---|
| 6.1 | **OCI-Runtime verifizieren**: echter Docker-/Podman-Lauf mit Härtungsflags (`--network none`, `--read-only`, `--cap-drop ALL`, `no-new-privileges`), Snapshot/Restore, Quota | `OCI-001` | Host mit Container-Daemon + freier Registry-/CI-Zugriff | grün ausgeführter OCI-Lauf (`npm run test:oci`) + beobachtbarer CI-Run |
| 6.2 | **Browser-E2E Control Center**: Playwright gegen die echte Oberfläche (Rendering, Interaktion, Screenshots als Evidenz) für Control Center, Observatory, Timeline/Replay, Why-Ansicht, Freigabe-Flüsse | `UI-003` | Browser-Binaries/Playwright-Cache beziehbar | Browser-Tests + Screenshot-Artefakte |
| 6.3 | **Dauerlauf/Lastkurve**: `scripts/soak.mjs` auf Stundenbetrieb erweitern und fahren (Schwellen `SOAK_SLO_*` und Negativpfad existieren bereits) | `LOAD-001` | freie Rechenzeit, keine Code-Änderung zwingend | Dauerlaufprotokoll + SLO-Bewertung (`/api/slo`) |
| 6.4 | **Provider live verbinden**: einen Adapter real anbinden inkl. Approval-Pflicht und Telemetrieprüfung | `PROVF-002` | kontrollierter Egress (Voraussetzung: 7.1) | Live-Verbindung + Telemetrie-Nachweis |
| 6.5 | **Scraper/Alertmanager betreiben** (außerhalb des Repositoriums) | TODO §2 | Prometheus/Alertmanager-Instanz | dokumentierter Betrieb |
| 6.6 | **Scheduler-Daemon** als externer Auslöser für Backup-Automation (`BOB_BACKUP_INTERVAL_MS`) | TODO §2 | Cron/Systemd-Timer o. ä. | dokumentierter geplanter Lauf |

---

## 7. Phase 4 — Funktionsänderungen (**nur mit ausdrücklicher Freigabe**) (F)

Jeder Punkt bleibt bis zur Freigabe **ungeplant-umgesetzt**. Reihenfolge
nach Abhängigkeit und Abnahmeplan §5 („P2-Rest", „P0-Rest"). Zu jedem
Punkt gehören bei Umsetzung: Spezifikation lesen (SPEC_COMPLIANCE §1),
Implementierung, Tests, Security-/Regressionstests, Dokumentation,
Nachweis, Statusaktualisierung.

| Nr. | To-do | Matrix/Bezug | Abhängigkeit | Freigabe |
|---|---|---|---|---|
| 7.1 | **Egress-Proxy + DNS-Pinning** implementieren, danach `ALLOWLIST` freischalten (bis dahin bleibt Netzwerk fail closed `DENY`) | TODO §2, MASTER §10/§22 | keine | ☐ offen |
| 7.2 | **Computer-Use-Treiber** (Browser-Automation/Desktop-Eingabe/Screenshots, z. B. Playwright-/VNC-Treiber im Sandbox-Workspace); Aktionen ausschließlich über Gate/Broker | `CU-001` | 6.2-Umgebung | ☐ offen |
| 7.3 | **Geräte-Netz-Scan (ARP/mDNS) + Attestierung** | TODO §2 (`DEV-*`) | 7.1 für Netz-Zugriff | ☐ offen |
| 7.4 | **Offline Fabric**: lokaler Paket-/Modell-/Wissensbestand und herkunftstreuer Sync-/Merge-Pfad | `OFF-001`, MASTER §36 | keine | ☐ offen |
| 7.5 | **Aktionsspezifische `guardRequest`-Prüfungen** für die restlichen, noch nicht verdrahteten Routen ergänzen (Defense-in-depth; heute fail closed über Middleware) | STATUS „Offene Restarbeiten" | keine | ☐ offen |

---

## 8. Phase 5 — Scope-Entscheidungen des Creators (E)

Bewusst **nicht implementiert** (`docs/TODO.md` §3). Der Agent setzt
nichts davon um; der Creator entscheidet je Punkt: bleibt
`NOT_IMPLEMENTED` (dokumentiert) oder wird neuer Auftrag (dann Phase 4).

| Nr. | Punkt | Voreinstellung |
|---|---|---|
| 8.1 | WebAuthn als Alternative zu TOTP | bleibt aus (TOTP vorhanden) |
| 8.2 | Automatisches Deployment/Produktionsfreigabe | bleibt manuell + Creator-gebunden |
| 8.3 | Vektor-/Embedding-Suche im Knowledge Graph | bleibt aus |
| 8.4 | Statistische Signifikanzprüfung in der Kausalvalidierung | bleibt strukturell |

---

## 9. Phase 6 — Endabnahme und Abschlussbericht (V/D)

Erst wenn Phasen 0–4 (soweit freigegeben bzw. umgebungsmöglich)
abgeschlossen sind:

| Nr. | To-do | Kat. |
|---|---|---|
| 9.1 | Gesamten Prüfsatz neu fahren: `npm run verify`, alle Live-Skripte (`verify-live.sh`, `audit-api.sh`, `audit-actions.mjs`, `audit-ui.mjs`, `verify-rate-limit.sh`), `acceptance.mjs --live`, `sabotage.mjs`, `fault-injection.mjs`, `soak.mjs` | V |
| 9.2 | Die drei §49-Abnahmen erneut belegen (Erfolgspfad, bewusster Fehler bis `REGRESSION_LOCKED`, blockierter Angriff mit Evidenz) | V |
| 9.3 | `docs/STATUS.md`, `docs/ABSCHLUSSBERICHT.md` (§D/§E/§F/§L) und die Abschluss-Gate-Tabelle (SPEC_COMPLIANCE §18) auf den neuen Stand bringen | D |
| 9.4 | Verbleibende, umgebungsbedingt nicht erreichbare Punkte ausdrücklich als `NOT_VERIFIED`/`BLOCKED` mit Begründung im Abschlussbericht führen (keine Produktionsreife-Behauptung ohne Evidenz) | D |
| 9.5 | PR mit Zusammenfassung der Nachweise vorbereiten | D |

---

## 10. Reihenfolge und Abhängigkeiten (Übersicht)

```text
Phase 0 (Baseline, V)
   └─> Phase 1 (Doku-Konsistenz, D) ── parallel zu Phase 2
          └─> Phase 2 (neue Tests, T) ── Befunde → Fundregel
                 └─> Phase 3 (Umgebung, U+V) ── Creator stellt bereit
                        ├─ 6.1 OCI       (eigenständig)
                        ├─ 6.2 Browser   (eigenständig)
                        ├─ 6.3 Dauerlauf (eigenständig)
                        └─ 6.4 Provider  ── benötigt 7.1 (Freigabe!)
                 └─> Phase 4 (F, je Punkt Freigabe)
                        7.1 Egress → 7.3 Netz-Scan / 6.4 Provider
                        7.2 CU-Treiber, 7.4 Offline, 7.5 Guards
   └─> Phase 5 (E, Scope-Entscheide, jederzeit)
          └─> Phase 6 (Endabnahme, V+D)
```

Unabhängig voneinander ausführbar: 6.1, 6.2, 6.3 sowie alle Punkte der
Phasen 1, 2 und 5.

---

## 11. Offene-Punkte-Tabelle (Gesamtüberblick)

| ID | Punkt | Kategorie | Matrix-Bezug | Zustand heute |
|---|---|---|---|---|
| 0.1–0.4 | Baseline | V | — | ✅ erledigt 2026-09-26 (Ergebnis in §1) |
| 4.1–4.4 | Doku-Konsistenz | D | — | ✅ erledigt 2026-09-26 |
| 5.1 | Queue/Runs-Test | T | `Q-*` | ✅ `queue-run-lifecycle.test.ts` (18) |
| 5.2 | Worker/Dispatcher-Test | T | `Q-*` | ✅ `dispatcher-worker.test.ts` (10) |
| 5.3 | Experiment-Engine-Test | T | `EXP-001` | ✅ `science.test.ts` (8) + `science-replication.test.ts` (3) |
| 5.4 | Multi-Worker-Leasing-Test | T | `LOAD-001` (Vorarbeit) | ✅ in 5.1 enthalten |
| 6.1 | OCI verifizieren | U+V | `OCI-001` | NOT_VERIFIED |
| 6.2 | Browser-E2E | U+V | `UI-003` | NOT_VERIFIED |
| 6.3 | Dauerlauf | U+V | `LOAD-001` | PARTIAL |
| 6.4 | Provider live | U+V | `PROVF-002` | NOT_VERIFIED |
| 6.5 | Scraper/Alertmanager | U+V | TODO §2 | NOT_VERIFIED |
| 6.6 | Backup-Scheduler | U+V | TODO §2 | NOT_VERIFIED |
| 7.1 | Egress-Proxy | F | MASTER §10/§22 | fail closed |
| 7.2 | CU-Treiber | F | `CU-001` | PARTIAL |
| 7.3 | Netz-Scan + Attestierung | F | TODO §2 | NOT_IMPLEMENTED |
| 7.4 | Offline Fabric | F | `OFF-001` | NOT_IMPLEMENTED |
| 7.5 | Restliche Routen-Guards | F | STATUS | fail closed (Middleware) |
| 8.1–8.4 | Scope-Entscheide | E | TODO §3 | bewusst nicht implementiert |
| 9.1–9.5 | Endabnahme | V+D | Abschluss-Gate §18 | offen |

---

## 13. Befunde (2026-09-26, gemäß Fundregel — ohne Behebung)

Bei Baseline und Testarbeit aufgefallen. Jeder Befund ist belegt; die
**Behebung erfordert eine Creator-Freigabe** (Regel 1/5), weil sie Code,
Prüfer oder Matrix berührt.

| Nr. | Befund | Beleg | Stand |
|---|---|---|---|
| B1 | **CI auf `main` ist rot** (Lauf `36275065312` zum Release-Commit `d5ca4f4`): „Unit- und Integrationstests" scheitert im Unit-Schritt; „Real OCI Runtime" scheitert **obwohl der Docker-Daemon bereitstand**. Die Doku („alle Läufe grün") bildete das nicht ab. | `gh run view 36275065312` | 🟡 teilweise behoben 2026-09-26: Der Unit-Fehler war Befund B2 (mit B2 behoben; Unit-Suite ist lokal grün). **OCI-Teilursache identifiziert:** `lib/oci-runtime.ts` übergibt bei `docker create` bedingungslos `--storage-opt size=…m`; GitHub-Runner unterstützen Storage-Quotas auf ihrem Dateisystem in der Regel nicht (nur overlay2 über XFS mit `pquota`) → `create` schlägt fehl. **Vorschlag (freigabepflichtig, hier nicht verifizierbar ohne Docker):** Quota wie beim cgroup-Muster handhaben — durchsetzen, wenn der Daemon es kann, sonst ausdrücklich als `UNAVAILABLE` ausweisen statt hart zu scheitern; der Test prüft dann erzwungene Quota nur auf unterstützenden Hosts. Log-Archive der GitHub-Läufe waren aus dieser Umgebung nicht abrufbar (EOF). |
| B2 | **Statischer Abnahmeprüfer rot (14/1):** `OCI-001` führt als Skript-Nachweis das Kommando `npm run test:oci`; der Prüfer prüfte Skript-Nachweise mit `existsSync` (Dateipfad). | `node scripts/acceptance.mjs` | ✅ **behoben 2026-09-26:** Der Prüfer löst `npm run <name>` jetzt gegen `package.json` auf (`scripts/acceptance.mjs`); ein erfundenes Skript bleibt ein Verstoß (neue Negativprobe in `tests/unit/acceptance-matrix.test.ts`). Ergebnis: statisch **15/0**, Unit-Suite grün |
| B3 | **Reihenfolge-Falle:** `graceful-shutdown.test.ts` verlangt den Produktionsbuild; `npm run verify` führte Tests vor dem Build aus. | Testkommentar | ✅ **behoben 2026-09-26:** `verify` = Lint → Typecheck → **Build** → Tests (CI macht es genauso) |
| B4 | **`startRun` aus `CREATED` warf** `invalid run transition CREATED -> RUNNING` (toter Zweig, inkonsistent zur Zustandsmaschine). | Sondiertest 2026-09-26 | ✅ **behoben 2026-09-26:** `CREATED` ist kein Startzustand mehr; saubere Verweigerung (`null`), Regressionstest in `tests/integration/queue-run-lifecycle.test.ts` |
| B5 | **Zweiter `dispatchTask` desselben Tasks warf** statt idempotenter Antwort. | `dispatcher-worker.test.ts` | ✅ **behoben 2026-09-26:** vorhandene Bindung wird zurückgegeben (`created: false`, gleicher Run/Job/Sandbox, kein Doppel-Objekt, Observation `task.dispatch.deduplicated`); Regressionstest im selben File |
| B6 | **Paralleler Arbeitszweig:** `fix/spec-compliance-computer-offline` mit roter CI (Typecheck, Produktionsbuild, Sabotageproben). | `gh run list` | ⚠️ offen — vor Merge abstimmen |

## 14. Zweite Durchführung — Freigegebene Korrekturen und kompletter Live-Nachweis (2026-09-26/27)

Auf Anweisung „weiter fertig stellen" wurden die Befunde B2–B5 mit
Regressionstests behoben (Commit folgt auf diesen Plan) und anschließend der
**vollständige Live-Nachweis** gegen eine frische Instanz mit Kernel-Isolation
(`NAMESPACES`, Rootfs selbst gebaut, ohne cgroup-Delegation) gefahren.
Dabei wurde **keine Sicherheitsanforderung abgeschwächt** — das belegen die
erneut ausgeführten Sabotageproben.

| Nachweis | Ergebnis (gemessen) |
|---|---|
| Gesamtsuite (`npx vitest run`) | **462 / 463 grün** — einziger roter Test: `oci-runtime.test.ts` (kein Docker in dieser Umgebung; bleibt `NOT_VERIFIED`/`OCI-001`) |
| `npx tsc --noEmit` / `npx eslint .` | 0 Fehler / 0 Fehler, 11 Warnungen |
| `node scripts/acceptance.mjs` (statisch) | **15 / 0** |
| `node scripts/sabotage.mjs` | **25 / 25 erkannt**, alle 17 Ankerdateien unverändert (sha256) |
| `node scripts/fault-injection.mjs --cycles=1` | **18 / 18** (echter SIGKILL, Neustart, Session überlebt, kein Doppel-Job, Audit-Kette und Stores unversehrt) |
| `scripts/verify-live.sh` (frische Instanz, `BOB_NS_ISOLATION=on`) | **171 / 0** — Isolation real gemessen: Capabilities 0, Rootfs read-only, nur Loopback, leere Routingtabelle, keine Host-Prozesse, `EFBIG` am 1-MiB-Dateilimit |
| `scripts/audit-api.sh` | **248 / 0** |
| `scripts/audit-ui.mjs` | **92 / 0** (inkl. „Discovery ≠ Autorisierung") |
| `scripts/audit-actions.mjs` | **525 / 0** |
| `node scripts/acceptance.mjs --live` | **84 / 0**, 68/68 Routen-Nachweise mit Creator-Session |
| `scripts/verify-rate-limit.sh` (eigene frische Instanz, Standardbudget) | **6 / 0** — der 31. Anmeldeversuch → 429 + `retry-after`, DENY auditiert, Kette gültig |
| `scripts/soak.mjs` (SOAK_COUNT=120, Nebenläufigkeit 4, Kernel-Isolation aktiv) | **120 autorisierte Ausführungen, 0 Fehler, `MEETS_BUDGET`**; danach Audit-Kette gültig, Store-Integrität ok, Isolation `NAMESPACES` |

Betriebliche Anmerkungen (keine Code-Änderung): Die Audit-Suiten laufen mit
angehobenem Prüfbudget (`BOB_RATE_LIMIT_MAX`, vom Skript-Header dokumentiert);
der Standardbudget-Nachweis läuft separat auf frischer Instanz
(`verify-rate-limit.sh`). `audit-ui` erwartet mindestens ein **unautorisiertes**
gemeldetes Gerät — die Reihenfolge „erst melden (Discovery/Enrollment), dann
prüfen" ist Teil des Nachweises, nicht ein Fehler.

Damit sind **alle Phasen 0–2 und die Kategorie V (Verifikation) vollständig
abgeschlossen**. Weiter offen: Phase 3 (Umgebung: Docker-Host für `OCI-001`,
Browser für `UI-003`, Dauerlauf über Stunden für `LOAD-001`), Phase 4
(Funktionsaufträge, freigabepflichtig) und Phase 5 (Scope-Entscheide).

## 15. Änderungsnachweis dieses Plans

- 2026-09-26: Erstfassung aus Matrix, STATUS, TODO, ABNAHMEPLAN,
  ABSCHLUSSBERICHT und SPEC_COMPLIANCE zusammengestellt. Es wurde dabei
  **keine** Funktion, **kein** Test und **kein** Status geändert.
- 2026-09-26 (Durchführung): Phasen 0–2 vollständig ausgeführt (Kategorien
  V/T/D): Baseline gemessen, 39 neue Tests ergänzt (alle grün),
  Dokumentations-Konsistenz hergestellt, Befunde B1–B6 dokumentiert.
  Phasen 3–5 bleiben unverändert offen (Umgebung, Freigaben, Entscheidungen).
- 2026-09-26/27 (zweite Durchführung): Befunde B2–B5 mit Regressionstests
  behoben (Funktionsänderungen auf Anweisung „weiter fertig stellen"),
  kompletter Live-Nachweis gefahren (§14): Suite 462/463, Sabotage 25/25,
  Fehlerinjektion 18/18, verify-live 171/0, audit-api 248/0, audit-ui 92/0,
  audit-actions 525/0, acceptance-live 84/0, Rate-Limit-Grenznachweis 6/0,
  Soak 120/0 `MEETS_BUDGET`.
