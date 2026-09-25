# Laufzeiten (Runtime)

**Stand:** 2026-09-25

## 1. Auswahl (`lib/runtime-factory.ts`)

| Modus | Auswahl | Reifegrad | Einsatz |
|---|---|---|---|
| `local` | `BOB_SANDBOX_RUNTIME=local` | **VERIFIED** (Tests + Live-Nachweis) | Entwicklungs-/CI-Standard: echte Kindprozesse im Sandbox-Workspace |
| `oci` | `BOB_SANDBOX_RUNTIME=oci` | **UNVERIFIED** (kein Daemon in dieser Umgebung) | gehärtete Container-Isolation |
| `mock` | explizit mit `BOB_ALLOW_MOCK_RUNTIME=1` | MOCK/SIMULATED | deterministische Entwicklung, **nie** Produktionsnachweis |

`activeSandboxRuntime` wählt beim Import; `runtimeHealth()` und
`reconcileActiveRuntime()` machen den Zustand prüfbar. Ein Wechsel des Modus zur
Laufzeit ist nicht vorgesehen (fail closed statt Mischbetrieb).
Wichtig: `runtimeHandle(sandboxId)` liefert **Metadaten**, nicht die Runtime –
Code muss `activeSandboxRuntime` verwenden.

## 2. Lokale Runtime (`lib/runtime-local.ts`)

- Sandbox-Workspace `<BOB_STORAGE_DIR>/sandboxes/<sandboxId>`, Rechte `0700`.
- Start über `spawn(programm, argv, {shell:false})` in eigener Prozessgruppe.
- Reduziertes Environment: nur `PATH`, `HOME` (Workspace), `LANG`, `NODE_ENV`.
- **Timeout** je Ausführung (`min(request, limits)`), Abbruch der gesamten
  Prozessgruppe per `SIGKILL` (`process.kill(-pid, "SIGKILL")`).
- Ergebnis: Exit-Code, stdout/stderr (gekappt), Dauer, Timeout-Flag; jedes
  Ergebnis wird als Evidence/Event festgehalten.
- Snapshots: Manifest mit SHA-256-Digest über alle Dateien plus Einzelhashes
  (`hashFile`), Restore verifiziert zuerst.
- Netzwerk: `DENY` erzwungen; `ALLOWLIST` fail closed.
- Ressourcengrenzen werden validiert (`timeoutMs`, `memoryMb`, `cpuMillicores`,
  `processes` müssen > 0 sein).

## 3. OCI-Runtime (`lib/oci-runtime.ts`) – implementiert, UNVERIFIED

Gehärtete Aufrufform (Docker/Podman):

```
--network none            # kein Netzwerk
--read-only               # Root-Dateisystem schreibgeschützt, tmpfs /tmp (noexec)
--cap-drop ALL            # alle Linux-Capabilities entzogen
--security-opt no-new-privileges
nicht-root Benutzer, kein Shell-Interpreter, argv[] ohne Interpolation
```

Nachweisgrenze: In dieser Umgebung existiert kein Container-Daemon. Die
Härtungsflags sind daher **nicht praktisch verifiziert** und werden im Bericht als
`UNVERIFIED` geführt (keine behauptete Produktionsreife).

## 4. Runtime-Registry (`lib/runtime-registry.ts`)

Registrierte Definitionen (Sprachen/Plattformen, `listRuntimes()`):

| ID | Name | Version | Kind | Build | Test | Paketmanager |
|---|---|---|---|---|---|---|
| `runtime.node` | Node.js | 22 | CONTAINER | `npm run build` | `npm test` | npm |
| `runtime.python` | Python | 3.13 | CONTAINER | – | `pytest` | pip |
| `runtime.container.custom` | Custom OCI Runtime | 1 | CONTAINER | – | – | – |

`registerRuntime()` verweigert doppelte IDs und erlaubt weitere Sprachen/Images
(`platforms`, `architectures`, `buildCommands`, `testCommands`, `networkDefault`).
Alle Definitionen haben `networkDefault: "DENY"`.

**Offen (PARTIAL):** Die Registry ist eine Beschreibung; automatisches
Provisionieren von Toolchains je Sprache ist nicht implementiert. Weitere Sprachen
(z. B. Go, Rust) sind registrierbar, aber nicht vorbelegt.

## 5. Verifikation

- `tests/integration/sandbox-runtime.test.ts` (echte Prozesse, Timeout, Snapshot).
- `scripts/verify-live.sh` Schritt 4: autorisierte Ausführung mit
  `argv:["node","-e","..."]`, `shell:false`, stdout `live-ok`.
- Schritte 5 und 8: Shell-/Metazeichen-Abwehr und Runtime-Lebenszyklus.
- `GET /api/runtime` liefert Modus, Health und Reconcile-Status.
