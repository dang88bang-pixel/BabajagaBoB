# Offene Punkte

**Stand:** 2026-09-30

**Verbindlicher Lieferplan:** `docs/VOLLSTAENDIGER_FERTIGSTELLUNGSPLAN.md`

Der Lieferplan zerlegt die vollständige Fertigstellung in 19 prüfbare Kuchenstücke
(K00–K18). Jedes Stück besitzt Ziel, Aufgaben und Abnahmekriterium. Die hier
aufgeführten offenen Punkte bleiben solange offen, bis der im Lieferplan
definierte Nachweis erbracht ist.

## 1. Erledigt und nachgewiesen (Kurzfassung)

Vollständige Liste mit Belegen: `docs/STATUS.md`, `docs/ABSCHLUSSBERICHT.md` §B/§C.

Control Plane über HTTP, Server-Authentifizierung (Session + Creator-Login +
Capability-Weg), aktionsspezifische Routen-Guards auf allen Routen, Betriebsmetriken,
Backup/Restore mit Digest-Prüfung, Execution Gate + Broker, argv-Policy ohne Shell,
Sandbox-Fabric mit Task-/Agent-Bindung, Snapshots mit SHA-256 und verifiziertem
Restore, lokale Runtime mit Timeout-Kill, Experiment-Engine mit Kausalvalidierung,
Error Intelligence, Recovery mit Verifikationspflicht, Regression Engine,
Knowledge Graph mit negativem Wissen, Agent Fabric, Provider-Fabric mit
Approval-Pflicht, Privacy default `DENY`, Device-/Computer-Use-Autorisierung,
CI/CD mit Promotion-Gate und umfangreiche Live-/Test-Nachweise.

## 2. Offene Lieferpakete

| ID | Bereich | Aktueller Status | Zielnachweis |
|---|---|---|---|
| K00 | Acceptance Baseline | PARTIAL | vollständige Requirement-Matrix |
| K01 | Creator Bootstrap & Session | TESTED | Fresh-Install-E2E + Security |
| K02 | Event/Audit/Provenance | TESTED / weiter zu härten | einheitliche autoritative Ereigniskette + Concurrency |
| K03 | Execution Fabric | TESTED | Erfolg/Fehler/Replay/Lockdown live |
| K04 | Sandbox/OCI | UNVERIFIED | realer Docker/Podman-Lauf inkl. Isolation/Restore |
| K05 | Recovery | TESTED | Sabotage → Restore → Regression → VERIFIED |
| K06 | Experimente | IMPLEMENTED / teilweise TESTED | vollständiger autonomer Experiment-E2E |
| K07 | Research/Knowledge | TESTED / Ausbau offen | Quellen → Claims → Evidence → Knowledge |
| K08 | Agent/Tool/Skill/Runtime | PARTIAL | Workshop + Runtime-Provisioning E2E |
| K09 | Provider/Egress | PARTIAL | kontrollierter Egress + realer Provider |
| K10 | Device/Computer Use | PARTIAL | realer autorisierter Gerätetreiber |
| K11 | Simulation/Visualization | TESTED / Simulation-Ausführung offen | echte Simulation → Evidence |
| K12 | Offline Fabric | PARTIAL / Ausbau offen | Offline → Sync → Provenance |
| K13 | Status/Observatory | TESTED | Backend-State = UI-State |
| K14 | Control Center | PARTIAL | echter Browser-E2E |
| K15 | Security/Privacy | TESTED / Adapter-Erweiterung offen | vollständiger Angriffskatalog |
| K16 | CI/CD/Operations | PARTIAL | Scheduler, Alerting, Runtime-Checks |
| K17 | Browser/Soak | NOT_VERIFIED | Browser-E2E + Dauerlauf |
| K18 | Final Acceptance | BLOCKED | 100-%-Requirement-Abnahme |

## 3. Konkrete offene Punkte

