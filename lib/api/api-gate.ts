import {ApiDenied, guardRequest, parseCapabilityHeader} from "./guard";
import {requireInitialized, BootstrapError} from "../bootstrap";
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
export const DEVICE_ENROLLMENT_PATH = "/api/devices";
/**
 * Kennzeichnung des Enrollment-Wegs.
 *
 * Ein Discovery-Agent hat keine Browser-Session — er besitzt nur das
 * Enrollment-Geheimnis. Damit er die API-Grenze überhaupt erreicht, trägt er das
 * Geheimnis zusätzlich in diesem Header. Die Grenze prüft **nur die Anwesenheit**
 * (der Body wird in der Middleware bewusst nicht gelesen); den Wert prüft die
 * Route selbst, fail closed und in konstanter Zeit. Ohne gültiges Geheimnis
 * bleibt die Antwort 403, und alle anderen Geräte-Aktionen verlangen weiterhin
 * eine Creator-Session.
 */
export const ENROLLMENT_HEADER = "x-bob-enrollment";

export function isAuthPath(pathname: string): boolean {
  return pathname === AUTH_PATH || pathname.startsWith(`${AUTH_PATH}/`);
}

export function isAgentExecutionPath(method: string, pathname: string): boolean {
  return method.toUpperCase() === "POST" && pathname === AGENT_EXECUTION_PATH;
}

/** Enrollment-/Attestierungsweg eines Discovery-Agenten (ohne Session). */
export function isDeviceEnrollmentRequest(method: string, pathname: string, headerValue: string | null): boolean {
  return (
    method.toUpperCase() === "POST" &&
    pathname === DEVICE_ENROLLMENT_PATH &&
    typeof headerValue === "string" &&
    headerValue.trim().length >= 16
  );
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
  /**
   * Discovery-/Attestierungsweg: Die Grenze lässt den Aufruf durch, weil der
   * Agent keine Session haben kann. **Nicht** durchgelassen wird damit eine
   * Autorisierung — die Route prüft das Geheimnis und lehnt alles ab, was nicht
   * `enroll`, `heartbeat` oder `attest` ist (diese Aktionen verlangen eine
   * Creator-Session).
   */
  if (isDeviceEnrollmentRequest(method, pathname, request.headers.get(ENROLLMENT_HEADER))) {
    // Fail closed bleibt erhalten: Ein nicht initialisiertes System nimmt keine
    // Gerätemeldung an. Ohne diese Prüfung hätte der Agentenweg den
    // Bootstrap-Zwang umgangen (die Route prüft die Initialisierung nicht selbst).
    try {
      requireInitialized();
    } catch (error) {
      if (error instanceof BootstrapError) return deny(428, error.code, error.message);
      return deny(500, "GATE_ERROR", error instanceof Error ? error.message : "bootstrap check failed");
    }
    return {allow: true};
  }

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
