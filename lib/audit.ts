import crypto from "node:crypto";
import {createStore} from "./persistence/store";

/**
 * Kanonischer Audit-Store (Abschnitt 6/39).
 *
 * Audit ist append-only und hash-verkettet:
 *   hash(n) = SHA256(previousHash | kanonischer Datensatz)
 *
 * Dadurch sind Löschungen und nachträgliche Änderungen erkennbar. Ist
 * `BOB_AUDIT_HMAC_KEY` gesetzt, wird zusätzlich HMAC-SHA256 verwendet, sodass
 * eine Manipulation der Datei ohne Schlüssel nicht unbemerkt neu berechnet
 * werden kann. Ohne Schlüssel bleibt die Kette manipulations*erkennbar*
 * (nicht manipulations*sicher* gegen einen Angreifer mit Dateisystemzugriff) –
 * das ist in docs/SECURITY.md dokumentiert.
 */

export type AuditRecord = {
  id: string;
  sequence: number;
  time: string;
  actor: string;
  action: string;
  resource?: string;
  decision: string;
  argumentHash: string;
  causalParentId?: string;
  previousHash: string;
  hash: string;
};

export type AuditInput = Omit<AuditRecord, "id" | "sequence" | "time" | "argumentHash" | "previousHash" | "hash">;

/**
 * Aufbewahrung und Kettenkopf.
 *
 * Ein Audit ist append-only. Ein früheres Aufbewahrungslimit (1000 Datensätze)
 * schnitt den Kopf ab, ohne den Kettenkopf zu vermerken — danach meldete jede
 * Verifikation "sequence gap"/"chain break", also einen **falschen Alarm**, der
 * echte Manipulation im Rauschen verschwinden lässt (live gefunden).
 *
 * Deshalb: standardmäßig keine Kürzung (unverändert append-only). Nur mit
 * ausdrücklichem `BOB_AUDIT_MAX_RECORDS` wird gekürzt — und dann wird der
 * abgeschnittene Kopf als Checkpoint (Sequenz + Hash) im Store festgehalten.
 * Die Verifikation beginnt an diesem Checkpoint und meldet jede Lücke davor als
 * "Kopf nicht verifizierbar" (sichtbar), statt sie als Bruch zu verschweigen.
 */
type TrimCheckpoint = {sequence: number; hash: string; trimmedAt: string; reconstructed?: boolean};
type Payload = {records: AuditRecord[]; trimmedThrough?: TrimCheckpoint | null};
const store = createStore<Payload>("audit", 1, () => ({records: [], trimmedThrough: null}));

const hmacKey = () => process.env.BOB_AUDIT_HMAC_KEY ?? "";

export function canonicalRecord(record: Omit<AuditRecord, "hash">): string {
  return JSON.stringify([
    record.id,
    record.sequence,
    record.time,
    record.actor,
    record.action,
    record.resource ?? null,
    record.decision,
    record.argumentHash,
    record.causalParentId ?? null,
    record.previousHash
  ]);
}

export function computeRecordHash(record: Omit<AuditRecord, "hash">): string {
  const material = canonicalRecord(record);
  const key = hmacKey();
  return key
    ? crypto.createHmac("sha256", key).update(material).digest("hex")
    : crypto.createHash("sha256").update(material).digest("hex");
}

const GENESIS = "GENESIS";

export function recordAudit(input: AuditInput, argumentsValue: unknown): AuditRecord {
  const argumentHash = crypto.createHash("sha256").update(JSON.stringify(argumentsValue ?? null)).digest("hex");
  return store.update(payload => {
    const previous = payload.records[payload.records.length - 1];
    const base: Omit<AuditRecord, "hash"> = {
      ...input,
      id: `AUD-${crypto.randomUUID()}`,
      sequence: (previous?.sequence ?? 0) + 1,
      time: new Date().toISOString(),
      argumentHash,
      previousHash: previous?.hash ?? GENESIS
    };
    payload.records.push({...base, hash: computeRecordHash(base)});
    const cap = Number.parseInt(process.env.BOB_AUDIT_MAX_RECORDS ?? "", 10);
    if (Number.isFinite(cap) && cap > 0 && payload.records.length > cap) {
      const removed = payload.records.splice(0, payload.records.length - cap);
      const last = removed[removed.length - 1];
      // Der abgeschnittene Kopf bleibt als Checkpoint nachvollziehbar.
      payload.trimmedThrough = {sequence: last.sequence, hash: last.hash, trimmedAt: new Date().toISOString()};
    }
  }).records.at(-1) as AuditRecord;
}

export function auditSnapshot(limit = 200): AuditRecord[] {
  return store.read().records.slice(-limit).reverse();
}

