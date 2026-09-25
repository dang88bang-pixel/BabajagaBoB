import crypto from "node:crypto";
import {createStore} from "./persistence/store";
import {observe} from "./observability";
import {recordAudit} from "./audit";
import type {Risk} from "./types";

/**
 * Authority-Graph und Capability-Tokens (Abschnitt 8).
 *
 * Unverhandelbare Regeln:
 *  - `Agent → authority.issue → self` ist verboten (Selbstausstellung).
 *  - Kein Agent darf sich Fähigkeiten, Risikostufen oder Laufzeiten erweitern.
 *  - Kein Agent darf beliebige Capabilities vergeben (nur delegierte Teilmengen).
 *  - Tokens sind kurzlebig, subjekt-/task-/sandbox-/environment-/risikogebunden.
 *  - Widerruf ist sofort wirksam; Widerruf selbst ist Creator/Guardian vorbehalten.
 *  - Ein Token umgeht niemals das Execution Gate oder eine Approval-Pflicht.
 *
 * Tokens werden als Geheimnis ausgegeben (einmalig sichtbar); gespeichert wird
 * nur der SHA-256-Hash. Für Audit-Zwecke existiert ausschließlich die Token-ID.
 */

export type AuthorityEdge = {
  id: string;
  from: string;
  to: string;
  kind: "DELEGATES" | "SCOPES" | "BINDS";
  capabilities: string[];
  maxRisk: Risk;
  expiresAt: string | null;
  createdAt: string;
  revoked?: boolean;
};

export type CapabilityToken = {
  id: string;
  subject: string;
  taskId: string;
  sandboxId: string;
  environment: string;
  capabilities: string[];
  risk: Risk;
  issuedBy: string;
  issuedByKind: "CREATOR" | "AGENT" | "SYSTEM";
  expiresAt: string;
  revoked: boolean;
  revokedAt?: string;
  secretHash: string;
  createdAt: string;
  /**
   * Wiederholungssperre (Abschnitt 15/37): Ein Token autorisiert höchstens
   * `maxUses` Ausführungen. Standard 1 — eine Autorisierung ist eine Ausführung.
   * `uses` wird atomar beim Start der Ausführung erhöht (fail closed).
   */
  maxUses?: number;
  uses?: number;
};

export type IssuedCapability = {token: CapabilityToken; secret: string};

type Payload = {edges: AuthorityEdge[]; tokens: CapabilityToken[]; revokedTokens: string[]; rootAuthorityId: string | null};
const store = createStore<Payload>("authority", 2, () => ({edges: [], tokens: [], revokedTokens: [], rootAuthorityId: null}));

export const riskRank: Record<Risk, number> = {SAFE: 0, LOW: 1, MODERATE: 2, HIGH: 3, CRITICAL: 4};
export const MAX_TOKEN_TTL_MS = 15 * 60_000;
/** Obergrenze für Mehrfachverwendung eines Tokens (bewusst niedrig gehalten). */
export const MAX_TOKEN_USES = 25;
export const MAX_AGENT_TOKEN_TTL_MS = 5 * 60_000;

const matches = (granted: string, needed: string) =>
  granted === "*" || granted === needed || (granted.endsWith(":*") && needed.startsWith(granted.slice(0, -1)));

const hashSecret = (secret: string) => crypto.createHash("sha256").update(secret).digest("hex");

export class AuthorityDenied extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = "AuthorityDenied";
    this.code = code;
  }
}

function deny(code: string, message: string, actor = "UNKNOWN", resource?: string): never {
  observe({
    type: "authority.denied",
    message: `Authority verweigert (${code}): ${message}`,
    status: "BLOCKED",
    actor,
    action: "authority.deny",
    resource,
    decision: "DENY",
    argumentsValue: {code, message}
  });
  throw new AuthorityDenied(code, message);
}

/* ------------------------------------------------------------------ Root */

export function setRootAuthority(rootAuthorityId: string | null, actor = "CREATOR") {
  if (rootAuthorityId === null && actor !== "CREATOR") deny("ROOT_REVOKE", "only the Creator may revoke the root authority", actor);
  store.update(payload => {
    payload.rootAuthorityId = rootAuthorityId;
  });
  observe({
    type: rootAuthorityId ? "authority.root.established" : "authority.root.revoked",
    message: rootAuthorityId ? `Root Authority ${rootAuthorityId} gesetzt` : "Root Authority widerrufen – System ist fail-closed",
    status: rootAuthorityId ? "COMPLETED" : "ERROR",
    actor,
    action: "authority.root",
    resource: rootAuthorityId ?? "ROOT",
    decision: rootAuthorityId ? "ALLOW" : "DENY"
  });
}

