import crypto from "node:crypto";
import {createStore} from "./persistence/store";
import type {KnowledgeState} from "./types";

/**
 * Evidenz/Artefakte (Abschnitt 4/33).
 *
 * Evidenz ist der **Nachweis** einer Beobachtung — nicht nur ein Verweis.
 * Deshalb gilt hier:
 *
 *  - Den Digest bildet **immer der Server** über den gespeicherten Inhalt.
 *    Ein vom Aufrufer mitgelieferter Digest wäre nicht überprüfbar und damit
 *    wertlos.
 *  - Der Inhalt wird mitgespeichert (bis `MAX_CONTENT_BYTES`), damit
 *    `verifyArtifact` den Digest jederzeit erneut berechnen kann. Wird der
 *    Inhalt gekürzt, setzt der Datensatz `truncated: true` und `bytes` nennt die
 *    Originallänge — der Digest deckt dann exakt den gespeicherten Teil.
 *  - Persistenz über den Store `artifacts` (atomar, 0600, Digest-geprüfter
 *    Umschlag), damit Evidenz einen Neustart überlebt.
 *
 * Klassifikation: IMPLEMENTED, INTEGRATED (Execution Broker), TESTED. Die
 * Evidenzprüfung ist bewusst rein lokal (Digest) — sie belegt Unversehrtheit
 * des Datensatzes, **nicht** die Wahrheit der Beobachtung.
 */

export type Artifact = {
  id: string;
  name: string;
  kind: string;
  taskId: string;
  runId: string;
  sandboxId: string;
  agentId: string;
  digest: string;
  contentType: string;
  producedAt: string;
  knowledgeState: KnowledgeState;
  parentEventId?: string;
  /** Gespeicherter Inhalt (evtl. gekürzt — siehe `truncated`). */
  content: string;
  /** Originallänge des Inhalts in Bytes. */
  bytes: number;
  truncated: boolean;
};

export const MAX_CONTENT_BYTES = 8192;

type Payload = {artifacts: Artifact[]};
const store = createStore<Payload>("artifacts", 1, () => ({artifacts: []}));

export function contentDigest(content: string): string {
  return crypto.createHash("sha256").update(content, "utf8").digest("hex");
}

export function recordArtifact(
  input: Omit<Artifact, "id" | "producedAt" | "digest" | "content" | "bytes" | "truncated" | "contentType"> & {
    contentType?: string;
  },
  content: string
): Artifact {
  const raw = typeof content === "string" ? content : "";
  const truncated = Buffer.byteLength(raw, "utf8") > MAX_CONTENT_BYTES;
  const stored = truncated ? Buffer.from(raw, "utf8").subarray(0, MAX_CONTENT_BYTES).toString("utf8") : raw;
  const artifact: Artifact = {
    ...input,
    id: `ART-${crypto.randomUUID()}`,
    contentType: input.contentType ?? "text/plain",
    digest: contentDigest(stored),
    producedAt: new Date().toISOString(),
    content: stored,
    bytes: Buffer.byteLength(raw, "utf8"),
    truncated
  };
  store.update(payload => {
    payload.artifacts.unshift(artifact);
    if (payload.artifacts.length > 2000) payload.artifacts.splice(2000);
  });
  return structuredClone(artifact);
}

export function artifactSnapshot(filter: {taskId?: string; runId?: string; sandboxId?: string; kind?: string} = {}): Artifact[] {
  return store
    .read()
    .artifacts.filter(
      artifact =>
        (!filter.taskId || artifact.taskId === filter.taskId) &&
        (!filter.runId || artifact.runId === filter.runId) &&
        (!filter.sandboxId || artifact.sandboxId === filter.sandboxId) &&
        (!filter.kind || artifact.kind === filter.kind)
    )
    .map(artifact => structuredClone(artifact));
}

export function getArtifact(id: string): Artifact | null {
  const found = store.read().artifacts.find(artifact => artifact.id === id);
  return found ? structuredClone(found) : null;
}

/** Prüft einen Datensatz gegen seinen Digest (Unversehrtheit des Speichers). */
export function verifyArtifact(id: string): {ok: boolean; artifactId: string; expected?: string; actual?: string; error?: string} {
  let artifact: ReturnType<typeof getArtifact>;
  try {
    artifact = getArtifact(id);
  } catch (error) {
    // Ein beschädigter Store ist selbst ein Befund: die Prüfung meldet ihn als
    // Fehler (fail closed) statt den Aufrufer mit einer Ausnahme abzubrechen.
    return {ok: false, artifactId: id, error: error instanceof Error ? error.message : "store unreadable"};
  }
  if (!artifact) return {ok: false, artifactId: id, error: "artifact not found"};
  const actual = contentDigest(artifact.content);
  return {ok: actual === artifact.digest, artifactId: id, expected: artifact.digest, actual};
}

/**
 * Kanonischer Inhalt einer Ausführungs-Evidenz. Feldreihenfolge ist fest
 * (deterministisch), damit derselbe Vorgang denselben Digest ergibt.
 */
export function executionEvidenceContent(input: {
  taskId: string;
  agentId: string;
  sandboxId: string;
  runId?: string | null;
  environment: string;
  argv: string[];
  accepted: boolean;
  exitCode: number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
  durationMs: number;
}): string {
  return JSON.stringify(
    {
      taskId: input.taskId,
      agentId: input.agentId,
      sandboxId: input.sandboxId,
      runId: input.runId ?? null,
      environment: input.environment,
      argv: input.argv,
      accepted: input.accepted,
      exitCode: input.exitCode,
      stdout: input.stdout,
      stderr: input.stderr,
      timedOut: input.timedOut,
      durationMs: input.durationMs
    },
    null,
    2
  );
}
