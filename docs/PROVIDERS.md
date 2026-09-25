# Provider-Fabric — Abschnitt 22/23

Implementierung: `lib/provider-fabric.ts`, `lib/data-boundary.ts`, `lib/privacy.ts`,
Routen `app/api/providers/route.ts`, `app/api/privacy/route.ts`.

## 1. Lebenszyklus

```
DISCOVERED → EVALUATING → AUTHORIZED → CONNECTING → CONNECTED → DEGRADED/BLOCKED → DISCONNECTED → REVOKED
```

`ProviderCategory = AGENT_RUNTIME | SANDBOX | WORKFLOW | CODE_AGENT | BUILD |
COMPUTER | DEPLOYMENT | KNOWLEDGE | OTHER`.
Gesundheit: `UNKNOWN | HEALTHY | DEGRADED | UNHEALTHY`.

## 2. Startzustand (fail closed)

Der Ausgangskatalog umfasst acht Adapter-Platzhalter — OpenHands, Daytona, E2B,
Temporal, LangGraph, SWE-agent, Dagger, Celesto. **Alle** sind:

- `enabled: false`, `lifecycle: "DISCOVERED"`, `health: "UNKNOWN"`
- `requiresApproval: true`, `dataPolicy: "METADATA_ONLY"`

Discovery ist also keine Autorisierung. Kein Provider ist in dieser Umgebung
tatsächlich verbunden; `GET /api/providers` zeigt genau diesen Zustand. Eine
Verbindung ist damit `ARCHITECTURE`/`NOT_VERIFIED`, nicht „aktiviert".

## 3. Übergänge und Bedingungen

| Funktion | Wirkung | Bedingung |
|---|---|---|
| `bindProvider({providerId, scope, scopeId, capabilities})` | bindet Fähigkeiten an System/Agent/Task/Sandbox | Provider existiert; Fähigkeiten müssen gedeckt sein |
| `setProviderState(providerId, state, actor)` | Lifecycle-Wechsel | erlaubte Übergänge, Creator für Freigaben |
| `connectProvider(providerId, actor)` | Verbindung aufbauen | Provider `AUTHORIZED`, `enabled`, Freigabe vorhanden — sonst Denial |
| `heartbeatProvider(providerId, …)` | Telemetrie/Health | nur bei bekannter Verbindung |
| `disconnectProvider` / `revokeProvider` | trennen bzw. dauerhaft entziehen | auditiert |

Jeder Übergang wird über `observe()` im Event-/Auditpfad festgehalten.

## 4. Daten- und Privatsphärengrenzen

- `dataPolicy` ist derzeit **immer** `METADATA_ONLY`: Inhalte (Code, Secrets,
  personenbezogene Daten) dürfen nicht an Provider gehen.
- `lib/data-boundary.ts#assertExternalTransmission` und
  `assertNoProtectedDataForThirdParty` verweigern unzulässige Übermittlungen.
  `assertProviderPayloadAllowed` (Provider-Fabric) prüft Nutzlasten zusätzlich.
- Netzwerk: Provider-Einträge tragen `ALLOWLIST` — das ist die **Beschreibung**
  des Fremdsystems, keine Freigabe der eigenen Seite. Ohne kontrollierte
  Egress-Schicht bleibt jede echte Außenverbindung fail closed (`NOT_IMPLEMENTED`).
- `lib/privacy.ts` veröffentlicht die Datenklassifizierungsregeln über `GET /api/privacy`.

## 5. Grenzen

- Es gibt **keine** Netzwerkverbindung zu den Providern; die Adapter sind
  Beschreibungen/Bindings. Ein realer Adapter müsste die Egress-Schicht,
  Secret-Verwaltung (`lib/secrets.ts`) und Freigabe mitbringen.
- `autonomousManagement` markiert die Absicht, dass ein Provider Betriebsaufgaben
  übernehmen darf — solange er nicht autorisiert/verbunden ist, ist das wirkungslos.

## 6. Tests

- `tests/integration/provider-fabric.test.ts` — Lifecycle, Approval-Pflicht,
  Datenrichtlinie und Denials.
- `scripts/verify-live.sh` — Provider-Status über HTTP (alle deaktiviert/unabgenommen).
