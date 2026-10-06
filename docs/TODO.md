# Offene Punkte

**Stand:** 2026-10-06  
**Maßgebliche Quellen:** `docs/STATUS.md`, `docs/SPEC_COMPLIANCE.md`, `docs/ABSCHLUSSBERICHT.md`.

## 1. Im Completion-Hardening ergänzt

- **Lokale Embedding-Suche:** `lib/knowledge-vector.ts` liefert einen deterministischen, netzwerkfreien 256-dimensionalen Embedding-Fallback; der Knowledge Graph bleibt die Wahrheitsquelle.
- **Experimentstatistik:** `lib/statistics.ts` liefert Stichprobenkennzahlen, Welch-t-Test, Effektstärke und p-Wert ohne externe Abhängigkeit. Die Statistik ist ein Analysewerkzeug und darf Evidenz nicht automatisch zu `ESTABLISHED` machen.
- **Geräte-Discovery:** `lib/device-discovery.ts` ergänzt passive ARP-Auswertung und zeitlich begrenzte mDNS-Discovery. Discovery erzeugt niemals automatisch Trust/Authorization; diese bleibt im Authority-System.
- **Discovery-Tests:** `tests/integration/device-discovery.test.ts`.
- **Statistik-Tests:** `tests/unit/statistics.test.ts`.

## 2. Verbleibende umgebungsabhängige Nachweise

| Punkt | Status | Voraussetzung |
|---|---|---|
| OCI-Runtime live | `NOT_VERIFIED` | Docker/Podman-Daemon und reale Host-Isolation |
| Egress-Allowlist | `PARTIAL / FAIL-CLOSED` | kontrollierter Egress-Proxy + DNS-Pinning |
| Provider live | `NOT_VERIFIED` | explizite Allowlist + Provider-Credentials + Approval |
| Geräte-Attestierung | `PARTIAL` | vertrauenswürdige Hardware-/Enrollment-Attestation |
| Browser/Desktop-Treiber | `NOT_VERIFIED` | Playwright/Browser bzw. VNC/Desktop-Host |
| Control-Center Browser-E2E | `NOT_VERIFIED` | realer Browser |
| Scheduler-Daemon | `NOT_VERIFIED` | dauerhafter Betriebsprozess/Orchestrator |
| Dauer-Soak | `NOT_VERIFIED` | Stunden-/Lastlauf auf Zielumgebung |

## 3. Noch echte Entwicklungsarbeit

- Statistik in die verbindliche Kausalvalidierung integrieren, sobald ein Experiment quantitative Messwerte führt.
- WebAuthn als optionale zweite Authentisierungsmethode ergänzen; TOTP bleibt vorhanden.
- Egress-Proxy mit Allowlist und DNS-Pinning als kontrollierten Netzwerkpfad implementieren.
- Provider-Adapter nur hinter Data-Boundary, Approval und Audit aktivieren.
- Browser-/Desktop-Adapter als reale Sandbox-Treiber bereitstellen und auf einem geeigneten Host verifizieren.
- Dauer-Scheduler und Dauer-Soak auf einem betrieblich geeigneten Host verifizieren.

## 4. Abnahmeregel

Kein Punkt wird als `DONE` bezeichnet, solange Implementierung, Integration, Persistenz (falls erforderlich), Fehlerpfad, Security-Grenze, Test, Regression, sichtbarer Status, Dokumentation und ein reproduzierbarer Nachweis fehlen.

Umgebungsabhängige Fähigkeiten bleiben ausdrücklich `NOT_VERIFIED`, `BLOCKED` oder `PARTIAL`; sie werden niemals durch eine bloße Architekturbehauptung zu `PASS`.