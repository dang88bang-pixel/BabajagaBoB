import {spawn} from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import {afterEach, beforeAll, describe, expect, it, vi} from "vitest";
import {isolatedStorageRoot, TEST_BOOTSTRAP_SECRET} from "../helpers/runtime";

/**
 * Fehlerinjektion auf **Prozessebene** (Abschnitt 37.14 / Abnahmeplan TEST-003).
 *
 * Die Suite `tests/integration/fault-injection.test.ts` prüft dieselben
 * Fehlerarten über den Injektions-Harness im eigenen Prozess. Hier geht es um
 * die Fälle, die sich dort nicht ehrlich nachstellen lassen, weil sie einen
 * **zweiten, echten Betriebssystemprozess** brauchen:
 *
 *  1. Harter Abbruch (SIGKILL) mitten im Schreibvorgang: Der Datensatz muss
 *     integer bleiben, der Store weiter beschreibbar und frei von Resten.
 *  2. Vier gleichzeitige Writer-Prozesse auf denselben Store: keine
 *     Aktualisierung darf verloren gehen (plus Gegenprobe, die den Verlust
 *     bei unbedingtem Überschreiben belegt — sonst wäre der Test wertlos).
 *  3. Worker-Verlust: Lease läuft ab, der Job geht zurück in die Queue und wird
 *     von einem zweiten Worker übernommen.
 *  4. Netzwerkverlust nach erreichbarem Ziel, ausgeführt über den echten Pfad
 *     Dispatcher → Worker-Schritt → Broker mit Evidenz und Audit.
 *
 * `scripts/sabotage.mjs` mutiert genau diese Datei: Wer eine der Garantien
 * entfernt, muss hier rot werden.
 */

const root = isolatedStorageRoot("fault-injection-processes");
const STORE_HELPER = path.join(process.cwd(), "tests", "helpers", "concurrent-writer.ts");

let bootstrap: typeof import("../../lib/bootstrap");
let cp: typeof import("../../lib/control-plane");
let fabric: typeof import("../../lib/sandbox/fabric");
let dispatcher: typeof import("../../lib/dispatcher");
let artifacts: typeof import("../../lib/artifacts");
let runtimeFactory: typeof import("../../lib/runtime-factory");
let queue: typeof import("../../lib/queue");
let runs: typeof import("../../lib/runs");
let reliability: typeof import("../../lib/reliability");

const AGENT = "AG-BUILD";

function writerEnv(storeRoot: string) {
  return {...process.env, BOB_STORAGE_DIR: storeRoot, NODE_NO_WARNINGS: "1"};
}

/** Startet n gleichzeitige Writer-Prozesse und wartet auf alle. */
function spawnWriters(storeRoot: string, count: number, iterations: number, mode: "update" | "write") {
  const children = Array.from({length: count}, () =>
    spawn(process.execPath, ["--experimental-strip-types", STORE_HELPER, storeRoot, "fault-counter", String(iterations), mode], {
      env: writerEnv(storeRoot),
      stdio: ["ignore", "pipe", "pipe"]
    })
  );
  return Promise.all(
    children.map(
      child =>
        new Promise<number>((resolve, reject) => {
          child.on("error", reject);
          child.on("exit", code => resolve(code ?? -1));
        })
    )
  );
}

/** Startet einen einzelnen Writer-Prozess (Nachweis, dass wieder geschrieben werden kann). */
async function writeOnce(storeRoot: string): Promise<number> {
  const [code] = await spawnWriters(storeRoot, 1, 1, "update");
  return code;
}

type CounterEnvelope = {version: number; payload: {counter: number; writers: string[]}; digest: string; revision?: number};

function readCounter(storeRoot: string): CounterEnvelope {
  return JSON.parse(fs.readFileSync(path.join(storeRoot, "fault-counter.json"), "utf8")) as CounterEnvelope;
}

beforeAll(async () => {
  vi.resetModules();
  process.env.BOB_NS_ISOLATION = "off";
  bootstrap = await import("../../lib/bootstrap");
  cp = await import("../../lib/control-plane");
  fabric = await import("../../lib/sandbox/fabric");
  dispatcher = await import("../../lib/dispatcher");
  artifacts = await import("../../lib/artifacts");
  runtimeFactory = await import("../../lib/runtime-factory");
  queue = await import("../../lib/queue");
  runs = await import("../../lib/runs");
  reliability = await import("../../lib/reliability");
  bootstrap.completeBootstrap({secret: TEST_BOOTSTRAP_SECRET, creatorName: "Fehlerinjektion Prozesse"});
});

afterEach(() => {
  delete process.env.BOB_NS_ISOLATION;
});

