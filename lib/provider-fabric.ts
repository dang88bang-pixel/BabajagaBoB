import crypto from "node:crypto";
import {createStore} from "./persistence/store";
import {observe} from "./observability";
import {recordAudit} from "./audit";
import {approvalGranted} from "./approvals";
import {assertNoProtectedDataForThirdParty, type ProtectedDataClass} from "./data-boundary";

/**
 * Provider Fabric (Abschnitt 22).
 *
 * Externe Anbieter (Agent-Runtime, Sandbox, Workflow, Code-Agent, Build,
 * Computer, Deployment, Knowledge) sind niemals implizit nutzbar:
 * Discovery ≠ Autorisierung. Ein Provider ist nur nutzbar, wenn er verbunden,
 * ausdrücklich freigegeben (Approval) und an einen Scope gebunden ist.
 *
 * Der Zustand (Katalog, Bindungen, Telemetrie) ist persistent; jede Änderung
 * wird auditiert bzw. als Event festgehalten.
 */

export type ProviderCategory = "AGENT_RUNTIME" | "SANDBOX" | "WORKFLOW" | "CODE_AGENT" | "BUILD" | "COMPUTER" | "DEPLOYMENT" | "KNOWLEDGE" | "OTHER";
export type ProviderLifecycle = "DISCOVERED" | "EVALUATING" | "AUTHORIZED" | "CONNECTING" | "CONNECTED" | "DEGRADED" | "BLOCKED" | "DISCONNECTED" | "REVOKED";
export type ProviderHealth = "UNKNOWN" | "HEALTHY" | "DEGRADED" | "UNHEALTHY";

export type ProviderDefinition = {
  id: string;
  name: string;
  category: ProviderCategory;
  version: string;
  adapter: string;
  capabilities: string[];
  environments: string[];
  network: "DENY" | "ALLOWLIST" | "INTERNET";
  lifecycle: ProviderLifecycle;
  health: ProviderHealth;
  endpoint?: string;
  credentialRef?: string;
  lastHeartbeat?: string;
  lastError?: string;
  enabled: boolean;
  autonomousManagement: boolean;
  requiresApproval: boolean;
  dataPolicy: "METADATA_ONLY";
};

export type ProviderBinding = {
  id: string;
  providerId: string;
  scope: "SYSTEM" | "AGENT" | "TASK" | "SANDBOX";
  scopeId: string;
  capabilities: string[];
  createdAt: string;
  active: boolean;
};

export type ProviderTelemetry = {providerId: string; time: string; health: ProviderHealth; latencyMs?: number; message?: string};

type Payload = {providers: ProviderDefinition[]; bindings: ProviderBinding[]; telemetry: ProviderTelemetry[]};

/** Ausgangskatalog: alle Provider sind entdeckt, aber deaktiviert und unabgenommen. */
const SEED: ProviderDefinition[] = [
  {id: "prov-openhands", name: "OpenHands", category: "AGENT_RUNTIME", version: "adapter-1", adapter: "openhands", capabilities: ["code", "terminal", "browser", "files", "agent-actions"], environments: ["sandbox", "development", "experiment"], network: "ALLOWLIST", lifecycle: "DISCOVERED", health: "UNKNOWN", enabled: false, autonomousManagement: true, requiresApproval: true, dataPolicy: "METADATA_ONLY"},
  {id: "prov-daytona", name: "Daytona", category: "SANDBOX", version: "adapter-1", adapter: "daytona", capabilities: ["sandbox", "snapshot", "restore", "filesystem", "network-policy"], environments: ["development", "experiment", "test"], network: "ALLOWLIST", lifecycle: "DISCOVERED", health: "UNKNOWN", enabled: false, autonomousManagement: true, requiresApproval: true, dataPolicy: "METADATA_ONLY"},
  {id: "prov-e2b", name: "E2B", category: "SANDBOX", version: "adapter-1", adapter: "e2b", capabilities: ["sandbox", "isolated-vm", "snapshot", "computer"], environments: ["experiment", "test"], network: "ALLOWLIST", lifecycle: "DISCOVERED", health: "UNKNOWN", enabled: false, autonomousManagement: true, requiresApproval: true, dataPolicy: "METADATA_ONLY"},
  {id: "prov-temporal", name: "Temporal", category: "WORKFLOW", version: "adapter-1", adapter: "temporal", capabilities: ["durable-execution", "retry", "resume", "signals", "timers"], environments: ["control-plane"], network: "ALLOWLIST", lifecycle: "DISCOVERED", health: "UNKNOWN", enabled: false, autonomousManagement: true, requiresApproval: true, dataPolicy: "METADATA_ONLY"},
  {id: "prov-langgraph", name: "LangGraph", category: "WORKFLOW", version: "adapter-1", adapter: "langgraph", capabilities: ["agent-workflows", "durable-state", "human-in-loop"], environments: ["control-plane", "agent"], network: "ALLOWLIST", lifecycle: "DISCOVERED", health: "UNKNOWN", enabled: false, autonomousManagement: true, requiresApproval: true, dataPolicy: "METADATA_ONLY"},
  {id: "prov-swe-agent", name: "SWE-agent", category: "CODE_AGENT", version: "adapter-1", adapter: "swe-agent", capabilities: ["repository", "issue-to-patch", "tests", "code-repair"], environments: ["sandbox", "development"], network: "ALLOWLIST", lifecycle: "DISCOVERED", health: "UNKNOWN", enabled: false, autonomousManagement: true, requiresApproval: true, dataPolicy: "METADATA_ONLY"},
  {id: "prov-dagger", name: "Dagger", category: "BUILD", version: "adapter-1", adapter: "dagger", capabilities: ["build", "test", "package", "ci"], environments: ["sandbox", "ci"], network: "ALLOWLIST", lifecycle: "DISCOVERED", health: "UNKNOWN", enabled: false, autonomousManagement: true, requiresApproval: true, dataPolicy: "METADATA_ONLY"},
  {id: "prov-celesto", name: "Celesto", category: "COMPUTER", version: "adapter-1", adapter: "celesto", capabilities: ["browser", "desktop", "vm", "computer-use"], environments: ["browser", "desktop", "test"], network: "ALLOWLIST", lifecycle: "DISCOVERED", health: "UNKNOWN", enabled: false, autonomousManagement: true, requiresApproval: true, dataPolicy: "METADATA_ONLY"}
];

