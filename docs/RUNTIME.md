# Runtime-Fabric — Abschnitt 10

Implementierung: `lib/runtime.ts` (Vertrag), `lib/runtime-local.ts`, `lib/ns-isolation.ts`
(Kernel-Isolation), `lib/oci-runtime.ts`, `lib/runtime-factory.ts`, `lib/runtime-registry.ts`,
`app/api/runtime/route.ts`, `app/api/runtimes/route.ts`, `scripts/ns-exec.sh`,
`scripts/build-ns-rootfs.sh`.

## 1. Vertrag

```ts
interface SandboxRuntime {
  readonly mode: "REAL_LOCAL" | "REAL_OCI" | "MOCK";
  create(spec): Promise<RuntimeHandle>;
  start/pause/reset/clone(sandboxId[, spec]): Promise<RuntimeHandle>;
  snapshot(sandboxId): Promise<RuntimeSnapshot>;
  restore(sandboxId, snapshotId): Promise<RuntimeHandle>;
  destroy(sandboxId): Promise<void>;
  execute(sandboxId, argv, timeoutMs?): Promise<ExecutionResult>;
  observe?(...): RuntimeObservation[];
}
```

`ExecutionResult = {accepted, exitCode, stdout, stderr, timedOut, durationMs, message, evidence?}` —
`evidence` wird ausschließlich vom Execution Broker gesetzt (digestgebundene Evidenz,
siehe `docs/SANDBOX.md` und `lib/artifacts.ts`).

## 2. Modi und Umschaltung

- `BOB_SANDBOX_RUNTIME=local` → `REAL_LOCAL` (Standard in Entwicklung und in der Live-Verifikation).
- `BOB_SANDBOX_RUNTIME=oci` → `REAL_OCI` (Docker, gehärtete Flags — siehe `docs/SANDBOX.md`).
- `BOB_SANDBOX_RUNTIME=mock` → `MOCK`, im Status sichtbar; **keine** Produktionslaufzeit.

Der aktive **Modus** (`REAL_LOCAL`/`REAL_OCI`/`MOCK`) ist davon getrennt die
**Isolationsstufe** der Ausführung. Sie wird gemessen, nie behauptet:

| Isolationsstufe | Bedeutung | Garantien |
| --- | --- | --- |
| `CONTAINER` | OCI-Container (Docker) | Container-Grenze, Rootfs read-only, Netzwerk aus: **in dieser Umgebung `NOT_VERIFIED`** (kein Daemon beschaffbar) |
| `NAMESPACES` | Kernel-Isolation ohne Daemon (`unshare`) | eigene Netzwerk-/PID-/IPC-/UTS-/Mount-/User-Namespace, Rootfs `EROFS`, Workspace als einziger Schreibpfad, `NoNewPrivs=1`, leeres Capability-Bounding-Set |
| `FILESYSTEM_ONLY` | lokale Workspace-Runtime ohne Kernel-Grenze | Prozess kann nur im Workspace schreiben; Netzwerk-DENY ist reine Policy |
| `NONE` | keine Isolation verfügbar | fail closed bei erzwungener Isolation |

`GET /api/runtime` liefert `mode`, `health`, `network`, `isolation`, `observations`,
`summary`. `isolation` enthält `level`, `requested`, `enforced[]`, `capabilities`,
`rootfs`, `detail` und ggf. `reason`. `POST /api/runtime {action:"reconcile"}`
(Creator-only) gleicht Registry und tatsächliche Laufzeit ab; Abweichungen erscheinen
als `ORPHANED` und senken `health` auf `DEGRADED`.

### 2a. Kernel-Isolation `NAMESPACES` (real, ohne Root und ohne Daemon)

`lib/ns-isolation.ts` führt jede lokale Ausführung über `unshare(1)` in eigenen
Namespaces aus; der Payload ist der Wrapper `scripts/ns-exec.sh`, gestartet mit
`exec`-Semantik und **ohne Shell-String** (`argv[]`, `shell: false`):

```
unshare --user --map-root-user --net --pid --ipc --uts --mount --propagation private --fork --kill-child \
  scripts/ns-exec.sh <rootfs> <workspace> <argv…>
```

Innerhalb der Isolation:

- Rootfs read-only (`mount --bind … -o ro`), `/work` als einziger schreibbarer Bind,
- `procfs` im PID-Namespace (nur eigene Prozesse sichtbar), `/dev/{null,zero,random,urandom}` gebunden,
- `setpriv --no-new-privs --bounding-set=-all --inh-caps=-all --ambient-caps=-all` (Capabilities = 0),
- Exit-Codes 125/126 sind **Setup-Fehler**: dann wurde nichts ausgeführt (fail closed),
- Zeitüberschreitung beendet die gesamte Prozessgruppe.

