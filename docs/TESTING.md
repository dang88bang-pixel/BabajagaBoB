# Teststrategie und Testnachweis

**Stand:** 2026-09-26
**Testrunner:** Vitest 3 (`vitest.config.ts`, Node ≥ 22)
**Letzter verifizierter Lauf:** `npx vitest run` → **63 Dateien, 422 Tests, alle grün**
(Unit 126, Security 135, Integration 122, Regression 15, UI 13, E2E 11); `./node_modules/.bin/tsc --noEmit` fehlerfrei; `npx eslint .` 0 Fehler / 11 Warnungen; `npm run build` erfolgreich.
Zusätzlich laufen zwei Nachweisprüfer gegen den **echten** Dienst: `node scripts/fault-injection.mjs`
(SIGKILL + Neustart) → **28/28 Prüfungen in 2 Absturzzyklen**, und `node scripts/sabotage.mjs`
(abgeschwächte Schutzregeln) → **25/25 Proben erkannt** (mit vorgeschalteter Grundprobe: die Suiten der Proben laufen zuerst **ohne** Mutation grün).
Der Abnahmeprüfer `node scripts/acceptance.mjs` läuft mit **15 bestanden / 0 fehlgeschlagen**, der
Selbsttest der Matrix mit 4/4 und der Kettentest mit 4/4; live gegen die Instanz `:3100`
(Matrix-Nachweise) **84 bestanden / 0 fehlgeschlagen**, davon **68/68 Routen-Nachweise** (mit Sitzung).
Zusätzlich live gegen den Produktionsserver geprüft (`BOB_NS_ISOLATION=on` mit gebautem Rootfs): `scripts/verify-live.sh` → **173 Prüfungen, 0 Fehler** beim ersten Lauf (**171** auf einer bereits initialisierten Instanz; der Bootstrap-Zweig zählt zwei Prüfungen mehr); ohne delegierten cgroup-Unterbaum **168 / 166** (drei Prüfungen entfallen dann). Mit verpflichtendem zweitem Faktor (TOTP) sind es **177 / 175**; siehe §4a. Negativnachweis derselben Instanz ohne Rootfs: Isolation wird als `FILESYSTEM_ONLY` ausgewiesen und **jede** Ausführung mit 409 verweigert (`kernel isolation is enforced … but unavailable`); das Skript meldet dann erwartungsgemäß 125 PASS / 22 FAIL, weil alle ausführungsabhängigen Schritte bewusst scheitern.

**Runde 2026-09-26 (Wiederherstellung nach Sandbox-Reset, Betriebsgrenzen live):** Live auf der Instanz
`:3100` mit delegiertem cgroup-Unterbaum (`BOB_CGROUP_DIR=/sys/fs/cgroup/bob`, `cgroup: ENFORCED`,
`BOB_NS_ISOLATION=on`, Kernel-Isolation `NAMESPACES`): `scripts/verify-live.sh` → **174 / 0**,
`scripts/audit-actions.mjs` → **525 / 0**, `scripts/audit-api.sh` → **248 / 0**, `scripts/audit-ui.mjs`
→ **92 / 0** (47 Datenabrufe, 29 Abschnitte mit echten Zeilen), `node scripts/acceptance.mjs --live`
→ **84 / 0** (68/68 Routen-Nachweise). Zusätzlich der Nachweis der Betriebsgrenze mit **Standardbudget**
(`BASE=… BOOTSTRAP_SECRET=… CREATOR_SECRET=… bash scripts/verify-rate-limit.sh` gegen eine zweite,
**frische** Instanz **ohne** `BOB_RATE_LIMIT_MAX`; die Geheimnisse kommen aus der Umgebung) → **6 / 0**:
30 erlaubte Anmeldeversuche, der 31. wird mit `429` + `retry-after: 60` abgewiesen, der Fehlercode ist
`RATE_LIMITED`, die Abweisung steht als `DENY` in der Audit-Kette und die Kette bleibt gültig.

## 1. Suiten und Abdeckung

