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
`fault-injection.mjs`, `soak.mjs`. Hinweis: In dieser Arbeitsumgebung sind
aktuell **keine Abhängigkeiten installiert** (`node_modules` fehlt) — die
Baseline (Phase 0) stellt den Prüfzustand erst wieder her.

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

| Nr. | To-do | Kat. | Nachweis |
|---|---|---|---|
| 0.1 | `npm ci` (Lockfile vorhanden), danach `npm run verify` = Lint + Typecheck + alle Testsuiten + Produktionsbuild; Ergebnis hier eintragen | V | Konsolenausgabe, Exit-Codes |
| 0.2 | `node scripts/acceptance.mjs` (statisch) ausführen; Erwartung laut letztem Stand: 15 Prüfungen / 0 Verstöße | V | Prüferausgabe |
| 0.3 | CI-Zustand des aktuellen Commits prüfen (letzte grüne Läufe in `docs/CI_CD.md` vermerken) | V | GitHub-Checks |
| 0.4 | Abweichungen zwischen Dokumentation und Matrix erfassen (siehe 4.1–4.3), **nur listen**, noch nichts ändern | D | Liste in diesem Plan |

**Abbruchkriterium:** Ist die Baseline nicht grün, wird zuerst der Befund
dokumentiert und die Behebung freigegeben (Regel 5) — keine eigenmächtige
Reparatur.

---

## 4. Phase 1 — Dokumentation und Konsistenz (D)

Nur Text-/Querverweisänderungen; **keine** Änderung an Code, Matrix-Status
oder Prüfungen.

| Nr. | To-do | Hinweis |
|---|---|---|
| 4.1 | `docs/ACCEPTANCE.md` neu generieren (`node scripts/acceptance.mjs --write`) und die Erzählung in `docs/ABNAHMEPLAN.md` §2/§4 angleichen: Die Tabelle dort nennt noch „77 PASS / 3 PARTIAL (inkl. CH-04) / 2 NOT_IMPLEMENTED (inkl. OPS-004)"; die Matrix führt aktuell **79 PASS**, `CH-04` und `OPS-004` auf `PASS`, nur noch 2 PARTIAL / 3 NOT_VERIFIED / 1 NOT_IMPLEMENTED | Statuswerte der Matrix selbst bleiben unangetastet |
| 4.2 | Veraltete Branch-Angaben aktualisieren: `README.md`, `docs/STATUS.md`, `docs/ABSCHLUSSBERICHT.md` nennen noch `arena/01a0d635-babajagabob`; aktueller Arbeitsbranch ist `arena/01a0dfc9-babajagabob` | nur Text |
| 4.3 | Querverweise setzen: `docs/TODO.md` und `docs/STATUS.md` („Offene Restarbeiten") verweisen auf diesen Plan; dieser Plan verweist zurück auf die Belegstellen | kein Inhalt verloren gehen lassen |
| 4.4 | `docs/ABSCHLUSSBERICHT.md` §D/§F/§L gegen die Matrix abgleichen (z. B. Betriebshärtung/Rate-Limit/Graceful-Shutdown ist heute belegt: `lib/api/rate-limit.ts`, `lib/shutdown.ts`, `tests/integration/graceful-shutdown.test.ts`, `scripts/verify-rate-limit.sh`) | nur Dokumentation des Ist-Zustands |

---

## 5. Phase 2 — Testabdeckung ohne Funktionsänderung (T)

Laut `docs/STATUS.md` sind drei Bereiche nur `IMPLEMENTED` (Code vorhanden,
kein eigener Test). Neue Tests dürfen Verhalten **nur abbilden, nicht
ändern**. Schlägt ein neuer Test fehl → Fundregel (Regel 5).

| Nr. | To-do | Bezug |
|---|---|---|
| 5.1 | Eigener Test für **Task Queue / Runs**: Lease, Retry/Backoff, Dead-Letter, Timeout, Abbruch, Idempotenz, abgelaufene Leases | STATUS-Zeile „Task Queue / Runs: IMPLEMENTED, kein eigener Test" |
| 5.2 | Eigener Test für **Worker / Dispatcher** (`worker.cycle`): Job-Kapselung, Fehlerpfad, Zurückstellen statt Retry aus `VERIFYING` | STATUS-Zeile „Worker / Dispatcher" |
| 5.3 | Eigener Test für die **Experiment Engine** (Baseline/Control/Replikation; Kausalvalidierung ist bisher nur über E2E mitabgedeckt) | STATUS-Zeile „Experiment Engine" |
| 5.4 | Nebenläufigkeits-/Atomaritätsnachweis für **Multi-Worker-Leasing** und persistente Stores ergänzen, soweit noch Lücken bestehen | DEEP_VERIFICATION-Ziel 9; vorhanden: `load-broker.test.ts`, Store-Revision + `rename`-Sperre |

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
| 0.1–0.4 | Baseline | V | — | offen |
| 4.1–4.4 | Doku-Konsistenz | D | — | offen |
| 5.1 | Queue/Runs-Test | T | `Q-*` | offen |
| 5.2 | Worker/Dispatcher-Test | T | `Q-*` | offen |
| 5.3 | Experiment-Engine-Test | T | `EXP-001` | offen |
| 5.4 | Multi-Worker-Leasing-Test | T | `LOAD-001` (Vorarbeit) | offen |
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

## 12. Änderungsnachweis dieses Plans

- 2026-09-26: Erstfassung aus Matrix, STATUS, TODO, ABNAHMEPLAN,
  ABSCHLUSSBERICHT und SPEC_COMPLIANCE zusammengestellt. Es wurde dabei
  **keine** Funktion, **kein** Test und **kein** Status geändert.
