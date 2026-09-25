# Betrieb — Abschnitt 39/43

Implementierung: `lib/persistence/store.ts`, `lib/observability.ts`, `lib/metrics.ts`,
`lib/recovery-orchestrator.ts`, `lib/session.ts`, `lib/bootstrap.ts`,
Routen `app/api/persistence/route.ts`, `app/api/metrics/route.ts`,
`app/api/readiness/route.ts`, `app/api/audit/route.ts`, `scripts/verify-live.sh`.

## 1. Ablage und Zugriffsschutz

- Storage-Root: `BOB_STORAGE_DIR` (Standard `.bob-data`, im Repository **nicht** versioniert).
- Kernel-Isolation (optional, empfohlen): `BOB_NS_ROOTFS` (Standard `${BOB_STORAGE_DIR}/ns-rootfs`)
  und `BOB_NS_ISOLATION=auto|on|off`. Der Rootfs wird **einmalig** gebaut:
  `bash scripts/build-ns-rootfs.sh [ziel]` (126 MB, Node + BusyBox; BusyBox kommt aus der
  devDependency, es wird kein Paket-Repository benötigt). Fehlt der Rootfs, meldet
  `GET /api/runtime` die Stufe `FILESYSTEM_ONLY`; mit `BOB_NS_ISOLATION=on` wird dann **nichts**
  ausgeführt (409, `kernel isolation is enforced … but unavailable`) — fail closed, kein stiller
  Rückfall. Der Rootfs ist Laufzeitdatum und gehört wie `.bob-data` nicht ins Repository.
  Ein **nachträglich** gebauter Rootfs wird sofort wirksam: `GET /api/runtime` prüft die
  Voraussetzungen bei jeder Abfrage und liefert erst `NAMESPACES`, wenn Rootfs und
  `unshare`-Probe es hergeben (vorher blieb der Bericht bis zum Neustart auf
  `FILESYSTEM_ONLY` stehen und blockierte jede Ausführung).
- Ressourcenlimits (kernel-seitig, optional aber empfohlen): `BOB_CGROUP_DIR` auf einen
  **delegierten** cgroup-v2-Unterbaum zeigen lassen. Einrichtung und Start:
  `sudo BOB_CGROUP_DIR=/sys/fs/cgroup/bob bash scripts/setup-cgroup-delegation.sh <benutzer>`,
  danach die Plattform mit `bash scripts/cgroup-exec.sh npx next start …` starten (siehe
  `docs/RUNTIME.md` §2b — das `chown` der Kontrolldateien **und** der Start innerhalb des
  delegierten Baums sind beide nötig; ohne sie meldet `/api/runtime` ehrlich `UNAVAILABLE` und
  Ausführungen mit Speicher-/Prozesslimits werden verweigert, statt still ohne Limit zu laufen).
- Root-Verzeichnis `0700`, jede Store-Datei `0600`, geschrieben atomar (tmp + rename).
- Jeder Store ist ein Umschlag `{store, version, writtenAt, payload, digest}`; `digest` ist
  SHA-256 über `{store, version, payload}` und damit **an den Store-Namen gebunden**. Eine unter
  fremdem Namen abgelegte Datei wird abgewiesen (`belongs to "…"`), ältere Envelopes ohne
  `store`-Feld werden weiter gelesen und beim nächsten Schreiben ergänzt. Passt der Digest nicht,
  wirft der Store `StoreIntegrityError` — fail closed, nichts wird „repariert".
  Beleg: `tests/unit/store-migration.test.ts`.
- Schemawechsel laufen über **registrierte Migrationen** (`StoreOptions.migrations`):
  Digest-Prüfung zuerst, Sicherungskopie `<store>.json.pre-v{N}.bak` (0600), dann
  Migration und Journal (`migrations.jsonl`). Fehlt die Kette oder ist die Datei
  neuer als der Code, wird abgebrochen (kein Downgrade, kein Raten).
  Beleg: `tests/unit/store-migration.test.ts`.

## 2. Registrierte Stores

`control-state`, `audit`, `authority`, `bootstrap`, `creator-auth`, `sessions`,
`approvals`, `queue`, `runs`, `reliability`, `regression`, `errors`, `knowledge`,
`provenance`, `science`, `verifications`, `sandbox-snapshots`, `sandbox-runtime-local`,
`oci-runtime`, `providers`, `devices`, `computer-use`, `simulation`, `inbox`,
`events`, `governance`, `artifacts`, `cicd`, `skills`, `workshop`,
`workshop-executions`, `agent-handoffs` (32 Stores, Stand dieser Dokumentation;
`GET /api/persistence` nennt die aktuelle Liste).

