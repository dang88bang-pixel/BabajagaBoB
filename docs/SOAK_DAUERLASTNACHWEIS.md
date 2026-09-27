# Mehrstündiger Soak-/Dauerlastnachweis — exakte Vorgaben

**Dokumentstatus:** VERBINDLICHE ABNAHMEVORGABE  
**Geltungsbereich:** BabajagaBoB / Worker Fabric / Queue / Execution Broker / Runtime / Persistence / Audit / Recovery / Observability  
**Zweck:** Reproduzierbarer Nachweis, dass die Anwendung unter mehrstündiger Dauerlast stabil arbeitet und ihre Sicherheits-, Integritäts- und Recovery-Grenzen nicht verliert.  
**Wichtig:** Ein kurzer Lasttest, ein synthetischer Mock-Lauf oder ein erfolgreicher Einzeltest darf diesen Nachweis NICHT ersetzen.

## 1. Ziel

Der Test muss über einen zusammenhängenden Zeitraum von mindestens **6 Stunden** einen realen, gebauten BabajagaBoB-Dienst unter kontrollierter Dauerlast betreiben.

Der Nachweis muss mindestens zeigen:

1. keine unkontrolliert wachsende Fehlerquote,
2. keine verlorenen oder duplizierten Jobs,
3. keine Lease-/Heartbeat-Korruption,
4. keine Event-/Audit-/Provenance-Kettenverletzung,
5. keine unautorisierten Ausführungen,
6. keine Capability-Token-Replays,
7. keine unkontrollierte Ressourcenerschöpfung,
8. keine dauerhaft anwachsenden Orphans/Dead-Letter-Einträge außerhalb der erwarteten Testfehler,
9. korrekte Cancel-/Timeout-/Retry-/Recovery-Semantik,
10. stabile API-/Queue-/Worker-Latenzen,
11. stabile Persistenzintegrität,
12. reproduzierbare Evidenz für jeden Abbruch oder Fehler.

## 2. Teststufen

### SOAK-6H — Pflichtnachweis

- Dauer: **>= 6 h**
- Ziel: Grundnachweis Dauerbetrieb
- Last: konstant + kontrollierte Schwankung
- reale Anwendung, kein Mock des zentralen Queue-/Broker-/Store-Pfades

### SOAK-24H — empfohlene Erweiterung

- Dauer: **>= 24 h**
- gleiche Regeln
- zusätzlich periodische Neustarts einzelner Worker und kontrollierte Laständerungen

### SOAK-72H — Langzeitnachweis

- Dauer: **>= 72 h**
- für Release-/Produktionsfreigabe bevorzugt
- zusätzlich Rotation, Backup/Restore-Probe und geplante Recovery-Fälle

Ein Agent darf eine höhere Stufe ausführen, muss aber immer die erreichte Dauer dokumentieren.

## 3. Lastprofil

Der Test darf nicht ausschließlich mit einer konstanten Einzelaktion laufen.

### 3.1 Baseline

Während der gesamten Laufzeit:

- mindestens **4 parallele Worker**
- mindestens **8 gleichzeitig aktive/queued Tasks**
- kontinuierliche Task-Zufuhr
- Mischung aus kurzen und mittleren Jobs
- mindestens drei unterschiedliche erlaubte Capability-/Task-Typen
- mindestens ein Read-/Observe-Pfad
- mindestens ein kontrollierter Schreib-/Artefaktpfad

Die konkrete Workerzahl darf an die CI-/Runner-Ressourcen angepasst werden, muss aber dokumentiert werden.

### 3.2 Variable Last

Mindestens alle 15 Minuten:

- Last auf ca. 50 % der Baseline reduzieren,
- anschließend auf ca. 150 % erhöhen,
- wieder auf Baseline zurückführen.

Die Änderung muss reproduzierbar und im Event-/Testlog markiert werden.

### 3.3 Burst

