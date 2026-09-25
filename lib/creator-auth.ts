import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import {createStore, storageRoot} from "./persistence/store";
import {observe} from "./observability";
import {recordAudit} from "./audit";

/**
 * Creator-Anmeldung (Abschnitt 38, Re-Authentifizierung).
 *
 * Der Browser erhält ausschließlich HttpOnly-Sessions. Damit der Creator nach
 * Verlust des Cookies (oder nach Neustart) wieder Zugang erhält, ohne dass
 * Sicherheitsgrenzen aufgeweicht werden, existiert genau ein server-seitiger
 * Credential-Pfad:
 *
 *   - Ein zufälliges Creator-Secret wird beim Bootstrap erzeugt und als Datei
 *     `<BOB_STORAGE_DIR>/creator-token` mit Rechten 0600 abgelegt; gespeichert
 *     wird nur der SHA-256-Hash.
 *   - Alternativ (kontrollierte Deployments) kann das Secret über die
 *     Serverumgebungsvariable `BOB_CREATOR_LOGIN_SECRET` gesetzt werden.
 *   - Das Secret verlässt den Server niemals über eine API.
 *
 * Fail closed: unbekanntes/fehlendes Secret → 428, falsches Secret → 403,
 * zu viele Fehlversuche → 423 (Sperre). Jeder Versuch wird auditiert.
 */

export type CreatorSecretSource = "FILE" | "ENV";

type Payload = {
  secretHash: string | null;
  secretCreatedAt: string | null;
  source: CreatorSecretSource | null;
  /** Zeitpunkte fehlgeschlagener Anmeldungen (Aufräumen nach Fensterablauf). */
  failures: string[];
  lockedUntil: string | null;
};

const store = createStore<Payload>("creator-auth", 1, () => ({
  secretHash: null,
  secretCreatedAt: null,
  source: null,
  failures: [],
  lockedUntil: null
}));

export const CREATOR_LOGIN_SECRET_ENV = "BOB_CREATOR_LOGIN_SECRET";
const LOCKOUT_THRESHOLD = 5;
const LOCKOUT_WINDOW_MS = 15 * 60_000;
const LOCKOUT_DURATION_MS = 15 * 60_000;
const MAX_TRACKED_FAILURES = 20;

const secretFile = () => path.join(storageRoot(), "creator-token");
const hash = (value: string) => crypto.createHash("sha256").update(value).digest("hex");

export class CreatorAuthError extends Error {
  readonly code: string;
  readonly status: number;
  constructor(code: string, status: number, message: string) {
    super(message);
    this.name = "CreatorAuthError";
    this.code = code;
    this.status = status;
  }
}

function envSecret(): string | null {
  const value = process.env[CREATOR_LOGIN_SECRET_ENV];
  return value && value.length >= 16 ? value : null;
}

function writeSecretFile(secret: string): string {
  fs.mkdirSync(storageRoot(), {recursive: true, mode: 0o700});
  fs.writeFileSync(secretFile(), `${secret}\n`, {encoding: "utf8", mode: 0o600});
  try {
    fs.chmodSync(secretFile(), 0o600);
  } catch {
    /* best effort (z. B. exotische Dateisysteme) */
  }
  return secretFile();
}

/**
 * Erzeugt das Creator-Secret. Wird ausschließlich vom Bootstrap aufgerufen,
 * nachdem die Einmal-Secret-Datei vernichtet wurde.
 */
export function initializeCreatorSecret(): {source: CreatorSecretSource; file: string | null; created: boolean} {
  const fromEnv = envSecret();
  const secret = fromEnv ?? crypto.randomBytes(32).toString("base64url");
  const file = fromEnv ? null : writeSecretFile(secret);
  store.update(payload => {
    payload.secretHash = hash(secret);
    payload.secretCreatedAt = new Date().toISOString();
    payload.source = fromEnv ? "ENV" : "FILE";
    payload.failures = [];
    payload.lockedUntil = null;
  });
  observe({
    type: "creator.secret.created",
    message: fromEnv
      ? "Creator-Anmelde-Secret aus Serverumgebung übernommen"
      : "Creator-Anmelde-Secret erzeugt (Datei mit Rechten 0600)",
    status: "WAITING",
    actor: "SYSTEM",
    action: "creator.secret",
    resource: "CREATOR-AUTH",
    argumentsValue: {source: fromEnv ? "ENV" : "FILE", file}
  });
  return {source: fromEnv ? "ENV" : "FILE", file, created: true};
}

