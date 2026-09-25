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

export type StoreEnvelope<T> = {version: number; writtenAt: string; payload: T; digest: string};

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

function envelopeDigest(version: number, payload: unknown): string {
  return domainDigest({version, payload});
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
    if (envelope.digest !== envelopeDigest(envelope.version, envelope.payload)) {
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
    if (envelope) return structuredClone(envelope.payload);
    const initial = this.create();
    this.write(initial);
    return structuredClone(initial);
  }

  /** Liest ohne Initialzustand zu schreiben (für Diagnose/Integritätsberichte). */
  tryRead(): {ok: true; payload: T} | {ok: false; error: string} {
    try {
      return {ok: true, payload: this.read()};
    } catch (error) {
      return {ok: false, error: error instanceof Error ? error.message : "store read failed"};
    }
  }

  write(payload: T): T {
    const root = ensureRoot();
    const envelope: StoreEnvelope<T> = {
      version: this.version,
      writtenAt: new Date().toISOString(),
      payload: structuredClone(payload),
      digest: envelopeDigest(this.version, payload)
    };
    const tmp = path.join(root, `.${this.name}.${process.pid}.${Date.now()}.${crypto.randomBytes(4).toString("hex")}.tmp`);
    fs.writeFileSync(tmp, JSON.stringify(envelope, null, 2), {encoding: "utf8", mode: 0o600});
    fs.renameSync(tmp, this.file);
    try {
      fs.chmodSync(this.file, 0o600);
    } catch {
      /* chmod ist auf Nicht-POSIX-Dateisystemen nicht verfügbar */
    }
    return structuredClone(envelope.payload);
  }

  /** Transaktionale Änderung: liest, mutiert eine Kopie, schreibt atomar zurück. */
  update(mutator: (draft: T) => void): T {
    const draft = this.read();
    mutator(draft);
    return this.write(draft);
  }

  integrity(): StoreIntegrityReport {
    const base: StoreIntegrityReport = {store: this.name, file: this.file, exists: fs.existsSync(this.file), ok: false};
    try {
      const envelope = this.readRaw();
      if (!envelope) return {...base, ok: true, error: "store not created yet"};
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
    if (candidate.digest !== envelopeDigest(candidate.version, candidate.payload)) {
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

const registry: {store: string; version: number; file: string; migrations: Record<number, StoreMigration>}[] = [];

export function createStore<T>(name: string, version: number, create: () => T, options: StoreOptions = {}): DurableStore<T> {
  const store = new DurableStore<T>(name, version, create, options);
  registry.push({store: name, version, file: store.file, migrations: options.migrations ?? {}});
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
function durableFor(entry: {store: string; version: number; migrations: Record<number, StoreMigration>}) {
  return new DurableStore(entry.store, entry.version, () => null, {migrations: entry.migrations});
}

export function storeIntegrityReport(): {root: string; stores: StoreIntegrityReport[]; ok: boolean} {
  const stores = registry.map(entry => durableFor(entry).integrity());
  return {root: storageRoot(), stores, ok: stores.every(s => s.ok)};
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
  return fs
    .readdirSync(dir)
    .filter(name => name.startsWith(`${storeName}-`) && name.endsWith(".json"))
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
    const digestOk = envelope.digest === envelopeDigest(envelope.version, envelope.payload);
    const report: BackupFileReport = {
      ...base,
      bytes: Buffer.byteLength(raw),
      writtenAt: envelope.writtenAt,
      version: envelope.version,
      digestOk
    };
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
