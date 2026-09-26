import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import {beforeAll, describe, expect, it, vi} from "vitest";
import {isolatedStorageRoot} from "../helpers/runtime";

/**
 * Aufbewahrung der Audit-Kette.
 *
 * Regression zu einem live gefundenen Fehler: Die frühere Kürzung bei 1000
 * Datensätzen schnitt den Kettenkopf ab, ohne ihn zu vermerken. Danach meldete
 * `verifyAuditChain()` "sequence gap"/"chain break" — ein **falscher Alarm**,
 * der echte Manipulation im Rauschen verdeckt. Erwartet wird jetzt:
 *
 *  - ohne `BOB_AUDIT_MAX_RECORDS`: unverändert append-only, keine Kürzung,
 *  - mit Grenze: Kürzung nur mit Checkpoint (Sequenz + Hash), Kette bleibt gültig,
 *  - Manipulation im erhaltenen Fenster wird weiterhin erkannt (beide Ebenen:
 *    Datei-Digest und Hash-Kette).
 */

const root = isolatedStorageRoot("audit-retention");
const AUDIT_FILE = path.join(root, "audit.json");

type Audit = typeof import("../../lib/audit");
let audit: Audit;

function envelopeDigest(version: number, payload: unknown, store?: string): string {
  return crypto.createHash("sha256").update(JSON.stringify(store === undefined ? {version, payload} : {store, version, payload})).digest("hex");
}

beforeAll(async () => {
  vi.resetModules();
  audit = await import("../../lib/audit");
  expect(root).toContain("audit-retention");
});

function write(count: number, prefix: string) {
  for (let index = 0; index < count; index += 1) {
    audit.recordAudit({actor: "AG-BUILD", action: `audit.${prefix}`, decision: "ALLOW"}, {index});
  }
}

describe("Audit-Aufbewahrung", () => {
  it("schneidet ohne Aufbewahrungsgrenze nicht ab (append-only)", () => {
    delete process.env.BOB_AUDIT_MAX_RECORDS;
    write(1200, "append");
    const chain = audit.verifyAuditChain();
    expect(chain.length).toBe(1200);
    expect(chain.valid, chain.issues.join("; ")).toBe(true);
    expect(chain.trimmedSequence).toBe(0);
    expect(chain.headUnverifiable).toBeUndefined();
    expect(audit.auditIntegrity().retention).toContain("ohne Kürzung");
  });

  it("kürzt mit Grenze nur mit Checkpoint und bleibt gültig", () => {
    process.env.BOB_AUDIT_MAX_RECORDS = "50";
    write(60, "retention");
    const chain = audit.verifyAuditChain();
    expect(chain.valid, chain.issues.join("; ")).toBe(true);
    expect(chain.length).toBe(50);
    expect(chain.trimmedSequence).toBeGreaterThan(0);

    const envelope = JSON.parse(fs.readFileSync(AUDIT_FILE, "utf8"));
    expect(envelope.payload.records).toHaveLength(50);
    expect(envelope.payload.trimmedThrough.sequence).toBe(chain.trimmedSequence);
    expect(envelope.payload.records[0].previousHash).toBe(envelope.payload.trimmedThrough.hash);

    // Der Kopf ist vor dem Checkpoint nicht mehr vorhanden — das wird
    // ausgewiesen statt als Kettenbruch fehlinterpretiert zu werden.
    expect(audit.auditIntegrity().retention).toContain("Aufbewahrungsgrenze");
    delete process.env.BOB_AUDIT_MAX_RECORDS;
  });

  it("erkennt Dateimanipulation (Digest) und Hash-Manipulation (Kette)", () => {
    const original = fs.readFileSync(AUDIT_FILE, "utf8");
    const envelope = JSON.parse(original);
    const target = envelope.payload.records[5];
    target.decision = "DENY";
    fs.writeFileSync(AUDIT_FILE, JSON.stringify(envelope), {mode: 0o600});

    // Ebene 1: Der Datei-Digest deckt die Änderung auf.
    expect(() => audit.verifyAuditChain()).toThrow(/digest|integrit|Integrität/i);

    // Ebene 2: Ein Angreifer mit Dateischreibrechten kann den Digest neu
    // berechnen — die Hash-Kette deckt die Änderung trotzdem auf.
    envelope.digest = envelopeDigest(envelope.version, envelope.payload, envelope.store);
    fs.writeFileSync(AUDIT_FILE, JSON.stringify(envelope), {mode: 0o600});
    const chain = audit.verifyAuditChain();
    expect(chain.valid).toBe(false);
    expect(chain.issues.some(issue => issue.includes("hash mismatch"))).toBe(true);
    expect(chain.issues.some(issue => issue.includes("sequence gap"))).toBe(false);
  });

  it("repariert Altbestände ohne Checkpoint sichtbar (Kopf rekonstruiert)", () => {
    // Ausgangslage: eine Datei aus einer früheren Fassung, die den Kopf
    // abgeschnitten hat, ohne ihn zu vermerken.
    const envelope = JSON.parse(fs.readFileSync(AUDIT_FILE, "utf8"));
    const retained = envelope.payload.records.slice(-5);
    const legacy = {
      store: envelope.store,
      version: envelope.version,
      writtenAt: envelope.writtenAt,
      payload: {records: retained},
      digest: undefined as string | undefined
    };
    legacy.digest = envelopeDigest(legacy.version, legacy.payload, legacy.store);
    fs.writeFileSync(AUDIT_FILE, JSON.stringify(legacy), {mode: 0o600});

    const chain = audit.verifyAuditChain();
    expect(chain.valid, chain.issues.join("; ")).toBe(true);
    expect(chain.headReconstructed).toBe(true);
    expect(chain.retentionIntegrity).toBe("HEAD_RECONSTRUCTED_FROM_FIRST_RETAINED_RECORD");
    expect(chain.trimmedSequence).toBe(retained[0].sequence - 1);

    // Der Checkpoint ist dauerhaft vermerkt, nicht nur berechnet.
    const repaired = JSON.parse(fs.readFileSync(AUDIT_FILE, "utf8"));
    expect(repaired.payload.trimmedThrough).toMatchObject({sequence: chain.trimmedSequence, reconstructed: true});
    expect(repaired.payload.trimmedThrough.hash).toBe(retained[0].previousHash);
    expect(audit.verifyAuditChain().headReconstructed).toBe(true);
  });
});
