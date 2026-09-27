import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest";
import {TEST_BOOTSTRAP_SECRET} from "../helpers/runtime";

/**
 * Store-Migration des Science-Stores (v2 → v3).
 *
 * Mit der Signifikanzprüfung kam das Feld `measurements` hinzu. Ein Bestand
 * darf dadurch nicht unlesbar werden: Er wird geprüft, gesichert, migriert und
 * behält seine Experimente. Fehlt die Kette, wäre der Store fail closed — das
 * wird hier nicht simuliert, sondern am echten Modul geprüft.
 */

let root = "";

const legacyPayload = {
  objectives: [{objectiveId: "OBJ-ALT", missionId: "MIS-ALT", title: "Alt", description: "Bestand", status: "ACTIVE", createdAt: "2026-09-01T00:00:00.000Z"}],
  experiments: [
    {
      experimentId: "EXP-ALT",
      missionId: "MIS-ALT",
      objectiveId: "OBJ-ALT",
      title: "Bestandsexperiment",
      taskId: "TASK-ALT",
      agentId: "AG-SCIENTIST",
      sandboxId: "SB-ALT",
      hypothesis: "x bewirkt y",
      baseline: "ohne",
      control: "mit",
      variables: ["x"],
      confounders: [],
      expectedResult: "y steigt",
      alternativeExplanations: [],
      evidenceIds: ["EVD-ALT"],
      replicationCount: 1,
      status: "COMPLETED",
      progress: 100,
      knowledgeState: "SUPPORTED"
    }
  ],
  evidence: [{evidenceId: "EVD-ALT", experimentId: "EXP-ALT", kind: "OBSERVATION", claim: "beobachtet", value: "1", observedAt: "2026-09-01T00:00:00.000Z", knowledgeState: "OBSERVED"}],
  runs: [{experimentRunId: "RUN-ALT", experimentId: "EXP-ALT", kind: "BASELINE", sandboxId: "SB-ALT", argv: ["echo", "x"], accepted: true, exitCode: 0, message: "ok", observedAt: "2026-09-01T00:00:00.000Z", repeat: 1}],
  decisions: []
};

function writeEnvelope(file: string, version: number, payload: unknown) {
  const digest = crypto.createHash("sha256").update(JSON.stringify({version, payload})).digest("hex");
  fs.writeFileSync(file, JSON.stringify({version, writtenAt: new Date().toISOString(), payload, digest}, null, 2));
}

beforeEach(async () => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "bob-science-migration-"));
  process.env.BOB_STORAGE_DIR = root;
  process.env.BOB_SANDBOX_RUNTIME = "local";
  process.env.BOB_BOOTSTRAP_SECRET = TEST_BOOTSTRAP_SECRET;
  vi.resetModules();
  writeEnvelope(path.join(root, "science.json"), 2, legacyPayload);
});

afterEach(() => {
  delete process.env.BOB_STORAGE_DIR;
  delete process.env.BOB_BOOTSTRAP_SECRET;
  fs.rmSync(root, {recursive: true, force: true});
});

describe("Science-Store-Migration", () => {
  it("migriert einen v2-Bestand, behält die Experimente und ergänzt die Messwerte", async () => {
    const {readMigrationJournal} = await import("../../lib/persistence/store");
    const science = await import("../../lib/science");

    const payload = science.listScience();
    expect(payload.measurements).toEqual([]);
    expect(payload.experiments).toHaveLength(1);
    expect(payload.experiments[0].experimentId).toBe("EXP-ALT");
    expect(payload.experiments[0].knowledgeState).toBe("SUPPORTED");
    expect(payload.runs).toHaveLength(1);

    const file = path.join(root, "science.json");
    const onDisk = JSON.parse(fs.readFileSync(file, "utf8")) as {version: number; payload: {measurements: unknown[]}};
    expect(onDisk.version).toBe(3);
    expect(Array.isArray(onDisk.payload.measurements)).toBe(true);

    const safety = `${file}.pre-v2.bak`;
    expect(fs.existsSync(safety)).toBe(true);
    expect(JSON.parse(fs.readFileSync(safety, "utf8")).version).toBe(2);

    const journal = readMigrationJournal().filter(entry => entry.store === "science");
    expect(journal).toHaveLength(1);
    expect(journal[0]).toMatchObject({fromVersion: 2, toVersion: 3});
  });

  it("nimmt nach der Migration neue Messwerte an", async () => {
    const science = await import("../../lib/science");
    expect(science.listScience().measurements).toEqual([]);

    const measurement = science.addMeasurement({experimentId: "EXP-ALT", group: "BASELINE", label: "dauer-ms", value: 100});
    expect(measurement.measurementId).toMatch(/^MEA-/);
    expect(science.listMeasurements("EXP-ALT")).toHaveLength(1);

    // Persistiert, nicht nur im Speicher: die Datei enthält den Messwert.
    const onDisk = JSON.parse(fs.readFileSync(path.join(root, "science.json"), "utf8")) as {payload: {measurements: Array<{measurementId: string}>}};
    expect(onDisk.payload.measurements.map(entry => entry.measurementId)).toContain(measurement.measurementId);
  });
});
