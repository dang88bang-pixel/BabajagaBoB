import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import {createStore, storageRoot} from "./persistence/store";
import {observe} from "./observability";

export type OfflineAssetKind = "PACKAGE" | "MODEL" | "DOCUMENTATION" | "GIT" | "CONTAINER" | "SDK" | "COMPILER" | "DATASET";
export type OfflineAsset = {
  id: string;
  kind: OfflineAssetKind;
  name: string;
  relativePath: string;
  digest: string;
  sizeBytes: number;
  registeredAt: string;
};
export type OfflineAssetPin = {assetId: string; kind: OfflineAssetKind; name: string; digest: string; sizeBytes: number};
export type StagedOfflineAsset = OfflineAssetPin & {workspacePath: string};

type Payload = {assets: OfflineAsset[]};
const store = createStore<Payload>("offline-assets", 1, () => ({assets: []}));
const ASSET_KINDS: readonly OfflineAssetKind[] = ["PACKAGE", "MODEL", "DOCUMENTATION", "GIT", "CONTAINER", "SDK", "COMPILER", "DATASET"];
export const MAX_OFFLINE_ASSET_BYTES = 20 * 1024 * 1024 * 1024;
export const MAX_STAGED_OFFLINE_ASSET_BYTES = 4 * 1024 * 1024 * 1024;
const HASH_CHUNK_BYTES = 1024 * 1024;

function assetRoot(): string {
  const configured = process.env.BOB_OFFLINE_ASSET_DIR;
  if (configured && !path.isAbsolute(configured)) throw new Error("BOB_OFFLINE_ASSET_DIR must be an absolute path");
  const root = path.resolve(configured ?? path.join(storageRoot(), "offline-assets"));
  fs.mkdirSync(root, {recursive: true, mode: 0o700});
  const stat = fs.lstatSync(root);
  if (stat.isSymbolicLink() || !stat.isDirectory()) throw new Error("offline asset root must be a regular directory, not a symlink");
  return fs.realpathSync(root);
}

function resolveAssetPath(relativePath: string): {root: string; fullPath: string} {
  if (typeof relativePath !== "string" || relativePath.length === 0 || relativePath.length > 512 || relativePath.includes("\0") || relativePath.includes("\\") || path.isAbsolute(relativePath)) {
    throw new Error("offline asset path must be a bounded relative POSIX path");
  }
  const segments = relativePath.split("/");
  if (segments.some(segment => segment.length === 0 || segment === "." || segment === "..")) throw new Error("offline asset path contains an invalid segment");
  const root = assetRoot();
  const fullPath = path.resolve(root, ...segments);
  const relative = path.relative(root, fullPath);
  if (!relative || relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) throw new Error("offline asset path escapes its configured root");

  let current = root;
  for (const [index, segment] of segments.entries()) {
    current = path.join(current, segment);
    const stat = fs.lstatSync(current);
    if (stat.isSymbolicLink()) throw new Error("offline asset path may not traverse a symlink");
    if (index < segments.length - 1 && !stat.isDirectory()) throw new Error("offline asset parent path is not a directory");
    if (index === segments.length - 1 && !stat.isFile()) throw new Error("offline asset must be a regular file");
  }
  const realPath = fs.realpathSync(fullPath);
  const realRelative = path.relative(root, realPath);
  if (realRelative === ".." || realRelative.startsWith(`..${path.sep}`) || path.isAbsolute(realRelative)) throw new Error("offline asset resolved outside its configured root");
  return {root, fullPath};
}

async function measureFile(filePath: string): Promise<{digest: string; sizeBytes: number}> {
  const noFollow = fs.constants.O_NOFOLLOW ?? 0;
  const handle = await fs.promises.open(filePath, fs.constants.O_RDONLY | noFollow);
  try {
    const stat = await handle.stat();
    if (!stat.isFile() || !Number.isSafeInteger(stat.size) || stat.size < 0 || stat.size > MAX_OFFLINE_ASSET_BYTES) {
      throw new Error(`offline asset must be a regular file no larger than ${MAX_OFFLINE_ASSET_BYTES} bytes`);
    }
    const hash = crypto.createHash("sha256");
    const buffer = Buffer.allocUnsafe(HASH_CHUNK_BYTES);
    let position = 0;
    while (position < stat.size) {
      const {bytesRead} = await handle.read(buffer, 0, Math.min(buffer.length, stat.size - position), position);
      if (bytesRead <= 0) throw new Error("offline asset changed while it was being hashed");
      hash.update(buffer.subarray(0, bytesRead));
      position += bytesRead;
    }
    const after = await handle.stat();
    if (after.size !== stat.size || after.mtimeMs !== stat.mtimeMs) throw new Error("offline asset changed while it was being hashed");
    return {digest: hash.digest("hex"), sizeBytes: stat.size};
  } finally {
    await handle.close();
  }
}

