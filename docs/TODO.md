# Offene Punkte

**Stand:** 2026-09-25
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
Live-Nachweis über 101 HTTP-Prüfungen.

## 2. Offen – als `PARTIAL` geführt

| Punkt | Warum offen | Nächster Schritt |
|---|---|---|
| OCI-Runtime verifizieren | kein Container-Daemon in der Umgebung | Lauf mit Docker/Podman auf einem Host mit Daemon; Härtungsflags und Snapshot prüfen |
| Egress-Allowlist | bewusst fail closed, bis ein kontrollierter Proxy existiert | Egress-Proxy + DNS-Pinning implementieren, dann `ALLOWLIST` freischalten |
| Provider live verbinden | keine externen Verbindungen erlaubt (Netzwerk `DENY`) | mit Allowlist + Approval einen Adapter real anbinden und Telemetrie prüfen |
| Geräte-Discovery | Registrierung nur über API | Discovery-Dienst/Agent-Heartbeat ergänzen, Autorisierung bleibt Creator-Akt |
| Computer Use | kein Browser-/Desktop-Treiber angebunden | Playwright-/VNC-Treiber im Sandbox-Workspace, Aktionen über Broker |
| Simulation/Visualisierung | Szenarien persistent, keine Renderer | Renderer für `ARCHITECTURE`/`TIMELINE`/`SCENE_3D` ergänzen |
| Control-Center-UI | keine Browser-E2E-Tests | Playwright-Suite gegen Testserver mit Gate-Prüfung |
| Recovery-Tier-Ableitung | Tier wird im Plan gesetzt | Klassifikation aus Fehlerbild/Historie ableiten und begründen |
| Alarmierung | Prometheus-Export vorhanden, aber kein Scraper/Alertmanager | Scraper + Alarmregeln aus `docs/OPERATIONS.md` §4a aufsetzen |
| Backup-Automation | Backup/Restore mit Digest-Prüfung implementiert, aber manuell | geplanten Job und Aufbewahrungsregel ergänzen |
| Last-/Soak-Tests | nicht durchgeführt | Nebenläufigkeits- und Langzeittest mit definierten SLOs |

## 3. Nicht implementiert (bewusst)

- Zweiter Faktor für den Creator-Login (TOTP/WebAuthn).
- Automatisches Deployment (Promotion bleibt manuell und Creator-gebunden).
- Vektor-/Embedding-Suche im Knowledge Graph.
- Statistische Signifikanzprüfung in der Kausalvalidierung.

## 4. Regeln für neue Einträge

- Kein Punkt gilt als erledigt ohne Implementierung + Integration + Persistenz
  (falls nötig) + Fehlerpfade + Security-Grenze + Test + Regressionstest +
  sichtbaren UI-Zustand + Dokumentation + erfolgreichen E2E-Nachweis.
- Unsichere oder nicht prüfbare Punkte werden als `UNKNOWN`, `UNVERIFIED`,
  `BLOCKED` oder `NOT_IMPLEMENTED` geführt – nie als Erfolg.
