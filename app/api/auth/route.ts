import {SESSION_COOKIE, createSession, resolveSession, revokeSession} from "../../../lib/session";
import {BootstrapError, bootstrapStatus, completeBootstrap} from "../../../lib/bootstrap";
import {CreatorAuthError, creatorLoginAvailable, creatorLockState, creatorSecretSource, verifyCreatorLogin} from "../../../lib/creator-auth";
import {totpConfigured} from "../../../lib/totp";
import {observe} from "../../../lib/observability";
import {consumeRateLimit, rateLimitIdentityDigest} from "../../../lib/api/rate-limit";
import {isForwardedHttps} from "../../../lib/api/proxy";
import {recordAudit} from "../../../lib/audit";
import {isShuttingDown} from "../../../lib/shutdown";

const DEFAULT_TTL_MS = 8 * 3600_000;
const RENEW_THRESHOLD_MS = 2 * 3600_000;

function json(body: unknown, status = 200, cookie?: string, retryAfter?: number): Response {
  const headers: Record<string,string> = {"content-type":"application/json","cache-control":"no-store"};
  if (cookie) headers["set-cookie"] = cookie;
  if (retryAfter) headers["retry-after"] = String(retryAfter);
  return new Response(JSON.stringify(body), {status, headers});
}

function cookieValue(request: Request, name: string): string | undefined {
  const header = request.headers.get("cookie");
  if (!header) return undefined;
  for (const part of header.split(";")) {
    const [key,...rest] = part.trim().split("=");
    if (key === name) return decodeURIComponent(rest.join("="));
  }
  return undefined;
}

/**
 * Cookie-Attribute für die Session.
 *
 * `SameSite=Strict` ist der Standard und bleibt es — eine stillschweigende
 * Lockerung wäre eine Sicherheitsverschlechterung. Für den Betrieb hinter
 * einem Reverse Proxy bzw. in einer eingebetteten Ansicht (anderer
 * Kontext-Ursprung) kann der Betreiber über `BOB_COOKIE_SAMESITE` umstellen:
 *
 *   - `strict` (Standard)                 — nur gleicher Kontext,
 *   - `lax`                               — gleicher Kontext plus Top-Level-Navigation,
 *   - `none`                              — auch in fremden Kontexten; **erzwingt
 *                                           `Secure`**, weil Browser `SameSite=None`
 *                                           ohne TLS ablehnen.
 *
 * Ungültige Werte werden nicht „geraten\", sondern fail closed als `strict`
 * behandelt (siehe `tests/security/api-gate.test.ts`).
 */
function sameSiteAttribute(): string {
  const raw = (process.env.BOB_COOKIE_SAMESITE ?? "strict").trim().toLowerCase();
  if (raw === "lax" || raw === "none") return raw === "none" ? "None" : "Lax";
  return "Strict";
}

function cookieAttributes(request: Request, maxAgeSeconds: number): string {
  const secure = isForwardedHttps(request) || process.env.BOB_COOKIE_SECURE === "1";
  const sameSite = sameSiteAttribute();
  // `SameSite=None` ohne `Secure` wird von jedem Browser verworfen — dann wäre
  // die Anmeldung stillschweigend unmöglich. Deshalb erzwingt `none` TLS.
  const forceSecure = sameSite === "None";
  return `Path=/; HttpOnly; SameSite=${sameSite}; Max-Age=${maxAgeSeconds}${secure || forceSecure ? "; Secure" : ""}`;
}

async function readAction(request: Request): Promise<{action?:string;secret?:string;creatorName?:string;totpCode?:string}> {
  try {
    const body = (await request.json()) as {action?:unknown;secret?:unknown;creatorName?:unknown;totpCode?:unknown};
    return {
      action:typeof body.action==="string"?body.action:undefined,
      secret:typeof body.secret==="string"?body.secret:undefined,
      creatorName:typeof body.creatorName==="string"?body.creatorName:undefined,
      totpCode:typeof body.totpCode==="string"?body.totpCode:undefined
    };
  } catch { return {}; }
}

export function GET(request: Request): Response {
  const status=bootstrapStatus();
  const token=cookieValue(request,SESSION_COOKIE);
  const session=token?resolveSession(token):null;
  return json({
    initialized:status.initialized, requiresBootstrap:status.requiresBootstrap, revoked:Boolean(status.revokedAt),
    failClosed:status.failClosed, authenticated:Boolean(session),
    actor:session?{actorId:session.actorId,role:session.role,expiresAt:session.expiresAt}:null,
    loginAvailable:!status.revokedAt && creatorLoginAvailable(), loginSecretSource:creatorSecretSource(),
    secondFactor:totpConfigured()?"TOTP":"NOT_CONFIGURED", locked:creatorLockState().locked
  });
}