Ein **inhaltsloser Envelope** (`payload: null`) ist der gefährlichste Zustand einer
Store-Datei: Der Digest passt, der Store meldet sich also als integer, jeder Lesezugriff
bricht aber ab. Deshalb gilt:

- `write(null|undefined)` wird verweigert (fail closed) — der Zustand kann nicht mehr entstehen.
- Beim Lesen wird ein solcher Datensatz erkannt, im Journal vermerkt
  (`<store>.json.null-payload`) und mit dem Initialzustand des Moduls neu angelegt.
- `POST /api/persistence {action:"repair"}` (Creator) prüft **alle** Stores und repariert
  sie in einem Durchgang; jede Reparatur wird auditiert (`persistence.repair`).
- Diagnose- und Backup-Instanzen verwenden dieselbe Initialisierungsfunktion wie der
  echte Store. Zuvor schrieb der Backup-Pfad für noch nie beschriebene Stores einen
  Envelope ohne Inhalt — genau daraus entstand der beschriebene Fehler.

`GET /api/persistence` liefert den Integritätsbericht (je Store Version, Digest-Status,
Größe, Existenz) und die Liste der Backups. `POST {action:"backup"}` (Creator) erzeugt
digest-geprüfte Sicherungen unter `<BOB_STORAGE_DIR>/backups`.

### Aufbewahrung des Audit

Der Audit-Store ist append-only. Standardmäßig wird **nichts** gekürzt. Nur wenn
`BOB_AUDIT_MAX_RECORDS` auf eine positive Zahl gesetzt ist, wird beim Überschreiten
abgeschnitten — und dann hält der Store einen **Checkpoint** (Sequenz + Hash des letzten
entfernten Datensatzes) fest, an dem `verifyAuditChain()` die Prüfung beginnt.
`GET /api/audit` bzw. `POST {action:"verify"}` weisen den Zustand aus:

| `retentionIntegrity` | Bedeutung |
|---|---|
| `FULL_CHAIN` | nichts gekürzt; Kette vollständig ab Genesis geprüft |
| `TRIMMED_WITH_CHECKPOINT` | regulär gekürzt; ab Checkpoint geprüft |
| `HEAD_RECONSTRUCTED_FROM_FIRST_RETAINED_RECORD` | Altbestand ohne Checkpoint: Kopf aus dem ersten erhaltenen Datensatz rekonstruiert und dauerhaft vermerkt |

Ein **fehlender Datensatz innerhalb** des erhaltenen Fensters bleibt unabhängig davon ein
Befund (`sequence gap`, `chain break`, `hash mismatch`). Ohne diese Regel hätte eine reguläre
Kürzung dauerhaft falschen Alarm ausgelöst und echte Manipulation verdeckt. Beleg:
`tests/unit/audit-retention.test.ts`.

## 3. Metriken und Beobachtbarkeit

- `POST /api/audit {action:"verify"}` prüft die Hash-Kette (Länge, Brüche, Integrität).
- `GET /api/metrics` liefert Prometheus-Text (nur Zahlen, Session erforderlich):
  `bob_stores_total`, `bob_stores_healthy`, `bob_store_integrity_ok`,
  `bob_events_total`, `bob_event_store_ok`, `bob_audit_records`, `bob_audit_chain_ok`,
  `bob_audit_issues`, `bob_audit_store_ok`, `bob_missions`, `bob_objectives`,
  `bob_tasks`, `bob_agents`, `bob_tasks_by_status`, `bob_approvals_open`, `bob_runs`,
  `bob_runs_by_state`, `bob_queue_jobs`, `bob_sandboxes`, `bob_sandboxes_running`,
  `bob_capability_tokens`, `bob_capability_tokens_active`, `bob_error_incidents`,
  `bob_error_incidents_open`, `bob_error_incidents_learned`,
  `bob_error_incidents_escalated`, `bob_error_incidents_critical_open`,
  `bob_failures`, `bob_failures_verified`, `bob_recovery_plans`,
  `bob_queue_leased`, `bob_queue_failed`, `bob_executions_denied`,
  `bob_isolation_requested`, `bob_isolation_enforced_state` u. a.
