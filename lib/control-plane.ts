import {createStore} from "./persistence/store";
import {observe} from "./observability";
import {listDomainEvents} from "./events/log";
import {evaluateTask} from "./policy";
import type {
  Agent,
  AgentKind,
  Approval,
  ControlState,
  Event,
  Experiment,
  Mission,
  Objective,
  Risk,
  Sandbox,
  Status,
  Task
} from "./types";

/**
 * Control Plane (Abschnitt 5).
 *
 * Zentraler, persistenter Zustand für Creator, Agents, Missions, Objectives,
 * Tasks, Sandboxes, Approvals und Experiments. Jede Mutation erzeugt ein Event
 * über den kanonischen Beobachtungspfad (Event → Audit → Provenance).
 *
 * Events werden NICHT im Control-State persistiert; die Quelle der Wahrheit ist
 * der Event-Log (lib/events/log.ts). `snapshot().events` ist eine reine Projektion.
 */

export const PROJECT_ID = "PRJ-BOB";

const seed = (): ControlState => {
  const now = new Date().toISOString();
  const agents: Agent[] = (
    [
      ["AG-SUP", "Supervisor", "Orchestration", "SUPERVISOR", ["task.dispatch", "mission:plan", "agent:read", "provider.discover"], "HIGH"],
      ["AG-PLAN", "Planner", "Planning", "PLANNER", ["mission:plan", "task:read", "objective:write"], "MODERATE"],
      ["AG-BUILD", "Builder", "Engineering", "BUILDER", ["repo:branch", "sandbox:run", "task:execute", "artifact:write"], "HIGH"],
      ["AG-RESEARCH", "Research", "Research", "RESEARCH", ["web:research", "knowledge:write", "source:read"], "MODERATE"],
      ["AG-SCIENTIST", "Scientist", "Science", "SCIENTIST", ["experiment:run", "sandbox:run", "task:execute", "evidence:write"], "HIGH"],
      ["AG-QA", "QA", "Verification", "QA", ["test:run", "task:execute", "artifact:read", "regression:write"], "MODERATE"],
      ["AG-BROWSER", "Browser", "Computer Use", "BROWSER", ["computer:use", "sandbox:run", "screenshot:write"], "MODERATE"],
      ["AG-GUARD", "Guardian", "Security", "GUARDIAN", ["policy:read", "audit:read", "approval:request", "kill-switch:read"], "HIGH"],
      ["AG-OPS", "Operator", "Operations", "OPERATOR", ["deployment:execute", "sandbox:run", "runtime:read"], "HIGH"],
      ["AG-RECOVERY", "Recovery", "Reliability", "RECOVERY", ["recovery:execute", "sandbox:snapshot", "regression:run", "task:execute"], "HIGH"],
      ["AG-INT", "Integrator", "Integration", "INTEGRATOR", ["provider:bind", "provider:evaluate", "device:read"], "MODERATE"]
    ] as [string, string, string, AgentKind, string[], Risk][]
  ).map(([agentId, name, role, kind, capabilities, maxRisk]) => ({
    agentId,
    projectId: PROJECT_ID,
    name,
    role,
    kind,
    status: "WAITING" as Status,
    progress: 0,
    task: undefined,
    capabilities,
    maxRisk,
    health: "HEALTHY" as const,
    heartbeatAt: now,
    createdAt: now
  }));

  const missions: Mission[] = [
    {
      missionId: "MIS-001",
      projectId: PROJECT_ID,
      title: "Control Plane fertigstellen",
      objective: "Aus der Architekturgrundlage ein integriertes, verifiziertes System entwickeln",
      status: "RUNNING",
      progress: 40,
      owner: "AG-SUP",
      createdBy: "CREATOR",
      createdAt: now,
      updatedAt: now
    },
    {
      missionId: "MIS-002",
      projectId: PROJECT_ID,
      title: "Capability-Modell verifizieren",
      objective: "Delegierte Fähigkeiten und fail-closed Grenzen nachweisen",
      status: "WAITING",
      progress: 10,
      owner: "AG-GUARD",
      createdBy: "CREATOR",
      createdAt: now,
      updatedAt: now
    }
  ];

  const objectives: Objective[] = [
    {
      objectiveId: "OBJ-001",
      missionId: "MIS-001",
      title: "Execution Lifecycle",
      description: "Runs, Jobs, Leases, Heartbeats, Retry und Recovery belastbar machen",
      status: "ACTIVE",
      createdAt: now,
      updatedAt: now
    },
    {
      objectiveId: "OBJ-002",
      missionId: "MIS-001",
      title: "Persistenz und Integrität",
      description: "Alle zustandsrelevanten Stores persistent und integritätsgeprüft betreiben",
      status: "ACTIVE",
      createdAt: now,
      updatedAt: now
    },
    {
      objectiveId: "OBJ-003",
      missionId: "MIS-002",
      title: "Autorisierungsgrenzen",
      description: "Selbst-Delegation, Token-Missbrauch und Kill-Switch-Umgehung ausschließen",
      status: "PLANNED",
      createdAt: now,
      updatedAt: now
    }
  ];

  const tasks: Task[] = [
    {
      taskId: "TASK-001",
      projectId: PROJECT_ID,
      missionId: "MIS-001",
      objectiveId: "OBJ-001",
      title: "Run-/Job-Lifecycle implementieren",
      status: "RUNNING",
      progress: 45,
      risk: "LOW",
      assignedAgent: "AG-BUILD",
      requiresApproval: false,
      createdAt: now,
      updatedAt: now
    },
    {
      taskId: "TASK-002",
      projectId: PROJECT_ID,
      missionId: "MIS-002",
      objectiveId: "OBJ-003",
      title: "Capability-Validierung nachweisen",
      status: "APPROVAL_REQUIRED",
      progress: 20,
      risk: "MODERATE",
      assignedAgent: "AG-GUARD",
      requiresApproval: true,
      createdAt: now,
      updatedAt: now
    },
    {
      taskId: "TASK-003",
      projectId: PROJECT_ID,
      missionId: "MIS-001",
      objectiveId: "OBJ-002",
      title: "Persistenzgrenzen härten",
      status: "PLANNING",
      progress: 10,
      risk: "LOW",
      assignedAgent: "AG-OPS",
      requiresApproval: false,
      createdAt: now,
      updatedAt: now
    }
  ];

  const sandboxes: Sandbox[] = [
    {
      sandboxId: "SB-001",
      projectId: PROJECT_ID,
      type: "development",
      status: "RUNNING",
      lifecycle: "RUNNING",
      network: "DENY",
      taskId: "TASK-001",
      agentId: "AG-BUILD",
      runtimeMode: "real-local",
      createdAt: now
    }
  ];

  const approvals: Approval[] = [
    {
      approvalId: "APR-001",
      taskId: "TASK-002",
      status: "PENDING",
      reason: "Capability-Validierung kann Ausführungsrechte verändern",
      createdAt: now
    }
  ];

  const experiments: Experiment[] = [];

  return {
    projectId: PROJECT_ID,
    agents,
    missions,
    objectives,
    tasks,
    sandboxes,
    approvals,
    experiments,
    locked: false,
    counters: {mission: 2, objective: 3, task: 3, sandbox: 1, approval: 1, experiment: 0, artifact: 0, deployment: 0}
  };
};