| Suite | Dateien | Tests | Inhalt |
|---|---|---|---|
| `tests/unit` | 15 | 126 |    Persistenz-Envelope (Digest, Manipulationserkennung, Versionsprüfung, Registry), Control Plane (Mission/Objective/Task, Risiko-/Approval-Regeln, Persistenz), Agent Fabric (11 Rollen, Autonomie-Grenzen, Heartbeat, persistente Handoffs), **Recovery-Tier-Klassifikation** (Stufen 1–5 mit Begründung und Creator-Freigabepflicht), **Store-Migration** (v1 → v2, Sicherungskopie, Journal, fehlende Kette/neuere Datei → fail closed, migrierende Backup-Wiederherstellung, Schutz und Reparatur inhaltsloser Envelopes), **Persistenz von Betriebszustand** (Pipelines, Skills, Werkstatt, Handoffs über Neuladen der Laufzeit), **Service-Level** (`slo.test.ts`, 9 Tests: gerichtete Schwellen, fehlender Messwert = `UNKNOWN` statt gesund, Bericht aus dem echten Zustand, Meldung an die Creator-Inbox ohne Nebenwirkung, Route 200/401/400), **Status-Modell** (`status-model.test.ts`, 5 Tests: jeder im Typ deklarierte Zustand ist beschrieben, jeder Tone hat eine CSS-Regel, unbekannte Werte werden nicht als gesund ausgegeben, nur echte Endzustände sind terminal, jeder neue Zustand hat einen echten Produzenten im Code), **Audit-Aufbewahrung** (append-only ohne Kürzung, Kürzung nur mit Checkpoint, Rekonstruktion des Kopfes bei Altbeständen, Datei- **und** Ketten-Manipulation erkannt), **Sabotagekatalog** (`sabotage-plan.test.ts`, 13 Tests: jeder Anker kommt genau einmal vor, jede genannte Testdatei existiert, jede tragende Grenze hat eine Probe, beide Prüfer sind als Pflichtstufen in der CI verdrahtet, der echte Prüferlauf `--check` endet mit 0) |
| `tests/security` | 20 | 135 | Authority-Invarianten (Selbstvergabe, Wildcards, TTL, Risk-Eskalation, Audit-DENY), **Wiederholungssperre für Capability-Token** (zweiter Lauf verweigert, Evidenz + Audit, freigegebene Anzahl Verwendungen, parallele Läufe mit genau einer Freigabe, Vorprüfung ≠ Verbrauch), API-Guard (428/401/403, CSRF-Origin, Session, Legacy-Token fail-closed), argv-Policy (Broker-DENY + Runtime-Defense-in-Depth), API-Gate (Bootstrap, Session, CSRF, Renew/Logout, keine Agent-/Legacy-Token an der Grenze), Creator-Login (Secret-Datei 0600, Konstantzeit, Audit, Sperre), **TOTP als zweiter Faktor** (Fenster ±1, Replay-Schutz, Pflicht bei gesetztem Secret, Replay/Sperre), **Creator Inbox** (Anlegen, Beantworten nur durch Creator, doppelte Beantwortung abgelehnt, unbekannte Aktion 400, Sessionpflicht), Routen-Guards (Provenance/Knowledge/Runs: 428 vor Bootstrap, 401 ohne Authentifizierung, `CREATOR_ONLY` für Agenten-Schreibzugriff, `CAPABILITY_DENIED` ohne `run:manage`, CSRF-Origin, Audit-Integrität), **Token-Ablauf und Leseprojektion** (`authority.test.ts`/`token-read-projection.test.ts`: ohne gültiges `expiresAt` wird kein Token ausgestellt, ein abgelaufenes Token wird bei der Prüfung verweigert, `GET /api/capabilities` und `GET /api/authority` liefern **keinen** `secretHash` mehr), **Direkter Routenaufruf ohne Gate** (428 vor Bootstrap, 401 `UNAUTHENTICATED` nach Bootstrap statt 500/503, 200 mit Session, kein Agenten-/Legacy-Token), **kein Ausführungspfad um den Broker** (`tests/security/gate-bypass.test.ts`: interne Läufe von Regression und Smoke-Test laufen über `SYSTEM-WORKER` → Gate → Broker → Evidenz, der Kill Switch blockiert sie, ohne die Delegationskante `CREATOR → SYSTEM-WORKER` wird nichts ausgeführt, der Zweck steht im Ereignisstrom; Systemausstellung gibt kein erschöpftes Token erneut heraus), **Routenvertrag rekursiv** (`api-route-contract.test.ts` prüft jetzt auch verschachtelte Routen; die Verschärfung deckte `app/api/approvals/center` und `app/api/workshop/execute` ohne Aktionsprüfung auf — beide sind nachgezogen), **Regressionstests für die nachgezogenen Routen** (`route-guards.test.ts`: ohne Session 401, Agenten-Token ohne `workshop:step` 403, unbekannte Aktion 400, fehlendes Werkstatt-Objekt 400), **Geräte-Registrierung** (`tests/security/device-enrollment.test.ts`, 8 Tests: fail closed ohne Geheimnis, falsches/fehlendes Geheimnis wird verweigert und auditiert, gültige Meldung ohne Autorisierung auch bei Behauptung, Lebenszeichen ändert die Freigabe nicht, Enrollment kann nicht autorisieren/reservieren/freigeben, Creator-Weg unverändert, unzulässige Kennungen werden abgewiesen, Geheimnis erscheint in keiner Antwort), **Promotion-Gates** (`promotion-gates.test.ts`, 11 Tests: Produktion ist ohne vollständige Prüfliste, ohne Smoke-Stufe, ohne Referenz und ohne **erteilte** Freigabe gesperrt; Staging verlangt eine promovierte Stufe, benennt fehlende Pflichtprüfungen und verweigert übersprungene Prüfungen ohne Begründung; quittierte Lücken erscheinen als `acknowledgedGaps`; ein Deployment-Kill-Switch blockiert beide Wege — die Zusicherungen prüfen den **benannten Grund**, nicht bloß „irgendein Fehler“) |
| `tests/integration` | 19 | 122 | Sandbox-Fabric mit `REAL_LOCAL` (Bindung, Prozessausführung, Snapshot + Digest, Verifikation, ALLOWLIST fail-closed), Provider-Fabric (Approval-Pflicht, Bindungen, Health, Datenvertrag), App-Module (Fabric-gebundene Sandboxes, Lifecycle), Computer Use (Registrieren ≠ Autorisieren, Allocation nur mit Freigabe), **Ausführungs-Evidenz** (Digest über stdout/Exit-Code, Provenance-Knoten, Persistenz, Kürzung, Manipulationserkennung, **Verweigerungs-Evidenz**: blockierte Autorisierung wird digest-gebunden und ohne Klartext-Argumente festgehalten), **Nebenläufigkeit** (12 parallele autorisierte Ausführungen, 6 verweigerte Fremdbindungen), Backup mit Digest-Prüfung (manipuliertes Backup → 409) und Betriebsmetriken (Prometheus-Text, nur Zahlen, keine Geheimnisse) , **Kernel-Isolation** (`tests/integration/ns-isolation.test.ts`, 11 Tests: Prozess-Probe mit Capabilities/`NoNewPrivs`/`EROFS`, Netzwerk-Namespace, argv-Canary, Prozessgruppen-Timeout, verschwundener Rootfs, fail closed) , **Ressourcenlimits** (CPU-Zeit/Dateigröße per rlimit, Speicher/Prozesse per cgroup mit `pids.max`/`memory.max`, Aufräumen des cgroup-Zweigs, fail closed bei gesetztem aber unbrauchbarem `BOB_CGROUP_DIR`), **Alarmierung** (`tests/integration/alerting.test.ts`, 8 Tests: jede Regel ist an eine real ausgelieferte Kennzahl gebunden, unbekannte Kennzahl macht die Regeldatei ungültig statt wirkungslos, Pflichtregeln, deterministische YAML-Struktur, Route 200/401/428) , **Backup-Automation** (`tests/integration/backup-automation.test.ts`, 9 Tests: Aufbewahrung löscht nur verifizierte Kopien jenseits der Grenze und nie die neueste oder einzige, beschädigte Sicherungen werden gemeldet statt gelöscht, ENV-Grenzen mit Rückfall, idempotenter Lauf, erzwungener Lauf, Status mit Fälligkeit und Integrität, Audit + Kette, Route 201/401/400) , **Verkettung der Fabric** (`tests/integration/visualization.test.ts` 11 Tests) , **Observatory und Warum-Record** (`observatory-why.test.ts`, 8 Tests: echte Aktivität aus Mission → Task → Run, neun Observatory-Felder samt benannter Lücken, Kausalkette ältester→betroffenes Ereignis, Grenzen des Records, Route mit Session/404/400, Defekt-Klassifikation `BUG` gegen Umgebungsfehler), **Worker-Fehlerkette** (`tests/integration/worker-recovery.test.ts`, 8 Tests: Lease vor dem Start, kontrolliertes Scheitern ohne Zyklusabbruch, Incident über Hypothese/Experiment/Evidenz/Root Cause bis `FIXING`, begonnener Recovery-Plan mit Checkpoint, Lauf in Verifikation, Job-Zurückstellung ohne Versuchsverbrauch, Nachweiszwang vor der Ursache), **Fehlerinjektion** (`tests/integration/fault-injection.test.ts`, 10 Tests: sechs Injektionsarten über die echte Kette Mission → Task → Sandbox → Capability → Broker; Prozessabbruch ohne Erfolgsverbuchung, Worker-Verlust, Netzwerkverweigerung fail closed ohne Phantom-Sandbox, doppelter Job, konkurrierende Schreibvorgänge, Store-Manipulation mit Wiederherstellung; jede Injektion belegt Store-Integrität, Event- und Audit-Kette, Evidenzartefakt mit Digest, Wissensknoten und Audit `fault.inject`; `FAILED` erzeugt Fehlerfall und Inbox-`BLOCK`; Kill-Switch verweigert mit 423; unbekannte Art wird verweigert statt still ignoriert) |
| `tests/regression` | 3 | 15 | Regression Engine: argv-Policy, Registrierung, PASS/FAIL, Suite fail-closed bei Fehlschlag, Persistenz; **Oberflächenvertrag** (`ui-contract.test.ts`: Navigations-/Quellvertrag der Control-Center-Komponente — kein literales Markdown im sichtbaren Text, jede Tabellenspalte ist ein deklariertes Feld, jede Datenquelle zeigt auf eine existierende Route, Runtimes-Tabelle folgt `RuntimeDefinition`); **Isolationsbericht** (`ns-report-cache.test.ts`: ein später gebauter Rootfs wird ohne Neustart erkannt, ein verschwundener Rootfs fällt sofort auf `FILESYSTEM_ONLY` zurück) |
| `tests/ui` | 2 | 13 | Control-Center-Oberfläche unter jsdom: **vollständige Navigationsliste (42 Abschnitte)** vorhanden, echte Serverdaten werden als Zeilen gerendert (kein Platzhalter „READY“), fehlende Daten werden ausdrücklich als „nicht verfügbar“ gemeldet, Geräte weisen „nein — Discovery ≠ Autorisierung“ aus, Betrieb/Persistenz zeigt die Backup-Automation mit Intervall, Aufbewahrung und Idempotenzhinweis, Metriken zeigt die geprüften Alarmregeln, ohne Session erscheint die Anmeldemaske und keine Rohdaten; zweite Datei ruft die **echten Routen-Handler** auf (39 Routen) und prüft, dass gerenderte Datensätze tatsächlich aus der API stammen (inkl. Alarmregeln der echten Route und Backup-Automation), und dass der Abschnitt **Fehlerinjektion** eine real injizierte Störung mit Kennung, Ergebnis und beobachteter Wirkung zeigt, während fehlende Skriptberichte ausdrücklich als „Kein Bericht vorhanden“ erscheinen (nichts wird erfunden) |
| `tests/e2e` | 4 | 11 | Kette Creator → Aufgabe → Autorisierung → Sandbox → Ausführung → Evidence → Knowledge sowie Fehlerkette DETECTED → DIAGNOSING → EXPERIMENTING → ROOT_CAUSE_FOUND → FIXING → VERIFYING → LEARNED → REGRESSION_LOCKED; **Abnahmekette** (`acceptance-chain.test.ts`: alle 18 Stufen über API, Persistenz, Audit/Event und Provenance) |

Ausführen:

```bash
npm run test          # alle Suiten
npm run test:unit
npm run test:security
npm run test:integration
npm run test:regression
npm run test:e2e
npm run verify        # lint + typecheck + test + build
```

## 2. Isolation und Testdaten

- Jede Testdatei legt über `tests/helpers/runtime.ts` → `isolatedStorageRoot(label)` ein eigenes temporäres
  `BOB_STORAGE_DIR` an (`mkdtemp`, außerhalb des Repos). Echte Laufzeitdaten (`.bob-data`) werden nie berührt.
- Zusätzlich gesetzt: `BOB_SANDBOX_RUNTIME=local` (echte lokale Runtime, kein Mock) und ein
  test-eigenes `BOB_BOOTSTRAP_SECRET`.
