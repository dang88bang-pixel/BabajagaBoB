import {SESSION_COOKIE, createSession, resolveSession, revokeSession} from "../../../lib/session";
import {BootstrapError, bootstrapStatus, completeBootstrap} from "../../../lib/bootstrap";
import {observe} from "../../../lib/observability";

/**
 * Authentifizierungsstrecke der Control Plane (Abschnitt 38).
 *
 * Einzige öffentliche API-Route (neben dem Status): hier wird der einmalige
 * Creator-Bootstrap abgeschlossen und die Browser-Session ausgestellt. Der
 * Browser erhält ausschließlich ein HttpOnly-Cookie – niemals Root-, Provider-,
 * Device- oder Runtime-Secrets.
 *
 *   GET  /api/auth              → Status (initialisiert? angemeldet?)
 *   POST /api/auth {action}     → bootstrap | renew | logout
 */

const DEFAULT_TTL_MS = 8 * 3600_000;
const RENEW_THRESHOLD_MS = 2 * 3600_000;

function json(body: unknown, status = 200, cookie?: string): Response {
  const headers: Record<string, string> = {"content-type": "application/json", "cache-control": "no-store"};
  if (cookie) headers["set-cookie"] = cookie;
  return new Response(JSON.stringify(body), {status, headers});
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

function cookieAttributes(request: Request, maxAgeSeconds: number): string {
  const forwardedProto = request.headers.get("x-forwarded-proto")?.split(",")[0]?.trim();
  const secure = forwardedProto === "https" || process.env.BOB_COOKIE_SECURE === "1";
  return `Path=/; HttpOnly; SameSite=Strict; Max-Age=${maxAgeSeconds}${secure ? "; Secure" : ""}`;
}

async function readAction(request: Request): Promise<{action?: string; secret?: string; creatorName?: string}> {
  try {
    const body = (await request.json()) as {action?: unknown; secret?: unknown; creatorName?: unknown};
    return {
      action: typeof body.action === "string" ? body.action : undefined,
      secret: typeof body.secret === "string" ? body.secret : undefined,
      creatorName: typeof body.creatorName === "string" ? body.creatorName : undefined
    };
  } catch {
    return {};
  }
}

export function GET(request: Request): Response {
  const status = bootstrapStatus();
  const token = cookieValue(request, SESSION_COOKIE);
  const session = token ? resolveSession(token) : null;
  return json({
    initialized: status.initialized,
    requiresBootstrap: status.requiresBootstrap,
    revoked: Boolean(status.revokedAt),
    failClosed: status.failClosed,
    authenticated: Boolean(session),
    actor: session ? {actorId: session.actorId, role: session.role, expiresAt: session.expiresAt} : null
  });
}

export async function POST(request: Request): Promise<Response> {
  const {action, secret, creatorName} = await readAction(request);
  const status = bootstrapStatus();

  if (action === "bootstrap") {
    if (status.initialized) return json({error: "ALREADY_INITIALIZED", message: "system is already initialized"}, 409);
    if (status.revokedAt) return json({error: "ROOT_REVOKED", message: "root authority is revoked"}, 423);
    if (!secret || !creatorName) return json({error: "INPUT", message: "secret and creatorName are required"}, 400);
    try {
      const result = completeBootstrap({secret, creatorName});
      const {session, token} = createSession({
        actorId: "CREATOR",
        role: "OWNER",
        ttlMs: DEFAULT_TTL_MS,
        userAgent: request.headers.get("user-agent") ?? undefined
      });
      return json(
        {ok: true, rootAuthorityId: result.rootAuthorityId, creatorName: result.creatorName, session: {actorId: session.actorId, role: session.role, expiresAt: session.expiresAt}},
        201,
        `${SESSION_COOKIE}=${token}; ${cookieAttributes(request, DEFAULT_TTL_MS / 1000)}`
      );
    } catch (error) {
      if (error instanceof BootstrapError) {
        observe({
          type: "bootstrap.rejected",
          message: `Creator-Bootstrap verweigert: ${error.code}`,
          status: "BLOCKED",
          actor: "ANONYMOUS",
          action: "bootstrap.complete",
          decision: "DENY",
          argumentsValue: {code: error.code}
        });
        return json({error: error.code, message: error.message}, error.code === "SECRET_MISMATCH" ? 403 : 400);
      }
      throw error;
    }
  }

  const token = cookieValue(request, SESSION_COOKIE);
  const session = token ? resolveSession(token) : null;
  if (!session) return json({error: "SESSION_REQUIRED", message: "a valid browser session is required"}, 401);

  if (action === "renew") {
    const remainingMs = new Date(session.expiresAt).getTime() - Date.now();
    if (remainingMs > RENEW_THRESHOLD_MS) {
      return json({ok: true, renewed: false, expiresAt: session.expiresAt});
    }
    const issued = createSession({
      actorId: session.actorId,
      role: session.role,
      ttlMs: DEFAULT_TTL_MS,
      userAgent: request.headers.get("user-agent") ?? undefined
    });
    revokeSession(session.sessionId, session.actorId);
    return json(
      {ok: true, renewed: true, actor: {actorId: issued.session.actorId, role: issued.session.role, expiresAt: issued.session.expiresAt}},
      200,
      `${SESSION_COOKIE}=${issued.token}; ${cookieAttributes(request, DEFAULT_TTL_MS / 1000)}`
    );
  }

  if (action === "logout") {
    revokeSession(session.sessionId, session.actorId);
    return json({ok: true}, 200, `${SESSION_COOKIE}=; ${cookieAttributes(request, 0)}`);
  }

  return json({error: "UNKNOWN_ACTION", message: "supported actions: bootstrap, renew, logout"}, 400);
}