Steuerung (Umgebungsvariablen):

| Variable | Werte | Wirkung |
| --- | --- | --- |
| `BOB_NS_ISOLATION` | `auto` (Standard), `on`, `off` | `on` erzwingt Kernel-Isolation: fehlen die Voraussetzungen, wird die Ausführung **verweigert** statt unisoliert zu laufen. `off` deaktiviert sie ausdrücklich (nur für Diagnose). |
| `BOB_NS_ROOTFS` | Pfad | Wurzeldateisystem der Isolation; Standard `${BOB_STORAGE_DIR}/ns-rootfs`. |

Rootfs bauen (Node + Bibliotheken + BusyBox, ca. 126 MB, ohne Netzwerkzugriff auf
Paketquellen — BusyBox kommt aus der devDependency `busybox-static`):

```bash
bash scripts/build-ns-rootfs.sh /tmp/bob-nsrootfs
BOB_NS_ROOTFS=/tmp/bob-nsrootfs BOB_NS_ISOLATION=on npm start
```

Gemessenes Ergebnis eines isolierten Laufs über die echte HTTP-API
(`scripts/verify-live.sh`, Schritt 11) — Ausgabe aus `/proc/self/status` des
isolierten Prozesses:

```json
{"capBnd":"0000000000000000","capEff":"0000000000000000","noNewPrivs":"1",
 "procs":1,"ifaces":"    lo:","routeLines":0,"ro":"EROFS","rw":"ok"}
```

Belegte Grenzen (ehrlich, nicht „Container"): kein OCI-Image-Format, kein `runc`,
keine cgroup-Quotas (Ressourcenlimits bleiben zeitbasiert), Rootfs wird aus dem
Host-Binärbaum kopiert. Diese Isolationsstufe ist daher `NAMESPACES` und **nicht**
`CONTAINER`; OCI bleibt in dieser Umgebung `NOT_VERIFIED`.

## 3. Runtime-Registry (viele Sprachen/Umgebungen)

`lib/runtime-registry.ts` führt Runtime-Definitionen:

```ts
{id, name, version, kind: CONTAINER|VM|BROWSER|DESKTOP|CUSTOM, platforms[], architectures[],
 buildCommands[], testCommands[], debugger?, packageManager?, sandboxSupport, networkDefault: DENY|ALLOWLIST}
```

Ausgeliefert sind `runtime.node` (Node.js 22), `runtime.python` (Python 3.13) und
`runtime.container.custom` (OCI). Weitere Laufzeiten lassen sich registrieren:
`POST /api/runtimes {action:"register", …}` (`runtime:registry:register`, Creator).
`networkDefault` ist derzeit immer `DENY`; `ALLOWLIST` würde fail closed abgelehnt.

Abgrenzung: Die Registry beschreibt **Laufzeitumgebungen**, die Sandbox-Fabric
instanziiert sie. Eine Registrierung allein startet nichts und erteilt keine Rechte.

## 4. Betriebsgrenzen

- Eine Ausführung, die nicht über den Broker kommt, existiert nicht: die Route
  `/api/runtime` prüft das Gate (Session **oder** Capability-Token) und ruft
  `executeAuthorized` auf.
- Fehlt der Runtime-Handle einer Sandbox im OCI-Modus, verweigert der Worker die
  Ausführung (`sandbox runtime handle is missing`).
- Ressourcenlimits werden vor der Ausführung gegen die Handle-Limits geprüft.

## 5. Tests und Nachweise

- `tests/integration/sandbox-runtime.test.ts` — Adapter-Vertrag, Lifecycle, Fehlerpfade.
- `tests/integration/execution-evidence.test.ts` — Ausführung erzeugt Evidenz.
- `tests/integration/load-broker.test.ts` — 12 parallele autorisierte Ausführungen,
  Bindungen bleiben intakt; 6 fremde Sandbox-Bindungen werden verweigert.
- `tests/integration/ns-isolation.test.ts` — 7 Tests der Kernel-Isolation: Bericht und
  Garantien, Prozess-Probe (Capabilities/`NoNewPrivs`/`EROFS`/RW/`procs<5`),
  Netzwerk-Namespace, argv-Canary (keine Shell-Interpretation), Timeout der
  Prozessgruppe, verschwundener Rootfs (Bericht darf `NAMESPACES` nicht behaupten),
  fail closed bei erzwungener Isolation.
- `scripts/verify-live.sh` — Runtime-Status inkl. Isolationsbericht, Ausführung mit
  Capability-Token, Replay-Verweigerung, Denials; Schritt 11 misst die Isolation
  über die HTTP-API (Capabilities, `NoNewPrivs`, `EROFS`, Loopback, Routingtabelle).
