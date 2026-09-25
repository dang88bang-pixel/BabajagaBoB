# Runtime-Fabric — Abschnitt 10

Implementierung: `lib/runtime.ts` (Vertrag), `lib/runtime-local.ts`, `lib/oci-runtime.ts`,
`lib/runtime-factory.ts`, `lib/runtime-registry.ts`, `app/api/runtime/route.ts`,
`app/api/runtimes/route.ts`.

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

Der aktive Modus ist über `GET /api/runtime` sichtbar (`mode`, `health`, `network`,
`observations`, `summary`). `POST /api/runtime {action:"reconcile"}` (Creator-only)
gleicht Registry und tatsächliche Laufzeit ab; Abweichungen erscheinen als
`ORPHANED` und senken `health` auf `DEGRADED`.

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
- `scripts/verify-live.sh` — Runtime-Status, Ausführung mit Capability-Token, Denials.