export function rootAuthorityId(): string | null {
  return store.read().rootAuthorityId;
}

export function hasActiveRootAuthority(): boolean {
  const payload = store.read();
  if (!payload.rootAuthorityId) return false;
  return payload.edges.some(e => e.from === "CREATOR" && !e.revoked && (e.expiresAt === null || new Date(e.expiresAt) > new Date()));
}

/* ------------------------------------------------------------------ Edges */

export function addAuthorityEdge(edge: Omit<AuthorityEdge, "createdAt">, actor = "CREATOR"): AuthorityEdge {
  if (!edge.id || edge.from === edge.to) deny("EDGE_SHAPE", "invalid authority edge (self delegation is forbidden)", actor, edge.id);
  if (!edge.capabilities.length) deny("EDGE_CAPABILITY", "authority capabilities required", actor, edge.id);
  if (edge.expiresAt !== null && new Date(edge.expiresAt) <= new Date()) deny("EDGE_EXPIRED", "authority edge expired", actor, edge.id);
  if (edge.from !== "CREATOR" && actor !== "CREATOR") deny("EDGE_ISSUER", `only the Creator or the delegating principal may create edges for ${edge.from}`, actor, edge.id);

  const payload = store.read();
  if (payload.edges.some(e => e.id === edge.id)) throw new Error("authority edge already exists");
  if (edge.from !== "CREATOR") {
    const parents = payload.edges.filter(e => e.to === edge.from && !e.revoked && (e.expiresAt === null || new Date(e.expiresAt) > new Date()));
    const covered = parents.some(p => edge.capabilities.every(c => p.capabilities.some(g => matches(g, c))));
    if (!covered) deny("EDGE_DELEGATION", `issuer ${edge.from} lacks authority to delegate requested capabilities`, actor, edge.id);
    const bestRisk = parents.reduce((rank, p) => Math.max(rank, riskRank[p.maxRisk]), -1);
    if (bestRisk < riskRank[edge.maxRisk]) deny("EDGE_RISK", `issuer ${edge.from} may not delegate risk level ${edge.maxRisk}`, actor, edge.id);
  }
  const created: AuthorityEdge = {...edge, createdAt: new Date().toISOString()};
  store.update(p => {
    p.edges.push(created);
  });
  observe({
    type: "authority.edge.created",
    message: `Delegation ${created.from} → ${created.to}`,
    status: "COMPLETED",
    actor,
    action: "authority.delegate",
    resource: created.id,
    argumentsValue: {capabilities: created.capabilities, maxRisk: created.maxRisk, expiresAt: created.expiresAt}
  });
  return structuredClone(created);
}

export function revokeAuthorityEdge(edgeId: string, actor = "CREATOR"): AuthorityEdge {
  const payload = store.read();
  const edge = payload.edges.find(e => e.id === edgeId);
  if (!edge) throw new Error("authority edge not found");
  if (actor !== "CREATOR" && actor !== edge.from) deny("EDGE_REVOKE", "only the delegating principal or the Creator may revoke", actor, edgeId);
  edge.revoked = true;
  store.update(p => {
    const index = p.edges.findIndex(e => e.id === edgeId);
    if (index >= 0) p.edges[index] = edge;
  });
  observe({
    type: "authority.edge.revoked",
    message: `Delegation ${edgeId} widerrufen`,
    status: "BLOCKED",
    actor,
    action: "authority.revoke-edge",
    resource: edgeId,
    decision: "DENY"
  });
  return structuredClone(edge);
}

export function authorityGraph(): AuthorityEdge[] {
  return structuredClone(store.read().edges);
}

/* ----------------------------------------------------------------- Tokens */

