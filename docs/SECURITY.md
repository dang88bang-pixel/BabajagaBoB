# Sicherheitsmodell

**Stand:** 2026-09-25
**Grundsatz:** Alles ist standardmäßig verboten (fail closed). Jede Ausführung ist autorisiert, gebunden,
auditiert und auf eine isolierte Runtime beschränkt.

## Persistente Daten: Manipulation und leere Envelopes

Store-Dateien liegen als Envelope (`store`, `version`, `writtenAt`, `payload`, `digest`)
mit SHA-256 über Store-Namen, Version und Inhalt. Daraus folgen drei Schutzregeln:

1. **Kein leerer Inhalt.** `write(null|undefined)` wird verweigert. Ein Envelope mit
   `payload: null` hätte einen gültigen Digest, wäre also unsichtbar beschädigt — genau
   dieser Zustand brach in einer Live-Prüfung `/api/inbox` mit HTTP 500. Beim Lesen wird
   er erkannt, die Datei als `<datei>.null-payload` gesichert, die Reparatur im
   `migrations.jsonl` vermerkt und der Initialzustand des Moduls geschrieben
   (`POST /api/persistence {action:"repair"}` saniert alle Stores und auditiert).
2. **Bindung an den Store-Namen.** Eine unter fremdem Namen abgelegte Datei wird
   verweigert (Digest deckt den Namen ab). Ältere Envelopes ohne Namen bleiben lesbar,
   damit Bestandsinstallationen nicht aussperren.
3. **Fail closed bei Unklarheit.** Ein Digest-Fehler, eine neuere Version oder eine
   fehlende Migrationskette brechen den Lesezugriff ab, statt Daten zu raten.

Evidenz (`ART-…`) wird serverseitig aus dem kanonischen Inhalt gehasht; ein vom Aufrufer
gelieferter Digest wird nicht akzeptiert. `verifyArtifact` meldet einen beschädigten
Store als **Befund** (`ok:false` plus Fehlertext) und bricht den Aufrufer nicht ab, damit
die Oberfläche den Schaden anzeigen kann, statt eine Ausnahme zu produzieren.

## 1. Durchsetzungskette

```
Intent → Policy → Authorization → Execution Gate → Broker → Isolierte Runtime → Evidence
```

Verboten und im Code nicht vorhanden ist der Pfad `Agent → beliebiges Tool → System`. Ein Agent kann weder
Rechte erzeugen noch den Broker umgehen.

## 2. Autorisierung (`lib/authority.ts`, `lib/governance.ts`, `lib/bootstrap.ts`)

- **Keine Selbstvergabe:** `issueCapabilityToken` verweigert `issuedBy === subject` bzw. `issuedByKind: "AGENT"`.
- **Keine Wildcards:** Capability-Listen dürfen `*` nicht enthalten.
- **TTL-Grenzen:** CREATOR ≤ 15 Minuten, Agenten-Token ≤ 5 Minuten.
- **Bindung:** Jedes Token ist an Subjekt, Task, Sandbox, Umgebung und Risiko gebunden; Abweichungen →
  `TOKEN_*`-DENY im Broker.
- **Keine Rechteausweitung:** Agenten können keine Capability ausstellen, die ihr eigenes Risiko-Limit
  (`maxRisk`) übersteigt; Risk-Eskalation ist ein Fehler, kein stiller Erfolg.
- **Bootstrap:** einmaliger Creator-Bootstrap über Secret; danach ist `requireInitialized()` Pflicht und ein
  zweiter Bootstrap schlägt fehl. Root-Widerruf führt zu `423` (fail closed).
- **Governance:** Kill Switches für System/Agent/Task/Sandbox/Experiment; Freigabe ausschließlich durch
  CREATOR. Jede Delegation ist persistent und prüfbar.

## 3. Server-Authentifizierung (`lib/session.ts`, `lib/api/guard.ts`)

- **428** vor dem Bootstrap, **401** ohne Authentifizierung, **403** bei fehlender Rolle/CSRF.
- Zwei Wege: serverseitig ausgestellte Creator-Session (`bob_session`, HttpOnly) oder Agent-Capability-Token
  (`Authorization: Bobcap <tokenId>.<secret>`), jeweils mit Secret-Prüfung.
