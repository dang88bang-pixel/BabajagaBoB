import fs from "node:fs";
import path from "node:path";
import {beforeAll, describe, expect, it, vi} from "vitest";
import {isolatedStorageRoot, TEST_BOOTSTRAP_SECRET} from "../helpers/runtime";

/**
 * Fehlerinjektion (Abschnitt 37 / TEST-003).
 *
 * Jede Prüfung löst eine **echte** Störung aus und misst anschließend, dass die
 * Plattform sie erkennt und übersteht — ohne ihren Nachweis zu verlieren:
 *
 *  - Prozessabsturz im Sandkasten (SIGKILL über den Broker),
 *  - abgelaufene Worker-Lease,
 *  - Netzwerkzugriff (ALLOWLIST ohne kontrollierte Egress-Schicht),
 *  - doppelter Job (Idempotenzschlüssel),
 *  - konkurrierende Schreibvorgänge auf denselben Store,
 *  - Manipulation am Store-Envelope.
 *
 * Danach gilt für **alle** Fälle: Store integer, Event-Kette und Audit-Kette
 * gültig, Evidenz vorhanden, Beobachtung im Wissensgraphen.
 */

const root = isolatedStorageRoot("fault-injection");

let faults: typeof import("../../lib/fault-injection");
let queue: typeof import("../../lib/queue");
let audit: typeof import("../../lib/audit");
let events: typeof import("../../lib/events/log");
let store: typeof import("../../lib/persistence/store");
let knowledge: typeof import("../../lib/knowledge");
let auth: typeof import("../../app/api/auth/route");

beforeAll(async () => {
  process.env.BOB_STORAGE_DIR = root;
  process.env.BOB_NS_ISOLATION = "off";
  process.env.BOB_BOOTSTRAP_SECRET = TEST_BOOTSTRAP_SECRET;
  vi.resetModules();
  auth = await import("../../app/api/auth/route");
  const bootstrap = await auth.POST(
    new Request("http://localhost:3000/api/auth", {
      method: "POST",
      headers: {"content-type": "application/json"},
      body: JSON.stringify({action: "bootstrap", secret: TEST_BOOTSTRAP_SECRET, creatorName: "Injektion"})
    })
  );
  expect(bootstrap.status).toBe(201);
  faults = await import("../../lib/fault-injection");
  queue = await import("../../lib/queue");
  audit = await import("../../lib/audit");
  events = await import("../../lib/events/log");
  store = await import("../../lib/persistence/store");
  knowledge = await import("../../lib/knowledge");
});

