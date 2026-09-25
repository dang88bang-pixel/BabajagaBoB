import crypto from "node:crypto";
import {SESSION_COOKIE, resolveSession} from "../session";
import {requireInitialized, bootstrapStatus, BootstrapError} from "../bootstrap";
import {abacAllows, getCapabilityToken, roleAllows, validateCapabilityToken, verifyCapabilitySecret, type Role} from "../authority";
import {isKilled} from "../governance";
import {recordAudit} from "../audit";
import {observe} from "../observability";
import type {Risk} from "../types";

/**
 * API-Autorisierung (Abschnitt 37.15 / 38).
 *
 * Es gibt drei legitime Wege in die Control Plane:
 *  1. Browser-Session (HttpOnly-Cookie) → Actor CREATOR mit Rolle OWNER.
 *  2. Capability-Token eines Agents: `Authorization: Bobcap <tokenId>.<secret>`
 *     – gebunden an Subject, Task, Sandbox, Environment und Risk.
 *  3. Legacy-Control-Plane-Token aus der Serverumgebung (`BOB_CONTROL_PLANE_TOKEN`)
 *     – ausschließlich für lokale Administration/CI, niemals an den Browser.
 *
 * Fail-closed: ohne Bootstrap wird jede sicherheitsrelevante Aktion abgelehnt.
 * Agents dürfen niemals Authority-, Governance- oder Audit-Aktionen ausführen.
 */

export type ActorContext = {
  actorId: string;
  kind: "CREATOR" | "AGENT" | "ADMIN_TOKEN";
  role: Role;
  capabilities: string[];
  agentId?: string;
  taskId?: string;
  sandboxId?: string;
  environment: string;
  sessionId?: string;
  tokenId?: string;
};

export class ApiDenied extends Error {
  readonly status: number;
  readonly code: string;
  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = "ApiDenied";
    this.code = code;
    this.status = status;
  }
}

export type GuardSpec = {
  action: string;
  risk?: Risk;
  environment?: string;
  /** Öffentliche Aktionen (z. B. Bootstrap-Status) sind ohne Session erlaubt. */
  publicAction?: boolean;
  /**
   * Nur Browser-Sessions (HttpOnly-Cookie) sind zulässig. Agent-Token und
   * Legacy-Token werden nicht akzeptiert – verwendet für die API-Oberfläche.
   */
  requireSession?: boolean;
  /** Nur Creator/Admin-Token dürfen diese Aktion ausführen. */
  creatorOnly?: boolean;
  /** Zusätzlich erforderliche Agent-Capability (Bindung an Task/Sandbox). */
  requireAgentCapability?: string;
  taskId?: string;
  sandboxId?: string;
  requiresApproval?: boolean;
};

const AGENT_FORBIDDEN_PREFIXES = ["authority:", "governance:", "audit:delete", "session:create"];

export function parseCapabilityHeader(header: string | null): {tokenId: string; secret: string} | null {
  if (!header) return null;
  const match = /^Bobcap ([A-Za-z0-9-]+)\.([A-Za-z0-9_-]+)$/.exec(header.trim());
  return match ? {tokenId: match[1], secret: match[2]} : null;
}

function cookieValue(request: Request, name: string): string | undefined {
  const cookie = request.headers.get("cookie");
  if (!cookie) return undefined;
  for (const part of cookie.split(";")) {
    const [key, ...rest] = part.trim().split("=");
    if (key === name) return decodeURIComponent(rest.join("="));
  }
  return undefined;
}

/** CSRF-Schutz für cookie-authentifizierte Mutationen. */
function assertSameOrigin(request: Request, method: string) {
  if (method === "GET" || method === "HEAD") return;
  const origin = request.headers.get("origin");
  if (!origin) return; // Nicht-Browser-Clients (curl, Tests) senden kein Origin.
  const host = request.headers.get("host");
  try {
    const originHost = new URL(origin).host;
    if (host && originHost !== host) {
      throw new ApiDenied(403, "CSRF_ORIGIN", `cross-origin ${method} rejected (${originHost} != ${host})`);
    }
  } catch (error) {
    if (error instanceof ApiDenied) throw error;
    throw new ApiDenied(403, "CSRF_ORIGIN", "invalid origin header");
  }
}

