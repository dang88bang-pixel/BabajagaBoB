# Computer Use und Simulation

**Stand:** 2026-09-25
**Module:** `lib/computer-use.ts` (Browser/Desktop/CLI), `lib/simulation.ts`
(Szenarien und Visualisierung)

**Grundsatz:** Ein registrierter Computer ist **nicht** autorisiert. Die
Reihenfolge lautet: registrieren → autorisieren (Creator) → allokieren →
starten → freigeben. Netzwerk ist default `DENY`.

## 1. Computer Use (`lib/computer-use.ts`)

### Arten und Aktionen

| `ComputerUseKind` | typische Aktionen (`ComputerUseAction`) |
|---|---|
| `BROWSER` | `NAVIGATE`, `CLICK`, `TYPE`, `SELECT`, `SCREENSHOT`, `OCR` |
| `DESKTOP` | wie Browser plus `SCREENSHOT`, `PROCESS_READ`, `FILE_READ` |
| `CLI` | `TERMINAL_EXECUTE` (über die Sandbox/Broker-Kette, nie direkt) |

Weitere Aktionen: `PROCESS_READ`, `FILE_READ`. Jede Fähigkeit
(`ComputerCapability`) deklariert Art, Aktionsliste, erlaubte Umgebungen,
Netzwerkmodus und Risiko.

### Zustände

```
AVAILABLE → ALLOCATED → EXECUTING → RELEASED      (FAILED / PAUSED als Fehlerpfade)
```

- `allocateComputer(id, taskId, sandboxId?)` verweigert nicht autorisierte oder
  nicht verfügbare Instanzen („computer is not authorized" / „not available").
- `startComputer` verlangt vorher `ALLOCATED` („computer must be allocated first").
- `authorizeComputer(id, true/false)` ist ein **Creator-Akt** und wird auditiert
  (`computer.authorize`, `decision` ALLOW/DENY).
- Der ausgelieferte Standard (`CMP-LOCAL-BROWSER`) ist ein **lokaler** Browser-Sandbox
  mit `network: "DENY"` und ist **nicht** vorautorisiert – Autorisierung bleibt
  eine bewusste Entscheidung.

### Grenzen

- Kein direkter Systemzugriff: `TERMINAL_EXECUTE` läuft über Sandbox + Broker
  (`argv[]`, `shell:false`), nicht über die Route selbst.
- Netzwerk `DENY`/`ALLOWLIST` (fail closed); `INTERNET` ist deklarierbar, aber in
  der Ausführung nicht erreichbar, solange kein Egress-Proxy existiert.
- Screenshots/OCR gelten als Evidenz: Ablage mit Digest, nie als verstecktes
  Zwischenergebnis.

### Schnittstellen

| Zugriff | Wirkung |
|---|---|
| `GET /api/computer-use` | Instanzen + Fähigkeiten |
| `POST /api/computer-use` | `register` (Creator), `authorize` (**Creator**), `allocate`, `start`, `release` |
| `computerUseStoreReport()` | Integritätsbericht |

## 2. Simulation und Visualisierung (`lib/simulation.ts`)

- `ScenarioState`: `DRAFT → MODELING → SIMULATING → EXPERIMENT → OBSERVING →
  VALIDATING → COMPLETED | FAILED`.
- `VisualizationKind`: `ARCHITECTURE`, `FLOW`, `TIMELINE`, `STATE_MACHINE`,
  `DEPENDENCY`, `NETWORK`, `SCENE_3D`.
- Szenarien halten `inputs`, `assumptions` und Ergebnis; `advanceScenario`
  dokumentiert jeden Übergang. Eine Simulation ist **kein** Nachweis: Ergebnisse
  werden als Szenario-Ergebnis gekennzeichnet und nicht als `VERIFIED` geführt.

## 3. Verifikation

- `scripts/verify-live.sh` Schritt 7 prüft die Geräte-Fabric (gleiches Prinzip);
  Computer Use folgt demselben Muster und ist über die API prüfbar.
- Persistenz und Integrität über den kanonischen Store.

## 4. Offen (PARTIAL)

- Kein echter Browser-/Desktop-Treiber (Playwright o. ä.) angebunden: Aktionen
  sind Vertrag + Zustandsmaschine, die Ausführung wäre über eine Sandbox zu
  erproben.
- Keine eigenen automatisierten Tests für Computer Use/Simulation (in
  `docs/TODO.md` geführt).