export function issueCapabilityToken(
  input: Omit<CapabilityToken, "id" | "secretHash" | "createdAt" | "revoked" | "uses" | "maxUses"> & {
    issuedByKind?: "CREATOR" | "AGENT" | "SYSTEM";
    maxUses?: number;
  },
  actor = input.issuedBy
): IssuedCapability {
  const payload = store.read();
  const issuedByKind = input.issuedByKind ?? (input.issuedBy === "CREATOR" ? "CREATOR" : "AGENT");

  if (input.issuedBy === input.subject) deny("SELF_GRANT", "an agent may not issue a capability token to itself", actor);
  if (!input.capabilities.length) deny("EMPTY_CAPABILITIES", "capability set must not be empty", actor);
  if (input.capabilities.includes("*")) deny("WILDCARD_CAPABILITY", "wildcard capabilities may not be issued to agents", actor);
  if (new Date(input.expiresAt) <= new Date()) deny("TOKEN_EXPIRED", "capability token would be expired at issuance", actor);

  // Standard ist die einmalige Verwendung; Mehrfachverwendung ist explizit und begrenzt.
  const requestedUses = input.maxUses ?? 1;
  if (!Number.isInteger(requestedUses) || requestedUses < 1 || requestedUses > MAX_TOKEN_USES) {
    deny("TOKEN_USES_LIMIT", `maxUses must be an integer between 1 and ${MAX_TOKEN_USES}`, actor);
  }

  const ttlMs = new Date(input.expiresAt).getTime() - Date.now();
  const maxTtl = issuedByKind === "CREATOR" ? MAX_TOKEN_TTL_MS : MAX_AGENT_TOKEN_TTL_MS;
  if (ttlMs > maxTtl) deny("TOKEN_TTL", `token lifetime exceeds the allowed maximum of ${maxTtl}ms`, actor);

  if (issuedByKind !== "CREATOR") {
    const issuerEdges = payload.edges.filter(e => e.to === input.issuedBy && !e.revoked && (e.expiresAt === null || new Date(e.expiresAt) > new Date()));
    const allowed = issuerEdges.some(e => input.capabilities.every(c => e.capabilities.some(g => matches(g, c))));
    if (!allowed) deny("TOKEN_DELEGATION", `issuer ${input.issuedBy} lacks authority to delegate the requested capabilities`, actor);
    const bestRisk = issuedByEdgesMaxRisk(issuerEdges);
    if (bestRisk < riskRank[input.risk]) deny("TOKEN_RISK_ESCALATION", `issuer ${input.issuedBy} may not issue risk level ${input.risk}`, actor);
  }

  const secret = crypto.randomBytes(32).toString("base64url");
  const token: CapabilityToken = {
    ...input,
    maxUses: requestedUses,
    uses: 0,
    id: `CAP-${crypto.randomUUID()}`,
    issuedByKind,
    revoked: false,
    secretHash: hashSecret(secret),
    createdAt: new Date().toISOString()
  };
  store.update(p => {
    p.tokens.push(token);
    if (p.tokens.length > 1000) p.tokens.splice(0, p.tokens.length - 1000);
  });
  observe({
    type: "authority.token.issued",
    message: `Capability-Token für ${token.subject} ausgestellt`,
    status: "COMPLETED",
    actor,
    agentId: token.subject,
    taskId: token.taskId,
    sandboxId: token.sandboxId,
    action: "authority.issue",
    resource: token.id,
    authorizationRef: token.id,
    argumentsValue: {capabilities: token.capabilities, risk: token.risk, expiresAt: token.expiresAt, environment: token.environment}
  });
  return {token: structuredClone(token), secret};
}

function issuedByEdgesMaxRisk(edges: AuthorityEdge[]): number {
  return edges.reduce((rank, edge) => Math.max(rank, riskRank[edge.maxRisk]), -1);
}

export function revokeCapabilityToken(id: string, actor = "CREATOR"): boolean {
  const payload = store.read();
  const token = payload.tokens.find(t => t.id === id);
  if (!token) return false;
  if (actor !== "CREATOR" && actor !== "AG-GUARD" && actor !== token.issuedBy) {
    deny("TOKEN_REVOKE", "only the Creator, the Guardian or the issuer may revoke a token", actor, id);
  }
  token.revoked = true;
  token.revokedAt = new Date().toISOString();
  store.update(p => {
    const index = p.tokens.findIndex(t => t.id === id);
    if (index >= 0) p.tokens[index] = token;
    p.revokedTokens = [...new Set([...p.revokedTokens, id])];
  });
  observe({
    type: "authority.token.revoked",
    message: `Capability-Token ${id} widerrufen`,
    status: "BLOCKED",
    actor,
    agentId: token.subject,
    taskId: token.taskId,
    sandboxId: token.sandboxId,
    action: "authority.revoke",
    resource: id,
    decision: "DENY"
  });
  return true;
}

export function capabilityTokens(): CapabilityToken[] {
  return structuredClone(store.read().tokens);
}

export function getCapabilityToken(id: string): CapabilityToken | null {
  return structuredClone(store.read().tokens.find(t => t.id === id) ?? null);
}

export type CapabilityValidationContext = {
  subject?: string;
  taskId?: string;
  sandboxId?: string;
  risk?: Risk;
  environment?: string;
};

export function validateCapabilityToken(
  id: string,
  required: string[],
  context?: CapabilityValidationContext
): {valid: boolean; reason: string} {
  return evaluateCapabilityToken(id, required, context, true);
}

