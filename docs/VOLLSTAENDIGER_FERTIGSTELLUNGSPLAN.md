# Vollständiger Fertigstellungsplan – ausführbare Anwendung

**Stand:** 2026-09-30  
**Zweck:** Verbindlicher Lieferplan zur Herstellung einer vollständig ausführbaren, integrierten und verifizierten BabajagaBoB-Anwendung.  
**Statusregel:** Ein Paket gilt erst als abgeschlossen, wenn Implementierung, Integration, Persistenz (falls erforderlich), Fehlerpfade, Security-Grenze, automatisierter Test, Regressionstest, sichtbarer UI-Zustand, Dokumentation und reproduzierbarer Nachweis vorhanden sind.

## 1. Abnahmekriterium

Die Zielanwendung bildet die vollständige Kette ab:

`Creator → Mission → Objective → Task → Agent → Plan → Sandbox → Experiment/Execution → Observation → Evidence → Verification → Knowledge/Artifact → Approval → CI/CD → Deployment → Monitoring → Recovery → Learning`

Die Anwendung darf keine Produktionsreife behaupten, solange ein für die Zielkette erforderliches Paket `PARTIAL`, `NOT_VERIFIED`, `BLOCKED` oder `NOT_IMPLEMENTED` ist.

Die zentrale Wirbelsäule bleibt:

- Agent Orchestrator
- Task Manager
- Permission/Capability Broker
- Execution Engine
- Verification Engine
- Audit/Event Store
- Sandbox Manager
- Experiment Engine
- Buddy/Critic
- Resource Manager

## 2. Lieferprinzip: kleine Kuchenstücke

Jedes Stück ist eigenständig prüfbar und baut auf dem vorherigen auf.

| ID | Lieferpaket | Ergebnis |
|---|---|---|
| K00 | Acceptance Baseline | vollständige Requirement-Matrix und offene-Punkte-Register |
| K01 | Creator Bootstrap & Session | reproduzierbarer sicherer Erststart |
| K02 | Event/Audit/Provenance Fabric | eine konsistente Nachweiskette |
| K03 | Execution Fabric | Task → Queue → Worker → Broker → Runtime |
| K04 | Sandbox & Runtime | echte isolierte Ausführung |
| K05 | Recovery & Resilience | Fehler → Recovery → Verification |
| K06 | Autonomous Experiment Fabric | Hypothese → Baseline → Control → Replication → Evidence |
| K07 | Knowledge & Research Fabric | Quellen → Claims → Evidence → Knowledge |
| K08 | Agent Fabric & Workshop | Rollen, Tools, Skills, Runtime Registry |
| K09 | Provider & Connector Fabric | kontrollierte externe Integrationen |
| K10 | Device & Computer-Use Fabric | autorisierte Rechner-/Geräteausführung |
| K11 | Simulation & Visualization Fabric | Visualisierung, Simulation, Replay |
| K12 | Offline Fabric | offline arbeitsfähige Kernfunktionen |
| K13 | Universal Status & Observatory | einheitlicher Live-Status für jede Aktion |
| K14 | Control Center | vollständige Bedien- und Beobachtungsoberfläche |
| K15 | Security/Privacy Hardening | Angriffskatalog und Datenschutzgrenzen |
| K16 | CI/CD, Backup, Operations | reproduzierbarer Betrieb |
| K17 | Browser/E2E/Soak | reale End-to-End-Verifikation |
| K18 | Final Acceptance | 100-%-Anforderungsabnahme |

---

# 3. K00 – Acceptance Baseline

### Ziel
Alle Anforderungen werden eindeutig einer Implementierung, einem Test und Evidence zugeordnet.

### Aufgaben
- Master-Spec als oberste Quelle bestätigen.
- `Requirement → Code → API → UI → Test → Evidence` Matrix pflegen.
- Statuswerte normieren: `ARCHITECTURE`, `IMPLEMENTED`, `INTEGRATED`, `TESTED`, `VERIFIED`, `PARTIAL`, `NOT_VERIFIED`, `NOT_IMPLEMENTED`, `BLOCKED`.
- Keine Prozent-Fertigstellung als Ersatz für Nachweise.
- Jede offene Abweichung mit Owner, nächstem Schritt und Abnahmetest erfassen.

### Abnahme
Matrix-Selbsttest schlägt fehl, sobald ein Pflicht-Requirement ohne Nachweis auf PASS steht.

---

# 4. K01 – Creator Bootstrap & Session

### Ziel
Eine frische Installation kann sicher initialisiert und danach ausschließlich innerhalb der delegierten Authority betrieben werden.

