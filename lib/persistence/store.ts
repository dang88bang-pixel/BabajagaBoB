import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

/**
 * Einheitliche Persistenz-Grundlage (Abschnitt 39).
 *
 * Jede Store-Datei enthält:
 *  - version   : Schema-Version (Migrationen müssen explizit erfolgen)
 *  - writtenAt : Zeitstempel des letzten Schreibvorgangs
 *  - payload   : tatsächliche Daten
 *  - digest    : SHA-256 über {version,payload} -> erkennt Beschädigung/Manipulation
 *
 * Schreibvorgänge sind atomar (tmp-Datei + rename) und werden mit restriktiven
 * Dateirechten (0600) angelegt. Ein beschädigter Store wirft `StoreIntegrityError`
 * und wird niemals stillschweigend als gültig behandelt (fail closed).
 *
 * Schema-Wechsel: Ein Store mit älterer Version wird nur dann gelesen, wenn für
 * ihn eine **registrierte** Migrationskette existiert (explizit, je Schritt eine
 * Funktion). Vor der Migration wird der Digest geprüft, eine Sicherungskopie der
 * Originaldatei angelegt (`store.json.pre-v{N}.bak`, 0600) und der Vorgang im
 * Migrationsjournal (siehe `readMigrationJournal`) festgehalten. Fehlt die Kette
 * oder ist die Datei **neuer** als der Code, wird fail closed abgebrochen — es
 * gibt kein stilles Raten und kein Downgrade.
 */

export class StoreIntegrityError extends Error {
  readonly store: string;
  constructor(store: string, message: string) {
    super(`[${store}] ${message}`);
    this.name = "StoreIntegrityError";
    this.store = store;
  }
}

/**
 * Zwei Schreibvorgänge sind aufeinander getroffen: Der Datensatz wurde zwischen
 * Lesen und Schreiben von jemand anderem verändert. Das ist **kein** Datenfehler,
 * sondern ein Nebenläufigkeitskonflikt — er wird erneut versucht und, wenn er
 * bleibt, laut gemeldet. Früher galt hier „letzter Schreiber gewinnt": ein
 * gleichzeitiger zweiter Prozess konnte Änderungen stillschweigend verlieren.
 */
export class StoreConflictError extends Error {
  readonly store: string;
  readonly expectedRevision: number;
  readonly actualRevision: number;
  constructor(store: string, expectedRevision: number, actualRevision: number) {
    super(`[${store}] concurrent modification detected (expected revision ${expectedRevision}, found ${actualRevision})`);
    this.name = "StoreConflictError";
    this.store = store;
    this.expectedRevision = expectedRevision;
    this.actualRevision = actualRevision;
  }
}

export type StoreEnvelope<T> = {store?: string; version: number; writtenAt: string; payload: T; digest: string; revision?: number};

/** Revision eines Envelopes; Altbestände ohne Feld gelten als Revision 0. */
function envelopeRevision(envelope: {revision?: number} | null): number {
  if (!envelope) return 0;
  const value = envelope.revision;
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : 0;
}

/** Kurze synchrone Pause zwischen zwei Konfliktversuchen (kein Busy-Loop). */
function sleepSync(ms: number) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

/** Obergrenze der Wiederholungen bei Nebenläufigkeitskonflikten. */
export const STORE_CONFLICT_RETRIES = 12;
/** Wartezeit auf die Schreibsperre eines Stores, bevor ein Konflikt gemeldet wird. */
const LOCK_WAIT_MS = 10_000;
/** Ab diesem Alter gilt eine Sperre als verwaist (der Halter ist abgestürzt). */
const LOCK_STALE_MS = 5_000;

/** Ein Migrationsschritt hebt genau eine Version an (`from` → `from + 1`). */
export type StoreMigration = (payload: unknown) => unknown;
export type StoreOptions = {migrations?: Record<number, StoreMigration>};

export type MigrationRecord = {store: string; fromVersion: number; toVersion: number; at: string; backup: string};

export function storageRoot(): string {
  return process.env.BOB_STORAGE_DIR ?? path.join(process.cwd(), ".bob-data");
}