- Ereignisse: `lib/events/log.ts` (kausale Kette, `causalParentId`), sichtbar über
  `GET /api/events` und `GET /api/timeline`.
- Werte sind Zählerstände, keine Erfolgsversprechen; fehlende Daten werden nicht „geschätzt".
  `bob_executions_denied` zählt **belegte** Verweigerungen (Evidenzartefakte `kind=DENIAL`),
  `bob_queue_leased` trennt „Queue wächst" von „Queue hängt in Leases".

## 3a. Alarmierung (`lib/alerting.ts`)

Die Regeln liegen im Code und werden bei jeder Abfrage gegen die real ausgelieferten
Kennzahlen geprüft: wird eine Kennzahl umbenannt oder entfernt, ist die Regel
**ungültig** statt wirkungslos. Ausgeliefert wird:

```bash
GET /api/alerts                      # JSON: Regeln + Prüfergebnis (Session erforderlich)
GET /api/alerts?format=prometheus    # YAML-Regeldatei für Prometheus/Alertmanager
```

Ist eine Regel ungültig (unbekannte Kennzahl, doppelte Kennung, fehlende
Handlungsanweisung), liefert die YAML-Ausgabe **500 mit Grund** statt einer
wirkungslosen Regeldatei (fail closed).

Abdeckung (16 Regeln, Severity `CRITICAL`/`WARNING`/`INFO`):

| Regel | Ausdruck | Bedeutung |
|---|---|---|
| `BobStoreIntegrityBroken` | `bob_store_integrity_ok == 0` | Store-Manipulation/-Beschädigung |
| `BobStoresUnhealthy` | `bob_stores_healthy < bob_stores_total` | nicht alle Stores gesund |
| `BobAuditChainBroken` | `bob_audit_chain_ok == 0` | Audit-Kette gebrochen |
| `BobAuditIssuesReported` | `bob_audit_issues > 0` | gemeldete Integritätsprobleme |
| `BobEventStoreBroken` | `bob_event_store_ok == 0` | Ereignis-Log nicht integer |
| `BobIsolationNotEnforced` | `bob_isolation_namespaces_ok == 0` | Isolation angefordert, nicht aktiv (Ausführungen gesperrt) |
| `BobIsolationFailed` | `bob_isolation_enforced_state == 0 and bob_isolation_requested == 1` | Zwischenzustand „angefordert, nicht erzwungen" |
| `BobKillSwitchActive` | `bob_kill_switches_active > 0` | Kill Switch aktiv |
| `BobCriticalIncidentOpen` | `bob_error_incidents_critical_open > 0` | offener kritischer Fehlerfall |
| `BobIncidentsEscalated` | `bob_error_incidents_escalated > 0` | Eskalation wartet auf Entscheidung |
| `BobQueueBacklog` | `bob_queue_jobs - bob_queue_leased > 10` | Queue wächst |
| `BobQueueLeasesStale` | `bob_queue_leased > 0 and bob_queue_jobs == bob_queue_leased` | alles belegt, nichts läuft |
| `BobSandboxFailures` | `bob_sandboxes - bob_sandboxes_running > 5` | viele Sandboxes nicht laufend |
| `BobRecoveryRejected` | `bob_recovery_rejected > 0` | Verifikation abgelehnt |
| `BobDeviceUnauthorizedInUse` | `bob_devices > bob_devices_authorized` | bekannte, nicht autorisierte Geräte (erwartet) |
| `BobExecutionsDenied` | `bob_executions_denied > 5` | häufige Verweigerungen (Angriff/Fehlkonfiguration) |

Jede Regel trägt `severity`, `summary` und `runbook` (Verweis auf Dokument oder Route).
Sichtbar im Control Center unter **Metriken → Alarmregeln** (Anzahl, Prüfergebnis,
Regeltabelle).

### Scraper-Anbindung (Betriebshandbuch, nicht in dieser Umgebung ausgeführt)

`GET /api/metrics` und `GET /api/alerts?format=prometheus` verlangen eine
**Session** — es gibt bewusst keinen öffentlichen Probe-Endpunkt. Ein Scraper
braucht daher ein Creator-fähiges Vorgehen (z. B. ein internes Sidecar mit
eigener Session, das die Werte lokal bereitstellt), statt eines offenen
Endpunkts. Beispielkonfiguration (Werte aus einer solchen Bridge):

