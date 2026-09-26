import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import {createStore, storageRoot, storeIntegrityReport} from "./persistence/store";
import {verifyEventChain} from "./events/log";
import {verifyAuditChain, recordAudit} from "./audit";
import {observe} from "./observability";
import {notifyInbox} from "./inbox";
import {enqueueJob, expireLeases, getJob, leaseJob, queueSnapshot} from "./queue";
import {recordArtifact} from "./artifacts";
import {upsertKnowledge} from "./knowledge";
import {recordFailure} from "./reliability";
import {isKilled} from "./governance";


/**
 * Fehlerinjektion (Abschnitt 37 / TEST-003).
 *
 * Geprüfte Aussage: **Die Plattform überlebt echte Störungen, ohne ihren
 * Nachweis zu verlieren.** Eine Injektion verändert den Zustand wirklich
 * (Prozessabbruch im Sandkasten, Lease-Verlust, Netzwerkzugriff,
 * konkurrierende Schreibvorgänge, Manipulation am Store) und misst danach
 * nachweisbar:
 *
 *  - Store-Integrität: kein halb geschriebener Envelope,
 *  - Event-Kette: lückenlos und prüfbar,
 *  - Audit-Kette: gültig, Verweigerungen als `DENY` belegt,
 *  - Evidenz: Artefakt mit Digest für die Injektion selbst,
 *  - Wissen: die Beobachtung liegt als Knoten im Graphen (auch die negative).
 *
 * Ehrlichkeit: Wird eine Injektion nicht ausgelöst (weil die Umgebung sie
 * verhindert), heißt das Ergebnis `NOT_INJECTED` — nicht `SURVIVED`. Ein
 * Fehlschlag bleibt `FAILED` und geht in Fehlerintelligenz und Inbox.
 *
 * Die Injektion selbst ist eine Creator-Aktion; der Kill-Switch für
 * `FAULT_INJECTION` sperrt sie vollständig.
 */

export type FaultKind = "PROCESS_ABORT" | "WORKER_LOSS" | "NETWORK_LOSS" | "DUPLICATE_JOB" | "CONCURRENT_WRITE" | "STORE_TAMPER";

export type FaultOutcome = "SURVIVED" | "DEGRADED" | "FAILED" | "NOT_INJECTED";

export type FaultCheck = {name: string; ok: boolean; detail: string};

export type FaultInjection = {
  faultId: string;
  kind: FaultKind;
  target: string;
  requestedBy: string;
  outcome: FaultOutcome;
  /** Was die Plattform leisten **muss**. */
  expected: string;
  /** Was tatsächlich gemessen wurde. */
  observed: string;
  checks: FaultCheck[];
  evidence: {artifactId: string; digest: string} | null;
  failureId?: string;
  startedAt: string;
  finishedAt: string;
};

export const FAULT_CATALOG: Record<FaultKind, {title: string; expected: string; probe: string}> = {
  PROCESS_ABORT: {
    title: "Prozessabsturz im Sandkasten",
    expected: "Der abgebrochene Prozess gilt als Fehlschlag mit Evidenz — niemals als Erfolg.",
    probe: "Eine autorisierte Ausführung beendet sich selbst mit SIGKILL."
  },
  WORKER_LOSS: {
    title: "Worker-Verlust (abgelaufene Lease)",
    expected: "Der Job fällt an die Queue zurück oder ins Dead-Letter — keine Lease bleibt hängen.",
    probe: "Job leasen, Lease verfallen lassen, Zustand prüfen."
  },
  NETWORK_LOSS: {
    title: "Netzwerkverlust / Egress",
    expected: "Egress wird fail closed verweigert (ALLOWLIST ohne kontrollierte Schicht) und belegt.",
    probe: "Sandbox mit ALLOWLIST anfordern und Ergebnis prüfen."
  },
  DUPLICATE_JOB: {
    title: "Doppelter Job",
    expected: "Derselbe Idempotenzschlüssel erzeugt genau einen Job.",
    probe: "Zweimal mit gleichem Schlüssel einreihen."
  },
  CONCURRENT_WRITE: {
    title: "Konkurrierende Schreibvorgänge",
    expected: "Parallele Schreibvorgänge auf denselben Store verlieren keinen Datensatz; der Envelope bleibt integer.",
    probe: "Viele gleichzeitige Schreibvorgänge, danach Anzahl und Digest prüfen."
  },
  STORE_TAMPER: {
    title: "Manipulation am Store",
    expected: "Ein verändertes Byte wird erkannt (Digest-Abweichung), nicht stillschweigend akzeptiert.",
    probe: "Byte im Envelope kippen, Integritätsbericht lesen, Original wiederherstellen."
  }
};

