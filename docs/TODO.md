# Offene Punkte

**Stand:** 2026-09-27

Diese Datei enthält ausschließlich aktuell offene Punkte. Maßgeblich für die
formale Abnahme bleibt `docs/acceptance/requirements.json`; Reifegrade und
Laufzeitnachweise stehen in `docs/STATUS.md`.

## 1. PARTIAL

| Punkt | Aktueller Stand | Nächster Nachweis |
|---|---|---|
| Computer Use | Lifecycle und fail-closed Child-Process-Driver vorhanden. Der konkrete Driver ist aber noch nicht als vollständiger Capability-/Execution-Broker-Verbrauchspfad integriert und es fehlt der reale Browser/Desktop-Treiber. | Brokergebundene Capability für Computer-Aktionen, isolierter Browser-/Desktop-Driver, echter Ausführungs-/Screenshot-Nachweis |
| Offline Fabric | Lokale Ressourcenregistrierung, SHA-256-Verifikation und provenance-erhaltender Bundle-Export/Import vorhanden. | Paket-/Modell-/Wissens-spezifische Offline-Nutzung und vollständiger herkunftstreuer Merge in die jeweiligen Fabs |
| Last-/Soak | Begrenzter Lauf mit Schwellen und Negativpfad vorhanden. | Mehrstündiger Dauerlauf mit Lastkurve und reproduzierbarer SLO-Messung |
| Device Fabric | Enrollment, Autorisierung und Scheduling vorhanden. | Aktiver Netz-Scan, Attestierung und echte Hardware-Ausführung |

## 2. NOT_VERIFIED

| Punkt | Grund |
|---|---|
| Provider-Liveverbindung | Externe Verbindung ist im aktuellen Sicherheitsmodus nicht freigeschaltet; deshalb kein echter Fremdsystem-Live-Nachweis |
| Browser-E2E | Kein geeigneter realer Browserlauf als reproduzierbare CI-Evidence vorhanden |

## 3. Bewusst begrenzt

- Netzwerk-Allowlist/Egress bleibt fail closed, solange keine kontrollierte Egress-Schicht existiert.
- WebAuthn als zusätzliche Creator-Authentisierung ist nicht implementiert; TOTP ist vorhanden.
- Ein automatischer Deployment-Watchdog bleibt außerhalb der Creator-gebundenen Promotion.
- Statistische Signifikanzprüfung ist nicht Bestandteil der aktuellen Kausalvalidierung.

## 4. Verifikationsregel

Kein Punkt wird als VERIFIED oder PRODUCTION_READY geführt, solange
Implementierung, Integration, Sicherheitsgrenze, Test und reproduzierbarer
Nachweis nicht vorliegen.