const store = createStore<ControlState>("control-state", 2, seed);
let state: ControlState = store.read();

const persist = () => {
  state = store.write(state);
};

export function getControlState(): ControlState {
  return structuredClone(state);
}

export function snapshot() {
  const base = getControlState();
  return {
    ...base,
    agents: base.agents.map(a => ({id: a.agentId, ...a, kind: a.kind})),
    missions: base.missions.map(m => ({id: m.missionId, ...m})),
    objectives: base.objectives,
    tasks: base.tasks.map(t => ({id: t.taskId, ...t})),
    sandboxes: base.sandboxes.map(s => ({id: s.sandboxId, ...s})),
    approvals: base.approvals.map(a => ({id: a.approvalId, ...a})),
    experiments: base.experiments,
    events: eventView()
  };
}

function eventView(): Event[] {
  return listDomainEvents({order: "desc", limit: 100}).map(e => ({
    id: e.eventId,
    type: e.type,
    message: e.message,
    status: e.status,
    time: e.timestamp,
    actor: e.actor,
    taskId: e.taskId,
    resource: e.sandboxId ?? e.runId ?? e.eventId,
    causalParentId: e.causalParentId
  }));
}

function nextId(kind: keyof ControlState["counters"], prefix: string, pad = 3): string {
  state.counters[kind] = (state.counters[kind] ?? 0) + 1;
  return `${prefix}-${String(state.counters[kind]).padStart(pad, "0")}`;
}