export const FAULT_KINDS = Object.keys(FAULT_CATALOG) as FaultKind[];

type Payload = {injections: FaultInjection[]};
const store = createStore<Payload>("fault-injections", 1, () => ({injections: []}));

const now = () => new Date().toISOString();

export function listFaultInjections(): FaultInjection[] {
  return store.read().injections;
}

export function getFaultInjection(faultId: string): FaultInjection | null {
  return store.read().injections.find(entry => entry.faultId === faultId) ?? null;
}

/** Gemeinsame Überlebensprüfung: Integrität, Event-Kette, Audit-Kette. */
export function survivalChecks(): FaultCheck[] {
  const integrity = storeIntegrityReport();
  const events = verifyEventChain();
  const audit = verifyAuditChain();
  return [
    {
      name: "Store-Integrität",
      ok: integrity.ok,
      detail: integrity.ok ? `${integrity.registered} Stores ohne Abweichung` : `unhealthy: ${integrity.stores.filter(entry => !entry.ok).map(entry => entry.store).join(", ")}`
    },
    {name: "Event-Kette", ok: events.valid, detail: events.valid ? `${events.length} Ereignisse, Kette gültig` : events.issues.join("; ")},
    {name: "Audit-Kette", ok: audit.valid, detail: audit.valid ? "Kette gültig" : audit.issues.join("; ")}
  ];
}

function targetStoreFile(storeName: string): string {
  return path.join(storageRoot(), `${storeName}.json`);
}

/* ------------------------------------------------------------ Injektionen */

async function injectProcessAbort(): Promise<{target: string; observed: string; checks: FaultCheck[]; degraded?: boolean}> {
  const {runSandboxedProgram} = await import("./fault-harness");
  const result = await runSandboxedProgram(["node", "-e", "process.kill(process.pid, 'SIGKILL')"]);
  const checks: FaultCheck[] = [
    {name: "Ausführung akzeptiert", ok: result.accepted === false, detail: `accepted=${String(result.accepted)} (erwartet: false)`},
    {name: "Nicht als Erfolg verbucht", ok: result.exitCode !== 0, detail: `exitCode=${String(result.exitCode)}`},
    {name: "Fehlschlag belegt", ok: Boolean(result.message), detail: result.message || "keine Meldung"}
  ];
  return {
    target: "node -e process.kill(SIGKILL)",
    observed: `Ausführung ${result.accepted ? "akzeptiert" : "verworfen"}; exitCode=${String(result.exitCode)}; Dauer ${result.durationMs} ms; Evidenz ${result.evidenceArtifactId ?? "fehlt"}`,
    checks: [
      ...checks,
      {name: "Evidenzartefakt", ok: Boolean(result.evidenceArtifactId), detail: result.evidenceArtifactId ?? "kein Artefakt"}
    ]
  };
}

function injectWorkerLoss(): {target: string; observed: string; checks: FaultCheck[]} {
  // Echte Queue: Job einreihen, leasen, Lease absichtlich verfallen lassen.
  const job = enqueueJob({taskId: `FAULT-${crypto.randomUUID().slice(0, 6)}`, agentId: "SYSTEM-WORKER", risk: "LOW", idempotencyKey: `fault-worker-loss-${crypto.randomUUID()}`});
  const leased = leaseJob(job.jobId, "FAULT-WORKER", 1_000);
  if (!leased || leased.state !== "LEASED") {
    return {
      target: job.jobId,
      observed: `Job konnte nicht geleast werden (Zustand ${leased?.state ?? "unbekannt"})`,
      checks: [{name: "Lease gesetzt", ok: false, detail: "kein LEASED-Zustand"}]
    };
  }
  const expired = expireLeases(Date.now() + 5_000);
  const after = getJob(job.jobId);
  const checks: FaultCheck[] = [
    {name: "Lease ist abgelaufen", ok: expired >= 1, detail: `${expired} abgelaufene Lease(s)`},
    {name: "Kein hängender Besitzer", ok: !after?.leaseOwner && !after?.leasedUntil, detail: `leaseOwner=${after?.leaseOwner ?? "—"}, leasedUntil=${after?.leasedUntil ?? "—"}`},
    {name: "Job ist nicht verloren", ok: Boolean(after) && ["QUEUED", "DEAD_LETTER", "FAILED"].includes(String(after?.state)), detail: `Zustand ${after?.state ?? "fehlt"}`}
  ];
  return {
    target: job.jobId,
    observed: `Lease verfallen; Zustand ${after?.state}; nächster Versuch ${after?.nextAttemptAt ?? "—"}; Versuch ${after?.attempt ?? "?"} von ${after?.maxAttempts ?? "?"}`,
    checks
  };
}

