# Geräte-Fabric

**Stand:** 2026-09-25
**Modul:** `lib/devices.ts` (persistenter Store `devices`)

**Grundsatz: Discovery ≠ Autorisierung.** Ein entdecktes Gerät erhält keine
Rechte. Zwischen „gesehen" und „darf Aufgaben ausführen" liegen zwei explizite
Creator-Akte.

## 1. Zustände (`DeviceState`)

```
UNKNOWN → DISCOVERED → IDENTIFIED → TRUSTED → AUTHORIZED → AVAILABLE
                                  → ALLOCATED → EXECUTING → RESULT → RELEASED
```

- `authorized: boolean` ist **unabhängig** vom Zustand: Ein Gerät kann
  `IDENTIFIED`/`TRUSTED` sein und bleibt dennoch nicht autorisiert.
- `allocateDevice(id, taskId)` verlangt `authorized === true`; nicht autorisierte
  oder unbekannte Geräte werden verweigert (kein stiller Fallback).
- `releaseDevice(id)` gibt ein Gerät frei und entfernt die Task-Bindung.
- `lastSeen` wird bei jeder Meldung aktualisiert; veraltete Geräte werden nicht
  automatisch vertraut.

## 2. Attribute

| Feld | Werte |
|---|---|
| `trust` (`DeviceTrust`) | `LOCAL_TRUSTED`, `MANAGED`, `EPHEMERAL`, `EXPERIMENTAL`, `RESTRICTED`, `OBSERVATION_ONLY` |
| `network` (`DeviceNetwork`) | `INTERNET`, `LAN`, `VPN`, `NONE`, `ALLOWLIST` |
| Hardware | `os`, `arch`, `cpu`, `ramMb`, `gpu?` |
| Fähigkeiten | `capabilities: string[]` (explizit, keine Wildcards) |

`OBSERVATION_ONLY` bedeutet: Das Gerät darf ausschließlich beobachtet werden,
nicht gesteuert. `RESTRICTED` schließt sensible Aufträge aus.

## 3. Schnittstellen

| Zugriff | Wirkung |
|---|---|
| `GET /api/devices` | Geräteliste + Zusammenfassung (`deviceSummary()`) |
| `POST /api/devices` | `device:manage` (Session) bzw. `device:authorize` (**Creator**) |
| `discoverDevice` | legt/aktualisiert ein Gerät, **ohne** Autorisierung |
| `authorizeDevice(id, true/false, actor)` | Autorisierung setzen/entziehen (auditiert) |
| `deviceStoreReport()` | Integritätsbericht |

## 4. Verhältnis zu Computer Use und Runtime

- Ein autorisiertes Gerät ist noch **keine** Ausführungsumgebung: Die Ausführung
  läuft über Sandbox + Broker (`docs/SANDBOX.md`, `docs/RUNTIME.md`).
- Computer-Use-Instanzen (`docs/COMPUTER_USE.md`) haben einen eigenen
  Autorisierungsschritt; ein Gerät „nebenbei" zu steuern ist nicht möglich.
- Netzwerkzugriff eines Geräts ändert die Sandbox-Policy nicht: Netzwerk bleibt
  in der Ausführung `DENY`/fail-closed `ALLOWLIST`.

## 5. Verifikation

- `scripts/verify-live.sh` Schritt 7: Geräte-Fabric lesbar, mindestens ein Gerät
  vorhanden und **nicht** implizit autorisiert.
- Persistenz über den kanonischen Store; Neustart erhält Autorisierungen.

## 6. Offen (PARTIAL)

- Kein echter Discovery-Dienst (mDNS/SSH-Scan/Agent-Heartbeat) – Geräte werden
  über die API registriert; automatische Erkennung ist nicht implementiert.
- Keine Attestierung/TPM-Prüfung; `LOCAL_TRUSTED` ist eine deklarierte, keine
  kryptografisch belegte Eigenschaft.