/* ------------------------------------------------------------------ Agents */

export function registerAgent(agent: Omit<Agent, "createdAt" | "heartbeatAt"> & Partial<Pick<Agent, "health">>): Agent {
  const existing = state.agents.find(a => a.agentId === agent.agentId);
  if (existing) return structuredClone(existing);
  const created: Agent = {...agent, health: agent.health ?? "HEALTHY", heartbeatAt: new Date().toISOString(), createdAt: new Date().toISOString()};
  state.agents.push(created);
  persist();
  observe({
    type: "agent.registered",
    message: `Agent ${created.name} registriert`,
    status: "COMPLETED",
    actor: "CREATOR",
    agentId: created.agentId,
    action: "agent.register",
    resource: created.agentId
  });
  return structuredClone(created);
}

export function getAgent(agentId: string): Agent | null {
  return structuredClone(state.agents.find(a => a.agentId === agentId) ?? null);
}

export function updateAgentStatus(agentId: string, status: Status, progress: number, task?: string): Agent {
  const agent = state.agents.find(a => a.agentId === agentId);
  if (!agent) throw new Error("agent not found");
  agent.status = status;
  agent.progress = Math.max(0, Math.min(100, progress));
  if (task !== undefined) agent.task = task;
  agent.heartbeatAt = new Date().toISOString();
  agent.health = "HEALTHY";
  persist();
  return structuredClone(agent);
}

export function heartbeatAgent(agentId: string): Agent {
  const agent = state.agents.find(a => a.agentId === agentId);
  if (!agent) throw new Error("agent not found");
  agent.heartbeatAt = new Date().toISOString();
  agent.health = "HEALTHY";
  persist();
  return structuredClone(agent);
}

/* ---------------------------------------------------------------- Missions */

export function createMission(input: {title: string; objective: string; owner?: string; createdBy: string}): Mission {
  // Eine Mission ohne Titel oder Ziel ist kein Plan, sondern ein leerer
  // Datensatz: die Kette Mission → Objective → Task hinge an einem
  // inhaltslosen Objekt. Deshalb Pflichtfelder und fail closed.
  if (!input || typeof input !== "object") throw new Error("mission input required");
  if (typeof input.title !== "string" || input.title.trim().length === 0) throw new Error("mission title required");
  if (typeof input.objective !== "string" || input.objective.trim().length === 0) throw new Error("mission objective required");
  if (typeof input.createdBy !== "string" || input.createdBy.trim().length === 0) throw new Error("mission createdBy required");
  const now = new Date().toISOString();
  const mission: Mission = {
    missionId: nextId("mission", "MIS"),
    projectId: PROJECT_ID,
    title: input.title,
    objective: input.objective,
    status: "PLANNING",
    progress: 0,
    owner: input.owner ?? "AG-SUP",
    createdBy: input.createdBy,
    createdAt: now,
    updatedAt: now
  };
  state.missions.push(mission);
  persist();
  observe({
    type: "mission.created",
    message: `Mission ${mission.missionId} erstellt`,
    status: "PLANNING",
    actor: input.createdBy,
    action: "mission.create",
    resource: mission.missionId,
    argumentsValue: input
  });
  return structuredClone(mission);
}