Mindestens einmal pro Stunde:

- kontrollierter Burst von mindestens **3x Baseline** für 60–120 Sekunden.

Der Burst darf weder Sicherheitsregeln noch Queue-Integrität verletzen.

## 4. Kontrollierte Negativfälle

Mindestens alle folgenden Fälle müssen während des Soaks mindestens einmal ausgeführt werden:

1. Job-Timeout,
2. Job-Cancel,
3. Worker-Ausfall,
4. Lease-Ablauf,
5. Retry,
6. Dead-Letter,
7. absichtliche Capability-Verweigerung,
8. ungültige/fremde Task-Bindung,
9. Kill-Switch-Aktivierung,
10. Recovery eines fehlgeschlagenen Laufs.

Negativfälle müssen ausdrücklich als Testereignisse markiert werden. Erwartete Fehler zählen nicht als Systemfehler, sofern die spezifizierte Recovery-/Denial-Semantik korrekt eintritt.

## 5. Integritätsinvarianten

Der Test gilt als **FAIL**, sobald eine dieser Invarianten verletzt wird:

### Queue

- Jeder erzeugte Testjob erhält genau eine eindeutige Job-ID.
- Erfolgreiche Jobs dürfen nicht doppelt erfolgreich ausgeführt werden.
- Lease-Ablauf darf keinen Versuch verbrauchen.
- Orphans müssen erkannt und entweder recovered oder als Fehler sichtbar gemacht werden.
- Dead-Letter darf nur bei tatsächlich erschöpfter Retry-Policy entstehen.

### Execution Gate / Broker

- Jede geschützte Ausführung läuft über Gate + Broker.
- Kein direkter Worker-/Tool-Aufruf darf den Broker umgehen.
- Capability-Token dürfen nicht wiederverwendet werden.
- Task, Agent, Sandbox, Environment und Risk müssen weiterhin zusammenpassen.
- Kill-Switch muss geschützte Ausführung blockieren.

### Audit / Events / Provenance

- Event-Sequenz bleibt konsistent.
- Hash-/Integritätskette bleibt gültig.
- Audit-Kette bleibt gültig.
- Jede Testaktion besitzt eine nachvollziehbare Korrelation/Causation.
- Provenance darf keine synthetische Ersatzidentität verwenden.

### Persistenz

- Store-Integrität bleibt gültig.
- Keine stillen Datenverluste.
- Backup-/Restore-Prüfungen dürfen keinen beschädigten Zustand als gültig akzeptieren.

### Ressourcen

Folgende Messgrößen müssen regelmäßig erfasst werden:

- RSS/Memory,
- CPU,
- Prozessanzahl,
- Queue-Tiefe,
- aktive Worker,
- aktive Runs,
- Retry-Anzahl,
- Dead-Letter-Anzahl,
- Orphan-Anzahl,
- Event-/Audit-Store-Größe,
- Fehlerquote,
- p50/p95/p99-Latenzen,
- Throughput,
- Recovery-Zeit.

Es darf kein unbegrenztes Wachstum ohne dokumentierte Ursache auftreten.

## 6. SLO-/Abbruchkriterien

Der Lauf ist **nicht bestanden**, wenn ohne dokumentierte erwartete Ursache:

- Prozess unerwartet beendet wird,
- Store- oder Audit-Integrität verletzt wird,
- ein Job verloren geht,
- ein Job unzulässig doppelt ausgeführt wird,
- Capability-Replay akzeptiert wird,
- eine nicht autorisierte Aktion ausgeführt wird,
- Kill-Switch nicht blockiert,
- Queue/Worker dauerhaft festhängt,
- Memory/Prozesszahl kontinuierlich unkontrolliert wächst,
- Fehlerquote dauerhaft über dem vereinbarten Grenzwert liegt,
- p99-Latenz über den projektspezifischen Grenzwert steigt und nicht zurückkehrt,
- Recovery einen inkonsistenten Zustand hinterlässt.