describe("Fehlerinjektion: Prozessabbruch", () => {
  it("hinterlässt nach SIGKILL mitten im Schreiben keinen halben Datensatz", async () => {
    const crashRoot = fs.mkdtempSync(path.join(root, "crash-"));
    const child = spawn(process.execPath, ["--experimental-strip-types", STORE_HELPER, crashRoot, "fault-counter", "999999", "crash"], {
      env: writerEnv(crashRoot),
      stdio: ["ignore", "ignore", "ignore"]
    });

    // Warten, bis der Prozess wirklich schreibt, dann hart abbrechen (SIGKILL:
    // kein Aufräumpfad, kein `finally`, keine Chance zu flushen).
    await new Promise(resolve => setTimeout(resolve, 800));
    child.kill("SIGKILL");
    const exit = await new Promise<number | null>(resolve => child.on("exit", (code, signal) => resolve(signal === "SIGKILL" ? 137 : code)));
    expect([137, null]).toContain(exit);

    // Der Datensatz ist danach vollständig lesbar: Der Envelope passt zu seinem
    // Digest, und die Invariante des Writers (Zähler = Anzahl Einträge) gilt —
    // es gibt keinen halb geschriebenen Zustand, weil atomar über `rename`
    // geschrieben wird.
    const crashed = readCounter(crashRoot);
    expect(crashed.payload.counter).toBe(crashed.payload.writers.length);
    expect(crashed.payload.counter).toBeGreaterThan(0);

    // Der Store ist weiter beschreibbar: keine verwaiste Sperre blockiert ihn,
    // und es bleibt keine tmp-Datei zurück, die als Datensatz gelten könnte.
    // Der Writer liest den Datensatz dabei über den echten Pfad — bei einem
    // halben oder digest-falschen Envelope würde er mit Fehler abbrechen.
    expect(await writeOnce(crashRoot)).toBe(0);
    const after = readCounter(crashRoot);
    expect(after.payload.counter).toBe(crashed.payload.counter + 1);
    const stray = fs.readdirSync(crashRoot).filter(name => !name.startsWith(".") && !name.endsWith(".json") && !name.endsWith(".jsonl") && !name.endsWith(".bak"));
    expect(stray).toEqual([]);
  });
});

describe("Fehlerinjektion: konkurrierende Schreibvorgänge", () => {
  it("verliert bei vier echten Writer-Prozessen keine Aktualisierung", async () => {
    const concurrentRoot = fs.mkdtempSync(path.join(root, "concurrent-"));
    const perWriter = 60;
    const codes = await spawnWriters(concurrentRoot, 4, perWriter, "update");
    expect(codes).toEqual([0, 0, 0, 0]);

    const result = readCounter(concurrentRoot);
    expect(result.payload.writers).toHaveLength(4 * perWriter);
    expect(new Set(result.payload.writers).size).toBe(4 * perWriter);
    expect(result.payload.counter).toBe(4 * perWriter);
    // Die Revision zählt die Schreibvorgänge: sie muss mindestens der Anzahl
    // erfolgreicher Aktualisierungen entsprechen (Retries zählen mit).
    expect(result.revision ?? 0).toBeGreaterThanOrEqual(4 * perWriter);
  });

  it("erkennt den Verlust bei unbedingtem Überschreiben (Gegenprobe)", async () => {
    // Ohne Nebenläufigkeitskontrolle (`write` überschreibt bedingungslos) geht
    // nachweislich etwas verloren. Ohne diesen Nachweis wäre der Test oben kein
    // Beweis: Er könnte auch grün sein, weil die Prozesse zufällig nacheinander
    // liefen.
    const lossyRoot = fs.mkdtempSync(path.join(root, "lossy-"));
    const perWriter = 60;
    const codes = await spawnWriters(lossyRoot, 4, perWriter, "write");
    expect(codes).toEqual([0, 0, 0, 0]);
    const result = readCounter(lossyRoot);
    expect(result.payload.writers.length).toBeLessThan(4 * perWriter);
  });
});

describe("Fehlerinjektion: Worker-Verlust", () => {
  it("lässt einen verwaisten Job nach Lease-Ablauf von einem zweiten Worker ausführen", async () => {
    const mission = cp.createMission({title: "Lease", objective: "Worker-Verlust", createdBy: "CREATOR"});
    const task = cp.createTask({missionId: mission.missionId, title: "Lease-Task", risk: "LOW", assignedAgent: AGENT, createdBy: "CREATOR"});
    const job = queue.enqueueJob({
      taskId: task.taskId,
      agentId: AGENT,
      risk: "LOW",
      idempotencyKey: `lease-${task.taskId}`,
      timeoutMs: 1_000,
      backoffMs: 1
    });

    // Worker A nimmt den Job und verschwindet danach (kein Abschluss, kein Heartbeat).
    const leased = queue.claimNextJob("worker-a", 1_000);
    expect(leased?.jobId).toBe(job.jobId);
    expect(queue.startJob(job.jobId, "worker-a")?.state).toBe("RUNNING");

    // Die Lease ist abgelaufen: Der Job darf nicht ewig „RUNNING" bleiben.
    const expired = queue.expireLeases(Date.now() + 5_000);
    expect(expired).toBeGreaterThanOrEqual(1);
    const afterExpiry = queue.getJob(job.jobId);
    expect(afterExpiry?.state).toBe("QUEUED");
    expect(afterExpiry?.leaseOwner).toBeUndefined();

    // Worker B übernimmt denselben Job — genau einmal, mit gezähltem Versuch.
    await new Promise(resolve => setTimeout(resolve, 20));
    const retaken = queue.claimNextJob("worker-b", 60_000);
    expect(retaken?.jobId).toBe(job.jobId);
    expect(queue.startJob(job.jobId, "worker-b")?.state).toBe("RUNNING");
    expect(queue.completeJob(job.jobId, "worker-b")?.state).toBe("SUCCEEDED");
    expect(queue.getJob(job.jobId)?.attempt).toBe(2);

    // Ein bereits abgeschlossener Job wird nicht erneut vergeben, und der
    // Lease-Ablauf wird nicht als echter Fehlversuch des Laufs verbucht.
    expect(queue.claimNextJob("worker-c", 60_000)?.jobId).toBeUndefined();
    expect(reliability.listFailures().filter(failure => failure.taskId === task.taskId)).toHaveLength(0);
  });
});

