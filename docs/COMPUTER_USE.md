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

## 5. Ausführung über den Broker (`executeComputerAuthorized`)

Computer-Aktionen sind **Ausführungen**: Sie starten Prozesse, sehen
Bildschirminhalte und berühren fremde Daten. Deshalb gibt es keine eigene
Steuerungsschicht — der Weg ist derselbe wie bei jeder Sandbox-Ausführung:

```
Session/Capability → Gate → Broker (Prüfungen 1–16) → Computer-Prüfungen
                   → Treiberprozess → Evidenz (digest-geprüft)
```

Zusätzliche Prüfungen, die **vor** dem Start eines Treibers laufen:

| Prüfung | Bedeutung |
|---|---|
| `COMPUTER_EXISTS` | Instanz ist registriert |
| `COMPUTER_AUTHORIZED` | Creator hat sie autorisiert (Discovery ≠ Autorisierung) |
| `COMPUTER_STATE` | sie ist einem Lauf zugeordnet (`ALLOCATED`/`EXECUTING`) |
| `COMPUTER_BINDING` | Task und Sandbox stimmen überein — keine Fremdnutzung |
| `COMPUTER_ACTION` | die Aktion liegt in den Fähigkeiten der Instanz |
| `COMPUTER_ENVIRONMENT` | die Umgebung ist für die Aktion zugelassen |
| `COMPUTER_NETWORK` | die Aktion verlangt nicht mehr Netz als die Sandbox hat |
| `COMPUTER_RISK` | das Aktionsrisiko bleibt im Rahmen der Task |
| `COMPUTER_DRIVER` | ein Treiber ist konfiguriert — sonst fail closed |

Die Fremdbindung wird **vor** dem Verbrauch des Tokens geprüft: Ein Versuch mit
falscher Task verbraucht keine gültige Autorisierung.

### Treiber-Vertrag (`BOB_COMPUTER_DRIVER`)

- absoluter Pfad zu einer ausführbaren Datei oder einem Node-Modul
  (`.mjs`/`.cjs`/`.js`, dann mit `process.execPath` gestartet);
- Start als `argv[]` mit `shell:false`, ohne Umgebungsvererbung (nur `PATH`,
  `HOME`, `LANG`, `NODE_ENV`, `BOB_SANDBOX`, `BOB_COMPUTER`);
- Aktion als JSON über **stdin**:
  `{computerId, kind, action, input, taskId, sandboxId, runId, environment}`;
- Antwort als JSON über **stdout** (`{"ok": true}` bzw.
  `{"ok": false, "error": "…"}`); ohne JSON entscheidet der Exit-Code;
- harte Zeitgrenze aus den Sandbox-Limits, danach `SIGKILL` an die Prozessgruppe;
- relativer Pfad, fehlende Datei oder Shell-Interpreter → **keine** Ausführung.

`GET /api/computer-use` liefert den Treiberzustand (`driver.configured`,
`driver.reason`); die Oberfläche zeigt ihn unter „Computer Use". Ohne Treiber
ist Computer Use damit nicht „simuliert", sondern verweigert — es gibt keinen
Pfad, der eine Aktion vortäuscht.

## 6. Grenzen

- In dieser Umgebung ist kein Browser-/Desktop-Treiber angebunden. Der Pfad ist
  `IMPLEMENTED` + `TESTED` (Modell, Rechte, Broker-Prüfungen, Treiberprozess,
  Evidenz, Denials) und gegen einen **echten Treiberprozess** nachgewiesen;
  `NOT_VERIFIED` bleibt er gegen ein reales Gerät (kein Chromium/VNC verfügbar).
- OCR/Prozesslesen sind Aktionsklassen; die Ausführung erfolgt über den Treiber,
  nicht über eine eigene Steuerungsschicht.

## 7. Tests

- `tests/integration/computer-broker.test.ts` (4 Tests) — autorisierte Aktion
  über einen echten Treiberprozess (stdin/stdout-JSON, Evidenz digest-geprüft,
  Token genau einmal verbraucht), Fremdbindung vor dem Tokenverbrauch,
  fail closed ohne Treiber, nicht unterstützte Aktion.
- `tests/integration/computer-use.test.ts` — Registrierung, Autorisierungspflicht,
  Allokation, Start-Reihenfolge, Freigabe, keine Selbst-Autorisierung.
- `scripts/verify-live.sh` — Computer-Use-Routen über HTTP.
