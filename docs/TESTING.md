# Teststrategie und Testnachweis

**Stand:** 2026-09-25
**Testrunner:** Vitest 3 (`vitest.config.ts`, Node ≥ 22)
**Letzter verifizierter Lauf:** `npx vitest run` → **14 Dateien, 75 Tests, alle grün**; `npx tsc --noEmit` fehlerfrei; `npx eslint .` 0 Fehler / 8 Warnungen; `npm run build` erfolgreich. Zusätzlich live gegen den Produktionsserver geprüft (428 ohne Session, 201 Bootstrap, 200 mit Session, 403 bei Cross-Origin).

## 1. Suiten und Abdeckung

| Suite | Dateien | Tests | Inhalt |
|---|---|---|---|
| `tests/unit` | 2 | 10 | Persistenz-Envelope (Digest, Manipulationserkennung, Versionsprüfung, Registry), Control Plane (Mission/Objective/Task, Risiko-/Approval-Regeln, Persistenz) |
| `tests/security` | 6 | 36 | Authority-Invarianten (Selbstvergabe, Wildcards, TTL, Risk-Eskalation, Audit-DENY), API-Guard (428/401/403, CSRF-Origin, Session, Legacy-Token fail-closed), argv-Policy (Broker-DENY + Runtime-Defense-in-Depth), API-Gate (Bootstrap, Session, CSRF, Renew/Logout, keine Agent-/Legacy-Token an der Grenze), Creator-Login (Secret-Datei 0600, Konstantzeit, Audit, Sperre) |
| `tests/integration` | 3 | 20 | Sandbox-Fabric mit `REAL_LOCAL` (Bindung, Prozessausführung, Snapshot + Digest, Verifikation, ALLOWLIST fail-closed), Provider-Fabric (Approval-Pflicht, Bindungen, Health, Datenvertrag), App-Module (Fabric-gebundene Sandboxes, Lifecycle) |
| `tests/regression` | 1 | 5 | Regression Engine: argv-Policy, Registrierung, PASS/FAIL, Suite fail-closed bei Fehlschlag, Persistenz |
| `tests/e2e` | 2 | 4 | Kette Creator → Aufgabe → Autorisierung → Sandbox → Ausführung → Evidence → Knowledge sowie Fehlerkette DETECTED → DIAGNOSING → EXPERIMENTING → ROOT_CAUSE_FOUND → FIXING → VERIFIED → LEARNED → REGRESSION_LOCKED |

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

## 5. CI-Abbildung

`.github/workflows/ci.yml` führt die Suiten in getrennten Jobs aus (Lint/Typecheck, Unit + Integration +
Regression, Security + E2E, Produktionsbuild) und blockiert die Promotion, wenn eine Stufe fehlschlägt.
Details: `docs/CI_CD.md`.

## 6. Bekannte Lücken (nicht als bestanden gewertet)

- Keine Browser-/UI-E2E-Tests: das Control Center wird nicht automatisiert im Browser geprüft; die
  Authentifizierungsgrenze ist über `tests/security/api-gate.test.ts` und einen Live-Lauf gegen den
  Produktionsserver belegt.
- Aktionsspezifische `guardRequest`-Prüfungen pro Route (Risiko, Creator-Pflicht, Task-/Sandbox-Bindung) sind
  noch nicht überall verdrahtet; die Middleware deckt die Authentifizierungsgrenze ab.
- OCI-Runtime, Provider-Fabric-Persistenz und Geräte-/Computer-Use-Integration sind implementiert, aber
  `UNVERIFIED` bzw. `PARTIAL`.
