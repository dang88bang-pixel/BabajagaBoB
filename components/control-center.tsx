"use client";

import {Fragment, useCallback, useEffect, useMemo, useRef, useState} from "react";
import type {Agent, Event, Experiment, Mission, Sandbox, Status} from "../lib/types";
import {StatusBadge} from "./status-badge";
import {isKnownStatus} from "../lib/status";

/**
 * Control Center (Abschnitt 34/35).
 *
 * Regeln dieser Oberfläche:
 *  - Jeder Navigationsabschnitt ist an eine echte Serverroute gebunden. Fehlt
 *    eine Antwort, steht das da („nicht verfügbar“); leere Listen werden als
 *    leer benannt. Es gibt **keine** Platzhalterzeile mit erfundenem Zustand.
 *  - Der Browser erhält nur das HttpOnly-Session-Cookie. Secrets, Provider-,
 *    Geräte- und Runtime-Geheimnisse bleiben serverseitig.
 *  - „Why?“ ist ein strukturierter Datensatz (Status, Risiko, Freigabepflicht,
 *    Recovery-Stufe mit Begründung, Audit-Entscheid), keine Vermutung.
 */

type Row = Record<string, unknown>;
type SectionId =
  | "Overview"
  | "Missions"
  | "Objectives"
  | "Tasks"
  | "Agents"
  | "Queue"
  | "Runs"
  | "Sandboxes"
  | "Runtimes"
  | "Evidence"
  | "Audit"
  | "Provenance"
  | "Timeline"
  | "Observatory"
  | "Knowledge"
  | "Experiments"
  | "Science"
  | "Errors"
  | "Recovery"
  | "Regression"
  | "Inbox"
  | "Approvals"
  | "Governance"
  | "Security"
  | "Privacy"
  | "Providers"
  | "Devices"
  | "ComputerUse"
  | "Pipeline"
  | "Deployment"
  | "Tests"
  | "Operations"
  | "Metrics"
  | "Slo"
  | "Secrets"
  | "Tools"
  | "Skills"
  | "Workshop"
  | "Simulation"
  | "Gallery"
  | "Apps";

const NAV: {id: SectionId; label: string; group: string}[] = [
  {id: "Overview", label: "Übersicht", group: "Betrieb"},
  {id: "Missions", label: "Missionen", group: "Betrieb"},
  {id: "Objectives", label: "Objectives", group: "Betrieb"},
  {id: "Tasks", label: "Aufgaben", group: "Betrieb"},
  {id: "Agents", label: "Agenten", group: "Betrieb"},
  {id: "Queue", label: "Warteschlange", group: "Ausführung"},
  {id: "Runs", label: "Runs", group: "Ausführung"},
  {id: "Sandboxes", label: "Sandboxes", group: "Ausführung"},
  {id: "Runtimes", label: "Runtimes", group: "Ausführung"},
  {id: "Evidence", label: "Evidenz", group: "Nachweis"},
  {id: "Audit", label: "Audit", group: "Nachweis"},
  {id: "Provenance", label: "Provenance", group: "Nachweis"},
  {id: "Timeline", label: "Timeline / Replay", group: "Nachweis"},
  {id: "Observatory", label: "Observatory", group: "Nachweis"},
  {id: "Knowledge", label: "Wissen", group: "Nachweis"},
  {id: "Experiments", label: "Experimente", group: "Nachweis"},
  {id: "Science", label: "Wissenschaft", group: "Nachweis"},
  {id: "Errors", label: "Fehlerfälle", group: "Widerstandsfähigkeit"},
  {id: "Recovery", label: "Recovery", group: "Widerstandsfähigkeit"},
  {id: "Regression", label: "Regression", group: "Widerstandsfähigkeit"},
  {id: "Inbox", label: "Creator-Inbox", group: "Governance"},
  {id: "Approvals", label: "Freigaben", group: "Governance"},
  {id: "Governance", label: "Governance", group: "Governance"},
  {id: "Security", label: "Sicherheit", group: "Governance"},
  {id: "Privacy", label: "Datenschutz", group: "Governance"},
  {id: "Providers", label: "Provider", group: "Fabric"},
  {id: "Devices", label: "Geräte", group: "Fabric"},
  {id: "ComputerUse", label: "Computer Use", group: "Fabric"},
  {id: "Pipeline", label: "CI/CD-Pipeline", group: "Lieferkette"},
  {id: "Deployment", label: "Deployment", group: "Lieferkette"},
  {id: "Tests", label: "Tests", group: "Lieferkette"},
  {id: "Operations", label: "Betrieb/Persistenz", group: "Plattform"},
  {id: "Metrics", label: "Metriken", group: "Plattform"},
  {id: "Slo", label: "Service-Level", group: "Plattform"},
  {id: "Secrets", label: "Secrets", group: "Plattform"},
  {id: "Tools", label: "Werkzeuge", group: "Plattform"},
  {id: "Skills", label: "Skills", group: "Plattform"},
  {id: "Workshop", label: "Werkstatt", group: "Plattform"},
  {id: "Simulation", label: "Simulation", group: "Plattform"},
  {id: "Gallery", label: "Galerie", group: "Plattform"},
  {id: "Apps", label: "Apps", group: "Plattform"}
];

type Column = {key: string; label: string; render?: (row: Row) => string};

