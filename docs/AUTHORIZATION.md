# Autorisierung — Abschnitt 12/13/17/38

Diese Datei beschreibt die **aktuelle Implementierung** der Autorisierungsstrecke.
Enforced ist ausschließlich:

```
Intent → Policy → Authorization → Execution Gate → Broker → Isolierte Runtime → Evidence
```

Verboten (und im Code nicht vorhanden): `Agent → beliebiges Tool → System`.

## 1. Reihung der Prüfungen

| # | Stufe | Datei | Wirkung |
|---|---|---|---|
| 1 | Server-Authentifizierung (Gate) | `lib/api/api-gate.ts`, `middleware.ts` | jede `/api/*`-Route außer `/api/auth` verlangt gültige HttpOnly-Session; Agenten zusätzlich `Authorization: Bobcap <tokenId>.<secret>` auf `/api/runtime` |
| 2 | Aktion/Subjekt (Guard) | `lib/api/guard.ts` | `guardRequest(request, {action, taskId, sandboxId, environment, creatorOnly, requireAgentCapability})` — fail closed, jede Verweigerung wird auditiert |
| 3 | Policy | `lib/policy.ts`, `lib/execution-gate.ts` | Risiko, Umgebung, Kill Switches (System/Agent/Task/Sandbox/Experiment), Approval-Pflicht |
| 4 | Autorisierung (Token) | `lib/authority.ts` | Capability-Token mit Subjekt-, Task-, Sandbox-, Risiko- und Umgebungsbindung, TTL, Widerruf |
| 5 | Broker | `lib/execution-broker.ts` | 18 Bedingungen; keine Ausführung ohne vollständige Bindung |
| 6 | Runtime | `lib/runtime-local.ts`, `lib/oci-runtime.ts` | `argv[]` + `shell: false`, Netzwerk `DENY`, Limits |
| 7 | Evidenz | `lib/artifacts.ts`, `lib/audit.ts`, `lib/provenance.ts` | digestgebundener Nachweis, Audit-Kette, Provenance-Graph |

## 2. Capability-Token (`lib/authority.ts`)

Verbote, die beim **Ausstellen** geprüft werden (Verstoß = Denial + Audit):

- `SELF_GRANT` — ein Agent darf sich **kein** Token selbst ausstellen (Subjekt = Aussteller ist verboten).
- `WILDCARD_CAPABILITY` — `*` ist nie zulässig.
- `EMPTY_CAPABILITIES`, `TOKEN_EXPIRED` (bereits abgelaufen), `TOKEN_TTL`.
- Für nicht-`CREATOR`-Aussteller: `TOKEN_DELEGATION` (nur Fähigkeiten, die die eigene Delegationskante abdeckt) und `TOKEN_RISK_ESCALATION` (kein höheres Risiko als die eigene Kante).

Bei der **Nutzung** prüft `validateCapabilityToken(tokenId, capabilities, {subject, taskId, sandboxId, risk, environment})`:

- Widerruf, Ablauf, Fähigkeitenumfang, Subjekt, Task, Sandbox, Risiko, Umgebung.
- Der Vergleich des Secrets läuft über `timingSafeEqual` (`verifyCapabilitySecret`).