export function updateMission(missionId: string, patch: Partial<Pick<Mission, "status" | "progress" | "owner">>): Mission {
  const mission = state.missions.find(m => m.missionId === missionId);
  if (!mission) throw new Error("mission not found");
  Object.assign(mission, patch, {updatedAt: new Date().toISOString()});
  persist();
  observe({
    type: "mission.updated",
    message: `Mission ${missionId} aktualisiert`,
    status: mission.status,
    actor: "system",
    action: "mission.update",
    resource: missionId,
    argumentsValue: patch
  });
  return structuredClone(mission);
}

/* -------------------------------------------------------------- Objectives */

export function createObjective(input: {missionId: string; title: string; description: string}): Objective {
  if (!state.missions.some(m => m.missionId === input.missionId)) throw new Error("mission not found");
  const now = new Date().toISOString();
  const objective: Objective = {
    objectiveId: nextId("objective", "OBJ"),
    missionId: input.missionId,
    title: input.title,
    description: input.description,
    status: "PLANNED",
    createdAt: now,
    updatedAt: now
  };
  state.objectives.push(objective);
  persist();
  observe({
    type: "objective.created",
    message: `Objective ${objective.objectiveId} erstellt`,
    status: "PLANNING",
    actor: "CREATOR",
    action: "objective.create",
    resource: objective.objectiveId,
    argumentsValue: input
  });
  return structuredClone(objective);
}

/* ------------------------------------------------------------------- Tasks */

export function createTask(input: {
  missionId: string;
  objectiveId?: string | null;
  title: string;
  risk: Risk;
  assignedAgent?: string | null;
  requiresApproval?: boolean;
  createdBy: string;
}): Task {
  if (!state.missions.some(m => m.missionId === input.missionId)) throw new Error("mission not found");
  if (input.objectiveId && !state.objectives.some(o => o.objectiveId === input.objectiveId)) throw new Error("objective not found");
  if (input.assignedAgent && !state.agents.some(a => a.agentId === input.assignedAgent)) throw new Error("agent not found");
  const now = new Date().toISOString();
  const task: Task = {
    taskId: nextId("task", "TASK"),
    projectId: PROJECT_ID,
    missionId: input.missionId,
    objectiveId: input.objectiveId ?? null,
    title: input.title,
    status: "PLANNING",
    progress: 0,
    risk: input.risk,
    assignedAgent: input.assignedAgent ?? null,
    requiresApproval: input.requiresApproval ?? (input.risk === "HIGH" || input.risk === "CRITICAL"),
    createdAt: now,
    updatedAt: now
  };
  state.tasks.push(task);
  persist();
  observe({
    type: "task.created",
    message: `Task ${task.taskId} erstellt`,
    status: "PLANNING",
    actor: input.createdBy,
    action: "task.create",
    taskId: task.taskId,
    resource: task.taskId,
    argumentsValue: {missionId: input.missionId, title: input.title, risk: input.risk}
  });
  return structuredClone(task);
}

export function getTask(taskId: string): Task | null {
  return structuredClone(state.tasks.find(t => t.taskId === taskId) ?? null);
}

export function assignTask(taskId: string, agentId: string): Task {
  const task = state.tasks.find(t => t.taskId === taskId);
  if (!task) throw new Error("task not found");
  const agent = state.agents.find(a => a.agentId === agentId);
  if (!agent) throw new Error("agent not found");
  if (!agent.capabilities.includes("task:execute") && agent.kind !== "SUPERVISOR" && agent.kind !== "PLANNER") {
    throw new Error(`agent ${agentId} lacks task assignment capability`);
  }
  task.assignedAgent = agentId;
  task.status = "QUEUED";
  task.updatedAt = new Date().toISOString();
  persist();
  observe({
    type: "task.assigned",
    message: `${agentId} wurde ${taskId} zugewiesen`,
    status: "QUEUED",
    actor: "AG-SUP",
    agentId,
    action: "task.assign",
    taskId,
    resource: taskId
  });
  return structuredClone(task);
}

