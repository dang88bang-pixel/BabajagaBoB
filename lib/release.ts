import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import {storageRoot} from "./persistence/store";

/**
 * Release-Slots (Abschnitt 24 / Deployment).
 *
 * Ein Release ist eine **echte Kopie** des auslieferbaren Standes auf der
 * Festplatte: `<releaseRoot>/REL-…` enthält das gebaute Next-Verzeichnis
 * (`.next` ohne Cache), `public`, `scripts` (die Kernel-Isolation ruft
 * `scripts/ns-exec.sh` relativ zum Arbeitsverzeichnis auf), `package.json` und
 * die Next-Konfiguration. `node_modules` wird geteilt (Symlink auf die
 * Installation des Quellstandes) — das ist eine bewusste, dokumentierte
 * Entscheidung: Es gibt in dieser Umgebung keinen Paket-Proxy, ein zweiter
 * Installationslauf wäre nicht reproduzierbar.
 *
 * Der Digest wird über **jede** Datei des Slots gebildet (Pfad, Größe, Inhalt).
 * Damit ist ein Release nachträglich prüfbar: `verifyRelease()` erkennt jede
 * Änderung an einer ausgelieferten Datei, und das Deployment verweigert den
 * Rollout, wenn der Digest nicht zum Manifest passt.
 *
 * `current` ist ein Symlink auf den aktiven Slot. Umgeschaltet wird atomar über
 * einen temporären Symlink und `rename` — ein abgebrochener Vorgang kann keinen
 * halben Zustand hinterlassen.
 */

export type ReleaseManifest = {
  releaseId: string;
  label: string;
  buildId: string;
  digest: string;
  files: number;
  bytes: number;
  createdAt: string;
  /** Verzeichnis, aus dem der Slot erzeugt wurde (Nachvollziehbarkeit). */
  source: string;
  /** Geteilte Abhängigkeiten (Symlink) — dokumentierte Grenze dieser Umgebung. */
  nodeModules: "LINKED" | "ABSENT";
  included: string[];
  excluded: string[];
};

export type ReleaseState = "READY" | "ACTIVE" | "PREVIOUS" | "DEFECTIVE";

/** Elemente, die ein lauffähiges Release enthalten muss. */
const RUNTIME_PATHS = [".next", "public", "scripts", "package.json", "next.config.ts", "next.config.js", "next.config.mjs"];
/** Immer ausgeschlossen: Cache und Quellhistorie (nicht laufzeitrelevant). */
const EXCLUDED = [".next/cache", ".git", ".bob-data", "reports", "coverage", "release.json"];

export class ReleaseError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = "ReleaseError";
    this.code = code;
  }
}

export function releaseRoot(): string {
  return process.env.BOB_RELEASE_DIR ?? path.join(storageRoot(), "releases");
}

export function releasePath(releaseId: string): string {
  if (!/^REL-[A-Za-z0-9-]{4,40}$/.test(releaseId)) throw new ReleaseError("INVALID_RELEASE_ID", "release id must look like REL-…");
  return path.join(releaseRoot(), releaseId);
}

export function currentLink(): string {
  return path.join(releaseRoot(), "current");
}

function isExcluded(relative: string): boolean {
  return EXCLUDED.some(entry => relative === entry || relative.startsWith(`${entry}${path.sep}`));
}

function walk(root: string, relative = ""): string[] {
  const absolute = path.join(root, relative);
  const entries = fs.readdirSync(absolute, {withFileTypes: true});
  const files: string[] = [];
  for (const entry of entries) {
    const next = relative ? path.join(relative, entry.name) : entry.name;
    if (isExcluded(next)) continue;
    if (entry.isDirectory()) files.push(...walk(root, next));
    else if (entry.isFile()) files.push(next);
    else if (entry.isSymbolicLink()) files.push(next);
  }
  return files;
}