### Aufgaben
- einmaliger Creator-Bootstrap
- Replay-Schutz
- Bootstrap-Ablauf/TTL
- Creator-Session
- TOTP weiter absichern
- Capability-Ausgabe nur innerhalb definierter Scopes
- Self-Grant verhindern
- Browser erhält keine Root-/Control-Plane-Secrets
- Bootstrap, Login, Lockout und Session-Wiederherstellung testen

### Abnahme
Fresh install → Bootstrap → Creator login → Agent → Capability → Aktion → Audit.

---

# 5. K02 – Event/Audit/Provenance Fabric

### Ziel
Ein Ereignis darf nicht gleichzeitig mehrere konkurrierende Wahrheiten erzeugen.

### Aufgaben
- authoritative Event Fabric festlegen
- eindeutige Event-ID
- monotone Sequenz
- eindeutiger `parent_event_id`
- atomarer Append
- Concurrency-Schutz
- Integritätskette
- Audit und Provenance auf Event-Referenzen ausrichten
- keine stille Überschreibung
- Replay und „Warum?“ auf dieselbe Kette stützen
- Retention/Checkpoint-Verhalten dokumentieren

### Abnahme
Konkurrierende Writes, Manipulation, Parent-Kette, Replay und Provenance-Linkage müssen reproduzierbar geprüft werden.

---

# 6. K03 – Execution Fabric

### Ziel
Es gibt keinen alternativen Ausführungspfad am Broker vorbei.

### Aufgaben
- Task → Job → Lease → Worker → Run
- Heartbeat
- Timeout
- Retry
- Dead Letter
- Cancellation
- Idempotency
- Foreign-binding denial
- Capability-Replay-Schutz
- Kill-Switch
- Policy Gate
- Approval Gate
- Evidence-Erzeugung
- System-Worker ebenfalls über Gate/Broker

### Abnahme
Erfolg, Fehler, Fremdbindung, Replay und Lockdown werden live getestet.

---

# 7. K04 – Sandbox & Runtime

### Ziel
Agenten können kontrolliert in echten isolierten Arbeitsumgebungen arbeiten.

### Aufgaben
- Development/Experiment/Test/Browser/Security/Migration/Staging/Recovery/Diagnostic
- Create/Clone/Reset/Snapshot/Restore/Destroy
- Ressourcenlimits
- Netzwerk DENY als Default
- Read-only Root
- Capabilities minimieren
- no-new-privileges
- Prozess-/CPU-/Speichergrenzen
- Cleanup
- OCI-Daemon-Lauf mit Docker oder Podman praktisch verifizieren
- OCI Snapshot/Restore praktisch verifizieren
- Storage-Quota tatsächlich erzwingen
- OCI-Reconcile/Orphan-Cleanup verifizieren

### Abnahme
Echter OCI-Lauf mit Angriffstests, Ressourcenüberschreitung, Netzwerkprüfung, Snapshot/Restore und Cleanup.

---

# 8. K05 – Recovery & Resilience

### Ziel
Recovery ist eine ausführbare und verifizierte Wiederherstellung, keine Statusänderung.

### Aufgaben
- Fehlerbild erkennen
- Tier automatisch ableiten
- Recovery Plan erzeugen
- Snapshot auswählen
- Restore ausführen
- Smoke-Test
- Regression-Test
- Evidence
- ACCEPT/REJECT
- Creator-Eskalation für hohe Risiken
- Prozess-/Dienstabsturz injizieren
- Recovery während Recovery testen

### Abnahme
Sabotage → Incident → Root Cause → Recovery → Restore → Regression → VERIFIED.

---

# 9. K06 – Autonomous Experiment Fabric

### Ziel
Der Agent kann innerhalb seiner Authority eigenständig Experimente vorbereiten und ausführen.

### Aufgaben
- Objective
- Hypothesis
- Baseline
- Control
- Intervention
- Replication
- Confounders
- Alternative Explanations
- Evidence
- Observation
- Conclusion
- Next Action
- automatische Sandbox-Erzeugung
- Experiment-Budget
- Stop Conditions
- Experiment-Replay

### Kausale Abnahme
`ESTABLISHED` ausschließlich nach vollständiger Kausalkette.

Optionaler Ausbau:
- statistische Signifikanzprüfung als separates Evidenzmodul; sie ersetzt nicht die kausale Prüfung.

---

# 10. K07 – Knowledge & Research Fabric

### Ziel
Recherche wird zu überprüfbarer Evidenz statt zu bloßem Text.