export async function POST(request: Request): Promise<Response> {
  if (isShuttingDown()) return json({error:"SHUTTING_DOWN",message:"server is draining and accepts no new authentication"},503);
  const limited=consumeRateLimit(request,"auth");
  if (!limited.allowed) {
    /**
     * Ein begrenzter Anmeldeversuch ist ein Sicherheitsereignis (Credential
     * Stuffing) und muss im Audit stehen — „blockiert" ohne Nachweis wäre eine
     * unsichtbare Abwehr. Die Kennung geht nur als Digest hinein.
     */
    recordAudit({actor:"ANONYMOUS", action:"rate-limit", decision:"DENY"}, {
      bucket:"auth",
      retryAfterSeconds:limited.retryAfterSeconds,
      identityDigest:rateLimitIdentityDigest(request)
    });
    return json({error:"RATE_LIMITED",message:"authentication rate limit exceeded"},429,undefined,limited.retryAfterSeconds);
  }
  const {action,secret,creatorName,totpCode}=await readAction(request);
  const status=bootstrapStatus();

  if (action==="bootstrap") {
    if(status.initialized) return json({error:"ALREADY_INITIALIZED",message:"system is already initialized"},409);
    if(status.revokedAt) return json({error:"ROOT_REVOKED",message:"root authority is revoked"},423);
    if(!secret || !creatorName) return json({error:"INPUT",message:"secret and creatorName are required"},400);
    try {
      const result=completeBootstrap({secret,creatorName});
      const {session,token}=createSession({actorId:"CREATOR",role:"OWNER",ttlMs:DEFAULT_TTL_MS,userAgent:request.headers.get("user-agent")??undefined});
      return json({ok:true,rootAuthorityId:result.rootAuthorityId,creatorName:result.creatorName,session:{actorId:session.actorId,role:session.role,expiresAt:session.expiresAt}},201,`${SESSION_COOKIE}=${token}; ${cookieAttributes(request,DEFAULT_TTL_MS/1000)}`);
    } catch(error) {
      if(error instanceof BootstrapError) {
        observe({type:"bootstrap.rejected",message:`Creator-Bootstrap verweigert: ${error.code}`,status:"BLOCKED",actor:"ANONYMOUS",action:"bootstrap.complete",decision:"DENY",argumentsValue:{code:error.code}});
        return json({error:error.code,message:error.message},error.code==="SECRET_MISMATCH"?403:400);
      }
      throw error;
    }
  }

  if(action==="login") {
    if(!status.initialized) return json({error:"BOOTSTRAP_REQUIRED",message:"complete the creator bootstrap first"},428);
    if(status.revokedAt) return json({error:"ROOT_REVOKED",message:"root authority is revoked"},423);
    if(!secret) return json({error:"CREATOR_SECRET_REQUIRED",message:"creator secret is required"},400);
    try {
      const login=verifyCreatorLogin(secret,totpCode);
      const issued=createSession({actorId:"CREATOR",role:"OWNER",ttlMs:DEFAULT_TTL_MS,userAgent:request.headers.get("user-agent")??undefined});
      return json({ok:true,actor:{actorId:issued.session.actorId,role:issued.session.role,expiresAt:issued.session.expiresAt},secondFactor:login.secondFactor},201,`${SESSION_COOKIE}=${issued.token}; ${cookieAttributes(request,DEFAULT_TTL_MS/1000)}`);
    } catch(error) {
      if(error instanceof CreatorAuthError) return json({error:error.code,message:error.message},error.status);
      throw error;
    }
  }

  const token=cookieValue(request,SESSION_COOKIE);
  const session=token?resolveSession(token):null;
  if(!session) return json({error:"SESSION_REQUIRED",message:"a valid browser session is required"},401);

  if(action==="renew") {
    const remainingMs=new Date(session.expiresAt).getTime()-Date.now();
    if(remainingMs>RENEW_THRESHOLD_MS) return json({ok:true,renewed:false,expiresAt:session.expiresAt});
    const issued=createSession({actorId:session.actorId,role:session.role,ttlMs:DEFAULT_TTL_MS,userAgent:request.headers.get("user-agent")??undefined});
    revokeSession(session.sessionId,session.actorId);
    return json({ok:true,renewed:true,actor:{actorId:issued.session.actorId,role:issued.session.role,expiresAt:issued.session.expiresAt}},200,`${SESSION_COOKIE}=${issued.token}; ${cookieAttributes(request,DEFAULT_TTL_MS/1000)}`);
  }

  if(action==="logout") {
    revokeSession(session.sessionId,session.actorId);
    return json({ok:true},200,`${SESSION_COOKIE}=; ${cookieAttributes(request,0)}`);
  }

  return json({error:"UNKNOWN_ACTION",message:"supported actions: bootstrap, login, renew, logout"},400);
}
