import crypto from "node:crypto";
import {createStore} from "./persistence/store";
import {observe} from "./observability";
import {capabilityMatches} from "./authority";
import type {Risk} from "./types";

/**
 * Governance (Abschnitt 8).
 *
 * Kill Switches sind fail-closed und dürfen von Agents weder gesetzt noch
 * aufgehoben werden. Delegationen sind scope-, zeit- und risikogebunden und
 * jederzeit widerrufbar. Der System-Kill-Switch blockiert jede Ausführung.
 */

export type KillScope = "SYSTEM" | "AGENT" | "TASK" | "EXPERIMENT" | "SANDBOX" | "DEPLOYMENT";

export type KillSwitch = {
  scope: KillScope;
  targetId: string;
  active: boolean;
  reason: string;
  updatedAt: string;
  updatedBy: string;
};

export type Delegation = {
  delegationId: string;
  from: string;
  to: string;
  capabilities: string[];
  maxRisk: Risk;
  taskId?: string;
  sandboxId?: string;
  expiresAt: string;
  status: "ACTIVE" | "REVOKED" | "EXPIRED";
  createdAt: string;
  createdBy: string;
};

type Payload = {switches: KillSwitch[]; delegations: Delegation[]};
const store = createStore<Payload>("governance", 2, () => ({switches: [], delegations: []}));

const CREATOR_ACTORS = new Set(["CREATOR", "OPERATOR-TOKEN"]);
const GOVERNANCE_ACTORS = new Set(["CREATOR", "OPERATOR-TOKEN", "AG-GUARD"]);

export function setKillSwitch(scope: KillScope, targetId: string, active: boolean, reason: string, actor = "CREATOR"): KillSwitch {
  if (!GOVERNANCE_ACTORS.has(actor)) throw new Error(`actor ${actor} may not change kill switches`);
  if (!active && !CREATOR_ACTORS.has(actor)) throw new Error("releasing a kill switch requires Creator authority");
  if (!reason) throw new Error("kill switch requires a reason");

  const payload = store.read();
  const existing = payload.switches.find(s => s.scope === scope && s.targetId === targetId);
  const updatedAt = new Date().toISOString();
  if (existing) {
    existing.active = active;
    existing.reason = reason;
    existing.updatedAt = updatedAt;
    existing.updatedBy = actor;
  } else {
    payload.switches.push({scope, targetId, active, reason, updatedAt, updatedBy: actor});
  }
  store.write(payload);
  observe({
    type: "governance.kill_switch",
    message: `${scope}/${targetId}: ${active ? "aktiv" : "inaktiv"} (${reason})`,
    status: active ? "ERROR" : "COMPLETED",
    actor,
    action: "governance.kill-switch",
    resource: targetId,
    decision: active ? "DENY" : "ALLOW",
    argumentsValue: {scope, targetId, active, reason}
  });
  return structuredClone(payload.switches.find(s => s.scope === scope && s.targetId === targetId)!);
}

export function isKilled(scope: KillScope, targetId: string): boolean {
  const payload = store.read();
  if (payload.switches.some(s => s.active && s.scope === "SYSTEM")) return true;
  return payload.switches.some(s => s.active && s.scope === scope && s.targetId === targetId);
}

export function listKillSwitches(): KillSwitch[] {
  return structuredClone(store.read().switches);
}

