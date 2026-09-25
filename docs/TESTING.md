# Teststrategie und Testnachweis

**Stand:** 2026-09-25
**Testrunner:** Vitest 3 (`vitest.config.ts`, Node ≥ 22)
**Letzter verifizierter Lauf:** `npx vitest run` → **32 Dateien, 178 Tests, alle grün**; `npx tsc --noEmit` fehlerfrei; `npx eslint .` 0 Fehler / 10 Warnungen; `npm run build` erfolgreich. Zusätzlich live gegen den Produktionsserver geprüft (`BOB_NS_ISOLATION=on` mit gebautem Rootfs): `scripts/verify-live.sh` → **149 Prüfungen, 0 Fehler** bei Erstinitialisierung (**147**, wenn die Instanz bereits initialisiert war – der Bootstrap-Zweig enthält zwei Prüfungen mehr). Mit verpflichtendem zweitem Faktor (TOTP) sind es **155 / 153**; siehe §4a. Negativnachweis derselben Instanz ohne Rootfs: Isolation wird als `FILESYSTEM_ONLY` ausgewiesen und **jede** Ausführung mit 409 verweigert (`kernel isolation is enforced … but unavailable`); das Skript meldet dann erwartungsgemäß 125 PASS / 22 FAIL, weil alle ausführungsabhängigen Schritte bewusst scheitern.

## 1. Suiten und Abdeckung

| Suite | Dateien | Tests | Inhalt |
|---|---|---|---|
| `tests/unit` | 7 | 51 |    Persistenz-Envelope (Digest, Manipulationserkennung, Versionsprüfung, Registry), Control Plane (Mission/Objective/Task, Risiko-/Approval-Regeln, Persistenz), Agent Fabric (11 Rollen, Autonomie-Grenzen, Heartbeat, persistente Handoffs), **Recovery-Tier-Klassifikation** (Stufen 1–5 mit Begründung und Creator-Freigabepflicht), **Store-Migration** (v1 → v2, Sicherungskopie, Journal, fehlende Kette/neuere Datei → fail closed, migrierende Backup-Wiederherstellung, Schutz und Reparatur inhaltsloser Envelopes), **Persistenz von Betriebszustand** (Pipelines, Skills, Werkstatt, Handoffs über Neuladen der Laufzeit), **Audit-Aufbewahrung** (append-only ohne Kürzung, Kürzung nur mit Checkpoint, Rekonstruktion des Kopfes bei Altbeständen, Datei- **und** Ketten-Manipulation erkannt) |
| `tests/security` | 12 | 69 | Authority-Invarianten (Selbstvergabe, Wildcards, TTL, Risk-Eskalation, Audit-DENY), **Wiederholungssperre für Capability-Token** (zweiter Lauf verweigert, Evidenz + Audit, freigegebene Anzahl Verwendungen, parallele Läufe mit genau einer Freigabe, Vorprüfung ≠ Verbrauch), API-Guard (428/401/403, CSRF-Origin, Session, Legacy-Token fail-closed), argv-Policy (Broker-DENY + Runtime-Defense-in-Depth), API-Gate (Bootstrap, Session, CSRF, Renew/Logout, keine Agent-/Legacy-Token an der Grenze), Creator-Login (Secret-Datei 0600, Konstantzeit, Audit, Sperre), **TOTP als zweiter Faktor** (Fenster ±1, Replay-Schutz, Pflicht bei gesetztem Secret, Replay/Sperre), **Creator Inbox** (Anlegen, Beantworten nur durch Creator, doppelte Beantwortung abgelehnt, unbekannte Aktion 400, Sessionpflicht), Routen-Guards (Provenance/Knowledge/Runs: 428 vor Bootstrap, 401 ohne Authentifizierung, `CREATOR_ONLY` für Agenten-Schreibzugriff, `CAPABILITY_DENIED` ohne `run:manage`, CSRF-Origin, Audit-Integrität), **Direkter Routenaufruf ohne Gate** (428 vor Bootstrap, 401 `UNAUTHENTICATED` nach Bootstrap statt 500/503, 200 mit Session, kein Agenten-/Legacy-Token) |
| `tests/integration` | 8 | 43 | Sandbox-Fabric mit `REAL_LOCAL` (Bindung, Prozessausführung, Snapshot + Digest, Verifikation, ALLOWLIST fail-closed), Provider-Fabric (Approval-Pflicht, Bindungen, Health, Datenvertrag), App-Module (Fabric-gebundene Sandboxes, Lifecycle), Computer Use (Registrieren ≠ Autorisieren, Allocation nur mit Freigabe), **Ausführungs-Evidenz** (Digest über stdout/Exit-Code, Provenance-Knoten, Persistenz, Kürzung, Manipulationserkennung, **Verweigerungs-Evidenz**: blockierte Autorisierung wird digest-gebunden und ohne Klartext-Argumente festgehalten), **Nebenläufigkeit** (12 parallele autorisierte Ausführungen, 6 verweigerte Fremdbindungen), Backup mit Digest-Prüfung (manipuliertes Backup → 409) und Betriebsmetriken (Prometheus-Text, nur Zahlen, keine Geheimnisse) , **Kernel-Isolation** (`tests/integration/ns-isolation.test.ts`, 7 Tests: Prozess-Probe mit Capabilities/`NoNewPrivs`/`EROFS`, Netzwerk-Namespace, argv-Canary, Prozessgruppen-Timeout, verschwundener Rootfs, fail closed) |
| `tests/regression` | 1 | 5 | Regression Engine: argv-Policy, Registrierung, PASS/FAIL, Suite fail-closed bei Fehlschlag, Persistenz |
| `tests/ui` | 2 | 6 | Control-Center-Oberfläche unter jsdom: **vollständige Navigationsliste (38 Abschnitte)** vorhanden, echte Serverdaten werden als Zeilen gerendert (kein Platzhalter „READY“), fehlende Daten werden ausdrücklich als „nicht verfügbar“ gemeldet, ohne Session erscheint die Anmeldemaske und keine Rohdaten; zweite Datei ruft die **echten Routen-Handler** auf (35 Routen) und prüft, dass gerenderte Datensätze tatsächlich aus der API stammen |
| `tests/e2e` | 2 | 4 | Kette Creator → Aufgabe → Autorisierung → Sandbox → Ausführung → Evidence → Knowledge sowie Fehlerkette DETECTED → DIAGNOSING → EXPERIMENTING → ROOT_CAUSE_FOUND → FIXING → VERIFYING → LEARNED → REGRESSION_LOCKED |

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
letzten Laufs (2026-09-25, Storage `/tmp/bob-live16`, frisch initialisiert): **149 PASS / 0 FAIL**
(147 PASS / 0 FAIL auf bereits initialisierter Instanz), jeweils mit aktiver Kernel-Isolation.

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
| 7. Governance | Kill-Switch-Liste, Lockdown blockiert Ausführung (409 am Gate), Freigabe hebt Block auf, Privacy default `DENY`, Provider nur entdeckt + Verbindung verlangt Approval, Gerät nicht implizit autorisiert, **11 Agentenrollen ohne Selbstvergabe/Produktionszugriff**, **kein Computer vorautorisiert** | PASS |
| 8. Betrieb | Restore aus Snapshot, Pause, Destroy, Persistenzbericht ohne Integritätsfehler, Readiness, unbekannter Provider 400 | PASS |
| 9. Betrieb/Backup | Audit-Verifikation per POST, Backup mit Digest-Prüfung, Persistenzbericht mit verifizierten Backups, Prometheus-Metriken (Store-Integrität, Audit-Kette, 11 Agenten), Metriken ohne Session 401 | PASS |

