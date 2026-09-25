# Abnahmeplan — von der Spezifikation zur laufenden Funktion

**Status dieses Dokuments:** verbindlicher Abnahmerahmen (eingefroren am 2026-09-25).
**Maschinenlesbare Quelle:** `docs/acceptance/requirements.json`.
**Prüfer:** `node scripts/acceptance.mjs` (statisch, in CI) und `… --live` (gegen einen laufenden Server).
**Generierte Übersicht:** `docs/ACCEPTANCE.md` (`node scripts/acceptance.mjs --write`).
**Letzter Prüferlauf:** 2026-09-25 → **15 Prüfungen bestanden, 0 fehlgeschlagen**; die
Abnahme-Selbsttests `tests/unit/acceptance-matrix.test.ts` (4/4) und
`tests/e2e/acceptance-chain.test.ts` (4/4, 18 Stufen) laufen mit.

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
| **P1** | Autonome Laufzeit: Queue/Worker/Run, Sandbox-Lebenszyklus, Snapshot/Restore, Fehlerintelligenz, Recovery-Verifikation, Experimente, Kausalvalidierung, Regression, Wissen, Status, Observatory, Timeline/Replay, Why, Approvals | `Q-001…003`, `SB-001…004`, `EXP-001`, `SCI-001`, `ERR-001`, `REC-001`, `REG-001`, `KNO-001`, `STA-001`, `OBS-001`, `TL-001`, `WHY-001`, `APR-001`, `INB-001`, `GOV-001` | 17/20 PASS, 3 `PARTIAL` (Status, Observatory, Why) |
| **P2** | Fabric: Runtime-Registry, Werkzeuge, Skills, Werkstatt, Provider, Geräte, Computer Use, Simulation, Offline, betriebliche Wiederherstellung | `RT-001`, `TOOL-001`, `SKILL-001`, `WS-001`, `PROVF-001/002`, `DEV-001/002`, `CU-001`, `SIM-001`, `OFF-001`, `OPR-001/002` | 9/13 PASS, Computer Use/Geräte `PARTIAL`, Provider live `NOT_VERIFIED`, Offline `NOT_IMPLEMENTED` |
| **P3** | Control Center vollständig an echte Daten, Visualisierung, Status/Progress, Observability, Approvals, Security, Integrationen | `UI-001…003` | 2/3 PASS, Browser `NOT_VERIFIED` |
| **P4** | Verifikation: Pyramide, Regression, Fehlerinjektion, Betriebs-/Lastnachweis, die vier §49-Abnahmen | `TEST-001…004`, `LIVE-001`, `LOAD-001`, `ACC-001…004`, `CH-01…CH-18` | PASS mit drei benannten Lücken (Fehlerinjektion, Sabotage-Automatisierung, Dauerlauf) |
| **P5** | Produktion: Metriken/Alarme/SLO, Bereitschaft, Deployment mit Rollback, Betriebshärtung | `OPS-001…004` | 2/4 PASS, Deployment `PARTIAL`, Betriebshärtung `NOT_IMPLEMENTED` |

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
| ✅ PASS | 69 | 81 % | mit Implementierung, Test, Nachweis |
| 🟡 PARTIAL | 11 | 13 % | Lücke benannt (Universal Status, Observatory, Why, Geräte-Scheduling, Computer-Use-Treiber, Deployment/Rollback, Fehlerinjektion, Sabotage-Automatisierung, Dauerlauf, OCI-Platzhalter) |
| 🔵 NOT_VERIFIED | 3 | 4 % | OCI-Runtime (`OCI-001`), Provider-Live-Verbindung (`PROVF-002`), Browser-E2E (`UI-003`) |
| ⚪ NOT_IMPLEMENTED | 2 | 2 % | Offline Fabric (`OFF-001`), Betriebshärtung (`OPS-004`) |
| ❌ FAIL / ⛔ BLOCKED | 0 | — | keine |

Die vollständige Tabelle steht in `docs/ACCEPTANCE.md` (generiert), die Einzelbegründungen in
`docs/acceptance/requirements.json` (`note`-Feld).