- **CSRF:** `POST`/`PUT` mit `Origin`-Host ≠ `Host`-Header wird abgelehnt. Clients ohne `Origin`-Header
  (Server-zu-Server) passieren die Origin-Prüfung bewusst; Browser senden `Origin` immer.
- **Legacy-Token:** `BOB_CONTROL_PLANE_TOKEN` ist nur bei ausdrücklicher Freigabe
  (`BOB_ALLOW_LEGACY_CONTROL_TOKEN=1`) aktiv und authentifiziert dann als `ADMIN` – **nie** als Creator/OWNER.
  Standard ist deaktiviert.
- **Keine Secrets im Browser:** Creator-/Root-Tokens, Provider-Secrets, Geräte-Credentials und Runtime-Secrets
  werden nie an das Control Center ausgeliefert; Authentifizierung ist serverseitig.
- **API-Grenze geschlossen:** `middleware.ts` (Node-Runtime) prüft jede `/api/*`-Anfrage über
  `lib/api/api-gate.ts` mit `requireSession`. Ohne Session → **401**, vor dem Bootstrap → **428**,
  Cross-Origin-Mutation → **403**. Einzige Ausnahme ist `/api/auth` (Bootstrap/Status/Renew/Logout).
  Agent-Capability-Token und Legacy-Token werden an dieser Grenze bewusst **nicht** akzeptiert.
- **Live verifiziert (2026-09-25):** `GET /api/control` ohne Session → 428, `POST /api/auth`
  (Bootstrap) → 201 + HttpOnly-Cookie, danach `GET /api/control` → 200, `POST /api/control` mit
  fremdem `Origin` → 403. Kompletter Nachweis: `scripts/verify-live.sh` (101 Prüfungen, 0 Fehler;
  Ergebnis in `docs/TESTING.md`).
- **Creator-Login (Re-Authentifizierung):** Nach Verlust des Cookies meldet sich der Creator mit dem
  server-seitigen Secret an (`<BOB_STORAGE_DIR>/creator-token` 0600 oder `BOB_CREATOR_LOGIN_SECRET`).
  Konstantzeit-Vergleich, Sperre nach fünf Fehlversuchen (423, 15 Minuten), jeder Versuch auditiert; das
  Secret verlässt den Server nie. Details: `docs/BOOTSTRAP.md` §3a.
- **Aktionsspezifische Autorisierung pro Route:** Über die Authentifizierungsgrenze hinaus prüft **jede**
  Route außer `/api/auth` ihre konkrete Aktion (`guardRequest`/`guardOrDeny`) – Missions/Objectives/Tasks,
  Sandbox-Lebenszyklus, Governance/Approval/Lockdown und Provider-Verwaltung sind Creator-Aktionen;
  `POST /api/runtime` verlangt eine `sandbox:run`-Capability (plus 17 Broker-Prüfungen);
  `POST /api/tasks {action:"status"}` verlangt `task:execute`; Runs verlangen `run:manage`.
  **Provenance- und Knowledge-Schreibzugriffe sind Creator-Aktionen** (`CREATOR_ONLY`), damit Evidenz und
  Wissen nicht von Agenten erzeugt oder verändert werden können – die Lesepfade genügen einer Session
  bzw. einer Lese-Capability.
  Regressionstests: `tests/security/route-guards.test.ts` (428/401/403 `CREATOR_ONLY`, `CAPABILITY_DENIED`,
  CSRF, Audit-Integrität).
- **Strukturell abgesichert:** `tests/security/api-route-contract.test.ts` erzwingt, dass jede Route außer
  `/api/auth` **je exportierter Methode** eine konkrete Aktion prüft und keine Route `publicAction` setzt –
  eine neue Route ohne Aktionsprüfung lässt den Test fehlschlagen (Regression statt Lücke). Die Prüfung
  läuft **rekursiv** und erfasst damit auch verschachtelte Routen; genau das hat zwei bestehende Lücken
  aufgedeckt und behoben:
  - `app/api/approvals/center` (GET/POST) hatte keine eigene Aktionsprüfung → jetzt `approval:read` /
    `approval:write`; die Capability-Pflicht (`approval:resolve` mit Token) bleibt zusätzlich bestehen.
  - `app/api/workshop/execute` (GET/POST) war ungeschützt und nahm einen rohen JSON-Body an → jetzt
    `workshop:read` bzw. `workshop:execute` mit Agent-Capability `workshop:step`, Nutzdaten über
    `readJson`/`field`-Prüfungen und `actionField` (nur die acht bekannten Werkstattschritte).
  Beide Routen waren durch die Middleware (Session-Pflicht) nicht offen für anonyme Aufrufe, aber sie
  prüften ihre Aktion nicht selbst — der Vertrag verlangt beides.