Struktureller Vertrag: `tests/security/api-route-contract.test.ts` prüft, dass **jede** Route außer
`/api/auth` eine konkrete Aktion prüft, keine leere Aktionsbezeichnung nutzt und keine Route
`publicAction` setzt. Eine neue Route ohne Prüfung lässt den Test fehlschlagen.

## 5. CI-Abbildung

`.github/workflows/ci.yml` führt die Suiten in getrennten Jobs aus (Lint/Typecheck, Unit + Integration +
Regression, Security + E2E, Produktionsbuild) und blockiert die Promotion, wenn eine Stufe fehlschlägt.
Details: `docs/CI_CD.md`.

## 6. Bekannte Lücken (nicht als bestanden gewertet)

- Keine Browser-/UI-E2E-Tests: das Control Center wird nicht automatisiert im Browser geprüft; die
  Authentifizierungsgrenze ist über `tests/security/api-gate.test.ts` und einen Live-Lauf gegen den
  Produktionsserver belegt.
- Aktionsspezifische `guardRequest`-Prüfungen sind für die Kern- und Schreibpfade verdrahtet
  (Mission/Objective/Task, Sandbox-Lebenszyklus, Runs, Runtime, Governance, Provider, Provenance/Knowledge);
  für noch nicht verdrahtete Routen bleibt die Middleware die fail-closed-Grenze, ohne Aktionsprüfung.
- OCI-Runtime, Provider-Fabric-Persistenz und Geräte-/Computer-Use-Integration sind implementiert, aber
  `UNVERIFIED` bzw. `PARTIAL`.
- Die Kernel-Isolation ist **kein** Container: kein OCI-Image, kein `runc`, keine cgroup-Quotas
  (Ressourcenlimits bleiben zeitbasiert) und kein eigener Kernel. Sie ist als Stufe `NAMESPACES`
  ausgewiesen, nicht als `CONTAINER`; die Testsuite prüft die Garantien, die tatsächlich gelten.
- `tests/integration/ns-isolation.test.ts` baut den Rootfs real (126 MB) und benötigt eine Umgebung,
  die unprivilegierte User-Namespaces erlaubt; ist das nicht der Fall, wird die Suite mit Begründung
  übersprungen statt als „grün" gezählt.