describe("Fehlerinjektion", () => {
  it("übersteht einen echten Prozessabbruch im Sandkasten", async () => {
    const injection = await faults.injectFault({kind: "PROCESS_ABORT", requestedBy: "CREATOR"});
    expect(injection.outcome).toBe("SURVIVED");
    expect(injection.checks.every(check => check.ok), JSON.stringify(injection.checks.filter(check => !check.ok))).toBe(true);
    // Der Abbruch darf niemals als Erfolg gewertet werden.
    const accepted = injection.checks.find(check => check.name === "Ausführung akzeptiert");
    expect(accepted?.ok).toBe(true);
    expect(injection.observed).toMatch(/exitCode/);
    expect(injection.evidence?.digest).toHaveLength(64);
  });

  it("fällt einen Job nach Lease-Verlust zurück an die Queue", async () => {
    const injection = await faults.injectFault({kind: "WORKER_LOSS", requestedBy: "CREATOR"});
    expect(injection.outcome).toBe("SURVIVED");
    const job = queue.getJob(injection.target);
    expect(job, "Job verschwand nach dem Lease-Verlust").not.toBeNull();
    expect(job?.leaseOwner).toBeUndefined();
    expect(["QUEUED", "DEAD_LETTER", "FAILED"]).toContain(String(job?.state));
    // Kein hängender Besitzer: ein zweiter Lauf darf nichts Blockiertes finden.
    const stuck = queue.queueSnapshot().filter(entry => entry.state === "LEASED" && !entry.leasedUntil);
    expect(stuck).toHaveLength(0);
  });

  it("verweigert Netzwerkzugriff (ALLOWLIST) fail closed und ohne Phantom-Sandbox", async () => {
    const injection = await faults.injectFault({kind: "NETWORK_LOSS", requestedBy: "CREATOR"});
    expect(injection.outcome).toBe("SURVIVED");
    expect(injection.observed).toMatch(/verweigert/i);
    expect(injection.checks.find(check => check.name === "Keine Phantom-Sandbox")?.ok).toBe(true);
  });

  it("erzeugt für denselben Idempotenzschlüssel genau einen Job", async () => {
    const injection = await faults.injectFault({kind: "DUPLICATE_JOB", requestedBy: "CREATOR"});
    expect(injection.outcome).toBe("SURVIVED");
    expect(injection.observed).toMatch(/Treffer im Store: 1/);
  });

  it("verliert bei konkurrierenden Schreibvorgängen keinen Datensatz", async () => {
    const injection = await faults.injectFault({kind: "CONCURRENT_WRITE", requestedBy: "CREATOR", count: 24});
    expect(injection.outcome).toBe("SURVIVED");
    expect(injection.observed).toMatch(/24\/24/);
    const integrity = store.storeIntegrityReport();
    expect(integrity.ok).toBe(true);
  });

  it("erkennt ein gekipptes Byte im Store-Envelope", async () => {
    const injection = await faults.injectFault({kind: "STORE_TAMPER", requestedBy: "CREATOR"});
    expect(injection.outcome).toBe("SURVIVED");
    expect(injection.observed).toMatch(/Manipulation erkannt/);
    // Nach der Injektion muss der Store wieder unversehrt sein (Wiederherstellung).
    const file = path.join(root, "fault-injections.json");
    expect(fs.existsSync(file)).toBe(true);
    expect(store.storeIntegrityReport().ok, "Store blieb nach der Injektion beschädigt").toBe(true);
  });

  it("behält für jede Injektion Integrität, Ketten, Evidenz und Wissen", async () => {
    const injections = faults.listFaultInjections();
    expect(injections.length).toBeGreaterThanOrEqual(6);
    for (const injection of injections) {
      expect(injection.checks.some(check => check.name === "Store-Integrität"), `${injection.faultId} ohne Store-Prüfung`).toBe(true);
      expect(injection.checks.some(check => check.name === "Event-Kette")).toBe(true);
      expect(injection.checks.some(check => check.name === "Audit-Kette")).toBe(true);
      expect(injection.evidence?.artifactId, `${injection.faultId} ohne Evidenz`).toMatch(/^ART-/);
      expect(injection.evidence?.digest).toHaveLength(64);
    }
    expect(events.verifyEventChain().valid).toBe(true);
    expect(audit.verifyAuditChain().valid).toBe(true);
    const known = knowledge.listKnowledge().nodes.filter(node => node.predicate === "Fehlerinjektion");
    expect(known.length).toBeGreaterThanOrEqual(6);
    const episodic = knowledge.negativeKnowledge();
    expect(Array.isArray(episodic)).toBe(true);
  });

  it("protokolliert jede Injektion im Audit als Creator-Akt", () => {
    const records = audit.auditSnapshot(500).filter(record => record.action === "fault.inject");
    expect(records.length).toBeGreaterThanOrEqual(6);
    expect(records.every(record => record.actor === "CREATOR")).toBe(true);
    expect(audit.verifyAuditChain().valid).toBe(true);
  });

  it("sperrt die Injektion bei aktivem System-Kill-Switch", async () => {
    const governance = await import("../../lib/governance");
    governance.setKillSwitch("SYSTEM", "FAULT_INJECTION", true, "Injektion gesperrt (Test)");
    await expect(faults.injectFault({kind: "DUPLICATE_JOB", requestedBy: "CREATOR"})).rejects.toThrow(/kill-switch/i);
    governance.setKillSwitch("SYSTEM", "FAULT_INJECTION", false, "Sperre aufgehoben (Test)");
    // Nach der Aufhebung funktioniert die Injektion wieder — die Sperre war echt.
    const again = await faults.injectFault({kind: "DUPLICATE_JOB", requestedBy: "CREATOR"});
    expect(again.outcome).toBe("SURVIVED");
  });

  it("weist unbekannte Injektionsarten ab, statt etwas anderes auszuführen", async () => {
    await expect(faults.injectFault({kind: "GIBTSNICHT" as never, requestedBy: "CREATOR"})).rejects.toThrow(/unsupported fault kind/);
  });
});