- Module werden nach dem Setzen der Umgebung mit `vi.resetModules()` + dynamischem Import geladen, damit
  Stores ihren Pfad korrekt binden.
- Bootstrap ist Pflicht: `completeBootstrap({secret, creatorName})` wird einmalig pro Suite aufgerufen.
  Tests umgehen niemals Authority, Gate oder Broker.

## 3. REAL gegen MOCK

- Standard in Tests und CI: `REAL_LOCAL` – jeder Prozess läuft als echter Kindprozess im Sandbox-Workspace
  (`argv[]`, `shell:false`), Snapshots sind echte Workspace-Snapshots mit SHA-256-Digest.
- `MockSandboxRuntime` bleibt Entwicklungsmodell und ist nur mit `BOB_ALLOW_MOCK_RUNTIME=1` erlaubt; kein Test
  deklariert Mock-Verhalten als Produktionsverhalten.
- `REAL_OCI` ist implementiert, aber **UNVERIFIED**: in dieser Umgebung fehlen Docker/Podman. Die OCI-Härtung
  (`--network none`, `--read-only`, `--cap-drop ALL`, `--security-opt no-new-privileges`) ist nicht praktisch
  verifiziert und wird im Bericht als `UNVERIFIED` geführt.

## 4. Abnahmekriterien (Abschnitt 49)

| Kriterium | Nachweis |
|---|---|
| E2E-Erfolgspfad: Creator → … → Knowledge | `tests/e2e/creator-flow.test.ts`, Test 1: autorisierte Ausführung mit Token, Evidence-, Audit- und Provenance-Prüfung |
| Bewusster Fehler durch Recovery, Regression, Knowledge | `tests/e2e/failure-recovery.test.ts`, Test 1: echter Fehllauf (Exit 7), Diagnosesandbox, Experiment + Evidenz, Root Cause, Snapshot/Restore, Regressionstest, `REGRESSION_LOCKED`, negatives + semantisches Wissen, Failure-Status `VERIFIED` |
| Blockierter Autorisierungsangriff | `tests/e2e/creator-flow.test.ts`, Test 2 (Selbstvergabe verboten, fremdes Token → `ExecutionDeniedError`) und `tests/security/argv-policy.test.ts` (auditierter Shell-DENY) |

Zusätzlich gelten als Regressionsschutz: Root Cause ohne Evidenz wird verweigert, leere Regression-Suite gilt
als Fehlschlag (fail closed), Verifikation ohne Snapshot nicht als `ACCEPT`.

## 4a. Live-Nachweis über die HTTP-Oberfläche (`scripts/verify-live.sh`)

Der Nachweis läuft gegen einen echten Produktionsserver (`npx next start`) und die vollständige
HTTP-Oberfläche – nicht gegen In-Process-Module. Aufruf:

```bash
rm -rf /tmp/bob-live && mkdir -p /tmp/bob-live
BOB_NS_ROOTFS=/tmp/bob-live/ns-rootfs bash scripts/build-ns-rootfs.sh   # 126 MB, einmalig
BOB_STORAGE_DIR=/tmp/bob-live BOB_BOOTSTRAP_SECRET=<einmal-secret> \
BOB_CREATOR_LOGIN_SECRET=<creator-secret> BOB_SANDBOX_RUNTIME=local \
BOB_NS_ISOLATION=on \
  npx next start -H 0.0.0.0 -p 3000

BOB_STORAGE_DIR=/tmp/bob-live BOB_BOOTSTRAP_SECRET=<einmal-secret> \
BOB_CREATOR_LOGIN_SECRET=<creator-secret> BASE=http://localhost:3000 \
  bash scripts/verify-live.sh
```

Das Skript bricht nie ab, sondern zählt PASS/FAIL und gibt die echte Serverantwort aus. Ergebnis des
letzten Laufs (2026-09-25, frisch initialisiertes Storage, cgroup v2 delegiert): **171 PASS / 0 FAIL**
(169 PASS / 0 FAIL auf bereits initialisierter Instanz), jeweils mit aktiver Kernel-Isolation und durchgesetzten Ressourcenlimits; ohne cgroup-Delegation 168 / 166.

Neu darin: **Schritt 10 – Agentenweg ohne Browser-Session**. Geprüft wird der Pfad, den
Agenten tatsächlich nutzen: `Authorization: Bobcap <id>.<secret>` → `POST /api/runtime`
mit `argv[]`, echte Ausführung (`stdout`), digestgebundene Evidenz (`ART-…`, SHA-256,
64 Zeichen), Nachprüfung des Digests über `GET /api/artifacts?verify=…`, Verweigerung
des Tokenzugriffs auf Verwaltungsrouten (401), Shell-Programm (409),
Subjekt-Spoofing (409) und Ausführung nach Widerruf (403) sowie Sperre durch den
System-Lockdown (409).

**Schritt 11 – Kernel-Isolation real gemessen.** Über dieselbe HTTP-Oberfläche wird ein
Isolationsprogramm als `argv[]` ausgeführt, das sich selbst vermisst (ohne Shell-Metazeichen, denn der
Broker verbietet sie). Belegter Wert aus `/proc/self/status` des isolierten Prozesses:

```json
{"capBnd":"0000000000000000","capEff":"0000000000000000","noNewPrivs":"1",
 "procs":1,"ifaces":"    lo:","routeLines":0,"ro":"EROFS","rw":"ok"}
```

Zusätzlich prüft der Schritt, dass `/api/runtime` die erzwungenen Garantien auflistet (`enforced[]`)
und dass ohne Rootfs die Stufe `FILESYSTEM_ONLY` gemeldet und die Ausführung verweigert wird.

**Schritt 12 – zweiter Faktor (TOTP) live** (nur mit `BOB_CREATOR_TOTP_SECRET`): Der Status
nennt `secondFactor: TOTP`, die Anmeldung **ohne** Code wird mit 403 abgelehnt, ein falscher Code
ebenfalls, ein gültiger Code wird akzeptiert (201) und seine **Wiederverwendung** innerhalb des
Fensters abgelehnt (Replay-Schutz, 403). Der Code wird im Skript lokal aus demselben Secret
berechnet; das Secret selbst verlässt den Server nicht. Weil ein akzeptierter Code verbraucht ist,
wartet das Skript für die zweite gültige Anmeldung auf das nächste Zeitfenster und wiederholt eine
Anmeldung höchstens einmal – drei aufeinanderfolgende Läufe sind damit ohne Creator-Sperre möglich
(geprüft: `locked: false` nach Lauf 3).

Zusätzlich geprüft: Der **Nachweis einer blockierten Autorisierung** (Abschnitt 49) –
`GET /api/artifacts?kind=DENIAL&taskId=…` liefert die Evidenz, ihr Digest ist über
`GET /api/artifacts?verify=…` erneut prüfbar, und die Evidenz enthält **keine
Klartext-Argumente** (nur Programm, Anzahl und SHA-256 über `argv`). Die Audit-Sicht
weist DENY-Datensätze und den Aufbewahrungszustand der Kette aus.

| Schritt | Geprüft | Ergebnis |
|---|---|---|
| 1. Authentifizierung | 428 vor Bootstrap, 401 ohne Credentials, falsches Secret nach Initialisierung → 403, Bootstrap 201 + Session, Creator-Login 201, `GET /api/control` 200 | PASS |
| 2. Kette | Mission → Objective → Task (zugewiesen) → Task-Status → Agent-Fabric (11 Rollen, Autonomie-Vertrag, keine Wildcards) | PASS |
| 3. Sandbox + Capability | Sandbox erstellt/gestartet, an Task+Agent gebunden, Netzwerk `DENY`, Snapshot mit SHA-256-Digest, Capability-Token (≤ 15 min, `sandbox:run`) | PASS |
| 4. Autorisierte Ausführung | Run (201) → `POST /api/runtime` mit `argv:["node","-e",...]`, `shell:false` → 200, stdout `live-ok`, Audit-DECISION `ALLOW`, Timeline-Events, Provenance-Kanten kausal verknüpft | PASS |
| 5. Blockierte Angriffe | unbekanntes Token 409, Shell-Programm 409 `SHELL_PROGRAM`, Metazeichen 409 `SHELL_METACHAR`, fremde Sandbox-Bindung 409, Audit-HMAC-Kette integer | PASS |
| 6. Fehlerkette | Incident → Diagnosesandbox (real gestartet) → Hypothese → Experiment → Evidenz → Root Cause → Recovery-Plan (Snapshot) → Restore → Regressionstest → Recovery `VERIFIED` → `fix.verify` `LEARNED` → Lernen → `REGRESSION_LOCKED` + negatives Wissen | PASS |
| 7. Governance | Kill-Switch-Liste, Lockdown blockiert Ausführung (409 am Gate), Freigabe hebt Block auf, Privacy default `DENY`, Provider nur entdeckt + Verbindung verlangt Approval, Gerät nicht implizit autorisiert, **11 Agentenrollen ohne Selbstvergabe/Produktionszugriff**, **frisch entdeckter Computer bleibt unautorisiert und ist nicht belegbar** (Discovery ≠ Autorisierung, zustandsunabhängig) | PASS |
| 8. Betrieb | Restore aus Snapshot, Pause, Destroy, Persistenzbericht ohne Integritätsfehler, Readiness, unbekannter Provider 400 | PASS |
| 9. Betrieb/Backup | Audit-Verifikation per POST, Backup mit Digest-Prüfung, Persistenzbericht mit verifizierten Backups, Prometheus-Metriken (Store-Integrität, Audit-Kette, 11 Agenten), Metriken ohne Session 401 | PASS |

