import crypto from "node:crypto";
import {createStore} from "./persistence/store";
import {observe} from "./observability";

/**
 * Approval Center (Abschnitt 34).
 *
 * Jede Freigabe dokumentiert vollständig:
 *   WAS wird geändert? WARUM? erwarteter Effekt, Risiken, Tests, Dateien,
 *   DB-Änderungen, Netzwerkänderungen, Rollback, betroffene Systeme,
 *   Agent, Task, Sandbox.
 *
 * Entscheidungen sind unveränderlich nachvollziehbar (append-only Historie,
 * keine nachträgliche Änderung einer getroffenen Entscheidung).
 */

export type ApprovalRequest = {
  approvalId: string;
  taskId: string;
  runId?: string;
  sandboxId?: string;
  requestedBy: string;
  changeSummary: string;
  why: string;
  expectedEffect: string;
  risks: string[];
  testResults: string[];
  rollbackPlan: string;
  files: string[];
  dbChanges: string[];
  networkEffects: string[];
  affectedSystems: string[];
  status: "PENDING" | "GRANTED" | "DENIED";
  createdAt: string;
  resolvedAt?: string;
  resolvedBy?: string;
  decisionReason?: string;
};

type Payload = {requests: ApprovalRequest[]; history: {approvalId: string; actor: string; decision: string; at: string; reason?: string}[]};
const store = createStore<Payload>("approvals", 2, () => ({requests: [], history: []}));

export function createApproval(x: Omit<ApprovalRequest, "approvalId" | "status" | "createdAt">): ApprovalRequest {
  const request: ApprovalRequest = {
    ...x,
    approvalId: `APR-${crypto.randomUUID().slice(0, 8).toUpperCase()}`,
    status: "PENDING",
    createdAt: new Date().toISOString()
  };
  store.update(payload => {
    payload.requests.push(request);
    if (payload.requests.length > 1000) payload.requests.splice(0, payload.requests.length - 1000);
  });
  observe({
    type: "approval.requested",
    message: `Freigabe ${request.approvalId} angefordert: ${request.changeSummary}`,
    status: "APPROVAL_REQUIRED",
    actor: request.requestedBy,
    agentId: request.requestedBy,
    taskId: request.taskId,
    runId: request.runId,
    sandboxId: request.sandboxId,
    action: "approval.request",
    resource: request.approvalId,
    decision: "REQUIRE_APPROVAL",
    argumentsValue: {
      changeSummary: request.changeSummary,
      why: request.why,
      expectedEffect: request.expectedEffect,
      risks: request.risks,
      rollbackPlan: request.rollbackPlan,
      affectedSystems: request.affectedSystems
    }
  });
  return structuredClone(request);
}

export function resolveApprovalRequest(approvalId: string, status: "GRANTED" | "DENIED", actor: string, reason?: string): ApprovalRequest {
  const payload = store.read();
  const request = payload.requests.find(r => r.approvalId === approvalId);
  if (!request) throw new Error("approval not found");
  if (request.status !== "PENDING") throw new Error("approval already resolved; decisions are immutable");
  if (actor !== "CREATOR" && actor !== "OPERATOR-TOKEN") throw new Error("only the Creator may resolve approvals");
  request.status = status;
  request.resolvedAt = new Date().toISOString();
  request.resolvedBy = actor;
  request.decisionReason = reason;
  payload.history.push({approvalId, actor, decision: status, at: request.resolvedAt, reason});
  store.write(payload);
  observe({
    type: `approval.${status.toLowerCase()}`,
    message: `Freigabe ${approvalId}: ${status}`,
    status: status === "GRANTED" ? "QUEUED" : "BLOCKED",
    actor,
    taskId: request.taskId,
    runId: request.runId,
    sandboxId: request.sandboxId,
    action: `approval.${status.toLowerCase()}`,
    resource: approvalId,
    decision: status === "GRANTED" ? "ALLOW" : "DENY",
    argumentsValue: {reason}
  });
  return structuredClone(request);
}

export function getApproval(approvalId: string): ApprovalRequest | null {
  return structuredClone(store.read().requests.find(r => r.approvalId === approvalId) ?? null);
}

export function listApprovals(): ApprovalRequest[] {
  return structuredClone(store.read().requests.slice().reverse());
}

export function approvalGranted(approvalId: string): boolean {
  return store.read().requests.some(r => r.approvalId === approvalId && r.status === "GRANTED");
}

export function approvalHistory(approvalId?: string) {
  return structuredClone(store.read().history.filter(h => !approvalId || h.approvalId === approvalId));
}

export function approvalStoreReport() {
  return store.integrity();
}
