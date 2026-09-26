/**
 * Kompatibilitätsgrenze zum kanonischen Event-Log.
 *
 * Es gibt genau EINEN Event-Persistenzpfad: `lib/events/log.ts`.
 * Dieses Modul existiert nur, damit bestehende Importe weiter funktionieren,
 * und darf nicht selbst persistieren.
 */
import type {Event, Status} from "./types";
import {
  appendDomainEvent,
  eventLogIntegrity,
  latestDomainEvent,
  listDomainEvents,
  type DomainEvent
} from "./events/log";

function toLegacy(domain: DomainEvent): Event {
  return {
    id: domain.eventId,
    type: domain.type,
    message: domain.message,
    status: domain.status,
    time: domain.timestamp,
    actor: domain.actor,
    taskId: domain.taskId,
    resource: domain.sandboxId ?? domain.taskId,
    causalParentId: domain.causalParentId
  };
}

export function loadEvents(): Event[] {
  return listDomainEvents({order: "asc"}).map(toLegacy).reverse();
}

export function appendEventPersistent(event: Event): Event {
  const appended = appendDomainEvent({
    type: event.type,
    message: event.message,
    status: (event.status ?? "RUNNING") as Status,
    actor: event.actor,
    taskId: event.taskId,
    causalParentId: event.causalParentId
  });
  return toLegacy(appended);
}

export function eventStoreIntegrity() {
  const integrity = eventLogIntegrity();
  return {ok: integrity.ok && integrity.valid, count: integrity.length, issues: integrity.issues, file: integrity.file};
}

export {latestDomainEvent};