### Aufgaben
- Source Manager
- Web/Docs/PDF/GitHub/Standards als Connectoren
- Quellenstatus
- relevante Passagen
- Claims
- widersprechende Claims
- Evidence
- Aktualität
- Research Run
- Knowledge Graph
- negatives Wissen
- Provenance
- lokale Dokumente
- Embedding-/Vektorsuche als optionale zusätzliche Retrieval-Schicht

### Abnahme
Eine Knowledge-Aussage muss auf ihre Quellen und Evidence zurückgeführt werden können.

---

# 11. K08 – Agent Fabric & Workshop

### Ziel
Agenten, Tools, Skills und Runtime-Adapter werden versioniert und kontrolliert erweitert.

### Aufgaben
- Planner
- Builder
- Research
- Experiment/Scientist
- QA
- Browser
- Security/Guardian
- Deployment/Operator
- Recovery
- Supervisor
- Integrator
- Autonomy Profiles
- Tool Registry
- Skill Registry
- Workshop-Lifecycle
- Runtime Registry
- Runtime-Provisioning
- Test Harnesses
- Debugger Adapter
- Parser/Compiler Adapter

### Abnahme
Agent erstellt ein Tool in einer Sandbox, testet es, validiert Capabilities und registriert eine Version.

---

# 12. K09 – Provider & Connector Fabric

### Ziel
Externe Dienste sind Adapter, keine impliziten Agentenrechte.

### Aufgaben
- Connector Manager
- REST/WebSocket/SSE
- lokale Prozesse
- API-Provider
- Credentials Broker/Vault
- Capability Scope
- Approval
- Egress Policy
- Telemetrie
- Widerruf
- Provider Health
- controlled Egress Proxy
- DNS-Pinning
- Allowlist

### Aktuell offen
Egress-Allowlist bleibt fail closed, bis ein kontrollierter Proxy vorhanden und verifiziert ist.

### Abnahme
Mindestens ein realer Provider wird über Allowlist + Approval + Capability + Audit ausgeführt; Datenfluss wird geprüft.

---

# 13. K10 – Device & Computer-Use Fabric

### Ziel
Autorisierte Geräte können als Ausführungsressourcen dienen.

### Device Fabric
- Discovery
- Identification
- Trust
- Authorization
- Availability
- Allocation
- Execution
- Release
- Heartbeat
- Capability Profile
- Scheduler

### Noch offen
- aktiver Netz-Scan
- mDNS/ARP-Discovery
- Attestation
- echte Geräteausführung

### Computer Use
- Browser Driver
- Desktop Driver
- Screenshot
- DOM
- OCR
- Keyboard
- Mouse
- Process/File Controls
- Sandbox-Bindung

### Abnahme
Entdeckung erzeugt niemals automatisch Autorisierung. Ein real autorisiertes Testgerät führt einen begrenzten Broker-Task aus.

---

# 14. K11 – Simulation & Visualization Fabric

### Ziel
Visualization, Simulation, Experiment und Replay bleiben getrennte Konzepte.

### Aufgaben
- 2D Diagramme
- Flowcharts
- Architecture Graph
- Timeline
- Network Graph
- State Machine
- Dependency Graph
- 3D Scene/Model als erweiterbarer Adapter
- Simulation
- Replay
- echte Zustandsdaten als Quelle
- Evidence-Artefakte
- passive SVG-/Output-Sicherheitsprüfung

### Abnahme
Visualisierung darf keine erfundenen Zustände darstellen; Artefakt verweist auf seinen Ursprungszustand.

---

# 15. K12 – Offline Fabric

### Ziel
Die Kernentwicklung und Forschung bleiben ohne Internet funktionsfähig.

### Aufgaben
- lokale Modelle/Provider
- Dokumentationscache
- Git-Repositories
- Package Mirrors
- Container Images
- SDKs
- Compiler/Interpreter
- Datasets
- Vector Index
- Knowledge Graph
- Offline Task Package
- Offline Evidence
- spätere Synchronisierung
- Conflict Resolution
- Provenance Preservation

### Abnahme
Offline-Szenario ausführen, Artefakte erzeugen, Verbindung wiederherstellen und ohne Provenance-Verlust synchronisieren.

---

# 16. K13 – Universal Status & Observatory

### Ziel
Jede relevante Aktion hat einen echten, einheitlichen Status.

### Status
`QUEUED`, `PLANNING`, `WAITING`, `APPROVAL_REQUIRED`, `RUNNING`, `EXPERIMENT`, `OBSERVING`, `VALIDATING`, `SUCCEEDED`, `FAILED`, `BUG`, `BLOCKED`, `RECOVERING`, `CANCELLED` und weitere deklarierte Zustände werden zentral beschrieben.

