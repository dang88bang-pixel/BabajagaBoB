# Offline Fabric

## Zweck

Die Offline Fabric ermöglicht Arbeiten ohne Internet mit lokal registrierten Assets, gebundenen Task-Paketen, netzwerkfreiem Ausführungsstatus und einem späteren, herkunftstreuen Abgleich.

## Architektur

```
Lokales Asset
    ↓ SHA-256
Offline Task Package
    ↓ network=DENY
Offline Execution
    ↓
Artifact / Evidence / Log Digest
    ↓
Sync Record
    ↓
Merge
    ├── identischer Digest → Duplikat
    ├── neuer Datensatz → übernehmen
    └── anderer Digest → Konflikt, PRESERVE_BOTH
```

### Assets

Unterstützte Klassen:

- PACKAGE
- MODEL
- DOCUMENT
- KNOWLEDGE
- RUNTIME
- DATA

Ein registriertes lokales Asset benötigt einen SHA-256-Digest. Bei einem lokalen Pfad wird der Digest serverseitig aus einer Datei innerhalb von `BOB_STORAGE_DIR` berechnet. Es werden keine externen Quellen benötigt.

### Task-Pakete

Ein Paket enthält:

- Task-ID
- Herkunft
- Asset-Referenzen
- Task-Daten
- SHA-256-Digest
- explizit `network: DENY`

Damit kann ein Worker ein vorbereitetes Paket ohne Internet übernehmen.

### Offline-Ausführung

Die Ausführung wird als eigener persistenter Run erfasst. Artefakte, Evidenzen und Logs werden über IDs bzw. Digest referenziert. Ein fehlender externer Provider ist kein stiller Ersatz durch eine Online-Verbindung.

Die aktuelle Fabric bildet den Offline-Ausführungs-/Provenance-Pfad ab. Die eigentliche fachliche Codeausführung bleibt weiterhin an die vorhandene Execution-Broker-/Runtime-Schicht gebunden.

### Sync und Provenance

Sync Records tragen:

- Herkunft
- Entity-ID
- Digest
- Exportzeit
- Lineage

Beim Merge gilt:

- gleicher Entity-ID + gleicher Digest → Duplikat
- unbekannte Entity-ID → neuer Datensatz
- gleicher Entity-ID + anderer Digest → Konflikt

Konflikte werden **nicht überschrieben**. Beide Zustände bleiben als Herkunftsnachweis erhalten.

## Sicherheitsgrenzen

- Default-Netzwerk: DENY
- keine implizite externe Verbindung
- Asset-Pfade müssen innerhalb von `BOB_STORAGE_DIR` liegen
- Digest-Prüfung vor Aufnahme
- persistenter Store mit SHA-256-Integrität und atomarem Schreiben
- Sync-Merge erzeugt keine neue Autorität
- Offline Fabric ersetzt weder Approval noch Execution Gate

## API

- `GET /api/offline` — Status, Assets, Pakete, Runs und Konflikte
- `POST /api/offline` mit `action=register-asset`
- `POST /api/offline` mit `action=create-package`
- `POST /api/offline` mit `action=start`
- `POST /api/offline` mit `action=finish`
- `POST /api/offline` mit `action=export`
- `POST /api/offline` mit `action=merge`

Alle API-Zugriffe laufen durch den bestehenden Control-Plane-Gate; Mutationen sind Creator-gebunden.

## Tests

`tests/integration/offline.test.ts` prüft:

1. Paketbildung und Offline-Ausführung ohne Netzwerk.
2. Herkunftstreuen Sync mit Duplikaterkennung und Konfliktbewahrung.