const store = createStore<Payload>("providers", 1, () => ({providers: structuredClone(SEED), bindings: [], telemetry: []}));
const clone = <T,>(value: T): T => structuredClone(value);

/** Änderung an genau einem Provider; nur bei Erfolg wird persistiert. */
function mutate(id: string, change: (provider: ProviderDefinition, payload: Payload) => void): ProviderDefinition {
  const payload = store.read();
  const provider = payload.providers.find(p => p.id === id);
  if (!provider) throw new Error("provider not found");
  change(provider, payload);
  store.write(payload);
  return clone(provider);
}

export function providerStoreReport() {
  return {...store.integrity(), providers: store.read().providers.length, bindings: store.read().bindings.length};
}

export function assertProviderPayloadAllowed(providerId: string, dataClass: ProtectedDataClass) {
  const provider = getProvider(providerId);
  if (!provider) throw new Error("provider not found");
  if (provider.dataPolicy === "METADATA_ONLY") assertNoProtectedDataForThirdParty(dataClass);
  return true;
}

export function listProviders() {
  return clone(store.read().providers);
}

export function getProvider(id: string) {
  return clone(store.read().providers.find(p => p.id === id) ?? null);
}

export function bindProvider(providerId: string, scope: ProviderBinding["scope"], scopeId: string, capabilities: string[]) {
  const provider = getProvider(providerId);
  if (!provider) throw new Error("provider not found");
  if (!provider.enabled || provider.lifecycle !== "CONNECTED") throw new Error("provider is not connected");
  if (!Array.isArray(capabilities) || capabilities.length === 0) throw new Error("binding requires explicit capabilities");
  const missing = capabilities.filter(capability => !provider.capabilities.includes(capability));
  if (missing.length) throw new Error(`provider does not offer: ${missing.join(", ")}`);
  const binding: ProviderBinding = {
    id: `bind-${crypto.randomUUID()}`,
    providerId,
    scope,
    scopeId,
    capabilities,
    createdAt: new Date().toISOString(),
    active: true
  };
  store.update(payload => {
    payload.bindings.push(binding);
    if (payload.bindings.length > 500) payload.bindings.splice(0, payload.bindings.length - 500);
  });
  recordAudit({actor: "CREATOR", action: "provider.bind", resource: providerId, decision: "ALLOW"}, {scope, scopeId, capabilities});
  observe({
    type: "provider.bound",
    message: `Provider ${providerId} an ${scope} ${scopeId} gebunden`,
    status: "COMPLETED",
    actor: "CREATOR",
    action: "provider.bind",
    resource: providerId,
    argumentsValue: {scope, scopeId, capabilities}
  });
  return clone(binding);
}

export function listBindings() {
  return clone(store.read().bindings);
}