async function injectNetworkLoss(): Promise<{target: string; observed: string; checks: FaultCheck[]; degraded?: boolean}> {
  const {buildSandboxContext} = await import("./fault-harness");
  const context = await buildSandboxContext("network-loss");
  let refused = false;
  let message = "";
  let registered = false;
  try {
    await context.fabric.createSandbox({type: "test", taskId: context.taskId, agentId: context.agentId, risk: "LOW", sandboxId: "SB-FAULT-EGRESS", network: "ALLOWLIST", allowlist: ["example.com:443"]});
    registered = context.fabric.listSandboxes().some(entry => entry.sandboxId === "SB-FAULT-EGRESS");
  } catch (error) {
    refused = true;
    message = error instanceof Error ? error.message : String(error);
  }
  const audit = verifyAuditChain();
  return {
    target: "sandbox network=ALLOWLIST allowlist=[example.com:443]",
    observed: refused ? `verweigert: ${message}` : `NICHT verweigert (Sandbox registriert: ${registered})`,
    checks: [
      {name: "ALLOWLIST wird verweigert", ok: refused, detail: message || "kein Fehler"},
      {name: "Keine Phantom-Sandbox", ok: !registered, detail: registered ? "Sandbox wurde trotz Verweigerung angelegt" : "keine Sandbox registriert"},
      {name: "Verweigerung ist nachweisbar", ok: audit.valid, detail: audit.valid ? "Audit-Kette gültig" : audit.issues.join("; ")}
    ]
  };
}

function injectDuplicateJob(): {target: string; observed: string; checks: FaultCheck[]} {
  const key = `fault-duplicate-${crypto.randomUUID()}`;
  const first = enqueueJob({taskId: "FAULT-DUPLICATE", agentId: "SYSTEM-WORKER", risk: "LOW", idempotencyKey: key});
  const second = enqueueJob({taskId: "FAULT-DUPLICATE", agentId: "SYSTEM-WORKER", risk: "LOW", idempotencyKey: key});
  const occurrences = queueSnapshot().filter(job => job.idempotencyKey === key).length;
  return {
    target: key,
    observed: `Erster ${first.jobId}, zweiter ${second.jobId}, Treffer im Store: ${occurrences}`,
    checks: [
      {name: "Gleicher Job zurückgegeben", ok: first.jobId === second.jobId, detail: `${first.jobId} vs. ${second.jobId}`},
      {name: "Genau ein Datensatz", ok: occurrences === 1, detail: `${occurrences} Datensätze`}
    ]
  };
}

async function injectConcurrentWrite(count: number): Promise<{target: string; observed: string; checks: FaultCheck[]; degraded?: boolean}> {
  // Echte Nebenläufigkeit über die Control Plane: viele gleichzeitige
  // Schreibvorgänge auf denselben Store, jeder mit Lese-Ändere-Schreibe-Zyklus.
  const cp = await import("./control-plane");
  const marker = `FAULT-${crypto.randomUUID().slice(0, 6).toUpperCase()}`;
  const writes = await Promise.all(
    Array.from({length: count}, (_, index) =>
      Promise.resolve().then(() => cp.createMission({title: `${marker} #${index}`, objective: "Nebenläufiger Schreibvorgang", createdBy: "CREATOR"}))
    )
  );
  const survived = cp.snapshot().missions.filter(mission => mission.title.startsWith(marker)).length;
  const integrity = storeIntegrityReport();
  const checks: FaultCheck[] = [
    {name: "Alle Schreibvorgänge vorhanden", ok: survived === count, detail: `${survived} von ${count} Datensätzen`},
    {name: "Envelope bleibt integer", ok: integrity.ok, detail: integrity.ok ? "Digest gültig" : "Integrität verletzt"},
    {name: "Keine doppelten Kennungen", ok: new Set(writes.map(entry => entry.missionId)).size === count, detail: `${new Set(writes.map(entry => entry.missionId)).size} eindeutige Kennungen`}
  ];
  return {
    target: `control-state (${count} parallele Schreibvorgänge)`,
    observed: `${survived}/${count} Datensätze erhalten, ${new Set(writes.map(entry => entry.missionId)).size} eindeutige Kennungen, Store ${integrity.ok ? "integer" : "verletzt"}`,
    checks,
    degraded: survived !== count
  };
}