/** Digest über den gesamten Slot: Reihenfolge, Pfade, Größen und Inhalte. */
export function digestDirectory(root: string): {digest: string; files: number; bytes: number} {
  const hash = crypto.createHash("sha256");
  const files = walk(root).sort();
  let bytes = 0;
  for (const file of files) {
    const absolute = path.join(root, file);
    const stat = fs.lstatSync(absolute);
    hash.update(file);
    hash.update("\0");
    if (stat.isSymbolicLink()) {
      hash.update("LINK:");
      hash.update(fs.readlinkSync(absolute));
    } else {
      const content = fs.readFileSync(absolute);
      bytes += content.byteLength;
      hash.update(String(content.byteLength));
      hash.update("\0");
      hash.update(content);
    }
    hash.update("\n");
  }
  hash.update(`files:${files.length}`);
  return {digest: hash.digest("hex"), files: files.length, bytes};
}

export function readManifest(releaseId: string): ReleaseManifest {
  const file = path.join(releasePath(releaseId), "release.json");
  if (!fs.existsSync(file)) throw new ReleaseError("RELEASE_NOT_FOUND", `release ${releaseId} not found`);
  return JSON.parse(fs.readFileSync(file, "utf8")) as ReleaseManifest;
}

export function listReleaseIds(): string[] {
  if (!fs.existsSync(releaseRoot())) return [];
  return fs
    .readdirSync(releaseRoot(), {withFileTypes: true})
    .filter(entry => entry.isDirectory() && entry.name.startsWith("REL-"))
    .map(entry => entry.name)
    .sort();
}

export function listReleases(): {manifest: ReleaseManifest; state: ReleaseState}[] {
  const current = currentReleaseId();
  return listReleaseIds().map(releaseId => {
    const manifest = readManifest(releaseId);
    const verified = verifyRelease(releaseId);
    const state: ReleaseState = !verified.ok ? "DEFECTIVE" : releaseId === current ? "ACTIVE" : "READY";
    return {manifest, state};
  });
}

export function currentReleaseId(): string | null {
  const link = currentLink();
  try {
    const target = fs.readlinkSync(link);
    const name = path.basename(target);
    return name.startsWith("REL-") ? name : null;
  } catch {
    return null;
  }
}

/** Erzeugt einen neuen Slot aus einem gebauten Stand. */
export function prepareRelease(input: {source: string; label: string}): ReleaseManifest {
  const source = path.resolve(input.source);
  if (!fs.existsSync(source)) throw new ReleaseError("SOURCE_MISSING", `source ${source} does not exist`);
  const buildIdFile = path.join(source, ".next", "BUILD_ID");
  if (!fs.existsSync(buildIdFile)) throw new ReleaseError("BUILD_MISSING", `no built application at ${source}/.next (BUILD_ID missing)`);
  const buildId = fs.readFileSync(buildIdFile, "utf8").trim();
  if (!buildId) throw new ReleaseError("BUILD_MISSING", "empty BUILD_ID");

  fs.mkdirSync(releaseRoot(), {recursive: true, mode: 0o700});
  const releaseId = `REL-${new Date().toISOString().replace(/[-:.TZ]/g, "").slice(0, 14)}-${crypto.randomBytes(2).toString("hex")}`;
  const target = releasePath(releaseId);
  fs.mkdirSync(target, {recursive: false, mode: 0o700});

  const included: string[] = [];
  for (const entry of RUNTIME_PATHS) {
    const from = path.join(source, entry);
    if (!fs.existsSync(from)) continue;
    const to = path.join(target, entry);
    fs.cpSync(from, to, {recursive: true, filter: origin => !isExcluded(path.relative(source, origin))});
    included.push(entry);
  }
  if (included.length === 0) {
    fs.rmSync(target, {recursive: true, force: true});
    throw new ReleaseError("NOTHING_TO_RELEASE", "no runtime files found");
  }
  const modules = path.join(source, "node_modules");
  const nodeModules: ReleaseManifest["nodeModules"] = fs.existsSync(modules) ? "LINKED" : "ABSENT";
  if (nodeModules === "LINKED") fs.symlinkSync(fs.realpathSync(modules), path.join(target, "node_modules"), "dir");

  const {digest, files, bytes} = digestDirectory(target);
  const manifest: ReleaseManifest = {
    releaseId,
    label: input.label,
    buildId,
    digest,
    files,
    bytes,
    createdAt: new Date().toISOString(),
    source,
    nodeModules,
    included,
    excluded: EXCLUDED
  };
  // `release.json` ist Teil des Slots, darf aber den Digest nicht verändern:
  // Er wird vor dem Schreiben berechnet und danach erneut geprüft (ohne die Datei).
  fs.writeFileSync(path.join(target, "release.json"), `${JSON.stringify(manifest, null, 2)}\n`, {mode: 0o600});
  const recomputed = digestDirectory(target);
  if (recomputed.digest !== digest) {
    // Nur möglich, wenn sich der Slot während des Kopierens geändert hat.
    fs.rmSync(target, {recursive: true, force: true});
    throw new ReleaseError("UNSTABLE_SOURCE", "release digest changed while preparing; retry");
  }
  return manifest;
}