const SOURCES: Partial<Record<SectionId, {url: string; path?: string[]; columns: Column[]; note: string}>> = {
  Missions: {
    url: "/api/control",
    path: ["missions"],
    note: "Missionen mit Owner und Fortschritt.",
    columns: [
      {key: "missionId", label: "Mission"},
      {key: "title", label: "Titel"},
      {key: "status", label: "Status"},
      {key: "progress", label: "Fortschritt", render: row => `${String(row.progress ?? 0)}%`},
      {key: "owner", label: "Owner"}
    ]
  },
  Objectives: {
    url: "/api/control",
    path: ["objectives"],
    note: "Objectives je Mission.",
    columns: [
      {key: "objectiveId", label: "Objective"},
      {key: "missionId", label: "Mission"},
      {key: "title", label: "Titel"},
      {key: "status", label: "Status"},
      {key: "description", label: "Beschreibung"}
    ]
  },
  Tasks: {
    url: "/api/control",
    path: ["tasks"],
    note: "Aufgaben mit Risiko, Zuweisung und Freigabepflicht (Why?-Feld).",
    columns: [
      {key: "taskId", label: "Task"},
      {key: "title", label: "Titel"},
      {key: "status", label: "Status"},
      {key: "progress", label: "Fortschritt", render: row => `${String(row.progress ?? 0)}%`},
      {key: "risk", label: "Risiko"},
      {key: "assignedAgent", label: "Agent"},
      {key: "requiresApproval", label: "Freigabe", render: row => (row.requiresApproval ? "erforderlich" : "nein")}
    ]
  },
  Agents: {
    url: "/api/agents/fabric",
    path: ["agents"],
    note: "Agenten-Observatory: Health, Heartbeat und Autonomie-Vertrag (keine Selbstvergabe, keine Produktion).",
    columns: [
      {key: "agentId", label: "Agent"},
      {key: "name", label: "Name"},
      {key: "kind", label: "Rolle"},
      {key: "status", label: "Status"},
      {key: "health", label: "Health"},
      {key: "heartbeatAt", label: "Heartbeat"},
      {key: "capabilities", label: "Capabilities", render: row => (Array.isArray(row.capabilities) ? (row.capabilities as string[]).join(", ") : "—")},
      {
        key: "profile",
        label: "Grenzen",
        render: row => {
          const profile = row.profile as Record<string, boolean> | undefined;
          if (!profile) return "—";
          const extra = [profile.production ? "PRODUKTION" : null, profile.authorityChanges ? "RECHTE" : null, profile.externalNetwork ? "EXTERN" : null, profile.infrastructure ? "INFRA" : null].filter(Boolean);
          return extra.length > 0 ? extra.join(" · ") : "keine Zusatzrechte";
        }
      }
    ]
  },
  Queue: {
    url: "/api/queue",
    path: ["jobs"],
    note: "Job-Leases, Versuche und Idempotenz.",
    columns: [
      {key: "jobId", label: "Job"},
      {key: "taskId", label: "Task"},
      {key: "agentId", label: "Agent"},
      {key: "state", label: "Status"},
      {key: "attempt", label: "Versuche", render: row => `${String(row.attempt ?? 0)}/${String(row.maxAttempts ?? 0)}`},
      {key: "risk", label: "Risiko"},
      {key: "priority", label: "Priorität"}
    ]
  },
  Runs: {
    url: "/api/runs",
    path: ["runs"],
    note: "Run-Lifecycle mit Leases, Heartbeats und Versuchen.",
    columns: [
      {key: "runId", label: "Run"},
      {key: "taskId", label: "Task"},
      {key: "agentId", label: "Agent"},
      {key: "state", label: "Status"},
      {key: "attempt", label: "Versuche", render: row => `${String(row.attempt ?? 0)}/${String(row.maxAttempts ?? 0)}`},
      {key: "sandboxId", label: "Sandbox"},
      {key: "workerId", label: "Worker"}
    ]
  },
  Sandboxes: {
    url: "/api/sandboxes",
    path: ["sandboxes"],
    note: "Sandboxes sind an Task und Agent gebunden; Netzwerk bleibt DENY.",
    columns: [
      {key: "sandboxId", label: "Sandbox"},
      {key: "type", label: "Typ"},
      {key: "status", label: "Status"},
      {key: "network", label: "Netzwerk"},
      {key: "taskId", label: "Task"},
      {key: "agentId", label: "Agent"},
      {key: "runtimeMode", label: "Runtime"}
    ]
  },
  Runtimes: {
    url: "/api/runtimes",
    path: ["runtimes"],
    note: "Runtime-Registry: registrierbare Laufzeiten mit Art, Plattformen, Netzwerk-Default und Sandbox-Unterstützung.",
    // Spalten exakt nach `RuntimeDefinition` (lib/runtime-registry.ts):
    // `language`, `mode`, `status` und `notes` gibt es dort nicht — sie hätten
    // dauerhaft „—“ gezeigt und den Vertrag falsch dargestellt.
    columns: [
      {key: "id", label: "Runtime"},
      {key: "name", label: "Name"},
      {key: "version", label: "Version"},
      {key: "kind", label: "Art"},
      {key: "platforms", label: "Plattformen", render: row => (Array.isArray(row.platforms) ? (row.platforms as string[]).join(", ") : "—")},
      {key: "architectures", label: "Architekturen", render: row => (Array.isArray(row.architectures) ? (row.architectures as string[]).join(", ") : "—")},
      {key: "sandboxSupport", label: "Sandbox", render: row => (row.sandboxSupport ? "ja" : "nein")},
      {key: "networkDefault", label: "Netzwerk"},
      {key: "packageManager", label: "Paketmanager"}
    ]
  },
  Observatory: {
    url: "/api/observatory",
    path: ["activities"],
    note:
      "Je Aktivität die neun Felder des Observatory (Ziel, Beobachtung, Hypothese, Aktion, Erwartung, Ergebnis, Evidenz, Schlussfolgerung, nächster Schritt). " +
      "Es ist eine Projektion über Ereignis-Log und Stores — fehlende Felder werden als Lücke benannt, nicht ergänzt. Der Abschnitt schreibt nichts.",
    columns: [
      {key: "activityId", label: "Aktivität"},
      {key: "kind", label: "Art"},
      {key: "status", label: "Status"},
      {key: "objective", label: "Ziel"},
      {key: "observations", label: "Beobachtung", render: row => (Array.isArray(row.observations) ? (row.observations as string[]).join(" · ") : "")},
      {key: "hypothesis", label: "Hypothese"},
      {key: "expectation", label: "Erwartung"},
      {key: "result", label: "Ergebnis"},
      {key: "conclusion", label: "Schlussfolgerung"},
      {key: "nextStep", label: "Nächster Schritt"},
      {key: "gaps", label: "Lücken", render: row => (Array.isArray(row.gaps) ? ((row.gaps as string[]).length ? (row.gaps as string[]).join(" · ") : "vollständig") : "")}
    ]
  },
  Knowledge: {
    url: "/api/knowledge",
    path: ["nodes"],
    note: "Vier Schichten inkl. negativem Wissen. Wissenszustand trennt beobachtet/gestützt/etabliert/Hypothese/ungeprüft/widersprochen/verworfen.",
    columns: [
      {key: "knowledgeId", label: "Wissen"},
      {key: "layer", label: "Schicht"},
      {key: "subject", label: "Subjekt"},
      {key: "predicate", label: "Prädikat"},
      {key: "object", label: "Objekt"},
      {key: "state", label: "Zustand"},
      {key: "confidence", label: "Belegklasse"}
    ]
  },
  Experiments: {
    url: "/api/experiments",
    note: "Experimente mit Hypothese und Wissenszustand; Validierung über Kausalitätsregeln.",
    columns: [
      {key: "experimentId", label: "Experiment"},
      {key: "title", label: "Titel"},
      {key: "status", label: "Status"},
      {key: "knowledgeState", label: "Wissenszustand"},
      {key: "sandboxId", label: "Sandbox"},
      {key: "hypothesis", label: "Hypothese"}
    ]
  },
  Science: {
    url: "/api/science",
    path: ["experiments"],
    note: "Wissenschaftliche Engine: Experimente, Evidenz und Kausalentscheidungen.",
    columns: [
      {key: "experimentId", label: "Experiment"},
      {key: "title", label: "Titel"},
      {key: "status", label: "Status"},
      {key: "knowledgeState", label: "Wissenszustand"},
      {key: "hypothesis", label: "Hypothese"}
    ]
  },
  Recovery: {
    url: "/api/reliability",
    path: ["plans"],
    note: "Recovery-Pläne mit Stufe (1–5), Schritten und Verifikationspflicht. Ab Stufe 4 ist eine Creator-Freigabe nötig.",
    columns: [
      {key: "recoveryId", label: "Plan"},
      {key: "failureId", label: "Fehler"},
      {key: "tier", label: "Stufe"},
      {key: "status", label: "Status"},
      {key: "steps", label: "Schritte", render: row => (Array.isArray(row.steps) ? (row.steps as string[]).join(" → ") : "—")},
      {key: "checkpointSnapshotId", label: "Checkpoint"},
      {key: "verificationId", label: "Verifikation"}
    ]
  },
  Regression: {
    url: "/api/reliability",
    path: ["failures"],
    note: "Regressionstests (Never Again) je Fehlerfall: Der Regressionsnachweis blockiert die Promotion.",
    columns: [
      {key: "failureId", label: "Fehler"},
      {key: "incidentId", label: "Incident"},
      {key: "symptom", label: "Symptom"},
      {key: "rootCause", label: "Ursache"},
      {key: "regressionId", label: "Regressionstest"},
      {key: "status", label: "Status"}
    ]
  },
  Approvals: {
    url: "/api/approvals",
    note: "Freigaben werden serverseitig entschieden; die Oberfläche zeigt den Zustand und kann entscheiden (Creator).",
    columns: [
      {key: "approvalId", label: "Freigabe"},
      {key: "taskId", label: "Task"},
      {key: "status", label: "Status"},
      {key: "reason", label: "Grund (Why?)"},
      {key: "createdAt", label: "erstellt"}
    ]
  },
  Governance: {
    url: "/api/governance",
    path: ["killSwitches"],
    note: "Kill-Switches wirken auf den gesamten Ausführungspfad. Delegationen sind an Task, Sandbox und Ablauf gebunden.",
    columns: [
      {key: "scope", label: "Scope"},
      {key: "targetId", label: "Ziel"},
      {key: "active", label: "Zustand", render: row => (row.active ? "AKTIV – Ausführung gesperrt" : "inaktiv")},
      {key: "reason", label: "Grund"}
    ]
  },
  Privacy: {
    url: "/api/privacy",
    path: ["rules"],
    note: "Datenschutz ist default DENY; externe Weitergabe, Verarbeitung, Training und Speicherung sind einzeln geregelt.",
    columns: [
      {key: "id", label: "Regel"},
      {key: "dataClass", label: "Datenklasse"},
      {key: "externalDisclosure", label: "Weitergabe"},
      {key: "externalProcessing", label: "Verarbeitung"},
      {key: "externalTraining", label: "Training"},
      {key: "externalStorage", label: "Speicherung"}
    ]
  },
  Providers: {
    url: "/api/providers",
    path: ["providers"],
    note: "Provider-Fabric: Registrierung, Lifecycle und Health. Verbindungen benötigen Creator-Freigabe.",
    columns: [
      {key: "id", label: "Provider"},
      {key: "name", label: "Name"},
      {key: "category", label: "Kategorie"},
      {key: "lifecycle", label: "Lebenszyklus"},
      {key: "health", label: "Health"},
      {key: "enabled", label: "Aktiv", render: row => (row.enabled ? "ja" : "nein")},
      {key: "lastHeartbeat", label: "Heartbeat"}
    ]
  },
  Devices: {
    url: "/api/devices",
    path: ["devices"],
    note: "Entdeckung ist keine Autorisierung: Geräte bleiben bis zur Creator-Freigabe ungenutzt.",
    columns: [
      {key: "id", label: "Gerät"},
      {key: "name", label: "Name"},
      {key: "os", label: "OS"},
      {key: "arch", label: "Architektur"},
      {key: "trust", label: "Vertrauen"},
      {key: "state", label: "Zustand"},
      {key: "authorized", label: "Autorisiert", render: row => (row.authorized ? "ja (Creator-Freigabe)" : "nein — Discovery ≠ Autorisierung")},
      {key: "network", label: "Netzwerk"},
      {key: "capabilities", label: "Capabilities", render: row => (Array.isArray(row.capabilities) ? (row.capabilities as string[]).join(", ") : "—")}
    ]
  },
  ComputerUse: {
    url: "/api/computer-use",
    path: ["computers"],
    note: "Browser-, Desktop- und CLI-Instanzen mit expliziter Autorisierung.",
    columns: [
      {key: "id", label: "Instanz"},
      {key: "name", label: "Name"},
      {key: "kind", label: "Art"},
      {key: "network", label: "Netzwerk"},
      {key: "authorized", label: "Autorisiert", render: row => (row.authorized ? "ja" : "nein")},
      {key: "state", label: "Zustand"},
      {key: "sandboxId", label: "Sandbox"},
      {key: "taskId", label: "Task"}
    ]
  },
  Slo: {
    url: "/api/slo",
    path: ["results"],
    note: "Service-Level: Schwellen mit Zielwert, Warn- und kritischer Grenze, gegen den echten Betriebszustand bewertet. Ein fehlender Messwert ist UNKNOWN, nicht gesund; die Bewertung repariert nichts.",
    columns: [
      {key: "title", label: "Messgröße"},
      {key: "state", label: "Zustand"},
      {key: "value", label: "Ist", render: row => (row.value === null || row.value === undefined ? "UNKNOWN" : String(row.value))},
      {key: "target", label: "Ziel"},
      {key: "warning", label: "Warnung ab"},
      {key: "critical", label: "Kritisch ab"},
      {key: "source", label: "Quelle"},
      {key: "runbook", label: "Runbook"}
    ]
  },
  Pipeline: {
    url: "/api/cicd",
    path: ["pipelines"],
    note: "Pipeline-Stufen und Prüfungen. Eine Promotion ohne bestandene Prüfungen wird verweigert.",
    columns: [
      {key: "id", label: "Pipeline"},
      {key: "taskId", label: "Task"},
      {key: "branch", label: "Branch"},
      {key: "stage", label: "Stufe"},
      {key: "checks", label: "Prüfungen", render: row => (Array.isArray(row.checks) && row.checks.length > 0 ? (row.checks as {kind: string; status: string}[]).map(check => `${check.kind}:${check.status}`).join(", ") : "keine erfasst")},
      {key: "updatedAt", label: "Zuletzt"}
    ]
  },
  Deployment: {
    url: "/api/deployment",
    path: ["releases"],
    note:
      "Release-Slots auf der Platte, der aktive Zeiger und die ausgelieferte Build-ID. „Aktiv“ heißt: der laufende Server meldet genau diese Build-ID — ein umgestellter Zeiger allein gilt nicht. Ohne bestandene Promotion-Gates und Creator-Freigabe wird nichts ausgerollt; ein Rückroll braucht einen unversehrten Vorgänger.",
    columns: [
      {key: "releaseId", label: "Release"},
      {key: "buildId", label: "Build-ID"},
      {key: "state", label: "Zustand"},
      {key: "files", label: "Dateien"},
      {key: "createdAt", label: "Erstellt"}
    ]
  },
  Tests: {
    url: "/api/cicd",
    path: ["pipelines"],
    note: "Prüfungen der Pipeline (LINT/TYPECHECK/UNIT/INTEGRATION/SECURITY/BUILD/SMOKE) und Regressionsnachweise je Fehlerfall.",
    columns: [
      {key: "id", label: "Pipeline"},
      {key: "stage", label: "Stufe"},
      {key: "checks", label: "Prüfergebnisse", render: row => (Array.isArray(row.checks) && row.checks.length > 0 ? (row.checks as {kind: string; status: string; summary?: string}[]).map(check => `${check.kind}=${check.status}${check.summary ? ` (${check.summary})` : ""}`).join(" · ") : "keine erfasst")}
    ]
  },
  Tools: {
    url: "/api/tools",
    path: ["tools"],
    note: "Werkzeug-Registry: Jede Ausführung geht über Gate und Broker, nie direkt.",
    columns: [
      {key: "id", label: "Werkzeug"},
      {key: "name", label: "Name"},
      {key: "version", label: "Version"},
      {key: "risk", label: "Risiko"},
      {key: "network", label: "Netzwerk"},
      {key: "capabilities", label: "Capabilities", render: row => (Array.isArray(row.capabilities) ? (row.capabilities as string[]).join(", ") : "—")}
    ]
  },
  Skills: {
    url: "/api/skills",
    path: ["skills"],
    note: "Skills sind registrierte Fähigkeiten mit Risiko und Tests.",
    columns: [
      {key: "id", label: "Skill"},
      {key: "name", label: "Name"},
      {key: "risk", label: "Risiko"},
      {key: "version", label: "Version"},
      {key: "tests", label: "Tests", render: row => (Array.isArray(row.tests) ? (row.tests as string[]).join(", ") : "—")}
    ]
  },
  Workshop: {
    url: "/api/workshop",
    path: ["items"],
    note: "Agenten-Werkstatt: Werkzeuge, Skills, Adapter entstehen und werden über Stufen bis REGISTERED geführt.",
    columns: [
      {key: "id", label: "Objekt"},
      {key: "name", label: "Name"},
      {key: "kind", label: "Art"},
      {key: "stage", label: "Stufe"},
      {key: "version", label: "Version"},
      {key: "risk", label: "Risiko"}
    ]
  },
  Simulation: {
    url: "/api/simulation",
    path: ["scenarios"],
    note: "Szenarien mit Annahmen und erwarteten Zuständen (Simulation ist kein Nachweis).",
    columns: [
      {key: "id", label: "Szenario"},
      {key: "name", label: "Name"},
      {key: "kind", label: "Art"},
      {key: "state", label: "Zustand"},
      {key: "assumptions", label: "Annahmen", render: row => (Array.isArray(row.assumptions) ? (row.assumptions as string[]).join(" · ") : "—")}
    ]
  },
  Gallery: {
    url: "/api/gallery",
    path: ["entries"],
    note: "Erstellungsschritte, zeitgestempelt und für die Fehlerrekonstruktion erhalten.",
    columns: [
      {key: "id", label: "Eintrag"},
      {key: "kind", label: "Art"},
      {key: "title", label: "Titel"},
      {key: "status", label: "Status"},
      {key: "actor", label: "Akteur"},
      {key: "timestamp", label: "Zeit"}
    ]
  },
  Apps: {
    url: "/api/apps",
    path: ["apps"],
    note: "App-Module werden erst nach Tests, Sicherheitsvalidierung und Bestätigung aktiv.",
    columns: [
      {key: "id", label: "App"},
      {key: "name", label: "Name"},
      {key: "state", label: "Zustand"},
      {key: "progress", label: "Fortschritt", render: row => `${String(row.progress ?? 0)}%`},
      {key: "modules", label: "Module", render: row => (Array.isArray(row.modules) ? String((row.modules as unknown[]).length) : "0")}
    ]
  }
};

