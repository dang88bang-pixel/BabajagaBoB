import {ApiDenied, guardRequest} from "./guard";

/**
 * API-Gate für die gesamte Control-Plane-Oberfläche (Abschnitt 37.13 / 38).
 *
 * Jede `/api/*`-Route außer der Authentifizierungsstrecke selbst verlangt eine
 * gültige Server-Session (HttpOnly-Cookie). Damit ist die Oberfläche
 * standardmäßig geschlossen: Neue Routen sind automatisch geschützt, auch wenn
 * eine Route ihren eigenen `guardRequest`-Aufruf (noch) nicht hat.
 *
 * Agent-Token und Legacy-Administrationstoken sind hier absichtlich nicht
 * zulässig – sie sind kein Browser-Ersatz und werden an der API-Grenze nicht
 * akzeptiert.
 */

export type ApiGateDecision = {allow: true} | {allow: false; status: number; code: string; message: string};

export const API_GATE_ACTION = "control-plane:access";
export const AUTH_PATH = "/api/auth";

export function isAuthPath(pathname: string): boolean {
  return pathname === AUTH_PATH || pathname.startsWith(`${AUTH_PATH}/`);
}

export function apiGateDecision(request: Request): ApiGateDecision {
  let pathname: string;
  try {
    pathname = new URL(request.url).pathname;
  } catch {
    return {allow: false, status: 400, code: "BAD_REQUEST_URL", message: "request URL is not parseable"};
  }
  if (isAuthPath(pathname)) return {allow: true};
  try {
    guardRequest(request, {action: API_GATE_ACTION, requireSession: true});
    return {allow: true};
  } catch (error) {
    if (error instanceof ApiDenied) {
      return {allow: false, status: error.status, code: error.code, message: error.message};
    }
    // Unerwartete Fehler dürfen die Grenze nicht öffnen.
    return {allow: false, status: 500, code: "GATE_ERROR", message: error instanceof Error ? error.message : "api gate failed"};
  }
}
