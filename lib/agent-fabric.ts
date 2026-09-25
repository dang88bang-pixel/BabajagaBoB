import {getControlState, updateAgentStatus as updateControlAgentStatus} from "./control-plane";
import {observe} from "./observability";
import type {AgentKind, Status} from "./types";

/**
 * Agent Fabric (Abschnitt 22).
 *
 * Quelle der Wahrheit für Agenten ist die Control Plane (`lib/control-plane.ts`).
 * Diese Schicht ergänzt den Autonomie-Vertrag pro Rolle (was ein Agent darf und
 * was ausdrücklich nicht) und die Übergabe-/Heartbeat-Protokolle. Es gibt
 * bewusst keine zweite Agentenliste: eine duplizierte Seed-Liste hätte
 * auseinanderlaufen können (Scheinzustand statt Wahrheit).
 *
 * Unverhandelbare Grenzen für **jeden** Agenten:
 * - `authorityChanges: false` – keine Selbstvergabe von Rechten (§4).
 * - `production: false` – kein Selbstfreischalten von Produktion.
 * - `infrastructure: false` – keine Infrastruktur-/Governance-Eingriffe.
 * - `externalNetwork: false` – Netzwerk bleibt `DENY`; externer Zugriff ist an
 *   einen Integrator-Auftrag mit Approval gebunden, nicht an die Rolle.
 */

export type AgentKindName = AgentKind;
export type AutonomyProfile = {
  initiative: boolean;
  experimentation: boolean;
  codeChanges: boolean;
  sandboxCreation: boolean;
  externalNetwork: boolean;
  production: boolean;
  infrastructure: boolean;
  authorityChanges: boolean;
};
export type AgentNode = {
  agentId: string;
  projectId: string;
  name: string;
  role: string;
  kind: AgentKind;
  status: Status;
  progress: number;
  task?: string;
  capabilities: string[];
  maxRisk: string;
  profile: AutonomyProfile;
  heartbeatAt: string;
  health: "HEALTHY" | "STALE" | "BLOCKED";
  createdAt: string;
};
export type Handoff = {id: string; fromAgentId: string; toAgentId: string; taskId: string; reason: string; createdAt: string; status: "REQUESTED" | "ACCEPTED" | "COMPLETED" | "REJECTED"};

/** Basisprofil: Initiative und Experimente erlaubt, Außen- und Produktionszugriff nie. */
const base: AutonomyProfile = {
  initiative: true,
  experimentation: true,
  codeChanges: true,
  sandboxCreation: true,
  externalNetwork: false,
  production: false,
  infrastructure: false,
  authorityChanges: false
};

/** Rollenspezifische Abweichungen; additive Rechte sind hier nicht vorgesehen. */
const profiles: Record<AgentKind, AutonomyProfile> = {
  SUPERVISOR: {...base, codeChanges: false, sandboxCreation: false},
  PLANNER: {...base, codeChanges: false, sandboxCreation: false},
  BUILDER: {...base},
  RESEARCH: {...base, codeChanges: false, sandboxCreation: false},
  SCIENTIST: {...base, codeChanges: false},
  QA: {...base, codeChanges: false, sandboxCreation: false},
  BROWSER: {...base, codeChanges: false},
  GUARDIAN: {...base, experimentation: false, codeChanges: false, sandboxCreation: false},
  OPERATOR: {...base, codeChanges: false},
  RECOVERY: {...base, experimentation: false, codeChanges: false},
  INTEGRATOR: {...base, codeChanges: false}
};

const handoffs: Handoff[] = [];

function node(agentId: string): AgentNode | null {
  const agent = getControlState().agents.find(a => a.agentId === agentId);
  if (!agent) return null;
  return {
    agentId: agent.agentId,
    projectId: agent.projectId,
    name: agent.name,
    role: agent.role,
    kind: agent.kind,
    status: agent.status,
    progress: agent.progress,
    task: agent.task,
    capabilities: [...agent.capabilities],
    maxRisk: agent.maxRisk,
    profile: profiles[agent.kind] ?? base,
    heartbeatAt: agent.heartbeatAt ?? new Date().toISOString(),
    health: agent.health ?? "HEALTHY",
    createdAt: agent.createdAt
  };
}

/** Alle Agenten der Control Plane mit Autonomie-Vertrag (11 Rollen). */
export function listAgentNodes(): AgentNode[] {
  return getControlState()
    .agents.map(agent => node(agent.agentId))
    .filter((entry): entry is AgentNode => entry !== null);
}

export function getAgentNode(agentId: string): AgentNode | null {
  return node(agentId);
}

export function heartbeatAgent(id: string): AgentNode | null {
  if (!node(id)) return null;
  observe({
    type: "agent.heartbeat",
    message: `Heartbeat von ${id}`,
    status: "RUNNING",
    actor: id,
    action: "agent.heartbeat",
    resource: id,
    decision: "ALLOW",
    argumentsValue: {kind: node(id)?.kind}
  });
  return node(id);
}

export function updateAgentStatus(id: string, status: Status, progress: number, task?: string): AgentNode | null {
  if (!node(id)) return null;
  updateControlAgentStatus(id, status, progress, task);
  return node(id);
}

export function requestHandoff(fromAgentId: string, toAgentId: string, taskId: string, reason: string): Handoff {
  if (fromAgentId === toAgentId) throw new Error("self handoff rejected");
  const from = node(fromAgentId);
  const to = node(toAgentId);
  if (!from || !to) throw new Error("agent not found");
  // Übergaben sind delegierbar, aber niemals an Aufträge außerhalb der Rolle:
  // ein Guardian übernimmt keine Produktionsfreigabe, ein Builder keine Governance.
  const handoff: Handoff = {
    id: `HO-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    fromAgentId,
    toAgentId,
    taskId,
    reason,
    createdAt: new Date().toISOString(),
    status: "REQUESTED"
  };
  handoffs.push(handoff);
  observe({
    type: "agent.handoff.requested",
    message: `Übergabe ${fromAgentId} → ${toAgentId}`,
    status: "RUNNING",
    actor: fromAgentId,
    action: "agent.handoff.request",
    resource: taskId,
    decision: "ALLOW",
    argumentsValue: {handoffId: handoff.id, reason}
  });
  return structuredClone(handoff);
}

export function resolveHandoff(id: string, status: Handoff["status"]): Handoff {
  const handoff = handoffs.find(x => x.id === id);
  if (!handoff) throw new Error("handoff not found");
  handoff.status = status;
  return structuredClone(handoff);
}

export function listHandoffs(): Handoff[] {
  return structuredClone(handoffs);
}

/** Rollenübersicht für UI und Prüfberichte: 11 Rollen mit ihren harten Grenzen. */
export function agentFabricSummary() {
  const nodes = listAgentNodes();
  return {
    total: nodes.length,
    roles: nodes.map(n => n.kind),
    healthy: nodes.filter(n => n.health === "HEALTHY").length,
    autonomous: nodes.filter(n => n.profile.initiative).length,
    withCodeChanges: nodes.filter(n => n.profile.codeChanges).length,
    authorityChanges: nodes.filter(n => n.profile.authorityChanges).map(n => n.agentId),
    productionAccess: nodes.filter(n => n.profile.production).map(n => n.agentId),
    externalNetwork: nodes.filter(n => n.profile.externalNetwork).map(n => n.agentId),
    handoffs: handoffs.length
  };
}