/**
 * Vorprüfung für das API-Gate: prüft Existenz, Widerruf, Ablauf, Fähigkeiten und
 * Bindungen — **nicht** den Verbrauch. Der Verbrauch wird ausschließlich im
 * Execution Broker durchgesetzt, damit genau eine Stelle über die Ausführung
 * entscheidet und dort auch die Verweigerungsevidenz entsteht. Nicht-Ausführungen
 * (z. B. Statusmeldungen des Agenten) verbrauchen das Token nicht.
 */
export function precheckCapabilityToken(
  id: string,
  required: string[],
  context?: CapabilityValidationContext
): {valid: boolean; reason: string} {
  return evaluateCapabilityToken(id, required, context, false);
}

function evaluateCapabilityToken(
  id: string,
  required: string[],
  context: CapabilityValidationContext | undefined,
  checkUsage: boolean
): {valid: boolean; reason: string} {
  const payload = store.read();
  const token = payload.tokens.find(t => t.id === id);
  if (!token) return {valid: false, reason: "token not found"};
  if (payload.revokedTokens.includes(id) || token.revoked) return {valid: false, reason: "token revoked"};
  if (new Date(token.expiresAt).getTime() < Date.now()) return {valid: false, reason: "token expired"};
  if (!required.every(c => token.capabilities.some(g => matches(g, c)))) return {valid: false, reason: "capability not delegated"};
  if (context?.subject && token.subject !== context.subject) return {valid: false, reason: "token subject mismatch"};
  if (context?.taskId && token.taskId !== context.taskId) return {valid: false, reason: "token task scope mismatch"};
  if (context?.sandboxId && token.sandboxId !== context.sandboxId) return {valid: false, reason: "token sandbox scope mismatch"};
  if (context?.environment && token.environment !== context.environment) return {valid: false, reason: "token environment mismatch"};
  if (context?.risk && riskRank[token.risk] < riskRank[context.risk]) return {valid: false, reason: "token risk scope is insufficient"};
  if (checkUsage && (token.uses ?? 0) >= (token.maxUses ?? 1)) {
    return {valid: false, reason: `token exhausted (${token.uses ?? 0}/${token.maxUses ?? 1} uses); replay is refused`};
  }
  return {valid: true, reason: "capability delegated"};
}

/**
 * Verbraucht eine Verwendung des Tokens — atomar und **vor** der Ausführung.
 * Dadurch kann eine Autorisierung nicht mehrfach genutzt werden (Replay-Schutz
 * innerhalb der Lebensdauer), und ein Absturz nach dem Verbrauch führt zu einer
 * Verweigerung statt zu einer zweiten Ausführung (fail closed).
 */
export function consumeCapabilityToken(id: string, actor = "SYSTEM"): {uses: number; maxUses: number} {
  let consumed: {uses: number; maxUses: number} | null = null;
  store.update(payload => {
    const token = payload.tokens.find(t => t.id === id);
    if (!token) throw new AuthorityDenied("TOKEN_EXISTS", "capability token not found");
    if (payload.revokedTokens.includes(id) || token.revoked) throw new AuthorityDenied("TOKEN_REVOKED", "capability token is revoked");
    const maxUses = token.maxUses ?? 1;
    const uses = token.uses ?? 0;
    if (uses >= maxUses) {
      throw new AuthorityDenied("TOKEN_REPLAY", `capability token already used (${uses}/${maxUses}); replay is refused`);
    }
    token.uses = uses + 1;
    consumed = {uses: token.uses, maxUses};
  });
  const result = consumed as {uses: number; maxUses: number} | null;
  if (!result) throw new AuthorityDenied("TOKEN_EXISTS", "capability token not found");
  observe({
    type: "authority.token.consumed",
    message: `Capability-Token verbraucht (${result.uses}/${result.maxUses})`,
    status: "COMPLETED",
    actor,
    action: "authority.consume",
    resource: id,
    authorizationRef: id,
    argumentsValue: {uses: result.uses, maxUses: result.maxUses}
  });
  recordAudit({actor, action: "authority.consume", resource: id, decision: "ALLOW"}, {uses: result.uses, maxUses: result.maxUses});
  return result;
}

/** Prüft das Token-Geheimnis (`<tokenId>.<secret>`) ohne Klartextspeicherung. */
export function verifyCapabilitySecret(tokenId: string, secret: string): boolean {
  const token = store.read().tokens.find(t => t.id === tokenId);
  if (!token) return false;
  const candidate = Buffer.from(hashSecret(secret));
  const expected = Buffer.from(token.secretHash);
  return candidate.length === expected.length && crypto.timingSafeEqual(candidate, expected);
}

