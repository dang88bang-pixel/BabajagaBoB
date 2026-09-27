# Offline-Betrieb (Offline Fabric)

Phase 4 / 7.4 — MASTER_COMPLETION_SPEC §36 „Offline First" (OFF-001).

Ziel: Das System kann ohne Internet arbeitsfähig bleiben. Lokaler Bestand
(Pakete, Modelle, Wissen, Doku, Datasets, Images, Toolchains, Git) wird
geführt, als Task-Paket gebündelt und in netzlosen Sandboxes ausgeführt;
nach Wiederkehr folgt ein herkunftstreuer Abgleich.

## Flow (gemäß §36)

```
Task Package → Offline Execution (ohne Netz) → Artifacts → Logs → Evidence → Sync → Provenance Merge
```

1. **Bestand** — `registerOfflineAsset`: Kategorien PACKAGE / MODEL / KNOWLEDGE /
   DOCS / DATASET / IMAGE / TOOLCHAIN / GIT. Jede Erfassung trägt Digest (sha256),
   Größe, Quelle und Erfasser.
   - Idempotenz: gleiche Referenz (Kategorie/Name/Version) + gleicher Digest → unverändert.
   - Änderung: abweichender Digest überschreibt nie still — der alte Eintrag bleibt
     als `SUPERSEDED` mit `previousDigest`-Linie bestehen.
   - Inhalte werden bis 1 MiB (`BOB_OFFLINE_MAX_CONTENT_BYTES`) im Bestandsspeicher
     gehalten (`contentStored`); darüber bleibt der Eintrag eine ehrliche
     Metadaten-Referenz (Digest, Quelle, Größe).
2. **Task-Paket** — `createOfflinePackage`: bündelt verfügbare Bestandseinträge zu
   einem Task; Manifest-Digest über Paketinhalt. Ohne verfügbare Einträge: fail closed.
3. **Offline-Ausführung** — `executeOfflinePackage`: nur in Sandbox mit
   `network: DENY`, nur über den autorisierten Systempfad
   (`executeSystemAuthorized`, Zweck `OFFLINE_PACKAGE`, Capability `offline:execute`
   über die CREATOR → SYSTEM-WORKER-Delegation). Ergebnis: stdout/stderr-Limit,
   Exit-Code, Zeitstempel und Evidenz-Eintrag über den Broker.
4. **Sync nach Wiederkehr** — `planOfflineSync` vergleicht ein Remote-Manifest
   gegen den lokalen Bestand:
   - `UNCHANGED` — Referenz+Digest identisch
   - `IMPORT_PENDING` — Referenz fehlt lokal (Digest muss später beim Import bestätigt werden)
   - `CONFLICT` — Digest weicht ab (ohne Entscheidung kein Import)
   - `LOCAL_ONLY` — lokal vorhanden, remote fehlt (bleibt, wird nie gelöscht)
5. **Konfliktentscheidung** — `resolveOfflineConflict`: ausdrücklich und auditiert
   (`ACCEPT_REMOTE` / `KEEP_LOCAL`). Einmal entschieden, nicht erneut entscheidbar.
6. **Import** — `importRemoteAsset`: fail closed, wenn der gelieferte Inhalt den
   Manifest-Digest nicht erfüllt (Herkunftstreue, Sabotage-Schutz).
7. **Herkunfts-Merge** — Provenance-Knoten je Eintrag/Paket/Lauf/Sync; Kanten
   `DERIVED_FROM` (Bestand → Paket), `PRODUCED` (Paket → Evidenz), `TESTED_BY`
   (Sync → Bestand), bei Konflikten zusätzlich `CONTRADICTED_BY`.

## API

`GET /api/offline` — `offline:read` (assets, packages, runs, syncs, summary).
`POST /api/offline` — creatorOnly (`offline:manage`): register-asset,
create-package, execute, sync, resolve-conflict, import-remote.
Alle Aktionen werden auditiert (`offline:asset:register`, `offline:package:create`,
`offline:execute`, `offline:sync:plan`, `offline:sync:conflict:resolve`,
`offline:import:remote`, `system:action`); Rate-Limit `creator`.

## Ehrliche Grenzen

- Ausführung gegen echte Mirror/Repositories oder große Modellgewichte ist in
  dieser Umgebung nicht möglich (kein Netz); der Bestand führt Inhalte bis zur
  1-MiB-Grenze selbst, darüber Digest-/Quell-Referenzen.
- Offline-Ausführung setzt einen Sandbox-Runtime mit DENY-Netz voraus
  (Namespaces oder OCI `network: none`); `ALLOWLIST`/`FULL` werden abgelehnt —
  „offline" bedeutet hier wirklich kein Netz, nicht „anderes Netz".
- Sync ist planbar/entscheidbar; der eigentliche Transport (Netz nach
  Wiederkehr) liegt außerhalb des Systems und wird durch Manifest+Inhalt
  nachgewiesen, nicht simuliert.

## Tests / Nachweis

- Unit: `tests/unit/offline-fabric.test.ts` (Bestand, Idempotenz, Linie,
  Speichergrenze, Paket fail closed, Sync-Entscheidungen, Konflikt, Import-Digest).
- Integration: `tests/integration/offline-fabric.test.ts` (Bestand → Paket →
  DENY-Sandbox → autorisierte Ausführung → Evidenz → Provenance → Audit; Ablehnung
  außerhalb DENY; Sync mit Konflikt + manipuliertem Import).
- Sabotage-Probe: `OFFLINE_DIGEST_IGNORED` (Manipulation der Import-Digest-Prüfung
  muss erkannt werden).