export function updateTaskStatus(taskId: string, status: Status, progress?: number): Task {
  const task = state.tasks.find(t => t.taskId === taskId);
  if (!task) throw new Error("task not found");
  task.status = status;
  if (progress !== undefined) task.progress = Math.max(0, Math.min(100, progress));
  task.updatedAt = new Date().toISOString();
  persist();
  return structuredClone(task);
}

/* --------------------------------------------------------------- Sandboxes */

export function registerSandbox(sandbox: Omit<Sandbox, "createdAt" | "projectId">): Sandbox {
  if (!sandbox.sandboxId) throw new Error("sandboxId required");
  if (state.sandboxes.some(s => s.sandboxId === sandbox.sandboxId)) throw new Error("sandbox already registered");
  if (!state.tasks.some(t => t.taskId === sandbox.taskId)) throw new Error(`sandbox task binding not found: ${sandbox.taskId}`);
  if (!state.agents.some(a => a.agentId === sandbox.agentId)) throw new Error(`sandbox agent binding not found: ${sandbox.agentId}`);
  const created: Sandbox = {...sandbox, projectId: PROJECT_ID, createdAt: new Date().toISOString()};
  state.sandboxes.push(created);
  persist();
  observe({
    type: "sandbox.registered",
    message: `Sandbox ${created.sandboxId} registriert`,
    status: created.status,
    actor: created.agentId,
    agentId: created.agentId,
    taskId: created.taskId,
    sandboxId: created.sandboxId,
    action: "sandbox.register",
    resource: created.sandboxId,
    argumentsValue: {type: created.type, network: created.network}
  });
  return structuredClone(created);
}

export function updateSandboxStatus(sandboxId: string, status: Status, lifecycle?: Sandbox["lifecycle"]): Sandbox {
  const sandbox = state.sandboxes.find(s => s.sandboxId === sandboxId);
  if (!sandbox) throw new Error("sandbox not found");
  sandbox.status = status;
  if (lifecycle) sandbox.lifecycle = lifecycle;
  persist();
  observe({
    type: "sandbox.status",
    message: `Sandbox ${sandboxId}: ${status}`,
    status,
    actor: sandbox.agentId,
    agentId: sandbox.agentId,
    taskId: sandbox.taskId,
    sandboxId,
    action: "sandbox.status",
    resource: sandboxId
  });
  return structuredClone(sandbox);
}

export function destroySandboxRecord(sandboxId: string): void {
  const index = state.sandboxes.findIndex(s => s.sandboxId === sandboxId);
  if (index === -1) throw new Error("sandbox not found");
  state.sandboxes.splice(index, 1);
  persist();
}

/* --------------------------------------------------------------- Approvals */

export function requestApproval(input: {taskId: string; reason: string; requestedBy: string}): Approval {
  const task = state.tasks.find(t => t.taskId === input.taskId);
  if (!task) throw new Error("task not found");
  const now = new Date().toISOString();
  const approval: Approval = {
    approvalId: nextId("approval", "APR"),
    taskId: input.taskId,
    status: "PENDING",
    reason: input.reason,
    createdAt: now
  };
  state.approvals.push(approval);
  task.status = "APPROVAL_REQUIRED";
  persist();
  observe({
    type: "approval.requested",
    message: `Freigabe ${approval.approvalId} für ${input.taskId} angefordert`,
    status: "APPROVAL_REQUIRED",
    actor: input.requestedBy,
    taskId: input.taskId,
    action: "approval.request",
    resource: approval.approvalId,
    decision: "REQUIRE_APPROVAL",
    argumentsValue: input
  });
  return structuredClone(approval);
}

