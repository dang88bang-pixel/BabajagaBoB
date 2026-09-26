# Computer Use und Visualisierung — Abschnitt 24/31/32

Implementierung: `lib/computer-use.ts`, `lib/simulation.ts`, `lib/gallery.ts`,
Routen `app/api/computer-use/route.ts`, `app/api/simulation/route.ts`,
`app/api/gallery/route.ts`.

## 1. Computer-Use-Modell

```ts
ComputerUseKind   = BROWSER | DESKTOP | CLI
ComputerUseAction = NAVIGATE | CLICK | TYPE | SELECT | SCREENSHOT | OCR
                  | PROCESS_READ | FILE_READ | TERMINAL_EXECUTE
```

Jede Fähigkeit ist an Umgebungen gebunden (`environments`), an eine Netzklasse
(`DENY | ALLOWLIST | INTERNET`) und an ein Risiko (`risk`). Eine Instanz
(`ComputerInstance`) ist erst nutzbar, wenn sie **autorisiert** wurde.

## 2. Ablauf und Verweigerungen

```
registerComputer (Creator) → authorizeComputer (Creator) → allocateComputer → startComputer → releaseComputer
```

- `allocateComputer(id, taskId, sandboxId?)` verlangt `authorized === true` und
  Zustand `AVAILABLE`; sonst „computer is not authorized" bzw. „not available".
- `startComputer(id)` verlangt vorherige Allokation (`EXECUTING` nur nach `ALLOCATED`).
- `authorizeComputer(id, false)` entzieht die Autorisierung; laufende Allokationen
  müssen danach freigegeben werden.
- Der Seed `CMP-LOCAL-BROWSER` ist `network: DENY`, `authorized: false` — Computer Use
  ist damit **standardmäßig gesperrt**.

## 3. Netz- und Datengrenzen

`network: INTERNET` wäre eine Ausnahme, die ohne kontrollierte Egress-Schicht nicht
gewährt wird — die Fähigkeiten im Seed verlangen `DENY`. Bildschirminhalte sind
Daten: `lib/data-boundary.ts` verbietet die Weitergabe an Dritte
(`assertNoProtectedDataForThirdParty`), und Screenshots landen ausschließlich im
Sandbox-Workspace.

## 4. Simulation und Visualisierung

`lib/simulation.ts` erzeugt Szenarien (`createScenario`, `advanceScenario`) für
Zeitverläufe, Varianten, Vergleiche und Was-wäre-wenn-Fragen. Die Ergebnisse sind
**SIMULATED** und ausdrücklich keine Messung: sie erzeugen keine Evidenz und
ändern keinen Wissenszustand. `lib/gallery.ts` sammelt Artefakt-Präsentationen
(Visualisierungen) und verweist auf die zugrunde liegende Evidenz.

## 5. Grenzen

- Es gibt keinen echten Browser-/Desktop-Treiber in dieser Umgebung. Der Pfad ist
  `IMPLEMENTED` (Modell, Rechte, Persistenz, Denials) und `TESTED`, aber
  `NOT_VERIFIED` gegen ein reales Gerät.
- OCR/Prozesslesen sind Aktionsklassen; die Ausführung erfolgt über die Runtime,
  nicht über eine eigene Steuerungsschicht.

## 6. Tests

- `tests/integration/computer-use.test.ts` — Registrierung, Autorisierungspflicht,
  Allokation, Start-Reihenfolge, Freigabe.
- `scripts/verify-live.sh` — Computer-Use-Routen über HTTP.
