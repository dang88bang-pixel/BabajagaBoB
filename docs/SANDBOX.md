# Sandbox

**Stand:** 2026-09-25
**Grundsatz:** Jede Ausführung läuft in einer Sandbox, die an Task **und** Agent
gebunden ist. Netzwerk ist standardmäßig `DENY`.

## 1. Lebenszyklus (`lib/sandbox/fabric.ts`)

```
createSandbox → startSandbox → (execute) → snapshotSandbox → restoreSandbox
                     ↘ pauseSandbox → resetSandbox ↗            ↘ destroySandbox
cloneSandbox (Quelle → Ziel, neues Task-/Agent-Binding)
```

| Funktion | Wirkung | Bindung |
|---|---|---|
| `createSandbox({type, taskId, agentId, risk})` | legt Workspace + Runtime an | Task + Agent Pflicht |
| `startSandbox` / `pauseSandbox` / `resetSandbox` | Runtime-Zustand | bestehende Bindung |
| `snapshotSandbox(id, actor)` | Workspace-Snapshot + SHA-256-Digest + Dateihashes | Actor wird auditiert |
| `restoreSandbox(id, snapshotId, actor)` | prüft Digest und Dateihashes, stellt her | Abweichung → Fehler, kein „weiter so" |
| `cloneSandbox(source, target)` | Kopie ohne Rechteübertragung | Ziel braucht eigenes Task-/Agent-Binding |
| `destroySandbox` | entfernt Runtime und Workspace | Audit + Event |
| `assertTaskSandboxBinding(taskId, sandboxId)` | verhindert Fremdbindung | wird im Broker erneut geprüft |

Zustände: `CREATED`, `READY`, `RUNNING`, `PAUSED`, `SNAPSHOTTED`, `RESTORED`,
`DESTROYED`, `FAILED` (`lib/runtime.ts`).

## 2. Umgebungen

`SandboxType` bestimmt die Umgebung (z. B. `development`, `test`, `staging`).
Die Umgebung ist **Teil der Capability-Bindung**: Ein Token mit
`environment: development` darf nicht in einer `test`-Sandbox ausführen
(Broker-DENY „token environment … does not match …"). Der Live-Nachweis liest den
Typ aus der erzeugten Sandbox und stellt die Tokens entsprechend aus.

## 3. Netzwerk

- Default: `network: {mode: "DENY", allowlist: []}`.
- `ALLOWLIST` ist **fail closed**: Ohne kontrollierten Egress-Proxy wird jede
  Ausführung verweigert (`lib/runtime-local.ts`, `lib/execution-broker.ts`).
- Kein Sandbox-Modus erlaubt uneingeschränkten Netzwerkzugriff; die OCI-Runtime
  setzt zusätzlich `--network none` (`lib/oci-runtime.ts`, UNVERIFIED).

## 4. Prozess- und Dateigrenzen

- Start ausschließlich über `argv[]` mit `spawn(..., {shell:false})`
  (`lib/argv-policy.ts`); Shell-Interpreter und Metazeichen sind in **jedem**
  Argument verboten.
- Workspace: `<BOB_STORAGE_DIR>/sandboxes/<sandboxId>` mit Rechten `0700`; die
  Runtime erhält ein reduziertes Environment.
- Timeout mit Prozessgruppen-Kill; Exit-Code, stdout/stderr und Laufzeit werden
  als Ergebnis + Evidence festgehalten.
- App-Module (`lib/apps.ts`) laufen in Fabric-gebundenen Sandboxes, nicht im
  Serverprozess.

## 5. Snapshots

- Snapshot = Manifest mit SHA-256-Digest über alle Dateien plus Einzelhashes.
- `restoreSandbox` verifiziert zuerst das Manifest, dann die Dateien; jede
  Abweichung bricht ab (fail closed) und erzeugt ein Audit-Ereignis.
- Snapshots sind Evidenz: Recovery und Regression verlangen einen Snapshot als
  Vorbedingung (`docs/RECOVERY.md`).

## 6. Verifikation

- `tests/integration/sandbox-runtime.test.ts`: echte lokale Runtime, Bindung,
  Prozessausführung, Snapshot + Digest, Restore-Verifikation, `ALLOWLIST` fail closed.
- `tests/integration/app-module-sandbox.test.ts`: App-Module im Sandbox-Workspace.
- `scripts/verify-live.sh` Schritte 3, 5 und 8: Sandbox erzeugen/starten,
  Snapshot mit Digest, Fremdbindung blockieren (409), Restore, Pause, Destroy.

## 7. Offen

- OCI-Sandbox ist implementiert, aber ohne Daemon in dieser Umgebung
  **UNVERIFIED** (`docs/RUNTIME.md`).
- Windows-/macOS-Isolation ist nicht implementiert (Linux-orientiert).
- Kein seccomp-Profil für die lokale Runtime (Prozess-Isolation statt Kernel-Isolation).