type Snapshot = {
  agents: Agent[];
  missions: Mission[];
  objectives?: {objectiveId: string; missionId: string; title: string; status: string; description?: string}[];
  tasks: {taskId: string; title: string; status: Status; progress: number; risk: string; assignedAgent: string | null; requiresApproval: boolean}[];
  experiments: Experiment[];
  sandboxes: Sandbox[];
  events: Event[];
  approvals: {id: string; approvalId?: string; taskId: string; status: string; reason: string; createdAt?: string}[];
  locked: boolean;
};

type TimelineEntry = Event & {sequence: number};

/** „Warum?“-Record (Abschnitt 12) — dokumentierte Begründung, keine Gedankenkette. */
type WhyRecordView = {
  eventId: string;
  type: string;
  message: string;
  timestamp: string;
  statusLabel: string;
  actor: string;
  action?: string;
  decision?: string;
  purpose?: string;
  result?: string;
  authorizationRef?: string;
  provenanceRef?: string;
  chain: {eventId: string; sequence: number; type: string; message: string; actor: string; decision?: string; purpose?: string}[];
  evidence: {evidenceId: string; claim: string; value: string; knowledgeState: string}[];
  knowledge: {knowledgeId: string; subject: string; predicate: string; object: string; state: string}[];
  limitations: string[];
};

type ErrorIncident = {
  incidentId?: string;
  id?: string;
  timestamp: string;
  status: string;
  severity: string;
  symptom: string;
  incident: string;
  rootCause?: string;
  hypothesis?: string;
  failureId?: string;
  taskId?: string;
  agentId?: string;
  recoveryId?: string;
  recoveryTier?: number;
  recoveryReasons?: string[];
  recoveryRequiresApproval?: boolean;
  regressionId?: string;
  knowledgeId?: string;
  diagnosticSandboxId?: string;
};

type InboxItem = {
  inboxId: string;
  mode: string;
  title: string;
  message: string;
  resolved: boolean;
  resolvedBy?: string | null;
  decision?: string | null;
  createdAt: string;
  taskId?: string;
  incidentId?: string;
};

type PanelState = {rows: Row[] | null; error: string};

const panel = (rows: Row[] | null, error = ""): PanelState => ({rows, error});

/** Ereignis-IDs des kanonischen Logs (`EVT-…`) — nur diese sind abfragbar. */
const isKnownEventId = (id: string): boolean => /^EVT-[A-Za-z0-9-]{4,80}$/.test(id);

async function fetchJson<T>(url: string): Promise<{data: T | null; status: number; error: string}> {
  try {
    const response = await fetch(url, {cache: "no-store"});
    if (!response.ok) {
      const body = (await response.json().catch(() => ({}))) as {error?: string; message?: string};
      return {data: null, status: response.status, error: body.message ?? body.error ?? `HTTP ${response.status}`};
    }
    return {data: (await response.json()) as T, status: response.status, error: ""};
  } catch (cause) {
    return {data: null, status: 0, error: cause instanceof Error ? cause.message : "Netzwerkfehler"};
  }
}

function pick(body: unknown, path?: string[]): Row[] {
  if (Array.isArray(body)) return body as Row[];
  if (!path || path.length === 0) return [];
  let current: unknown = body;
  for (const key of path) {
    if (!current || typeof current !== "object") return [];
    current = (current as Record<string, unknown>)[key];
  }
  return Array.isArray(current) ? (current as Row[]) : [];
}