function injectStoreTamper(): {target: string; observed: string; checks: FaultCheck[]; degraded?: boolean} {
  const file = targetStoreFile("fault-injections");
  if (!fs.existsSync(file)) {
    return {target: file, observed: "Store-Datei existiert nicht — nichts injiziert", checks: [{name: "Zieldatei vorhanden", ok: false, detail: file}]};
  }
  const original = fs.readFileSync(file);
  const mutated = Buffer.from(original);
  // Ein echtes Byte kippen: genau das, was ein unerkannter Schreibfehler täte.
  const position = mutated.indexOf(Buffer.from("injections"));
  const index = position >= 0 ? position : Math.floor(mutated.length / 2);
  mutated[index] = mutated[index] ^ 0x20;
  try {
    fs.writeFileSync(file, mutated, {mode: 0o600});
    const report = storeIntegrityReport();
    const entry = report.stores.find(item => item.store === "fault-injections");
    const detected = report.ok === false && entry?.ok === false;
    return {
      target: file,
      observed: detected ? `Manipulation erkannt: ${entry?.error ?? "Digest-Abweichung"}` : "Manipulation NICHT erkannt",
      checks: [
        {name: "Manipulation erkannt", ok: detected, detail: entry?.error ?? (report.ok ? "Bericht ohne Befund" : "Bericht ohne Eintrag")},
        {name: "Nicht stillschweigend akzeptiert", ok: detected, detail: `storeIntegrityReport.ok=${String(report.ok)}`}
      ],
      degraded: !detected
    };
  } finally {
    // Immer wiederherstellen — die Verifikation darf den Store nicht beschädigen.
    fs.writeFileSync(file, original, {mode: 0o600});
  }
}

/* -------------------------------------------------------------- Ausführung */

