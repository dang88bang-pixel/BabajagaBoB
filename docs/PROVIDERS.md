# Provider-Fabric

**Stand:** 2026-09-25
**Modul:** `lib/provider-fabric.ts` (persistenter DurableStore `providers`),
`lib/privacy.ts`, `lib/data-boundary.ts`, `lib/approvals.ts`

**Grundsatz:** Ein Provider wird **entdeckt**, nicht vertraut. Verbinden,
Binden und Nutzen sind getrennte, einzeln autorisierte Schritte. Alles ist
standardmäßig deaktiviert.

## 1. Lebenszyklus (`ProviderLifecycle`)

```
DISCOVERED → EVALUATING → AUTHORIZED → CONNECTING → CONNECTED
                                   ↘ BLOCKED   ↘ DISCONNECTED → REVOKED
CONNECTED → DEGRADED (Health-Verlust) → CONNECTED/BLOCKED
```

- `DISCOVERED`: Katalogeintrag, `enabled: false`, keine Verbindung.
- `connectProvider(id, endpoint?, credentialRef?, approvalId?)` verlangt bei
  `requiresApproval` eine **freigegebene** Approval-ID; ohne Freigabe wird der
  Aufruf mit „third-party provider connection requires explicit approval"
  verweigert. Ein widerrufener Provider (`REVOKED`) kann nicht erneut verbunden werden.
- `disconnectProvider` und `revokeProvider` deaktivieren alle Bindungen
  (`deactivateBindings`) – ein Widerruf lässt keine halbaktive Bindung zurück.
- `heartbeatProvider` schreibt Health, Latenz und Meldung; `DEGRADED` ist ein
  beobachteter Zustand, kein stiller Ausfall.

## 2. Kategorien und Katalog

`ProviderCategory`: `AGENT_RUNTIME`, `SANDBOX`, `WORKFLOW`, `CODE_AGENT`,
`BUILD`, `COMPUTER`, `DEPLOYMENT`, `KNOWLEDGE`, `OTHER`.
Der Katalog enthält Adapter-Beschreibungen (u. a. OpenHands, Daytona, E2B,
Temporal, LangGraph) mit deklarierten Fähigkeiten, Version, Adapter-Namen und
`dataPolicy`. **Ein Adapter ist eine Beschreibung, keine Verbindung** – ohne
Credentials und Freigabe passiert nichts.

## 3. Bindungen

`bindProvider(providerId, scope, scopeId, capabilities)` verlangt:

1. einen **verbundenen** Provider (`CONNECTED`, `enabled`),
2. mindestens eine explizit angeforderte Fähigkeit,
3. dass der Provider jede angeforderte Fähigkeit wirklich anbietet
   (`provider does not offer: …` sonst Fehler),
4. Audit + Event (`provider.bind`, `provider.bound`).

Bindungen sind damit an Scope (`TASK`, `AGENT`, `SANDBOX`, …) und Fähigkeitsliste
gebunden und widerrufbar.

## 4. Datenschutzgrenze

- Privacy ist default `DENY`: `lib/privacy.ts` und `lib/data-boundary.ts`
  entscheiden je Datenklasse, ob eine Übertragung überhaupt zulässig ist.
- `assertProviderPayloadAllowed(providerId, dataClass)` verweigert bei
  `METADATA_ONLY` jede geschützte Datenklasse an Dritte
  (`assertNoProtectedDataForThirdParty` wirft – kein „weiches" Durchreichen).
- Credentials liegen ausschließlich als Referenz (`credentialRef`) bzw. im
  Secret-Store (`lib/secrets.ts`); Provider-Secrets werden nie an den Browser
  ausgeliefert und nicht in Events/Audit geschrieben.

## 5. Schnittstellen

| Zugriff | Wirkung |
|---|---|
| `GET /api/providers` | Katalog, Bindungen, Lifecycle, Health, `providerSnapshot()` |
| `POST /api/providers` | `provider:manage` (Creator); `provider:connect` nur mit Approval |
| `providerStoreReport()`, `providerSnapshot()` | Integrität und Zustandsübersicht |

## 6. Verifikation

- `tests/integration/provider-fabric.test.ts` (8 Tests): Entdeckung ohne
  Verbindung, Approval-Pflicht, Bindungsfähigkeiten, Health/Heartbeat,
  Datenvertrag, Persistenz über Neustart.
- `scripts/verify-live.sh` Schritt 7: alle Provider entdeckt **und** deaktiviert,
  Verbindung ohne Freigabe → 400, unbekannter Provider → 400.

## 7. Offen (PARTIAL)

- Es gibt **keine** echte Netzwerkverbindung zu externen Anbietern: Egress ist
  default `DENY` und `ALLOWLIST` fail closed. Die Adapter sind Vertrag +
  Zustandsmaschine, nicht live erprobt.
- Kein automatisches Health-Scoring/Quarantäne bei wiederholtem Ausfall.
