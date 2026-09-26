import {ApiDenied, guardRequest, parseCapabilityHeader} from "./guard";
import {precheckCapabilityToken, verifyCapabilitySecret} from "../authority";
import {SESSION_COOKIE, resolveSession} from "../session";
import {recordAudit} from "../audit";
import {consumeRateLimit} from "./rate-limit";
import {isShuttingDown} from "../shutdown";

/**
 * API-Gate für die gesamte Control-Plane-Oberfläche.
 * Neue Routen bleiben standardmäßig geschlossen und werden zusätzlich
 * durch das serverseitige Rate-Limit sowie den Shutdown-Drain geschützt.
 */
export type ApiGateDecision = {allow: true} | {allow: false; status: number; code: string; message: string};

export const API_GATE_ACTION = "control-plane:access";
export const AUTH_PATH = "/api/auth";
export const AGENT_EXECUTION_PATH = "/api/runtime";

export function isAuthPath(pathname: string): boolean {
  return pathname === AUTH_PATH || pathname.startsWith(`${AUTH_PATH}/`);
}

export function isAgentExecutionPath(method: string, pathname: string): boolean {
  return method.toUpperCase() === "POST" && pathname === AGENT_EXECUTION_PATH;
}

function cookieValue(request: Request, name: string): string | undefined {
  const header = request.headers.get("cookie");
  if (!header) return undefined;
  for (const part of header.split(";")) {
    const [key, ...rest] = part.trim().split("=");
    if (key === name) return decodeURIComponent(rest.join("="));
  }
  return undefined;
}

function deny(status: number, code: string, message: string): ApiGateDecision {
  return {allow: false, status, code, message};
}

function rateDecision(request: Request): ApiGateDecision {
  const result = consumeRateLimit(request, "api");
  if (result.allowed) return {allow: true};
  recordAudit({actor: "ANONYMOUS", action: "rate-limit", decision: "DENY"}, {bucket:"api", retryAfterSeconds:result.retryAfterSeconds});
  return deny(429, "RATE_LIMITED", "request rate limit exceeded");
}

function agentExecutionDecision(request: Request): ApiGateDecision {
  const sessionToken = cookieValue(request, SESSION_COOKIE);
  const session = sessionToken ? resolveSession(sessionToken) : null;
  if (session) return {allow: true};

  const capability = parseCapabilityHeader(request.headers.get("authorization"));
  if (!capability) {
    recordAudit({actor: "ANONYMOUS", action: API_GATE_ACTION, decision: "DENY"}, {code: "NO_CREDENTIALS", path: AGENT_EXECUTION_PATH});
    return deny(401, "SESSION_REQUIRED", "a browser session or a capability token is required");
  }
  if (!verifyCapabilitySecret(capability.tokenId, capability.secret)) {
    recordAudit({actor: "UNKNOWN-AGENT", action: API_GATE_ACTION, decision: "DENY"}, {code: "TOKEN_SECRET", tokenId: capability.tokenId});
    return deny(403, "TOKEN_SECRET", "capability token secret is invalid");
  }
  const validation = precheckCapabilityToken(capability.tokenId, ["sandbox:run"], {});
  if (!validation.valid) {
    recordAudit({actor: "UNKNOWN-AGENT", action: API_GATE_ACTION, decision: "DENY"}, {code: "CAPABILITY_DENIED", tokenId: capability.tokenId, reason: validation.reason});
    return deny(403, "CAPABILITY_DENIED", validation.reason);
  }
  return {allow: true};
}

export function apiGateDecision(request: Request): ApiGateDecision {
  let pathname: string;
  let method: string;
  try {
    pathname = new URL(request.url).pathname;
    method = request.method.toUpperCase();
  } catch {
    return deny(400, "BAD_REQUEST_URL", "request URL is not parseable");
  }
  if (isAuthPath(pathname)) return {allow: true};
  if (isShuttingDown()) return deny(503, "SHUTTING_DOWN", "server is draining and accepts no new control-plane work");
  const limited = rateDecision(request);
  if (!limited.allow) return limited;
  if (isAgentExecutionPath(method, pathname)) return agentExecutionDecision(request);

  try {
    guardRequest(request, {action: API_GATE_ACTION, requireSession: true});
    return {allow: true};
  } catch (error) {
    if (error instanceof ApiDenied) return deny(error.status, error.code, error.message);
    return deny(500, "GATE_ERROR", error instanceof Error ? error.message : "api gate failed");
  }
}

export function guardOrDeny(request: Request, spec: Parameters<typeof guardRequest>[1]): Response | null {
  if (isShuttingDown()) {
    return new Response(JSON.stringify({error:"SHUTTING_DOWN", message:"server is draining and accepts no new control-plane work"}), {
      status:503, headers:{"content-type":"application/json","cache-control":"no-store","retry-after":"5"}
    });
  }
  const limited = consumeRateLimit(request, "api");
  if (!limited.allowed) {
    recordAudit({actor:"ANONYMOUS", action:"rate-limit", decision:"DENY"}, {bucket:"api", retryAfterSeconds:limited.retryAfterSeconds});
    return new Response(JSON.stringify({error:"RATE_LIMITED", message:"request rate limit exceeded"}), {
      status:429, headers:{"content-type":"application/json","cache-control":"no-store","retry-after":String(limited.retryAfterSeconds)}
    });
  }
  try {
    guardRequest(request, spec);
    return null;
  } catch (error) {
    if (error instanceof ApiDenied) {
      return new Response(JSON.stringify({error: error.code, message: error.message}), {
        status: error.status, headers:{"content-type":"application/json","cache-control":"no-store"}
      });
    }
    return new Response(JSON.stringify({error:"GATE_ERROR", message:error instanceof Error ? error.message : "gate failed"}), {
      status:500, headers:{"content-type":"application/json"}
    });
  }
}