/** Prüft die Unversehrtheit eines Slots gegen sein Manifest. */
export function verifyRelease(releaseId: string): {ok: boolean; digest: string; expected: string; detail: string} {
  const manifest = readManifest(releaseId);
  const {digest, files} = digestDirectory(releasePath(releaseId));
  if (files !== manifest.files) return {ok: false, digest, expected: manifest.digest, detail: `file count ${files} != ${manifest.files}`};
  if (digest !== manifest.digest) return {ok: false, digest, expected: manifest.digest, detail: "release digest changed (tampering or partial copy)"};
  return {ok: true, digest, expected: manifest.digest, detail: "digest matches manifest"};
}

/** Atomarer Wechsel des `current`-Zeigers. */
export function setCurrentRelease(releaseId: string): {previous: string | null; current: string} {
  const target = releasePath(releaseId);
  if (!fs.existsSync(target)) throw new ReleaseError("RELEASE_NOT_FOUND", `release ${releaseId} not found`);
  const previous = currentReleaseId();
  fs.mkdirSync(releaseRoot(), {recursive: true, mode: 0o700});
  const temporary = path.join(releaseRoot(), `.current-${crypto.randomBytes(4).toString("hex")}`);
  fs.symlinkSync(target, temporary, "dir");
  fs.renameSync(temporary, currentLink());
  return {previous, current: releaseId};
}

/**
 * Build-ID des **laufenden** Prozesses. Das ist die einzige ehrliche Quelle:
 * Ein Deployment ist erst dann `ACTIVE`, wenn der Server diese ID ausliefert —
 * ein umgestellter Zeiger allein ist noch kein ausgerollter Stand.
 */
export function runningBuildId(): {buildId: string | null; cwd: string; releaseId: string | null; reason?: string} {
  const cwd = process.cwd();
  // Wurde der Prozess aus einem Release-Slot gestartet, ist das der Name des
  // Arbeitsverzeichnisses (Symlinks werden von `getcwd` aufgelöst).
  const candidate = path.basename(cwd);
  const releaseId = /^REL-[A-Za-z0-9-]{4,40}$/.test(candidate) ? candidate : null;
  const file = path.join(cwd, ".next", "BUILD_ID");
  if (!fs.existsSync(file)) return {buildId: null, cwd, releaseId, reason: "no .next/BUILD_ID in the running working directory"};
  const buildId = fs.readFileSync(file, "utf8").trim();
  return buildId ? {buildId, cwd, releaseId} : {buildId: null, cwd, releaseId, reason: "empty BUILD_ID"};
}

/** Entfernt alte Slots — nie den aktiven und nie den vorherigen (Rollback-Pfad). */
export function pruneReleases(keep: number, protectedIds: string[] = []): string[] {
  const current = currentReleaseId();
  const keepIds = new Set([...(current ? [current] : []), ...protectedIds]);
  const candidates = listReleaseIds().filter(id => !keepIds.has(id));
  const remove = candidates.slice(0, Math.max(0, candidates.length - Math.max(0, keep)));
  for (const releaseId of remove) fs.rmSync(releasePath(releaseId), {recursive: true, force: true});
  return remove;
}