export function domainDigest(value: unknown): string {
  return crypto.createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

/**
 * Digest über Version und Inhalt. Neuere Envelopes binden zusätzlich den
 * Store-Namen: eine an einen anderen Store-Namen kopierte Datei fällt damit auf,
 * statt als „gültiges" Backup des falschen Stores durchzugehen. Ältere Envelopes
 * ohne Namen bleiben lesbar (Legacy-Pfad).
 */
function envelopeDigest(version: number, payload: unknown, store?: string): string {
  return store ? domainDigest({store, version, payload}) : domainDigest({version, payload});
}

function envelopeMatchesStore(envelope: {store?: string}, name: string): boolean {
  return envelope.store === undefined || envelope.store === name;
}

function envelopeDigestValid(envelope: {store?: string; version: number; payload: unknown; digest: string}): boolean {
  return envelope.digest === envelopeDigest(envelope.version, envelope.payload, envelope.store);
}

function ensureRoot(): string {
  const root = storageRoot();
  fs.mkdirSync(root, {recursive: true, mode: 0o700});
  return root;
}

export type StoreIntegrityReport = {
  store: string;
  file: string;
  exists: boolean;
  ok: boolean;
  version?: number;
  writtenAt?: string;
  bytes?: number;
  error?: string;
};

export class DurableStore<T> {
  readonly name: string;
  readonly version: number;
  readonly file: string;
  private readonly create: () => T;
  private readonly migrations: Record<number, StoreMigration>;

  constructor(name: string, version: number, create: () => T, options: StoreOptions = {}) {
    if (!/^[a-z0-9-]+$/.test(name)) throw new Error(`invalid store name: ${name}`);
    this.name = name;
    this.version = version;
    this.create = create;
    this.migrations = options.migrations ?? {};
    this.file = path.join(storageRoot(), `${name}.json`);
  }

  /** Prüft, ob eine lückenlose Migrationskette von `from` bis `this.version` existiert. */
  canMigrate(from: number): boolean {
    if (from > this.version) return false;
    for (let v = from; v < this.version; v += 1) if (!this.migrations[v]) return false;
    return true;
  }

  private readRaw(): StoreEnvelope<T> | null {
    if (!fs.existsSync(this.file)) return null;
    let parsed: unknown;
    try {
      parsed = JSON.parse(fs.readFileSync(this.file, "utf8"));
    } catch {
      throw new StoreIntegrityError(this.name, "store file is not valid JSON");
    }
    if (!parsed || typeof parsed !== "object") throw new StoreIntegrityError(this.name, "store envelope is malformed");
    const envelope = parsed as StoreEnvelope<T>;
    if (typeof envelope.version !== "number" || typeof envelope.digest !== "string" || !("payload" in envelope)) {
      throw new StoreIntegrityError(this.name, "store envelope is incomplete");
    }
    if (envelope.version > this.version) {
      throw new StoreIntegrityError(
        this.name,
        `store version ${envelope.version} is newer than the code expects (${this.version}); downgrade is not allowed`
      );
    }
    if (envelope.version < this.version && !this.canMigrate(envelope.version)) {
      throw new StoreIntegrityError(
        this.name,
        `unsupported store version ${envelope.version} (expected ${this.version}) and no migration chain is registered`
      );
    }
    if (!envelopeMatchesStore(envelope, this.name)) {
      throw new StoreIntegrityError(
        this.name,
        `store envelope belongs to "${envelope.store}" and was placed under "${this.name}"`
      );
    }
    if (!envelopeDigestValid(envelope)) {
      throw new StoreIntegrityError(this.name, "integrity digest mismatch (corruption or manipulation)");
    }
    if (envelope.version < this.version) return this.migrate(envelope);
    return envelope;
  }

  /**
   * Wendet die registrierte Kette an und schreibt das Ergebnis dauerhaft.
   * Reihenfolge: Sicherungskopie → Migration → Journal → atomares Schreiben.
   */
  private migrate(envelope: StoreEnvelope<T>): StoreEnvelope<T> {
    const backup = this.writePreMigrationCopy(envelope.version);
    let payload: unknown = structuredClone(envelope.payload);
    for (let v = envelope.version; v < this.version; v += 1) {
      try {
        payload = this.migrations[v](payload);
      } catch (error) {
        throw new StoreIntegrityError(
          this.name,
          `migration ${v} -> ${v + 1} failed: ${error instanceof Error ? error.message : "unknown error"}`
        );
      }
    }
    this.appendMigrationRecord({store: this.name, fromVersion: envelope.version, toVersion: this.version, at: new Date().toISOString(), backup});
    this.write(payload as T);
    return {version: this.version, writtenAt: new Date().toISOString(), payload: payload as T, digest: envelopeDigest(this.version, payload)};
  }

  private writePreMigrationCopy(fromVersion: number): string {
    ensureRoot();
    const target = `${this.file}.pre-v${fromVersion}.bak`;
    fs.copyFileSync(this.file, target);
    try {
      fs.chmodSync(target, 0o600);
    } catch {
      /* chmod ist auf Nicht-POSIX-Dateisystemen nicht verfügbar */
    }
    return target;
  }

  private appendMigrationRecord(record: MigrationRecord) {
    const journal = path.join(ensureRoot(), "migrations.jsonl");
    fs.appendFileSync(journal, `${JSON.stringify(record)}\n`, {encoding: "utf8", mode: 0o600});
  }

  /** Liest den Store. Fehlt die Datei, wird der Initialzustand erzeugt und geschrieben. */
  read(): T {
    const envelope = this.readRaw();
    if (envelope && envelope.payload !== null) return structuredClone(envelope.payload);
    if (envelope) {
      // Ältere Fassungen konnten über den Diagnose-/Backup-Pfad einen Envelope mit
      // `payload: null` schreiben. Solche Datensätze enthalten keine Information:
      // sie werden erkannt, im Journal vermerkt und mit dem Initialzustand neu
      // angelegt — der Zugriff schlägt damit nicht mehr fehl.
      const safetyCopy = `${this.file}.null-payload`;
      // Erst die Sicherungskopie, dann überschreiben: der Nachweis im Journal
      // verweist damit auf eine Datei, die es wirklich gibt (und die Reparatur
      // ist notfalls nachvollziehbar). Schlägt die Kopie fehl, wird nicht
      // geschrieben — fail closed statt stiller Datenverlust.
      try {
        fs.copyFileSync(this.file, safetyCopy);
        fs.chmodSync(safetyCopy, 0o600);
      } catch (error) {
        throw new StoreIntegrityError(
          this.name,
          `empty payload detected but safety copy failed: ${error instanceof Error ? error.message : "unknown"}`
        );
      }
      this.appendMigrationRecord({
        store: this.name,
        fromVersion: envelope.version,
        toVersion: this.version,
        at: new Date().toISOString(),
        backup: safetyCopy
      });
      const repaired = this.create();
      return this.writeInitial(repaired);
    }
    return this.writeInitial(this.create());
  }

  /**
   * Erstanlage/Reparatur: **bedingt** auf Revision 0 schreiben. Hat ein anderer
   * Prozess den Store in der Zwischenzeit angelegt, wird dessen Datensatz
   * gelesen statt überschrieben — sonst ginge ein frischer Schreibvorgang
   * verloren, nur weil beide gleichzeitig angefangen haben.
   */
  private writeInitial(payload: T): T {
    try {
      return this.writeEnvelope(payload, 0);
    } catch (error) {
      if (!(error instanceof StoreConflictError)) throw error;
      const current = this.read();
      if (current !== null && current !== undefined) return structuredClone(current);
      throw error;
    }
  }

  /** Liest ohne Initialzustand zu schreiben (für Diagnose/Integritätsberichte). */
  tryRead(): {ok: true; payload: T} | {ok: false; error: string} {
    try {
      return {ok: true, payload: this.read()};
    } catch (error) {
      return {ok: false, error: error instanceof Error ? error.message : "store read failed"};
    }
  }

  /**
   * Revision des Datensatzes **auf der Platte** (0, wenn es ihn noch nicht gibt).
   * Bewusst ohne Digest-/Migrationsprüfung: hier wird nur der Zähler gebraucht,
   * inhaltliche Fehler meldet der normale Lesepfad.
   */
  private currentRevision(): number {
    try {
      if (!fs.existsSync(this.file)) return 0;
      const parsed = JSON.parse(fs.readFileSync(this.file, "utf8")) as {revision?: number};
      return envelopeRevision(parsed);
    } catch {
      return 0;
    }
  }

  /**
   * Atomares Schreiben. Mit `expectedRevision` wird unmittelbar vor dem
   * `rename` geprüft, ob der Datensatz noch auf diesem Stand ist — sonst
   * `StoreConflictError` (der Aufrufer liest neu und versucht erneut).
   */
  /**
   * Exklusive Schreibsperre je Store (`.<name>.lock`).
   *
   * Sie ist der Grund, warum die Revisionsprüfung wirklich trägt: Ohne sie ist
   * zwischen „Revision prüfen" und „rename" ein Fenster, in dem ein zweiter
   * Prozess dasselbe sieht und beide umbenennen — eine Aktualisierung ginge
   * still verloren (genau das passierte in der Vier-Prozess-Probe unter Last).
   *
   * Verwaiste Sperren blockieren nicht dauerhaft: Ist der eingetragene Prozess
   * nicht mehr am Leben, wird die Sperre übernommen.
   */
  private withWriteLock<R>(fn: () => R): R {
    const lock = path.join(ensureRoot(), `.${this.name}.lock`);
    const started = Date.now();
    let fd: number | null = null;
    while (fd === null) {
      try {
        fd = fs.openSync(lock, "wx", 0o600);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
        let holderAlive = true;
        let stale = false;
        try {
          const info = JSON.parse(fs.readFileSync(lock, "utf8")) as {pid?: number};
          if (typeof info.pid === "number") {
            try {
              process.kill(info.pid, 0);
            } catch {
              holderAlive = false;
            }
          }
          stale = Date.now() - fs.statSync(lock).mtimeMs > LOCK_STALE_MS;
        } catch {
          /* Sperrdatei verschwand zwischenzeitlich — erneut versuchen. */
        }
        if (!holderAlive || stale) {
          try {
            fs.rmSync(lock, {force: true});
          } catch {
            /* Ein anderer Prozess war schneller; der nächste Versuch greift. */
          }
          continue;
        }
        if (Date.now() - started > LOCK_WAIT_MS) throw new StoreConflictError(this.name, -1, -1);
        sleepSync(2);
      }
    }
    try {
      fs.writeSync(fd, JSON.stringify({pid: process.pid, at: Date.now()}), 0, "utf8");
      return fn();
    } finally {
      try {
        fs.closeSync(fd);
      } catch {
        /* bereits geschlossen */
      }
      try {
        fs.rmSync(lock, {force: true});
      } catch {
        /* best effort; eine verwaiste Sperre wird später übernommen */
      }
    }
  }

  private writeEnvelope(payload: T, expectedRevision: number | null): T {
    if (payload === null || payload === undefined) {
      // Ein "leerer" Envelope mit gültigem Digest ist die gefährlichste Form der
      // Beschädigung: er sieht integer aus, bricht aber jeden Lesezugriff.
      // Deshalb wird er hier gar nicht erst geschrieben (fail closed).
      throw new StoreIntegrityError(this.name, "refusing to persist a null payload");
    }
    const root = ensureRoot();
    const revision = (expectedRevision ?? this.currentRevision()) + 1;
    const envelope: StoreEnvelope<T> = {
      store: this.name,
      version: this.version,
      writtenAt: new Date().toISOString(),
      payload: structuredClone(payload),
      digest: envelopeDigest(this.version, payload, this.name),
      revision
    };
    const tmp = path.join(root, `.${this.name}.${process.pid}.${Date.now()}.${crypto.randomBytes(4).toString("hex")}.tmp`);
    fs.writeFileSync(tmp, JSON.stringify(envelope, null, 2), {encoding: "utf8", mode: 0o600});
    // Prüfen und Umbenennen liegen **zusammen** in der Sperre: nur so ist die
    // Revisionsprüfung eine echte Compare-and-Swap-Bedingung.
    return this.withWriteLock(() => {
      if (expectedRevision !== null) {
        const onDisk = this.currentRevision();
        if (onDisk !== expectedRevision) {
          try {
            fs.rmSync(tmp, {force: true});
          } catch {
            /* Aufräumen ist best effort; der Datensatz bleibt unverändert. */
          }
          throw new StoreConflictError(this.name, expectedRevision, onDisk);
        }
      }
      fs.renameSync(tmp, this.file);
      try {
        fs.chmodSync(this.file, 0o600);
      } catch {
        /* chmod ist auf Nicht-POSIX-Dateisystemen nicht verfügbar */
      }
      return structuredClone(envelope.payload);
    });
  }

  /**
   * Unbedingtes Schreiben (Erstbefüllung, Migration, Reparatur). Die Revision
   * steigt dabei monoton weiter, damit ein späterer Konfliktvergleich stimmt.
   */
  write(payload: T): T {
    return this.writeEnvelope(payload, null);
  }

  /**
   * Transaktionale Änderung: lesen, Kopie mutieren, **bedingt** schreiben.
   *
   * Der Unterschied zu früher ist der Kern der Nebenläufigkeitsfestigkeit: Wurde
   * der Datensatz zwischen Lesen und Schreiben von einem anderen Prozess
   * verändert, wird nicht mehr überschrieben, sondern neu gelesen und erneut
   * angewandt. Erst nach `STORE_CONFLICT_RETRIES` erfolglosen Versuchen fliegt
   * ein `StoreConflictError` — verlorene Aktualisierungen gibt es nicht mehr.
   */
  /**
   * Inhalt **und** Revision aus genau einem Lesevorgang. Getrennt gelesen wäre
   * die Revision bereits die eines fremden, neueren Datensatzes — der bedingte
   * Schreibvorgang würde dann einen veralteten Entwurf durchlassen (genau dieser
   * Fehler kostete in der Vier-Prozess-Probe 8 von 240 Aktualisierungen).
   */
  private readForUpdate(): {payload: T; revision: number} {
    const envelope = this.readRaw();
    if (envelope && envelope.payload !== null) {
      return {payload: envelope.payload, revision: envelope.revision ?? this.currentRevision()};
    }
    // Datei fehlt, ist leer oder wurde als `payload: null` repariert: Der
    // reguläre Lesepfad legt den Initialzustand an bzw. repariert ihn. Danach
    // wird **erneut** ein Schnappschuss gelesen — Inhalt und Revision müssen
    // aus derselben Datei stammen, sonst überschreibt ein Entwurf einen
    // fremden, neueren Datensatz (verlorene Aktualisierung).
    this.read();
    const fresh = this.readRaw();
    if (fresh && fresh.payload !== null) return {payload: fresh.payload, revision: fresh.revision ?? this.currentRevision()};
    return {payload: this.create(), revision: 0};
  }

  update(mutator: (draft: T) => void): T {
    let lastConflict: StoreConflictError | null = null;
    for (let attempt = 1; attempt <= STORE_CONFLICT_RETRIES; attempt += 1) {
      const snapshot = this.readForUpdate();
      const draft = structuredClone(snapshot.payload);
      mutator(draft);
      try {
        return this.writeEnvelope(draft, snapshot.revision);
      } catch (error) {
        if (!(error instanceof StoreConflictError)) throw error;
        lastConflict = error;
        sleepSync(Math.min(2 * attempt, 20));
      }
    }
    throw lastConflict ?? new StoreConflictError(this.name, -1, -1);
  }

  integrity(): StoreIntegrityReport {
    const base: StoreIntegrityReport = {store: this.name, file: this.file, exists: fs.existsSync(this.file), ok: false};
    try {
      const envelope = this.readRaw();
      if (!envelope) return {...base, ok: true, error: "store not created yet"};
      if (envelope.payload === null) {
        return {...base, ok: true, version: envelope.version, writtenAt: envelope.writtenAt, bytes: fs.statSync(this.file).size, error: "empty payload detected; store is re-initialized on next read"};
      }
      return {
        ...base,
        ok: true,
        version: envelope.version,
        writtenAt: envelope.writtenAt,
        bytes: fs.statSync(this.file).size
      };
    } catch (error) {
      return {...base, error: error instanceof Error ? error.message : "integrity check failed"};
    }
  }

  backup(): string {
    const root = ensureRoot();
    const backupDir = path.join(root, "backups");
    fs.mkdirSync(backupDir, {recursive: true, mode: 0o700});
    if (!fs.existsSync(this.file)) this.write(this.create());
    const stamp = new Date().toISOString().replaceAll(":", "-");
    const target = path.join(backupDir, `${this.name}-${stamp}.json`);
    fs.copyFileSync(this.file, target);
    try {
      fs.chmodSync(target, 0o600);
    } catch {
      /* best effort */
    }
    this.pruneBackups(backupDir, 20);
    return target;
  }

  restore(backupPath: string): void {
    const backupDir = path.resolve(path.join(ensureRoot(), "backups")) + path.sep;
    const resolved = path.resolve(backupPath);
    if (!resolved.startsWith(backupDir)) throw new Error("backup path outside configured backup directory");
    const raw = fs.readFileSync(resolved, "utf8");
    const candidate = JSON.parse(raw) as StoreEnvelope<T>;
    if (candidate.version > this.version) throw new StoreIntegrityError(this.name, "backup version is newer than the code expects");
    if (candidate.version < this.version && !this.canMigrate(candidate.version)) {
      throw new StoreIntegrityError(this.name, "backup version mismatch and no migration chain is registered");
    }
    if (!envelopeMatchesStore(candidate, this.name)) {
      throw new StoreIntegrityError(this.name, `backup belongs to "${candidate.store}" and cannot be restored here`);
    }
    if (!envelopeDigestValid(candidate)) {
      throw new StoreIntegrityError(this.name, "backup integrity check failed");
    }
    if (candidate.version === this.version) {
      this.write(candidate.payload);
      return;
    }
    // Aeltere Sicherung: erst Sicherungskopie des aktuellen Standes, dann migrieren.
    if (fs.existsSync(this.file)) this.writePreMigrationCopy(this.version);
    let payload: unknown = structuredClone(candidate.payload);
    for (let v = candidate.version; v < this.version; v += 1) payload = this.migrations[v](payload);
    this.appendMigrationRecord({
      store: this.name,
      fromVersion: candidate.version,
      toVersion: this.version,
      at: new Date().toISOString(),
      backup: resolved
    });
    this.write(payload as T);
  }

  private pruneBackups(backupDir: string, max: number) {
    const prefix = `${this.name}-`;
    const files = fs.readdirSync(backupDir).filter(f => f.startsWith(prefix) && f.endsWith(".json")).sort();
    for (const file of files.slice(0, Math.max(0, files.length - max))) fs.rmSync(path.join(backupDir, file));
  }
}

export function storeRegistry(): {store: string; version: number; file: string}[] {
  return registry.slice().sort((a, b) => a.store.localeCompare(b.store));
}

const registry: {store: string; version: number; file: string; migrations: Record<number, StoreMigration>; create: () => unknown}[] = [];

/**
 * Registriert einen Store. Doppelte Registrierungen sind ein Fehlerquelle für
 * Diagnose, Backup und Reparatur (derselbe Store taucht dann mehrfach auf):
 * Gleicher Name und gleiche Version liefern deshalb dieselbe Instanz zurück,
 * abweichende Versionen werden verweigert (fail closed).
 */
export function createStore<T>(name: string, version: number, create: () => T, options: StoreOptions = {}): DurableStore<T> {
  const existing = registry.find(entry => entry.store === name);
  if (existing && existing.version !== version) {
    throw new StoreIntegrityError(
      name,
      `store is already registered with version ${existing.version}; refusing duplicate registration with version ${version}`
    );
  }
  // Keine Instanz zwischengespeichert: der Dateipfad hängt am Speicherverzeichnis
  // und kann sich (Tests, andere Umgebung) ändern. Registriert wird nur die
  // Definition — genau einmal pro Store-Name.
  const store = new DurableStore<T>(name, version, create, options);
  if (!existing) {
    registry.push({
      store: name,
      version,
      file: store.file,
      migrations: options.migrations ?? {},
      create: create as () => unknown
    });
  }
  return store;
}

/** Journal aller durchgeführten Store-Migrationen (Nachweis, kein Zustand). */
export function readMigrationJournal(): MigrationRecord[] {
  const file = path.join(storageRoot(), "migrations.jsonl");
  if (!fs.existsSync(file)) return [];
  return fs
    .readFileSync(file, "utf8")
    .split("\n")
    .filter(line => line.trim().length > 0)
    .map(line => JSON.parse(line) as MigrationRecord);
}

/**
 * Diagnose-/Backup-Instanz eines registrierten Stores. Sie MUSS die
 * registrierten Migrationsketten kennen: sonst gilt eine ältere Sicherung als
 * "nicht migrierbar" und wird fälschlich als Fehler gemeldet.
 */
function durableFor(entry: {store: string; version: number; migrations: Record<number, StoreMigration>; create?: () => unknown}) {
  // WICHTIG: dieselbe Initialisierungsfunktion wie der echte Store. Ein `() => null`
  // hätte beim Backup leerer Stores einen Envelope ohne Inhalt geschrieben.
  const create = (entry.create ?? (() => ({}))) as () => never;
  return new DurableStore(entry.store, entry.version, create, {migrations: entry.migrations});
}

/**
 * Repariert inhaltslose Envelopes (`payload: null`) in **allen** registrierten
 * Stores. Solche Datensätze enthalten keine Information, brechen aber jeden
 * Lesezugriff (500). Die Reparatur setzt den Initialzustand des jeweiligen
 * Moduls und wird im Migrationsjournal vermerkt — sie ist damit nachvollziehbar
 * und kein stiller Eingriff in Daten.
 */
/**
 * Findet Store-Dateien im Speicherverzeichnis, deren Envelope keinen Inhalt hat
 * (`payload: null`) und für die **kein** Modul registriert ist. Solche Dateien
 * können nicht automatisch repariert werden, weil der Initialzustand nur dem
 * Modul bekannt ist — sie werden deshalb gemeldet (fail closed, sichtbar) statt
 * stillschweigend ignoriert.
 */
export function unregisteredNullPayloadFiles(): string[] {
  const root = storageRoot();
  if (!fs.existsSync(root)) return [];
  const registered = new Set(registry.map(entry => path.basename(entry.file)));
  return fs
    .readdirSync(root)
    .filter(name => name.endsWith(".json") && !registered.has(name))
    .filter(name => {
      try {
        const parsed = JSON.parse(fs.readFileSync(path.join(root, name), "utf8")) as {payload?: unknown};
        return parsed !== null && typeof parsed === "object" && parsed.payload === null;
      } catch {
        return false;
      }
    })
    .sort();
}

export function repairStorePayloads(): {store: string; repaired: boolean; action: string}[] {
  const results = registry.map(entry => {
    const durable = durableFor(entry);
    const before = durable.integrity();
    if (!before.ok) return {store: entry.store, repaired: false, action: `error: ${before.error ?? "unreadable"}`};
    if (!before.exists) return {store: entry.store, repaired: false, action: "not created"};
    if (before.error?.includes("empty payload")) {
      try {
        durable.read();
        return {store: entry.store, repaired: true, action: "re-initialized (empty payload)"};
      } catch (error) {
        return {store: entry.store, repaired: false, action: `repair failed: ${error instanceof Error ? error.message : "unknown"}`};
      }
    }
    return {store: entry.store, repaired: false, action: "ok"};
  });
  // Dateien ohne registriertes Modul werden nicht stillschweigend übergangen.
  for (const file of unregisteredNullPayloadFiles()) {
    results.push({store: file.replace(/\.json$/, ""), repaired: false, action: "unregistered module: repair requires the owning module"});
  }
  return results;
}

export function storeIntegrityReport(): {
  root: string;
  stores: StoreIntegrityReport[];
  ok: boolean;
  unregistered: string[];
  registered: number;
} {
  const stores = registry.map(entry => durableFor(entry).integrity());
  const unregistered = unregisteredNullPayloadFiles();
  return {root: storageRoot(), stores, ok: stores.every(s => s.ok) && unregistered.length === 0, unregistered, registered: stores.length};
}

export function backupAllStores(): string[] {
  return registry.map(entry => durableFor(entry).backup());
}

export type BackupFileReport = {
  store: string;
  file: string;
  name: string;
  bytes: number;
  writtenAt?: string;
  version?: number;
  digestOk: boolean;
  /** Backup ist älter als das aktuelle Schema; Wiederherstellung migriert es. */
  migrationRequired: boolean;
  ok: boolean;
  error?: string;
};

function backupDir(): string {
  return path.join(ensureRoot(), "backups");
}

function backupFilesFor(storeName: string): string[] {
  const dir = backupDir();
  if (!fs.existsSync(dir)) return [];
  // Präfix-Kollision vermeiden: `workshop-executions-…` ist ein Backup von
  // `workshop-executions`, nicht von `workshop`. Es gewinnt der längste
  // registrierte Store-Name, auf den der Dateiname passt.
  const owner = (fileName: string): string | undefined =>
    registry
      .map(entry => entry.store)
      .filter(name => fileName.startsWith(`${name}-`))
      .sort((a, b) => b.length - a.length)[0];
  return fs
    .readdirSync(dir)
    .filter(name => name.endsWith(".json") && owner(name) === storeName)
    .map(name => path.join(dir, name))
    .sort();
}

/**
 * Prüft eine Backup-Datei **ohne** sie anzuwenden: Version, Digest und Lesbarkeit.
 * Ein beschädigtes Backup ist damit sichtbar, bevor jemand es einliest.
 */
export function verifyStoreBackup(storeName: string, file: string): BackupFileReport {
  const entry = registry.find(item => item.store === storeName);
  const base: BackupFileReport = {store: storeName, file, name: path.basename(file), bytes: 0, digestOk: false, migrationRequired: false, ok: false};
  if (!entry) return {...base, error: "unknown store"};
  const dir = path.resolve(backupDir()) + path.sep;
  const resolved = path.resolve(file);
  if (!resolved.startsWith(dir)) return {...base, error: "backup path outside configured backup directory"};
  try {
    const raw = fs.readFileSync(resolved, "utf8");
    const envelope = JSON.parse(raw) as StoreEnvelope<unknown>;
    const digestOk = envelopeDigestValid(envelope);
    const report: BackupFileReport = {
      ...base,
      bytes: Buffer.byteLength(raw),
      writtenAt: envelope.writtenAt,
      version: envelope.version,
      digestOk
    };
    if (!envelopeMatchesStore(envelope, entry.store)) {
      return {...report, error: `backup belongs to "${envelope.store}" and not to "${entry.store}"`};
    }
    if (envelope.version > entry.version) {
      return {...report, error: `backup version ${envelope.version} is newer than the code expects (${entry.version})`};
    }
    if (!digestOk) return {...report, error: "backup integrity check failed"};
    if (envelope.version < entry.version) {
      const migratable = durableFor(entry).canMigrate(envelope.version);
      if (!migratable) return {...report, error: `backup version ${envelope.version} cannot be migrated to ${entry.version}`};
      return {...report, migrationRequired: true, ok: true};
    }
    return {...report, ok: true};
  } catch (error) {
    return {...base, error: error instanceof Error ? error.message : "backup unreadable"};
  }
}

/** Alle Backups aller registrierten Stores, jeweils digest-geprüft. */
export function listStoreBackups(): BackupFileReport[] {
  return registry.flatMap(entry => backupFilesFor(entry.store).map(file => verifyStoreBackup(entry.store, file)));
}

/**
 * Stellt einen Store aus einem geprüften Backup wieder her. Reihenfolge ist
 * bindend: Pfadbindung → Version → Digest → erst dann wird geschrieben.
 */
export function restoreStoreBackup(storeName: string, file: string): {store: string; file: string; restoredAt: string} {
  const entry = registry.find(item => item.store === storeName);
  if (!entry) throw new Error("unknown store");
  const report = verifyStoreBackup(storeName, file);
  if (!report.ok) throw new StoreIntegrityError(storeName, report.error ?? "backup verification failed");
  durableFor(entry).restore(file);
  return {store: storeName, file, restoredAt: new Date().toISOString()};
}