### Runtime / Infrastruktur
- [ ] OCI-Runtime mit Docker/Podman praktisch ausführen.
- [ ] OCI-Härtungsflags praktisch verifizieren.
- [ ] OCI Snapshot/Restore praktisch verifizieren.
- [ ] OCI Storage Quota tatsächlich erzwingen.
- [ ] OCI Orphan Cleanup/Reconcile verifizieren.
- [ ] kontrollierten Egress-Proxy implementieren.
- [ ] DNS-Pinning/Allowlist testen.
- [ ] Backup-Scheduler real betreiben.
- [ ] Backup-Rotation im Dauerbetrieb prüfen.
- [ ] Prometheus/Alertmanager oder gleichwertigen Betriebsadapter testen.
- [ ] Stunden-/Dauer-Soak mit Lastkurve durchführen.

### Provider / Research
- [ ] realen Provider mit Allowlist + Approval + Capability + Audit testen.
- [ ] Source Manager/Connectoren vollständig anbinden.
- [ ] Dokumentenpipeline für PDF/DOCX/XLSX/CSV/HTML/Bilder/OCR verifizieren.
- [ ] Embedding-/Vektor-Retrieval als zusätzliche Retrieval-Schicht implementieren.
- [ ] Claim/Evidence/Source vollständig im Knowledge Graph verankern.

### Device / Computer Use
- [ ] aktiven ARP/mDNS-Netzscan implementieren.
- [ ] Attestation implementieren.
- [ ] echten Device Agent testen.
- [ ] realen Scheduler auf Testgeräten testen.
- [ ] Browser Driver anbinden.
- [ ] Desktop Driver anbinden.
- [ ] reale Computer-Use-Aktion über Broker/Sandbox/Evidence testen.

### Runtime / Workshop
- [ ] Runtime Registry operationalisieren.
- [ ] Runtime-Provisioning testen.
- [ ] Tool Workshop Ende-zu-Ende testen.
- [ ] Skill-Versionierung/reproduzierbare Ausführung testen.
- [ ] exemplarische Debugger-/Parser-/Compiler-Adapter real ausführen.

### Simulation / Offline
- [ ] Simulation Execution Adapter.
- [ ] 3D-Adapter bei Bedarf.
- [ ] Simulation → Evidence → Knowledge.
- [ ] Offline Knowledge Bundle.
- [ ] Offline Task Package.
- [ ] Offline Execution/Evidence.
- [ ] Reconnect/Sync.
- [ ] Conflict Resolution.
- [ ] Provenance-preserving Merge.

### UI / Verification
- [ ] echter Chromium/Playwright-Browser.
- [ ] kompletter Creator → Agent → Mission → Task → Sandbox → Experiment → Approval → Deployment → Failure → Recovery → Replay E2E.
- [ ] responsive/accessibility Browserprüfung.
- [ ] lange Laufzeit unter Last.

### Security / Identity
- [ ] WebAuthn als optionale Erweiterung evaluieren.
- [ ] Secret Rotation/Recovery unter Dauerbetrieb testen.
- [ ] Security Regression für jeden neuen Adapter erweitern.

## 4. Bewusste Governance-Entscheidungen

Diese Punkte sind **nicht automatisch technische Defekte**:

- Automatisches Production Deployment bleibt Creator-gebunden, solange keine ausdrückliche Governance-Freigabe für autonome Promotion besteht.
- Statistische Signifikanzprüfung ist ein optionales Evidenzmodul und ersetzt niemals die Kausalvalidierung.
- Embeddings/Vector Search sind Retrieval-Hilfen; der Knowledge Graph und seine Evidence bleiben Source of Truth.

## 5. Abnahmeregel

Kein Punkt gilt als erledigt ohne:

**Implementierung + Integration + Persistenz (falls nötig) + Fehlerpfade + Security-Grenze + Test + Regressionstest + sichtbaren UI-Zustand + Dokumentation + E2E-Nachweis.**

Unsichere oder nicht prüfbare Punkte werden als `UNKNOWN`, `UNVERIFIED`,
`BLOCKED` oder `NOT_IMPLEMENTED` geführt – niemals als Erfolg.
