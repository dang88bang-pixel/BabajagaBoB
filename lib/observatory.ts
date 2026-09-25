import {getDomainEvent, listDomainEvents, temporalChain, type DomainEvent} from "./events/log";
import {listScience, listEvidence, type Evidence} from "./science";
import {listFailures, listRecoveryPlans} from "./reliability";
import {listKnowledge} from "./knowledge";
import {provenanceFor} from "./provenance";
import {statusMeta} from "./status";
import type {KnowledgeState, Status} from "./types";

/**
 * Agent Observatory und „Warum?“-Record (Abschnitt 11 / 12).
 *
 * Beide Funktionen sind **reine Projektionen** über bereits persistierte Daten
 * (Ereignis-Log, Wissenschafts-Store, Verlässlichkeit, Wissen, Provenance).
 * Sie erzeugen keine neue Wahrheit: Was nicht dokumentiert wurde, bleibt leer
 * und wird als Lücke benannt — es wird nicht geschätzt und nicht ergänzt.
 *
 * Der „Warum?“-Record gibt die **dokumentierte Begründung** wieder (Zweck,
 * Entscheidung, Referenzen, Kausalkette). Er ist ausdrücklich keine
 * Gedankenkette: Es gibt kein Feld für verborgene Überlegungen, und jedes Feld
 * stammt aus einem Event oder einem Store-Eintrag.
 */

export type ActivityKind = "RUN" | "EXPERIMENT" | "TASK";

/** Eine Aktivität mit den neun Feldern des Observatory (Objective … nächster Schritt). */
export type ActivityRecord = {
  activityId: string;
  kind: ActivityKind;
  status: Status;
  statusLabel: string;
  statusGroup: string;
  objective?: string;
  observations: string[];
  hypothesis?: string;
  action?: string;
  expectation?: string;
  result?: string;
  evidenceIds: string[];
  conclusion?: string;
  nextStep?: string;
  eventIds: string[];
  causalParentId?: string;
  updatedAt: string;
  /** Vollständigkeit der neun Felder — was fehlt, wird benannt statt gefüllt. */
  gaps: string[];
};

export type ActivityQuery = {activityId?: string; kind?: ActivityKind; runId?: string; experimentId?: string; taskId?: string; limit?: number};

const MAX_OBSERVATIONS = 5;

function isObservation(event: DomainEvent, kind: ActivityKind): boolean {
  if (event.status === "OBSERVING") return true;
  if (event.result) return true;
  if (/observ|measured|messung|baseline|kontrolle|control|replikat/i.test(`${event.type} ${event.action ?? ""} ${event.message}`)) return true;
  // Ein Lauf dokumentiert seinen Fortschritt als Zustandsbericht; genau das ist
  // die Beobachtung des Laufs. Es entsteht kein zweiter Datenpfad — dieselben
  // Ereignisse werden nur unter dem Beobachtungsaspekt gelesen.
  return kind === "RUN" && event.type.startsWith("run.");
}

type Group = {activityId: string; kind: ActivityKind; events: DomainEvent[]};

function groupEvents(events: DomainEvent[]): Group[] {
  const groups = new Map<string, Group>();
  for (const event of events) {
    const reference: [string, ActivityKind] | null = event.experimentId
      ? [event.experimentId, "EXPERIMENT"]
      : event.runId
        ? [event.runId, "RUN"]
        : event.taskId
          ? [event.taskId, "TASK"]
          : null;
    // Ereignisse ohne Bezug auf eine Aktivität gehören in die Timeline, nicht ins
    // Observatory: Eine Aktivität ohne Referenz wäre nicht nachvollziehbar.
    if (!reference) continue;
    const [activityId, kind] = reference;
    const group = groups.get(activityId) ?? {activityId, kind, events: []};
    group.events.push(event);
    groups.set(activityId, group);
  }
  return [...groups.values()];
}

