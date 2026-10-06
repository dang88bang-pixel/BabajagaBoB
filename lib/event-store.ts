import type {Event} from "./types";
import {
  appendDomainEvent,
  eventLogIntegrity,
  listDomainEvents,
  type DomainEvent
} from "./events/log";

/**
 * Kompatibilitätsadapter für ältere Timeline-/Control-Plane-Aufrufer.
 *
 * Dieser Adapter besitzt KEINE eigene Persistenz mehr. Der kanonische
 * Event-Fabric liegt ausschließlich im Domain-Event-Log.
 */
const toLegacyEvent=(event:DomainEvent):Event=>({
  id:event.eventId,
  type:event.type,
  message:event.message,
  status:event.status,
  time:event.timestamp,
  actor:event.actor,
  taskId:event.taskId,
  resource:event.outputRef,
  causalParentId:event.causalParentId
});

export function loadEvents():Event[]{
  return listDomainEvents({order:"desc"}).map(toLegacyEvent);
}

export function appendEventPersistent(event:Event):Event{
  const persisted=appendDomainEvent({
    type:event.type,
    message:event.message,
    status:event.status,
    actor:event.actor,
    taskId:event.taskId,
    causalParentId:event.causalParentId,
    outputRef:event.resource
  });
  return toLegacyEvent(persisted);
}

export function eventStoreIntegrity(){
  const report=eventLogIntegrity();
  return {
    ok:report.valid,
    digest:undefined,
    version:1,
    count:report.length,
    issues:report.issues,
    trimmedSequence:report.trimmedSequence??0,
    canonical:true
  };
}