Wenn das Projekt keinen projektspezifischen SLO-Wert vorgibt, dürfen keine erfundenen „Pass“-Grenzwerte behauptet werden. In diesem Fall müssen die gemessenen Werte vollständig berichtet und die Grenzwerte vor dem Lauf explizit festgelegt werden.

## 7. Messintervall

Mindestens alle **60 Sekunden** muss ein Snapshot geschrieben werden.

Jeder Snapshot enthält:

- UTC timestamp,
- soakRunId,
- buildId/commit SHA,
- uptime,
- worker count,
- queue depth,
- active runs,
- completed jobs,
- failed jobs,
- retried jobs,
- dead-letter count,
- orphan count,
- denial count,
- recovery count,
- CPU,
- memory,
- process count,
- p50/p95/p99,
- event sequence/head,
- audit chain status,
- store integrity status.

## 8. Startbedingungen

Vor dem Lauf:

1. sauberen Build erzeugen,
2. Commit SHA festhalten,
3. Dependency-/Runtime-Versionen festhalten,
4. Konfiguration/Deny-by-default-Policy festhalten,
5. Kill-Switch-Zustand festhalten,
6. Store-Digests festhalten,
7. Event-/Audit-Head festhalten,
8. Testdatenbestand festhalten,
9. Workerzahl festhalten,
10. Lastprofil festhalten,
11. Startzeit in UTC festhalten.

Der Startzustand muss als unveränderliches Evidence-Artefakt gespeichert werden.

## 9. Laufzeitprotokoll

Der Runner muss:

- einen eindeutigen `soakRunId` erzeugen,
- jede Laständerung markieren,
- jeden Negativfall markieren,
- Snapshots periodisch speichern,
- unerwartete Prozessabbrüche erkennen,
- bei FAIL sofort einen Evidence-Bundle-Abschluss versuchen,
- Exit-Code ungleich 0 bei echtem Fehler liefern.

Keine Testdaten mit Secrets, Tokens oder Klartext-Credentials in Logs schreiben.

## 10. Abschlussprüfung

Nach Ablauf der Sollzeit:

1. keine neuen Testjobs mehr erzeugen,
2. Queue kontrolliert drainieren,
3. laufende Jobs kontrolliert abschließen,
4. offene Orphans prüfen,
5. Dead-Letter prüfen,
6. Retry-Zähler prüfen,
7. Event-Kette prüfen,
8. Audit-Kette prüfen,
9. Provenance prüfen,
10. Store-Integrität prüfen,
11. erwartete Negativfälle gegen ihre erwarteten Resultate prüfen,
12. Ressourcen-Endzustand mit Startzustand vergleichen,
13. Evidence-Bundle erzeugen,
14. Ergebnisstatus festlegen.

## 11. Evidence-Bundle

Das Bundle muss mindestens enthalten:

- `manifest.json`
- `run.json`
- `snapshots.jsonl`
- `events.jsonl` oder referenzierbare Event-Digests,
- `audit-summary.json`,
- `queue-summary.json`,
- `resource-summary.json`,
- `negative-cases.json`,
- `final-integrity.json`,
- `environment.json`,
- `README.md`.

Jede Datei muss Digest/Integritätsprüfung ermöglichen.

Das Bundle darf keine Secrets oder unredigierten Credentials enthalten.

## 12. Ergebnisformat

Der Runner muss eindeutig einen von drei Zuständen erzeugen:

- **PASS** — alle Pflichtbedingungen erfüllt und Evidence vollständig.
- **FAIL** — mindestens eine Pflichtbedingung verletzt.
- **INCONCLUSIVE** — Lauf beendet, aber Evidence oder Infrastruktur reicht nicht für eine belastbare Entscheidung.

INCONCLUSIVE ist niemals als PASS zu behandeln.

## 13. CI-Verhalten