Belegte Grenzen live (HTTP, `scripts/verify-live.sh`, Schritt „Agentenweg"):

| Versuch | Ergebnis |
|---|---|
| gültiges Token, **ohne** Browser-Session, `POST /api/runtime` | `200 accepted:true`, echter Prozess, Evidenz erzeugt |
| falsches Secret | `403 TOKEN_SECRET` |
| Token ohne `sandbox:run` | `403 CAPABILITY_DENIED` |
| Token einer `test`-Sandbox auf `development`-Sandbox | `403 CAPABILITY_DENIED` (Umgebungs-/Sandboxbindung) |
| Token auf fremder Sandbox | Denial (Sandbox nicht vorhanden/gebunden) |
| Token auf Verwaltungsroute (`/api/missions`) | `401 SESSION_REQUIRED` |
| Subjekt-Spoofing (`agentId` ≠ Token-Subjekt) | `409 AGENT_TASK_BINDING` |
| Shell-Interpreter (`/bin/sh -c`) | `409 SHELL_PROGRAM` |
| Widerrufenes Token | `403 CAPABILITY_DENIED` („token revoked") |
| System-Lockdown aktiv | `409 EXECUTION_GATE` („System lockdown is active") |

## 3. Rollen der Agent Fabric (11 Rollen)

`lib/control-plane.ts` legt elf Agenten an; `lib/agent-fabric.ts` ergänzt je Rolle ein
Autonomieprofil. Kein Profil erlaubt Selbstautorisierung, Governance-Bypass,
Produktionsfreigabe oder geheime Datenabflüsse — diese Felder sind für **alle**
Rollen `false`.

| Rolle | Aufgabe | Autonomie (Auszug) |
|---|---|---|
| `SUPERVISOR` | Orchestrierung, Dispatching | mittlere Autonomie, keine Authority-Änderung |
| `PLANNER` | Missionszerlegung | Planung, keine Ausführung |
| `BUILDER` | Code/Artefakte im Sandbox | höchste Ausführungsautonomie, aber ohne Netz/Prod |
| `RESEARCHER` | Recherche in Materialsammlung | Workspace-read, kein externes Netz |
| `SCIENTIST` | Experimente/Hypothesen | Experimente über `lib/science.ts` |
| `QA` | Verifikation, Regression | Verifikationsläufe, Report |
| `BROWSER` | Computer Use (Bildschirm) | nur registrierte/autoritisierte Geräte |
| `GUARDIAN` | Policy, Reviewer | Review-Pflicht, keine Ausführung |
| `OPS` | Runtime/Sandbox-Betrieb | Lifecycle, keine Codeänderung |
| `RECOVERY` | Fehlerbehebung, Rollback | arbeitet Pläne ab, Stufe 4/5 nur mit Creator-Freigabe |
| `INTEGRATOR` | Integration, Promotion-Vorschlag | Vorschlag, Freigabe bleibt beim Creator |

## 4. Approval-Pflicht (`lib/approvals.ts`, `lib/execution-gate.ts`)

- Tasks können `requiresApproval` tragen; der Broker verlangt dann ein `approvalId`,
  dessen Status `GRANTED` ist und dessen `taskId` zur Task passt (`APPROVAL`,
  `APPROVAL_BINDING`).
- Freigaben werden nur über `POST /api/control {action:"approval"}` (Creator-only) erteilt.
- Der Guardian (`POST /api/control {action:"guardian"}`) kann Freigaben anfordern.

## 5. Kill Switches (`lib/governance.ts`)

`setKillSwitch(scope, targetId, reason, actor)` mit Scope `SYSTEM | AGENT | TASK | SANDBOX | EXPERIMENT | DEPLOYMENT`.
`isKilled(scope, id)` wird im Execution Gate geprüft. `engageSystemLockdown()` /
`releaseSystemLockdown()` sperrt bzw. entsperrt global; jede Änderung wird auditiert
(`control.lockdown`, `control.unlock`).

## 6. Rollen der Oberfläche

Alle `/api/*`-Routen sind durch das Gate geschlossen. Zusätzlich gilt:

- **CREATOR-only**: Missionen/Objectives anlegen, Tasks anlegen/zuweisen, Sandbox-Snapshots,
  Authority-Ausstellung/-Widerruf, Approvals, Kill Switch, Persistenz-Backup, Runtime-Reconcile.
- **Agent (Capability)**: ausschließlich `POST /api/runtime` mit gebundenem Token.
- **Session + Aktion**: alle übrigen Lesezugriffe (`*:read`).

Der strukturelle Nachweis „keine Route ohne Guard" läuft als Test
(`tests/security/api-route-contract.test.ts`) und ist damit Teil der CI.

## 7. Grenzen / offene Punkte

- `ALLOWLIST`-Netzwerk ist **fail closed** (`NETWORK_POLICY`): es gibt keine kontrollierte
  Egress-Schicht, also wird nicht freigegeben. Klassifikation: `NOT_IMPLEMENTED` (bewusst).
- Externe Identitätsanbieter (OIDC) gibt es nicht; die Creator-Anmeldung erfolgt über
  Server-Secret (`BOB_CREATOR_LOGIN_SECRET`) plus optionalem TOTP (`BOB_CREATOR_TOTP_SECRET`).
- Der zweite Faktor wird in `docs/BOOTSTRAP.md` beschrieben.
