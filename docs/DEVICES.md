# Device-Fabric — Abschnitt 24/25/31

Implementierung: `lib/devices.ts`, Route `app/api/devices/route.ts`.

## 1. Grundsatz: Discovery ≠ Autorisierung

Ein entdecktes Gerät ist **nicht** vertrauenswürdig. `discoverDevice()` legt es mit
`authorized: false` und `state: "DISCOVERED"` an und protokolliert
`device.discovered`. Erst `authorizeDevice(id, true, "CREATOR")` setzt die
Autorisierung — und **nur** der Creator darf das:

```ts
if (actor !== "CREATOR") throw new Error("device authorization requires Creator authority");
```

Damit ist „automatische Autorisierung unbekannter Geräte" nicht nur verboten,
sondern im Code unmöglich.

## 2. Zustandsmodell

`DeviceState = UNKNOWN | DISCOVERED | IDENTIFIED | TRUSTED | AUTHORIZED | AVAILABLE | ALLOCATED | EXECUTING | RESULT | RELEASED`

Vertrauensklassen: `LOCAL_TRUSTED | MANAGED | EPHEMERAL | EXPERIMENTAL | RESTRICTED | OBSERVATION_ONLY`
Netzklassen: `INTERNET | LAN | VPN | NONE | ALLOWLIST`

`allocateDevice(id, taskId)` verlangt `authorized === true` **und** Zustand
`AUTHORIZED|AVAILABLE`; andernfalls Denial. `releaseDevice(id)` gibt frei.
`RESULT` dokumentiert das Ergebnis der zugewiesenen Arbeit.

## 3. Auslieferungszustand

Der Seed enthält genau ein Gerät: `DEV-LOCAL` („Control Host"), Linux/x64,
`trust: LOCAL_TRUSTED`, `network: NONE`, `authorized: true`, `state: AVAILABLE`.
Kein externes Gerät ist vorab vertraut. Ein Gerät mit Beobachtungsauftrag erhält
`trust: OBSERVATION_ONLY` und wird nie für Ausführung allokiert.

## 4. Grenzen

- Es gibt keinen Agenten für automatische Discovery im Netz; Geräte werden über die
  Route registriert (`device:manage`, Creator) oder durch den Integrator gemeldet.
- Netzwerkzugriff auf Geräte ist nicht implementiert; `network` beschreibt die
  Klassifizierung, nicht eine aktive Verbindung (`NOT_IMPLEMENTED`).
- Keine Fernsteuerung von Geräten über das Control Center.

## 5. Tests

- `tests/integration/computer-use.test.ts` — Geräte-/Computerpfad mit Denials.
- `scripts/verify-live.sh` — Geräte- und Computer-Status über HTTP, Autorisierungspflicht.
