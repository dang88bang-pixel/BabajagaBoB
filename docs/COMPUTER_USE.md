# Computer Use und Visualisierung

Computer Use modelliert kontrollierte Browser-/Desktop-/CLI-Ressourcen. Eine registrierte Instanz ist nicht automatisch autorisiert. Die zentrale Ausführung läuft über den Execution Broker; die Oberfläche liest den Zustand über `GET /api/computer-use`.

## Lifecycle und Rechte

```text
register (Creator) → authorize (Creator) → allocate (Task + Sandbox) → execute (Broker) → release (Creator)
```

- Registrierung setzt `authorized: false`; ein mitgesendetes `authorized: true` wird ignoriert.
- Autorisierung ist ein separater Creator-Akt mit Event und Audit.
- Allocation bindet die Ressource an eine Task und optional eine Sandbox. Eine Ressource kann nicht gleichzeitig zwei Aktionen ausführen; ein persistenter, kurzlebiger Lease schützt vor parallelen Aufrufen.
- Der Execution Broker prüft Agent-/Task-/Sandbox-Bindung, Risiko, Umwelt, Computer-Profil, Kill Switch, Approval und ein einmalig nutzbares Capability-Token. Vor einer Verweigerung wird das Token nicht verbraucht.
- Erfolgreiche und fehlgeschlagene Aufrufe erzeugen Audit, Event, Provenance und digest-gebundene Evidence. Eingaben und Adapterausgaben werden nicht ungefiltert in Audit/Event/Evidence kopiert; dort stehen nur Digests und Statusmetadaten.
- Die Aktion `TERMINAL_EXECUTE` ist bis zu einem separaten argv-/Capability-Vertrag gesperrt. Computer-Aktionen bieten keinen allgemeinen Shell-Pfad.

## HTTP-Aufruf

Creator können eine einzelne Aktion im Control Center/API freigeben. Das Backend stellt dafür eine kurzlebige, einmalige, auf Agent/Task/Sandbox/Umwelt begrenzte Capability aus und verwendet sie ausschließlich serverseitig. Der Browser erhält weder deren Secret noch das Token.

Agenten verwenden ein `Bobcap`-Token mit mindestens:

```text
computer:use, computer:execute, task:execute, sandbox:run
```

Beispiel (die Instanz muss vorher autorisiert und alloziert sein):

```json
{
  "action": "execute",
  "computerId": "CMP-LOCAL-BROWSER",
  "computerAction": "SCREENSHOT",
  "computerInput": {"target": "main"}
}
```

`taskId`, `sandboxId`, Agent und Umwelt werden aus der persistenten Computer-/Control-Plane-Bindung abgeleitet, nicht aus frei übergebenen Actor-Feldern. Die Route `POST /api/computer-use` gibt eine Broker-Antwort mit Status und Evidenzreferenz zurück.

## Operator-konfigurierter Adapter

Ein Adapter wird optional mit `BOB_COMPUTER_DRIVER` als **absoluter Pfad** zu einer regulären, nicht symbolisch verlinkten Node.js-Datei eingerichtet. Beispiel:

```bash
BOB_COMPUTER_DRIVER=/opt/bob/computer-driver.mjs
```

Der Broker startet den konfigurierten Adapter mit `shell:false`, einem minimalen Prozess-Environment und einem begrenzten JSON-Request auf stdin. Der Adapter muss ein JSON-Objekt mit `{"ok":true,...}` auf stdout liefern. Eingabe ist auf 16 KiB, die Ausgabe auf 64 KiB und eine einzelne Aktion auf höchstens 60 Sekunden begrenzt. Adapter-Fehler, ungültiges JSON, Zeitüberschreitung und fehlende Konfiguration gelten nicht als Erfolg.

Der Adapterpfad ist eine **vertrauenswürdige lokale Integrationsgrenze**: Adaptercode läuft mit der Identität des BabajagaBoB-Serverprozesses. `network: DENY` wird vom Broker als Policy geprüft, ist für einen beliebigen Host-Browser-/Desktop-Adapter aber nicht automatisch eine Kernel-Netzwerksperre. Keine echte Browser-/Desktop-Isolation oder kontrollierte Egress-Allowlist wird behauptet. Der Adapter muss lokal geprüft werden; bis ein echter, isolierter Treiber verfügbar ist, bleibt die Realgeräteausführung `UNVERIFIED`.

## Datenschutz

Computer-Eingaben (z. B. getippter Text) und Adapterausgaben können geschützte Daten enthalten. Sie werden an den konfigurierten Adapter übergeben und in der Antwort an den autorisierten Aufrufer zurückgegeben, aber nur als SHA-256-Fingerprints und Metadaten persistent belegt. Adapter dürfen Daten nicht extern senden. Das ist eine technische Betriebsverpflichtung, kein Nachweis über beliebigen Adaptercode.

## Simulation und Visualisierung

`lib/simulation.ts` erzeugt Szenarien (`createScenario`, `advanceScenario`) für Zeitverläufe, Varianten, Vergleiche und Was-wäre-wenn-Fragen. Simulationen sind `SIMULATED`, erzeugen keine Ausführungsevidenz und ändern keinen Wissenszustand. `lib/visualization.ts` rendert passive SVG-Artefakte aus echtem Plattformzustand; `lib/gallery.ts` sammelt Präsentationen und verweist auf Evidenz.

## Nachweis und verbleibende Grenze

- `tests/integration/computer-use.test.ts` prüft Registrierung, Autorisierungspflicht, Allocation und Lifecycle.
- `tests/integration/computer-broker.test.ts` prüft echte Adapter-Übergabe, Capability-Verbrauch, fremde Bindung, Evidence und Geheimnisgrenze mit einem lokalen Testadapter.
- Ein solcher Testadapter ist **kein** Browser-/Desktop-Nachweis. Kein physischer Computer, Browser-Treiber, OCR-Modell oder isolierter Desktop wurde in dieser Umgebung verifiziert.