Der Soak-Test darf nicht in jedem normalen Pull-Request-Lauf automatisch 6 Stunden blockieren.

Empfohlene CI-Stufen:

- PR Smoke: 5–15 Minuten,
- Nightly Soak: >= 6 h,
- Release Soak: >= 24 h,
- Extended Soak: >= 72 h.

Ein Release-Gate darf einen erforderlichen Soak-Nachweis nicht durch einen Smoke-Test ersetzen.

## 14. Reproduzierbarkeit

Ein anderer Agent muss anhand dieses Dokuments ohne Rückfragen reproduzieren können:

- welche Dauer,
- welches Lastprofil,
- welche Negativfälle,
- welche Messwerte,
- welche Integritätsprüfungen,
- welche Evidence,
- welche Exit-Kriterien.

Der Agent darf fehlende projektspezifische Grenzwerte nicht erfinden. Er muss sie aus vorhandenen SLO-/Testvorgaben übernehmen oder vor dem Lauf als explizite Testkonfiguration festlegen.

## 15. Abnahmebedingung für BabajagaBoB

Der Acceptance-Matrix-Eintrag **LOAD-001** darf erst von PARTIAL/NOT_VERIFIED auf PASS gesetzt werden, wenn:

- mindestens ein SOAK-6H-Lauf vollständig durchgeführt wurde,
- der Lauf die reale Anwendung und die relevanten Persistenz-/Queue-/Broker-Pfade umfasst,
- alle Pflicht-Invarianten geprüft wurden,
- die kontrollierten Negativfälle durchgeführt wurden,
- das Evidence-Bundle vollständig und integritätsgeprüft vorliegt,
- der Runner mit Exit 0 endet,
- kein FAIL oder INCONCLUSIVE vorliegt,
- der konkrete Commit SHA dokumentiert ist.

Ein erfolgreicher 5-, 15-, 30- oder 60-Minuten-Test ist **kein** Ersatz für SOAK-6H.

## 16. Übergabe an einen anderen Agenten

Der übernehmende Agent soll in dieser Reihenfolge arbeiten:

1. dieses Dokument lesen,
2. `docs/acceptance/requirements.json` und `docs/STATUS.md` lesen,
3. vorhandene Load-/Soak-Skripte und Test-Infrastruktur wiederverwenden,
4. keinen parallelen zweiten Wahrheitspfad erzeugen,
5. Runner unter `scripts/` ergänzen oder vorhandenen Runner erweitern,
6. Evidence unter dem bestehenden Artefakt-/Audit-Modell ablegen,
7. zuerst kurzen Smoke-Lauf zur Funktionsprüfung,
8. anschließend SOAK-6H,
9. Ergebnis prüfen,
10. nur bei vollständigem Nachweis Acceptance-Matrix aktualisieren,
11. `docs/STATUS.md` und `docs/TODO.md` aktualisieren,
12. Commit SHA und CI-/Runner-Nachweis dokumentieren.

**Verboten:** Status auf PASS setzen, nur weil der Runner existiert; Mock-Ergebnisse als echte Dauerlast ausgeben; fehlende Stunden überspringen; fehlende Messwerte mit „healthy“ ersetzen; Secrets in Evidence schreiben; SLO-Grenzwerte erfinden.

## 17. Definition of Done

Der Auftrag ist für diesen Nachweis abgeschlossen, wenn ein unabhängiger Agent den Runner auf einem geeigneten Runner ausführen kann und anschließend anhand des Evidence-Bundles nachvollziehbar feststellen kann:

**SOAK-6H: PASS / FAIL / INCONCLUSIVE**

mit Commit SHA, Laufdauer, Lastprofil, Jobzahlen, Fehler-/Recovery-Zahlen, Ressourcenverlauf und Integritätsnachweisen.

Bis dahin bleibt **LOAD-001 = PARTIAL/NOT_VERIFIED**.