export default function ControlCenter() {
  const [section, setSection] = useState<SectionId>("Overview");
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [timeline, setTimeline] = useState<TimelineEntry[] | null>(null);
  const [whyOpen, setWhyOpen] = useState<string | null>(null);
  const [why, setWhy] = useState<WhyRecordView | null>(null);
  const [whyError, setWhyError] = useState("");
  const [panels, setPanels] = useState<Partial<Record<SectionId, PanelState>>>({});
  const [incidents, setIncidents] = useState<ErrorIncident[] | null>(null);
  const [inbox, setInbox] = useState<InboxItem[] | null>(null);
  const [metricsText, setMetricsText] = useState<string | null>(null);
  const [runtime, setRuntime] = useState<Row | null>(null);
  const [persistence, setPersistence] = useState<Row | null>(null);
  /** Intervall in lesbarer Form (rein darstellend, keine Zustandsänderung). */
  const formatInterval = (value: unknown): string => {
    const ms = typeof value === "number" && Number.isFinite(value) ? value : Number(value);
    if (!Number.isFinite(ms) || ms <= 0) return "—";
    if (ms % 3_600_000 === 0) return `${ms / 3_600_000} h`;
    if (ms % 60_000 === 0) return `${ms / 60_000} min`;
    return `${Math.round(ms / 1000)} s`;
  };
  const [readiness, setReadiness] = useState<Row | null>(null);
  const [deployment, setDeployment] = useState<Row | null>(null);
  const [audit, setAudit] = useState<Row | null>(null);
  const [provenance, setProvenance] = useState<Row | null>(null);
  const [governance, setGovernance] = useState<Row | null>(null);
  const [capabilities, setCapabilities] = useState<Row | null>(null);
  const [privacy, setPrivacy] = useState<Row | null>(null);
  const [artifacts, setArtifacts] = useState<Row[] | null>(null);
  const [verifyResult, setVerifyResult] = useState("");
  const [alertRules, setAlertRules] = useState<Row[] | null>(null);
  const [alertValidation, setAlertValidation] = useState<Row | null>(null);
  const [renderKind, setRenderKind] = useState("ARCHITECTURE");
  const [renderBusy, setRenderBusy] = useState(false);
  const [render, setRender] = useState<{artifactId: string; digest: string; kind: string; scenarioId: string; bytes: number; nodes: number; truncated: boolean} | null>(null);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [auth, setAuth] = useState<{authenticated: boolean; requiresBootstrap: boolean; revoked: boolean; loginAvailable?: boolean; locked?: boolean; secondFactor?: string} | null>(null);
  const [authBusy, setAuthBusy] = useState(false);
  const [authError, setAuthError] = useState("");
  const [loadedOnce, setLoadedOnce] = useState(false);

  const load = useCallback(async () => {
    const control = await fetchJson<Snapshot>("/api/control");
    if (control.status === 401 || control.status === 423 || control.status === 428) {
      const status = await fetchJson<{authenticated?: boolean; requiresBootstrap?: boolean; revoked?: boolean; loginAvailable?: boolean; locked?: boolean; secondFactor?: string}>("/api/auth");
      setAuth({
        authenticated: Boolean(status.data?.authenticated),
        requiresBootstrap: Boolean(status.data?.requiresBootstrap),
        revoked: Boolean(status.data?.revoked),
        loginAvailable: Boolean(status.data?.loginAvailable),
        locked: Boolean(status.data?.locked),
        secondFactor: status.data?.secondFactor
      });
      setAuthError(control.status === 428 ? "System nicht initialisiert – Creator-Bootstrap erforderlich." : control.status === 423 ? "Root Authority widerrufen – System ist fail closed." : "Session abgelaufen oder nicht vorhanden.");
      setLoadedOnce(true);
      return;
    }
    if (!control.data) {
      setError(`Control Plane nicht erreichbar: ${control.error}`);
      setLoadedOnce(true);
      return;
    }
    setAuth({authenticated: true, requiresBootstrap: false, revoked: false});
    setSnapshot(control.data);
    setError("");

    const [tl, errRes, inboxRes, gov, caps, prov, auditRes, priv, persistenceRes, readinessRes, artifactsRes, runtimeRes, deploymentRes] = await Promise.all([
      fetchJson<{timeline: TimelineEntry[]}>("/api/timeline"),
      fetchJson<{incidents: ErrorIncident[]}>("/api/errors"),
      fetchJson<{items: InboxItem[]}>("/api/inbox"),
      fetchJson<Row>("/api/governance"),
      fetchJson<Row>("/api/capabilities"),
      fetchJson<Row>("/api/provenance"),
      fetchJson<Row>("/api/audit"),
      fetchJson<Row>("/api/privacy"),
      fetchJson<Row>("/api/persistence"),
      fetchJson<Row>("/api/readiness"),
      fetchJson<{artifacts: Row[]}>("/api/artifacts"),
      fetchJson<Row>("/api/runtime"),
      fetchJson<Row>("/api/deployment")
    ]);
    setTimeline(tl.data?.timeline ?? null);
    setIncidents(errRes.data?.incidents ?? null);
    setInbox(inboxRes.data?.items ?? null);
    setGovernance(gov.data);
    setCapabilities(caps.data);
    setProvenance(prov.data);
    setAudit(auditRes.data);
    setPrivacy(priv.data);
    setPersistence(persistenceRes.data);
    setReadiness(readinessRes.data);
    setDeployment(deploymentRes.data);
    setArtifacts(artifactsRes.data?.artifacts ?? null);
    setRuntime(runtimeRes.data);

    // Modulare Abschnitte: eine Anfrage je Abschnitt, Fehler bleiben sichtbar.
    const sources = Object.entries(SOURCES) as [SectionId, NonNullable<(typeof SOURCES)[SectionId]>][];
    const results = await Promise.all(
      sources.map(async ([id, source]) => {
        const response = await fetchJson<unknown>(source.url);
        if (response.data === null) return [id, panel(null, response.error)] as const;
        return [id, panel(pick(response.data, source.path))] as const;
      })
    );
    setPanels(Object.fromEntries(results));
    setLoadedOnce(true);
  }, []);

  const loadMetrics = useCallback(async () => {
    try {
      const response = await fetch("/api/metrics", {cache: "no-store"});
      setMetricsText(response.ok ? await response.text() : `Metriken nicht verfügbar (HTTP ${response.status})`);
    } catch (cause) {
      setMetricsText(cause instanceof Error ? cause.message : "Metriken nicht verfügbar");
    }
  }, []);

  useEffect(() => {
    void load();
    const timer = setInterval(() => void load(), 5000);
    return () => clearInterval(timer);
  }, [load]);

  // Metriken werden beim Öffnen des Abschnitts einmal automatisch gelesen (der
  // Prometheus-Export ist ein Textdump und gehört nicht ins 5-Sekunden-Polling).
  // Der Knopf bleibt als Aktualisierung.
  const metricsRead = useRef(false);
  useEffect(() => {
    if (section !== "Metrics" || metricsRead.current) return;
    metricsRead.current = true;
    void loadMetrics();
    void loadAlerts();
  }, [section, loadMetrics]);

  /**
   * „Warum?“-Record zu einem Ereignis (Abschnitt 12). Bewusst nur auf Klick:
   * Die Timeline darf nicht je Eintrag eine Anfrage auslösen. Der Record wird
   * unverändert angezeigt (inklusive der benannten Grenzen), nicht geglättet.
   */
  const loadWhy = async (eventId: string) => {
    if (whyOpen === eventId) {
      setWhyOpen(null);
      setWhy(null);
      setWhyError("");
      return;
    }
    setWhyOpen(eventId);
    setWhy(null);
    setWhyError("");
    const response = await fetchJson<WhyRecordView>(`/api/events/${encodeURIComponent(eventId)}/why`);
    if (!response.data) {
      setWhyError(response.error || `HTTP ${response.status}`);
      return;
    }
    setWhy(response.data);
  };

  const post = async (url: string, body: Record<string, unknown>) => {
    setNotice("");
    try {
      const response = await fetch(url, {method: "POST", headers: {"content-type": "application/json"}, body: JSON.stringify(body)});
      const payload = (await response.json().catch(() => ({}))) as {error?: string; message?: string};
      setNotice(response.ok ? `Aktion ausgeführt (HTTP ${response.status}).` : `Abgelehnt: ${payload.message ?? payload.error ?? response.status}`);
    } catch (cause) {
      setNotice(cause instanceof Error ? cause.message : "Aktion fehlgeschlagen");
    }
    await load();
  };

  /** Alarmregeln samt Prüfergebnis (nur Metadaten, keine Geheimnisse). */
  const loadAlerts = useCallback(async () => {
    try {
      const response = await fetch("/api/alerts");
      if (!response.ok) {
        setAlertRules(null);
        setAlertValidation(null);
        return;
      }
      const body = (await response.json()) as {rules?: Row[]; validation?: Row};
      setAlertRules(body.rules ?? []);
      setAlertValidation(body.validation ?? null);
    } catch {
      setAlertRules(null);
      setAlertValidation(null);
    }
  }, []);

  /** Wie `post`, gibt aber Status und Nutzdaten zurück (für bedingte Anzeigen). */
  const postResult = async (url: string, body: Record<string, unknown>) => {
    try {
      const response = await fetch(url, {method: "POST", headers: {"content-type": "application/json"}, body: JSON.stringify(body)});
      const json = (await response.json().catch(() => null)) as Record<string, unknown> | null;
      return {ok: response.ok, status: response.status, json};
    } catch (cause) {
      return {ok: false, status: 0, json: {message: cause instanceof Error ? cause.message : "Aktion fehlgeschlagen"}};
    }
  };

  /**
   * Rendert ein Szenario serverseitig als SVG. Der Renderer prüft aktiv auf
   * aktive Inhalte und begrenzt die Größe; das Ergebnis wird als Evidenz-
   * Artefakt mit Digest abgelegt (SIMULATION — kein Nachweis).
   */
  const renderScenario = async (id: string, kind: string) => {
    if (!id) {
      setNotice("Kein Szenario vorhanden — zuerst ein Szenario anlegen.");
      return;
    }
    setRenderBusy(true);
    setNotice("");
    try {
      const result = await postResult("/api/simulation", {action: "render", id, kind});
      const payload = result.json as {render?: {artifactId?: string; digest?: string; bytes?: number; nodes?: number; truncated?: boolean}; message?: string; error?: string} | null;
      const rendered = payload?.render;
      if (!result.ok || !rendered) {
        setRender(null);
        setNotice(`Verweigert: ${String(payload?.message ?? payload?.error ?? "Visualisierung nicht möglich")}`);
        return;
      }
      setRender({
        artifactId: String(rendered.artifactId ?? ""),
        digest: String(rendered.digest ?? ""),
        kind,
        scenarioId: id,
        bytes: Number(rendered.bytes ?? 0),
        nodes: Number(rendered.nodes ?? 0),
        truncated: Boolean(rendered.truncated)
      });
      setNotice(`Visualisierung gerendert (HTTP ${result.status}) · Artefakt ${String(rendered.artifactId ?? "—")}`);
      await load();
    } catch (cause) {
      setNotice(cause instanceof Error ? cause.message : "Visualisierung fehlgeschlagen");
    } finally {
      setRenderBusy(false);
    }
  };

  const verifyArtifact = async (id: string) => {
    const result = await fetchJson<{verification: {ok: boolean; error?: string}}>(`/api/artifacts?verify=${encodeURIComponent(id)}`);
    setVerifyResult(
      result.data
        ? `${id}: ${result.data.verification.ok ? "Digest bestätigt" : `Prüfung fehlgeschlagen (${result.data.verification.error ?? "Digest weicht ab"})`}`
        : `${id}: Prüfung nicht möglich (${result.error})`
    );
  };

  const submitAuth = async (event: React.FormEvent<HTMLFormElement>, mode: "bootstrap" | "login") => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setAuthBusy(true);
    setAuthError("");
    try {
      const response = await fetch("/api/auth", {
        method: "POST",
        headers: {"content-type": "application/json"},
        body: JSON.stringify(
          mode === "bootstrap"
            ? {action: "bootstrap", secret: String(form.get("secret") ?? ""), creatorName: String(form.get("creatorName") ?? "")}
            : {action: "login", secret: String(form.get("secret") ?? ""), totpCode: String(form.get("totpCode") ?? "") || undefined}
        )
      });
      const payload = (await response.json().catch(() => ({}))) as {message?: string; code?: string};
      if (!response.ok) {
        setAuthError(String(payload.message ?? payload.code ?? (response.status === 423 ? "Gesperrt (zu viele Fehlversuche)" : "Verweigert")));
        setAuth(current => ({authenticated: false, requiresBootstrap: mode === "bootstrap", revoked: Boolean(current?.revoked), loginAvailable: Boolean(current?.loginAvailable ?? true), locked: response.status === 423}));
        return;
      }
      await load();
    } catch (cause) {
      setAuthError(cause instanceof Error ? cause.message : "Anmeldung fehlgeschlagen");
    } finally {
      setAuthBusy(false);
    }
  };

  const rowsFor = (id: SectionId): PanelState => panels[id] ?? panel(null);
  const locked = Boolean(snapshot?.locked);
  const activeGroup = useMemo(() => NAV.find(entry => entry.id === section)?.group ?? "", [section]);
  const emptyText = (state: PanelState) => (state.rows === null ? (loadedOnce ? `nicht verfügbar${state.error ? ` (${state.error})` : ""}` : "wird geladen …") : "keine Einträge vorhanden");

  if (auth && !auth.authenticated)
    return (
      <main className="shell">
        <section className="content">
          <header>
            <div>
              <small>SERVER-AUTHENTIFIZIERUNG</small>
              <h1>Creator-Zugang</h1>
            </div>
            <div className="headerActions">
              <span className="privacy">SESSION · HTTPONLY</span>
            </div>
          </header>
          <section className="panel sectionPanel">
            <small>BOOTSTRAP / SESSION</small>
            <h2>{auth.revoked ? "Root Authority widerrufen" : auth.requiresBootstrap ? "Creator-Bootstrap" : "Creator-Anmeldung"}</h2>
            <p>
              Die Control Plane arbeitet ausschließlich mit serverseitigen Sessions. Das Control-Center erhält nur ein HttpOnly-Cookie – niemals Root-,
              Provider-, Geräte- oder Runtime-Secrets.
            </p>
            {auth.revoked ? (
              <div className="integrity">
                <strong>FAIL CLOSED</strong>
                <span>Root Authority wurde widerrufen. Re-Bootstrap ist standardmäßig deaktiviert.</span>
              </div>
            ) : auth.requiresBootstrap ? (
              <form onSubmit={event => void submitAuth(event, "bootstrap")}>
                <label>
                  Creator-Name
                  <input name="creatorName" required minLength={2} defaultValue="Creator" />
                </label>
                <label>
                  Bootstrap-Secret
                  <input name="secret" type="password" required autoComplete="off" />
                </label>
                <button type="submit" disabled={authBusy}>
                  {authBusy ? "Prüfe…" : "Bootstrap abschließen"}
                </button>
                {authError && <small>{authError}</small>}
              </form>
            ) : (
              <form onSubmit={event => void submitAuth(event, "login")}>
                <label>
                  Creator-Secret
                  <input name="secret" type="password" required autoComplete="off" disabled={Boolean(auth.locked)} />
                </label>
                <label>
                  Zweiter Faktor ({auth.secondFactor === "TOTP" ? "TOTP erforderlich" : "TOTP nicht konfiguriert"})
                  <input name="totpCode" inputMode="numeric" pattern="[0-9]*" maxLength={6} autoComplete="one-time-code" disabled={Boolean(auth.locked)} />
                </label>
                <button type="submit" disabled={authBusy || Boolean(auth.locked)}>
                  {authBusy ? "Prüfe…" : auth.locked ? "Gesperrt (zu viele Fehlversuche)" : "Als Creator anmelden"}
                </button>
                <small>
                  Server-seitiges Secret: Datei <code>&lt;BOB_STORAGE_DIR&gt;/creator-token</code> (0600) oder <code>BOB_CREATOR_LOGIN_SECRET</code>. Das
                  Secret verlässt den Server nie.
                </small>
                {authError && <small>{authError}</small>}
              </form>
            )}
          </section>
        </section>
      </main>
    );

  /**
   * Deployment-Ansicht (Abschnitt 24): Slots, aktiver Zeiger und der Stand, den
   * der laufende Server wirklich meldet. Die wichtigste Aussage ist die
   * Differenz dazwischen — „Zeiger umgestellt" ist kein ausgerollter Stand.
   */
  const deploymentPanel = () => {
    const state = rowsFor("Deployment");
    const snapshot = deployment as {
      current?: string | null;
      runningBuildId?: string | null;
      runningReleaseId?: string | null;
      selfUrl?: string;
      root?: string;
      workingDirectory?: string;
      runningReason?: string;
      releases?: {manifest?: {releaseId?: string; buildId?: string}; state?: string}[];
      deployments?: Row[];
      store?: {ok?: boolean};
    } | null;
    const releases = snapshot?.releases ?? [];
    const deployments = snapshot?.deployments ?? [];
    const active = releases.find(entry => entry.manifest?.releaseId === snapshot?.current);
    // „Ausgerollt“ verlangt beides: gleiche Build-ID **und** Start aus dem Slot.
    // Ein zufällig gleicher Build aus dem Quellbaum zählt nicht (siehe lib/deployment.ts).
    const runningMatches = Boolean(active && snapshot?.runningBuildId && active.manifest?.buildId === snapshot.runningBuildId && snapshot.runningReleaseId === snapshot.current);
    const sameBuildOtherCwd = Boolean(active && snapshot?.runningBuildId && active.manifest?.buildId === snapshot.runningBuildId && snapshot.runningReleaseId !== snapshot.current);
    return (
      <>
        <section className="panel sectionPanel">
          <small>LIEFERKETTE / AUSROLLEN</small>
          <h2>Deployment</h2>
          <p>
            Ausrollen erfolgt nur mit bestandenen Promotion-Gates <strong>und</strong> gewährter Creator-Freigabe. Ein Rückroll braucht einen
            unversehrten Vorgänger. „Aktiv“ ist keine Behauptung: Es gilt erst, wenn der laufende Server die Build-ID des Slots meldet.
          </p>
          <div className="metrics">
            {[
              {k: "Slots", v: String(releases.length), s: `${releases.filter(entry => entry.state === "DEFECTIVE").length} mit Digest-Abweichung`},
              {k: "Aktiver Zeiger", v: snapshot?.current ?? "—", s: snapshot?.current ? "current-Symlink" : "kein Release aktiv"},
              {k: "Laufende Build-ID", v: snapshot?.runningBuildId ?? "unbekannt", s: snapshot?.runningReleaseId ? `aus ${snapshot.runningReleaseId}` : `aus ${snapshot?.workingDirectory ?? "unbekanntem Verzeichnis"}`},
              {k: "Ausgerollt", v: runningMatches ? "JA" : "NEIN", s: runningMatches ? "läuft aus dem aktiven Slot" : sameBuildOtherCwd ? "gleiche Build-ID, aber nicht aus dem Slot gestartet" : "Neustart über scripts/release-supervisor.sh erforderlich"}
            ].map(metric => (
              <div className="metric" key={metric.k}>
                <small>{metric.k}</small>
                <strong>{metric.v}</strong>
                <span>{metric.s}</span>
              </div>
            ))}
          </div>
          {snapshot && !runningMatches && (
            <div className="integrity">
              <strong>NICHT AUSGEROLLT</strong>
              <span>
                {sameBuildOtherCwd
                  ? "Der laufende Prozess liefert dieselbe Build-ID, startet aber nicht aus dem Slot — das ist noch kein Ausrollen. "
                  : "Der aktive Zeiger und der laufende Prozess stimmen nicht überein. "}
                Der Wechsel samt Neustart und Rückroll bei fehlender Gesundheit erfolgt über{" "}
                <code>bash scripts/release-supervisor.sh --release {snapshot.current ?? "REL-…"}</code> — die Plattform startet sich nicht selbst neu.
              </span>
            </div>
          )}
          <p className="emptyNote">
            Ablage: {snapshot?.root ?? "—"} · Selbstprüfung: {snapshot?.selfUrl ?? "—"} · Store{" "}
            {snapshot?.store?.ok === false ? "nicht integer" : "integer"}
          </p>
        </section>
        {genericTable("Deployment")}
        <section className="panel sectionPanel">
          <small>LIEFERKETTE / VERLAUF</small>
          <h2>Deployment-Vorgänge</h2>
          <p>
            Jeder Vorgang mit Health-Checks, Zielzustand und Gründen. Verweigerte Vorgänge bleiben sichtbar (<code>REJECTED</code>) — sie sind der
            Nachweis, dass die Gates greifen. Nicht bestandene, aber ausdrücklich quittierte Prüfungen stehen als Lücke im Datensatz.
          </p>
          {deployments.length === 0 ? (
            <p className="emptyNote">{state.rows === null ? emptyText(state) : "keine Ausrollvorgänge dokumentiert"}</p>
          ) : (
            <div className="dataTable">
              <div className="dataRow head">
                {["Vorgang", "Release", "Ziel", "Zustand", "Ausgerollt", "Lücken", "Zeit"].map(column => (
                  <span key={column}>{column}</span>
                ))}
              </div>
              {deployments.map(entry => (
                <div className="dataRow" key={String(entry.deploymentId)}>
                  <span>{String(entry.deploymentId)}</span>
                  <span>{String(entry.releaseId)}</span>
                  <span>{String(entry.target)}</span>
                  <span className="state">{isKnownStatus(String(entry.state)) ? <StatusBadge status={entry.state as Status} /> : String(entry.state)}</span>
                  <span>{entry.verifiedActive ? "ja" : entry.restartRequired ? "nein — Neustart nötig" : "nein"}</span>
                  <span>{Array.isArray(entry.acknowledgedGaps) && (entry.acknowledgedGaps as string[]).length > 0 ? (entry.acknowledgedGaps as string[]).join(" · ") : "keine"}</span>
                  <span>{String(entry.startedAt ?? "—")}</span>
                </div>
              ))}
            </div>
          )}
        </section>
      </>
    );
  };

  const genericTable = (id: SectionId) => {
    const source = SOURCES[id];
    const state = rowsFor(id);
    const rows = state.rows ?? [];
    return (
      <section className="panel sectionPanel">
        <small>
          {activeGroup.toUpperCase()} / {NAV.find(entry => entry.id === id)?.label.toUpperCase()}
        </small>
        <h2>{NAV.find(entry => entry.id === id)?.label}</h2>
        <p>{source?.note ?? ""}</p>
        {rows.length === 0 ? (
          <p className="emptyNote">{emptyText(state)}</p>
        ) : (
          <div className="dataTable">
            <div className="dataRow head">
              {source?.columns.map(column => <span key={column.key}>{column.label}</span>)}
            </div>
            {rows.map((row, index) => (
              <div className="dataRow" key={String(row.id ?? row[source?.columns[0].key ?? "id"] ?? index)}>
                {source?.columns.map(column => {
                  const raw = column.render ? column.render(row) : String(row[column.key] ?? "—");
                  // Zustandsspalten laufen ausschließlich über das Status-Modell
                  // (lib/status.ts): Text und Farbe kommen aus einer Quelle. Ein
                  // Wert außerhalb des Modells wird als Text gezeigt — nie als
                  // „gesund“ eingefärbt.
                  if (column.key === "status" || column.key === "state")
                    return (
                      <span key={column.key} className="state">
                        {isKnownStatus(raw) ? <StatusBadge status={raw} /> : raw}
                      </span>
                    );
                  return <span key={column.key}>{raw}</span>;
                })}
              </div>
            ))}
          </div>
        )}
      </section>
    );
  };

  const content = () => {
    if (section === "Overview") {
      const agents = snapshot?.agents ?? [];
      const tasks = snapshot?.tasks ?? [];
      const experiments = snapshot?.experiments ?? [];
      const avg = Math.round([...agents, ...tasks, ...experiments].reduce((sum, item) => sum + item.progress, 0) / Math.max(1, [...agents, ...tasks, ...experiments].length));
      return (
        <>
          <div className="metrics">
            {[
              {k: "Agenten", v: String(agents.length).padStart(2, "0"), s: `${agents.filter(agent => ["RUNNING", "EXECUTING"].includes(agent.status)).length} aktiv`},
              {k: "Fortschritt", v: `${avg}%`, s: "laufende Arbeit"},
              {k: "Aufgaben", v: String(tasks.length).padStart(2, "0"), s: `${tasks.filter(task => task.status === "RUNNING").length} laufend`},
              {k: "Fehlerfälle", v: String(incidents?.length ?? 0).padStart(2, "0"), s: `${(incidents ?? []).filter(incident => incident.status !== "REGRESSION_LOCKED").length} offen`},
              {k: "Inbox", v: String((inbox ?? []).filter(item => !item.resolved).length).padStart(2, "0"), s: "unbeantwortet"}
            ].map(metric => (
              <div className="metric" key={metric.k}>
                <small>{metric.k}</small>
                <strong>{metric.v}</strong>
                <span>{metric.s}</span>
              </div>
            ))}
          </div>
          <div className="grid">
            <section className="panel">
              <div className="panelHead">
                <div>
                  <small>AGENT OBSERVATORY</small>
                  <h2>Agenten (11 Rollen)</h2>
                </div>
                <span className="live">● LIVE</span>
              </div>
              {agents.length === 0 && <p className="emptyNote">{loadedOnce ? "Keine Agenten geladen." : "wird geladen …"}</p>}
              {agents.map(agent => (
                <div className="agent" key={agent.agentId}>
                  <div className="avatar">{agent.name[0]}</div>
                  <div className="agentMain">
                    <div className="agentTitle">
                      <b>{agent.name}</b>
                      <span>{agent.role}</span>
                      <StatusBadge status={agent.status} />
                    </div>
                    <div className="bar">
                      <i style={{width: `${agent.progress}%`}} />
                    </div>
                    <small>
                      {agent.agentId} · {agent.kind} · {agent.progress}% · Health {agent.health}
                    </small>
                  </div>
                </div>
              ))}
            </section>
            <section className="panel">
              <div className="panelHead">
                <div>
                  <small>CREATOR INBOX</small>
                  <h2>Was der Creator wissen muss</h2>
                </div>
                <span className="live">{inbox ? `${inbox.filter(item => !item.resolved).length} offen` : "—"}</span>
              </div>
              {(inbox ?? []).slice(0, 6).map(item => (
                <div className="event" key={item.inboxId}>
                  <span className={"badge " + (item.mode === "BLOCK" || item.mode === "ESCALATE" ? "error" : item.mode === "ASK" ? "running" : "completed")}>
                    <i /> {item.mode}
                  </span>
                  <div>
                    <b>{item.title}</b>
                    <span>{item.message}</span>
                    <small>
                      {item.resolved ? `beantwortet (${item.decision ?? "ACKNOWLEDGED"})` : "offen"} · {item.createdAt}
                    </small>
                  </div>
                </div>
              ))}
              {(inbox ?? []).length === 0 && <p className="emptyNote">{inbox === null ? "nicht verfügbar" : "Inbox ist leer."}</p>}
            </section>
          </div>
          <section className="panel" style={{marginTop: "14px"}}>
            <div className="panelHead">
              <div>
                <small>TIMELINE</small>
                <h2>Letzte Ereignisse</h2>
              </div>
              <button onClick={() => void post("/api/control", {action: "guardian"})} disabled={locked}>
                Guardian-Prüfung
              </button>
            </div>
            {(timeline ?? []).slice(-10).reverse().map(entry => (
              <div className="event" key={entry.id}>
                <StatusBadge status={entry.status} />
                <div>
                  <b>{entry.type}</b>
                  <span>{entry.message}</span>
                  <small>
                    #{entry.sequence} · {entry.actor} · {entry.time}
                  </small>
                </div>
              </div>
            ))}
            {(timeline ?? []).length === 0 && <p className="emptyNote">{timeline === null ? "nicht verfügbar" : "keine Ereignisse vorhanden"}</p>}
          </section>
        </>
      );
    }

    if (section === "Errors") {
      return (
        <section className="panel sectionPanel">
          <small>ERROR INTELLIGENCE</small>
          <h2>Fehlerfälle</h2>
          <p>Lebenszyklus: DETECTED → DIAGNOSING → EXPERIMENTING → ROOT_CAUSE_FOUND → FIXING → VERIFYING → LEARNED → REGRESSION_LOCKED.</p>
          {(incidents ?? []).length === 0 && <p className="emptyNote">{incidents === null ? (loadedOnce ? "nicht verfügbar" : "wird geladen …") : "keine Fehlerfälle erfasst"}</p>}
          {(incidents ?? []).slice(0, 40).map(incident => {
            const id = incident.incidentId ?? incident.id ?? "—";
            return (
              <div className="experiment" key={id}>
                <div>
                  <b>
                    {id} · {incident.incident}
                  </b>
                  <StatusBadge status={incident.status === "REGRESSION_LOCKED" ? "COMPLETED" : incident.severity === "CRITICAL" ? "ERROR" : "WAITING"} />
                </div>
                <span>{incident.symptom}</span>
                <small>
                  {incident.status} · Schwere {incident.severity} · Task {incident.taskId ?? "—"} · Agent {incident.agentId ?? "—"}
                </small>
                <small>
                  <b>Why?</b> Ursache {incident.rootCause ?? "nicht ermittelt"} · Hypothese {incident.hypothesis ?? "—"} · Recovery-Stufe{" "}
                  {incident.recoveryTier ?? "—"}
                  {incident.recoveryRequiresApproval ? " (Creator-Freigabe nötig)" : ""} · Regression {incident.regressionId ?? "—"} · Wissen{" "}
                  {incident.knowledgeId ?? "—"}
                </small>
                {(incident.recoveryReasons ?? []).length > 0 && <small>Begründung: {(incident.recoveryReasons ?? []).join(" · ")}</small>}
              </div>
            );
          })}
        </section>
      );
    }

    if (section === "Inbox") {
      return (
        <section className="panel sectionPanel">
          <small>CREATOR INBOX</small>
          <h2>Posteingang (INFORM / ASK / BLOCK / ESCALATE)</h2>
          <p>Antworten sind Creator-Akte und werden serverseitig geprüft; Agenten können nur eintragen.</p>
          {(inbox ?? []).length === 0 && <p className="emptyNote">{inbox === null ? (loadedOnce ? "nicht verfügbar" : "wird geladen …") : "Inbox ist leer."}</p>}
          {(inbox ?? []).map(item => (
            <div className="experiment" key={item.inboxId}>
              <div>
                <b>
                  {item.mode} · {item.title}
                </b>
                <span>{item.resolved ? `beantwortet von ${item.resolvedBy ?? "—"} (${item.decision ?? "ACKNOWLEDGED"})` : "offen"}</span>
              </div>
              <span>{item.message}</span>
              <small>
                {item.inboxId} · {item.createdAt}
                {item.taskId ? ` · Task ${item.taskId}` : ""}
                {item.incidentId ? ` · Fehlerfall ${item.incidentId}` : ""}
              </small>
              {!item.resolved && (
                <div className="headerActions" style={{marginTop: "8px"}}>
                  <button onClick={() => void post("/api/inbox", {action: "resolve", id: item.inboxId, decision: "ACKNOWLEDGED"})}>Bestätigen</button>
                  <button onClick={() => void post("/api/inbox", {action: "resolve", id: item.inboxId, decision: "APPROVED"})}>Freigeben</button>
                  <button onClick={() => void post("/api/inbox", {action: "resolve", id: item.inboxId, decision: "REJECTED"})}>Ablehnen</button>
                </div>
              )}
            </div>
          ))}
        </section>
      );
    }

    if (section === "Approvals") {
      return (
        <>
          {genericTable("Approvals")}
          <section className="panel sectionPanel">
            <small>APPROVAL CENTER</small>
            <h2>Entscheidungen</h2>
            <p>Freigaben sind Creator-Akte; jede Entscheidung wird auditiert. Agenten können Freigaben anfordern, nicht erteilen.</p>
            {snapshot?.approvals.filter(entry => entry.status === "PENDING").length === 0 && <p className="emptyNote">Keine offenen Freigaben.</p>}
            {snapshot?.approvals
              .filter(entry => entry.status === "PENDING")
              .map(entry => (
                <div className="experiment" key={entry.id}>
                  <div>
                    <b>{entry.approvalId ?? entry.id}</b>
                    <span>Task {entry.taskId}</span>
                  </div>
                  <span>{entry.reason}</span>
                  <div className="headerActions" style={{marginTop: "8px"}}>
                    <button onClick={() => void post("/api/control", {action: "approval", id: entry.approvalId ?? entry.id, grant: true})}>Freigeben</button>
                    <button onClick={() => void post("/api/control", {action: "approval", id: entry.approvalId ?? entry.id, grant: false})}>Ablehnen</button>
                  </div>
                </div>
              ))}
          </section>
        </>
      );
    }

    if (section === "Evidence") {
      return (
        <>
          <section className="panel sectionPanel">
            <small>NACHWEIS / EVIDENZ</small>
            <h2>Ausführungs-Evidenz</h2>
            <p>Digest (SHA-256) wird serverseitig über den kanonischen Inhalt gebildet. Die Prüfung berechnet ihn erneut und erkennt Manipulation.</p>
            {(artifacts ?? []).length === 0 && <p className="emptyNote">{artifacts === null ? (loadedOnce ? "nicht verfügbar" : "wird geladen …") : "Keine Evidenz vorhanden."}</p>}
            {(artifacts ?? []).length > 0 && (
              <div className="dataTable">
                <div className="dataRow head">
                  {["Artefakt", "Name", "Art", "Task", "Sandbox", "Agent", "Wissenszustand", "Digest", "Prüfung"].map(column => (
                    <span key={column}>{column}</span>
                  ))}
                </div>
                {(artifacts ?? []).map(artifact => (
                  <div className="dataRow" key={String(artifact.id)}>
                    <span>{String(artifact.id ?? "—")}</span>
                    <span>{String(artifact.name ?? "—")}</span>
                    <span>{String(artifact.kind ?? "—")}</span>
                    <span>{String(artifact.taskId ?? "—")}</span>
                    <span>{String(artifact.sandboxId ?? "—")}</span>
                    <span>{String(artifact.agentId ?? "—")}</span>
                    <span className="state">{String(artifact.knowledgeState ?? "—")}</span>
                    <span>{`${String(artifact.digest ?? "").slice(0, 16)}…${artifact.truncated ? " (gekürzt)" : ""}`}</span>
                    <span>
                      <button onClick={() => void verifyArtifact(String(artifact.id))}>prüfen</button>
                    </span>
                  </div>
                ))}
              </div>
            )}
            {verifyResult && (
              <div className="integrity">
                <strong>DIGEST-PRÜFUNG</strong>
                <span>{verifyResult}</span>
              </div>
            )}
          </section>
          {genericTable("Experiments")}
        </>
      );
    }

    if (section === "Audit") {
      const records = (audit?.records as Row[] | undefined) ?? [];
      const chain = (audit?.chain as Row | undefined) ?? null;
      return (
        <>
          <div className="metrics">
            {[
              {k: "Audit-Datensätze", v: String(records.length), s: "Manipulationsgeschützt (HMAC-Kette)"},
              {k: "Kette", v: chain?.valid ? "INTEGER" : "PRÜFEN", s: chain?.valid ? "Verifikation bestanden" : "Verifikation offen"},
              {k: "Integrität", v: audit?.integrity ? "OK" : "—", s: "Store-Digest"}
            ].map(metric => (
              <div className="metric" key={metric.k}>
                <small>{metric.k}</small>
                <strong>{metric.v}</strong>
                <span>{metric.s}</span>
              </div>
            ))}
          </div>
          {records.length === 0 ? (
            <p className="emptyNote">{audit === null ? "nicht verfügbar" : "keine Audit-Datensätze"}</p>
          ) : (
            <section className="panel sectionPanel">
              <small>NACHWEIS / AUDIT</small>
              <h2>Entscheidungen</h2>
              <p>Jede Entscheidung mit Akteur, Aktion und Ergebnis — Verweigerungen sind auditiert.</p>
              <div className="dataTable">
                <div className="dataRow head">
                  {["Zeit", "Akteur", "Aktion", "Entscheid", "Ressource"].map(column => <span key={column}>{column}</span>)}
                </div>
                {records
                  .slice(-100)
                  .reverse()
                  .map((record, index) => (
                    <div className="dataRow" key={`${String(record.id ?? index)}`}>
                      <span>{String(record.time ?? record.timestamp ?? "—")}</span>
                      <span>{String(record.actor ?? "—")}</span>
                      <span>{String(record.action ?? "—")}</span>
                      <span className="state">{String(record.decision ?? "—")}</span>
                      <span>{String(record.resource ?? "—")}</span>
                    </div>
                  ))}
              </div>
            </section>
          )}
        </>
      );
    }

    if (section === "Provenance") {
      const nodes = (provenance?.nodes as Row[] | undefined) ?? [];
      const edges = (provenance?.edges as Row[] | undefined) ?? [];
      return (
        <>
          <div className="metrics">
            {[
              {k: "Knoten", v: String(nodes.length), s: "Objekte (Task, Sandbox, Evidenz, Wissen)"},
              {k: "Kanten", v: String(edges.length), s: "kausale Beziehungen"},
              {k: "Integrität", v: String(provenance?.integrity ?? "—"), s: "Store-Digest"}
            ].map(metric => (
              <div className="metric" key={metric.k}>
                <small>{metric.k}</small>
                <strong>{metric.v}</strong>
                <span>{metric.s}</span>
              </div>
            ))}
          </div>
          <section className="panel sectionPanel">
            <small>NACHWEIS / PROVENANCE</small>
            <h2>Kausale Beziehungen</h2>
            <p>Jede Kante ist gerichtet und benannt (z. B. AUTHORIZED_BY, EXECUTED_IN, PRODUCED, SUPPORTS).</p>
            {edges.length === 0 ? (
              <p className="emptyNote">{provenance === null ? "nicht verfügbar" : "keine Kanten vorhanden"}</p>
            ) : (
              <div className="dataTable">
                <div className="dataRow head">
                  {["Beziehung", "Von", "Nach"].map(column => <span key={column}>{column}</span>)}
                </div>
                {edges.slice(-200).map((edge, index) => (
                  <div className="dataRow" key={`${String(edge.from)}-${String(edge.to)}-${index}`}>
                    <span className="state">{String(edge.relation ?? "—")}</span>
                    <span>{String(edge.from ?? "—")}</span>
                    <span>{String(edge.to ?? "—")}</span>
                  </div>
                ))}
              </div>
            )}
          </section>
        </>
      );
    }

    if (section === "Timeline") {
      return (
        <section className="panel sectionPanel">
          <small>NACHWEIS / REPLAY</small>
          <h2>Time Machine</h2>
          <p>Chronologische Ereignisse mit kausalem Elternteil — Grundlage der Fehlerrekonstruktion.</p>
          {(timeline ?? []).length === 0 && <p className="emptyNote">{timeline === null ? (loadedOnce ? "nicht verfügbar" : "wird geladen …") : "keine Ereignisse vorhanden"}</p>}
          {(timeline ?? [])
            .slice()
            .reverse()
            .slice(0, 200)
            .map(entry => (
              <Fragment key={entry.id}>
                <div className="event">
                  <StatusBadge status={entry.status} />
                  <div>
                    <b>
                      #{entry.sequence} · {entry.type}
                    </b>
                    <span>{entry.message}</span>
                    <small>
                      {entry.actor} · kausaler Elternteil {entry.causalParentId ?? "ROOT"} · {entry.time}
                    </small>
                  </div>
                  <button className="whyButton" onClick={() => void loadWhy(entry.id)} disabled={!isKnownEventId(entry.id)}>
                    {whyOpen === entry.id ? "Warum? schließen" : "Warum?"}
                  </button>
                </div>
                {whyOpen === entry.id && (
                  <div className="whyPanel">
                    {whyError && <small className="whyError">Begründung nicht lesbar ({whyError}).</small>}
                    {!why && !whyError && <small>wird geladen …</small>}
                    {why && (
                      <>
                        <div className="whyGrid">
                          <span>Zweck</span>
                          <b>{why.purpose ?? "nicht dokumentiert"}</b>
                          <span>Entscheidung</span>
                          <b>{why.decision ?? "—"}</b>
                          <span>Akteur / Aktion</span>
                          <b>
                            {why.actor} · {why.action ?? "—"}
                          </b>
                          <span>Ergebnis</span>
                          <b>{why.result ?? "—"}</b>
                          <span>Autorisierungsreferenz</span>
                          <b>{why.authorizationRef ?? "—"}</b>
                          <span>Provenance-Referenz</span>
                          <b>{why.provenanceRef ?? "—"}</b>
                        </div>
                        <small>Kausalkette (älteste zuerst, {why.chain.length} Ereignisse)</small>
                        <ol className="whyChain">
                          {why.chain.map(link => (
                            <li key={link.eventId}>
                              <code>#{link.sequence}</code> {link.type} · {link.message}
                              {link.purpose ? ` · Zweck: ${link.purpose}` : ""}
                              {link.decision ? ` · ${link.decision}` : ""}
                            </li>
                          ))}
                        </ol>
                        {why.evidence.length > 0 && (
                          <>
                            <small>Evidenz</small>
                            <ul className="whyChain">
                              {why.evidence.map(item => (
                                <li key={item.evidenceId}>
                                  {item.claim} = {item.value} ({item.knowledgeState})
                                </li>
                              ))}
                            </ul>
                          </>
                        )}
                        {why.knowledge.length > 0 && (
                          <>
                            <small>Wissen</small>
                            <ul className="whyChain">
                              {why.knowledge.map(item => (
                                <li key={item.knowledgeId}>
                                  {item.subject} {item.predicate} {item.object} ({item.state})
                                </li>
                              ))}
                            </ul>
                          </>
                        )}
                        <small>Grenzen dieser Auskunft</small>
                        <ul className="whyChain whyLimits">
                          {why.limitations.map(limit => (
                            <li key={limit}>{limit}</li>
                          ))}
                        </ul>
                      </>
                    )}
                  </div>
                )}
              </Fragment>
            ))}
        </section>
      );
    }

    if (section === "Governance") {
      const killSwitches = (governance?.killSwitches as Row[] | undefined) ?? [];
      const delegations = (governance?.delegations as Row[] | undefined) ?? [];
      return (
        <>
          <section className="panel sectionPanel">
            <small>GOVERNANCE / KILL SWITCH</small>
            <h2>Not-Aus</h2>
            <p>Der Kill-Switch wirkt auf den gesamten Ausführungspfad (Gate, Broker, Runtime). Freigabe ist Creator-gebunden und auditiert.</p>
            <div className="headerActions">
              <button className="danger" onClick={() => void post("/api/control", {action: "lockdown", locked: !locked})}>
                {locked ? "Lockdown aufheben" : "Emergency Lockdown"}
              </button>
              <span className="privacy">{locked ? "LOCKDOWN AKTIV" : "kein Lockdown"}</span>
            </div>
            {killSwitches.length === 0 ? (
              <p className="emptyNote">{governance === null ? "nicht verfügbar" : "keine Kill-Switches gemeldet"}</p>
            ) : (
              <div className="dataTable">
                <div className="dataRow head">
                  {["Scope", "Ziel", "Zustand"].map(column => <span key={column}>{column}</span>)}
                </div>
                {killSwitches.map((entry, index) => (
                  <div className="dataRow" key={`${String(entry.scope)}-${index}`}>
                    <span>{String(entry.scope ?? "—")}</span>
                    <span>{String(entry.targetId ?? "—")}</span>
                    <span className="state">{entry.active ? "AKTIV" : "inaktiv"}</span>
                  </div>
                ))}
              </div>
            )}
          </section>
          <section className="panel sectionPanel">
            <small>GOVERNANCE / DELEGATION</small>
            <h2>Delegationen</h2>
            <p>Jede Delegation ist an Aufgabe, Sandbox und Ablaufzeit gebunden; abgelaufene Delegationen sind unwirksam.</p>
            {delegations.length === 0 ? (
              <p className="emptyNote">{governance === null ? "nicht verfügbar" : "keine Delegationen vorhanden"}</p>
            ) : (
              <div className="dataTable">
                <div className="dataRow head">
                  {["Delegation", "Von", "An", "Capabilities", "Task", "Sandbox", "Status", "Ablauf"].map(column => <span key={column}>{column}</span>)}
                </div>
                {delegations.map((entry, index) => (
                  <div className="dataRow" key={String(entry.delegationId ?? entry.id ?? index)}>
                    <span>{String(entry.delegationId ?? entry.id ?? "—")}</span>
                    <span>{String(entry.from ?? "—")}</span>
                    <span>{String(entry.to ?? "—")}</span>
                    <span>{Array.isArray(entry.capabilities) ? (entry.capabilities as string[]).join(", ") : "—"}</span>
                    <span>{String(entry.taskId ?? "—")}</span>
                    <span>{String(entry.sandboxId ?? "—")}</span>
                    <span className="state">{String(entry.status ?? "—")}</span>
                    <span>{String(entry.expiresAt ?? "—")}</span>
                  </div>
                ))}
              </div>
            )}
          </section>
        </>
      );
    }

    if (section === "Security") {
      const tokens = (capabilities?.tokens as Row[] | undefined) ?? [];
      const edges = (capabilities?.edges as Row[] | undefined) ?? [];
      return (
        <>
          <div className="metrics">
            {[
              {k: "Capability-Token", v: String(tokens.length), s: "an Subjekt, Task, Sandbox gebunden"},
              {k: "Authority-Kanten", v: String(edges.length), s: "Delegation/Skopierung"},
              {k: "Audit", v: audit?.chain && (audit.chain as Row).valid ? "INTEGER" : "—", s: "HMAC-Kette"},
              {k: "Bereitschaft", v: readiness?.ready ? "READY" : "—", s: readiness ? `${String(readiness.activeTasks)} aktive Aufgaben` : "nicht verfügbar"}
            ].map(metric => (
              <div className="metric" key={metric.k}>
                <small>{metric.k}</small>
                <strong>{metric.v}</strong>
                <span>{metric.s}</span>
              </div>
            ))}
          </div>
          <section className="panel sectionPanel">
            <small>GOVERNANCE / SICHERHEIT</small>
            <h2>Capability-Token</h2>
            <p>Keine Wildcards, TTL-Grenzen, Subjekt-/Risiko-Bindung. Widerruf wirkt sofort.</p>
            {tokens.length === 0 ? (
              <p className="emptyNote">{capabilities === null ? "nicht verfügbar" : "keine Token ausgestellt"}</p>
            ) : (
              <div className="dataTable">
                <div className="dataRow head">
                  {["Token", "Subjekt", "Task", "Sandbox", "Umgebung", "Capabilities", "Risiko", "Läuft ab", "Widerrufen"].map(column => (
                    <span key={column}>{column}</span>
                  ))}
                </div>
                {tokens.map((token, index) => (
                  <div className="dataRow" key={String(token.id ?? index)}>
                    <span>{String(token.id ?? "—")}</span>
                    <span>{String(token.subject ?? "—")}</span>
                    <span>{String(token.taskId ?? "—")}</span>
                    <span>{String(token.sandboxId ?? "—")}</span>
                    <span>{String(token.environment ?? "—")}</span>
                    <span>{Array.isArray(token.capabilities) ? (token.capabilities as string[]).join(", ") : "—"}</span>
                    <span>{String(token.risk ?? "—")}</span>
                    <span>{String(token.expiresAt ?? "—")}</span>
                    <span className="state">{token.revokedAt ? "ja" : "nein"}</span>
                  </div>
                ))}
              </div>
            )}
          </section>
        </>
      );
    }

    if (section === "Operations") {
      const stores = ((persistence?.stores as Row | undefined)?.stores as Row[] | undefined) ?? [];
      return (
        <>
          <div className="metrics">
            {[
              {k: "Speicher", v: String(stores.length), s: "registrierte Stores"},
              {k: "Integrität", v: (persistence?.stores as Row | undefined)?.ok ? "OK" : "—", s: "Digest-Prüfung je Store"},
              {k: "Backups", v: String(((persistence?.backups as Row | undefined)?.count as number | undefined) ?? 0), s: `${String(((persistence?.backups as Row | undefined)?.verified as number | undefined) ?? 0)} verifiziert`},
              {k: "Bereitschaft", v: readiness?.ready ? "READY" : "—", s: readiness ? `${String(readiness.blockedTasks)} blockierte Aufgaben` : "nicht verfügbar"}
            ].map(metric => (
              <div className="metric" key={metric.k}>
                <small>{metric.k}</small>
                <strong>{metric.v}</strong>
                <span>{metric.s}</span>
              </div>
            ))}
          </div>
          <section className="panel sectionPanel">
            <small>PLATTFORM / PERSISTENZ</small>
            <h2>Stores</h2>
            <p>Jeder Store ist ein digest-geprüfter Envelope (0600, atomares Schreiben). Ein beschädigter Store wird als Befund gemeldet, nicht stillschweigend ersetzt.</p>
            <div className="headerActions">
              <button onClick={() => void post("/api/persistence", {action: "backup"})}>Backup erstellen</button>
              <button onClick={() => void post("/api/persistence", {action: "repair"})}>Leere Envelopes reparieren</button>
            </div>
            <p>Jeder Store ist ein digest-geprüfter Envelope (0600, atomares Schreiben). Ein beschädigter Store wird als Befund gemeldet, nicht stillschweigend ersetzt.</p>
            {stores.length === 0 ? (
              <p className="emptyNote">{persistence === null ? "nicht verfügbar" : "keine Stores gemeldet"}</p>
            ) : (
              <div className="dataTable">
                <div className="dataRow head">
                  {["Store", "Version", "Existiert", "OK", "Fehler", "Geschrieben"].map(column => <span key={column}>{column}</span>)}
                </div>
                {stores.map(store => (
                  <div className="dataRow" key={String(store.store)}>
                    <span>{String(store.store ?? "—")}</span>
                    <span>{String(store.version ?? "—")}</span>
                    <span>{store.exists ? "ja" : "nein"}</span>
                    <span className="state">{store.ok ? "OK" : "FEHLER"}</span>
                    <span>{String(store.error ?? "—")}</span>
                    <span>{String(store.writtenAt ?? "—")}</span>
                  </div>
                ))}
              </div>
            )}
          </section>
          <section className="panel sectionPanel">
            <small>PLATTFORM / PERSISTENZ</small>
            <h2>Backup-Automation</h2>
            <p>
              Der geplante Lauf ist <strong>idempotent</strong>: innerhalb des Intervalls passiert nichts, ein zweiter Lauf nur mit ausdrücklichem{" "}
              <code>force</code>. Jeder Lauf wird verifiziert (Digest) und als Ereignis plus Audit-Eintrag festgehalten.
            </p>
            <div className="dataTable">
              <div className="dataRow head">
                {["Geplante Sicherung", "Intervall", "Aufbewahrung", "Läufe", "Fällig", "Verifiziert"].map(column => <span key={column}>{column}</span>)}
              </div>
              <div className="dataRow">
                <span>{persistence?.backupAutomation ? "konfiguriert" : "nicht verfügbar"}</span>
                <span>{formatInterval(((persistence?.backupAutomation as Row | undefined)?.policy as Row | undefined)?.intervalMs)}</span>
                <span>{String(((persistence?.backupAutomation as Row | undefined)?.policy as Row | undefined)?.keepPerStore ?? "—")} je Store</span>
                <span>{String(((persistence?.backupAutomation as Row | undefined)?.runs as number | undefined) ?? 0)}</span>
                <span className="state">{((persistence?.backupAutomation as Row | undefined)?.due as boolean | undefined) ? "ja — Lauf ausstehend" : "nein"}</span>
                <span>{String(((persistence?.backupAutomation as Row | undefined)?.backups as Row | undefined)?.verified ?? 0)} von {String(((persistence?.backupAutomation as Row | undefined)?.backups as Row | undefined)?.count ?? 0)}</span>
              </div>
            </div>
            <div className="headerActions">
              <button onClick={() => void post("/api/persistence", {action: "backup.run"})}>Geplante Sicherung ausführen</button>
              <button onClick={() => void post("/api/persistence", {action: "backup.prune"})}>Alte Sicherungen aufräumen</button>
            </div>
            <p className="privacy">
              Die Aufbewahrungsregel löscht nur verifizierte Sicherungen jenseits der Grenze – nie die neueste oder einzige eines Stores. Beschädigte Sicherungen werden gemeldet, nicht gelöscht.
            </p>
            <p>Jeder Store ist ein digest-geprüfter Envelope (0600, atomares Schreiben). Ein beschädigter Store wird als Befund gemeldet, nicht stillschweigend ersetzt.</p>
          </section>
        </>
      );
    }

    if (section === "Metrics") {
      const rules = alertRules ?? [];
      const valid = alertValidation?.ok === true;
      const unknown = Array.isArray(alertValidation?.unknownMetrics) ? (alertValidation?.unknownMetrics as Row[]) : [];
      return (
        <>
          <section className="panel sectionPanel">
            <small>PLATTFORM / BETRIEB</small>
            <h2>Alarmregeln</h2>
            <p>
              Die Regeln liegen im Code und werden bei jeder Abfrage gegen die <strong>real ausgelieferten Kennzahlen</strong> geprüft: eine umbenannte
              Kennzahl macht die Regel ungültig statt wirkungslos. Abholbar als Regeldatei unter <code>/api/alerts?format=prometheus</code>.
            </p>
            <div className="headerActions">
              <button onClick={() => void loadAlerts()}>Regeln prüfen</button>
              <span className="privacy">{rules.length} Regeln · Prüfung {valid ? "BESTANDEN" : alertValidation ? "FEHLGESCHLAGEN" : "offen"}</span>
            </div>
            {alertValidation === null ? (
              <p className="emptyNote">nicht verfügbar (keine Session oder Route gesperrt)</p>
            ) : (
              <>
                {unknown.length > 0 && (
                  <div className="integrity">
                    <strong>UNBEKANNTE KENNZAHLEN</strong>
                    <span>{unknown.map(entry => `${String(entry.rule)} → ${String(entry.metric)}`).join(", ")}</span>
                  </div>
                )}
                <div className="dataTable">
                  <div className="dataRow head">
                    {["Regel", "Schwere", "Wartezeit", "Ausdruck", "Runbook"].map(column => (
                      <span key={column}>{column}</span>
                    ))}
                  </div>
                  {rules.map(rule => (
                    <div className="dataRow" key={String(rule.id)}>
                      <span>{String(rule.id)}</span>
                      <span className="state">{String(rule.severity)}</span>
                      <span>{String(rule.for)}</span>
                      <span title={String(rule.expr)}>{String(rule.expr)}</span>
                      <span title={String(rule.runbook)}>{String(rule.summary ?? "")}</span>
                    </div>
                  ))}
                </div>
              </>
            )}
          </section>
          <section className="panel sectionPanel">
            <small>PLATTFORM / METRIKEN</small>
            <h2>Prometheus-Export</h2>
            <p>Nur Zahlen und Zählerstände, keine Geheimnisse. Der Endpunkt ist session-pflichtig (fail closed).</p>
            <div className="headerActions">
              <button onClick={() => void loadMetrics()}>Metriken laden</button>
            </div>
            <pre className="metricsText">{metricsText ?? "noch nicht geladen"}</pre>
          </section>
        </>
      );
    }

    if (section === "Simulation") {
      const scenarios = rowsFor("Simulation").rows ?? [];
      const previewId = render?.scenarioId ?? String(scenarios[0]?.id ?? "");
      return (
        <>
          {genericTable("Simulation")}
          <section className="panel sectionPanel">
            <small>PLATTFORM / VISUALISIERUNG</small>
            <h2>Visualisierung</h2>
            <p>
              Die Visualisierung wird serverseitig <strong>aus dem echten Plattformzustand</strong> gerendert (Durchsetzungskette, Ereignis-Zeitachse,
              Fehler-Lebenszyklus, Laufzeit-Matrix, Netzwerk-Politik, Sandbox-Flotte). Der Renderer entfernt aktive Inhalte fail closed und legt das
              Ergebnis mit SHA-256-Digest als Evidenz-Artefakt ab — ein Szenario bleibt eine Annahme, kein Nachweis.
            </p>
            <div className="headerActions">
              <label>
                Szenario
                <select value={previewId} onChange={event => setRender(current => (current ? {...current, scenarioId: event.target.value} : current))}>
                  {scenarios.length === 0 && <option value="">kein Szenario</option>}
                  {scenarios.map(scenario => (
                    <option key={String(scenario.id)} value={String(scenario.id)}>
                      {String(scenario.id)} · {String(scenario.name ?? "")}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Art
                <select value={renderKind} onChange={event => setRenderKind(event.target.value)}>
                  {["ARCHITECTURE", "FLOW", "TIMELINE", "STATE_MACHINE", "DEPENDENCY", "NETWORK", "SCENE_3D"].map(kind => (
                    <option key={kind} value={kind}>
                      {kind}
                    </option>
                  ))}
                </select>
              </label>
              <button onClick={() => void renderScenario(previewId, renderKind)} disabled={renderBusy || !previewId}>
                {renderBusy ? "rendere…" : "Visualisierung rendern"}
              </button>
            </div>
            {render ? (
              <>
                <div className="dataTable">
                  <div className="dataRow head">
                    {["Artefakt", "Art", "Knoten", "Bytes", "Gekürzt", "Digest"].map(column => (
                      <span key={column}>{column}</span>
                    ))}
                  </div>
                  <div className="dataRow">
                    <span>{render.artifactId}</span>
                    <span>{render.kind}</span>
                    <span>{String(render.nodes)}</span>
                    <span>{String(render.bytes)}</span>
                    <span className="state">{render.truncated ? "ja" : "nein"}</span>
                    <span>{`${render.digest.slice(0, 16)}…`}</span>
                  </div>
                </div>
                {previewId && (
                  <img
                    className="visualization"
                    alt={`Visualisierung ${render.kind} für ${previewId} (SIMULATION)`}
                    src={`/api/simulation/render?id=${encodeURIComponent(previewId)}&kind=${encodeURIComponent(renderKind)}`}
                  />
                )}
                <div className="headerActions">
                  <button onClick={() => void verifyArtifact(render.artifactId)}>Digest erneut prüfen</button>
                </div>
              </>
            ) : (
              <p className="emptyNote">Noch keine Visualisierung gerendert.</p>
            )}
          </section>
        </>
      );
    }

    if (section === "Secrets") {
      return (
        <section className="panel sectionPanel">
          <small>PLATTFORM / SECRETS</small>
          <h2>Secrets</h2>
          <p>
            Secrets werden serverseitig verwaltet und sind über die API <strong>nicht lesbar</strong>: ein lesender Zugriff
            (<code>GET /api/secrets</code>) existiert nicht, Anlegen und Widerrufen sind Creator-gebunden. Der Browser erhält niemals
            Secret-Werte — die Oberfläche zeigt ausschließlich die Grenze, keine Platzhalterwerte.
          </p>
          <div className="integrity">
            <strong>KEIN LESEZUGRIFF</strong>
            <span>Diese Oberfläche zeigt grundsätzlich keine Secret-Werte, sondern nur deren Verwendung über Provider- und Runtime-Bindungen.</span>
          </div>
        </section>
      );
    }

    if (section === "Privacy") {
      const policy = (privacy?.policy as Row | undefined) ?? null;
      return (
        <>
          <section className="panel sectionPanel">
            <small>GOVERNANCE / DATENSCHUTZ</small>
            <h2>Richtlinie</h2>
            <p>Datenschutz ist default DENY: externe Weitergabe, Verarbeitung, Training und Speicherung sind einzeln geregelt.</p>
            {policy ? (
              <div className="dataTable">
                <div className="dataRow head">
                  {["Regel", "Wert"].map(column => <span key={column}>{column}</span>)}
                </div>
                {Object.entries(policy).map(([key, value]) => (
                  <div className="dataRow" key={key}>
                    <span>{key}</span>
                    <span className="state">{String(value)}</span>
                  </div>
                ))}
              </div>
            ) : (
              <p className="emptyNote">{privacy === null ? "nicht verfügbar" : "keine Richtlinie gemeldet"}</p>
            )}
          </section>
          {genericTable("Privacy")}
        </>
      );
    }

    const source = SOURCES[section];
    if (!source) {
      return <p className="emptyNote">Für diesen Abschnitt ist keine Datenquelle gebunden.</p>;
    }
    if (section === "Tests") {
      return (
        <>
          {genericTable("Tests")}
          {genericTable("Pipeline")}
          {genericTable("Deployment")}
        </>
      );
    }
    if (section === "Deployment") return deploymentPanel();
    if (section === "Slo") {
      const results = (panels.Slo?.rows ?? []) as Row[];
      const count = (state: string) => results.filter(row => row.state === state).length;
      const broken = results.filter(row => row.state === "BREACHED" || row.state === "UNKNOWN");
      return (
        <>
          <div className="metrics">
            {[
              {k: "Attestiert", v: String(count("HEALTHY")), s: `von ${results.length} Messgrößen`},
              {k: "Gewarnt", v: String(count("WARNING")), s: "über der Warnschwelle"},
              {k: "Verletzt", v: String(count("BREACHED")), s: "kritische Grenze überschritten"},
              {k: "Ohne Messwert", v: String(count("UNKNOWN")), s: "nicht messbar — nicht „gesund“"}
            ].map(metric => (
              <div className="metric" key={metric.k}>
                <small>{metric.k}</small>
                <strong>{metric.v}</strong>
                <span>{metric.s}</span>
              </div>
            ))}
          </div>
          <section className="panel sectionPanel">
            <small>PLATTFORM / BETRIEB</small>
            <h2>Service-Level</h2>
            <p>
              Schwellen mit Zielwert, Warn- und kritischer Grenze, gegen den <strong>echten</strong> Betriebszustand bewertet.
              Ein fehlender Messwert ist <code>UNKNOWN</code> und wird nicht als gesund ausgegeben. Die Bewertung meldet eine
              Verletzung als <code>BLOCK</code> in die Creator-Inbox, fehlende Messwerte als <code>ASK</code> — sie repariert
              nichts und schaltet nichts ab.
            </p>
            <div className="headerActions">
              <button onClick={() => void post("/api/slo", {action: "evaluate"})}>Bewertung auslösen</button>
              <span className="privacy">{results.length} Messgrößen bewertet</span>
            </div>
            {broken.length > 0 && (
              <p className="privacy">
                Befund: {broken.map(row => `${String(row.title ?? row.id)} (${String(row.state)})`).join(" · ")}
              </p>
            )}
          </section>
          {genericTable("Slo")}
        </>
      );
    }

    return genericTable(section);
  };

  return (
    <main className="shell">
      <aside>
        <div className="brand">
          <span>✦</span>
          <div>
            <b>BabajagaBoB</b>
            <small>CONTROL CENTER</small>
          </div>
        </div>
        <nav>
          {NAV.map(entry => (
            <button key={entry.id} onClick={() => setSection(entry.id)} className={section === entry.id ? "active" : ""} title={entry.group}>
              {entry.label}
              <span>›</span>
            </button>
          ))}
        </nav>
        <div className="sideStatus">
          <small>SYSTEM</small>
          <StatusBadge status={locked ? "ERROR" : "RUNNING"} />
          <p>{locked ? "EMERGENCY LOCKDOWN" : "Operational · control plane"}</p>
        </div>
      </aside>
      <section className="content">
        <header>
          <div>
            <small>PROJEKT / BABAJAGABOB · {activeGroup.toUpperCase()}</small>
            <h1>{NAV.find(entry => entry.id === section)?.label ?? section}</h1>
          </div>
          <div className="headerActions">
            <span className="privacy">
              NETZWERK · {(privacy?.policy as Row | undefined)?.networkDefault ? String((privacy?.policy as Row).networkDefault) : "DENY"}
            </span>
            <span
              className="privacy"
              title={`${String((runtime?.isolation as Row | undefined)?.detail ?? "Isolationszustand unbekannt")} · ${String(((runtime?.isolation as Row | undefined)?.resourceLimits as Row | undefined)?.detail ?? "Ressourcenlimits unbekannt")}`}
            >
              ISOLATION ·{" "}
              {(runtime?.isolation as Row | undefined)?.level === "NAMESPACES"
                ? "NAMESPACES"
                : runtime?.isolation
                  ? "FILESYSTEM_ONLY"
                  : "UNBEKANNT"}
              {" · LIMITS · "}
              {((runtime?.isolation as Row | undefined)?.resourceLimits as Row | undefined)?.cgroup === "ENFORCED"
                ? "CGROUP"
                : runtime?.isolation
                  ? "RLIMIT"
                  : "UNBEKANNT"}
            </span>
            <button className="danger" onClick={() => void post("/api/control", {action: "lockdown", locked: !locked})}>
              {locked ? "Lockdown aufheben" : "Emergency Lockdown"}
            </button>
          </div>
        </header>
        {error && <div className="alert">Control Plane: {error}</div>}
        {notice && <div className="alert">{notice}</div>}
        {locked && <div className="alert">Emergency Lockdown aktiv — Ausführung ist angehalten, bis er ausdrücklich aufgehoben wird.</div>}
        {content()}
      </section>
    </main>
  );
}
