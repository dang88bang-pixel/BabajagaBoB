# CI/CD und Promotion — Abschnitt 40/41

Implementierung: `.github/workflows/ci.yml`, `lib/cicd.ts`, `lib/promotion.ts`,
`lib/regression.ts`, `app/api/cicd/route.ts`, `app/api/promotion-gate/route.ts`.

## 1. Tatsächliche CI-Pipeline (GitHub Actions)

Jobs, die bei jedem Push auf den Feature-Branch laufen:

| Job | Schritte |
|---|---|
| `lint-and-typecheck` | `npm ci`, `npm run lint`, `npm run typecheck` |
| `unit-integration` | `npm ci`, `npm run test:unit`, `npm run test:integration`, `npm run test:regression`, `npm run test:ui` |
| `security` | `npm ci`, `npm run test:security`, `npm run test:e2e`, `npm audit --audit-level=high` |
| `build` | `npm ci`, `npm run build` |
| `verification-gate` | `node scripts/acceptance.mjs` (maschineller Abnahmeprüfer: Nachweisregel, §44-Bindung, 18 Kettenstufen) und Abschlussprüfung („Alle Verifikationsstufen bestanden. Promotion bleibt manuell und Creator-gebunden") |

`main` wird nie direkt geändert: Feature-Branch → Commit → CI → Pull Request → Review → Merge.

Der Prüfer im `verification-gate` liest `docs/acceptance/requirements.json` und schlägt fehl, sobald
eine Anforderung ohne Implementierung, Test oder Nachweis auf `PASS` steht, eine genannte Datei
fehlt, eine Testdatei weniger Fälle enthält als zugesagt oder eine Stufe der Zielkette
unbelegt ist (`docs/ABNAHMEPLAN.md`).

## 2. Regressionsblockade

- Regressionstests (`tests/regression/`, vom Fehlerpfad erzeugte Fälle) laufen im Job
  `unit-integration`. Ein Fehlschlag blockiert damit den gesamten Lauf — und ohne
  grünen Lauf gibt es keinen Merge.
- Die Promotion ist zusätzlich im Code blockiert (`lib/promotion.ts#promotionGate`):
  - Deployment-Kill-Switch aktiv → `allowed:false`.
  - Irgendeine Prüfung aus `LINT, TYPECHECK, UNIT, INTEGRATION, SECURITY, BUILD, BROWSER, EVALUATION`
    ist nicht `PASSED` → `allowed:false`.
  - Ziel `PRODUCTION`: Stufe muss `SMOKE` sein **und** eine erteilte Approval (`approvalGranted`) vorliegen.
- `lib/cicd.ts#promote` verweigert `PRODUCTION` ebenso, wenn ein Prüfstand nicht
  `PASSED` ist oder die Smoke-Stufe fehlt. Pipelines sind **persistent** — die
  Freigabe-Grundlage überlebt einen Neustart (`tests/unit/runtime-persistence.test.ts`).

## 3. Stufenmodell

```
BRANCH → SANDBOX → VERIFY → PREVIEW → APPROVAL → STAGING → SMOKE → PRODUCTION (→ ROLLED_BACK)
```

Jede Stufe ist im Pipeline-Datensatz sichtbar (`GET /api/cicd`). `ROLLED_BACK`
verweist über `rollbackArtifactId` auf das Rollback-Artefakt (Evidenz).

## 4. Grenzen

- Die Pipeline-Ausführung selbst liegt bei GitHub Actions; die Control Plane
  **spiegelt** Prüfstände und entscheidet über Promotion. Es gibt keinen eigenen Runner.
- Der Rollback ist umgesetzt (`lib/deployment.ts`, `scripts/release-supervisor.sh`), aber
  halbautomatisch: Zeigerwechsel in der Anwendung, Prozessneustart und Rückrollsicherung im
  Supervisor-Skript — kein Daemon, kein Zero-Downtime.
- Ein Deployment **nach außen** findet in dieser Umgebung nicht statt: Der Rollout läuft auf
  denselben Host und Slot (`STAGING`); `PRODUCTION` bleibt gesperrt, solange `BROWSER` und
  `EVALUATION` nicht real `PASSED` sind (`NOT_VERIFIED` für Produktion).

## 4a. Von der Pipeline zum laufenden Stand

Die Promotion entscheidet über **Freigabe**, das Deployment über **Auslieferung** — beides ist
getrennt und beides wird geprüft:

| Schritt | Prüfung | Verweigerung |
|---|---|---|
| `promote STAGING` | `LINT`…`BUILD` bestanden | Pipeline bleibt auf `VERIFY` |
| `updateCheck BROWSER\|EVALUATION SKIPPED` | nur mit Begründung zulässig | `SKIPPED` ohne Grund → Gate-Fehler |
| `promote SMOKE` / `SMOKE PASSED` | Smoke real bestanden | Staging-Gate verweigert |
| `POST /api/deployment deploy` | Plan + Health-Checks (Digest, Store, Event-/Audit-Kette, Isolation, HTTP) | `409` mit Gründen, Datensatz `REJECTED`/`FAILED` |
| `GET /api/deployment` | Build-ID **und** Startverzeichnis | `STAGED` + `restartRequired` statt „aktiv" |
| `rollback` | Vorgänger-Digest unversehrt | `409`, Datensatz bleibt unverändert |

Nach jedem Ausrollen wird die Pipeline auf `PRODUCTION` nur bei gemessenem `ACTIVE` gehoben;
beim Rückroll geht sie auf `ROLLED_BACK`.

## 5. Tests und Nachweise

- `tests/regression/regression-engine.test.ts` — Regression blockiert Wissen/Promotion.
- `tests/unit/runtime-persistence.test.ts` — Promotion-Gates nach Neustart.
- `tests/security/api-route-contract.test.ts` — jede Route besitzt einen Guard.
- `gh run list` — reale CI-Läufe je Commit (im Bericht `docs/ABSCHLUSSBERICHT.md` aufgeführt).