```yaml
# prometheus.yml (Auszug) — Endpunkt bewusst nur im internen Netz erreichbar
scrape_configs:
  - job_name: babajagabob
    metrics_path: /api/metrics
    scheme: http
    static_configs:
      - targets: ["127.0.0.1:3000"]
    authorization:
      credentials_file: /etc/bob/scraper-session   # HttpOnly-Session eines internen Creators
rule_files:
  - /etc/bob/bob-alerts.yml                        # Inhalt von /api/alerts?format=prometheus
```

**Offen und als solches geführt:** Scraper und Alertmanager laufen hier nicht
(`NOT_VERIFIED`); geprüft sind die Regelbasis, ihre Bindung an die echten
Kennzahlen und die deterministische Auslieferung (`tests/integration/alerting.test.ts`).

## 3b. Backup-Automation (`lib/backup-policy.ts`)

Backups waren bisher ein Creator-Klick. Die Automation ergänzt den **geplanten
Lauf** und eine **Aufbewahrungsregel** — ohne die Sicherheitsgrenzen von
`lib/persistence/store.ts` zu umgehen (Digest-Prüfung, Versionsbindung,
Pfadbindung auf `<BOB_STORAGE_DIR>/backups`).

| Einstellung | Vorgabe | Bedeutung |
|---|---|---|
| `BOB_BACKUP_INTERVAL_MS` | `3600000` (1 h) | Mindestabstand zweier geplanter Läufe |
| `BOB_BACKUP_KEEP` | `5` | Höchstzahl **verifizierter** Kopien je Store |

Unsinnige Werte (0, negativ, keine Zahl) fallen auf die Vorgabe zurück — eine
Aufbewahrungsgrenze von 0 würde sonst alles löschen.

```bash
POST /api/persistence {"action":"backup.run"}     # geplant, idempotent
POST /api/persistence {"action":"backup.run","force":true}   # ausdrücklich erzwingen
POST /api/persistence {"action":"backup.prune"}   # Aufbewahrungsregel anwenden
GET  /api/persistence                             # Status: backupAutomation
```

Verhalten:

- **Idempotent:** innerhalb des Intervalls legt ein Aufruf ohne `force` nichts an
  (`ran: false`, leere Liste) — es gibt keinen stillen Zweitlauf im Minutentakt.
- **Nur verifizierte Kopien** werden gelöscht, und **nie** die neueste oder die
  einzige Kopie eines Stores. Beschädigte Sicherungen sind ein Befund und werden
  gemeldet (`corrupted`), nicht gelöscht.
- Jeder Lauf wird **verifiziert** (Digest je Datei) und erzeugt ein Ereignis
  (`persistence.backup.scheduled`) sowie einen Audit-Eintrag
  (`persistence.backup.run`, `ALLOW`); das Aufräumen ist ebenfalls auditiert
  (`persistence.backup.prune`).
- Der Zustand liegt im Store `backup-automation` (digest-geprüfter Envelope) und
  ist im Control Center unter **Betrieb/Persistenz → Backup-Automation** sichtbar
  (Intervall, Aufbewahrung, Läufe, Fälligkeit, verifizierte Kopien).

