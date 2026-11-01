# Deep Verification — 2026-11-01

**Branch:** `arena/f9c14737-babajagabob`
**Umgebung:** Node 22.22.3, Vitest 3.2.7, Next 16.3.6; kein Docker-Daemon, keine
cgroup-Delegation (`/sys/fs/cgroup` nicht beschreibbar), Kernel-Namespaces
verfügbar (`unshare -Ur` aktiv, Rootfs 126 MB gebaut).

## 1. Ausgangsbefund (vor Änderungen)

Der Testlauf auf dem Stand von `main` war **nicht** grün — entgegen der
Dokumentation:

| Befund | Ursache |
|---|---|
| `tests/integration/computer-broker.test.ts` (2 Tests) rot | rief `broker.executeComputerAuthorized` auf — **die Funktion existierte nicht**; zusätzlich fehlten Bootstrap, Task und Sandbox, und die verlangte Fähigkeit `computer:execute` war nirgends delegiert. Der Test beschrieb einen fehlenden Pfad, statt ihn nachzuweisen. |
| `tests/unit/acceptance-matrix.test.ts` rot | Der Abnahmeprüfer prüfte den Nachweis `npm run test:oci` gegen das **Dateisystem**. Ein npm-Skript kann dort nie existieren — der Prüfer war falsch, nicht die Anforderung. |
| `tests/integration/oci-runtime.test.ts` rot | kein Docker-Daemon in der Umgebung (bewusst `UNVERIFIED`), der Test scheiterte jedoch, statt sich zu überspringen. |
| `tests/integration/graceful-shutdown.test.ts` rot | Produktionsbuild fehlte vor dem Prozesstest (in CI vorhanden, lokal nicht). |

## 2. Änderungen

1. **Computer Use über den Broker** (`lib/execution-broker.ts`, `lib/computer-use.ts`,
   `app/api/computer-use/route.ts`): gemeinsame Autorisierung für Prozess- und
   Computer-Läufe (`authorizeExecution`), Fähigkeit `computer:execute`, Bindung an
   Instanz/Task/Sandbox **vor** dem Tokenverbrauch, Treibervertrag (Node-Modul,
   `argv[]`, `shell:false`, reduzierter Env, Timeout mit Prozessgruppen-Kill,
   Ausgabegrenze), Evidenz `COMPUTER_USE`, `AVAILABLE`/`FAILED` als Endzustand,
   fail closed ohne `BOB_COMPUTER_DRIVER`.
2. **Delegation** (`lib/bootstrap.ts`): Bootstrap-Kante `CREATOR → SYSTEM-WORKER`
   trägt `computer:execute`; `ensureExecutionCapability` akzeptiert Zusatzfähigkeiten
   nur aus einer **geschlossenen** Liste (`EXECUTION_EXTRA_CAPABILITIES`), ohne
   Platzhalter.
3. **Test** (`tests/integration/computer-broker.test.ts`) neu geschrieben: sechs
   Fälle (Erfolg mit Evidenz und genau einem verbrauchten Token, Fremdaufgabe,
   fehlende Fähigkeit, nicht gedeckte Aktion, fehlender Treiber, Shell als Treiber).
4. **Abnahmeprüfer** (`scripts/acceptance.mjs`): Skript-Nachweise werden gegen
   `package.json` (npm-Skripte) **oder** das Dateisystem geprüft — strenger als vorher.
5. **OCI-Test** überspringt sich ohne Daemon mit Begründung (`ctx.skip`), zählt also
   nie als bestanden.
6. **Sabotageprobe** `BROKER_TOKEN_VALIDATION_SKIPPED`: Anker an die umstrukturierte
   Zeile angepasst; `--check` → 25/25 Anker gültig.
7. **Abnahmematrix**: `CU-001` verschärft (Implementierung, sechs Tests) und
   `CU-002` (Ausführung über Gate/Broker) ergänzt; beide bleiben `PARTIAL`, weil ein
   echter Browser-/Desktop-Treiber fehlt.

## 2a. Live-Nachweis des neuen Pfads (HTTP, Instanz `:3200`)

Gegen eine **zweite** Instanz mit `BOB_COMPUTER_DRIVER=/tmp/bob-cu/driver.mjs`
(ausdrücklich ein **Vertrags-Testtreiber**, kein Browser; er antwortet mit dem
erhaltenen Auftrag und beendet sich mit Exit 0 — im Repository ist **kein**
Treiber enthalten):

