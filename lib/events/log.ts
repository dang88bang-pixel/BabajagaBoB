import crypto from "node:crypto";
import type {Status} from "../types";
import {createStore} from "../persistence/store";

/**
 * Kanonischer Event-Log (Abschnitt 6).
 *
 * Wichtig für die Semantik:
 *  - `sequence` ist die physische Reihenfolge im Log (append-only).
 *  - `causalParentId` zeigt auf das *unmittelbar vorhergehende* Event (PREVIOUS).
 *    Diese Kante ist rein temporal und bedeutet NICHT automatisch Kausalität.
 *  - Echte Kausalität wird ausschließlich explizit behauptet:
 *      `causedBy` (Event-IDs) und/oder Provenance-Kanten (CAUSED_BY, DERIVED_FROM, ...).
 *
 * Richtungskonsistenz: `causalParentId` zeigt immer auf ein Event mit kleinerer
 * `sequence`. `listDomainEvents({order:"asc"})` liefert älteste zuerst, `desc`
 * neueste zuerst. Es gibt genau eine Persistenzdatei (events.json).
 */

export type CausalRelation =
  | "CAUSED_BY"
  | "DERIVED_FROM"
  | "EXECUTED_IN"
  | "AUTHORIZED_BY"
  | "TESTED_BY"
  | "PRODUCED"
  | "OBSERVED"
  | "REPRODUCED_BY"
  | "CONTRADICTED_BY";

export type DomainEvent = {
  eventId: string;
  sequence: number;
  timestamp: string;
  type: string;
  message: string;
  status: Status;
  actor: string;
  agentId?: string;
  taskId?: string;
  runId?: string;
  jobId?: string;
  sandboxId?: string;
  experimentId?: string;
  action?: string;
  decision?: string;
  inputRef?: string;
  outputRef?: string;
  authorizationRef?: string;
  provenanceRef?: string;
  result?: string;
  causedBy?: string[];
  causalParentId?: string;
  /** Richtung von causalParentId: immer das ältere (vorhergehende) Event. */
  parentDirection: "PREVIOUS";
};

export type DomainEventInput = Omit<DomainEvent, "eventId" | "sequence" | "timestamp" | "parentDirection" | "causalParentId"> & {
  causalParentId?: string;
};

type Payload = {events: DomainEvent[]; maxRetained: number};
const MAX_EVENTS = 5000;
const store = createStore<Payload>("events", 1, () => ({events: [], maxRetained: MAX_EVENTS}));

export function appendDomainEvent(input: DomainEventInput): DomainEvent {
  const event = store.update(payload => {
    const previous = payload.events[payload.events.length - 1];
    const next: DomainEvent = {
      ...input,
      eventId: `EVT-${crypto.randomUUID()}`,
      sequence: (previous?.sequence ?? 0) + 1,
      timestamp: new Date().toISOString(),
      causalParentId: input.causalParentId ?? previous?.eventId,
      parentDirection: "PREVIOUS"
    };
    payload.events.push(next);
    if (payload.events.length > payload.maxRetained) payload.events.splice(0, payload.events.length - payload.maxRetained);
    return next;
  });
  return event;
}

export type EventQuery = {
  limit?: number;
  order?: "asc" | "desc";
  taskId?: string;
  runId?: string;
  sandboxId?: string;
  agentId?: string;
  experimentId?: string;
  type?: string;
};

export function listDomainEvents(query: EventQuery = {}): DomainEvent[] {
  const {events} = store.read();
  const filtered = events.filter(
    e =>
      (!query.taskId || e.taskId === query.taskId) &&
      (!query.runId || e.runId === query.runId) &&
      (!query.sandboxId || e.sandboxId === query.sandboxId) &&
      (!query.agentId || e.agentId === query.agentId || e.actor === query.agentId) &&
      (!query.experimentId || e.experimentId === query.experimentId) &&
      (!query.type || e.type === query.type)
  );
  const ordered = query.order === "desc" ? filtered.slice().reverse() : filtered;
  return structuredClone(query.limit ? ordered.slice(-query.limit).reverse().reverse().slice(-query.limit) : ordered);
}

export function latestDomainEvent(): DomainEvent | null {
  const {events} = store.read();
  return events.length ? structuredClone(events[events.length - 1]) : null;
}

export function getDomainEvent(eventId: string): DomainEvent | null {
  const {events} = store.read();
  const found = events.find(e => e.eventId === eventId);
  return found ? structuredClone(found) : null;
}

export type EventChainVerification = {valid: boolean; length: number; issues: string[]};

/**
 * Integritätsprüfung der Event-Kette (Abschnitt 6):
 *  - Sequenz muss lückenlos aufsteigen
 *  - causalParentId muss existieren und auf ein älteres Event zeigen
 *  - Zeitstempel dürfen nicht rückwärts laufen
 *  - causedBy darf nur auf existierende, ältere Events verweisen
 */
export function verifyEventChain(): EventChainVerification {
  const {events} = store.read();
  const issues: string[] = [];
  const bySequence = new Map<number, DomainEvent>();
  for (const event of events) bySequence.set(event.sequence, event);

  let expected = 1;
  let previousTimestamp = "";
  for (const event of events) {
    if (event.sequence !== expected) issues.push(`sequence gap at ${event.eventId}: expected ${expected}, found ${event.sequence}`);
    expected = event.sequence + 1;
    if (event.causalParentId) {
      const parent = events.find(e => e.eventId === event.causalParentId);
      if (!parent) issues.push(`missing causal parent for ${event.eventId}`);
      else if (parent.sequence >= event.sequence) issues.push(`causal parent ${parent.eventId} is not older than ${event.eventId}`);
    }
    for (const cause of event.causedBy ?? []) {
      const antecedent = events.find(e => e.eventId === cause);
      if (!antecedent) issues.push(`unknown causedBy reference ${cause} in ${event.eventId}`);
      else if (antecedent.sequence >= event.sequence) issues.push(`causedBy reference ${cause} is not older than ${event.eventId}`);
    }
    if (previousTimestamp && event.timestamp < previousTimestamp) issues.push(`timestamp regression at ${event.eventId}`);
    previousTimestamp = event.timestamp;
  }
  return {valid: issues.length === 0, length: events.length, issues};
}

export function eventLogIntegrity() {
  const report = store.integrity();
  return {...report, ...verifyEventChain()};
}

export function eventStoreReport() {
  return store.integrity();
}

/** Liefert die temporale Kette (Vorgänger → Ereignis) für Replay-Darstellungen. */
export function temporalChain(eventId: string, maxDepth = 50): DomainEvent[] {
  const {events} = store.read();
  const index = new Map(events.map(e => [e.eventId, e]));
  const chain: DomainEvent[] = [];
  let current = index.get(eventId);
  while (current && chain.length < maxDepth) {
    chain.unshift(structuredClone(current));
    current = current.causalParentId ? index.get(current.causalParentId) : undefined;
  }
  return chain;
}