### Aufgaben
- Status Fabric
- Fortschritt
- ETA nur bei belastbarer Grundlage
- aktuelle Aktion
- Ressourcen
- Agent
- Sandbox
- Evidence
- Errors
- Observatory
- Why Record
- Replay

### Abnahme
Kein UI-Status darf vom tatsächlichen Backend-State abweichen.

---

# 17. K14 – Control Center

### Ziel
Die komplette Plattform ist ohne direkte Dateisystem-/Shell-Arbeit bedienbar.

### Bereiche
- Dashboard
- Creator
- Agents
- Missions
- Objectives
- Tasks
- Runs
- Experiments
- Sandboxes
- Tools
- Skills
- Runtimes
- Devices
- Computer Use
- Simulation
- Knowledge
- Timeline
- Replay
- Why
- Approvals
- Deployments
- Recovery
- Security
- Integrations
- Operations
- Settings

### Aufgaben
- echte Daten
- leere Zustände
- Fehlerzustände
- Fortschrittsanzeigen
- Approval-Zustände
- BUG/RECOVERY/EXPERIMENT
- responsive UI
- Accessibility
- Browser-E2E

### Abnahme
Alle Hauptwege per Browser reproduzierbar.

---

# 18. K15 – Security & Privacy Hardening

### Angriffskatalog
- Auth Bypass
- Authorization Bypass
- Self Grant
- Token Replay
- Token Leakage
- Secret Leakage
- SSRF
- Command Injection
- Shell Escape
- Sandbox Escape
- Network Bypass
- Audit Tampering
- Provenance Tampering
- Store Poisoning
- Concurrent State Corruption
- Unauthorized Device Access
- Unauthorized Provider Access

### Privacy
- Network DENY
- External Processing DENY
- External Storage DENY
- External Training DENY
- keine Analytics/Tracking/Advertising
- Secrets nie im Browser
- Redaction
- Provider Data Boundary

### Abnahme
Negativtests müssen den Zugriff tatsächlich blockieren und Evidence erzeugen.

---

# 19. K16 – CI/CD & Operations

### CI-Kette
Lint → Typecheck → Unit → Integration → Security → Regression → Build → Browser → E2E → Evaluation → Approval → Staging → Smoke → Production.

### Aufgaben
- OCI-Verifikation in geeigneter CI-Umgebung
- Backup-Scheduler
- Backup-Rotation
- Prometheus Scraper/Alertmanager oder gleichwertiger Alerting-Adapter
- Readiness
- Health
- structured logs
- deployment slots
- rollback
- migration
- graceful shutdown
- operational recovery

### Governance
Automatische Produktion bleibt blockiert, solange das nicht ausdrücklich als sichere Creator-Policy freigegeben und vollständig verifiziert ist.

---

# 20. K17 – Browser, E2E, Soak

### Browser
- echter Chromium/Playwright-Run
- Login
- Creator
- Agent
- Mission
- Task
- Sandbox
- Experiment
- Approval
- Deployment
- Failure
- Recovery
- Replay

### Soak
- Stundenlauf
- Lastkurve
- Queue-Verhalten
- Memory Growth
- Store Growth
- Audit Integrity
- Recovery
- SLO-Messung

### Abnahme
Kein Browser-/Langzeitverhalten wird aus jsdom oder Kurztests extrapoliert.

---

# 21. K18 – Final Acceptance

## Pflichtprüfung

Für jedes Requirement:

1. Code vorhanden
2. integriert
3. Persistenz korrekt
4. Fehlerpfade vorhanden
5. Security Boundary vorhanden
6. Unit/Integration-Test
7. Regression-Test
8. UI-Zustand
9. E2E-Nachweis
10. Dokumentation
11. Evidence

### Finaler Status

`PASS` nur bei vollständigem Nachweis.

`NOT_VERIFIED` bleibt offen.

`PARTIAL` bleibt offen.

`NOT_IMPLEMENTED` bleibt offen.

---

# 22. Offene Punkte aus dem aktuellen Repository-Stand