function buildActivity(group: Group): ActivityRecord {
  const events = group.events;
  const last = events[events.length - 1];
  const science = listScience();
  const experiment = science.experiments.find(entry => entry.experimentId === group.activityId);
  const runs = science.runs.filter(entry => entry.experimentId === group.activityId);
  const decisions = science.decisions.filter(entry => entry.taskId === (experiment?.taskId ?? last.taskId));
  const decision = decisions[decisions.length - 1];
  const evidence: Evidence[] = experiment ? listEvidence(experiment.experimentId) : [];

  const observations = events
    .filter(event => isObservation(event, group.kind))
    .slice(-MAX_OBSERVATIONS)
    .map(event => event.message);

  const objective = [...events].reverse().find(event => event.purpose)?.purpose ?? experiment?.title ?? last.purpose ?? undefined;
  const failure = listFailures().find(entry => entry.taskId === last.taskId || entry.incidentId === last.taskId);
  const plan = failure ? listRecoveryPlans().find(entry => entry.failureId === failure.failureId) : undefined;
  const knowledge = listKnowledge().nodes.filter(entry => entry.sourceIds.includes(group.activityId) || entry.evidenceIds.some(id => evidence.some(item => item.evidenceId === id)));

  const status: Status = experiment?.status ?? last.status;
  const record: ActivityRecord = {
    activityId: group.activityId,
    kind: group.kind,
    status,
    statusLabel: statusMeta(status).label,
    statusGroup: statusMeta(status).group,
    objective,
    observations,
    hypothesis: experiment?.hypothesis ?? decision?.hypothesis,
    action: [...events].reverse().find(event => event.action)?.action,
    expectation: experiment?.expectedResult ?? decision?.expectedResult,
    result: experiment?.observedResult ?? [...events].reverse().find(event => event.result)?.result,
    evidenceIds: experiment ? experiment.evidenceIds : evidence.map(item => item.evidenceId),
    conclusion: experiment?.knowledgeState ?? (knowledge[0] ? `${knowledge[0].subject} ${knowledge[0].predicate} ${knowledge[0].object}` : decision?.conclusion),
    nextStep: decision?.nextAction ?? plan?.verificationPlan.join("; ") ?? failure?.prevention.join("; "),
    eventIds: events.map(event => event.eventId),
    causalParentId: last.causalParentId,
    updatedAt: last.timestamp,
    gaps: [],
  };
  if (runs.length > 0 && !record.observations.length) record.gaps.push("keine Beobachtung mit Messwert dokumentiert");
  const required: [keyof ActivityRecord, unknown][] = [
    ["objective", record.objective],
    ["observations", record.observations.length > 0 ? record.observations : undefined],
    ["hypothesis", record.hypothesis],
    ["action", record.action],
    ["expectation", record.expectation],
    ["result", record.result],
    ["evidenceIds", record.evidenceIds.length > 0 ? record.evidenceIds : undefined],
    ["conclusion", record.conclusion],
    ["nextStep", record.nextStep]
  ];
  record.gaps.push(...required.filter(([, value]) => value === undefined || value === null || (Array.isArray(value) && value.length === 0)).map(([key]) => `Feld ${key} ist nicht dokumentiert`));
  return record;
}

/** Alle Aktivitäten, neueste zuerst. */
export function listActivities(query: ActivityQuery = {}): ActivityRecord[] {
  const events = listDomainEvents({order: "asc"});
  const groups = groupEvents(events)
    .filter(group => !query.kind || group.kind === query.kind)
    .filter(group => !query.activityId || group.activityId === query.activityId)
    .filter(group => !query.runId || group.activityId === query.runId)
    .filter(group => !query.experimentId || group.activityId === query.experimentId)
    .filter(group => !query.taskId || group.activityId === query.taskId)
    .map(buildActivity)
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  return query.limit && query.limit > 0 ? groups.slice(0, query.limit) : groups;
}

export function getActivity(activityId: string): ActivityRecord | null {
  return listActivities({activityId})[0] ?? null;
}