export type ChainVerification = {
  valid: boolean;
  length: number;
  issues: string[];
  /** Anzahl vor dem Checkpoint abgeschnittener Datensätze (0 = nichts gekürzt). */
  trimmedSequence?: number;
  /** Der Anfang der Kette liegt nicht mehr vor; der erhaltene Teil wird geprüft. */
  headUnverifiable?: boolean;
  /** Der abgeschnittene Kopf wurde aus dem ersten erhaltenen Datensatz rekonstruiert. */
  headReconstructed?: boolean;
  /** Einordnung der Aufbewahrung für Berichte und UI. */
  retentionIntegrity?: string;
};

/**
 * Bestandsreparatur für Installationen, die mit der früheren Fassung (Kürzung
 * ohne Checkpoint) gelaufen sind: Aus dem ersten erhaltenen Datensatz sind
 * Sequenz und Hash seines Vorgängers bekannt — daraus wird der Checkpoint
 * rekonstruiert und **dauerhaft** vermerkt (`reconstructed: true`). Danach ist
 * der erhaltene Teil wieder vollständig prüfbar, ohne die Lücke zu verbergen.
 */
function ensureRetentionCheckpoint(): {reconstructed: boolean; sequence: number} {
  const payload = store.read();
  const first = payload.records[0];
  if (!first || first.sequence <= 1 || payload.trimmedThrough) {
    return {reconstructed: false, sequence: payload.trimmedThrough?.sequence ?? 0};
  }
  const checkpoint: TrimCheckpoint = {
    sequence: first.sequence - 1,
    hash: first.previousHash,
    trimmedAt: new Date().toISOString(),
    reconstructed: true
  };
  store.update(current => {
    current.trimmedThrough = checkpoint;
  });
  return {reconstructed: true, sequence: checkpoint.sequence};
}

/**
 * Prüft die Audit-Kette auf Sequenzlücken, Verkettungsbrüche und
 * Hash-Abweichungen. Beginnt am gespeicherten Checkpoint, damit eine bewusste
 * Aufbewahrungskürzung kein falscher Alarm ist — und ein fehlender Datensatz
 * innerhalb des erhaltenen Fensters weiterhin auffällt.
 */
export function verifyAuditChain(): ChainVerification {
  const repaired = ensureRetentionCheckpoint();
  const payload = store.read();
  const records = payload.records;
  const checkpoint = payload.trimmedThrough ?? null;
  const issues: string[] = [];
  const headUnverifiable = records.length > 0 && records[0].sequence > 1 && checkpoint === null;
  let previousHash = checkpoint?.hash ?? GENESIS;
  let expectedSequence = (checkpoint?.sequence ?? 0) + 1;
  for (const record of records) {
    if (record.sequence !== expectedSequence) issues.push(`sequence gap at ${record.id}: expected ${expectedSequence}, found ${record.sequence}`);
    if (record.previousHash !== previousHash) issues.push(`chain break at ${record.id}`);
    const {hash, ...rest} = record;
    if (computeRecordHash(rest) !== hash) issues.push(`hash mismatch at ${record.id} (record was modified)`);
    previousHash = record.hash;
    expectedSequence = record.sequence + 1;
  }
  return {
    valid: issues.length === 0,
    length: records.length,
    issues,
    trimmedSequence: checkpoint?.sequence ?? 0,
    ...(headUnverifiable ? {headUnverifiable: true} : {}),
    ...(checkpoint?.reconstructed || repaired.reconstructed ? {headReconstructed: true} : {}),
    retentionIntegrity:
      (checkpoint?.sequence ?? 0) === 0
        ? "FULL_CHAIN"
        : checkpoint?.reconstructed
          ? "HEAD_RECONSTRUCTED_FROM_FIRST_RETAINED_RECORD"
          : "TRIMMED_WITH_CHECKPOINT"
  };
}

export function auditIntegrity() {
  const verification = verifyAuditChain();
  const report = store.integrity();
  return {
    ...verification,
    storeOk: report.ok,
    tamperEvident: hmacKey().length > 0 ? "HMAC-SHA256" : "SHA256-CHAIN",
    retention:
      verification.trimmedSequence && verification.trimmedSequence > 0
        ? `append-only mit Aufbewahrungsgrenze; Kopf bis Sequenz ${verification.trimmedSequence} abgeschnitten (Checkpoint im Store${verification.headReconstructed ? ", aus dem ersten erhaltenen Datensatz rekonstruiert" : ""})`
        : "append-only ohne Kürzung",
    file: report.file
  };
}

export function auditStoreReport() {
  return store.integrity();
}
