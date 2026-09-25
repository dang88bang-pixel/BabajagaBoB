# CI/CD und Promotion

**Stand:** 2026-09-25
**Workflow:** `.github/workflows/ci.yml`
**Module:** `lib/cicd.ts` (Pipelines/Checks), `lib/promotion.ts` (Gate),
`lib/approvals.ts` (Produktionsfreigabe)

**Grundsatz:** Kein Schritt überspringt einen Check. Regression blockiert die
Promotion, Produktion ist ohne Creator-Freigabe nicht erreichbar.

## 1. CI-Jobs

| Job | Inhalt | Blockiert |
|---|---|---|
| `lint-and-typecheck` | `npx eslint .`, `npx tsc --noEmit` | alles Weitere (`needs`) |
| `unit-integration` | Unit-, Integrations- und Regressionstests | Security-Job nicht, aber Gate |
| `security` | Security- und E2E-Suite, Dependency-Audit (fail closed bei high/critical) | Gate |
| `build` | `npm run build` (Produktionsbuild) | Gate |
| `verification-gate` | fasst alle Stufen zusammen | Promotion |

Umgebung im CI: `BOB_SANDBOX_RUNTIME=local` (echte lokale Runtime mit
`argv[]`/`shell:false`), temporäre Storages je Testdatei.

Letzte Läufe auf diesem Branch (alle grün):
`36090732676` (`b71c5ff`), `36090186817` (`ac758dd`), `36086611264` (`803c213`),
`36091730579` (`3d49af1`).

Hinweis: GitHub meldet, dass `actions/checkout@v4` und `actions/setup-node@v4`
wegen Node-20-Deprecation auf Node 24 ausgeführt werden – informativ, ohne
Auswirkung auf das Ergebnis.

## 2. Pipeline im Produkt (`lib/cicd.ts`)

Check-Arten (`CheckKind`): `LINT`, `TYPECHECK`, `UNIT`, `INTEGRATION`,
`SECURITY`, `BUILD`, `BROWSER`, `EVALUATION`, `SMOKE`
(Status: `PENDING`, `RUNNING`, `PASSED`, `FAILED`, `SKIPPED`).

Promotionsstufen (`PromotionStage`):

```
BRANCH → SANDBOX → VERIFY → PREVIEW → APPROVAL → STAGING → SMOKE → PRODUCTION → ROLLED_BACK
```

`createPipeline({taskId, branch, runId?, approvalId?})` → `updateCheck(...)` je
Prüfung → `promote(pipelineId, next)` in der erlaubten Reihenfolge. Ein
`ROLLED_BACK`-Zustand ist ein legitimer Endzustand, kein Fehler.

## 3. Promotion-Gate (`lib/promotion.ts`)

`promotionGate(pipeline, "STAGING" | "PRODUCTION")` verweigert, wenn:

1. ein Deployment-Kill-Switch aktiv ist (`deployment kill-switch active`),
2. irgendein Verifikations-Check (`LINT`, `TYPECHECK`, `UNIT`, `INTEGRATION`,
   `SECURITY`, `BUILD`, `BROWSER`, `EVALUATION`) nicht `PASSED` ist
   (`verification checks incomplete`) – hier greift **Regression blockiert Promotion**,
3. für `PRODUCTION` die Stufe nicht `SMOKE` ist (`smoke stage required`),
4. für `PRODUCTION` keine **freigegebene** Approval vorliegt
   (`production approval required`, geprüft über `approvalGranted`).

Nur wenn alle Bedingungen erfüllt sind, lautet das Ergebnis
`promotion gates satisfied`. Das Gate ist damit fail closed: ein fehlender Check
ist eine Verweigerung, kein „unbekannt, deshalb erlaubt".

## 4. Schnittstellen

| Zugriff | Wirkung |
|---|---|
| `GET /api/cicd` | Pipelines, Checks, Stufen |
| `POST /api/cicd` | `cicd:manage` (Creator) |
| `POST /api/promotion-gate` | `promotion:evaluate` (Creator); Ergebnis mit `allowed` + `reasons` |

## 5. Verifikation

- `scripts/verify-live.sh` Schritt 7/8 prüft Governance- und Betriebsgrenzen;
  Promotionsentscheidungen sind über `POST /api/promotion-gate` reproduzierbar.
- Die CI blockiert Merges bei fehlgeschlagenen Stufen (Workflow-Regeln im Repo).

## 6. Offen (PARTIAL)

- Kein automatisches Deployment: `promote` verändert den Pipeline-Zustand, führt
  aber kein Deployment aus (bewusst – Produktion bleibt manuell und Creator-gebunden).
- Keine Browser-/UI-Checks im CI (Stufe `BROWSER` ist definiert, aber nicht
  automatisiert ausgeführt).