/**
 * System-Ausstellung für Worker-Ausführung. Nutzt denselben Delegationspfad wie
 * Agents: ohne aktive Delegation `CREATOR → SYSTEM-WORKER` schlägt sie fehl
 * (fail closed, Bootstrap erforderlich). Es gibt keine Hintertür.
 */
export function ensureExecutionCapability(
  agentId: string,
  taskId: string,
  sandboxId: string,
  risk: Risk,
  environment = "development"
): CapabilityToken {
  const payload = store.read();
  const existing = payload.tokens.find(
    t =>
      !t.revoked &&
      t.subject === agentId &&
      t.taskId === taskId &&
      t.sandboxId === sandboxId &&
      t.environment === environment &&
      t.capabilities.includes("task:execute") &&
      t.capabilities.includes("sandbox:run") &&
      // Erschöpfte Token sind nicht wiederverwendbar: sonst würde der Broker den
      // nächsten Lauf als Replay verweigern, obwohl eine gültige Autorisierung
      // vorzuliegen scheint (genau eine Autorisierung = eine Ausführung).
      (t.uses ?? 0) < (t.maxUses ?? 1) &&
      riskRank[t.risk] >= riskRank[risk] &&
      new Date(t.expiresAt).getTime() > Date.now() + 60_000
  );
  if (existing) return structuredClone(existing);
  const {token} = issueCapabilityToken(
    {
      subject: agentId,
      taskId,
      sandboxId,
      environment,
      capabilities: ["task:execute", "sandbox:run"],
      risk,
      issuedBy: "SYSTEM-WORKER",
      issuedByKind: "SYSTEM",
      expiresAt: new Date(Date.now() + MAX_AGENT_TOKEN_TTL_MS).toISOString()
    },
    "SYSTEM-WORKER"
  );
  return token;
}

/* -------------------------------------------------------------- RBAC/ABAC */

export type Role = "OWNER" | "ADMIN" | "DEVELOPER" | "REVIEWER" | "OPERATOR" | "VIEWER";

export type SubjectContext = {
  actorId: string;
  role: Role;
  agentId?: string;
  taskId?: string;
  sandboxId?: string;
  environment: string;
  capabilities: string[];
};

export type PolicyContext = {action: string; resource: string; risk: Risk; requiresApproval: boolean; environment: string; now?: string};

const roleCapabilities: Record<Role, string[]> = {
  OWNER: ["*"],
  ADMIN: ["control-plane:access", "mission:*", "task:*", "agent:*", "approval:*", "deployment:*", "security:*", "authority:*"],
  DEVELOPER: ["control-plane:access", "mission:read", "task:read", "task:execute", "repo:branch", "sandbox:run", "artifact:write", "experiment:run"],
  REVIEWER: ["control-plane:access", "mission:read", "task:read", "approval:read", "approval:resolve", "audit:read"],
  OPERATOR: ["control-plane:access", "task:read", "task:execute", "sandbox:run", "deployment:execute"],
  VIEWER: ["control-plane:access", "mission:read", "task:read", "agent:read", "audit:read"]
};

export function roleAllows(role: Role, capability: string): boolean {
  return roleCapabilities[role].some(x => matches(x, capability));
}

export function abacAllows(subject: SubjectContext, policy: PolicyContext) {
  if (!roleAllows(subject.role, policy.action)) return {allowed: false, reason: "RBAC capability denied"};
  if (subject.environment !== policy.environment) return {allowed: false, reason: "Environment boundary mismatch"};
  if (policy.risk === "CRITICAL" && subject.role !== "OWNER") return {allowed: false, reason: "Critical action requires Creator authority"};
  if ((policy.requiresApproval || policy.risk === "HIGH") && subject.role !== "OWNER") return {allowed: false, reason: "Approval gate required"};
  if (!subject.capabilities.some(x => matches(x, policy.action))) return {allowed: false, reason: "Delegated capability missing"};
  return {allowed: true, reason: "RBAC + ABAC + delegated capability satisfied"};
}

export function authorityIntegrity() {
  const report = store.integrity();
  const payload = store.read();
  const now = Date.now();
  return {
    storeOk: report.ok,
    edges: payload.edges.length,
    activeEdges: payload.edges.filter(e => !e.revoked && (e.expiresAt === null || new Date(e.expiresAt).getTime() > now)).length,
    tokens: payload.tokens.length,
    activeTokens: payload.tokens.filter(t => !t.revoked && new Date(t.expiresAt).getTime() > now).length,
    rootAuthorityId: payload.rootAuthorityId
  };
}

export function authorityStoreIntegrity() {
  return store.integrity();
}

export {matches as capabilityMatches};
