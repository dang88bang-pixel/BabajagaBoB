import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import {createStore, storageRoot} from "./persistence/store";
import {observe} from "./observability";
import {addAuthorityEdge, hasActiveRootAuthority, rootAuthorityId, setRootAuthority} from "./authority";
import {createDelegation} from "./governance";
import {registerAgent, getControlState} from "./control-plane";

/**
 * Sicherer Creator-Bootstrap (Abschnitt 9).
 *
 * Anforderungen und Umsetzung:
 *  - kein hartcodiertes Secret, kein Secret im Repository, kein Secret im Client
 *  - einmalige Initialisierung: das Bootstrap-Secret wird nach Gebrauch ungültig
 *  - Creator ist Root Authority (explizite Authority-Kante CREATOR → SYSTEM-WORKER)
 *  - nachvollziehbarer Bootstrap-Event + Audit-Eintrag
 *  - Rotation (`rotateRoot`) und Widerruf (`revokeRoot`) sind möglich
 *  - fail-closed: ohne Bootstrap ist jede sicherheitsrelevante Aktion verweigert
 *
 * Ablauf:
 *  1. Serverstart (oder erster API-Aufruf) erzeugt – falls nicht initialisiert –
 *     ein Einmal-Secret unter `.bob-data/bootstrap-token` (Dateirechte 0600).
 *  2. Der Creator liest dieses Secret aus seinem Dateisystem (Host-Zugriff nötig)
 *     oder setzt alternativ `BOB_BOOTSTRAP_SECRET` in der Serverumgebung.
 *  3. `POST /api/bootstrap` mit `{action:"complete", secret, creatorName}` erzeugt
 *     die Root Authority, die System-Delegation und eine Creator-Session.
 *  4. Danach wird das Secret gelöscht und kann nicht erneut verwendet werden.
 */

export type BootstrapState = {
  initialized: boolean;
  rootAuthorityId: string | null;
  creatorName: string | null;
  completedAt: string | null;
  rotating: boolean;
  revokedAt: string | null;
  revokeReason: string | null;
};

type Payload = {state: BootstrapState; secretHash: string | null; secretCreatedAt: string | null};
const store = createStore<Payload>("bootstrap", 1, () => ({state: {initialized: false, rootAuthorityId: null, creatorName: null, completedAt: null, rotating: false, revokedAt: null, revokeReason: null}, secretHash: null, secretCreatedAt: null}));

export class BootstrapError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = "BootstrapError";
    this.code = code;
  }
}

const secretFile = () => path.join(storageRoot(), "bootstrap-token");
const hash = (secret: string) => crypto.createHash("sha256").update(secret).digest("hex");

export function bootstrapStatus() {
  const payload = store.read();
  const fileExists = fs.existsSync(secretFile());
  return {
    ...payload.state,
    requiresBootstrap: !payload.state.initialized,
    failClosed: !payload.state.initialized || Boolean(payload.state.revokedAt),
    secretFile: fileExists ? secretFile() : null,
    secretSource: process.env.BOB_BOOTSTRAP_SECRET ? "ENV:BOB_BOOTSTRAP_SECRET" : fileExists ? "FILE" : "MISSING"
  };
}

/**
 * Erzeugt das Einmal-Secret, falls das System noch nicht initialisiert ist.
 * Wird vom Serverstart und von `GET /api/bootstrap` aufgerufen.
 */
export function ensureBootstrapSecret(): {created: boolean; file: string | null; usingEnv: boolean} {
  const payload = store.read();
  if (payload.state.initialized || payload.state.revokedAt) return {created: false, file: null, usingEnv: Boolean(process.env.BOB_BOOTSTRAP_SECRET)};
  if (process.env.BOB_BOOTSTRAP_SECRET) {
    return {created: false, file: null, usingEnv: true};
  }
  if (payload.secretHash && fs.existsSync(secretFile())) return {created: false, file: secretFile(), usingEnv: false};
  const secret = crypto.randomBytes(32).toString("base64url");
  fs.mkdirSync(storageRoot(), {recursive: true, mode: 0o700});
  fs.writeFileSync(secretFile(), `${secret}\n`, {encoding: "utf8", mode: 0o600});
  try {
    fs.chmodSync(secretFile(), 0o600);
  } catch {
    /* best effort */
  }
  store.update(next => {
    next.secretHash = hash(secret);
    next.secretCreatedAt = new Date().toISOString();
  });
  observe({
    type: "bootstrap.secret.created",
    message: "Einmaliges Bootstrap-Secret erzeugt (Datei mit Rechten 0600)",
    status: "WAITING",
    actor: "SYSTEM",
    action: "bootstrap.secret",
    resource: "BOOTSTRAP",
    argumentsValue: {file: secretFile()}
  });
  return {created: true, file: secretFile(), usingEnv: false};
}

function verifySecret(supplied: string) {
  const payload = store.read();
  if (payload.state.initialized) throw new BootstrapError("ALREADY_INITIALIZED", "system is already initialized");
  const expected = process.env.BOB_BOOTSTRAP_SECRET ? hash(process.env.BOB_BOOTSTRAP_SECRET) : payload.secretHash;
  if (!expected) throw new BootstrapError("NO_SECRET", "no bootstrap secret is configured; restart the control plane to create one");
  const a = Buffer.from(hash(supplied));
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) throw new BootstrapError("SECRET_MISMATCH", "bootstrap secret is invalid");
}