export function createDelegation(
  input: {from: string; to: string; capabilities: string[]; maxRisk?: Risk; taskId?: string; sandboxId?: string; expiresAt: string; createdBy?: string},
  actor = input.createdBy ?? input.from
): Delegation {
  if (input.from === input.to) throw new Error("self delegation rejected");
  if (!input.capabilities.length) throw new Error("delegation requires capabilities");
  if (new Date(input.expiresAt) <= new Date()) throw new Error("delegation already expired");
  if (input.from !== "CREATOR" && actor !== "CREATOR" && !CREATOR_ACTORS.has(actor)) {
    const payload = store.read();
    const parent = payload.delegations.find(d => d.to === input.from && d.status === "ACTIVE" && d.capabilities.some(c => input.capabilities.every(x => capabilityMatches(c, x))));
    if (!parent) throw new Error(`principal ${input.from} has no active delegation covering the requested capabilities`);
  }
  const delegation: Delegation = {
    delegationId: `DEL-${crypto.randomUUID().slice(0, 8).toUpperCase()}`,
    from: input.from,
    to: input.to,
    capabilities: input.capabilities,
    maxRisk: input.maxRisk ?? "MODERATE",
    taskId: input.taskId,
    sandboxId: input.sandboxId,
    expiresAt: input.expiresAt,
    status: "ACTIVE",
    createdAt: new Date().toISOString(),
    createdBy: actor
  };
  store.update(payload => {
    payload.delegations.push(delegation);
  });
  observe({
    type: "governance.delegation.created",
    message: `Delegation ${delegation.delegationId}: ${delegation.from} → ${delegation.to}`,
    status: "COMPLETED",
    actor,
    action: "governance.delegate",
    resource: delegation.delegationId,
    argumentsValue: {capabilities: delegation.capabilities, maxRisk: delegation.maxRisk, expiresAt: delegation.expiresAt}
  });
  return structuredClone(delegation);
}

export function revokeDelegation(delegationId: string, actor = "CREATOR"): Delegation {
  const payload = store.read();
  const delegation = payload.delegations.find(d => d.delegationId === delegationId);
  if (!delegation) throw new Error("delegation not found");
  if (actor !== "CREATOR" && actor !== delegation.from) throw new Error("only the delegating principal or the Creator may revoke");
  delegation.status = "REVOKED";
  store.write(payload);
  observe({
    type: "governance.delegation.revoked",
    message: `Delegation ${delegationId} widerrufen`,
    status: "BLOCKED",
    actor,
    action: "governance.revoke-delegation",
    resource: delegationId,
    decision: "DENY"
  });
  return structuredClone(delegation);
}

export function validateDelegation(delegationId: string, capability: string): Delegation | null {
  const payload = store.read();
  const delegation = payload.delegations.find(d => d.delegationId === delegationId);
  if (!delegation) return null;
  if (delegation.status !== "ACTIVE") return null;
  if (new Date(delegation.expiresAt) <= new Date()) return null;
  if (!delegation.capabilities.some(c => capabilityMatches(c, capability))) return null;
  return structuredClone(delegation);
}

export function listDelegations(): Delegation[] {
  return structuredClone(store.read().delegations);
}

export function delegationIntegrity() {
  const delegations = store.read().delegations;
  const now = Date.now();
  return {
    count: delegations.length,
    active: delegations.filter(d => d.status === "ACTIVE" && new Date(d.expiresAt).getTime() > now).length,
    expired: delegations.filter(d => d.status === "ACTIVE" && new Date(d.expiresAt).getTime() <= now).length,
    revoked: delegations.filter(d => d.status === "REVOKED").length
  };
}

/** Einheitlicher Auditpfad für Governance-Aktionen (Kill-Switch, Delegation). */
export function auditGovernance(action: string, target: string, detail: string, actor = "CREATOR") {
  observe({
    type: `governance.${action}`,
    message: `Governance-Aktion ${action} auf ${target}`,
    status: action === "release" ? "COMPLETED" : "RUNNING",
    actor,
    action: `governance.${action}`,
    resource: target,
    decision: "ALLOW",
    argumentsValue: {detail}
  });
}

export function governanceStoreIntegrity() {
  return store.integrity();
}

/** Notfall-Lockdown: setzt den System-Kill-Switch. */
export function engageSystemLockdown(reason: string, actor = "CREATOR") {
  return setKillSwitch("SYSTEM", "SYSTEM", true, reason, actor);
}

export function releaseSystemLockdown(reason: string, actor = "CREATOR") {
  return setKillSwitch("SYSTEM", "SYSTEM", false, reason, actor);
}
