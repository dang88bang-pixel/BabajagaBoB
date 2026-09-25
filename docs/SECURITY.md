# Sicherheitsmodell

**Stand:** 2026-09-25
**Grundsatz:** Alles ist standardmäßig verboten (fail closed). Jede Ausführung ist autorisiert, gebunden,
auditiert und auf eine isolierte Runtime beschränkt.

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
- **Offen (PARTIAL):** Die API-Routen rufen `guardRequest` noch nicht auf. Der Guard ist implementiert und
  getestet (`tests/security/api-guard.test.ts`), die Verdrahtung steht aus (`docs/TODO.md`).

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
- OCI: `--network none`, `--read-only`, `--cap-drop ALL`, `--security-opt no-new-privileges`, nicht-root-User –
  **UNVERIFIED** ohne Container-Daemon in dieser Umgebung.
- Snapshots sind echte Workspace-Snapshots mit SHA-256-Digest; Restore prüft Digest und Dateihashes und
  schlägt bei Abweichung fehl.

## 6. Ausführungsbroker (`lib/execution-broker.ts`)

17 Preflight-Prüfungen vor jedem `runtime.execute`: Request-Form, argv-Policy, Task/Agent-Existenz, Bindung,
Risiko, Sandbox-Bindung, Token-Existenz/-Validität/-Bindung/-Risiko/-Umgebung, Gate (inkl. Kill Switches),
Approval, Netzwerkpolicy, Ressourcenlimits. Jede Verweigerung erzeugt `observe(...)` + `recordAudit(DENY)` und
ist damit nachweisbar.

## 7. Datenschutz und Grenzen

- Privacy ist default `DENY`; Datenübertragung nach außen erfordert explizite Entscheidung
  (`lib/privacy.ts`, `lib/data-boundary.ts`).
- Geräte: Discovery ≠ Autorisierung – ein entdecktes Gerät erhält keine Rechte.
- Secrets werden über `lib/secrets.ts` verwaltet und nie in Events/Audit/Argumenten ausgegeben.

## 8. Audit, Provenance, Evidence

- Audit-Einträge sind HMAC-verkettet (`verifyAuditChain()`), Events sind append-only und kausal verknüpft.
- Provenance-Kanten (`AUTHORIZED_BY`, `EXECUTED_IN`, `CAUSED_BY`, `TESTED_BY`, `REPRODUCED_BY`) verbinden Run,
  Token, Sandbox und Task. Es gibt keine „versteckte" Entscheidung: Begründungen liegen als strukturierter
  `Why?`-Record vor, nicht als interner Gedankenfluss.
- Erfolg ohne Nachweis ist ausgeschlossen: Root Cause verlangt Evidenz, Verifikation verlangt Snapshot und
  bestandene Regression, Recovery ohne Verifikation wird `REJECTED`.

## 9. Verifikation

Nachweisende Tests: `tests/security/authority.test.ts`, `tests/security/api-guard.test.ts`,
`tests/security/argv-policy.test.ts`, `tests/e2e/creator-flow.test.ts`, `tests/e2e/failure-recovery.test.ts`.
Zusammenfassung: `docs/TESTING.md`. Offene, als `PARTIAL`/`UNVERIFIED` gekennzeichnete Punkte sind dort und in
`docs/TODO.md` gelistet.
