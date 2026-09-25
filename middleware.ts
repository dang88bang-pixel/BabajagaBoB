import {NextResponse} from "next/server";
import {apiGateDecision} from "./lib/api/api-gate";

/**
 * Server-Authentifizierung für die Control Plane (Abschnitt 38).
 *
 * Die Middleware läuft auf der Node-Runtime (Datei-/Krypto-Zugriff für
 * Persistenz, Audit und Sessions) und schützt die gesamte `/api`-Oberfläche.
 * `/api/auth` ist die einzige Ausnahme: dort wird die Session überhaupt erst
 * ausgestellt. Fail closed: ohne Bootstrap → 428, ohne Session → 401.
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