- **Betriebsdaten sind geschlossen:** `/api/metrics` verlangt eine Session und exponiert ausschließlich
  Zähler (keine Token-IDs, Subjekte oder Inhalte). Backups sind auf `<BOB_STORAGE_DIR>/backups` beschränkt
  und werden vor einem Restore digest- und versionsgeprüft (manipuliert → 409, fail closed).

## 4. Keine Shell-Strings (`lib/argv-policy.ts`)

Zentrale Policy für Broker, lokale Runtime, OCI-Runtime und Regression Engine:

- Programme werden ausschließlich als `argv[]` mit `spawn(..., {shell:false})` gestartet.
- **Shell-Interpreter verboten:** `sh`, `bash`, `dash`, `zsh`, `ksh`, `csh`, `tcsh`, `fish`, `cmd`,
  `powershell`, `pwsh`, `wsl` – auch mit Pfad (`/bin/bash`) und `.exe`-Suffix.
- **Metazeichen verboten:** `; & | \` $ > <` und Zeilenumbrüche sind in **jedem** Argument untersagt (nicht nur
  in `argv[0]`).
- Längen-/Leerprüfung je Argument (max. 4096 Zeichen, keine leeren Einträge).
- Der Broker prüft dies als Preflight und **auditiert** die Verweigerung (`SHELL_PROGRAM`, `SHELL_METACHAR`).
  Runtimes erzwingen dieselbe Policy zusätzlich (Defense in Depth).

## 5. Sandbox und Netzwerk (`lib/sandbox/fabric.ts`, `lib/runtime-local.ts`, `lib/oci-runtime.ts`)

- Jede Sandbox ist an Task **und** Agent gebunden; Fremdbindung ist ein Fehler.
- **Netzwerk ist standardmäßig `DENY`.** `ALLOWLIST` ist fail closed, bis ein kontrollierter Egress-Proxy
  existiert – in Fabric, Runtime und Broker.
- Lokale Runtime: eigenes Workspace-Verzeichnis (0700), reduziertes Environment, Timeout mit Prozessgruppen-Kill.
- **Kernel-Isolation (`NAMESPACES`, real):** Ist ein Rootfs vorhanden (`bash scripts/build-ns-rootfs.sh`),
  läuft jede lokale Ausführung zusätzlich in eigenen Netzwerk-, PID-, IPC-, UTS-, Mount- und
  User-Namespaces (`lib/ns-isolation.ts`, `scripts/ns-exec.sh`). Gemessen im isolierten Prozess:
  `CapBnd`/`CapEff` = 0, `NoNewPrivs` = 1, Rootfs `EROFS`, nur `/work` schreibbar, nur `lo` und leere
  Routingtabelle, 1 sichtbarer Prozess. Zeitüberschreitung beendet die Prozessgruppe.
- **Fail closed:** Mit `BOB_NS_ISOLATION=on` wird eine Ausführung **verweigert**, wenn die Kernel-Isolation
  nicht verfügbar ist (`kernel isolation is enforced … but unavailable`, HTTP 409, Audit-DENY). Es gibt
  keinen stillen Rückfall auf einen unisolierten Lauf. Live nachgewiesen: siehe `docs/TESTING.md`.
- OCI: `--network none`, `--read-only`, `--cap-drop ALL`, `--security-opt no-new-privileges`, nicht-root-User –
  **UNVERIFIED** ohne Container-Daemon in dieser Umgebung. Die Isolationsstufe wird deshalb als
  `NAMESPACES` (und nicht als `CONTAINER`) ausgewiesen.
- Snapshots sind echte Workspace-Snapshots mit SHA-256-Digest; Restore prüft Digest und Dateihashes und
  schlägt bei Abweichung fehl.

## 5a. Capability-Token: eine Autorisierung = eine Ausführung (`lib/authority.ts`)

- Jedes Token hat `maxUses` (Standard **1**) und `uses`. Beim Start einer Ausführung wird genau eine
  Verwendung atomar verbraucht (`consumeCapabilityToken`, **vor** dem Ausführen). Ein zweiter Lauf mit
  demselben Token ist ein **Replay** und wird verweigert: HTTP 409, Audit-DENY und Verweigerungsevidenz
  (`kind: "DENIAL"`, Grund `TOKEN_REPLAY` bzw. `token exhausted`).
