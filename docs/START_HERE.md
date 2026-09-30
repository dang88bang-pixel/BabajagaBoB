# BabajagaBoB – Start heute

Diese Anleitung beschreibt den schnellsten Weg, die Anwendung lokal als Creator zu benutzen.

## 1. Voraussetzungen

- Node.js mit npm
- ein lokaler Rechner, auf dem der Prozess laufen darf
- Git

Die Anwendung verwendet standardmäßig lokale Persistenz unter `.bob-data/` und die lokale, isolierte Runtime.

## 2. Repository installieren

```bash
npm ci
```

## 3. Lokale Umgebung vorbereiten

```bash
npm run setup
```

Der Setup-Schritt erzeugt bei Bedarf `.env.local` mit einem zufälligen Bootstrap-Secret. Die Datei bleibt lokal und wird nicht von Git versioniert.

## 4. Anwendung starten

```bash
npm run dev
```

Danach:

```
http://localhost:3000
```

Alternativ erledigt ein Befehl Vorbereitung und Start:

```bash
npm run dev:ready
```

## 5. Erster Creator-Start

Die Oberfläche zeigt zunächst **Creator-Bootstrap**.

Das vom Setup ausgegebene Bootstrap-Secret dort eingeben.

Nach erfolgreichem Bootstrap wird serverseitig ein Creator-Login-Secret erzeugt:

```
.bob-data/creator-token
```

Die Datei hat die Berechtigungen `0600`. Das Secret wird nicht an den Browser ausgeliefert.

Danach arbeitet die Oberfläche mit einer HttpOnly-Session.

Wenn `BOB_CREATOR_TOTP_SECRET` gesetzt ist, verlangt die Anmeldung zusätzlich den TOTP-Code.

## 6. Was nach dem Login verfügbar ist

Das Control Center bildet die vollständige operative Oberfläche ab:

- Übersicht
- Missionen
- Objectives
- Pläne
- Aufgaben
- Agenten
- Queue und Runs
- Sandboxes
- Runtimes
- Evidenz
- Audit
- Provenance
- Timeline / Replay
- Observatory
- Wissen
- Experimente / Wissenschaft
- Fehlerfälle
- Recovery / Regression
- Creator-Inbox
- Freigaben
- Governance / Kill-Switch
- Sicherheit / Datenschutz
- Provider / Geräte / Computer Use
- CI/CD / Deployment / Tests
- Betrieb / Persistenz / Metriken / SLO
- Tools / Skills / Workshop
- Simulation / Galerie / Apps

Die Oberfläche pollt den operativen Zustand und zeigt leere oder nicht verfügbare Bereiche ausdrücklich an. Statusfarben und Statusbezeichnungen kommen aus dem zentralen Statusmodell.

## 7. Sicherheitsgrenzen

Die UI erhält keine Root-, Provider-, Geräte- oder Runtime-Secrets.

Ausführung läuft nicht direkt aus dem Browser, sondern über:

```
UI
 ↓
Control Plane
 ↓
Authority / Policy / Approval
 ↓
Execution Gate
 ↓
Execution Broker
 ↓
Worker
 ↓
Sandbox Runtime
```

Netzwerk ist standardmäßig deaktiviert. Kritische Aktionen bleiben freigabepflichtig.

## 8. Verifikation vor Nutzung

Für einen vollständigen lokalen Prüfstand:

```bash
npm run verify
```

Für den dokumentierten Live-Nachweis stehen zusätzlich die vorhandenen Prüfskripte unter `scripts/` zur Verfügung.

## 9. OCI

Die lokale Runtime ist der verifizierte Standard.

OCI/Docker kann separat aktiviert werden:

```bash
BOB_SANDBOX_RUNTIME=oci
BOB_OCI_IMAGE=alpine:3.20
```

Der echte OCI-Daemon-Lauf ist umgebungsabhängig und darf nicht als verifiziert gelten, wenn kein geeigneter Daemon verfügbar ist.

## 10. Betriebsdaten

Lokale Laufzeitdaten:

```
.bob-data/
```

Die Daten enthalten Zustand, Ereignisse, Audit, Provenance, Snapshots und weitere lokale Stores. Der Ordner ist von Git ausgeschlossen.

