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

## 4. Geräte-Registrierung (Enrollment) — `lib/device-enrollment.ts`

Registrierung war zuvor nur mit Creator-Session möglich; ein Discovery-Dienst auf
einem Host konnte sich damit nicht melden. Das Enrollment ist der **minimal
berechtigte** Weg dafür:

| Weg | Zugang | Erlaubte Aktionen |
|---|---|---|
| Creator-Session | Login | `discover`, `authorize`, `allocate`, `release` |
| Enrollment-Geheimnis | `BOB_DEVICE_ENROLLMENT_SECRET` (≥16 Zeichen) | `enroll`, `heartbeat` — **nur** Discovery und Lebenszeichen |
| kein/falsches Geheimnis | — | Verweigerung, kein Datensatz |

```bash
BASE=http://127.0.0.1:3000 BOB_DEVICE_ENROLLMENT_SECRET=… node scripts/discover-host.mjs
```

Eigenschaften:

- **Fail closed:** fehlt das Geheimnis (oder ist es kürzer als 16 Zeichen), ist
  Enrollment deaktiviert (`503 ENROLLMENT_DISABLED`) — es gibt keinen stillen
  „erlaubt"-Pfad.
- **Konstantzeitvergleich** über SHA-256-Digests; das Geheimnis erscheint in
  keiner Antwort, keinem Ereignis und keinem Audit-Eintrag.
- **Kein Selbst-Grant:** `authorized: true` aus einer Meldung wird verworfen; das
  Gerät landet als `DISCOVERED`/`authorized: false`. Autorisieren, Reservieren und
  Freigeben bleiben Creator-Akte (`device:authorize`).
- **Lebenszeichen ändert keine Rechte:** `heartbeatDevice()` setzt nur `lastSeen`
  und gemeldete Fähigkeiten/Netzklasse — niemals `authorized`, `state` oder
  `currentTaskId`.
- **Kennungen sind eng begrenzt** (`^[A-Za-z0-9._-]{3,64}$`): sie landen in
  Provenienz und Audit, deshalb ist eine unbrauchbare Kennung eine Verweigerung
  und keine Protokollpanne (siehe `docs/TESTING.md` §7, Fehler 36).
- Jede Annahme und jede Verweigerung erzeugt Ereignis + Audit (`ALLOW`/`DENY`).
- Der Discovery-Agent `scripts/discover-host.mjs` nutzt **keinen** Shell-Aufruf:
  Fähigkeiten werden über `existsSync` auf bekannten Pfaden ermittelt.

## 5. Grenzen

- Es gibt keinen Netz-Scanner (kein ARP-/mDNS-Scan): Discovery ist **selbstmeldend**
  (Agent meldet seinen Host) oder manuell über die Route. Ein aktiver Scan über
  Subnetze ist `NOT_IMPLEMENTED`.
- Netzwerkzugriff auf Geräte ist nicht implementiert; `network` beschreibt die
  Klassifizierung, nicht eine aktive Verbindung (`NOT_IMPLEMENTED`).
- Keine Fernsteuerung von Geräten über das Control Center.
- Der Enrollment-Agent ist hier gegen die laufende Instanz geprüft; ein Betrieb
  mit mehreren Hosts, Rotation des Geheimnisses oder Attestierung ist
  `NOT_IMPLEMENTED`.

## 6. Tests

- `tests/security/device-enrollment.test.ts` (8 Tests) — fail closed, falsches
  Geheimnis, Discovery ohne Autorisierung, Lebenszeichen ohne Rechteänderung,
  kein Selbst-Grant, Creator-Weg unverändert, Geheimnis nie in Antworten.
- `tests/integration/computer-use.test.ts` — Geräte-/Computerpfad mit Denials.
- `scripts/verify-live.sh`, `scripts/audit-actions.mjs` (Kette 7) — Geräte- und
  Computer-Status über HTTP, Autorisierungspflicht, Enrollment-Negativfall.
- `scripts/audit-ui.mjs` (Stufe B3) — kein Gerät ist ohne Creator-Freigabe autorisiert.


## Scheduling

Autorisierte, verfügbare Geräte können anhand von CPU, RAM, GPU, Betriebssystem, Architektur, Netzwerk und benötigten Capabilities ausgewählt werden. Die Auswahl ist deterministisch; nicht passende oder nicht autorisierte Geräte werden nie allokiert. Der API-Aktionsweg ist `allocate-best`.