## Verifizierung / Infrastruktur
- [ ] OCI-Runtime real mit Docker/Podman ausführen und Härtung verifizieren.
- [ ] OCI Snapshot/Restore praktisch prüfen.
- [ ] OCI Storage Quota tatsächlich erzwingen.
- [ ] OCI Orphan Cleanup/Reconcile praktisch prüfen.
- [ ] kontrollierten Egress-Proxy implementieren.
- [ ] DNS-Pinning und Allowlist testen.
- [ ] realen Provider über kontrollierten Egress testen.
- [ ] Backup-Scheduler-Daemon real betreiben.
- [ ] Backup-Rotation im Dauerbetrieb testen.
- [ ] Prometheus/Alertmanager bzw. äquivalenten Betriebsadapter testen.
- [ ] Stunden-/Dauer-Soak mit Lastkurve durchführen.
- [ ] Browser-E2E mit echtem Browser durchführen.

## Device / Computer Use
- [ ] aktive Netz-Geräteerkennung.
- [ ] Attestation.
- [ ] echten Device Agent testen.
- [ ] echten Scheduler auf realen Geräten testen.
- [ ] Browser-Treiber anbinden.
- [ ] Desktop-Treiber anbinden.
- [ ] reale Computer-Use-Aktion über Broker/Sandbox/Evidence testen.

## Provider / Research
- [ ] echte Provider-Adapter mit Approval testen.
- [ ] Source Manager vollständig an die Provider-Fabric anbinden.
- [ ] Dokumentenpipeline für PDF/DOCX/XLSX/CSV/HTML/Bilder/OCR vollständig verifizieren.
- [ ] Embedding-/Vektor-Retrieval als zusätzliche Schicht implementieren.
- [ ] Claim-/Evidence-Querverweise vollständig im Knowledge Graph verankern.

## Runtime / Workshop
- [ ] Runtime Registry über Definitionen hinaus operationalisieren.
- [ ] automatisches Runtime-Provisioning testen.
- [ ] Tool Workshop Ende-zu-Ende testen.
- [ ] Skill-Versionierung und reproduzierbare Ausführung testen.
- [ ] Debugger-/Parser-/Compiler-Adapter exemplarisch real ausführen.

## Simulation / Visualization
- [ ] Simulation Execution Adapter realisieren.
- [ ] 3D-Adapter/Runtime anbinden, falls für Zielanwendungen benötigt.
- [ ] Simulationsergebnis → Evidence → Knowledge integrieren.
- [ ] Replay auf vollständiger Event-Kette testen.

## Offline
- [ ] Offline Knowledge Bundle.
- [ ] Offline Task Package.
- [ ] Offline Execution.
- [ ] Offline Evidence.
- [ ] Reconnect/Sync.
- [ ] Conflict Resolution.
- [ ] Provenance-preserving Merge.

## Security / Identity
- [ ] WebAuthn optional als zusätzlicher Faktor/Alternative evaluieren und nur bei vollständiger Sicherheitsprüfung integrieren.
- [ ] Secret Rotation und Recovery unter Dauerbetrieb testen.
- [ ] Security Regression Suite um alle neu angeschlossenen Adapter erweitern.

## Produktentscheidungen, die nicht als technische Lücken verschleiert werden dürfen
- [ ] Automatisches Production Deployment: nur implementieren, wenn Creator-Governance dies ausdrücklich erlaubt; ansonsten bewusst manuell belassen.
- [ ] Statistische Signifikanz: optionales Evidenzmodul; nicht als Ersatz für Kausalvalidierung.
- [ ] Embeddings: zusätzliche Retrieval-Schicht; Vector Store niemals als Source of Truth.

---

# 23. Definition of Done für jedes Kuchenstück

Ein Paket wird erst auf `DONE` gesetzt, wenn:

```
IMPLEMENTED
   +
INTEGRATED
   +
PERSISTENT (falls nötig)
   +
ERROR PATHS
   +
SECURITY
   +
AUTOMATED TEST
   +
REGRESSION TEST
   +
UI STATUS
   +
E2E
   +
DOCUMENTATION
   +
EVIDENCE
= DONE
```

Ein fehlender realer Umgebungsnachweis bedeutet ausdrücklich `NOT_VERIFIED`.

---

# 24. Arbeitsreihenfolge

Die Pakete werden in dieser Reihenfolge abgearbeitet:

```
K00 → K01 → K02 → K03 → K04 → K05
                         ↓
K06 → K07 → K08 → K09 → K10
                         ↓
K11 → K12 → K13 → K14 → K15
                         ↓
K16 → K17 → K18
```

Nach jedem Paket:

```
Implementieren
→ Testen
→ Security prüfen
→ Integration prüfen
→ Dokumentation aktualisieren
→ Evidence erzeugen
→ CI
→ erst dann nächstes Paket
```

**Kein Überspringen offener Kernpakete zugunsten von UI-Politur oder zusätzlichen Features.**
