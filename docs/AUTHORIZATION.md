# Autorisierung

**Stand:** 2026-09-25
**Grundsatz:** Kein Agent kann sich Rechte geben. Jede Ausführung ist auf ein
Subjekt, eine Aufgabe, eine Sandbox, eine Umgebung und ein Risiko gebunden.

## 1. Kette

```
Intent → Policy → Authorization → Execution Gate → Broker → Isolierte Runtime → Evidence
```

Der Pfad `Agent → beliebiges Tool → System` existiert nicht: Der Broker
(`lib/execution-broker.ts`) ist der einzige Weg zur Runtime, und die Runtime
startet ausschließlich `argv[]` mit `shell:false` (`lib/argv-policy.ts`).

## 2. Gegenstände (`lib/authority.ts`)

| Gegenstand | Bedeutung | Persistenz |
|---|---|---|
| Roots / Authority-Edges | Delegationsbeziehungen zwischen Subjekten; widerrufbar | `authority`-Store (Envelope mit Digest) |
| Capability-Token | kurzlebiger Nachweis für konkrete Aktionen | `authority`-Store, Secret nur als Hash |
| Rollen (RBAC) | OWNER, ADMIN, DEVELOPER, REVIEWER, OPERATOR, VIEWER | Code (`roleCapabilities`) |
| Attribute (ABAC) | Umgebung, Risiko, Approval-Pflicht auf der Zielressource | Code (`abacAllows`) |

## 3. Invarianten (durch Tests belegt)

1. **Keine Selbstvergabe:** `issueCapabilityToken` verweigert `issuedBy === subject`
   und `issuedByKind: "AGENT"` sowie sog. `privesc`-Capabilitys.
2. **Keine Wildcards:** Capability-Listen mit `*` werden abgelehnt.
3. **TTL-Grenzen:** `MAX_TOKEN_TTL_MS = 15 min` (Creator), `MAX_AGENT_TOKEN_TTL_MS = 5 min`
   (Agent). Ein Live-Lauf mit 11 Stunden TTL wird mit
   „token lifetime exceeds the allowed maximum of 900000ms" verweigert.
4. **Bindung:** Token sind an Subjekt, Task, Sandbox, Umgebung und Risiko gebunden;
   jede Abweichung ergibt `TOKEN_*`-DENY im Broker.
5. **Keine Rechteausweitung:** Ein Agent kann kein Token ausstellen, das sein
   `maxRisk` übersteigt.
6. **Widerruf wirkt sofort:** `revokeCapabilityToken` setzt `revoked`, jede weitere
   Verwendung schlägt fehl; Root-Widerruf führt zu `423` (fail closed).
7. **Alles wird auditiert:** Ausstellung, Verwendung, Verweigerung und Widerruf
   erzeugen Audit-Einträge (`lib/audit.ts`, HMAC-verkettet).

Nachweise: `tests/security/authority.test.ts`, `tests/security/api-guard.test.ts`,
`tests/security/route-guards.test.ts`.

## 4. Zugangswege in die API

| Weg | Merkmal | Gilt für |
|---|---|---|
| Browser-Session | Cookie `bob_session`, HttpOnly, SameSite=Strict, 8 h | alle `/api/*` außer `/api/auth` |
| Agent-Capability | `Authorization: Bobcap <tokenId>.<secret>` | `POST /api/runtime` (Broker) und Routen mit passender Capability |
| Legacy-Token | `BOB_CONTROL_PLANE_TOKEN` **und** `BOB_ALLOW_LEGACY_CONTROL_TOKEN=1` | lokale Administration/CI; authentifiziert als `ADMIN`, nie als Creator |

Ablehnungscodes: `428 BOOTSTRAP_REQUIRED` (vor Initialisierung),
`401 UNAUTHENTICATED` / `401 SESSION_REQUIRED`, `403 TOKEN_SECRET`,
`403 CAPABILITY_DENIED`, `403 CREATOR_ONLY`, `403 CSRF_ORIGIN`, `423` (Kill Switch,
Root-Widerruf, Creator-Sperre).

## 5. Aktionsspezifische Prüfung pro Route

`guardRequest` / `guardOrDeny` (`lib/api/guard.ts`, `lib/api/api-gate.ts`) prüfen
die konkrete Aktion:

| Route | Aktion | Bedingung |
|---|---|---|
| `GET /api/missions` | `mission:read` | Session |
| `POST /api/missions` | `mission:create` / `objective:create` | Creator |
| `GET /api/tasks` | `task:read` | Session |
| `POST /api/tasks` | `task:create` / `task:assign` | Creator (inkl. `risk`) |
| `POST /api/tasks {action:"status"}` | `task:status` + `task:execute` | Capability `task:execute`, Bindung an Task |
| `GET /api/sandboxes` | `sandbox:read` | Session |
| `POST /api/sandboxes` | `sandbox:<action>` (create/clone/start/pause/reset/destroy) | Creator, Task-/Risikobindung |
| `POST /api/sandboxes {action:"snapshot"/"restore"}` | `sandbox:snapshot` / `sandbox:restore` | Creator, Sandbox-Bindung |
| `POST /api/runtime {action:"execute"}` | `sandbox:run` + `task:execute` | Session oder Capability; 17 Broker-Prüfungen |
| `GET /api/runtime` | `runtime:read` | Session |
| `POST /api/runtime {action:"reconcile"}` | `runtime:reconcile` | Creator |
| `POST /api/runs` | `run:manage` | Session oder Capability `run:manage` |
| `GET /api/control` | `control:read` | Session |
| `POST /api/control` | `control:lockdown`, `governance:guardian`, `approval:resolve` | Creator |
| `GET /api/governance` | `governance:read` | Session |
| `POST /api/governance` | `governance:kill` / `governance:delegate` / `governance:revoke` | Creator |
| `POST /api/authority` | `authority:issue` / `authority:delegate` / `authority:revoke` | Creator |
| `POST /api/providers` | `provider:manage`; `provider:connect` nur mit Approval | Creator |
| `POST /api/devices` | `device:manage`; `device:authorize` | Creator für Autorisierung |
| `POST /api/errors` | `error:manage` (Lifecycle inkl. `fix.verify`) | Session |
| `POST /api/cicd`, `POST /api/promotion-gate` | `cicd:manage`, `promotion:evaluate` | Creator |
| `POST /api/worker` | `worker:run` | Creator |
| `POST /api/secrets` | `secret:manage` | Creator |
| `POST /api/provenance` | `provenance:write` | **Creator** (Evidenzintegrität) |
| `POST /api/knowledge` | `knowledge:write` | **Creator** (Wissensintegrität) |
| `POST /api/agents/fabric` | `agent:heartbeat`; `agent:manage` | Session bzw. Creator |

| `GET /api/audit` | `audit:read` | Session; `POST {action:"verify"}` prüft die Kette (append-only, kein Löschen) |
| `GET /api/metrics` | `metrics:read` | Session (fail closed); nur Zähler, keine Geheimnisse |
| `GET /api/persistence` | `persistence:read` | Session |
| `POST /api/persistence` | `persistence:backup` | **Creator**; `backup`/`restore` (Restore nur mit digest-geprüftem Backup) |
| `GET /api/apps`, `POST /api/apps` | `app:read`, `app:manage` | Session bzw. Creator (ausführbare Module) |
| `POST /api/science` | `science:manage` (Creator) bzw. `experiment:run` (Capability) | Modellierung/Evidenz sind Creator-Aktionen, der Experimentlauf ist autorisierte Ausführung |
| `POST /api/dispatcher` | `task:dispatch` / `worker:cycle` | Session oder Capability |
| `POST /api/queue`, `POST /api/reliability` | `queue:manage`, `reliability:manage` | Session oder Capability; `resolve`/`lock-regression` nur Creator |
| `POST /api/tools`, `/api/skills`, `/api/runtimes`, `/api/simulation`, `/api/workshop` | `tool:register`, `skill:manage`, `runtime:registry:register`, `simulation:manage`, `workshop:manage` | Creator |
| `GET /api/agents`, `/api/approvals`, `/api/events`, `/api/experiments`, `/api/gallery`, `/api/privacy`, `/api/timeline`, `/api/readiness` | jeweilige `:read`-Aktion | Session |

**Vollständigkeit:** jede Route außer `/api/auth` prüft ihre Aktion; der
strukturelle Regressionstest `tests/security/api-route-contract.test.ts`
verhindert neue Routen ohne Aktionsprüfung. Ohne Session bleibt zusätzlich die
Middleware-Grenze geschlossen (401/428).

## 6. Approval und Governance

- Risiko `HIGH`/`CRITICAL` oder `requiresApproval` erzeugt im Gate
  `REQUIRE_APPROVAL`; ohne Freigabe verweigert der Broker.
- Freigaben (`lib/approvals.ts`) sind an Anfrage, Antragsteller und Begründung
  gebunden und werden als Event + Audit geführt.
- Kill Switches (`lib/governance.ts`) wirken auf SYSTEM, AGENT, TASK, SANDBOX,
  DEPLOYMENT und EXPERIMENT; nur der Creator kann Sperren aufheben.
- Guardian-Läufe (`runGuardian`) prüfen Invarianten und melden Verstöße, statt
  sie stillschweigend zu reparieren.

## 7. Nicht implementiert / offen

- Zweiter Faktor für den Creator-Login (nur Einzel-Secret, siehe `docs/BOOTSTRAP.md` §5).
- Feingranulare, pro Subjekt konfigurierbare Rollen: die Rollenmatrix ist Code,
  keine Datenbank.
- Netzwerk-Allowlist: `ALLOWLIST` ist fail closed, bis ein kontrollierter
  Egress-Proxy existiert (`docs/SANDBOX.md`).