/** Rotiert das Creator-Secret (nur Creator; alte Anmeldungen bleiben gültig bis Ablauf). */
export function rotateCreatorSecret(actor = "CREATOR"): {source: CreatorSecretSource; file: string | null} {
  if (actor !== "CREATOR") throw new CreatorAuthError("ROTATION_DENIED", 403, "only the Creator may rotate the creator secret");
  if (!store.read().secretHash) throw new CreatorAuthError("NO_CREATOR_SECRET", 428, "no creator secret is configured");
  const result = initializeCreatorSecret();
  recordAudit({actor, action: "creator.secret.rotate", resource: "CREATOR-AUTH", decision: "ALLOW"}, {source: result.source});
  return {source: result.source, file: result.file};
}

export function creatorSecretSource(): CreatorSecretSource | null {
  if (envSecret()) return "ENV";
  return store.read().source;
}

export function creatorLoginAvailable(): boolean {
  return Boolean(envSecret() ?? store.read().secretHash);
}

export function creatorLockState(): {locked: boolean; lockedUntil: string | null; failures: number} {
  const payload = store.read();
  const locked = Boolean(payload.lockedUntil && new Date(payload.lockedUntil).getTime() > Date.now());
  return {locked, lockedUntil: locked ? payload.lockedUntil : null, failures: payload.failures.length};
}

function pruneFailures(failures: string[], now: number): string[] {
  return failures.filter(at => now - new Date(at).getTime() < LOCKOUT_WINDOW_MS).slice(-MAX_TRACKED_FAILURES);
}

/**
 * Prüft das Creator-Secret. Bei Erfolg werden Fehlversuche zurückgesetzt.
 * Wirft `CreatorAuthError` mit passendem HTTP-Status bei Ablehnung.
 */
export function verifyCreatorLogin(secret: string): {ok: true} {
  if (typeof secret !== "string" || secret.length === 0) {
    throw new CreatorAuthError("CREATOR_SECRET_REQUIRED", 400, "creator secret is required");
  }
  const now = Date.now();
  const payload = store.read();

  if (payload.lockedUntil && new Date(payload.lockedUntil).getTime() > now) {
    observe({
      type: "creator.login.locked",
      message: "Creator-Anmeldung während der Sperre verweigert",
      status: "BLOCKED",
      actor: "ANONYMOUS",
      action: "creator.login",
      resource: "CREATOR-AUTH",
      decision: "DENY",
      argumentsValue: {lockedUntil: payload.lockedUntil}
    });
    throw new CreatorAuthError("CREATOR_LOCKED", 423, `too many failed attempts; try again after ${payload.lockedUntil}`);
  }

  const expectedValue = envSecret();
  const expected = expectedValue ? hash(expectedValue) : payload.secretHash;
  if (!expected) throw new CreatorAuthError("NO_CREATOR_SECRET", 428, "no creator secret is configured");

  const supplied = Buffer.from(hash(secret));
  const reference = Buffer.from(expected);
  const matches = supplied.length === reference.length && crypto.timingSafeEqual(supplied, reference);

  if (matches) {
    store.update(next => {
      next.failures = [];
      next.lockedUntil = null;
    });
    observe({
      type: "creator.login",
      message: "Creator-Anmeldung erfolgreich",
      status: "COMPLETED",
      actor: "CREATOR",
      action: "creator.login",
      resource: "CREATOR-AUTH",
      decision: "ALLOW"
    });
    return {ok: true};
  }

  const failures = pruneFailures([...payload.failures, new Date(now).toISOString()], now);
  const locked = failures.length >= LOCKOUT_THRESHOLD;
  store.update(next => {
    next.failures = failures;
    next.lockedUntil = locked ? new Date(now + LOCKOUT_DURATION_MS).toISOString() : null;
  });
  recordAudit({actor: "ANONYMOUS", action: "creator.login", resource: "CREATOR-AUTH", decision: "DENY"}, {failures: failures.length, locked});
  observe({
    type: locked ? "creator.login.locked" : "creator.login.denied",
    message: locked
      ? `Creator-Anmeldung gesperrt nach ${failures.length} Fehlversuchen`
      : `Creator-Anmeldung verweigert (Versuch ${failures.length})`,
    status: "BLOCKED",
    actor: "ANONYMOUS",
    action: "creator.login",
    resource: "CREATOR-AUTH",
    decision: "DENY",
    argumentsValue: {failures: failures.length, locked}
  });
  throw new CreatorAuthError(
    locked ? "CREATOR_LOCKED" : "CREATOR_SECRET_MISMATCH",
    locked ? 423 : 403,
    locked ? "too many failed attempts; creator login is locked" : "creator secret is invalid"
  );
}

export function creatorAuthReport() {
  const payload = store.read();
  return {
    ...store.integrity(),
    source: creatorSecretSource(),
    configured: creatorLoginAvailable(),
    createdAt: payload.secretCreatedAt,
    secretFile: fs.existsSync(secretFile()) ? secretFile() : null,
    ...creatorLockState()
  };
}