| Schritt | Antwort |
|---|---|
| Bootstrap + Login | `201`, Sitzung |
| Mission → Objective → Task → Sandbox → `start` | `201` / `200`, Sandbox `RUNNING`, Netz `DENY` |
| Computer `register` → `authorize` → `allocate` | `201`, `authorized: true`, `ALLOCATED` |
| Capability mit `computer:execute` | `CAP-…` |
| `POST /api/computer-use {action:"execute", SCREENSHOT}` | `status: SUCCEEDED`, Evidenz `ART-6729d398…`, Digest `c0a354a0…`, `accepted: true` |
| `GET /api/artifacts?verify=ART-…` | `ok: true`, `kind: COMPUTER_USE` |
| zweiter Lauf mit demselben Token | `409 EXECUTION_DENIED` / `TOKEN_VALIDATION` („token exhausted (1/1 uses); replay is refused") |
| Aktion `TERMINAL_EXECUTE` (nicht gedeckt) | `409 COMPUTER_BINDING`, Token danach `uses: 0` |

## 3. Belege (alle selbst ausgeführt)

| Prüfung | Ergebnis |
|---|---|
| `npx vitest run` | 66 Dateien, **430 grün, 1 übersprungen**, 0 rot |
| `npm run lint` | 0 Fehler, 12 Warnungen |
| `npx tsc --noEmit` | fehlerfrei |
| `npm run build` | erfolgreich (BUILD_ID, alle 71 API-Routen) |
| `node scripts/acceptance.mjs` | 15 / 0 |
| `node scripts/sabotage.mjs --check` | 25 / 25 Anker gültig |
| `node scripts/sabotage.mjs` (volle Proben, mutierend) | **25 erkannt, 0 nicht erkannt**, 17 Dateien nach sha256 unverändert |
| `scripts/verify-live.sh` (`:3100`, NS-Isolation gemessen) | **171 / 0** |
| `scripts/audit-actions.mjs` | **544 / 0** |
| `scripts/audit-api.sh` | **251 / 0** |
| `scripts/audit-ui.mjs` | **93 / 0** (48 Datenabrufe, 29 Abschnitte mit echten Zeilen) |
| `node scripts/acceptance.mjs --live` | **86 / 0**, 70/70 Routen-Nachweise mit Sitzung |

Live-Konfiguration: `BOB_STORAGE_DIR=/tmp/bob-live` (frisch), `BOB_NS_ISOLATION=on`,
`BOB_NS_ROOTFS` aus `scripts/build-ns-rootfs.sh`, `BOB_SESSION_SECRET` (≥ 32 Zeichen),
`BOB_DEVICE_ENROLLMENT_SECRET`, `BOB_BOOTSTRAP_SECRET`, `BOB_CREATOR_LOGIN_SECRET`,
`NODE_ENV=production`, `node server.mjs`. cgroup-Limits sind in dieser Umgebung **nicht**
durchsetzbar (kein delegierter Unterbaum); das wird ausgewiesen, nicht behauptet.

## 4. Betriebsbeobachtungen (nicht abgeschwächt, sondern dokumentiert)

- `BOB_SESSION_SECRET` wird in Produktion **zwingend** verlangt (fail closed, `< 32`
  Zeichen genügt nicht). Ohne Secret antwortet jede Route mit 500 — der Start bleibt
  erlaubt. Eine Prüfung beim Start wäre strenger; das ist offen (siehe unten).
- Ohne `BOB_DEVICE_ENROLLMENT_SECRET` antworten `/api/devices {action:"enroll"|"heartbeat"}`
  mit **503** (fail closed). Der Aktionsprüfer zählt das als Fehlschlag, wenn die Variable
  fehlt — die Läufe oben wurden mit gesetztem Secret gefahren.
- Ohne `BOB_RATE_LIMIT_MAX` greift das Standardbudget (120 Anfragen/Minute). Die
  Funktionsprüfer brauchen mehr; die Grenze selbst wird getrennt mit
  `scripts/verify-rate-limit.sh` gegen eine **frische** Instanz mit Standardbudget
  nachgewiesen (in dieser Runde nicht gefahren).

## 5. Offen (unverändert ehrlich)

1. **Echter Computer-Treiber** (Playwright/VNC/Desktop-Eingabe): `NOT_IMPLEMENTED` —
   die Umgebung hat keinen Browser. Der Pfad ist gebaut, getestet und fail closed.
2. **OCI-Runtime**: `UNVERIFIED` — kein Daemon; der Test überspringt sich mit Grund.
3. **cgroup-Limits**: nicht delegierbar in dieser Umgebung → `UNAVAILABLE`, gemeldet.
4. **Dauerlauf/SLO-Zusage**, externer Scheduler für Backups, Netz-Scan/Attestierung
   der Geräte: unverändert offen.
5. **Startprüfung für `BOB_SESSION_SECRET`**: Der Dienst startet ohne Secret und
   verweigert dann jede Anfrage mit 500. Fail closed, aber spät — eine Startprüfung
   wäre besser und ist als Punkt notiert.
