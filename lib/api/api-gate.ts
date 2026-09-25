import {ApiDenied, guardRequest, parseCapabilityHeader} from "./guard";
import {precheckCapabilityToken, verifyCapabilitySecret} from "../authority";
import {SESSION_COOKIE, resolveSession} from "../session";
import {recordAudit} from "../audit";

/**
 * API-Gate für die gesamte Control-Plane-Oberfläche (Abschnitt 37.13 / 38).
 *
 * Standard: jede `/api/*`-Route außer der Authentifizierungsstrecke selbst
 * verlangt eine gültige Server-Session (HttpOnly-Cookie). Damit ist die
 * Oberfläche standardmäßig geschlossen: neue Routen sind automatisch
 * geschützt, auch wenn eine Route ihren eigenen `guardRequest`-Aufruf (noch)
 * nicht hat.
 *
 * Ausnahme (explizite Allowlist): `POST /api/runtime` ist der Agentenweg für
 * autorisierte Ausführung. Dort ist entweder eine Browser-Session oder ein
 * gültiges Capability-Token (`Authorization: Bobcap <tokenId>.<secret>`)
 * zulässig. Das Gate prüft dabei nur Authentizität und Gültigkeit; die
 * vollständige Autorisierung (Subjekt, Task, Sandbox, Risiko, Umgebung,
 * Kill Switch, Approval) macht der Execution Broker in der Route selbst.
 */

export type ApiGateDecision = {allow: true} | {allow: false; status: number; code: string; message: string};

export const API_GATE_ACTION = "control-plane:access";
export const AUTH_PATH = "/api/auth";
export const AGENT_EXECUTION_PATH = "/api/runtime";

export function isAuthPath(pathname: string): boolean {
  return pathname === AUTH_PATH || pathname.startsWith(`${AUTH_PATH}/`);
}

/** Agentenweg: ausschließlich Ausführung über den Broker (keine Verwaltung). */
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

/**
 * Authentifizierung des Agentenwegs: Session des Creators ODER gültiges
 * Capability-Token. Bindungen (Task/Sandbox/Risiko) prüft der Broker.
 */
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
  // Bewusst ohne Umgebungs-/Ressourcenbindung: Die Bindung an Task, Sandbox,
  // Risiko und Umgebung kennt das Gate nicht und darf sie nicht raten. Sie
  // wird in der Route (`guardRequest`) und im Broker vollständig geprüft.
  // Ebenso bewusst als Vorprüfung: Der Verbrauch des Tokens (eine Autorisierung
  // = eine Ausführung) wird ausschließlich im Execution Broker durchgesetzt,
  // damit genau eine Stelle entscheidet und dort die Evidenz entsteht.
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
  if (isAgentExecutionPath(method, pathname)) return agentExecutionDecision(request);

  try {
    guardRequest(request, {action: API_GATE_ACTION, requireSession: true});
    return {allow: true};
  } catch (error) {
    if (error instanceof ApiDenied) return deny(error.status, error.code, error.message);
    // Unerwartete Fehler dürfen die Grenze nicht öffnen.
    return deny(500, "GATE_ERROR", error instanceof Error ? error.message : "api gate failed");
  }
}

/**
 * Bequeme Variante für Routen: gibt bei Verweigerung eine fertige JSON-Antwort
 * zurück (statt zu werfen), damit jede Route die korrekte Fehlersemantik
 * (401/403/423) liefert und die Grenze trotzdem geschlossen bleibt.
 */
export function guardOrDeny(request: Request, spec: Parameters<typeof guardRequest>[1]): Response | null {
  try {
    guardRequest(request, spec);
    return null;
  } catch (error) {
    if (error instanceof ApiDenied) {
      return new Response(JSON.stringify({error: error.code, message: error.message}), {
        status: error.status,
        headers: {"content-type": "application/json", "cache-control": "no-store"}
      });
    }
    return new Response(JSON.stringify({error: "GATE_ERROR", message: error instanceof Error ? error.message : "gate failed"}), {
      status: 500,
      headers: {"content-type": "application/json"}
    });
  }
}
