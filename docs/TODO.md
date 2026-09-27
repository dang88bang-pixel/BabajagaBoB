# Offene Punkte

**Stand:** 2026-09-25
**Ausführlicher To-do-Plan zur Fertigstellung:** `docs/FERTIGSTELLUNGSPLAN.md`
(Phasen, Kategorien, Freigabepflichten; Stand 2026-09-26).
**Hinweis:** Die ursprüngliche Roadmap-Fassung dieser Datei (246 Zeilen mit 132
unbearbeiteten Checkboxen) war ein Planungsdokument aus der Startphase und hat
den Umsetzungsstand nicht mehr korrekt abgebildet. Sie wurde durch diese
faktische Liste ersetzt. Maßgeblich für Reifegrade sind `docs/STATUS.md`,
`docs/SPEC_COMPLIANCE.md` und der Abschlussbericht `docs/ABSCHLUSSBERICHT.md`.
Die historische Zerlegung bleibt in `docs/IMPLEMENTATION_ROADMAP.md` erhalten
(ebenfalls Planungsstand, keine Statusaussage).

## 1. Erledigt und nachgewiesen (Kurzfassung)

Vollständige Liste mit Belegen: `docs/STATUS.md`, `docs/ABSCHLUSSBERICHT.md` §B/§C.

Control Plane über HTTP, Server-Authentifizierung (Session + Creator-Login +
Capability-Weg), aktionsspezifische Routen-Guards auf **allen** Routen (strukturell
erzwungen), Betriebsmetriken (Prometheus-Text), Backup/Restore mit Digest-Prüfung, Execution Gate + Broker mit 17
Prüfungen, argv-Policy ohne Shell, Sandbox-Fabric mit Task-/Agent-Bindung,
Snapshots mit SHA-256 und verifiziertem Restore, lokale Runtime mit Timeout-Kill,
Experiment-Engine mit Kausalvalidierung, Error Intelligence bis
`REGRESSION_LOCKED`, Recovery mit Verifikationspflicht, Regression Engine,
Knowledge Graph mit negativem Wissen, Agent Fabric (11 Rollen mit
Autonomie-Vertrag), Provider-Fabric mit Approval-Pflicht, Privacy default `DENY`,
Device- und Computer-Use-Autorisierung, CI/CD mit Promotion-Gate, 14 §44-Dokumente,
Live-Nachweis über 171 HTTP-Prüfungen (inkl. Agentenweg über Capability-Token,
Lockdown-Nachweis für interne Läufe und Kernel-Isolation mit Ressourcenlimits),
kein Ausführungspfad um den Broker (`lib/system-execution.ts`; Regression und
Smoke-Test laufen als SYSTEM-WORKER über Gate, Broker und Evidenz).

## 2. Offen – als `PARTIAL` geführt

