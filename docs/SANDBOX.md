# Sandbox-Fabric — Abschnitt 11

Implementierung: `lib/sandbox/fabric.ts`, `lib/runtime-local.ts`, `lib/oci-runtime.ts`,
`lib/argv-policy.ts`, Routen `app/api/sandboxes/route.ts` und `app/api/runtime/route.ts`.

## 1. Lebenszyklus

```
CREATE → CLONE → RESET → START → RUN → PAUSE → SNAPSHOT → RESTORE → DESTROY
```

`SandboxLifecycle = CREATED | RUNNING | PAUSED | SNAPSHOTTED | RESTORED | DESTROYED | FAILED`
(`lib/types.ts`). Jede Sandbox ist an **genau eine** Task und **einen** Agenten
gebunden (`taskId`, `agentId`); der Broker verweigert Ausführungen mit
abweichender Bindung (`SANDBOX_TASK_BINDING`, `SANDBOX_AGENT_BINDING`).

Sandbox-Typen: `development`, `experiment`, `test`, `browser`, `security`,
`migration`, `staging`, `recovery`, `diagnostic`.

## 2. Grenzen (fail closed)

| Grenze | Umsetzung |
|---|---|
| Netzwerk | Default `DENY`. `ALLOWLIST` ist **fail closed**: `NETWORK_POLICY`-Denial, solange keine kontrollierte Egress-Schicht existiert. Klassifikation `NOT_IMPLEMENTED`. |
| Shell | `argv[]` + `shell: false`; `isShellInterpreter` und `firstMetacharacterArg` verweigern Shell-Programme und Metazeichen (`SHELL_PROGRAM`, `SHELL_METACHAR`). |
| Ressourcen | `ResourceLimits` (CPU, RAM, Storage, Timeout, Prozesse) mit Obergrenzen im Broker (`RESOURCE_LIMITS`). |
| Workspace | Eigener Workspace je Sandbox unter `<BOB_STORAGE_DIR>/sandboxes/<sandboxId>`; Logs und Artefakte bleiben darin. |
| Umgebung | `environment` stammt aus dem Sandbox-Typ (nicht aus dem Request-Default); Token-Umgebung muss passen (`ENVIRONMENT`). |
| IDs | Snapshot-IDs sind eigenständig und **nie** als Artifact bezeichnet (Snapshot ≠ Artifact). |
| Kernel-Isolation | Mit gebautem Rootfs läuft jede lokale Ausführung in `NAMESPACES` (`lib/ns-isolation.ts`): eigene Netzwerk-/PID-/IPC-/UTS-/Mount-/User-Namespace, Rootfs `EROFS`, nur `/work` schreibbar, `NoNewPrivs=1`, Capabilities leer. Gemessen: CapBnd/CapEff `0000000000000000`, 1 sichtbarer Prozess, nur `lo`, leere Routingtabelle. Details: `docs/RUNTIME.md` §2a. |
| Isolation erzwungen | `BOB_NS_ISOLATION=on` ⇒ ohne verfügbare Kernel-Isolation wird die Ausführung verweigert (`409`, „kernel isolation is enforced … but unavailable"), **nichts** läuft unisoliert. |

## 2a. Ressourcenlimits setzen und durchsetzen

Limits werden bei der Erstellung an die Sandbox gebunden (`POST /api/sandboxes {action:"create", limits:{…}}`,
Creator-only) und gegen dieselben Obergrenzen geprüft wie im Broker (`MAX_RESOURCE_LIMITS`); ungültige
Werte werden mit 400 abgewiesen statt still auf Vorgaben zurückzufallen. Durchgesetzt werden sie
kernel-seitig, soweit die Umgebung das erlaubt: CPU-Zeit (`RLIMIT_CPU`) und Dateigröße (`RLIMIT_FSIZE`)
immer, Speicher (`memory.max`) und Prozesse (`pids.max`) über einen delegierten cgroup-v2-Unterbaum
(`BOB_CGROUP_DIR`). Ohne Delegation meldet `GET /api/runtime` für cgroup `UNAVAILABLE` — es wird nichts
behauptet, was nicht greift. Details und Setup: `docs/RUNTIME.md` §2b.

## 3. Snapshot und Restore (echt, nicht simuliert)

- `snapshotSandbox(sandboxId)` erzeugt ein Snapshot-Manifest mit SHA-256-Digest über
  den erfassten Workspace-Zustand (Dateiliste + Inhaltsdigests), Größe und Pfad
  unter `<BOB_STORAGE_DIR>/snapshots/<SNP-…>.json`.
- `restoreSandbox(sandboxId, snapshotId)` prüft zuerst die Existenz des Manifests und
  den Digest, bevor der Workspace wiederhergestellt wird.
- `verifySandboxState` (`lib/verification.ts`) prüft den Zustand unabhängig nach:
  Dateien, Digest, Laufzeit-Handle. Ein abweichender Digest ist ein Fehler, kein Warnhinweis.
- Snapshots sind unveränderlich abgelegt; sie werden nicht überschrieben, sondern neu erzeugt.

## 4. Runtime-Adapter

| Modus | Datei | Klassifikation |
|---|---|---|
| `local` | `lib/runtime-local.ts`, `lib/ns-isolation.ts` | **REAL_LOCAL**: eigener Prozess je Ausführung, `spawn(..., {shell:false})`, Timeout → `SIGKILL` der Prozessgruppe, reduzierte Umgebung, Ausgabe erfasst. Isolationsstufe `NAMESPACES` (Kernel-Namespaces + Rootfs read-only), sobald ein Rootfs vorhanden ist; sonst `FILESYSTEM_ONLY`. Kein OCI-Image, kein `runc`; Ressourcenlimits kernel-seitig: `RLIMIT_CPU`/`RLIMIT_FSIZE` immer, Speicher/Prozesse über einen delegierten cgroup-Unterbaum (`BOB_CGROUP_DIR`, sonst als `UNAVAILABLE` ausgewiesen). |
| `oci` | `lib/oci-runtime.ts` | **REAL_OCI**: Docker-Adapter mit gehärteten Flags (u. a. `--network none`, `--read-only`, `--cap-drop ALL`, `--security-opt no-new-privileges`, `--pids-limit`, Speicher-/CPU-Limits, `--user`). Benötigt eine vorhandene Docker-Umgebung; sonst fail closed (`UNVERIFIED` in dieser Umgebung). |
| `mock` | `MockSandboxRuntime` | **MOCK**: nur für Entwicklung/Tests. Nie Produktionslaufzeit. Wird im Status als `mock` ausgewiesen. |

Der aktive Modus kommt aus `BOB_SANDBOX_RUNTIME` (`lib/runtime-factory.ts`) und wird
über `GET /api/runtime` veröffentlicht — zusammen mit der **gemessenen** Isolationsstufe
(`isolation.level`: `CONTAINER` | `NAMESPACES` | `FILESYSTEM_ONLY` | `NONE`), den erzwungenen
Garantien (`isolation.enforced[]`) und einer Begründung. `POST /api/runtime {action:"reconcile"}`
(Creator) gleicht Registrierung und Laufzeit ab und meldet `ORPHANED`-Sandboxes.

## 5. Diagnose-Sandboxen

Der Fehlerpfad (`lib/error-intelligence.ts`) legt bei Bedarf eine
`diagnostic`-Sandbox an, um Fehler nachzustellen, ohne die betroffene Sandbox zu
verändern. Auch dort gelten Netzwerk-DENY, argv-Policy und Limits.

## 6. Tests

- `tests/integration/sandbox-runtime.test.ts` — Lifecycle, Snapshot/Restore, Digest-Prüfung.
- `tests/integration/app-module-sandbox.test.ts` — Sandbox-Ausführung für App-Module.
- `tests/security/argv-policy.test.ts` — Shell-Strings, Metazeichen, Länge.
- `tests/integration/execution-evidence.test.ts` — Evidenz je Ausführung.
- `tests/integration/ns-isolation.test.ts` — 7 Tests der Kernel-Isolation (Prozess-Probe,
  Netzwerk-Namespace, argv-Canary, Timeout, verschwundener Rootfs, fail closed).
- `scripts/verify-live.sh` — Snapshot/Restore, Sandbox-Ausführung, Verweigerungen und
  gemessene Isolation über HTTP (Schritt 11).