**Nicht** als erledigt markiert, obwohl technisch möglich wäre — hier ist bewusst ehrlich:

- **Deployment** (`CH-15`/`OPS-003`): Promotion-Gates existieren, ein Ausrollvorgang mit
  Health-Check und Rollback nicht. Solange fehlt der letzte Schritt der Zielkette.
- **Universal Status** (`STA-001`): 14 Zustände sind typisiert, aber nicht jeder UI-Zustand nutzt
  sie durchgängig; `OBSERVING`/`VALIDATING`/`SUCCEEDED`/`FAILED`/`BUG` fehlen.
- **Observatory/Why** (`OBS-001`, `WHY-001`): die Datenbasis (Zweck, Entscheidung, Referenzen,
  Kausalkette) ist im Ereignis vorhanden, eine aggregierte „Warum?"-Abfrage über mehrere
  Ereignisse fehlt.

## 4a. Reparaturen am eingefrorenen Rahmen (2026-09-25, Abnahme-Runde)

Beim ersten vollständigen Prüferlauf gegen den Stand `301c69e` waren drei Dinge **rot**, die
nichts mit fehlender Funktion zu tun hatten, sondern mit Nachweisen bzw. Testcode. Sie wurden
reparariert, **ohne** eine Prüfung abzuschwächen:

| Fund | Ursache | Behebung |
|---|---|---|
| CI „Lint und Typecheck" rot | `tests/security/causal-integrity.test.ts` benutzte eine veraltete Modul-API (`runExperiment` positional, `addEvidence` ohne `knowledgeState`), `tests/integration/event-audit-linkage.test.ts` importierte ungenutzt, `scripts/acceptance.mjs` hatte toten Code | Test auf die echte API umgebaut (reale Sandbox, Token je Lauf wegen Einmalverwendung), tote Importe entfernt |
| CI „Security" rot | derselbe Kausal-Test „requires accepted, evidenced baseline/control/replication observations" schlug fehl, weil ohne Sandbox/Token keine akzeptierten Läufe entstanden — die Kausalprüfung stufte korrekt nicht auf `ESTABLISHED` | Test baut jetzt reale, autorisierte Läufe auf und erwartet **zusätzlich** die Zwischenzustände (`HYPOTHESIS`, „no evidence recorded") — die Prüfung wurde dadurch strenger, nicht lockerer |
| Prüfer rot | `tests/e2e/acceptance-chain.test.ts` (ACC-004) fehlte noch | Kettentest über alle 18 Stufen geschrieben (API, Persistenz, Audit, Provenance je Stufe) |

## 5. Reihenfolge für die nächsten Arbeiten

Phase 0 (Abnahme-Framework) ist damit **abgeschlossen**: Matrix eingefroren, Prüfer 0 Verstöße,
Selbsttests grün, `docs/ACCEPTANCE.md` generiert.

Streng in dieser Ordnung, jeweils mit Nachweis (Tests + Live-Lauf + Doku):

1. **P1-Abschluss:** `OBSERVING`/`VALIDATING`/`SUCCEEDED`/`FAILED`/`BUG` in `lib/types.ts`,
   Statusprüfer („nutzt jede UI-Funktion das Modell?"), Observatory-Aggregation und
   „Warum?"-Abfrage (`GET /api/events/:id/why`, Kausalkette + Zwecke + Referenzen).
2. **P5-Kern:** Deployment-Objekt (Ausrollen, Health-Check, Rollback, Kill-Switch-Bindung) mit
   Route, UI und Tests — damit ist die Zielkette vollständig.
3. **P4-Härtung:** Fehlerinjektion (Serverprozess-Abbruch, Netzwerkverlust, konkurrierende
   Schreibvorgänge) und automatisierte Sabotageproben in CI.
4. **P2-Rest:** Computer-Use-Treiber, Geräte-Scheduling nach Ressourcen, Provider-Adapterlauf
   (sobald ein kontrollierter Egress existiert), Offline-Paketbestand.
5. **P5-Rest:** Rate-Limits, Graceful Shutdown, Upgrade-/Rollback-Verfahren.
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
