import {appendDomainEvent, type CausalRelation, type DomainEvent} from "./events/log";
import {addProvenanceEdge, addProvenanceNode, type ProvenanceNodeKind} from "./provenance";
import {recordAudit} from "./audit";
import type {Status} from "./types";

/**
 * Einheitlicher Beobachtungspfad (Abschnitt 6):
 *
 *   Intent → Task → Authorization → Run → Action → Observation → Evidence → Result
 *
 * Jeder Aufruf schreibt genau einmal in den kanonischen Event-Log und ergänzt
 * Audit- und Provenance-Daten. Es gibt keinen zweiten Eventpfad.
 */

export type ObservationInput = {
  type: string;
  message: string;
  status: Status;
  actor: string;
  action: string;
  decision?: string;
  resource?: string;
  taskId?: string;
  runId?: string;
  jobId?: string;
  sandboxId?: string;
  experimentId?: string;
  agentId?: string;
  inputRef?: string;
  outputRef?: string;
  authorizationRef?: string;
  provenanceRef?: string;
  /** Klartext-Zweck der beobachteten Aktion (Nachvollziehbarkeit). */
  purpose?: string;
  result?: string;
  causedBy?: string[];
  causalParentId?: string;
  argumentsValue?: unknown;
  from?: string;
  to?: string;
  relation?: CausalRelation;
};

const kindByPrefix = (id: string): ProvenanceNodeKind => {
  const map: [string, ProvenanceNodeKind][] = [
    ["RUN-", "RUN"],
    ["JOB-", "JOB"],
    ["SB-", "SANDBOX"],
    ["TASK-", "TASK"],
    ["MIS-", "MISSION"],
    ["OBJ-", "OBJECTIVE"],
    ["CAP-", "CAPABILITY"],
    ["ART-", "ARTIFACT"],
    ["EVD-", "EVIDENCE"],
    ["EXP-", "EXPERIMENT"],
    ["ERR-", "INCIDENT"],
    ["REC-", "RECOVERY"],
    ["REG-", "REGRESSION"],
    ["KN-", "KNOWLEDGE"],
    ["DEV-", "DEVICE"],
    ["PROV-", "PROVIDER"],
    ["AG-", "AGENT"],
    ["WS-", "WORKSHOP_ITEM"],
    ["DEP-", "DEPLOYMENT"],
    ["EVT-", "EVENT"]
  ];
  return map.find(([prefix]) => id.startsWith(prefix))?.[1] ?? "ARTIFACT";
};

export function observe(input: ObservationInput): DomainEvent {
  const event = appendDomainEvent({
    type: input.type,
    message: input.message,
    status: input.status,
    actor: input.actor,
    agentId: input.agentId,
    taskId: input.taskId,
    runId: input.runId,
    jobId: input.jobId,
    sandboxId: input.sandboxId,
    experimentId: input.experimentId,
    action: input.action,
    decision: input.decision,
    inputRef: input.inputRef,
    outputRef: input.outputRef,
    authorizationRef: input.authorizationRef,
    provenanceRef: input.provenanceRef,
    result: input.result,
    causedBy: input.causedBy,
    causalParentId: input.causalParentId,
    purpose: input.purpose
  });

  addProvenanceNode({id: event.eventId, kind: "EVENT", label: event.type});
  if (input.resource && !input.resource.includes(":")) {
    addProvenanceNode({id: input.resource, kind: kindByPrefix(input.resource), label: input.resource});
    addProvenanceEdge({from: event.eventId, to: input.resource, relation: "OBSERVED"});
  }
  if (input.runId && !input.runId.includes(":")) {
    addProvenanceNode({id: input.runId, kind: "RUN", label: input.runId, runId: input.runId});
    addProvenanceEdge({from: event.eventId, to: input.runId, relation: "OBSERVED"});
  }
  if (input.from && input.to && input.relation) addProvenanceEdge({from: input.from, to: input.to, relation: input.relation});

  recordAudit(
    {
      actor: input.actor,
      action: input.action,
      resource: input.resource ?? input.taskId ?? input.runId,
      eventId: event.eventId,
      decision: input.decision ?? "ALLOW",
      causalParentId: event.causalParentId
    },
    input.argumentsValue ?? null
  );

  return event;
}