| Punkt | Warum offen | Nächster Schritt |
|---|---|---|
| OCI-Runtime verifizieren | kein Container-Daemon in der Umgebung | Lauf mit Docker/Podman auf einem Host mit Daemon; Härtungsflags und Snapshot prüfen |
| ~~Egress-Allowlist~~ | erledigt (2026-09-27, Phase 4 / 7.1): kontrollierte Egress-Schicht `lib/egress/` — Loopback-Forward-Proxy mit Allowlist (nur Hostnamen, keine IP-Literale), DNS-Pinning (Verbindung nur zur gepinnten Adresse, Anti-Rebinding), Audit je Entscheidung, fail closed bei Drainage/Kill-Switch. `BOB_EGRESS_PROXY=1` schaltet sie frei; dann ist `ALLOWLIST` in der lokalen Laufzeit ohne Kernel-Namespaces verfügbar (Proxy-Variablen, Policy-Ebene — ehrlich so ausgewiesen). Unter `NAMESPACES` und in OCI bleibt `ALLOWLIST` fail closed (keine Route zum Proxy). Tests: `tests/unit/egress-allowlist.test.ts` (7), `tests/integration/egress-proxy.test.ts` (9); UI-Abschnitt „Egress" | offen: erzwungenes Egress-Routing auf Kernel-Ebene (z. B. netns mit veth + Umleitung) für `NAMESPACES`- und OCI-Sandboxes — heute Policy-Ebene bzw. DENY |
| Provider live verbinden | keine externen Verbindungen erlaubt (Netzwerk `DENY`) | mit Allowlist + Approval einen Adapter real anbinden und Telemetrie prüfen |
| ~~Geräte-Discovery~~ | erledigt: `lib/device-enrollment.ts` + `scripts/discover-host.mjs` (Meldung mit Geheimnis, fail closed, nur Discovery/Heartbeat), Autorisierung bleibt Creator-Akt; Netz-Scan + Attestierung erledigt (2026-09-27, Phase 4 / 7.3): `lib/device-scan.ts` — ARP-Nachbartabelle (mDNS ehrlich `UNAVAILABLE` ohne Werkzeug), Kandidaten bleiben ohne ausdrückliche Attestierung `PENDING`, fail closed ohne verfügbare Sonde | offen: aktives Subnetz-Sweeping (arp-scan) und kryptografische Geräteidentität — heute Creator-Attestierung als dokumentierter Akt |
| Computer Use | Treiber-Schicht umgesetzt (2026-09-27, Phase 4 / 7.2): `lib/computer-use-drivers.ts` — Browser (headless Chromium), Desktop (xdotool/import), CLI (Node); Aktionen laufen ausschließlich über den autorisierten Systempfad (Purpose `COMPUTER_USE`, Capability `computer:use`) mit Evidenz/Audit/Provenance. CLI-Ausführung echt nachgewiesen; Browser/Desktop melden ohne Binaries ehrlich `UNAVAILABLE` | offen: Browser-/Desktop-Nachweis auf einem Host mit Chromium bzw. X11-Werkzeugen — in dieser Umgebung nicht installiert |
| ~~Offline-Betrieb~~ | erledigt (2026-09-27, Phase 4 / 7.4): Offline Fabric `lib/offline/` — lokaler Bestand (Pakete/Modelle/Wissen/Doku/Datasets/Images/Toolchains/Git) mit Digest und Änderungslinie (nie still überschrieben), Task-Pakete mit Manifest-Digest, Offline-Ausführung ausschließlich in DENY-Sandboxes über den autorisierten Systempfad (Purpose `OFFLINE_PACKAGE`, Capability `offline:execute`), Evidenz, herkunftstreuer Abgleich nach Wiederkehr (UNCHANGED/IMPORT_PENDING/CONFLICT/LOCAL_ONLY) mit expliziter Konfliktentscheidung und Digest-geprüftem Import. Inhalte bis 1 MiB werden gespeichert, darüber ehrliche Metadaten-Referenz. Tests: `tests/unit/offline-fabric.test.ts` (11), `tests/integration/offline-fabric.test.ts` (3); Sabotage-Probe `OFFLINE_DIGEST_IGNORED`; UI-Abschnitt „Offline-Fabric\"; Doku `docs/OFFLINE.md` | offen: Transport großer Inhalte/Modelle über die 1-MiB-Grenze hinaus und tatsächlicher Netz-Transport nach Wiederkehr (liegt außerhalb des Systems; Manifest+Inhalt werden geprüft, nicht simuliert) |
| ~~Simulation/Visualisierung~~ | erledigt | Renderer `lib/visualization.ts` für alle sieben Arten (aus dem echten Zustand), Bildroute + Evidenzartefakt, `tests/integration/visualization.test.ts` |
| Control-Center-UI | kein Browser in der Umgebung (geprüft: kein Chromium/Chrome/Firefox, kein Playwright-Cache; Download-Hosts gesperrt) | Browser-E2E bleibt `NOT_VERIFIED`; ersatzweise jsdom-Tests gegen echte Routen-Handler + `audit-ui.mjs` |
| ~~Recovery-Tier-Ableitung~~ | erledigt | automatische, begründete Klassifikation in `lib/recovery-tier.ts` (Tests: `tests/unit/recovery-tier.test.ts`) |
| ~~Alarmierung (Regeln)~~ | erledigt | 16 Regeln in `lib/alerting.ts`, an die echten Kennzahlen gebunden, `GET /api/alerts[?format=prometheus]`, UI-Anzeige, Tests; offen bleibt der Betrieb von Scraper/Alertmanager (`NOT_VERIFIED`) |
| ~~Backup-Automation~~ | erledigt: `lib/backup-policy.ts` (idempotenter geplanter Lauf, Aufbewahrungsgrenze je Store, Audit + Ereignis, UI-Panel) | offen bleibt ein echter Scheduler-Daemon (externer Auslöser, `NOT_VERIFIED`) |
| ~~Last-/Soak-Tests~~ | erledigt: begrenzter Nachweis **mit definierten Schwellen** (`SOAK_SLO_P95_MS`, `SOAK_SLO_MIN_SUCCESS_RATIO`, Negativnachweis Exit 1) und betriebsweite SLO-Bewertung (`lib/slo.ts`, `/api/slo`, UI „Service-Level“) | offen bleibt ein **Dauerlauf** über Stunden/Lastkurve (`NOT_VERIFIED`) |

## 3. Nicht implementiert (bewusst)

- WebAuthn als Alternative zu TOTP (TOTP ist implementiert: `BOB_CREATOR_TOTP_SECRET`).
- Automatisches Deployment (Promotion bleibt manuell und Creator-gebunden).
- Vektor-/Embedding-Suche im Knowledge Graph.
- Statistische Signifikanzprüfung in der Kausalvalidierung.

## 4. Regeln für neue Einträge

- Kein Punkt gilt als erledigt ohne Implementierung + Integration + Persistenz
  (falls nötig) + Fehlerpfade + Security-Grenze + Test + Regressionstest +
  sichtbaren UI-Zustand + Dokumentation + erfolgreichen E2E-Nachweis.
- Unsichere oder nicht prüfbare Punkte werden als `UNKNOWN`, `UNVERIFIED`,
  `BLOCKED` oder `NOT_IMPLEMENTED` geführt – nie als Erfolg.