function assetId(kind: OfflineAssetKind, name: string, digest: string): string {
  return `AS-${crypto.createHash("sha256").update(`${kind}\0${name}\0${digest}`).digest("hex").slice(0, 24).toUpperCase()}`;
}

export async function registerOfflineAsset(input: {kind: OfflineAssetKind; name: string; relativePath: string}): Promise<{asset: OfflineAsset; duplicate: boolean}> {
  if (!input || typeof input !== "object" || !ASSET_KINDS.includes(input.kind)) throw new Error("unsupported offline asset kind");
  if (typeof input.name !== "string" || input.name.trim().length === 0 || input.name.trim().length > 128 || input.name.includes("\0")) throw new Error("offline asset name must be 1-128 characters without NUL");
  const name = input.name.trim();
  const {fullPath} = resolveAssetPath(input.relativePath);
  const measured = await measureFile(fullPath);
  const id = assetId(input.kind, name, measured.digest);
  const existing = store.read().assets.find(asset => asset.id === id);
  if (existing) {
    if (existing.kind !== input.kind || existing.name !== name || existing.digest !== measured.digest || existing.sizeBytes !== measured.sizeBytes) {
      throw new Error(`offline asset identity conflict: ${id}`);
    }
    const verification = await verifyOfflineAsset(existing.id);
    if (!verification.valid) throw new Error(`registered offline asset no longer verifies: ${verification.error ?? existing.id}`);
    return {asset: existing, duplicate: true};
  }
  const asset: OfflineAsset = {
    id,
    kind: input.kind,
    name,
    relativePath: input.relativePath,
    digest: measured.digest,
    sizeBytes: measured.sizeBytes,
    registeredAt: new Date().toISOString()
  };
  store.update(payload => {
    if (payload.assets.some(value => value.id === id)) throw new Error(`offline asset identity conflict: ${id}`);
    if (payload.assets.length >= 5000) throw new Error("offline asset catalog is full");
    payload.assets.push(asset);
  });
  observe({
    type: "offline.asset.registered",
    message: `Offline-Asset ${id} registriert`,
    status: "COMPLETED",
    actor: "CREATOR",
    action: "offline.asset.register",
    resource: id,
    argumentsValue: {kind: asset.kind, name: asset.name, digest: asset.digest, sizeBytes: asset.sizeBytes}
  });
  return {asset: structuredClone(asset), duplicate: false};
}

export function getOfflineAsset(id: string): OfflineAsset | null {
  const asset = store.read().assets.find(value => value.id === id);
  return asset ? structuredClone(asset) : null;
}

export function listOfflineAssets(filter: {kind?: OfflineAssetKind} = {}): OfflineAsset[] {
  return store.read().assets.filter(asset => !filter.kind || asset.kind === filter.kind).map(asset => structuredClone(asset));
}

export async function verifyOfflineAsset(id: string): Promise<{valid: boolean; assetId: string; expected: string; actual?: string; sizeBytes?: number; error?: string}> {
  const asset = store.read().assets.find(value => value.id === id);
  if (!asset) throw new Error(`offline asset not found: ${id}`);
  try {
    const {fullPath} = resolveAssetPath(asset.relativePath);
    const measured = await measureFile(fullPath);
    const valid = measured.digest === asset.digest && measured.sizeBytes === asset.sizeBytes;
    return {
      valid,
      assetId: id,
      expected: asset.digest,
      actual: measured.digest,
      sizeBytes: measured.sizeBytes,
      ...(valid ? {} : {error: "offline asset digest or size mismatch"})
    };
  } catch (error) {
    return {valid: false, assetId: id, expected: asset.digest, error: error instanceof Error ? error.message : "offline asset verification failed"};
  }
}

function ensureSubdirectory(base: string, segments: string[]): string {
  let current = base;
  for (const segment of segments) {
    current = path.join(current, segment);
    try { fs.mkdirSync(current, {mode: 0o700}); } catch (error) {
      if (!(error instanceof Error && "code" in error && error.code === "EEXIST")) throw error;
    }
    const stat = fs.lstatSync(current);
    if (stat.isSymbolicLink() || !stat.isDirectory()) throw new Error("offline asset staging path may not contain symlinks or non-directories");
    const real = fs.realpathSync(current);
    const relative = path.relative(base, real);
    if (relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) throw new Error("offline asset staging path escaped the sandbox workspace");
  }
  return current;
}