**Letzter Lauf (2026-09-25):** `173 bestanden, 0 fehlgeschlagen`, Exit 0 — auf der
Frischinstanz `:3101` mit cgroup-Delegation und Kernel-Isolation; dieselbe Prüfung auf der
bereits benutzten Instanz `:3100` ergab `171 / 0` (vorher mehrfach
auf derselben Instanz; die Prüfung ist idempotent und verlangt keine jungfräuliche
Instanz mehr). Die Zahl steigt mit den Enrollment-Negativfällen (Discovery ≠
Autorisierung).

Struktureller Vertrag: `tests/security/api-route-contract.test.ts` prüft, dass **jede** Route außer
`/api/auth` eine konkrete Aktion prüft, keine leere Aktionsbezeichnung nutzt und keine Route
`publicAction` setzt. Eine neue Route ohne Prüfung lässt den Test fehlschlagen.

## 4b. Betriebsprüfung aller Routen (`scripts/audit-api.sh`)

Das Skript prüft die laufende Instanz vollständig über HTTP — unlesbare Nutzdaten,
fehlende Pflichtfelder, Zugriff ohne Session und die **autonome Fehlerkette**:

```bash
BASE=http://127.0.0.1:3200 BOB_BOOTSTRAP_SECRET=… BOB_CREATOR_LOGIN_SECRET=… \
  bash scripts/audit-api.sh      # Exit 0 nur bei 0 Fehlschlägen
```

| Abschnitt | Inhalt |
|---|---|
| 1 | jede GET-Route mit Session: 200, kein 5xx, kein leerer Body |
| 2 | jede POST-Route mit unlesbarem/leerem Body: 4xx statt 5xx |
| 3 | jede Route ohne Session: 401/403/428 statt Ausführung |
| 4 | unvollständige Nutzdaten → 4xx **ohne** Scheindatensatz in den Stores |
| 5 | Regression früherer Fehlerbilder (kein Request-Umschlag in der Registry, keine identitätslosen Objekte, echte Daten statt serialisiertem Promise) |
| 6 | autonome Fehlerkette: Dispatch → Worker-Zyklus → Incident `FIXING` mit Evidenz/Experiment/Plan → Lauf in Verifikation, Job zurückgestellt |
| 7 | Alarmierung an reale Kennzahlen gebunden (Regeldatei als YAML), geplante Sicherung idempotent, Aufbewahrung schützt das neueste Backup, unbekannte Persistenz-Aktion 400 |
| 8 | Service-Level nach `/api/slo`: Schwellen vollständig, Zustände nur `HEALTHY`/`WARNING`/`BREACHED`/`UNKNOWN`, Zusammenfassung = Einzelbewertungen, fehlende Aktion 400 |

**Letzter Lauf (2026-09-25):** `204 bestanden, 0 fehlgeschlagen`, Exit 0 — auf
derselben Instanz wiederholbar (Kennungen werden je Lauf neu vergeben).

## 4c. Vollständige Aktions-, Attribut- und Interaktionsprüfung (`scripts/audit-actions.mjs`)

Diese Prüfung ist nicht stichprobenartig: sie liest die **Aktionsmatrix aus dem
Quellcode** (`app/api/**/route.ts`) und prüft jede gefundene Aktion. Eine neue
Route oder Aktion ohne Prüfung kann sich damit nicht verstecken.

```bash
BASE=http://127.0.0.1:3100 BOB_BOOTSTRAP_SECRET=… BOB_CREATOR_LOGIN_SECRET=… \
  node scripts/audit-actions.mjs      # Exit 0 nur bei 0 Fehlschlägen
```

| Abschnitt | Inhalt |
|---|---|
| Statik | 40 POST-Routen, **129 Aktionen** und alle im Body gelesenen Attribute werden aus dem Code gelesen |
| 1. Robustheit | je POST-Route: unlesbarer Body, leerer Body, unbekannte Aktion → 4xx, nie 5xx; bei body-losen Routen (z. B. `/api/worker`) ist 2xx korrekt |
| 2. Attribute | je Aktion `{action}` ohne Attribute → 4xx (Ausnahmen: Aktionen ohne Attribute wie `renew`, `backup`, `repair`); je Attribut ein falscher Typ → kein 5xx |
| 3. Control Plane | Mission → Objective → Task → Agent (Zuweisung, Status, Heartbeat, Handoff mit Annahme) |
| 4. Runtime | Sandbox → Start → Snapshot (Digest) → Restore → Pause → Reset → Klon → Capability (**an einen Ablauf gebunden**; ohne `expiresAt` → 400) → Run → Execution Gate → autorisierte Ausführung → Reconciliation |
| 5. Fehlerkette | Incident → Triaging → Untersuchung → Hypothese → Experiment → Evidenz → Root Cause (mit Nachweispflicht) → Recovery (Stufe/Checkpoint) → Ausführung → Verifikation → Regressionstest → `fix.verify` → Lernen → `REGRESSION_LOCKED` mit negativem Wissen |
| 6. Fabric/Betrieb | Skills (Registrierung + Lifecycle), Werkstatt (Stufenübergang), Simulation + **Visualisierung in allen sieben Arten** (jeder Render liefert ein Evidenzartefakt mit Digest; die Bildroute liefert passives SVG; unbekannte Art → 400, unbekanntes Szenario → 404), ausführbares Modul, App + Zustand, Pipeline + Prüfung, Promotion-Gate inkl. Verweigerung |
| 7. Geräte/Provider | Gerät entdecken (nicht vorautorisiert) → autorisieren → reservieren → freigeben; Computer registrieren → Reservierung ohne Autorisierung verweigert → **auch bei mitgeschicktem `authorized:true` bleibt die Registrierung unautorisiert** → autorisieren; Provider ohne Freigabe verweigert; Secret-Lease ausstellen/prüfen/widerrufen/redigieren |
| 8. Kommunikation | Inbox in allen vier Modi (INFORM/ASK/BLOCK/ESCALATE) + Beantwortung, Approval anlegen/prüfen, Wissen anlegen/verknüpfen/aktualisieren, Provenance-Knoten/-Kante, Backup/Repair/Bericht |
| 9. Worker | Dispatch → Queue-Zustand → Lease/Start/Heartbeat/Complete → Leases abräumen → Worker-Zyklus mit allen Ergebnisklassen |
| 10. Governance | Kill-Switch setzen/prüfen/aufheben, Autoritätskante delegieren, Lockdown, Guardian, Audit-Kette, Artefakt mit serverseitigem Digest |
| 11. Science | Objective → Experiment → Evidenz → Validierung → Entscheidung, optionaler Experimentlauf über den Broker |
| 12. Integrität | alle 47 GET-Routen ohne 5xx/leeren Body, Readiness, Metriken |
| 13. Sitzung | `renew`, `logout`, danach ist die Sitzung ungültig (401) |
| 14. Restaktionen | Run-Lebenszyklus (Start, Abschluss, Abbruch, Fehler + Recovery), Queue-Fehlerpfad und Abbruch, Capability-Modi (`role-check`, `authorize`) inkl. unbekannter Rolle, Selbstvergabe verweigert, Provider-Heartbeat/-Bindung, Computer-Start/Release, Science-Lauf, Inbox-Doppelantwort, Approval-Auflösung mit Capability, Eskalation und unzulässiger Übergang |

**Letzter Lauf (2026-09-25):** `502 bestanden, 0 fehlgeschlagen`, Exit 0 — erweitert um
die Kette „Alarmierung/Backup" (Regelbindung, YAML, idempotenter Lauf, Aufbewahrung,
Service-Level-Schwellen) und die Enrollment-Negativfälle (Geheimnis allein autorisiert nicht); zuvor zweimal
hintereinander auf derselben Instanz wiederholt; je Visualisierungsart wird gerendert und
das Ergebnis als passives SVG über die Bildroute geprüft.

