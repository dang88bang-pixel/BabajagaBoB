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

## 2a. Ausführung ausschließlich über den Broker

`POST /api/computer-use {action:"execute"}` → `executeComputerAuthorized` (`lib/execution-broker.ts`).
Der Computer führt **nur** über Gate, Broker und Evidenz aus; es gibt keinen direkten Treiberaufruf aus
der Oberfläche oder aus einem Agenten heraus.

```
Creator/Session → Guard (computer:execute) → Broker (gemeinsame Autorisierung + computer:execute)
                → Bindung an Task/Sandbox/Instanz → Treiberprozess (argv[], shell:false)
                → Evidenz (kind COMPUTER_USE) → Audit → Provenance
```

- **Treibervertrag:** ein Node-Modul (`.mjs`/`.cjs`/`.js`), absoluter Pfad, über `BOB_COMPUTER_DRIVER`.
  Es liest **eine** Aktion als JSON von stdin
  (`{computerId, action, input, taskId, sandboxId, agentId, runId}`) und schreibt das Ergebnis als JSON
  auf stdout; Exit-Code 0 = `SUCCEEDED`.
- **Fail closed:** ohne Treiber, mit relativem Pfad, mit einer Shell als „Treiber" (`/bin/bash`) oder mit
  einem Nicht-Node-Modul wird die Aktion verweigert (`COMPUTER_DRIVER`) — es wird **nichts** als
  ausgeführt gemeldet.
- **Kein Tokenverbrauch bei Bindungsfehlern:** Autorisierung der Instanz, Task-/Sandbox-Bindung,
  Zustand, Netzwerk und Aktionsdeckung werden **vor** dem Verbrauch geprüft.
- **Ergebnis der Instanz:** `AVAILABLE` nach Erfolg, `FAILED` nach Fehler; die Task-/Sandbox-Bindung
  wird dabei freigegeben.
- Live-Betrieb: Die Route antwortet ohne Treiber mit `409 COMPUTER_DRIVER`; das ist der erwartete,
  ehrliche Zustand in einer Umgebung ohne Browser-Treiber.
- Live belegt (2026-11-01, mit einem **Vertrags-Testtreiber**): `SUCCEEDED` mit Evidenz
  `COMPUTER_USE` (`GET /api/artifacts?verify=…` → `ok: true`), Replay mit demselben Token →
  `409 TOKEN_VALIDATION`, nicht gedeckte Aktion → `409 COMPUTER_BINDING` bei `uses: 0`.
  Details: `docs/DEEP_VERIFICATION_2026-11-01.md`.

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

- Es gibt **keinen** echten Browser-/Desktop-Treiber in dieser Umgebung (kein Playwright, kein
  Chromium, kein VNC). Modell, Rechte, Persistenz, Verweigerungen **und** der Ausführungspfad über den
  Broker sind `IMPLEMENTED`, `INTEGRATED` und `TESTED`; gegen ein reales Gerät bleibt der Lauf
  `NOT_VERIFIED`. Ein mitgelieferter „Treiber", der nur Erfolg meldet, wäre ein Mock — deshalb gibt es
  keinen: ohne `BOB_COMPUTER_DRIVER` wird verweigert.
- OCR/Prozesslesen sind Aktionsklassen; die Ausführung erfolgt über den Treiber hinter dem Broker,
  nicht über eine eigene Steuerungsschicht an der Autorisierung vorbei.

## 6. Tests

- `tests/integration/computer-use.test.ts` — Registrierung, Autorisierungspflicht,
  Allokation, Start-Reihenfolge, Freigabe.
- `tests/integration/computer-broker.test.ts` (6 Tests) — Ausführung über den Broker mit echter
  Evidenz und genau einem verbrauchten Token; Fremdaufgabe ohne Tokenverbrauch; fehlende Fähigkeit
  `computer:execute`; nicht gedeckte Aktion; fehlender Treiber; Shell als Treiber.
- `scripts/verify-live.sh` — Computer-Use-Routen über HTTP.