export function setProviderState(id: string, lifecycle: ProviderLifecycle, health: ProviderHealth, message?: string) {
  const provider = mutate(id, p => {
    p.lifecycle = lifecycle;
    p.health = health;
    p.lastHeartbeat = new Date().toISOString();
    p.lastError = message;
  });
  observe({
    type: "provider.state",
    message: message ?? `${provider.name} -> ${lifecycle}`,
    status: lifecycle === "CONNECTED" ? "COMPLETED" : lifecycle === "DEGRADED" || lifecycle === "BLOCKED" ? "ERROR" : "RUNNING",
    actor: "provider-manager",
    agentId: "AG-INT",
    resource: id,
    action: "provider.state",
    decision: "ALLOW",
    argumentsValue: {lifecycle, health}
  });
  return provider;
}

export function connectProvider(id: string, endpoint?: string, credentialRef?: string, approvalId?: string) {
  const provider = getProvider(id);
  if (!provider) throw new Error("provider not found");
  if (provider.lifecycle === "REVOKED") throw new Error("provider is revoked");
  if (provider.requiresApproval && !approvalId) throw new Error("third-party provider connection requires explicit approval");
  if (provider.requiresApproval && approvalId && !approvalGranted(approvalId)) throw new Error("provider connection approval is not granted");
  mutate(id, p => {
    p.endpoint = endpoint;
    p.credentialRef = credentialRef;
    p.lifecycle = "CONNECTED";
    p.health = "HEALTHY";
    p.enabled = true;
    p.lastHeartbeat = new Date().toISOString();
    p.lastError = undefined;
  });
  return setProviderState(id, "CONNECTED", "HEALTHY", `${provider.name} connected through managed adapter`);
}

export function disconnectProvider(id: string) {
  const provider = getProvider(id);
  if (!provider) throw new Error("provider not found");
  deactivateBindings(id);
  mutate(id, p => {
    p.enabled = false;
    p.lifecycle = "DISCONNECTED";
    p.health = "UNKNOWN";
  });
  return setProviderState(id, "DISCONNECTED", "UNKNOWN", `${provider.name} disconnected`);
}

export function revokeProvider(id: string) {
  const provider = getProvider(id);
  if (!provider) throw new Error("provider not found");
  deactivateBindings(id);
  mutate(id, p => {
    p.enabled = false;
    p.lifecycle = "REVOKED";
    p.health = "UNKNOWN";
  });
  return setProviderState(id, "REVOKED", "UNKNOWN", `${provider.name} revoked`);
}

export function heartbeatProvider(id: string, input: {health: ProviderHealth; latencyMs?: number; message?: string}) {
  const provider = mutate(id, p => {
    p.health = input.health;
    p.lastHeartbeat = new Date().toISOString();
    p.lastError = input.message;
    if (input.health === "HEALTHY" && p.lifecycle !== "REVOKED" && p.lifecycle !== "DISCONNECTED") p.lifecycle = "CONNECTED";
    if (input.health === "DEGRADED" && p.lifecycle === "CONNECTED") p.lifecycle = "DEGRADED";
    if (input.health === "UNHEALTHY" && p.lifecycle !== "REVOKED" && p.lifecycle !== "DISCONNECTED") p.lifecycle = "BLOCKED";
  });
  store.update(payload => {
    payload.telemetry = payload.telemetry.filter(entry => entry.providerId !== id);
    payload.telemetry.push({providerId: id, time: provider.lastHeartbeat ?? new Date().toISOString(), health: input.health, latencyMs: input.latencyMs, message: input.message});
    if (payload.telemetry.length > 500) payload.telemetry.splice(0, payload.telemetry.length - 500);
  });
  observe({
    type: "provider.heartbeat",
    message: `${provider.name} health=${input.health}`,
    status: input.health === "HEALTHY" ? "RUNNING" : "ERROR",
    actor: "provider-monitor",
    agentId: "AG-INT",
    resource: id,
    action: "provider.heartbeat",
    decision: "ALLOW",
    argumentsValue: {latencyMs: input.latencyMs, message: input.message}
  });
  return provider;
}

function deactivateBindings(providerId: string) {
  store.update(payload => {
    for (const binding of payload.bindings) if (binding.providerId === providerId) binding.active = false;
  });
}

export function providerSnapshot() {
  const payload = store.read();
  return {
    providers: clone(payload.providers),
    bindings: clone(payload.bindings),
    telemetry: Object.fromEntries(payload.telemetry.map(entry => [entry.providerId, clone(entry)]))
  };
}