- Mehrfachverwendung ist ausdrücklich und begrenzt: `maxUses` muss eine ganze Zahl zwischen 1 und
  `MAX_TOKEN_USES` (25) sein; `0`, negative, gebrochene oder zu große Werte werden bei der Ausstellung
  verweigert.
- **Eine Entscheidungsstelle:** API-Gate, Route-Guard und `requireCapability` prüfen Authentizität,
  Scope, Ablauf und Widerruf (`precheckCapabilityToken`) – den **Verbrauch** setzt ausschließlich der
  Execution Broker durch. So entsteht die Verweigerungsevidenz an genau der Stelle, die entscheidet;
  nicht-ausführende Aktionen (z. B. Statusmeldung eines Agenten) verbrauchen kein Token.
- Absturz nach dem Verbrauch führt zu einer Verweigerung, nicht zu einer zweiten Ausführung (fail closed).
- **Ablauf ist Pflicht (fail closed):** `expiresAt` muss ein gültiger ISO-Zeitpunkt in der Zukunft sein.
  Ein fehlendes oder unlesbares Datum wird bei der Ausstellung verweigert (400
  `TOKEN_EXPIRY_REQUIRED`); bei der Prüfung gilt ein unbrauchbarer Wert als **abgelaufen**
  (`NaN`-Vergleiche sind immer `false` — ein früherer Stand hätte ein solches Token nie ungültig
  werden lassen).
- **Leseprojektion:** `GET /api/capabilities` und `GET /api/authority` liefern Token **ohne**
  `secretHash` (`capabilityTokenViews()`). Der Hash ist Prüfmaterial des Servers; der Browser
  erhält nur Identität, Bindung, Fähigkeiten, Risiko, Ablauf und Widerrufszustand.

## 6. Ausführungsbroker (`lib/execution-broker.ts`)

17 Preflight-Prüfungen vor jedem `runtime.execute`: Request-Form, argv-Policy, Task/Agent-Existenz, Bindung,
Risiko, Sandbox-Bindung, Token-Existenz/-Validität/-Bindung/-Risiko/-Umgebung, Gate (inkl. Kill Switches),
Approval, Netzwerkpolicy, Ressourcenlimits. Jede Verweigerung erzeugt `observe(...)` + `recordAudit(DENY)` und
ist damit nachweisbar.

**Kein Ausführungspfad umgeht den Broker.** Regressionstests (`lib/regression.ts`) und der
Smoke-Test der Verifikationspipeline (`lib/verification.ts`) führen echte Prozesse aus, gehören aber
selbst keinem Agenten. Sie laufen deshalb über `lib/system-execution.ts`: das Modul stellt je Lauf eine
kurzlebige, eng gebundene Capability aus, die aus der Bootstrap-Delegation `CREATOR → SYSTEM-WORKER`
abgeleitet ist (Subjekt = Sandbox-Besitzer, Task/Sandbox/Umgebung = Bindung der Sandbox, genau eine
Verwendung, Zweck `REGRESSION` bzw. `SMOKE_TEST`), und ruft ausschließlich `executeAuthorized` des
Brokers auf. Damit greifen Kill Switch, Policy, Gate, Tokenbindung, Replay-Sperre und Evidenz auch für
interne Läufe; ohne die Delegationskante wird **nichts** ausgeführt (fail closed). Der Zweck steht im
Domänenereignis (`purpose`), also ist „warum" nachprüfbar. Getestet in
`tests/security/gate-bypass.test.ts`, live in `scripts/verify-live.sh` (Schritt 7: `fix.verify` im
Lockdown → 409 + Gate-Grund, nach Freigabe → bestanden).

**Verweigerungsevidenz ohne Klartext-Argumente.** Zusätzlich legt jede Verweigerung einen
digest-gebundenen Evidenzdatensatz (`kind: "DENIAL"`) an, der über den Broker, das Audit und die
Provenance verkettet ist – damit ist eine blockierte Autorisierung nachweisbar, nicht nur protokolliert
(Abschnitt 49). In Evidenz und Event stehen dabei **nicht** die Argumente im Klartext, sondern
`program`, `argvLength` und `argvDigest` (SHA-256 über `argv`). Grund: `argv` kann Zugangsdaten oder
personenbezogene Nutzdaten enthalten und Evidenz ist persistent – der Nachweis bleibt prüfbar und
vergleichbar, ohne Geheimnisse zu kopieren. Getestet in `tests/integration/execution-evidence.test.ts`.