/** Einmalige Initialisierung: Creator wird Root Authority. */
export function completeBootstrap(input: {secret: string; creatorName: string}) {
  if (!input.creatorName || input.creatorName.length < 2) throw new BootstrapError("CREATOR_NAME", "creator name required");
  const payload = store.read();
  if (payload.state.initialized) {
    if (payload.state.revokedAt) throw new BootstrapError("ROOT_REVOKED", "root authority is revoked; re-bootstrap is disabled by default");
    throw new BootstrapError("ALREADY_INITIALIZED", "system is already initialized");
  }
  verifySecret(input.secret);

  const rootAuthorityId = `ROOT-${crypto.randomUUID().slice(0, 8).toUpperCase()}`;
  setRootAuthority(rootAuthorityId, "CREATOR");
  addAuthorityEdge(
    {id: `EDGE-ROOT-${rootAuthorityId}`, from: "CREATOR", to: "SYSTEM-WORKER", kind: "DELEGATES", capabilities: ["task:execute", "sandbox:run", "sandbox:snapshot", "regression:run"], maxRisk: "HIGH", expiresAt: null},
    "CREATOR"
  );
  createDelegation(
    {
      from: "CREATOR",
      to: "SYSTEM-WORKER",
      capabilities: ["task:execute", "sandbox:run", "sandbox:snapshot", "regression:run"],
      maxRisk: "HIGH",
      expiresAt: new Date(Date.now() + 365 * 24 * 3600_000).toISOString()
    },
    "CREATOR"
  );
  createDelegation(
    {
      from: "CREATOR",
      to: "AG-GUARD",
      capabilities: ["policy:read", "audit:read", "approval:request", "authority:revoke"],
      maxRisk: "HIGH",
      expiresAt: new Date(Date.now() + 30 * 24 * 3600_000).toISOString()
    },
    "CREATOR"
  );

  const completedAt = new Date().toISOString();
  store.update(next => {
    next.state = {initialized: true, rootAuthorityId, creatorName: input.creatorName, completedAt, rotating: false, revokedAt: null, revokeReason: null};
    next.secretHash = null;
  });

  // Einmal-Secret vernichten.
  if (fs.existsSync(secretFile())) fs.rmSync(secretFile());

  observe({
    type: "bootstrap.completed",
    message: `Creator-Bootstrap abgeschlossen (${rootAuthorityId})`,
    status: "COMPLETED",
    actor: "CREATOR",
    action: "bootstrap.complete",
    resource: rootAuthorityId,
    decision: "ALLOW",
    argumentsValue: {creatorName: input.creatorName, rootAuthorityId}
  });

  const agents = getControlState().agents.length;
  return {rootAuthorityId, creatorName: input.creatorName, completedAt, registeredAgents: agents};
}

/** Rotation der Root Authority (nur Creator). */
export function rotateRoot(actor = "CREATOR") {
  if (actor !== "CREATOR") throw new BootstrapError("ROTATION_DENIED", "only the Creator may rotate the root authority");
  const payload = store.read();
  if (!payload.state.initialized) throw new BootstrapError("NOT_INITIALIZED", "system is not initialized");
  const previous = payload.state.rootAuthorityId;
  const rootAuthorityId = `ROOT-${crypto.randomUUID().slice(0, 8).toUpperCase()}`;
  setRootAuthority(rootAuthorityId, "CREATOR");
  store.update(next => {
    next.state.rootAuthorityId = rootAuthorityId;
    next.state.rotating = false;
  });
  observe({
    type: "bootstrap.root.rotated",
    message: `Root Authority rotiert: ${previous} → ${rootAuthorityId}`,
    status: "COMPLETED",
    actor: "CREATOR",
    action: "bootstrap.rotate",
    resource: rootAuthorityId,
    decision: "ALLOW",
    argumentsValue: {previous, rootAuthorityId}
  });
  return {previousRootAuthorityId: previous, rootAuthorityId};
}

/** Widerruf: System wird fail-closed, alle Root-gebundenen Aktionen entfallen. */
export function revokeRoot(reason: string, actor = "CREATOR") {
  if (actor !== "CREATOR") throw new BootstrapError("REVOKE_DENIED", "only the Creator may revoke the root authority");
  const payload = store.read();
  if (!payload.state.initialized) throw new BootstrapError("NOT_INITIALIZED", "system is not initialized");
  if (!reason) throw new BootstrapError("REASON_REQUIRED", "revocation requires a reason");
  setRootAuthority(null, "CREATOR");
  store.update(next => {
    next.state.revokedAt = new Date().toISOString();
    next.state.revokeReason = reason;
  });
  observe({
    type: "bootstrap.root.revoked",
    message: `Root Authority widerrufen: ${reason}`,
    status: "ERROR",
    actor: "CREATOR",
    action: "bootstrap.revoke",
    resource: "ROOT",
    decision: "DENY",
    argumentsValue: {reason}
  });
  return bootstrapStatus();
}

/** Fail-closed-Prüfung für alle sicherheitsrelevanten Endpunkte. */
export function requireInitialized(): void {
  const status = bootstrapStatus();
  if (status.revokedAt) throw new BootstrapError("ROOT_REVOKED", "root authority is revoked; system is fail-closed");
  if (!status.initialized) throw new BootstrapError("BOOTSTRAP_REQUIRED", "system is not initialized; complete the creator bootstrap first");
  if (!hasActiveRootAuthority()) throw new BootstrapError("NO_ROOT_AUTHORITY", "no active root authority; system is fail-closed");
  if (!rootAuthorityId()) throw new BootstrapError("NO_ROOT_AUTHORITY", "root authority id missing");
}

export function bootstrapIntegrity() {
  return store.integrity();
}

export function registeredAgents() {
  return getControlState().agents.length;
}

export {registerAgent};
