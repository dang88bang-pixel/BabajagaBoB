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

type Payload = {records: AuditRecord[]};
const store = createStore<Payload>("audit", 1, () => ({records: []}));

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
    if (payload.records.length > 1000) payload.records.splice(0, payload.records.length - 1000);
  }).records.at(-1) as AuditRecord;
}

export function auditSnapshot(limit = 200): AuditRecord[] {
  return store.read().records.slice(-limit).reverse();
}

export type ChainVerification = {valid: boolean; length: number; issues: string[]};

/** Prüft die Audit-Kette auf Sequenzlücken, Verkettungsbrüche und Hash-Abweichungen. */
export function verifyAuditChain(): ChainVerification {
  const {records} = store.read();
  const issues: string[] = [];
  let previousHash = GENESIS;
  let expectedSequence = 1;
  for (const record of records) {
    if (record.sequence !== expectedSequence) issues.push(`sequence gap at ${record.id}: expected ${expectedSequence}, found ${record.sequence}`);
    if (record.previousHash !== previousHash) issues.push(`chain break at ${record.id}`);
    const {hash, ...rest} = record;
    if (computeRecordHash(rest) !== hash) issues.push(`hash mismatch at ${record.id} (record was modified)`);
    previousHash = record.hash;
    expectedSequence = record.sequence + 1;
  }
  return {valid: issues.length === 0, length: records.length, issues};
}

export function auditIntegrity() {
  const verification = verifyAuditChain();
  const report = store.integrity();
  return {
    ...verification,
    storeOk: report.ok,
    tamperEvident: hmacKey().length > 0 ? "HMAC-SHA256" : "SHA256-CHAIN",
    file: report.file
  };
}

export function auditStoreReport() {
  return store.integrity();
}