describe("Fehlerinjektion: Netzwerkverlust", () => {
  it("meldet den Ausfall über den echten Ausführungspfad ehrlich", async () => {
    const server = http.createServer((_request, response) => {
      response.writeHead(200, {"content-type": "text/plain"}).end("erreichbar");
    });
    await new Promise<void>(resolve => server.listen(0, "127.0.0.1", () => resolve()));
    const address = server.address();
    const port = typeof address === "object" && address ? address.port : 0;

    const mission = cp.createMission({title: "Netz", objective: "Netzwerkverlust", createdBy: "CREATOR"});
    const task = cp.createTask({missionId: mission.missionId, title: "Netz-Task", risk: "LOW", assignedAgent: AGENT, createdBy: "CREATOR"});

    // Kein Shell-String (die argv-Policy verbietet Interpreter und
    // Metazeichen): Der Abruf läuft als Argument in `node -e`.
    const fetchScript = `fetch('http://127.0.0.1:${port}/').then(function(r){return r.text()}).then(function(t){process.stdout.write(t)}).catch(function(e){process.stdout.write('FEHLER '+String(e)),process.exit(3)})`;

    // Ausgeführt wird über den echten Pfad: `dispatchTask` erzeugt Sandbox, Run
    // und Job, `runOnce` least, startet, führt aus und schließt Job und Run ab.
    const execute = async (key: string) => {
      const dispatched = await dispatcher.dispatchTask({
        taskId: task.taskId,
        agentId: AGENT,
        risk: "LOW",
        sandboxType: "test",
        idempotencyKey: `net-${task.taskId}-${key}`
      });
      const handle = runtimeFactory.runtimeHandle(dispatched.sandboxId);
      if (!handle || handle.state !== "RUNNING") await fabric.startSandbox(dispatched.sandboxId);
      const outcome = await dispatcher.runOnce({runId: dispatched.runId, workerId: "worker-netz", argv: ["node", "-e", fetchScript]});
      return {runId: dispatched.runId, jobId: dispatched.jobId, outcome};
    };

    // Erst läuft es echt: Das Ziel ist erreichbar, die Ausgabe kommt an.
    const before = await execute("vorher");
    expect(before.outcome.accepted).toBe(true);
    const beforeEvidence = artifacts.artifactSnapshot({runId: before.runId}).find(entry => entry.kind === "EXECUTION");
    expect(beforeEvidence, "erfolgreiche Ausführung muss Evidenz hinterlassen").toBeDefined();
    expect(beforeEvidence?.content).toContain("erreichbar");
    expect(artifacts.verifyArtifact(beforeEvidence?.id ?? "").ok).toBe(true);

    // Netzwerkverlust: Der Dienst verschwindet.
    await new Promise<void>(resolve => server.close(() => resolve()));

    const after = await execute("nachher");
    // Kein stiller Erfolg: Der echte Pfad muss den Ausfall als Fehlschlag
    // zurückmelden und den Run in einen Fehlerzustand überführen.
    expect(after.outcome.accepted).toBe(false);
    const afterEvidence = artifacts.artifactSnapshot({runId: after.runId}).find(entry => entry.kind === "EXECUTION");
    expect(afterEvidence, "auch der Fehlschlag muss als Evidenz festgehalten werden").toBeDefined();
    expect(artifacts.verifyArtifact(afterEvidence?.id ?? "").ok, "Evidenz muss digest-gebunden unversehrt sein").toBe(true);
    expect((afterEvidence?.content ?? "").toLowerCase()).toMatch(/econnrefused|fetch failed|fehler|error/);
    const run = runs.getRun(after.runId);
    expect(run, "Lauf muss nach dem Fehlschlag auffindbar sein").not.toBeNull();
    expect(run?.state).toBe("FAILED");
    // Und der Job ist nicht stillschweigend „fertig": Er läuft nach Backoff
    // erneut oder ist endgültig gescheitert.
    const job = queue.getJob(after.jobId);
    expect(["QUEUED", "FAILED", "DEAD_LETTER"]).toContain(job?.state);
  });
});
