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
  `bob_failures`, `bob_failures_verified`, `bob_recovery_plans` u. a.
- Ereignisse: `lib/events/log.ts` (kausale Kette, `causalParentId`), sichtbar über
  `GET /api/events` und `GET /api/timeline`.
- Werte sind Zählerstände, keine Erfolgsversprechen; fehlende Daten werden nicht „geschätzt".

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
frühere Fehlerbilder und die autonome Fehlerkette) — letzter Lauf
**184 Prüfungen / 0 Fehler**, Exit 0; Details in `docs/TESTING.md` §4b.

`scripts/audit-actions.mjs` prüft zusätzlich **jede Aktion und jedes Attribut**
der Matrix, die direkt aus dem Quellcode gelesen wird, und fährt 14
Interaktionsketten mit echten Kennungen durch — letzter Lauf
**433 Prüfungen / 0 Fehler**, Exit 0; Details in `docs/TESTING.md` §4c.

Prüfumfang des Skripts (**171 Prüfungen** bei Erstinitialisierung, **169** wenn die Instanz
bereits initialisiert ist — der Bootstrap-Zweig enthält zwei Prüfungen mehr; mit verpflichtendem
zweitem Faktor **177 / 175**; ohne delegierten cgroup-Unterbaum **168 / 166**):
Authentifizierung, Mission → Objective → Task → Sandbox → Capability, autorisierte Ausführung
mit Evidenzprüfung, Angriffsblockaden, **Evidenz einer blockierten Autorisierung
(`kind=DENIAL`, Digest erneut geprüft, keine Klartext-Argumente)**, Fehlerkette bis
`REGRESSION_LOCKED`, Governance/Privacy/Provider/Geräte/Computer Use, Restore, Persistenz
inkl. Backup und **Store-Reparatur**, Metriken, Readiness, Audit-DENY-Nachweis und
Aufbewahrungszustand sowie der Agentenweg ohne Browser-Session, die **Replay-Verweigerung**
(zweiter Lauf mit demselben Token → 409 + `DENIAL`-Evidenz) und die **gemessene Kernel-Isolation**
(Schritt 11: Capabilities, `NoNewPrivs`, `EROFS`, Loopback, leere Routingtabelle).

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

Beobachtung (kein SLO): Mehr Nebenläufigkeit **erhöht** die Latenz und senkt den Durchsatz. Ursache
ist die serielle Persistenz- und Mount-Arbeit je Ausführung (Datei-Store-Schreibvorgänge mit
tmp+rename und fsync sowie der Aufbau der Isolation: `unshare`, Binds, `chroot`), nicht die CPU.
Allein das Ausstellen eines Tokens kostet in diesem Betrieb p50 ≈ 0,41 s. Für höheren Durchsatz wäre
ein anderer Persistenzpfad (gebündelte Schreibvorgänge) und ein vorbereiteter Rootfs-Mount nötig —
beides ist hier `NOT_IMPLEMENTED`. Diese Zahlen sind eine Momentaufnahme eines begrenzten Laufs in
dieser Umgebung: **keine** SLO-Zusage, **keine** Lastkurve, kein Dauerlauf.

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