Alle drei Skripte sind auf derselben Instanz wiederholbar. Eine frühere Fassung
von `verify-live.sh` prüfte pauschal „kein Computer vorautorisiert" und schlug auf
jeder Instanz fehl, auf der eine andere Prüfung zuvor einen Computer autorisiert
hatte; die Prüfung ist jetzt zustandsunabhängig (frisch entdecken → unautorisiert
→ Belegung verweigert).

## 4d. Oberflächenprüfung des Control Centers (`scripts/audit-ui.mjs`)

Screenshots sind in dieser Umgebung nicht möglich (kein Browser). Geprüft wird
deshalb dreistufig über Quellcode, echte Auslieferung und echten Datenvertrag:

```bash
BASE=http://127.0.0.1:3100 BOB_BOOTSTRAP_SECRET=… BOB_CREATOR_LOGIN_SECRET=… \
  node scripts/audit-ui.mjs      # Exit 0 nur bei 0 Fehlschlägen
```

| Stufe | Inhalt |
|---|---|
| A. Statik | alle 41 Navigationsabschnitte haben einen Renderpfad (kein leerer Abschnitt), kein Renderzweig ohne Navigationseintrag, jede der 29 Datenquellen zeigt auf eine existierende Route, alle im Client genutzten API-Pfade existieren, **kein literales Markdown im sichtbaren Text**, keine Platzhalterwerte, **jede Tabellenspalte ist ein in `lib/`/`app/` deklariertes Feld**, keine Zugangsgeheimnisse im Clientcode |
| B. Auslieferung | `/` liefert 200 mit `lang="de"` und Titel, alle referenzierten JS-/CSS-Assets sind abrufbar (kein 404), Bootstrap und Creator-Login funktionieren, Session-Cookie ist `HttpOnly` + `SameSite`, **kein Geheimnis und keine Betriebsdaten** im HTML/JS (auch nicht mit Session), Token erscheint nicht im HTML |
| B2. Visualisierung | Bildroute liefert ohne Session 4xx, mit Session ein **passives SVG** (`<svg`, kein `<script`, kein `javascript:`), unbekannte Art → 400, unbekanntes Szenario → 4xx |
| B3. Alarmierung/Sicherung/Geräte | Regeln sind an die real ausgelieferten Kennzahlen gebunden (`validation.ok`, jede Regel mit Ausdruck/Schwere/Runbook), Regeldatei als YAML (`groups:`/`alert:`), Persistenz-Status zeigt Intervall/Aufbewahrung/Fälligkeit ohne fehlgeschlagene Sicherungen, Geräte melden den Enrollment-Zustand und **kein** Gerät ist ohne Creator-Freigabe autorisiert, jede SLO-Messgröße hat Zielwert/Warn-/kritische Grenze und der Zustand `UNKNOWN` ist ausgewiesen |
| C. Datenvertrag | je Abschnitt wird die tatsächlich verwendete Route abgerufen: `pick()`-Pfad muss ein Array ergeben (sonst zeigt die Seite fälschlich „keine Einträge"), konfigurierte Spalten müssen in den Daten vorkommen (fehlende optionale Felder werden als solche ausgewiesen), **Antworten dürfen keine Geheimnisfelder (`secretHash`, `secret`, `password`, …) enthalten** |

**Letzter Lauf (2026-09-25, Instanz `:3100`, cgroup-delegiert, `BOB_NS_ISOLATION=on`):**
`scripts/audit-ui.mjs` **90 bestanden, 0 fehlgeschlagen** (46 Datenabrufe, 30 Abschnitte mit
echten Zeilen — darunter der neue Abschnitt „Observatory" mit 31 Zeilen und allen 11 Spalten),
`scripts/verify-live.sh` **173 / 0** (erster Lauf; 171 auf einer bereits initialisierten Instanz
inklusive Bootstrap-Zweig), `node scripts/acceptance.mjs --live` **82 / 0** (66/66 Routennachweise),
`scripts/audit-actions.mjs` **503 / 0**, `scripts/audit-api.sh` **227 / 0** (neu: Abschnitt 8 prüft
Observatory, Warum-Record und das Status-Modell live), `scripts/soak.mjs` (40 Ausführungen,
p95 2,22 s) **`MEETS_BUDGET`**.

## 4e. Fehlerinjektion am laufenden Dienst (TEST-003)

`node scripts/fault-injection.mjs [--cycles=N] [--port=3300] [--storage=<dir>]`

Das Skript prüft nicht die Bibliothek, sondern den **Dienst**:

1. Es startet den gebauten Stand (`next start`) auf einem eigenen Port und benutzt ihn über HTTP
   (Bootstrap, Mission → Ziel → Aufgabe, Dispatch über den echten Endpunkt).
2. Es least den entstandenen Job — es liegt also echte Arbeit „in Arbeit“.
3. Es tötet die **Prozessgruppe** mit `SIGKILL` (kein Aufräumen, kein Hook, kein letzter Schreibvorgang)
   und weist nach, dass der Dienst **nicht** mehr antwortet.
4. Es startet neu und misst gegen **denselben** Speicher: Sitzung überlebt, Datenbestand unverändert,
   keine doppelten Job-IDs, die verwaiste Lease ist sichtbar, läuft wirklich ab und derselbe Job ist
   erneut ausführbar (mit erhaltenem Versuchszähler und respektiertem Backoff), Audit-Kette unversehrt,
   alle registrierten Stores lesbar und digest-geprüft.

Ergebnis des letzten Laufs (`--cycles=2`, Port 3311, Speicher `/tmp/bob-crash-probe`):

| Prüfung | Ergebnis |
|---|---|
| Prozess durch `SIGKILL` beendet, Dienst während des Absturzes nicht erreichbar | 2/2 bestanden |
| Dienst nach dem Absturz wieder erreichbar (neue PID) | 2/2 bestanden |
| Sitzung hat den Absturz überlebt (`authenticated=true`) | 2/2 bestanden |
| kein Datenverlust, keine Doppel-Jobs (gleiche Job-ID genau einmal) | 2/2 bestanden |
| verwaiste Lease sichtbar → läuft nach 60 s ab → Job wieder `QUEUED` | 2/2 bestanden |
| derselbe Job erneut ausführbar (Versuch 2 bzw. 3, Backoff 5 s beachtet) | 2/2 bestanden |
| Audit-Kette nach dem Absturz gültig und länger als vorher | 2/2 bestanden |
| 34 registrierte Stores digest-geprüft, 0 defekt, 0 unregistriert, Events ok | 2/2 bestanden |

**28/28 Prüfungen bestanden**; der Bericht liegt in `<storage>/fault-injection/report.json` und wird im
Control Center im Abschnitt **Fehlerinjektion** angezeigt. Ein Abbruch (z. B. kein Job erhalten) wird als
`FAILED` protokolliert und endet mit Exit-Code 1 — die Probe meldet lieber „nicht durchführbar“ als
„bestanden“.

Grenzen (bewusst offen): Die Probe läuft gegen **einen** Dienst auf einem Port, nicht gegen einen
Lastverteiler; sie prüft keinen Watchdog/keinen automatischen Neustart durch einen Daemon (es gibt keinen),
sondern die **Daten- und Nachweisfestigkeit** nach dem Absturz; Dauerlauf/Betrieb unter Last bleibt
`LOAD-001` und ist `PARTIAL`.

## 4e. Fehlerinjektion auf Prozessebene (TEST-003)

Zwei Ebenen, bewusst getrennt:

- `tests/integration/fault-injection.test.ts` (10 Tests) prüft die sechs Fehlerarten über den
  Injektions-Harness **im eigenen Prozess**: Prozessabbruch im Sandkasten, Worker-Verlust,
  Netzwerkverlust, doppelter Job, konkurrierende Schreibvorgänge, manipulierter Store.
- `tests/integration/fault-injection-processes.test.ts` (5 Tests) prüft die Fälle, die einen
  **zweiten, echten Betriebssystemprozess** brauchen — mit `tests/helpers/concurrent-writer.ts`
  (Kindprozess, `node --experimental-strip-types`):

| Fall | Nachweis |
|---|---|
| `SIGKILL` mitten im Schreibvorgang | Datensatz vollständig lesbar, Invariante (Zähler = Einträge) gilt, Store danach beschreibbar, keine tmp-Reste |
| Vier gleichzeitige Writer-Prozesse (4 × 60 Aktualisierungen) | **240/240** Einträge, eindeutig, Revision ≥ 240 — keine verlorene Aktualisierung |
| Gegenprobe mit unbedingtem Überschreiben | nachweislich weniger als 240 Einträge — ohne Nebenläufigkeitskontrolle geht der Test also nicht „zufällig“ durch |
| Worker-Verlust | Lease läuft ab, Job geht zurück in die Queue, zweiter Worker führt ihn aus (Versuch zählt als 2), kein Fehleintrag in der Reliability-Ablage |
| Netzwerkverlust nach erreichbarem Ziel | über den echten Pfad `dispatchTask` → `runOnce` → Broker: Lauf `FAILED`, Job nicht stillschweigend fertig, Evidenz digest-gebunden und mit der Ursache im Inhalt |

Die Nebenläufigkeitskontrolle im Store (Revision im Envelope, Prüfung **und** `rename` in einer
exklusiven Sperre, `StoreConflictError` mit `expected`/`actual`, begrenzte Wiederholungen) ist die
Voraussetzung für Zeile 2; `scripts/sabotage.mjs` entfernt sie in zwei Proben und verlangt, dass
genau diese Tests rot werden.

## 4f. Sabotageproben (TEST-004)

`node scripts/sabotage.mjs [--check] [--probe=ID] [--verbose]` · Katalog: `docs/acceptance/sabotage-probes.json`

Eine Suite, die nie rot wird, beweist nichts. Der Prüfer schwächt eine tragende Regel im Quelltext
**absichtlich** ab, führt die zuständigen Suiten aus und verlangt, dass sie **fehlschlagen**:

| Probe | Abgeschwächte Regel | Zuständige Suiten |
|---|---|---|
| `ALLOWLIST_FAIL_CLOSED` | Egress-`ALLOWLIST` wird nicht mehr verweigert | `route-guards`, `fault-injection` |
| `AUDIT_CHAIN_ALWAYS_VALID` | Audit-Kette gilt immer als gültig | `audit-retention` |
| `TOKEN_REPLAY_ALLOWED` | Replay wird auf **beiden** Ebenen erlaubt (Vorprüfung + Verbrauch) | `token-replay` |
| `APPROVAL_ALWAYS_GRANTED` | Freigabe gilt ohne Entscheidung als erteilt | `promotion-gates`, `deployment` |
| `KILL_SWITCH_IGNORED` | Kill-Switch-Wächter antwortet immer „nicht gesperrt“ | `gate-bypass`, `promotion-gates` |
| `ENROLLMENT_ACCEPTS_ANY_SECRET` | Geräte-Enrollment akzeptiert jedes Geheimnis | `device-enrollment` |
| `REGISTRY_DIGEST_NOT_CHECKED` | Store-Digest wird nicht mehr geprüft | `persistence`, `fault-injection` |
| `DEPLOYMENT_STAGING_GATE_OPEN` | Stufenpflicht des Staging-Gates entfällt | `promotion-gates` |
| `STORE_REVISION_UNCHECKED` | Revisionsprüfung des Stores entfällt (letzter Schreiber gewinnt) | `fault-injection-processes`, `persistence` |
| `STORE_WRITE_LOCK_OFF` | Schreibsperre entfällt: Prüfen und `rename` laufen auseinander | `fault-injection-processes`, `load-broker` |
| `LEASE_EXPIRY_OFF` | Lease-Ablauf liefert 0 — verwaiste Jobs bleiben `RUNNING` | `fault-injection-processes`, `worker-recovery` |
| `BROKER_TOKEN_VALIDATION_SKIPPED` | Broker prüft die Token-Validierung nicht mehr | `broker-scope`, `creator-flow`, `token-replay` |
| `BROKER_AGENT_BINDING_SKIPPED` | Agenten-/Task-Bindung im Broker entfällt | `load-broker`, `execution-evidence` |
| `BROKER_SHELL_GUARD_SKIPPED` | Shell-Interpreter werden nicht mehr verweigert | `argv-policy` |
| `BROKER_RISK_SCOPE_SKIPPED` | Risk-Umfang wird auf **beiden** Prüfebenen nicht mehr geprüft | `broker-scope`, `authority` |
| `EVIDENCE_DIGEST_ALWAYS_OK` | Evidenzprüfung meldet immer „unversehrt“ | `execution-evidence` |
| `CAPABILITY_SELF_GRANT_SKIPPED` | Selbstvergabe wird nicht mehr als solche verweigert | `authority`, `creator-flow` |
| `CAPABILITY_WILDCARD_SKIPPED` | Wildcard-Capability wird nicht mehr verweigert | `authority` |
| `CAUSAL_CHAIN_UNKNOWN_REFERENCE_IGNORED` | Erfundene Kausalverweise bleiben unentdeckt | `event-audit-linkage` |
| `RATE_LIMIT_NOT_ENFORCED` | Die Grenze lässt über dem Budget durch | `ops-enforcement` |
| `SHUTDOWN_DRAIN_IGNORED` | Drainage wird ignoriert (neue Arbeit während des Herunterfahrens) | `ops-enforcement` |
| `SESSION_SECRET_REQUIRED_IN_PRODUCTION` | Produktionspflicht für das Sitzungsgeheimnis entfällt | `ops-enforcement`, `ops-hardening` |
| `SHUTDOWN_SIGNAL_NOT_HANDLED` | SIGTERM-Handler entfernt (harter Abbruch statt Drain) | `graceful-shutdown` |
| `RATE_LIMIT_IDENTITY_NOT_SESSION_SCOPED` | Sitzungsgebundene Grenze fällt still auf den User-Agent zurück | `ops-hardening` |
| `AUTH_RATE_LIMIT_DENY_NOT_AUDITED` | Begrenzter Anmeldeversuch wird nicht mehr auditiert | `ops-enforcement` |

Ergebnis: **25/25 Proben erkannt**. Regeln des Prüfers:

- **Grundprobe zuerst:** Alle Suiten der ausgewählten Proben laufen vor der ersten Mutation einmal
  ohne Änderung. Wären sie schon vorher rot, würde jede Sabotage als „erkannt“ gelten — die Erkennung
  wäre wertlos. Die Grundprobe ist deshalb Pflicht (abschaltbar nur über `SABOTAGE_SKIP_BASELINE=1`).
- Eine Probe muss die **wirksame** Schutzwirkung entfernen. Liegt eine Regel auf zwei redundanten Ebenen,
  entfernt die Probe beide (`edits` im Katalog) — sonst beweist sie nichts.
- Ein Anker, der nicht genau einmal vorkommt, ist `INVALID` (Exit 2). Eine Probe, die nichts mutiert,
  wäre wertlos.
- Jede Datei wird vor der Mutation gehasht, nach dem Lauf byteweise wiederhergestellt und erneut
  gehasht; bleibt eine Abweichung, endet der Lauf mit Exit 2. Bei `SIGINT`/`SIGTERM` läuft dieselbe
  Wiederherstellung.
- Ausgabe-Exit-Codes: `0` = alle Proben erkannt, `1` = mindestens eine Probe **nicht** erkannt,
  `2` = Lauf ungültig (ungültiger Anker, Abbruch, zurückgebliebene Änderung).

## 5. CI-Abbildung

`.github/workflows/ci.yml` führt die Suiten in getrennten Jobs aus (Lint/Typecheck, Unit + Integration +
Regression + UI, **Sabotageproben**, Security + E2E, Produktionsbuild **inklusive Fehlerinjektion am
laufenden Dienst**, Verification Gate) und blockiert die Promotion, wenn eine Stufe fehlschlägt.
Die beiden Nachweisprüfer sind **Pflichtstufen**, keine Beiwerke: `SABOTAGE` läuft `--check` (Anker) und
den vollen Sabotagelauf; der Build-Job führt nach `npm run build` den SIGKILL-Prüfer mit einem Zyklus aus.
Beide laden ihren Bericht als Artefakt hoch (auch bei Fehlschlag) — ein nicht erkannter Angriff oder
eine nicht überlebte Störung lässt die Pipeline rot werden. Der Job **Verification Gate** führt den Abnahmeprüfer
`node scripts/acceptance.mjs` aus: er prüft maschinell, dass jede `PASS`-Anforderung in
`docs/acceptance/requirements.json` Implementierung, Test und Nachweis besitzt und dass alle 18
Stufen der Zielkette abgedeckt sind. Eine Statushebung ohne Nachweis ist damit nicht möglich.
Details: `docs/CI_CD.md`, `docs/ABNAHMEPLAN.md`.

## 6. Bekannte Lücken (nicht als bestanden gewertet)

- Keine Browser-/UI-E2E-Tests: das Control Center wird nicht in einem echten Browser geprüft (in dieser
  Umgebung steht keiner zur Verfügung). Ersatzweise prüfen `tests/ui/*` die Komponente unter jsdom
  (einmal gegen eine nachgebildete API, einmal gegen die **echten** Routen-Handler) und
  `scripts/audit-ui.mjs` die Auslieferung, den Quellvertrag und den Datenvertrag jedes Abschnitts über
  echtes HTTP; die Authentifizierungsgrenze ist über `tests/security/api-gate.test.ts` und einen
  Live-Lauf gegen den Produktionsserver belegt. Visuelle Darstellung (Layout, Farben) bleibt
  `NOT_VERIFIED`.
- Aktionsspezifische `guardRequest`-Prüfungen sind für die Kern- und Schreibpfade verdrahtet
  (Mission/Objective/Task, Sandbox-Lebenszyklus, Runs, Runtime, Governance, Provider, Provenance/Knowledge);
  für noch nicht verdrahtete Routen bleibt die Middleware die fail-closed-Grenze, ohne Aktionsprüfung.
- OCI-Runtime, Provider-Fabric-Persistenz und Geräte-/Computer-Use-Integration sind implementiert, aber
  `UNVERIFIED` bzw. `PARTIAL`.
- Die Kernel-Isolation ist **kein** Container: kein OCI-Image, kein `runc` und kein eigener Kernel.
  Sie ist als Stufe `NAMESPACES` ausgewiesen, nicht als `CONTAINER`; die Testsuite prüft die
  Garantien, die tatsächlich gelten. Ressourcenlimits: CPU-Zeit und Dateigröße sind kernel-seitig
  erzwungen (`RLIMIT_CPU`/`RLIMIT_FSIZE`, getestet), Speicher und Prozesse nur mit delegiertem
  cgroup-v2-Unterbaum (`BOB_CGROUP_DIR`); ohne ihn meldet der Bericht `UNAVAILABLE` und die Tests
  überspringen diesen Nachweis mit Grund.
- Last-/Soak-Nachweis: `scripts/soak.mjs` misst einen **begrenzten** Lauf (120 autorisierte
  Ausführungen je Lauf) mit Latenz-Perzentilen, Durchsatz und Zustand danach; die Zahlen stehen in
  `docs/OPERATIONS.md` §5a. Es gibt **keine** SLO-Zusage, keine Lastkurve und keinen Dauerlauf.
- `tests/integration/ns-isolation.test.ts` baut den Rootfs real (126 MB) und benötigt eine Umgebung,
  die unprivilegierte User-Namespaces erlaubt. Ist das nicht der Fall — GitHub-Runner beschränken
  unprivilegierte User-Namespaces per AppArmor —, meldet die Suite die Isolationsnachweise als
  `skipped` (mit dem gemessenen Grund auf der Konsole und ohne den Rootfs zu bauen); die zwei
  umgebungsunabhängigen Tests laufen weiter: „erkennt die Umgebung, wenn Kernel-Isolation nicht
  möglich ist" (Bericht darf keine Garantien behaupten) und „führt bei erzwungener Isolation nichts
  unisoliert aus (fail closed)". Der Skip-Pfad ist verifiziert: mit
  `BOB_NS_PROBE_FORCE_UNAVAILABLE=1` meldet der Lauf **2 bestanden, 6 übersprungen**.

## 7. Gefundene und behobene Fehler (Runde „GUI und Verträge“, 2026-09-25)

Jeder Fehler wurde nach `REPRODUCE → TRIAGE → ROOT CAUSE → FIX → REGRESSIONSTEST → VERIFY`
behandelt; kein Test wurde abgeschwächt.

| # | Fehler (Symptom) | Ursache | Fix / Regressionstest |
|---|---|---|---|
| 25 | Nach dem Bau des Rootfs meldete `GET /api/runtime` weiterhin `FILESYSTEM_ONLY`, jede Ausführung 409 — erst ein Neustart half | `isolationReport()` gab einen zwischengespeicherten Bericht zurück, ohne die Voraussetzungen erneut zu bewerten | Cache nur bei erfüllten Voraussetzungen wiederverwenden; `tests/regression/ns-report-cache.test.ts` (4 Tests); live nachgewiesen: Rootfs nach Serverstart gebaut → Status wechselt ohne Neustart auf `NAMESPACES` mit 14 Garantien |
| 26 | Capability-Token **ohne** `expiresAt` wurde ausgestellt und lief nie ab (fail open) | `new Date(undefined) <= new Date()` ist `false`; auch die Prüfung verglich mit `NaN` | Ablauf ist Pflicht (400 `TOKEN_EXPIRY_REQUIRED`), Prüfung wertet unbrauchbare Daten als abgelaufen; Aufruferfehler → 400, Policy-Verweigerung → 403; `tests/security/authority.test.ts` (+2) |
| 27 | `secretHash` jedes Capability-Tokens ging an den Browser (`GET /api/capabilities`, `GET /api/authority`) | Leseantworten gaben die internen Tokendatensätze unverändert aus | `capabilityTokenViews()` liefert Token ohne Hash; `tests/security/token-read-projection.test.ts` (4 Tests); `scripts/audit-ui.mjs` prüft Geheimnisfelder in jeder Antwort |
| 28 | Ein Computer konnte **ohne** `computer.authorized`-Nachweis autorisiert in die Flotte kommen | `registerComputer` übernahm `authorized: true` aus dem Aufruf | Registrierung erzwingt `authorized: false`; Autorisierung ausschließlich über den expliziten Creator-Akt; `tests/integration/computer-use.test.ts` (+1) |
| 29 | `authorizeComputer` prüfte den Actor nicht (Autorisierung mit beliebigem Actor im Nachweis) | Domänenfunktion ohne Actor-Prüfung — anders als `authorizeDevice` | Creator-Pflicht in der Domäne; im selben Testfall geprüft |
| 30 | Runtimes-Tabelle zeigte vier Spalten, die es im Datenmodell nicht gibt (`language`, `mode`, `status`, `notes`) → dauerhaft „—“ | Oberfläche und `RuntimeDefinition` waren auseinandergelaufen | Spalten an den echten Vertrag (`kind`, `platforms`, `architectures`, `sandboxSupport`, `networkDefault`); `tests/regression/ui-contract.test.ts` prüft jede Spalte gegen `lib/`/`app/` |
| 31 | Im Secrets-Abschnitt stand literales `**nicht lesbar**` auf dem Bildschirm | Markdown-Syntax im JSX-Text (HTML war die Absicht) | `**…**` und Backticks durch `<strong>`/`<code>` ersetzt; `audit-ui.mjs` und `ui-contract.test.ts` prüfen auf literales Markdown |
| 32 | `verify-live.sh` schlug auf jeder Instanz fehl, auf der zuvor ein Computer autorisiert worden war („Kein Computer vorautorisiert") | Prüfung verlangte jungfräulichen Zustand statt Discovery ≠ Autorisierung zu testen | Zustandsunabhängige Prüfung: frisch entdecken → unautorisiert → Belegung verweigert; zweimal auf derselben Instanz **169/0** |
| 33 | Drei Prüfungen in `audit-actions.mjs` verwendeten ein veraltetes Token-Schema (`ttlMs`/`maxRisk`) | Skript war älter als der Vertrag — und der Vertrag akzeptierte die falschen Felder stillschweigend (siehe 26) | Sonden an `expiresAt`/`risk` angepasst, Negativfall ergänzt (ohne Ablauf → 400); `440/0`, zweimal wiederholt |
| 34 | `POST /api/simulation {action:"kinds"}` antwortete mit **stillem Erfolg**, obwohl die Aktion entfernt worden war | Zweig blieb nach dem Umbau auf den Renderer stehen | Zweig entfernt; `audit-api.sh` prüft unknown actions generisch, `audit-actions.mjs` fragt `render` mit unbekannter Art ab (400) |
| 35 | Visualisierung für ein **unbekanntes Szenario** lieferte einen Serverfehler statt einer klaren Verweigerung | Fehlerabbildung unterschied „nicht gefunden" nicht von Eingabefehlern | `/not found/i` → 404, sonst 400; in `audit-actions.mjs` und `audit-api.sh` als Negativfall verankert |
| 36 | Verweigerte Geräte-Registrierung endete in **500** statt 403/400, sobald die gemeldete Kennung unbrauchbar war | Die Verweigerung wurde protokolliert und die ungeprüfte Fremdkennung verletzte die Provenienzregeln (≤160 Zeichen, kein `:`) — die Protokollierung zerstörte damit die Verweigerung selbst | Kennungen eng validiert (`^[A-Za-z0-9._-]{3,64}$`), Protokollierung fehlertolerant und gekürzt; `recordEnrollmentDenial` schreibt Audit + Ereignis ohne Geheimnis; `tests/security/device-enrollment.test.ts` prüft unzulässige/überlange Kennungen |
| 37 | Der UI-Test gegen die **echten** Routen meldete im Metriken-Abschnitt „nicht verfügbar" | Der Prüfaufbau kannte die neue Alarmroute nicht (fehlender Eintrag in der Routentabelle) | `/api/alerts` im Routenaufbau registriert; der Test fordert dort jetzt „Prüfung BESTANDEN" und im Abschnitt Betrieb/Persistenz die Backup-Automation — die Prüfung wurde **verschärft**, nicht abgeschwächt |

## 8. Gefundene und behobene Fehler (Runde „Fehlerinjektion und Sabotage“, 2026-09-25)

| # | Befund | Ursache | Fix / Regressionstest |
|---|---|---|---|
| 38 | Der Sabotagelauf meldete zunächst **8 von 8** Proben als „nicht erkannt“, obwohl ein Test tatsächlich rot war | Der Prüfer wertete die vitest-Zusammenfassung mit einem Muster aus, das an den ANSI-Farbcodes zerbrach (`Tests \x1b[22m \x1b[1m\x1b[31m1 failed`) | Farbcodes vor der Auswertung entfernen, `Failed Tests N` als zweites Muster, Infrastrukturabbruch (kein auswertbarer Lauf) → Exit 2 statt „nicht erkannt“ |
| 39 | Eine Probe mit **zwei** Änderungen in derselben Datei hinterließ die Datei einmal mutiert (nur der Selbstschutz am Laufende stellte sie wieder her) | Die Sicherung wurde je Änderung genommen, die zweite Sicherung überschrieb das Original mit dem bereits mutierten Inhalt | Sicherung einmal **vor** der ersten Änderung je Datei; der zurückgebliebene Rest wird namentlich gemeldet und erzwingt Exit 2; `tests/unit/sabotage-plan.test.ts` |
| 40 | `TOKEN_REPLAY_ALLOWED` und `KILL_SWITCH_IGNORED` wurden als „nicht erkannt“ gemeldet | Die Proben entfernten nur **eine von zwei** redundanten Schutzebenen (Gate *und* Verbrauch; SYSTEM-Kurzweg *und* gezielte Sperre) — die Plattform verweigerte weiterhin korrekt | Katalog kann mehrere Änderungen je Probe ausdrücken (`edits`); Replay wird auf beiden Ebenen, der Kill-Switch an seinem ganzen Wächter entfernt |
| 41 | Zwei tragende Zusicherungen waren **unbewiesen**: „Produktion ohne erteilte Freigabe“ und „Staging nur aus promovierter Stufe“ ließen sich abschwächen, ohne dass eine Suite rot wurde | Es gab keine Tests, die den **benannten Grund** prüften (nur „irgendein Fehler“ bzw. gar keine Prüfung) | Neue Suite `tests/security/promotion-gates.test.ts` (11 Tests) prüft jeden Verweigerungsgrund namentlich; erneut sabotiert → erkannt. Die Prüfung wurde **verschärft**, kein Test abgeschwächt |
| 42 | `rejects.toThrow()` ohne Begründung verschleierte in `sandbox-runtime` die Regel „ALLOWLIST ist fail closed“ | Der Test akzeptierte jeden Fehler, auch einen späteren aus anderem Grund | Das Gate wird jetzt über die Injektionsprobe (`fault-injection`) und die Kette selbst nachgewiesen; die Probe `ALLOWLIST_FAIL_CLOSED` ist erkannt (1 Testfehler) |

## 8a. Gefundene und behobene Fehler (Runde „Wiederherstellung nach Sandbox-Reset und Betriebsgrenzen“, 2026-09-26)

| # | Befund | Ursache | Fix / Regressionstest |
|---|---|---|---|
| 43 | Der Produktionsserver startete nicht: `ERR_MODULE_NOT_FOUND: ./lib/shutdown.js` | `server.mjs` importierte eine TypeScript-Datei; in Produktion bündelt Next die Datei nicht, ausgeliefert wird nur `.next` | `server.mjs` verwendet ausschließlich node-auflösbare Importe; das Drainage-Signal erreicht die Routen über `process.env.BOB_SHUTTING_DOWN` (Env-Kanal statt Modulzustand über Modulgrenzen). Kein Modulzustand über Prozessgrenzen hinweg. Test: `tests/integration/graceful-shutdown.test.ts` (startet den echten Server, `SIGTERM` → Exit 0) |
| 44 | Drei Dateien (`server.mjs`, `lib/shutdown.ts`, `lib/api/rate-limit.ts`) enthielten **literale** `\n`-Escape-Folgen mitten im Code | Dateien wurden mit doppelt escapten Zeilenumbrüchen geschrieben; `tsc`/`node --check` scheiterten mit TS1127 bzw. Syntaxfehler | Ersetzt durch echte Zeilenumbrüche; `tsc --noEmit`, `eslint`, Gesamtlauf und der Serverstart sind die Wächter. Lehre: solche Dateien nicht per Augenschein beurteilen, sondern `tsc`/`node --check` laufen lassen |
| 45 | Die Betriebsgrenze erkannte das Sitzungscookie nur als **erstes** Cookie | Das Muster der Cookie-Suche enthielt einen literalen Doppel-Backslash (`\\s` statt `\s`); stand ein anderes Cookie davor, fiel die Identität still auf den User-Agent-Hash zurück — alle Sitzungen desselben Browsers teilten ein Budget (fremde Clients konnten es aufbrauchen, falsche 429) | Muster korrigiert; zwei Regressionstests in `tests/unit/ops-hardening.test.ts` (Cookie hinter weiteren Cookies, getrennte Budgets zweier Sitzungen mit gleichem User-Agent). Sabotageprobe `RATE_LIMIT_IDENTITY_NOT_SESSION_SCOPED` (erkannt, 2 Testfehler) |
| 46 | Ein begrenzter Anmeldeversuch wurde **nicht** auditiert | Nur die API-Grenze schrieb ein `DENY`, der Anmeldeendpunkt wies stumm ab (Credential Stuffing ohne Spur) | `recordAudit({actor:"ANONYMOUS", action:"rate-limit", decision:"DENY"})` mit `bucket:"auth"`, `retryAfterSeconds` und **gehashter** Kennung (`rateLimitIdentityDigest`). Regressionstest in `tests/security/ops-enforcement.test.ts`, Sabotageprobe `AUTH_RATE_LIMIT_DENY_NOT_AUDITED` (erkannt) |
| 47 | Ein nicht lesbarer Store wurde als **„store file is not valid JSON“** gemeldet | Lese- und Parsefehler liefen durch denselben `catch`; ein Rechte-/Ownership-Problem (Store-Dateien gehörten nach einem Serverstart als `root` dem Benutzer `root`) sah wie Datenverlust aus | Lese- und Parsefehler getrennt: `store file is not readable (EISDIR\|EACCES…)`, `ENOENT` gilt als „noch nicht angelegt“, beides fail closed. Zwei Regressionstests in `tests/unit/persistence.test.ts` |
| 48 | Ein Regressionstest für die Audit-Spur war zunächst falsch (und wäre dauerhaft rot geblieben) | `auditSnapshot(limit)` liefert die **jüngsten** Einträge, **neueste zuerst**, und begrenzt; „neue Einträge seit vorher“ lässt sich damit nicht über die Länge, sondern nur über die Sequenz bestimmen | Test vergleicht die höchste Sequenz vor dem Aufruf mit den neuen Datensätzen. Lehre: `auditSnapshot` ist ein Fenster, kein vollständiger Bestand |
| 49 | Ein `Map`-Callback übergab den Index als zweiten Parameter (`expectedEffects.map(requireText)`) | Typfehler, der erst nach Ergänzung der React-Typen sichtbar wurde | Expliziter Callback mit eigener Fehlermeldung je Feld (`expectedEffects[i]`) |

Ergebnis der Runde: **63 Testdateien / 422 Tests grün**, `tsc --noEmit` fehlerfrei, `eslint .` 0 Fehler,
`npm run build` erfolgreich, **25/25 Sabotageproben erkannt**, alle Live-Suiten 0 Fehler
(`verify-live.sh` 174/0, `audit-actions.mjs` 525/0, `audit-api.sh` 248/0, `audit-ui.mjs` 92/0,
`acceptance.mjs --live` 84/0, `verify-rate-limit.sh` 6/0).