async function copyVerifiedAsset(asset: OfflineAsset, workspace: string, maxBytes: number): Promise<StagedOfflineAsset> {
  if (!/^AS-[A-F0-9]{24}$/.test(asset.id) || !/^[a-f0-9]{64}$/.test(asset.digest) || !Number.isSafeInteger(asset.sizeBytes) || asset.sizeBytes < 0 || asset.sizeBytes > maxBytes) throw new Error(`invalid offline asset pin: ${asset.id}`);
  const {fullPath} = resolveAssetPath(asset.relativePath);
  const workspaceStat = fs.lstatSync(workspace);
  if (workspaceStat.isSymbolicLink() || !workspaceStat.isDirectory()) throw new Error("offline asset staging workspace must be a regular directory");
  const workspaceRoot = fs.realpathSync(workspace);
  ensureSubdirectory(workspaceRoot, [".bob-offline-assets"]);
  const assetDirectory = ensureSubdirectory(workspaceRoot, [".bob-offline-assets", asset.id]);
  const destination = path.join(assetDirectory, "content");
  const relativePath = path.relative(workspaceRoot, destination);
  if (!relativePath || relativePath === ".." || relativePath.startsWith(`..${path.sep}`) || path.isAbsolute(relativePath)) throw new Error("offline asset staging destination escapes workspace");

  try {
    const existingStat = fs.lstatSync(destination);
    if (existingStat.isSymbolicLink() || !existingStat.isFile()) throw new Error(`staged offline asset destination is not a regular file: ${asset.id}`);
    const existing = await measureFile(destination);
    if (existing.digest !== asset.digest || existing.sizeBytes !== asset.sizeBytes) throw new Error(`staged offline asset identity conflict: ${asset.id}`);
    return {assetId: asset.id, kind: asset.kind, name: asset.name, digest: asset.digest, sizeBytes: asset.sizeBytes, workspacePath: relativePath};
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code !== "ENOENT") throw error;
    if (error instanceof Error && !("code" in error)) throw error;
  }

  const noFollow = fs.constants.O_NOFOLLOW ?? 0;
  const source = await fs.promises.open(fullPath, fs.constants.O_RDONLY | noFollow);
  let target: fs.promises.FileHandle | null = null;
  let createdTarget = false;
  try {
    const sourceStat = await source.stat();
    if (!sourceStat.isFile() || sourceStat.size !== asset.sizeBytes || sourceStat.size > maxBytes) throw new Error(`offline asset size changed before staging: ${asset.id}`);
    try {
      target = await fs.promises.open(destination, fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL | noFollow, 0o400);
      createdTarget = true;
    } catch (error) {
      if (error instanceof Error && "code" in error && error.code === "EEXIST") {
        const existing = await measureFile(destination);
        if (existing.digest !== asset.digest || existing.sizeBytes !== asset.sizeBytes) throw new Error(`staged offline asset identity conflict: ${asset.id}`);
        return {assetId: asset.id, kind: asset.kind, name: asset.name, digest: asset.digest, sizeBytes: asset.sizeBytes, workspacePath: relativePath};
      }
      throw error;
    }
    const hash = crypto.createHash("sha256");
    const buffer = Buffer.allocUnsafe(HASH_CHUNK_BYTES);
    let position = 0;
    while (position < sourceStat.size) {
      const {bytesRead} = await source.read(buffer, 0, Math.min(buffer.length, sourceStat.size - position), position);
      if (bytesRead <= 0) throw new Error(`offline asset changed while staging: ${asset.id}`);
      const chunk = buffer.subarray(0, bytesRead);
      hash.update(chunk);
      let written = 0;
      while (written < bytesRead) {
        const result = await target.write(chunk, written, bytesRead - written, position + written);
        if (result.bytesWritten <= 0) throw new Error(`offline asset write failed: ${asset.id}`);
        written += result.bytesWritten;
      }
      position += bytesRead;
    }
    const sourceAfter = await source.stat();
    if (sourceAfter.size !== sourceStat.size || sourceAfter.mtimeMs !== sourceStat.mtimeMs || hash.digest("hex") !== asset.digest) throw new Error(`offline asset digest changed before staging: ${asset.id}`);
    await target.close();
    target = null;
    const staged = await measureFile(destination);
    if (staged.digest !== asset.digest || staged.sizeBytes !== asset.sizeBytes) throw new Error(`staged offline asset verification failed: ${asset.id}`);
    return {assetId: asset.id, kind: asset.kind, name: asset.name, digest: asset.digest, sizeBytes: asset.sizeBytes, workspacePath: relativePath};
  } catch (error) {
    if (target) await target.close().catch(() => undefined);
    if (createdTarget) fs.rmSync(destination, {force: true});
    throw error;
  } finally {
    await source.close();
  }
}