export function resolveApproval(approvalId: string, grant: boolean, actor = "CREATOR"): Approval {
  const approval = state.approvals.find(a => a.approvalId === approvalId);
  if (!approval) throw new Error("approval not found");
  if (approval.status !== "PENDING") throw new Error("approval already resolved");
  approval.status = grant ? "GRANTED" : "DENIED";
  const task = state.tasks.find(t => t.taskId === approval.taskId);
  if (task) {
    task.status = grant ? "QUEUED" : "BLOCKED";
    task.updatedAt = new Date().toISOString();
  }
  persist();
  observe({
    type: grant ? "approval.granted" : "approval.denied",
    message: grant ? `Freigabe ${approvalId} erteilt` : `Freigabe ${approvalId} verweigert`,
    status: grant ? "QUEUED" : "BLOCKED",
    actor,
    taskId: approval.taskId,
    action: grant ? "approval.grant" : "approval.deny",
    resource: approvalId,
    decision: grant ? "ALLOW" : "DENY"
  });
  return structuredClone(approval);
}

export function getApproval(approvalId: string): Approval | null {
  return structuredClone(state.approvals.find(a => a.approvalId === approvalId) ?? null);
}

/* ------------------------------------------------------------- Experiments */

export function registerExperiment(experiment: Experiment): Experiment {
  if (state.experiments.some(e => e.experimentId === experiment.experimentId)) throw new Error("experiment already registered");
  state.experiments.push(structuredClone(experiment));
  persist();
  return structuredClone(experiment);
}

export function updateExperimentRecord(experimentId: string, patch: Partial<Experiment>): Experiment {
  const experiment = state.experiments.find(e => e.experimentId === experimentId);
  if (!experiment) throw new Error("experiment not found");
  Object.assign(experiment, patch);
  persist();
  return structuredClone(experiment);
}

/* ----------------------------------------------------------------- Guardian */

export function runGuardian(taskId?: string) {
  if (state.locked) {
    observe({
      type: "guardian.check",
      message: "Guardian-Check im Lockdown verweigert",
      status: "BLOCKED",
      actor: "AG-GUARD",
      action: "guardian.check",
      decision: "DENY"
    });
    return snapshot();
  }
  const task = taskId ? state.tasks.find(t => t.taskId === taskId) : state.tasks.find(t => t.status === "APPROVAL_REQUIRED" || t.status === "PLANNING");
  if (!task) return snapshot();
  const policy = evaluateTask(task, state.locked);
  observe({
    type: "guardian.check",
    message: `Guardian prüft ${task.taskId}: ${policy.decision}`,
    status: policy.decision === "ALLOW" ? "TESTING" : policy.decision === "DENY" ? "BLOCKED" : "APPROVAL_REQUIRED",
    actor: "AG-GUARD",
    agentId: "AG-GUARD",
    taskId: task.taskId,
    action: "guardian.check",
    resource: task.taskId,
    decision: policy.decision,
    argumentsValue: policy.reasons
  });
  if (policy.decision === "DENY") {
    task.status = "BLOCKED";
    persist();
    return snapshot();
  }
  if (policy.decision === "REQUIRE_APPROVAL" && !state.approvals.some(a => a.taskId === task.taskId && a.status === "PENDING")) {
    requestApproval({taskId: task.taskId, reason: policy.reasons.join("; "), requestedBy: "AG-GUARD"});
  }
  return snapshot();
}

/* ---------------------------------------------------------------- Lockdown */

export function setLockdown(locked: boolean, actor = "CREATOR") {
  state.locked = locked;
  state.agents = state.agents.map(a => ({...a, status: locked ? ("BLOCKED" as Status) : ("WAITING" as Status)}));
  persist();
  observe({
    type: locked ? "control.lockdown" : "control.unlock",
    message: locked ? "Emergency Lockdown aktiviert" : "Emergency Lockdown aufgehoben",
    status: locked ? "ERROR" : "COMPLETED",
    actor,
    action: locked ? "control.lockdown" : "control.unlock",
    decision: "ALLOW",
    argumentsValue: {locked}
  });
  return snapshot();
}

export function isLocked(): boolean {
  return state.locked;
}

/** Nur für Tests/Diagnose: State-Store-Integrität. */
export function controlStateReport() {
  return store.integrity();
}
