import {NextResponse} from "next/server";
import {apiGateDecision} from "./lib/api/api-gate";

/**
 * Server-Authentifizierung für die Control Plane (Abschnitt 38).
 *
 * Die Middleware läuft auf der Node-Runtime (Datei-/Krypto-Zugriff für
 * Persistenz, Audit und Sessions) und schützt die gesamte `/api`-Oberfläche.
 * `/api/auth` ist die öffentliche Bootstrap-/Session-Grenze. Agent-Tokens erreichen
 * nur den Execution Broker (`/api/runtime`) und den `/api/offline`-Router, der sie
 * ausschließlich für `package.execute` akzeptiert; alle Sync-/Creator-Aktionen
 * bleiben dort Creator-geschützt. Fail closed: ohne gültige Authority → 401/403/428.
 */

export const runtime = "nodejs";

export const config = {
  matcher: ["/api/:path*"]
};

export function middleware(request: Request) {
  const decision = apiGateDecision(request);
  if (decision.allow) return NextResponse.next();
  return NextResponse.json({error: decision.code, message: decision.message}, {status: decision.status});
}