Nachweise: `tests/integration/backup-automation.test.ts` (9 Tests, u. a.
„löscht nie die einzige Sicherung", Negativnachweis gegen eine absichtlich
abgeschwächte Grenze, Route 201/401/400), `scripts/audit-actions.mjs`
(Kette „Alarmierung/Backup") und `scripts/audit-api.sh` §7.

**Grenze:** die Automation ist ein *geplanter* Lauf, aber es gibt in dieser
Umgebung **keinen Scheduler-Daemon** — der Lauf wird vom Creator oder einem
externen Timer ausgelöst. Ein Betrieb ohne Auslöser ist damit `NOT_VERIFIED`.

## 4. Bereitschaft, Lockdown, Recovery

- `GET /api/readiness` → `{activeTasks, blockedTasks, lockdown, ready}`.
  `ready` ist nur wahr ohne Lockdown und ohne blockierte Task.
- System-Lockdown: `POST /api/control {action:"lockdown", locked:true}` (Creator).
  Danach verweigert der Execution Gate **jede** Ausführung (`EXECUTION_GATE`).
- Task-Isolation während Recovery setzt einen Task-Kill-Switch
  (`lib/recovery-orchestrator.ts#recoverFailure`).

## 5. Live-Verifikation (`scripts/verify-live.sh`)

Das Skript prüft die laufende Instanz über **echtes HTTP** und bricht bei der ersten
Abweichung ab (`set -euo pipefail`). Umfang: Bootstrap-/Login-Zustand, Session-Pflicht
(401/428), Missionen/Objectives/Tasks, Sandbox-Lifecycle inkl. Snapshot/Restore,
Ausführung mit Capability-Token, Verweigerungen (fremde Bindung, Shell-Programm,
widerrufenes Token, Lockdown), Evidence/Provenance/Audit-Kette, Metriken, Persistenz,
Backups, Readiness und Queue. Ergebnis wird als Anzahl `PASS`/`FAIL` ausgegeben.

Ergänzend prüft `scripts/audit-api.sh` **alle Routen** über HTTP (GET-Bestand,
POST mit unlesbarem/leerem Body, Zugriff ohne Session, unvollständige Nutzdaten,
frühere Fehlerbilder, die autonome Fehlerkette sowie Alarmierung/Sicherung) — letzter Lauf
**204 Prüfungen / 0 Fehler**, Exit 0; Details in `docs/TESTING.md` §4b.

`scripts/audit-actions.mjs` prüft zusätzlich **jede Aktion und jedes Attribut**
der Matrix, die direkt aus dem Quellcode gelesen wird, und fährt 14
Interaktionsketten mit echten Kennungen durch (inkl. „Alarmierung/Backup“ mit Service-Level) —
letzter Lauf **502 Prüfungen / 0 Fehler**, Exit 0;
Details in `docs/TESTING.md` §4c.

`scripts/audit-ui.mjs` prüft die Oberfläche in drei Stufen: Quellvertrag
(40 Abschnitte, Renderpfade, Spalten, kein literales Markdown), Auslieferung
(Assets, Sprache, Cookie-Flags, **kein Geheimnis im HTML/JS**) und den
Datenvertrag jedes Abschnitts gegen die echte Route — letzter Lauf
**88 Prüfungen / 0 Fehler**, Exit 0; Details in `docs/TESTING.md` §4d.

Prüfumfang des Skripts (**174 Prüfungen** auf einer bereits initialisierten Instanz, wiederholbar;
der Bootstrap-Zweig enthält zwei Prüfungen mehr — dann 176, mit verpflichtendem zweitem Faktor zwei weitere, ohne
delegierten cgroup-Unterbaum zwei weniger):
Authentifizierung, Mission → Objective → Task → Sandbox → Capability, autorisierte Ausführung
mit Evidenzprüfung, Angriffsblockaden, **Evidenz einer blockierten Autorisierung
(`kind=DENIAL`, Digest erneut geprüft, keine Klartext-Argumente)**, Fehlerkette bis
`REGRESSION_LOCKED`, Governance/Privacy/Provider/Geräte/Computer Use, Restore, Persistenz
inkl. Backup und **Store-Reparatur**, Metriken, Readiness, Audit-DENY-Nachweis und
Aufbewahrungszustand sowie der Agentenweg ohne Browser-Session, die **Replay-Verweigerung**
(zweiter Lauf mit demselben Token → 409 + `DENIAL`-Evidenz) und die **gemessene Kernel-Isolation**
(Schritt 11: Capabilities, `NoNewPrivs`, `EROFS`, Loopback, leere Routingtabelle).
Die Prüfung ist idempotent: eine frühere Fassung verlangte eine jungfräuliche Instanz
(„kein Computer vorautorisiert") und schlug fehl, sobald eine andere Prüfung zuvor einen Computer
autorisiert hatte — jetzt wird ein frisch entdeckter Computer geprüft (unautorisiert und nicht
belegbar).

Mit gesetztem `BOB_CREATOR_TOTP_SECRET` prüft Schritt 12 zusätzlich den zweiten Faktor über HTTP
(Status, Ablehnung ohne/mit falschem Code, Akzeptanz, Replay-Ablehnung). Das Skript berechnet den
Code lokal aus dem Secret; ein verbrauchter Code ist Teil des Replay-Schutzes, deshalb wartet es für
eine zweite gültige Anmeldung auf das nächste Zeitfenster.

Der Live-Lauf ist der Nachweis gegen die **echte HTTP-Oberfläche**; er ist ausdrücklich keine
Aussage über Produktionslast (keine Lastkurve, keine SLO-Messung).

## 5a. Begrenzter Lastnachweis (`scripts/soak.mjs`)

```bash
BASE=http://localhost:3000 BOB_BOOTSTRAP_SECRET=… BOB_CREATOR_LOGIN_SECRET=… \
SOAK_COUNT=120 SOAK_CONCURRENCY=4 SOAK_REPORT=/tmp/bob-soak.json node scripts/soak.mjs
```

Das Skript meldet sich an, legt Mission/Objective/Task/Sandbox an und führt `SOAK_COUNT`
**autorisierte** Ausführungen über die echte HTTP-Oberfläche aus — je Ausführung wird ein eigenes
Capability-Token ausgestellt und verbraucht (eine Autorisierung = eine Ausführung). Gemessen werden
Latenz je Ausführung (min/p50/p95/p99/max), Durchsatz, Fehlerquote sowie der Zustand danach
(Audit-Kette, Aufbewahrung, Store-Integrität, Isolationsstufe). Das Ergebnis wird als JSON
geschrieben; der Exit-Code ist ungleich 0, sobald eine Ausführung scheitert.

Gemessene Momentaufnahme (2026-09-25, `REAL_LOCAL` mit Kernel-Isolation `NAMESPACES`, dieselbe
Maschine, Session-gebundene Creator-Anmeldung):

| Lauf | Ausführungen | Nebenläufigkeit | Erfolg | p50 | p95 | Durchsatz | Audit/Stores danach |
|---|---|---|---|---|---|---|---|
| A | 120 | 4 | 120 / 0 | 1,31 s | 2,33 s | 2,11 /s | Kette gültig (`FULL_CHAIN`), Integrität 1 |
| B | 120 | 8 | 120 / 0 | 4,84 s | 6,66 s | 1,14 /s | Kette gültig (`FULL_CHAIN`), Integrität 1 |

**Definierte Schwellen für den Lauf** (seit dieser Runde): `SOAK_SLO_P95_MS` (Vorgabe 5000 ms) und
`SOAK_SLO_MIN_SUCCESS_RATIO` (Vorgabe 1,0). Der Lauf endet mit Exit 1, sobald p95 das Budget
überschreitet oder Ausführungen fehlschlagen; der Bericht enthält den Abschnitt `slo`
(`state: MEETS_BUDGET|BREACHED`). Negativnachweis: mit `SOAK_SLO_P95_MS=1` endet ein Lauf mit
Exit 1 und `state: BREACHED` (p95 1,06 s) — die Schwelle ist wirksam, nicht dekorativ.

| Lauf | Ausführungen | Nebenläufigkeit | Erfolg | p50 | p95 | Budget | Zustand |
|---|---|---|---|---|---|---|---|
| C (mit Schwellen) | 40 | 4 | 40 / 0 | 1,59 s | 2,22 s | 5,00 s | `MEETS_BUDGET` |
| D (Negativnachweis) | 5 | 2 | 5 / 0 | — | 1,06 s | 0,001 s | `BREACHED`, Exit 1 |

Beobachtung (kein SLO): Mehr Nebenläufigkeit **erhöht** die Latenz und senkt den Durchsatz. Ursache
ist die serielle Persistenz- und Mount-Arbeit je Ausführung (Datei-Store-Schreibvorgänge mit
tmp+rename und fsync sowie der Aufbau der Isolation: `unshare`, Binds, `chroot`), nicht die CPU.
Allein das Ausstellen eines Tokens kostet in diesem Betrieb p50 ≈ 0,41 s. Für höheren Durchsatz wäre
ein anderer Persistenzpfad (gebündelte Schreibvorgänge) und ein vorbereiteter Rootfs-Mount nötig —
beides ist hier `NOT_IMPLEMENTED`. Diese Zahlen sind eine Momentaufnahme eines begrenzten Laufs in
dieser Umgebung: **keine** SLO-Zusage, **keine** Lastkurve, kein Dauerlauf.

**Betriebsweite Service-Level (`lib/slo.ts`, `/api/slo`, Abschnitt „Service-Level“ im Control
Center):** Zehn Messgrößen mit Zielwert, Warn- und kritischer Grenze werden gegen den **echten**
Zustand bewertet (Warteschlange, Store-Integrität, Sicherungen, Readiness, Verweigerungen,
Isolation, Audit-Kette, Agenten-Heartbeats). Ein fehlender Messwert ist `UNKNOWN` und wird **nicht**
als gesund ausgegeben. `POST /api/slo {action:"evaluate"}` meldet Verletzungen als `BLOCK`, fehlende
Messwerte als `ASK` in die Creator-Inbox — die Bewertung repariert nichts und schaltet nichts ab;
`GET /api/slo` ist rein lesend. Messung auf der Frischinstanz (2026-09-25):
9 gesund / 1 gewarnt / 0 verletzt / 0 ohne Messwert bei `coverageComplete: true` — gewarnt war
`executions_denied` (10 belegte Verweigerungen aus den vorangegangenen Live-Prüfungen).

**Runbook „Isolation fehlt":** Meldet `GET /api/runtime` `level: "FILESYSTEM_ONLY"` und laufen
Ausführungen mit 409 auf, dann fehlt der Rootfs (Volume nicht gemountet, Pfad falsch) oder die
Umgebung erlaubt keine unprivilegierten User-Namespaces. Vorgehen: `bash scripts/build-ns-rootfs.sh`
ausführen bzw. `BOB_NS_ROOTFS` prüfen; keine Ausführung erzwingen. Ein Betrieb mit voller
Funktionalität ohne Kernel-Isolation ist nur mit ausdrücklichem `BOB_NS_ISOLATION=off` möglich und
gilt dann als `FILESYSTEM_ONLY`.

Beispiel:

```bash
BASE=http://localhost:3000 SECRET=<creator-login> STORAGE=/tmp/bob-live \
  bash scripts/verify-live.sh
```

**Runbook „Geräte-Enrollment nicht konfiguriert" (fail closed, gemessen am 2026-09-25):** Ohne
`BOB_DEVICE_ENROLLMENT_SECRET` (mindestens 16 Zeichen) antworten `POST /api/devices
{action:"enroll"}` und `{action:"heartbeat"}` mit **503 `ENROLLMENT_DISABLED`** — Discovery bleibt
absichtlich fail closed, und die Prüfskripte werten jeden 5xx als Fehler. Auf einer Instanz ohne
dieses Secret meldet `scripts/audit-actions.mjs` deshalb **494 / 2** (die beiden
Enrollment-Aufrufe „ohne Attribute") und `scripts/audit-ui.mjs` **87 / 1** („Geräte-Autorisierung:
kein Gerät gemeldet"), obwohl der Code korrekt ist. Reparatur ist **Konfiguration, nicht Code**:
Secret in der Serverumgebung setzen (z. B. `openssl rand -hex 24`), Server neu starten; danach
werden der vollständige Enrollment-Pfad und die „autorisiert erst nach Creator-Akt"-Regel geprüft
(502 / 88 Prüfungen). Das Enrollment-Geheimnis autorisiert **nie** ein Gerät, es erlaubt nur
Discovery und Lebenszeichen.

## 6. Betriebsregeln

- Kein öffentlicher Probe-Endpunkt: auch `/api/readiness` und `/api/metrics` verlangen eine Session.
- Der Browser erhält **nie** Root-Token, Provider-/Device-Credentials oder Runtime-Secrets.
- `.bob-data` (bzw. `BOB_STORAGE_DIR`) wird nicht versioniert; Sicherungen bleiben local.
- Nach jedem Neustart: `verifyStoreBackup`-Bericht prüfen (`GET /api/persistence`).
- `BOB_AUDIT_MAX_RECORDS` nur bewusst setzen; jede Kürzung ist im Bericht sichtbar. Für
  Nachweis-/Auditzwecke (kein Kürzen) die Variable leer lassen.
- `BOB_AUDIT_HMAC_KEY` erhöht die Manipulationssicherheit von „erkennbar" auf „ohne Schlüssel
  nicht unbemerkt neu berechenbar"; ohne Schlüssel bleibt die Kette manipulations*erkennbar*.

## 7. Grenzen

- Ein automatischer Rollback von Deployments existiert nicht (`NOT_IMPLEMENTED`).
- Es gibt keine externen Alarmierungskanäle; Alarmregeln sind als Schwellen in
  `docs/SECURITY.md`/`docs/OPERATIONS.md` dokumentiert, müssen aber im Betrieb an ein
  Monitoring angebunden werden (`NOT_VERIFIED`).
- Ein Multi-Knoten-Betrieb (mehrere Control-Plane-Instanzen auf demselben Storage-Root)
  ist nicht unterstützt: Schreibvorgänge sind atomar, aber es gibt kein verteiltes Sperren.
