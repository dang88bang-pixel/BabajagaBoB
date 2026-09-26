/**
 * Kanonische Domänentypen (Abschnitt 5).
 *
 * Jede Entität besitzt eine eigene, nicht mehrfach semantisch verwendete ID:
 * projectId, agentId, missionId, objectiveId, taskId, runId, jobId, sandboxId,
 * experimentId, artifactId, approvalId, deploymentId, deviceId, providerId,
 * eventId, evidenceId, incidentId, recoveryId, regressionId, knowledgeId.
 */

/**
 * Einheitliches Status-Modell (Abschnitt 5). Die vollständige Beschreibung jedes
 * Zustands (Anzeigetext, Farbe, Gruppe, Ergebnis) steht in `lib/status.ts`; dort
 * ist die Zuordnung als `Record<Status, …>` erzwungen, damit kein Zustand ohne
 * Darstellung existieren kann. Neue Zustände werden hier ergänzt, nicht in der UI.
 */
export type Status =
  | "QUEUED"
  | "PLANNING"
  | "RUNNING"
  | "THINKING"
  | "EXECUTING"
  | "EXPERIMENT"
  | "TESTING"
  | "OBSERVING"
  | "VALIDATING"
  | "WAITING"
  | "BLOCKED"
  | "APPROVAL_REQUIRED"
  | "ERROR"
  | "BUG"
  | "RECOVERING"
  | "ROLLING_BACK"
  | "SUCCEEDED"
  | "FAILED"
  | "COMPLETED"
  | "CANCELLED";

export type Risk = "SAFE" | "LOW" | "MODERATE" | "HIGH" | "CRITICAL";

export type KnowledgeState =
  | "OBSERVED"
  | "SUPPORTED"
  | "ESTABLISHED"
  | "HYPOTHESIS"
  | "UNVERIFIED"
  | "CONTRADICTED"
  | "REJECTED"
  | "UNKNOWN";

export type AgentKind =
  | "SUPERVISOR"
  | "PLANNER"
  | "BUILDER"
  | "RESEARCH"
  | "SCIENTIST"
  | "QA"
  | "BROWSER"
  | "GUARDIAN"
  | "OPERATOR"
  | "RECOVERY"
  | "INTEGRATOR";

export type Agent = {
  agentId: string;
  projectId: string;
  name: string;
  role: string;
  kind: AgentKind;
  status: Status;
  progress: number;
  task?: string;
  capabilities: string[];
  maxRisk: Risk;
  health: "HEALTHY" | "STALE" | "BLOCKED";
  heartbeatAt: string;
  createdAt: string;
};

export type Mission = {
  missionId: string;
  projectId: string;
  title: string;
  objective: string;
  status: Status;
  progress: number;
  owner: string;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
};

export type ObjectiveStatus = "PLANNED" | "ACTIVE" | "COMPLETED" | "BLOCKED" | "UNKNOWN";

export type Objective = {
  objectiveId: string;
  missionId: string;
  title: string;
  description: string;
  status: ObjectiveStatus;
  createdAt: string;
  updatedAt: string;
};

export type Task = {
  taskId: string;
  projectId: string;
  missionId: string;
  objectiveId: string | null;
  title: string;
  status: Status;
  progress: number;
  risk: Risk;
  assignedAgent: string | null;
  requiresApproval: boolean;
  createdAt: string;
  updatedAt: string;
};

export type ResourceLimits = {
  cpuMillicores: number;
  memoryMb: number;
  storageMb: number;
  timeoutMs: number;
  processes: number;
};

export type SandboxType =
  | "development"
  | "experiment"
  | "test"
  | "browser"
  | "security"
  | "migration"
  | "staging"
  | "recovery"
  | "diagnostic";

export type SandboxLifecycle = "CREATED" | "RUNNING" | "PAUSED" | "SNAPSHOTTED" | "RESTORED" | "DESTROYED" | "FAILED";

export type Sandbox = {
  sandboxId: string;
  projectId: string;
  type: SandboxType;
  status: Status;
  lifecycle: SandboxLifecycle;
  network: "DENY" | "ALLOWLIST";
  taskId: string;
  agentId: string;
  runtimeMode: "real-local" | "real-oci" | "mock";
  createdAt: string;
};

export type Approval = {
  approvalId: string;
  taskId: string;
  status: "PENDING" | "GRANTED" | "DENIED";
  reason: string;
  createdAt: string;
};

export type Experiment = {
  experimentId: string;
  missionId: string;
  objectiveId: string;
  title: string;
  status: Status;
  progress: number;
  sandboxId: string;
  hypothesis: string;
  knowledgeState: KnowledgeState;
};

/** Legacy-Eventprojektion für UI/Timeline (Quelle ist der kanonische Event-Log). */
export type Event = {
  id: string;
  type: string;
  message: string;
  status: Status;
  time: string;
  actor: string;
  taskId?: string;
  resource?: string;
  causalParentId?: string;
};

export type RunState =
  | "CREATED"
  | "QUEUED"
  | "LEASED"
  | "RUNNING"
  | "PAUSED"
  | "DIAGNOSING"
  | "ROOT_CAUSE_FOUND"
  | "RECOVERING"
  | "VERIFYING"
  | "SUCCEEDED"
  | "FAILED"
  | "ROLLED_BACK"
  | "CANCELLED"
  | "DEAD_LETTER";

export type JobState = "QUEUED" | "LEASED" | "RUNNING" | "SUCCEEDED" | "FAILED" | "CANCELLED" | "DEAD_LETTER";

export type ProviderLifecycle =
  | "DISCOVERED"
  | "EVALUATING"
  | "AUTHORIZED"
  | "CONNECTING"
  | "CONNECTED"
  | "DEGRADED"
  | "BLOCKED"
  | "DISCONNECTED"
  | "REVOKED";

export type ProviderHealth = "UNKNOWN" | "HEALTHY" | "DEGRADED" | "UNHEALTHY";

export type ControlState = {
  projectId: string;
  agents: Agent[];
  missions: Mission[];
  objectives: Objective[];
  tasks: Task[];
  sandboxes: Sandbox[];
  approvals: Approval[];
  experiments: Experiment[];
  locked: boolean;
  counters: Record<string, number>;
};

export type ToolLifecycle = "DRAFT" | "PROTOTYPE" | "TESTING" | "VALIDATED" | "REGISTERED" | "DEPRECATED";

export type SkillDefinition = {
  id: string;
  name: string;
  version: string;
  tools: string[];
  lifecycle: ToolLifecycle;
  provenance: string;
  validation: string[];
};
