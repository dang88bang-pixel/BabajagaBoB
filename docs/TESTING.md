# Teststrategie und Testnachweis

**Stand:** 2026-09-25
**Testrunner:** Vitest 3 (`vitest.config.ts`, Node ≥ 22)
**Letzter verifizierter Lauf:** `npx vitest run` → **17 Dateien, 88 Tests, alle grün**; `npx tsc --noEmit` fehlerfrei; `npx eslint .` 0 Fehler / 8 Warnungen; `npm run build` erfolgreich. Zusätzlich live gegen den Produktionsserver geprüft: `scripts/verify-live.sh` → **89 Prüfungen, 0 Fehler** (siehe §4a).

## 1. Suiten und Abdeckung

| Suite | Dateien | Tests | Inhalt |
|---|---|---|---|
| `tests/unit` | 3 | 14 | Persistenz-Envelope (Digest, Manipulationserkennung, Versionsprüfung, Registry), Control Plane (Mission/Objective/Task, Risiko-/Approval-Regeln, Persistenz), Agent Fabric (11 Rollen, Autonomie-Grenzen, Heartbeat, Handoffs) |
| `tests/security` | 7 | 42 | Authority-Invarianten (Selbstvergabe, Wildcards, TTL, Risk-Eskalation, Audit-DENY), API-Guard (428/401/403, CSRF-Origin, Session, Legacy-Token fail-closed), argv-Policy (Broker-DENY + Runtime-Defense-in-Depth), API-Gate (Bootstrap, Session, CSRF, Renew/Logout, keine Agent-/Legacy-Token an der Grenze), Creator-Login (Secret-Datei 0600, Konstantzeit, Audit, Sperre), Routen-Guards (Provenance/Knowledge/Runs: 428 vor Bootstrap, 401 ohne Authentifizierung, `CREATOR_ONLY` für Agenten-Schreibzugriff, `CAPABILITY_DENIED` ohne `run:manage`, CSRF-Origin, Audit-Integrität) |
| `tests/integration` | 4 | 23 | Sandbox-Fabric mit `REAL_LOCAL` (Bindung, Prozessausführung, Snapshot + Digest, Verifikation, ALLOWLIST fail-closed), Provider-Fabric (Approval-Pflicht, Bindungen, Health, Datenvertrag), App-Module (Fabric-gebundene Sandboxes, Lifecycle), Computer Use (Registrieren ≠ Autorisieren, Allocation nur mit Freigabe) |
| `tests/regression` | 1 | 5 | Regression Engine: argv-Policy, Registrierung, PASS/FAIL, Suite fail-closed bei Fehlschlag, Persistenz |
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
BOB_STORAGE_DIR=/tmp/bob-live BOB_BOOTSTRAP_SECRET=<einmal-secret> \
BOB_CREATOR_LOGIN_SECRET=<creator-secret> BOB_SANDBOX_RUNTIME=local \
  npx next start -H 0.0.0.0 -p 3000

BOB_STORAGE_DIR=/tmp/bob-live BOB_BOOTSTRAP_SECRET=<einmal-secret> \
BOB_CREATOR_LOGIN_SECRET=<creator-secret> BASE=http://localhost:3000 \
  bash scripts/verify-live.sh
```

Das Skript bricht nie ab, sondern zählt PASS/FAIL und gibt die echte Serverantwort aus. Ergebnis des
letzten Laufs (2026-09-25, Storage `/tmp/bob-live7`): **89 PASS / 0 FAIL**.

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
