import crypto from "node:crypto";
import {createStore} from "./persistence/store";
import {observe} from "./observability";

/**
 * Creator Inbox (Abschnitt 33).
 *
 *   INFORM   – Agent informiert
 *   ASK      – Agent benötigt eine Entscheidung
 *   BLOCK    – Agent kann nicht weiterarbeiten
 *   ESCALATE – Sicherheits-/Governance-/Risikoproblem
 *
 * Der Creator wird insbesondere gefragt bei unklaren Zielen, unlösbaren
 * Zielkonflikten, Produktionsrisiko, hoher/unklarer Datenfreigabe,
 * irreversiblen Änderungen und fehlender Autorität.
 */

export type InboxMode = "INFORM" | "ASK" | "BLOCK" | "ESCALATE";

export type InboxItem = {
  inboxId: string;
  mode: InboxMode;
  title: string;
  message: string;
  taskId?: string;
  runId?: string;
  incidentId?: string;
  createdAt: string;
  resolved: boolean;
  resolvedAt?: string;
  resolvedBy?: string;
  decision?: string;
};

type Payload = {items: InboxItem[]};
const store = createStore<Payload>("inbox", 1, () => ({items: []}));

const REQUIRES_CREATOR: InboxMode[] = ["ASK", "ESCALATE"];

export function notifyInbox(input: {mode: InboxMode; title: string; message: string; taskId?: string; runId?: string; incidentId?: string}): InboxItem {
  const item: InboxItem = {
    inboxId: `IN-${crypto.randomUUID().slice(0, 8).toUpperCase()}`,
    mode: input.mode,
    title: input.title,
    message: input.message,
    taskId: input.taskId,
    runId: input.runId,
    incidentId: input.incidentId,
    createdAt: new Date().toISOString(),
    resolved: false
  };
  store.update(payload => {
    payload.items.push(item);
    if (payload.items.length > 500) payload.items.splice(0, payload.items.length - 500);
  });
  observe({
    type: `inbox.${input.mode.toLowerCase()}`,
    message: `${input.mode}: ${input.title}`,
    status: input.mode === "BLOCK" ? "BLOCKED" : input.mode === "ESCALATE" ? "ERROR" : input.mode === "ASK" ? "APPROVAL_REQUIRED" : "COMPLETED",
    actor: "AG-SUP",
    agentId: "AG-SUP",
    taskId: input.taskId,
    runId: input.runId,
    action: "inbox.notify",
    resource: item.inboxId,
    argumentsValue: {mode: input.mode, message: input.message}
  });
  return structuredClone(item);
}

export function resolveInbox(inboxId: string, actor = "CREATOR", decision = "ACKNOWLEDGED"): InboxItem {
  const payload = store.read();
  const item = payload.items.find(i => i.inboxId === inboxId);
  if (!item) throw new Error("inbox item not found");
  if (item.resolved) throw new Error("inbox item already resolved");
  if (REQUIRES_CREATOR.includes(item.mode) && actor !== "CREATOR") throw new Error(`${item.mode} items may only be resolved by the Creator`);
  item.resolved = true;
  item.resolvedAt = new Date().toISOString();
  item.resolvedBy = actor;
  item.decision = decision;
  store.write(payload);
  observe({
    type: "inbox.resolved",
    message: `Inbox ${inboxId} beantwortet`,
    status: "COMPLETED",
    actor,
    action: "inbox.resolve",
    resource: inboxId,
    argumentsValue: {decision}
  });
  return structuredClone(item);
}

export function listInbox(): InboxItem[] {
  return structuredClone(store.read().items.slice().reverse());
}

export function inboxSummary() {
  const items = store.read().items;
  return {
    total: items.length,
    open: items.filter(i => !i.resolved).length,
    ask: items.filter(i => i.mode === "ASK" && !i.resolved).length,
    blocked: items.filter(i => i.mode === "BLOCK" && !i.resolved).length,
    escalated: items.filter(i => i.mode === "ESCALATE" && !i.resolved).length
  };
}

export function inboxStoreReport() {
  return store.integrity();
}