## 6a. Deployment (`lib/release.ts`, `lib/deployment.ts`, `scripts/release-supervisor.sh`)

- **Nur der Creator rollt aus.** `POST /api/deployment` verlangt `deployment:execute` **und**
  `creatorOnly`. Ein Agenten-Token wird verweigert (`403`), auch wenn er die Capability besitzt —
  das ist als Sicherheitstest festgehalten (`tests/security/route-guards.test.ts`).
- **Kein Selbst-Ausrollen der Plattform.** Der Prozessneustart liegt außerhalb der Anwendung
  (`scripts/release-supervisor.sh`). Das Skript beendet ausschließlich Prozesse, die auf dem
  Zielport lauschen (`ss`-Abfrage) — kein `pkill`-Muster, das fremde Prozesse treffen könnte.
- **Gates werden nicht abgeschwächt.** `PRODUCTION` verlangt alle Prüfungen `PASSED`; `STAGING`
  erlaubt `BROWSER`/`EVALUATION` nur als `SKIPPED` **mit Begründung**, und die Lücke steht als
  `acknowledgedGaps` im Datensatz. Ein fehlender Grund ist ein Gate-Fehler, kein Freibrief.
- **Kill-Switch und Lockdown greifen vor dem Rollout** und sind im Plan begründet; ein
  Deployment-Kill-Switch verhindert auch den Rückroll.
- **Health-Checks sind echte Messungen**, keine Behauptungen: Digest des Slots, Store-Integrität,
  Event-Kette, Audit-Kette, Isolation, `HTTP /api/auth` (JSON mit `initialized`), `HTTP /`
  (HTML-Wurzel). Erst danach wird der Zeiger umgestellt; sonst bleibt er unverändert und die
  Inbox erhält eine `BLOCK`-Meldung.
- **Keine Geheimnisse in Antworten.** Das Betriebsbild enthält Pfade, Build-IDs und Zustände —
  keine Token, Secrets oder Zugangsdaten (im Test als Negativprüfung `not.toMatch(/secret|token|password/i)`).
- **Rückroll nur mit unversehrtem Vorgänger**: Der Digest wird vorher geprüft; ist der Vorgänger
  beschädigt oder fehlt er, wird der Rückroll verweigert (`409`) und der Dienst bleibt bewusst
  gestoppt statt „irgendetwas" zu starten.

## 7. Datenschutz und Grenzen

- Privacy ist default `DENY`; Datenübertragung nach außen erfordert explizite Entscheidung
  (`lib/privacy.ts`, `lib/data-boundary.ts`).
- Geräte: Discovery ≠ Autorisierung – ein entdecktes Gerät erhält keine Rechte.
- Secrets werden über `lib/secrets.ts` verwaltet und nie in Events/Audit/Argumenten ausgegeben.

## 8. Audit, Provenance, Evidence

- Audit-Einträge sind verkettet (`verifyAuditChain()`, HMAC-SHA256 wenn `BOB_AUDIT_HMAC_KEY` gesetzt ist),
  Events sind append-only und kausal verknüpft.
- **Aufbewahrung ohne falschen Alarm:** Der Audit wird standardmäßig **nicht** gekürzt (append-only,
  unbegrenzt). Nur wenn `BOB_AUDIT_MAX_RECORDS` ausdrücklich gesetzt ist, wird abgeschnitten – und dann
  hält der Store einen **Checkpoint** (Sequenz + Hash des letzten entfernten Datensatzes) fest, an dem die
  Verifikation beginnt. Eine gekürzte Kette meldet `TRIMMED_WITH_CHECKPOINT`, eine Reparatur von
  Altbeständen `HEAD_RECONSTRUCTED_FROM_FIRST_RETAINED_RECORD`, eine ungekürzte `FULL_CHAIN`; ein fehlender
  Datensatz **innerhalb** des erhaltenen Fensters bleibt ein Befund. Ohne diese Regel meldete eine reguläre
  Kürzung „sequence gap"/„chain break" und verdeckte echte Manipulation im Rauschen
  (`tests/unit/audit-retention.test.ts`).
