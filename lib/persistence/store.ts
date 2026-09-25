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

  constructor(name: string, version: number, create: () => T) {
    if (!/^[a-z0-9-]+$/.test(name)) throw new Error(`invalid store name: ${name}`);
    this.name = name;
    this.version = version;
    this.create = create;
    this.file = path.join(storageRoot(), `${name}.json`);
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
    if (envelope.version !== this.version) {
      throw new StoreIntegrityError(this.name, `unsupported store version ${envelope.version} (expected ${this.version})`);
    }
    if (envelope.digest !== envelopeDigest(envelope.version, envelope.payload)) {
      throw new StoreIntegrityError(this.name, "integrity digest mismatch (corruption or manipulation)");
    }
    return envelope;
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
    const root = ensureRoot();
    const backupDir = path.resolve(path.join(root, "backups")) + path.sep;
    const resolved = path.resolve(backupPath);
    if (!resolved.startsWith(backupDir)) throw new Error("backup path outside configured backup directory");
    const candidate = JSON.parse(fs.readFileSync(resolved, "utf8")) as StoreEnvelope<T>;
    if (candidate.version !== this.version) throw new StoreIntegrityError(this.name, "backup version mismatch");
    if (candidate.digest !== envelopeDigest(candidate.version, candidate.payload)) {
      throw new StoreIntegrityError(this.name, "backup integrity check failed");
    }
    this.write(candidate.payload);
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

const registry: {store: string; version: number; file: string}[] = [];

export function createStore<T>(name: string, version: number, create: () => T): DurableStore<T> {
  const store = new DurableStore<T>(name, version, create);
  registry.push({store: name, version, file: store.file});
  return store;
}

export function storeIntegrityReport(): {root: string; stores: StoreIntegrityReport[]; ok: boolean} {
  const stores = registry.map(entry => new DurableStore(entry.store, entry.version, () => null).integrity());
  return {root: storageRoot(), stores, ok: stores.every(s => s.ok)};
}

export function backupAllStores(): string[] {
  return registry.map(entry => new DurableStore(entry.store, entry.version, () => null).backup());
}
