import crypto from "node:crypto";
import {createStore} from "./persistence/store";
import {observe} from "./observability";

/**
 * Browser-Sessions (Abschnitt 37.13 / 38).
 *
 * Der Browser erhält ausschließlich ein HttpOnly-Session-Cookie. Das
 * Control-Plane-Token, Provider-Secrets, Device-Credentials und Runtime-Secrets
 * verlassen den Server niemals. Gespeichert wird nur der SHA-256-Hash des
 * Session-Geheimnisses; Sessions sind kurzlebig, rotierbar und widerrufbar.
 *
 *   Browser Session → Server Authentication → Control Plane
 *                   → Capability Resolution → Execution
 */

export type Session = {
  sessionId: string;
  actorId: string;
  role: "OWNER" | "ADMIN" | "DEVELOPER" | "REVIEWER" | "OPERATOR" | "VIEWER";
  issuedAt: string;
  expiresAt: string;
  lastSeenAt: string;
  secretHash: string;
  revokedAt?: string;
  userAgent?: string;
};

export const SESSION_COOKIE = "bob_session";
const DEFAULT_TTL_MS = 8 * 3600_000;

type Payload = {sessions: Session[]};
const store = createStore<Payload>("sessions", 1, () => ({sessions: []}));

const hash = (secret: string) => crypto.createHash("sha256").update(secret).digest("hex");

export function createSession(input: {actorId: string; role?: Session["role"]; ttlMs?: number; userAgent?: string}) {
  const secret = crypto.randomBytes(32).toString("base64url");
  const now = new Date();
  const session: Session = {
    sessionId: `SES-${crypto.randomUUID().slice(0, 8).toUpperCase()}`,
    actorId: input.actorId,
    role: input.role ?? "OWNER",
    issuedAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + (input.ttlMs ?? DEFAULT_TTL_MS)).toISOString(),
    lastSeenAt: now.toISOString(),
    secretHash: hash(secret),
    userAgent: input.userAgent
  };
  store.update(payload => {
    payload.sessions.push(session);
    if (payload.sessions.length > 200) payload.sessions.splice(0, payload.sessions.length - 200);
  });
  observe({
    type: "session.created",
    message: `Session ${session.sessionId} für ${session.actorId} erstellt`,
    status: "COMPLETED",
    actor: session.actorId,
    action: "session.create",
    resource: session.sessionId,
    argumentsValue: {role: session.role, expiresAt: session.expiresAt}
  });
  return {session: structuredClone(session), token: `${session.sessionId}.${secret}`};
}

export function resolveSession(token: string | undefined): Session | null {
  if (!token) return null;
  const [sessionId, secret] = token.split(".");
  if (!sessionId || !secret) return null;
  const payload = store.read();
  const session = payload.sessions.find(s => s.sessionId === sessionId);
  if (!session) return null;
  if (session.revokedAt) return null;
  if (new Date(session.expiresAt) <= new Date()) return null;
  const candidate = Buffer.from(hash(secret));
  const expected = Buffer.from(session.secretHash);
  if (candidate.length !== expected.length || !crypto.timingSafeEqual(candidate, expected)) return null;
  session.lastSeenAt = new Date().toISOString();
  store.update(next => {
    const index = next.sessions.findIndex(s => s.sessionId === session.sessionId);
    if (index >= 0) next.sessions[index] = session;
  });
  return structuredClone(session);
}

export function revokeSession(sessionId: string, actor: string): boolean {
  const payload = store.read();
  const session = payload.sessions.find(s => s.sessionId === sessionId);
  if (!session) return false;
  if (actor !== "CREATOR" && actor !== session.actorId) throw new Error("only the Creator or the session owner may revoke this session");
  session.revokedAt = new Date().toISOString();
  store.update(next => {
    const index = next.sessions.findIndex(s => s.sessionId === sessionId);
    if (index >= 0) next.sessions[index] = session;
  });
  observe({
    type: "session.revoked",
    message: `Session ${sessionId} widerrufen`,
    status: "BLOCKED",
    actor,
    action: "session.revoke",
    resource: sessionId,
    decision: "DENY"
  });
  return true;
}

export function listSessions(): Session[] {
  return structuredClone(store.read().sessions);
}

export function sessionIntegrity() {
  const sessions = store.read().sessions;
  const now = Date.now();
  return {
    total: sessions.length,
    active: sessions.filter(s => !s.revokedAt && new Date(s.expiresAt).getTime() > now).length,
    expired: sessions.filter(s => new Date(s.expiresAt).getTime() <= now).length
  };
}

export function sessionStoreReport() {
  return store.integrity();
}