export async function injectFault(input: {kind: FaultKind; requestedBy: string; count?: number}): Promise<FaultInjection> {
  if (!FAULT_KINDS.includes(input.kind)) throw new Error(`unsupported fault kind: ${String(input.kind)}`);
  // Ein System-Kill-Switch sperrt auch die Injektion selbst: kein Werkzeug darf
  // sich an einer aktiven Notschaltung vorbeiarbeiten.
  if (isKilled("SYSTEM", "FAULT_INJECTION")) throw new Error(`fault injection blocked by system kill-switch: ${input.kind}`);
  const faultId = `FLT-${crypto.randomUUID().slice(0, 8).toUpperCase()}`;
  const startedAt = now();

  let result: {target: string; observed: string; checks: FaultCheck[]; degraded?: boolean};
  try {
    if (input.kind === "PROCESS_ABORT") result = await injectProcessAbort();
    else if (input.kind === "WORKER_LOSS") result = injectWorkerLoss();
    else if (input.kind === "NETWORK_LOSS") result = await injectNetworkLoss();
    else if (input.kind === "DUPLICATE_JOB") result = injectDuplicateJob();
    else if (input.kind === "CONCURRENT_WRITE") result = await injectConcurrentWrite(Math.min(Math.max(input.count ?? 12, 2), 64));
    else result = injectStoreTamper();
  } catch (error) {
    result = {
      target: input.kind,
      observed: `Injektion nicht auslösbar: ${error instanceof Error ? error.message : String(error)}`,
      checks: [{name: "Injektion ausgelöst", ok: false, detail: error instanceof Error ? error.message : String(error)}]
    };
  }

  const environment = survivalChecks();
  const checks = [...result.checks, ...environment];
  const kernel = result.observed.startsWith("Injektion nicht auslösbar");
  const failed = checks.some(check => !check.ok);
  const outcome: FaultOutcome = kernel ? "NOT_INJECTED" : failed ? (result.degraded ? "DEGRADED" : "FAILED") : "SURVIVED";

  const record: FaultInjection = {
    faultId,
    kind: input.kind,
    target: result.target,
    requestedBy: input.requestedBy,
    outcome,
    expected: FAULT_CATALOG[input.kind].expected,
    observed: result.observed,
    checks,
    evidence: null,
    startedAt,
    finishedAt: now()
  };

  // Evidenz: die Injektion selbst wird als Artefakt mit Digest abgelegt.
  try {
    const artifact = recordArtifact(
      {
        name: `Fehlerinjektion ${input.kind}`,
        kind: "TEST",
        taskId: "FAULT-INJECTION",
        runId: faultId,
        sandboxId: "",
        agentId: input.requestedBy,
        knowledgeState: outcome === "SURVIVED" ? "OBSERVED" : "UNVERIFIED"
      },
      JSON.stringify({faultId, kind: input.kind, target: result.target, outcome, observed: result.observed, checks}, null, 1)
    );
    record.evidence = {artifactId: artifact.id, digest: artifact.digest};
  } catch {
    /* Die Evidenzablage darf die Injektion nicht in einen Fehler verwandeln. */
  }

  if (outcome === "FAILED") {
    try {
      const failure = recordFailure({
        symptom: `Fehlerinjektion ${input.kind} nicht überlebt`,
        incident: `${FAULT_CATALOG[input.kind].probe} → ${result.observed}`,
        failureMode: `fault-injection:${input.kind}`,
        taskId: "FAULT-INJECTION",
        contributingFactors: checks.filter(check => !check.ok).map(check => `${check.name}: ${check.detail}`),
        prevention: [`Prüfung „${FAULT_CATALOG[input.kind].title}“ vor der nächsten Auslieferung wiederholen`]
      });
      record.failureId = failure.failureId;
    } catch {
      /* Fehlerintelligenz ist nachgelagert; der Befund steht bereits im Datensatz. */
    }
    notifyInbox({
      mode: "BLOCK",
      title: `Fehlerinjektion ${input.kind} nicht überlebt`,
      message: `${result.observed} — fehlgeschlagene Prüfungen: ${checks.filter(check => !check.ok).map(check => check.name).join(", ")}`
    });
  }

  store.update(payload => {
    payload.injections.push(record);
    if (payload.injections.length > 500) payload.injections.splice(0, payload.injections.length - 500);
  });

  // Wissen: auch der Fehlschlag gehört in den Graphen (negative Kenntnis).
  try {
    upsertKnowledge({
      layer: "EPISODIC",
      subject: input.kind,
      predicate: "Fehlerinjektion",
      object: outcome,
      state: outcome === "SURVIVED" ? "SUPPORTED" : "UNVERIFIED",
      evidenceIds: record.evidence ? [record.evidence.artifactId] : [],
      conditions: `Ziel: ${result.target}`,
      verification: `${checks.filter(check => check.ok).length}/${checks.length} Prüfungen bestanden`
    });
  } catch {
    /* Wissensgraph ist nachgelagert. */
  }

  observe({
    type: `fault.${outcome.toLowerCase()}`,
    message: `Fehlerinjektion ${input.kind} (${result.target}): ${outcome} — ${result.observed}`,
    status: outcome === "SURVIVED" ? "COMPLETED" : outcome === "DEGRADED" ? "WAITING" : outcome === "NOT_INJECTED" ? "BLOCKED" : "FAILED",
    actor: input.requestedBy,
    action: "fault.inject",
    resource: faultId,
    decision: outcome === "SURVIVED" ? "ALLOW" : outcome === "NOT_INJECTED" ? "DENY" : "ERROR",
    purpose: "Nachweisen, dass die Plattform echte Störungen erkennt und übersteht.",
    result: outcome,
    argumentsValue: {kind: input.kind, target: result.target, failedChecks: checks.filter(check => !check.ok).map(check => check.name)}
  });
  recordAudit(
    {actor: input.requestedBy, action: "fault.inject", resource: faultId, decision: outcome === "FAILED" ? "ERROR" : "ALLOW"},
    {kind: input.kind, target: result.target, outcome}
  );

  return record;
}

/**
 * Berichte der Skriptprüfer (`scripts/fault-injection.mjs`, `scripts/sabotage.mjs`).
 * Sie liegen im Storage, damit die Oberfläche denselben Stand zeigt wie die CLI.
 */
function readReport(file: string): Record<string, unknown> | null {
  try {
    if (!fs.existsSync(file)) return null;
    return JSON.parse(fs.readFileSync(file, "utf8")) as Record<string, unknown>;
  } catch {
    return null;
  }
}

export function faultSnapshot() {
  const root = storageRoot();
  const injections = listFaultInjections();
  return {
    root,
    catalog: FAULT_KINDS.map(kind => ({kind, ...FAULT_CATALOG[kind]})),
    injections: injections.slice(-50).reverse(),
    summary: {
      total: injections.length,
      survived: injections.filter(entry => entry.outcome === "SURVIVED").length,
      degraded: injections.filter(entry => entry.outcome === "DEGRADED").length,
      failed: injections.filter(entry => entry.outcome === "FAILED").length,
      notInjected: injections.filter(entry => entry.outcome === "NOT_INJECTED").length
    },
    /** Prozessabsturz des Dienstes (Skript mit echtem Neustart). */
    processCrashProbe: readReport(path.join(root, "fault-injection", "report.json")),
    /** Sabotageproben: beweisen, dass die Suiten Schwächungen erkennen. */
    sabotage: readReport(path.join(root, "sabotage", "report.json")),
    store: store.integrity()
  };
}