function stagedDirectoryBytes(directory: string, entries = {count: 0}): number {
  const stat = fs.lstatSync(directory);
  if (stat.isSymbolicLink()) throw new Error("offline staged asset tree may not contain symlinks");
  if (stat.isFile()) return stat.size;
  if (!stat.isDirectory()) throw new Error("offline staged asset tree contains a non-file entry");
  let total = 0;
  for (const name of fs.readdirSync(directory)) {
    entries.count += 1;
    if (entries.count > 10_000) throw new Error("offline staged asset tree exceeds its entry limit");
    total += stagedDirectoryBytes(path.join(directory, name), entries);
    if (!Number.isSafeInteger(total)) throw new Error("offline staged asset size is invalid");
  }
  return total;
}

/** Copy pinned, verified local assets into a sandbox workspace; never exposes host paths. */
export async function stageOfflineAssetsInWorkspace(input: {packageId: string; assets: OfflineAssetPin[]; workspace: string; maxBytes: number}): Promise<StagedOfflineAsset[]> {
  if (!input || typeof input !== "object" || !/^OTP-[a-f0-9-]{36}$/.test(input.packageId)) throw new Error("offline task package identity is invalid");
  if (!path.isAbsolute(input.workspace) || !Number.isSafeInteger(input.maxBytes) || input.maxBytes <= 0) throw new Error("offline asset staging requires an absolute workspace and positive storage limit");
  if (!Array.isArray(input.assets) || input.assets.length > 128) throw new Error("offline asset staging list exceeds its limit");
  for (const pin of input.assets) {
    if (!pin || typeof pin !== "object" || !/^AS-[A-F0-9]{24}$/.test(pin.assetId) || !ASSET_KINDS.includes(pin.kind) || typeof pin.name !== "string" || pin.name.length === 0 || pin.name.length > 128 || !/^[a-f0-9]{64}$/.test(pin.digest) || !Number.isSafeInteger(pin.sizeBytes) || pin.sizeBytes < 0 || pin.sizeBytes > MAX_OFFLINE_ASSET_BYTES) throw new Error("offline task asset pin is invalid");
  }
  if (new Set(input.assets.map(pin => pin.assetId)).size !== input.assets.length) throw new Error("offline task package contains duplicate asset pins");
  const total = input.assets.reduce((sum, pin) => sum + pin.sizeBytes, 0);
  if (!Number.isSafeInteger(total) || total > MAX_STAGED_OFFLINE_ASSET_BYTES || total > Math.floor(input.maxBytes * 0.75)) throw new Error("offline task assets exceed the bounded workspace staging budget");
  if (input.assets.length === 0) return [];
  const workspaceStat = fs.lstatSync(input.workspace);
  if (workspaceStat.isSymbolicLink() || !workspaceStat.isDirectory()) throw new Error("offline asset staging workspace must be a regular directory");
  const workspaceRoot = fs.realpathSync(input.workspace);
  const stageRoot = ensureSubdirectory(workspaceRoot, [".bob-offline-assets"]);
  const currentUsage = stagedDirectoryBytes(stageRoot);
  let newBytes = 0;
  const localAssets: OfflineAsset[] = [];
  for (const pin of input.assets) {
    const asset = store.read().assets.find(value => value.id === pin.assetId);
    if (!asset || asset.kind !== pin.kind || asset.name !== pin.name || asset.digest !== pin.digest || asset.sizeBytes !== pin.sizeBytes) throw new Error(`offline task asset does not match the local catalog: ${pin.assetId}`);
    const assetDirectory = ensureSubdirectory(workspaceRoot, [".bob-offline-assets", pin.assetId]);
    const destination = path.join(assetDirectory, "content");
    try {
      const destinationStat = fs.lstatSync(destination);
      if (destinationStat.isSymbolicLink() || !destinationStat.isFile()) throw new Error(`staged offline asset destination is not a regular file: ${pin.assetId}`);
      const existing = await measureFile(destination);
      if (existing.digest !== pin.digest || existing.sizeBytes !== pin.sizeBytes) throw new Error(`staged offline asset identity conflict: ${pin.assetId}`);
    } catch (error) {
      if (error instanceof Error && "code" in error && error.code !== "ENOENT") throw error;
      if (error instanceof Error && !("code" in error)) throw error;
      newBytes += pin.sizeBytes;
    }
    localAssets.push(asset);
  }
  const stagingBudget = Math.min(MAX_STAGED_OFFLINE_ASSET_BYTES, Math.floor(input.maxBytes * 0.75));
  if (currentUsage + newBytes > stagingBudget) throw new Error("offline staged assets exceed the bounded sandbox workspace budget");
  const staged: StagedOfflineAsset[] = [];
  for (const asset of localAssets) staged.push(await copyVerifiedAsset(asset, input.workspace, input.maxBytes));
  return staged;
}

export function offlineAssetStoreReport() {
  return {store: store.integrity(), count: store.read().assets.length, rootConfigured: Boolean(process.env.BOB_OFFLINE_ASSET_DIR)};
}
