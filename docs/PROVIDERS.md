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
| `bindProvider({providerId, scope, scopeId, capabilities})` | bindet Fähigkeiten an System/Agent/Task/Sandbox | Provider existiert und ist nach erfolgreichem Live-Handshake `CONNECTED`; Fähigkeiten müssen gedeckt sein |
| `connectProvider(id, endpoint, credentialRef, approvalId)` | prüft den Antrag, führt aber derzeit keine Verbindung aus | HTTPS ohne URL-Credentials/Query; Secret-Store-Referenz; Creator-Freigabe muss Provider-ID und exakten Endpoint-Origin abdecken; bis ein Broker-Handler für kontrollierten Egress und echten Secret Store existiert: 503 ohne Zustandsänderung |
| `heartbeatProvider(id, {health, latencyMs})` | schreibt Health-/Latenz-Metadaten | nur nach Live-Verbindung; keine frei übergebene Meldung und kein öffentlicher API-Endpunkt |
| `disconnectProvider` / `revokeProvider` | trennen bzw. dauerhaft entziehen und Bindungen deaktivieren | Creator-geschützter API-Pfad, auditiert |

Es gibt keinen öffentlichen `state`- oder `heartbeat`-API-Schreibpfad. Lifecycle-Übergänge aus einem Live-Handshake bzw. internem Monitor werden über `observe()` protokolliert; Audit- und Telemetriedaten enthalten weder Credential-Werte noch Adapter-Fehlertexte.

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

## 5. Grenzen und Live-Status

- Es gibt keinen Broker-Handler für Provider-Liveverbindungen und keinen
  produktiven OpenHands- oder sonstigen Live-Adapter. Der API-Pfad ist bewusst
  nur eine fail-closed Admission-Prüfung und führt keine direkte Netzwerk-I/O aus.
- `lib/secrets.ts` stellt derzeit In-Memory-Leases aus, ist aber kein angebundener
  externer Secret Store. Ebenso ist kein kontrollierter Egress-Adapter im
  Workspace eingebunden. Ein registrierter Produktivadapter muss beide Dienste
  nutzen und darf nicht direkt am Egress-Gate vorbeifetchen.
- Der Creator hat OpenHands als Ziel genannt und berichtet, Egress und Secret
  Store seien bereit. Diese Chat-Angabe ist keine Control-Plane-Freigabe oder
  Endpoint-/Credential-Registrierung. Es wurde kein externer Aufruf ausgeführt;
  `PROVF-002` bleibt `NOT_VERIFIED` bis zur app-seitigen Einbindung und einem
  echten Handshake samt Telemetrie-Evidence.
- `autonomousManagement` markiert die Absicht, dass ein Provider Betriebsaufgaben
  übernehmen darf — solange er nicht verbunden und autorisiert ist, ist das wirkungslos.

## 6. Tests

- `tests/integration/provider-fabric.test.ts` — 13 Lifecycle-/Safety-Vertragstests:
  Creator-Approval mit exaktem Host, HTTPS-Grenzen, fehlender Broker-Adapter
  (503 ohne Zustandsänderung), kein Spoofing per öffentlichem State-/Heartbeat-
  Endpunkt, Secret-safe Auditdaten, Bindungs-/Widerrufsgrenzen und Datenrichtlinie.
  Es gibt bewusst keinen Connector-Teststub, der `CONNECTED` vortäuscht; diese
  Tests sind dennoch kein Live-Provider-Nachweis. Der Testlauf im vollständigen
  Workflow `37054748186` (Job `110996579243`) bestand.
- `scripts/verify-live.sh` — Provider-Status über HTTP (alle deaktiviert/unabgenommen).