- Provenance-Kanten (`AUTHORIZED_BY`, `EXECUTED_IN`, `CAUSED_BY`, `TESTED_BY`, `REPRODUCED_BY`) verbinden Run,
  Token, Sandbox und Task. Es gibt keine „versteckte" Entscheidung: Begründungen liegen als strukturierter
  `Why?`-Record vor, nicht als interner Gedankenfluss.
- Erfolg ohne Nachweis ist ausgeschlossen: Root Cause verlangt Evidenz, Verifikation verlangt Snapshot und
  bestandene Regression, Recovery ohne Verifikation wird `REJECTED`.

### „Warum?“-Record (`GET /api/events/[id]/why`)

Die Frage „warum wurde das gemacht?“ wird serverseitig aus dem Ereignis-Log beantwortet, nicht aus
Modellausgaben: `lib/observatory.ts` liefert Zweck (`purpose`), Entscheidung (`decision`), Akteur,
Aktion, Ergebnis, Autorisierungsreferenz, Provenance-Referenz und die Kausalkette bis zur Wurzel.

- **Keine Gedankenkette:** Es gibt kein Feld für verborgene Überlegungen. Was nicht dokumentiert ist,
  wird in `limitations` benannt (fehlender Zweck, kein kausaler Vorgänger, fehlende Autorisierungs-
  referenz, abgeschnittene Kette bei 50 Ereignissen).
- **Kein Schreibpfad:** Der Record ist eine reine Projektion (Ereignis-Log, Evidenz, Wissen,
  Provenance); er erzeugt keine Ereignisse und ändert keinen Zustand.
- **Grenzen der Auskunft:** Eingabe-IDs werden streng validiert (`EVT-…`), ungültige IDs sind **400**,
  unbekannte Ereignisse **404**, ohne Session **401**. Der Record erscheint ausschließlich nach
  Autorisierung im Browser (Timeline-Abschnitt, Knopf „Warum?“) und enthält keine Geheimnisse.
- **Nachweis:** `tests/integration/observatory-why.test.ts`, live `scripts/audit-api.sh` Abschnitt 8.

## 9. Verifikation

Nachweisende Tests: `tests/security/authority.test.ts`, `tests/security/token-replay.test.ts`
(Wiederholungssperre: zweiter Lauf verweigert, Evidenz + Audit, exakt freigegebene Anzahl von
Verwendungen, parallele Läufe mit genau einer Freigabe, ungültige Nutzungsgrenzen, Trennung von
Vorprüfung und Verbrauch), `tests/security/api-guard.test.ts`,
`tests/security/api-gate.test.ts`, `tests/security/route-guards.test.ts`, `tests/security/argv-policy.test.ts`,
`tests/security/creator-login.test.ts`, `tests/security/creator-login-lockout.test.ts`,
`tests/security/creator-totp.test.ts` (zusätzlich live: `scripts/verify-live.sh` Schritt 12 prüft
Pflicht, Ablehnung ohne/mit falschem Code, Akzeptanz und Replay-Ablehnung des zweiten Faktors über
echtes HTTP), `tests/security/inbox-route.test.ts`,
`tests/security/api-route-contract.test.ts`, `tests/security/direct-route-denial.test.ts`,
`tests/security/gate-bypass.test.ts`, `tests/security/token-read-projection.test.ts` (kein
`secretHash` in Leseantworten), `tests/security/device-enrollment.test.ts` (Enrollment fail closed,
kein Selbst-Grant, Geheimnis nie in Antworten), `tests/e2e/creator-flow.test.ts`,
`tests/e2e/failure-recovery.test.ts` (**20 Dateien / 135 Tests** in der Security-Suite, 63 Dateien /
422 Tests gesamt) und der Live-Nachweis `scripts/verify-live.sh` (**174 Prüfungen / 0 Fehler** auf der
Instanz mit aktiver Kernel-Isolation und delegiertem cgroup-Unterbaum) sowie `scripts/audit-ui.mjs` (**92 / 0**, u. a. „kein
Geheimnisfeld in einer Antwort an den Browser", „kein Gerät ohne Creator-Freigabe autorisiert").
Zusammenfassung: `docs/TESTING.md`. Offene, als `PARTIAL`/`UNVERIFIED` gekennzeichnete Punkte sind dort und in
`docs/TODO.md` gelistet.
