# Abnahmeplan — von der Spezifikation zur laufenden Funktion

**Status dieses Dokuments:** verbindlicher Abnahmerahmen (eingefroren am 2026-09-25).
**Maschinenlesbare Quelle:** `docs/acceptance/requirements.json`.
**Prüfer:** `node scripts/acceptance.mjs` (statisch, in CI) und `… --live` (gegen einen laufenden Server).
**Generierte Übersicht:** `docs/ACCEPTANCE.md` (`node scripts/acceptance.mjs --write`).
**Letzter Prüferlauf:** 2026-09-25 → **15 Prüfungen bestanden, 0 fehlgeschlagen**; die
Abnahme-Selbsttests `tests/unit/acceptance-matrix.test.ts` (4/4) und
`tests/e2e/acceptance-chain.test.ts` (4/4, 18 Stufen) laufen mit.
**Live-Prüferlauf** gegen die Instanz `:3100` (cgroup-delegiert, `BOB_NS_ISOLATION=on`,
`BOB_DEVICE_ENROLLMENT_SECRET` gesetzt):
`node scripts/acceptance.mjs --live` → **84 bestanden / 0 fehlgeschlagen**, davon
**68/68 Routen-Nachweise** mit Creator-Session. Der Prüfer erkennt jetzt beide
Schreibweisen von `BOB_SESSION_COOKIE` (reiner Sitzungswert oder fertiger Cookie-Kopf) — zuvor
sahen gültige Sitzungen wie `401`-Fehlschläge aus, was ein Prüferfehler war und nicht
abgeschwächt, sondern behoben wurde. Zwei Nachweise waren zuerst falsch
modelliert (GET auf `POST`-Routen → 405) und wurden in der Matrix korrigiert — der
Prüfer wurde nicht abgeschwächt.
**Stand der Umsetzung:** P0 vollständig (außer `OCI-001`, extern), **P1 abgeschlossen**
(Status-Modell, Observatory und „Warum?" sind implementiert, getestet und live belegt),
P4 ohne offene Pflicht (Fehlerinjektion, Sabotageautomatisierung und Dauerlauf bleiben
benannte Lücken), P2/P3/P5 mit dokumentierten externen Abhängigkeiten bzw. Entscheidungen.

---

## 0. Zielzustand

Die Anwendung gilt erst dann als fertig, wenn dieser Ablauf **real** funktioniert und jede Stufe
über **API, Persistenz, Audit und Provenance** nachvollziehbar ist:

```
Creator → Mission → Agent → Plan → Sandbox → Experiment/Code → Execution Broker → Runtime
        → Beobachtung → Evidenz → Validierung → Artefakt → Test → Approval → Deployment
        → Monitoring → Recovery → Lernen
```

Jede der 18 Stufen ist in der Matrix als `CH-01` … `CH-18` geführt, mit Implementierung, Test,
Nachweis und UI-Sektion. Der Durchlauf über alle Stufen ist als Test
`tests/e2e/acceptance-chain.test.ts` hinterlegt.

## 1. Die Regel, die alles zusammenhält

> **Kein Status ohne Nachweis.**

`PASS` verlangt **gleichzeitig**: Implementierung (Dateien, die existieren), Test (Datei mit
mindestens der zugesagten Anzahl Testfälle), Nachweis (Route/Datei/Skript) und — für Oberflächen —
eine existierende Navigationssektion. Alles andere ist `PARTIAL` (Lücke benannt), `NOT_IMPLEMENTED`
(bewusst nicht gebaut), `NOT_VERIFIED` (Umgebung erlaubt keinen Nachweis) oder `BLOCKED` (äußere
Abhängigkeit) — jeweils **mit Begründung**, sonst schlägt der Prüfer fehl.

Der Prüfer läuft in CI. Wer eine Statuszeile auf `PASS` hebt, ohne Nachweis zu liefern, macht den
Bau rot. Das ist der Unterschied zwischen einem Feature-Plan und einem Abnahmeplan.

## 2. Phasen und Reihenfolge

Die Reihenfolge folgt dem Auftrag: **von innen nach außen** — Autorität → Control Plane →
Ausführung → Runtime → Evidenz → Agenten → Fabric → UI → E2E → Produktion. Keine Oberfläche
zuerst, keine Funktionalität „später füllen".

| Phase | Inhalt | Anforderungen (Matrix) | Zustand |
|---|---|---|---|
| **P0** | Spezifikation einfrieren, Repository/CI, Authentifizierung/Autorisierung, Creator-Bootstrap, Event+Audit+Provenance, Execution Gate + Broker, OCI-Härtung | `SPEC-001`, `CI-001`, `AUTH-001…004`, `BOOT-001/002`, `EVT-001/002`, `AUD-001/002`, `PROV-001`, `GATE-001…003`, `OCI-001` | 16/17 PASS, OCI `NOT_VERIFIED` |
| **P1** | Autonome Laufzeit: Queue/Worker/Run, Sandbox-Lebenszyklus, Snapshot/Restore, Fehlerintelligenz, Recovery-Verifikation, Experimente, Kausalvalidierung, Regression, Wissen, Status, Observatory, Timeline/Replay, Why, Approvals | `Q-001…003`, `SB-001…004`, `EXP-001`, `SCI-001`, `ERR-001`, `REC-001`, `REG-001`, `KNO-001`, `STA-001`, `OBS-001`, `TL-001`, `WHY-001`, `APR-001`, `INB-001`, `GOV-001` | **20/20 PASS** |
| **P2** | Fabric: Runtime-Registry, Werkzeuge, Skills, Werkstatt, Provider, Geräte, Computer Use, Simulation, Offline, betriebliche Wiederherstellung | `RT-001`, `TOOL-001`, `SKILL-001`, `WS-001`, `PROVF-001/002`, `DEV-001/002`, `CU-001`, `SIM-001`, `OFF-001`, `OPR-001/002` | 9/13 PASS, Computer Use/Geräte `PARTIAL`, Provider live `NOT_VERIFIED`, Offline `NOT_IMPLEMENTED` |
| **P3** | Control Center vollständig an echte Daten, Visualisierung, Status/Progress, Observability, Approvals, Security, Integrationen | `UI-001…003` | 2/3 PASS, Browser `NOT_VERIFIED` |
| **P4** | Verifikation: Pyramide, Regression, Fehlerinjektion, Betriebs-/Lastnachweis, die vier §49-Abnahmen | `TEST-001…004`, `LIVE-001`, `LOAD-001`, `ACC-001…004`, `CH-01…CH-18` | PASS; Fehlerinjektion und Sabotage automatisiert in CI — offen bleibt nur der Dauerlauf (`LOAD-001`) |
| **P5** | Produktion: Metriken/Alarme/SLO, Bereitschaft, Deployment mit Rollback, Betriebshärtung | `OPS-001…004` | 3/4 PASS; Betriebshärtung `NOT_IMPLEMENTED` (Rate-Limits, Graceful Shutdown, Secret-Externalisierung) |

## 3. Was „fertig" konkret bedeutet (Definition of Done)

Eine Anforderung ist `PASS` nur mit:

1. **Implementierung** — die genannten Dateien existieren und leisten die Aussage.
2. **Integration** — die Funktion ist an eine Route/UI/Suite gebunden (Nachweis-Eintrag).
3. **Persistenz** — wo Zustand entsteht: digest-geprüfter Store mit Migration.
4. **Fehlerpfaden** — Verweigerung/Fehlschlag sind getestet, nicht nur der Erfolgsfall.
5. **Sicherheitsgrenze** — Autorisierung, Gate/Broker, keine Geheimnisse in Antworten.
6. **Test + Regressionstest** — mit Mindestanzahl Fälle im Matrix-Eintrag.
7. **Sichtbarem UI-Zustand** — Abschnitt aus der Navigationsliste (`ui`-Feld).
8. **Dokumentation** — Dokument(e), die das reale Verhalten beschreiben.
9. **Nachweis** — Route, Skript oder Datei, der/die den Zustand belegt.

Punkte 2, 6 und 9 werden **maschinell** geprüft; 1, 3–5, 7, 8 über die verlangten Verweise.

## 4. Aktueller Abnahme-Zustand (2026-09-25)

| Status | Anzahl | Anteil | Bedeutung im Projekt |
|---|---|---|---|
| ✅ PASS | 77 | 91 % | mit Implementierung, Test, Nachweis — inkl. Fehlerinjektion und Sabotage |
| 🟡 PARTIAL | 3 | 4 % | Lücke benannt (Computer-Use-Treiber `CU-001`, Dauerlauf `LOAD-001`, Checkpointing/Planer `CH-04`) |
| 🔵 NOT_VERIFIED | 3 | 4 % | OCI-Runtime (`OCI-001`), Provider-Live-Verbindung (`PROVF-002`), Browser-E2E (`UI-003`) |
| ⚪ NOT_IMPLEMENTED | 2 | 2 % | Offline Fabric (`OFF-001`), Betriebshärtung (`OPS-004`) |
| ❌ FAIL / ⛔ BLOCKED | 0 | — | keine |

Nachtrag 2026-09-26: `TEST-003` ist zusätzlich auf **Prozessebene** belegt (echter SIGKILL mitten im
Schreibvorgang, vier gleichzeitige Writer-Prozesse mit 240/240 Einträgen samt Gegenprobe,
Lease-Ablauf, Netzwerkverlust über den echten Dispatch-Pfad); die Nebenläufigkeitskontrolle des
Stores (Revision im Envelope, Prüfung und `rename` in einer Sperre) ist dafür die Voraussetzung und
selbst durch zwei Sabotageproben abgesichert. Der Katalog umfasst jetzt 19 Proben.

Stand `node scripts/acceptance.mjs` (statisch, 15/0): `TEST-003` (Fehlerinjektion) und `TEST-004`
(Sabotageproben) sind auf **PASS** gehoben — mit Implementierung, Test, ausgeführtem Nachweisprüfer,
Oberflächensektion und CI-Pflichtstufe, nicht durch Statusänderung allein. Frühere Hebungen
(`STA-001`, `OBS-001`, `WHY-001`) bleiben unverändert gültig.

Die vollständige Tabelle steht in `docs/ACCEPTANCE.md` (generiert), die Einzelbegründungen in
`docs/acceptance/requirements.json` (`note`-Feld).

**Nicht** als erledigt markiert, obwohl technisch möglich wäre — hier ist bewusst ehrlich:

- **Deployment** (`CH-15`/`OPS-003`): Promotion-Gates existieren, ein Ausrollvorgang mit
  Health-Check und Rollback nicht. Solange fehlt der letzte Schritt der Zielkette.
- **Dauerlauf** (`LOAD-001`): Lastspitzen sind gemessen (Soak mit p95-Budget, 120 autorisierte
  Ausführungen je Lauf) und die Fehlerinjektion überlebt einen echten `SIGKILL` mit Neustart
  (`scripts/fault-injection.mjs`, 28/28 in zwei Zyklen); ein Betrieb über Stunden (Dauerlauf)
  fehlt weiterhin. Sabotageproben laufen seit dieser Runde automatisiert in CI (`TEST-004` → PASS).
- **Geräte-Scheduling/Computer-Use-Treiber** (`DEV-001`, `CU-001`): Discovery, Autorisierung und
  Freigabe sind umgesetzt; echte Treiber bzw. Ressourcenplanung fehlen ohne Umgebung.

## 4a. Reparaturen am eingefrorenen Rahmen (2026-09-25, Abnahme-Runde)

Beim ersten vollständigen Prüferlauf gegen den Stand `301c69e` waren drei Dinge **rot**, die
nichts mit fehlender Funktion zu tun hatten, sondern mit Nachweisen bzw. Testcode. Sie wurden
reparariert, **ohne** eine Prüfung abzuschwächen:

| Fund | Ursache | Behebung |
|---|---|---|
| **Zwei Routen ohne Aktionsprüfung** (P1-Runde) | `tests/security/api-route-contract.test.ts` prüfte nur die erste Verzeichnisebene; `app/api/approvals/center` und `app/api/workshop/execute` lagen darunter und hatten **keine** eigene Aktionsprüfung (nur die Middleware schützte sie). Die Prüfung wurde **verschärft** (rekursiv) und fand die Lücke sofort | `approvals/center`: `approval:read` / `approval:write` + bestehende Capability-Pflicht; `workshop/execute`: `workshop:read` / `workshop:execute` + Capability `workshop:step`, Nutzdaten über `readJson`/`actionField`. Kein Test abgeschwächt |
| **Doppelter React-Key in der Oberfläche** | Die Delegations-Tabelle nutzte `entry.id`, das Datenmodell führt aber `delegationId` — zwei Delegationen ergaben denselben Key `undefined` | Key und Anzeige auf `delegationId` (mit Rückfall) umgestellt; die React-Warnung ist im UI-Test verschwunden |
| **`curl` interpretierte `[id]` als Zeichenbereich** | `scripts/audit-api.sh` rief die dynamische Route wörtlich ab; curl sendete die Anfrage wegen URL-Globbing gar nicht, zusätzlich behandelte `case` in der Shell `[id]` als Zeichenklasse | `curl -g` in `api()`/`raw()`, Pflichtparameter-Vergleich per Zeichenkettenvergleich statt `case`-Glob; die dynamische Route wird in Abschnitt 8 mit einer echten Ereignis-ID geprüft |
| CI „Lint und Typecheck" rot | `tests/security/causal-integrity.test.ts` benutzte eine veraltete Modul-API (`runExperiment` positional, `addEvidence` ohne `knowledgeState`), `tests/integration/event-audit-linkage.test.ts` importierte ungenutzt, `scripts/acceptance.mjs` hatte toten Code | Test auf die echte API umgebaut (reale Sandbox, Token je Lauf wegen Einmalverwendung), tote Importe entfernt |
| CI „Security" rot | derselbe Kausal-Test „requires accepted, evidenced baseline/control/replication observations" schlug fehl, weil ohne Sandbox/Token keine akzeptierten Läufe entstanden — die Kausalprüfung stufte korrekt nicht auf `ESTABLISHED` | Test baut jetzt reale, autorisierte Läufe auf und erwartet **zusätzlich** die Zwischenzustände (`HYPOTHESIS`, „no evidence recorded") — die Prüfung wurde dadurch strenger, nicht lockerer |
| Prüfer rot | `tests/e2e/acceptance-chain.test.ts` (ACC-004) fehlte noch | Kettentest über alle 18 Stufen geschrieben (API, Persistenz, Audit, Provenance je Stufe) |

## 5. Reihenfolge für die nächsten Arbeiten

Phase 0 (Abnahme-Framework) und **Phase 1 (autonome Laufzeit) sind abgeschlossen**: Matrix
eingefroren, Prüfer 0 Verstöße, Selbsttests grün, `docs/ACCEPTANCE.md` generiert, Status-Modell
vollständig, Observatory und „Warum?" live belegt.

Streng in dieser Ordnung, jeweils mit Nachweis (Tests + Live-Lauf + Doku):

1. ~~**P1-Abschluss:** Status-Modell, Observatory-Aggregation und „Warum?"-Abfrage.~~
   **Abgeschlossen (2026-09-25):** 20 Zustände in `lib/status.ts` mit erzwungener Vollständigkeit,
   `GET /api/observatory` (neun Felder je Aktivität, Lücken benannt), `GET /api/events/[id]/why`
   (Kausalkette + Zweck + Referenzen + Grenzen); Nachweise: `tests/unit/status-model.test.ts`,
   `tests/integration/observatory-why.test.ts`, `scripts/audit-api.sh` Abschnitt 8.
2. ~~**P5-Kern:** Deployment-Objekt (Ausrollen, Health-Check, Rollback, Kill-Switch-Bindung) mit
   Route, UI und Tests — damit ist die Zielkette vollständig.~~
   **Abgeschlossen (2026-09-25):** `lib/release.ts` (Slots mit sha256-Digest, atomarer Zeiger,
   Aufräumschutz für aktiven und Vorgänger-Slot), `lib/deployment.ts` (Plan mit Gates und
   Kill-Switch-Bindung, sieben Health-Checks inklusive echter HTTP-Antworten, Ausrollen erst danach,
   Rückroll nur mit unversehrtem Vorgänger und anschließender Neumessung), Route
   `GET|POST /api/deployment` (Creator-Aktion), UI-Sektion **Deployment**, Prozessneustart über
   `scripts/release-supervisor.sh` (Messung der ausgelieferten Build-ID, selbsttätiger Rückroll,
   Bestätigung des Datensatzes). Nachweise: `tests/unit/release.test.ts` (6),
   `tests/integration/deployment.test.ts` (7), `tests/e2e/deployment-release.test.ts` (3),
   `tests/security/route-guards.test.ts` (+3: kein Selbst-Ausrollen durch Agenten), Live-Lauf auf
   Port 3100 (Plan `STAGING` mit quittierten Lücken, `PRODUCTION` benannt blockiert, Vorgang
   `STAGED` → Supervisor → Datensatz `ACTIVE`, `--live` 84/0, 68/68 Routen). `OPS-003` und `CH-15`
   stehen damit auf `PASS`.
3. ~~**P4-Härtung:** Fehlerinjektion (Serverprozess-Abbruch, Netzwerkverlust, konkurrierende
   Schreibvorgänge) und automatisierte Sabotageproben in CI.~~ **Erledigt (2026-09-25):**
   `lib/fault-injection.ts` + `scripts/fault-injection.mjs` (echter `SIGKILL` mit Neustart, 28/28),
   `scripts/sabotage.mjs` + Katalog `docs/acceptance/sabotage-probes.json` (**25/25 erkannt**, mit
   vorgeschalteter Grundprobe über alle betroffenen Suiten), beide als Pflichtstufen in der CI;
   Oberflächensektion **Fehlerinjektion**, `TEST-003`/`TEST-004` auf `PASS`.
4. **P2-Rest:** Computer-Use-Treiber, Geräte-Scheduling nach Ressourcen, Provider-Adapterlauf
   (sobald ein kontrollierter Egress existiert), Offline-Paketbestand.
5. **P5-Rest:** Rate-Limits und Graceful Shutdown. (Das Upgrade-/Rollback-Verfahren ist seit
   Schritt 2 vorhanden.)
6. **P0-Rest:** OCI-Runtime auf einem Host mit Daemon verifizieren.

## 6. Ausnahmen und ihre Behandlung

- **Externe Abhängigkeit** (kein Container-Daemon, kein Browser, kein Internet): Anforderung bleibt
  `NOT_VERIFIED`/`NOT_IMPLEMENTED` **mit Begründung**; sie wird nicht stillschweigend gestrichen.
  Der Auftrag erlaubt das ausdrücklich („bewusst nicht implementierbare externe Abhängigkeit").
- **Sabotageprobe:** Wer eine Prüfung abschwächt, statt die Ursache zu beheben, verletzt den
  Abnahmerahmen. Jede Änderung an einer Prüfung wird im Commit begründet.
- **Konflikt** zwischen späterer technischer Entscheidung und früherer Anforderung:
  `CONFLICT → DOCUMENT → BLOCK IMPLEMENTATION → REQUEST/RECORD DECISION`
  (siehe `docs/SPEC_COMPLIANCE.md` §19).