export type WhyRecord = {
  found: true;
  eventId: string;
  type: string;
  message: string;
  timestamp: string;
  status: Status;
  statusLabel: string;
  actor: string;
  action?: string;
  decision?: string;
  purpose?: string;
  result?: string;
  taskId?: string;
  runId?: string;
  sandboxId?: string;
  experimentId?: string;
  authorizationRef?: string;
  provenanceRef?: string;
  causedBy: string[];
  chain: {eventId: string; sequence: number; timestamp: string; type: string; message: string; actor: string; action?: string; decision?: string; purpose?: string}[];
  evidence: {evidenceId: string; kind: string; claim: string; value: string; knowledgeState: KnowledgeState; observedAt: string}[];
  knowledge: {knowledgeId: string; subject: string; predicate: string; object: string; state: KnowledgeState; confidence: string}[];
  provenance: {nodes: string[]; edges: number};
  /** Was dieser Record nicht beantworten kann — ausdrücklich benannt. */
  limitations: string[];
};

/**
 * Begründung eines Ereignisses: Zweck, Entscheidung, Referenzen, Kausalkette.
 * Gibt `null` zurück, wenn das Ereignis nicht existiert (die Route antwortet 404).
 */
export function whyRecord(eventId: string): WhyRecord | null {
  const event = getDomainEvent(eventId);
  if (!event) return null;
  const chain = temporalChain(eventId);
  const provenance = provenanceFor(eventId);
  const evidence = event.experimentId ? listEvidence(event.experimentId) : [];
  const knowledge = listKnowledge().nodes.filter(entry => entry.sourceIds.includes(eventId) || Boolean(event.experimentId && entry.sourceIds.includes(event.experimentId)));

  const limitations: string[] = [
    "Dieser Record gibt die dokumentierte Begründung wieder (Zweck, Entscheidung, Referenzen) — keine verborgene Gedankenkette."
  ];
  if (!event.purpose) limitations.push("Für dieses Ereignis wurde kein Zweck dokumentiert (Feld `purpose` fehlt).");
  if (chain.length <= 1) limitations.push("Kein kausaler Vorgänger im Log — die Kette beginnt hier (Kettenanfang oder gekürzter Log).");
  if (chain.length >= 50) limitations.push("Kette bei der maximalen Tiefe von 50 Ereignissen abgeschnitten.");
  if (!event.authorizationRef) limitations.push("Keine Autorisierungsreferenz am Ereignis — nicht jede Beobachtung ist eine autorisierte Ausführung.");
  if (!event.provenanceRef) limitations.push("Keine Provenance-Referenz am Ereignis; die Provenance-Verknüpfung wurde über die Ereignis-ID ermittelt.");

  return {
    found: true,
    eventId: event.eventId,
    type: event.type,
    message: event.message,
    timestamp: event.timestamp,
    status: event.status,
    statusLabel: statusMeta(event.status).label,
    actor: event.actor,
    action: event.action,
    decision: event.decision,
    purpose: event.purpose,
    result: event.result,
    taskId: event.taskId,
    runId: event.runId,
    sandboxId: event.sandboxId,
    experimentId: event.experimentId,
    authorizationRef: event.authorizationRef,
    provenanceRef: event.provenanceRef,
    causedBy: event.causedBy ?? [],
    chain: chain.map(entry => ({
      eventId: entry.eventId,
      sequence: entry.sequence,
      timestamp: entry.timestamp,
      type: entry.type,
      message: entry.message,
      actor: entry.actor,
      action: entry.action,
      decision: entry.decision,
      purpose: entry.purpose
    })),
    evidence: evidence.map(item => ({evidenceId: item.evidenceId, kind: item.kind, claim: item.claim, value: item.value, knowledgeState: item.knowledgeState, observedAt: item.observedAt})),
    knowledge: knowledge.map(entry => ({knowledgeId: entry.knowledgeId, subject: entry.subject, predicate: entry.predicate, object: entry.object, state: entry.state, confidence: entry.confidence})),
    provenance: {nodes: provenance.nodes.map(node => `${node.kind}:${node.id}`), edges: provenance.edges.length},
    limitations
  };
}