function legacyTokenAllowed(): string | null {
  const token = process.env.BOB_CONTROL_PLANE_TOKEN;
  if (!token) return null;
  // Fail closed: der Legacy-Administrationstoken ist nur bei ausdrücklicher
  // Freigabe (BOB_ALLOW_LEGACY_CONTROL_TOKEN=1) aktiv, niemals by default.
  if (process.env.BOB_ALLOW_LEGACY_CONTROL_TOKEN !== "1") return null;
  return token;
}

function verifyLegacyToken(request: Request): boolean {
  const expected = legacyTokenAllowed();
  if (!expected) return false;
  const header = request.headers.get("authorization") ?? "";
  if (!header.startsWith("Bearer ")) return false;
  const supplied = header.slice(7);
  const a = Buffer.from(supplied);
  const b = Buffer.from(expected);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

export type GuardedRequest = {actor: ActorContext};

/**
 * Bildet eine abgelehnte Anfrage auf eine HTTP-Antwort ab.
 *
 * Route-Handler, die `guardRequest` direkt aufrufen, würden ohne diese Abbildung
 * eine Ausnahme auslösen. Das Gate in `middleware.ts` fängt den Regelfall ab,
 * aber wenn es durchlässt und erst der Routen-Guard verweigert (z. B. abgelaufene
 * Session zwischen Gate und Handler), darf daraus niemals ein 500 werden:
 * Verweigerungen sind 401/403/409 und fail closed.
 */
export function toDeniedResponse(error: unknown): Response | null {
  const shape =
    error instanceof ApiDenied
      ? {status: error.status, code: error.code, message: error.message}
      : error instanceof Error && "status" in error
        ? (error as {status: number; code?: string; message: string})
        : null;
  if (!shape) return null;
  return new Response(JSON.stringify({error: shape.code ?? "DENIED", message: shape.message}), {
    status: shape.status,
    headers: {"content-type": "application/json", "Cache-Control": "no-store"}
  });
}

export function guardRequest(request: Request, spec: GuardSpec): GuardedRequest {
  const method = request.method.toUpperCase();
  const status = bootstrapStatus();

  if (spec.publicAction) {
    return {
      actor: {actorId: "ANONYMOUS", kind: "CREATOR", role: "VIEWER", capabilities: ["public:read"], environment: spec.environment ?? "control-plane"}
    };
  }

  // Fail closed, solange der Creator-Bootstrap nicht abgeschlossen ist.
  try {
    requireInitialized();
  } catch (error) {
    if (error instanceof BootstrapError) {
      recordAudit({actor: "ANONYMOUS", action: spec.action, decision: "DENY"}, {code: error.code});
      throw new ApiDenied(428, error.code, error.message);
    }
    throw error;
  }
  if (status.revokedAt) throw new ApiDenied(423, "ROOT_REVOKED", "root authority is revoked; system is fail-closed");

  assertSameOrigin(request, method);

  // 1. Browser-Session
  const sessionToken = cookieValue(request, SESSION_COOKIE);
  const session = sessionToken ? resolveSession(sessionToken) : null;
  if (session) {
    const actor: ActorContext = {
      actorId: session.actorId,
      kind: "CREATOR",
      role: session.role,
      capabilities: ["*"],
      environment: spec.environment ?? "control-plane",
      sessionId: session.sessionId
    };
    authorize(actor, spec);
    return {actor};
  }

  if (spec.requireSession) {
    recordAudit({actor: "ANONYMOUS", action: spec.action, decision: "DENY"}, {code: "SESSION_REQUIRED"});
    throw new ApiDenied(401, "SESSION_REQUIRED", "a valid browser session is required for this API");
  }

  // 2. Agent-Capability-Token
  const capability = parseCapabilityHeader(request.headers.get("authorization"));
  if (capability) {
    if (!verifyCapabilitySecret(capability.tokenId, capability.secret)) {
      recordAudit({actor: "UNKNOWN-AGENT", action: spec.action, decision: "DENY"}, {reason: "invalid capability secret", tokenId: capability.tokenId});
      throw new ApiDenied(403, "TOKEN_SECRET", "capability token secret is invalid");
    }
    const required = spec.requireAgentCapability ? [spec.requireAgentCapability, spec.action] : [spec.action];
    const environment = spec.environment ?? "development";
    const validation = validateCapabilityToken(capability.tokenId, required, {
      taskId: spec.taskId,
      sandboxId: spec.sandboxId,
      risk: spec.risk,
      environment
    });
    if (!validation.valid) {
      observe({
        type: "api.authorization.denied",
        message: `API-Zugriff mit Capability-Token verweigert: ${validation.reason}`,
        status: "BLOCKED",
        actor: "AGENT",
        action: spec.action,
        resource: spec.taskId ?? spec.sandboxId,
        decision: "DENY",
        authorizationRef: capability.tokenId,
        argumentsValue: {reason: validation.reason}
      });
      throw new ApiDenied(403, "CAPABILITY_DENIED", validation.reason);
    }
    if (AGENT_FORBIDDEN_PREFIXES.some(prefix => spec.action.startsWith(prefix))) {
      throw new ApiDenied(403, "AGENT_FORBIDDEN", `agents may not perform ${spec.action}`);
    }
    const token = getCapabilityToken(capability.tokenId);
    const actor: ActorContext = {
      actorId: token?.subject ?? "AGENT",
      kind: "AGENT",
      role: "DEVELOPER",
      capabilities: token?.capabilities ?? [],
      agentId: token?.subject,
      taskId: spec.taskId ?? token?.taskId,
      sandboxId: spec.sandboxId ?? token?.sandboxId,
      environment,
      tokenId: capability.tokenId
    };
    authorize(actor, spec);
    return {actor};
  }

  // 3. Legacy-Administrationstoken (Serverumgebung, nicht Browser)
  if (verifyLegacyToken(request)) {
    const actor: ActorContext = {
      actorId: "OPERATOR-TOKEN",
      kind: "ADMIN_TOKEN",
      role: "ADMIN",
      capabilities: ["*"],
      environment: spec.environment ?? "control-plane"
    };
    authorize(actor, spec);
    return {actor};
  }

  recordAudit({actor: "ANONYMOUS", action: spec.action, decision: "DENY"}, {reason: "unauthenticated"});
  throw new ApiDenied(401, "UNAUTHENTICATED", "authentication required (browser session or capability token)");
}

function authorize(actor: ActorContext, spec: GuardSpec) {
  if (spec.creatorOnly && actor.kind === "AGENT") {
    throw new ApiDenied(403, "CREATOR_ONLY", `${spec.action} requires Creator authority`);
  }
  if (actor.kind === "AGENT" && AGENT_FORBIDDEN_PREFIXES.some(prefix => spec.action.startsWith(prefix))) {
    throw new ApiDenied(403, "AGENT_FORBIDDEN", `agents may not perform ${spec.action}`);
  }
  if (isKilled("SYSTEM", "SYSTEM") && !spec.action.startsWith("governance:kill-switch:release")) {
    throw new ApiDenied(423, "SYSTEM_KILL_SWITCH", "system kill switch is active");
  }
  if (actor.agentId && isKilled("AGENT", actor.agentId)) throw new ApiDenied(423, "AGENT_KILL_SWITCH", "agent kill switch is active");
  if (spec.taskId && isKilled("TASK", spec.taskId)) throw new ApiDenied(423, "TASK_KILL_SWITCH", "task kill switch is active");
  if (spec.sandboxId && isKilled("SANDBOX", spec.sandboxId)) throw new ApiDenied(423, "SANDBOX_KILL_SWITCH", "sandbox kill switch is active");

  if (actor.kind !== "AGENT") {
    const decision = abacAllows(
      {actorId: actor.actorId, role: actor.role, environment: actor.environment, capabilities: actor.capabilities},
      {action: spec.action, resource: spec.taskId ?? spec.sandboxId ?? "control-plane", risk: spec.risk ?? "LOW", requiresApproval: Boolean(spec.requiresApproval), environment: actor.environment}
    );
    if (!decision.allowed && actor.role !== "OWNER") throw new ApiDenied(403, "RBAC_DENIED", decision.reason);
    if (!roleAllows(actor.role, spec.action) && actor.role !== "OWNER") throw new ApiDenied(403, "RBAC_DENIED", `role ${actor.role} may not ${spec.action}`);
  }
}

/** Statushilfe für UI und Diagnose. */
export function authorizationSummary() {
  return {
    bootstrapRequired: !bootstrapStatus().initialized,
    failClosed: bootstrapStatus().failClosed,
    sessionCookie: SESSION_COOKIE,
    agentHeaderFormat: "Authorization: Bobcap <tokenId>.<secret>",
    legacyTokenEnabled: Boolean(legacyTokenAllowed()),
    browserReceivesControlToken: false
  };
}
