import crypto from "node:crypto";
import {
  ReleaseError,
  listReleaseIds,
  currentReleaseId,
  listReleases,
  readManifest,
  releaseRoot,
  runningBuildId,
  setCurrentRelease,
  verifyRelease
} from "./release";
import {createStore, storeIntegrityReport} from "./persistence/store";
import {verifyEventChain} from "./events/log";
import {verifyAuditChain} from "./audit";
import {isolationReport, requestedIsolation} from "./ns-isolation";
import {getPipeline, promote, type CheckKind, type Pipeline} from "./cicd";
import {promotionGate} from "./promotion";
import {recordArtifact} from "./artifacts";
import {approvalGranted} from "./approvals";
import {isKilled} from "./governance";
import {getControlState} from "./control-plane";
import {observe} from "./observability";
import {addProvenanceEdge, addProvenanceNode} from "./provenance";
import {notifyInbox} from "./inbox";

/**
 * Deployment (Abschnitt 24 / Zielkette „Deployment").
 *
 * Ein Deployment rollt einen **Release-Slot** (`lib/release.ts`) auf den
 * aktiven Platz aus und prüft danach mit echten Messungen, ob der laufende
 * Server den neuen Stand ausliefert. Es gibt keine Behauptung „erfolgreich":
 *
 *  - Ohne bestandene Promotion-Gates (Pipeline im Stand `SMOKE`, alle
 *    Prüfungen `PASSED`) und ohne **gewährte Creator-Freigabe** wird verweigert
 *    (`planDeployment` → `allowed: false` mit Gründen).
 *  - Ein aktiver Kill-Switch (`DEPLOYMENT`) oder System-Lockdown blockiert.
 *  - Der Release-Digest wird vor dem Ausrollen erneut geprüft; ein veränderter
 *    Slot wird nicht ausgerollt.
 *  - Nach dem Umschalten entscheidet die **Build-ID des laufenden Prozesses**:
 *    stimmt sie überein, ist das Deployment `ACTIVE`; sonst bleibt es `STAGED`
 *    mit `restartRequired: true`. Der Unterschied ist in der Oberfläche sichtbar.
 *  - Ein Rollback schaltet auf den vorherigen Slot zurück und misst danach
 *    erneut. Ohne vorherigen Slot gibt es kein Rollback (fail closed).
 *
 * Ehrliche Grenze (bleibt offen dokumentiert): Der **Prozess-Neustart** ist
 * nicht Teil dieses Moduls — die Control Plane kann sich nicht selbst neu
 * starten. Dafür gibt es `scripts/release-supervisor.sh`, das den Wechsel
 * durchführt, den Neustart ausführt, die Build-ID über HTTP prüft und bei
 * ausbleibender Gesundheit selbsttätig zurückrollt. Ein externer Orchestrator
 * (Kubernetes/Nomad) fehlt weiterhin und bleibt als Betriebshärtung offen.
 */

export type DeploymentState = "PREPARED" | "HEALTH_CHECKING" | "STAGED" | "ACTIVE" | "REJECTED" | "FAILED" | "ROLLED_BACK";

export type HealthCheck = {
  name: string;
  kind: "RELEASE_DIGEST" | "STORE" | "EVENT_CHAIN" | "AUDIT_CHAIN" | "ISOLATION" | "HTTP_APP" | "HTTP_ROOT";
  ok: boolean;
  detail: string;
  ms: number;
};

export type DeploymentTarget = "STAGING" | "PRODUCTION";

export type Deployment = {
  deploymentId: string;
  releaseId: string;
  releaseDigest: string;
  buildId: string;
  fromReleaseId: string | null;
  state: DeploymentState;
  target: DeploymentTarget;
  /**
   * Nicht bestandene, aber ausdrücklich **quittierte** Prüfungen (nur Staging).
   * Ein `SKIPPED` ohne Begründung ist keine Lücke, sondern eine Lücke — es wird
   * deshalb verlangt, dass die Prüfung einen Grund trägt; er steht hier sichtbar.
   */
  acknowledgedGaps: string[];
  pipelineId?: string;
  approvalId?: string;
  reasons: string[];
  health: HealthCheck[];
  /** Build-ID des laufenden Servers zum Zeitpunkt der Messung. */
  runningBuildId: string | null;
  runningReleaseId?: string | null;
  verifiedActive: boolean;
  restartRequired: boolean;
  requestedBy: string;
  startedAt: string;
  finishedAt?: string;
  rolledBackFrom?: string;
  supervisorHint: string;
};

type Payload = {deployments: Deployment[]};
const store = createStore<Payload>("deployments", 1, () => ({deployments: []}));

const clone = <T,>(value: T): T => structuredClone(value);
const now = () => new Date().toISOString();

export class DeploymentRejected extends Error {
  readonly reasons: string[];
  constructor(reasons: string[]) {
    super(`deployment rejected: ${reasons.join("; ")}`);
    this.name = "DeploymentRejected";
    this.reasons = reasons;
  }
}

function save(deployment: Deployment): Deployment {
  store.update(payload => {
    const index = payload.deployments.findIndex(entry => entry.deploymentId === deployment.deploymentId);
    if (index === -1) payload.deployments.push(deployment);
    else payload.deployments[index] = deployment;
  });
  return clone(deployment);
}

export function listDeployments(): Deployment[] {
  return clone(store.read().deployments);
}

export function getDeployment(deploymentId: string): Deployment | null {
  return clone(store.read().deployments.find(entry => entry.deploymentId === deploymentId) ?? null);
}

export function deploymentStoreReport() {
  return store.integrity();
}

/** Adresse, unter der sich die Plattform selbst erreicht (echte HTTP-Prüfung). */
export function selfUrl(): string {
  if (process.env.BOB_SELF_URL) return process.env.BOB_SELF_URL.replace(/\/$/, "");
  const port = process.env.PORT ?? "3000";
  return `http://127.0.0.1:${port}`;
}

async function probe(name: HealthCheck["name"], kind: HealthCheck["kind"], url: string, validate: (response: Response, body: string) => string | null): Promise<HealthCheck> {
  const started = Date.now();
  try {
    const response = await fetch(url, {signal: AbortSignal.timeout(5_000), cache: "no-store"});
    const body = await response.text();
    const problem = validate(response, body);
    return {name, kind, ok: problem === null, detail: problem ?? `HTTP ${response.status} in ${Date.now() - started} ms`, ms: Date.now() - started};
  } catch (error) {
    return {name, kind, ok: false, detail: `unreachable: ${error instanceof Error ? error.message : String(error)}`, ms: Date.now() - started};
  }
}

/**
 * Echte Health-Checks des Zielsystems. Keine Simulation: Der HTTP-Teil fragt den
 * laufenden Server, der Rest prüft die tatsächlichen Stores, Ketten und die
 * gemessene Isolation.
 */
export async function runHealthChecks(releaseId: string, base = selfUrl()): Promise<HealthCheck[]> {
  const checks: HealthCheck[] = [];

  const startedDigest = Date.now();
  try {
    const verified = verifyRelease(releaseId);
    checks.push({name: "Release-Digest", kind: "RELEASE_DIGEST", ok: verified.ok, detail: verified.ok ? verified.detail : `digest mismatch: ${verified.detail}`, ms: Date.now() - startedDigest});
  } catch (error) {
    checks.push({name: "Release-Digest", kind: "RELEASE_DIGEST", ok: false, detail: error instanceof Error ? error.message : String(error), ms: Date.now() - startedDigest});
  }

  const startedStore = Date.now();
  const integrity = storeIntegrityReport();
  checks.push({
    name: "Store-Integrität",
    kind: "STORE",
    ok: integrity.ok,
    detail: integrity.ok ? `${integrity.registered} Stores ohne Abweichung` : `unhealthy: ${integrity.stores.filter(entry => !entry.ok).map(entry => entry.store).join(", ") || "unregistered files"}`,
    ms: Date.now() - startedStore
  });

  const startedEvents = Date.now();
  const chain = verifyEventChain();
  checks.push({name: "Event-Kette", kind: "EVENT_CHAIN", ok: chain.valid, detail: chain.valid ? `${chain.length} Ereignisse, Kette gültig` : chain.issues.join("; "), ms: Date.now() - startedEvents});

  const startedAudit = Date.now();
  const audit = verifyAuditChain();
  checks.push({name: "Audit-Kette", kind: "AUDIT_CHAIN", ok: audit.valid, detail: audit.valid ? "Kette gültig" : audit.issues.join("; "), ms: Date.now() - startedAudit});

  const startedIsolation = Date.now();
  const requested = requestedIsolation();
  const isolation = isolationReport();
  const isolationOk = requested !== "on" || isolation.level === "NAMESPACES";
  checks.push({
    name: "Isolation",
    kind: "ISOLATION",
    ok: isolationOk,
    detail: isolationOk ? `${isolation.level} (angefordert: ${requested})` : `isolation requested=${requested} but level=${isolation.level}: ${isolation.reason ?? "nicht verfügbar"}`,
    ms: Date.now() - startedIsolation
  });

  checks.push(
    await probe("HTTP /api/auth", "HTTP_APP", `${base}/api/auth`, (response, body) => {
      if (response.status !== 200) return `expected 200, got ${response.status}`;
      try {
        const parsed = JSON.parse(body) as {initialized?: unknown};
        if (typeof parsed.initialized !== "boolean") return "response without `initialized` field";
        return null;
      } catch {
        return "response is not JSON";
      }
    })
  );
  checks.push(
    await probe("HTTP /", "HTTP_ROOT", `${base}/`, (response, body) => {
      if (response.status !== 200) return `expected 200, got ${response.status}`;
      return /<html/i.test(body) ? null : "response without html root";
    })
  );

  return checks;
}

export type DeploymentPlan = {allowed: boolean; reasons: string[]; acknowledgedGaps: string[]; target: DeploymentTarget; releaseId: string; buildId?: string; digest?: string};

/**
 * Prüfungen, die **immer** bestanden sein müssen — sie sind in dieser Umgebung
 * real ausführbar (CI führt sie aus). `BROWSER` und `EVALUATION` gehören nicht
 * dazu: Für sie gibt es hier keinen Browser bzw. keine Auswertung.
 */
const MANDATORY_CHECKS: CheckKind[] = ["LINT", "TYPECHECK", "UNIT", "INTEGRATION", "SECURITY", "BUILD"];

/**
 * Vorprüfung ohne Nebenwirkung: Nur wenn hier `allowed: true` steht, darf
 * ausgerollt werden. Jeder Verweigerungsgrund wird benannt.
 */
export function planDeployment(input: {releaseId: string; pipelineId?: string; approvalId?: string; target?: DeploymentTarget}): DeploymentPlan {
  const target: DeploymentTarget = input.target ?? "STAGING";
  const reasons: string[] = [];
  const acknowledgedGaps: string[] = [];
  let buildId: string | undefined;
  let digest: string | undefined;

  try {
    const manifest = readManifest(input.releaseId);
    buildId = manifest.buildId;
    digest = manifest.digest;
    const verified = verifyRelease(input.releaseId);
    if (!verified.ok) reasons.push(`release digest invalid: ${verified.detail}`);
  } catch (error) {
    reasons.push(error instanceof ReleaseError ? `${error.code}: ${error.message}` : `release unreadable: ${error instanceof Error ? error.message : String(error)}`);
    return {allowed: false, reasons, acknowledgedGaps, target, releaseId: input.releaseId};
  }

  if (isKilled("DEPLOYMENT", input.releaseId)) reasons.push("deployment kill-switch active");
  if (getControlState().locked) reasons.push("system lockdown active");

  if (!input.pipelineId) reasons.push("pipeline required: no deployment without passed promotion gates");
  else {
    const pipeline = getPipeline(input.pipelineId);
    if (!pipeline) reasons.push(`pipeline ${input.pipelineId} not found`);
    else if (target === "PRODUCTION") {
      // Produktion verlangt die vollständige Prüfliste — inklusive Browser und
      // Auswertung. Solange diese hier nicht real laufen können, bleibt der
      // Produktions-Rollout blockiert; das ist gewollt und wird nicht umgangen.
      const gate = promotionGate(pipeline, "PRODUCTION");
      if (!gate.allowed) {
        // Nicht nur „unvollständig" melden, sondern benennen, welche Prüfung
        // fehlt: Der Creator soll den blockierenden Punkt direkt sehen.
        const blocking = pipeline.checks.filter(check => check.status !== "PASSED").map(check => `${check.kind}=${check.status}`);
        reasons.push(...gate.reasons);
        if (blocking.length > 0) reasons.push(`production requires all checks PASSED; blocking: ${blocking.join(", ")}`);
      }
    } else {
      const gate = stagingGate(pipeline);
      reasons.push(...gate.reasons);
      acknowledgedGaps.push(...gate.acknowledgedGaps);
    }
  }

  if (!input.approvalId) reasons.push("creator approval required");
  else if (!approvalGranted(input.approvalId)) reasons.push(`approval ${input.approvalId} is not granted`);

  return {allowed: reasons.length === 0, reasons, acknowledgedGaps, target, releaseId: input.releaseId, buildId, digest};
}

/**
 * Gate für ein Staging-Ausrollen.
 *
 * Verlangt werden dieselben Prüfungen, die das Projekt in dieser Umgebung
 * **wirklich** ausführt (LINT, TYPECHECK, UNIT, INTEGRATION, SECURITY, BUILD).
 * `BROWSER` und `EVALUATION` dürfen fehlen — aber nur ausdrücklich als
 * `SKIPPED` **mit Begründung**, und die Lücke wird im Deployment-Datensatz
 * (`acknowledgedGaps`) geführt, nicht verschwiegen. Alles andere (PENDING,
 * RUNNING, FAILED, `SKIPPED` ohne Grund) blockiert.
 */
function stagingGate(pipeline: Pipeline): {reasons: string[]; acknowledgedGaps: string[]} {
  const reasons: string[] = [];
  const acknowledgedGaps: string[] = [];
  if (!["PREVIEW", "STAGING", "SMOKE"].includes(pipeline.stage)) reasons.push(`staging requires a promoted stage (current: ${pipeline.stage})`);
  for (const check of pipeline.checks) {
    const mandatory = MANDATORY_CHECKS.includes(check.kind);
    if (check.status === "PASSED") continue;
    if (!mandatory && check.status === "SKIPPED") {
      if (!check.summary.trim()) reasons.push(`${check.kind} skipped without reason`);
      else acknowledgedGaps.push(`${check.kind}: ${check.summary}`);
      continue;
    }
    reasons.push(`verification checks incomplete (${check.kind}=${check.status})`);
  }
  return {reasons, acknowledgedGaps};
}

function runningState(releaseId: string): {runningBuildId: string | null; runningReleaseId: string | null; verifiedActive: boolean; restartRequired: boolean; hint: string} {
  const running = runningBuildId();
  const manifest = readManifest(releaseId);
  const sameBuild = running.buildId !== null && running.buildId === manifest.buildId;
  // „Aktiv" heißt: Der laufende Prozess wurde aus **diesem** Slot gestartet und
  // liefert dessen Build aus. Eine zufällig gleiche Build-ID aus einem anderen
  // Arbeitsverzeichnis (z. B. direkt aus dem Quellbaum) ist kein Ausrollen —
  // der Slot wäre dann nicht die Quelle des laufenden Standes.
  const fromSlot = running.releaseId === releaseId;
  const active = sameBuild && fromSlot;
  const hint = active
    ? `Der laufende Server wurde aus ${running.cwd} gestartet und liefert Build ${manifest.buildId} aus.`
    : sameBuild
      ? `Build-ID ${manifest.buildId} stimmt überein, aber der laufende Server startet aus ${running.cwd} statt aus dem Slot. Neustart erforderlich: bash scripts/release-supervisor.sh --release ${releaseId}`
      : `Zeiger umgestellt, aber der laufende Server meldet Build ${running.buildId ?? "unbekannt"} aus ${running.cwd}. Neustart erforderlich: bash scripts/release-supervisor.sh --release ${releaseId}`;
  return {runningBuildId: running.buildId, runningReleaseId: running.releaseId, verifiedActive: active, restartRequired: !active, hint};
}
export type DeployResult = {deployment: Deployment; allowed: boolean; reasons: string[]};

/** Rollt einen Release aus. Verweigerte Vorprüfungen erzeugen einen `REJECTED`-Datensatz. */
export async function deployRelease(input: {releaseId: string; pipelineId?: string; approvalId?: string; target?: DeploymentTarget; requestedBy: string; base?: string}): Promise<DeployResult> {
  const deploymentId = `DEP-${crypto.randomUUID().slice(0, 8).toUpperCase()}`;
  const plan = planDeployment({releaseId: input.releaseId, pipelineId: input.pipelineId, approvalId: input.approvalId, target: input.target});
  const from = currentReleaseId();
  const base: Deployment = {
    deploymentId,
    releaseId: input.releaseId,
    releaseDigest: plan.digest ?? "UNKNOWN",
    buildId: plan.buildId ?? "UNKNOWN",
    fromReleaseId: from,
    state: plan.allowed ? "PREPARED" : "REJECTED",
    target: plan.target,
    acknowledgedGaps: plan.acknowledgedGaps,
    pipelineId: input.pipelineId,
    approvalId: input.approvalId,
    reasons: plan.reasons,
    health: [],
    runningBuildId: runningBuildId().buildId,
    verifiedActive: false,
    restartRequired: false,
    requestedBy: input.requestedBy,
    startedAt: now(),
    supervisorHint: ""
  };

  if (!plan.allowed) {
    const rejected = save({...base, finishedAt: now(), supervisorHint: "Kein Rollout: Vorprüfung nicht bestanden."});
    observe({
      type: "deployment.rejected",
      message: `Deployment ${deploymentId} verweigert: ${plan.reasons.join("; ")}`,
      status: "BLOCKED",
      actor: input.requestedBy,
      action: "deployment.execute",
      resource: deploymentId,
      decision: "DENY",
      purpose: "Release nur mit bestandenen Gates und Creator-Freigabe ausrollen.",
      result: plan.reasons.join("; "),
      argumentsValue: {releaseId: input.releaseId, pipelineId: input.pipelineId, approvalId: input.approvalId, reasons: plan.reasons}
    });
    return {deployment: rejected, allowed: false, reasons: plan.reasons};
  }

  save({...base, state: "HEALTH_CHECKING"});
  const health = await runHealthChecks(input.releaseId, input.base ?? selfUrl());
  const failed = health.filter(check => !check.ok);
  if (failed.length > 0) {
    const failedDeployment = save({
      ...base,
      state: "FAILED",
      reasons: failed.map(check => `${check.name}: ${check.detail}`),
      health,
      finishedAt: now(),
      supervisorHint: "Health-Check vor dem Ausrollen fehlgeschlagen; der aktive Zeiger wurde nicht verändert."
    });
    notifyInbox({
      mode: "BLOCK",
      title: `Deployment ${deploymentId} gestoppt`,
      message: `Health-Check fehlgeschlagen: ${failed.map(check => `${check.name} (${check.detail})`).join("; ")}`
    });
    observe({
      type: "deployment.failed",
      message: `Deployment ${deploymentId} gestoppt: ${failed.length} Health-Check(s) fehlgeschlagen`,
      status: "FAILED",
      actor: input.requestedBy,
      action: "deployment.execute",
      resource: deploymentId,
      decision: "ERROR",
      purpose: "Kein Ausrollen auf einen nicht gesunden Zielzustand.",
      result: failed.map(check => `${check.name}: ${check.detail}`).join("; "),
      argumentsValue: {health}
    });
    return {deployment: failedDeployment, allowed: true, reasons: failed.map(check => check.detail)};
  }

  const switched = setCurrentRelease(input.releaseId);
  const runtime = runningState(input.releaseId);
  const state: DeploymentState = runtime.verifiedActive ? "ACTIVE" : "STAGED";
  const finished = save({
    ...base,
    state,
    health,
    runningBuildId: runtime.runningBuildId,
    runningReleaseId: runtime.runningReleaseId,
    verifiedActive: runtime.verifiedActive,
    restartRequired: runtime.restartRequired,
    finishedAt: now(),
    supervisorHint: runtime.hint
  });

  try {
    recordArtifact(
      {
        name: `Release ${input.releaseId}`,
        kind: "DEPLOYMENT",
        taskId: from ?? "UNASSIGNED",
        runId: deploymentId,
        sandboxId: "",
        agentId: input.requestedBy,
        knowledgeState: runtime.verifiedActive ? "OBSERVED" : "UNVERIFIED"
      },
      JSON.stringify({deploymentId, releaseId: input.releaseId, digest: finished.releaseDigest, buildId: finished.buildId, from, state})
    );
  } catch {
    /* Die Artefaktablage darf ein Deployment nicht in einen Fehler verwandeln. */
  }

  // Provenance: Der Release-Slot ist ein Artefakt, das Deployment leitet sich
  // davon ab. Ein Vorgänger-Slot wird nur verknüpft, wenn er wirklich existiert
  // (keine Phantomkante auf ein aufgeräumtes Release).
  addProvenanceNode({id: deploymentId, kind: "DEPLOYMENT", label: `${input.releaseId} (${state})`});
  addProvenanceNode({id: input.releaseId, kind: "ARTIFACT", label: `Release ${input.releaseId}`});
  addProvenanceEdge({from: deploymentId, to: input.releaseId, relation: "DERIVED_FROM"});
  if (from && from !== input.releaseId && listReleaseIds().includes(from)) {
    addProvenanceNode({id: from, kind: "ARTIFACT", label: `Release ${from}`});
    addProvenanceEdge({from: input.releaseId, to: from, relation: "DERIVED_FROM"});
  }
  observe({
    type: runtime.verifiedActive ? "deployment.active" : "deployment.staged",
    message: `Deployment ${deploymentId}: ${input.releaseId} → ${state}${runtime.restartRequired ? " (Neustart erforderlich)" : ""}`,
    status: runtime.verifiedActive ? "SUCCEEDED" : "WAITING",
    actor: input.requestedBy,
    action: "deployment.execute",
    resource: deploymentId,
    decision: "ALLOW",
    purpose: "Geprüften Release-Stand ausrollen und den laufenden Stand messen.",
    result: runtime.hint,
    argumentsValue: {releaseId: input.releaseId, from: switched.previous, verifiedActive: runtime.verifiedActive, restartRequired: runtime.restartRequired}
  });

  if (input.pipelineId && runtime.verifiedActive) {
    try {
      promote(input.pipelineId, "PRODUCTION");
    } catch {
      /* Der Pipeline-Stand ist Buchführung; ein Fehler dort darf die Auslieferung nicht rückgängig machen. */
    }
  }

  return {deployment: finished, allowed: true, reasons: []};
}

/** Prüft ein bestehendes Deployment gegen den laufenden Server (Zustand bleibt ehrlich). */
export function verifyDeployment(deploymentId: string): Deployment {
  const deployment = getDeployment(deploymentId);
  if (!deployment) throw new DeploymentRejected([`deployment ${deploymentId} not found`]);
  if (["REJECTED", "ROLLED_BACK"].includes(deployment.state)) return deployment;
  const active = currentReleaseId();
  const runtime = runningState(deployment.releaseId);
  const stillCurrent = active === deployment.releaseId;
  const state: DeploymentState = !stillCurrent && deployment.state === "ACTIVE" ? "ROLLED_BACK" : runtime.verifiedActive && stillCurrent ? "ACTIVE" : "STAGED";
  const updated = save({
    ...deployment,
    state,
    runningBuildId: runtime.runningBuildId,
    runningReleaseId: runtime.runningReleaseId,
    verifiedActive: runtime.verifiedActive && stillCurrent,
    restartRequired: !(runtime.verifiedActive && stillCurrent),
    supervisorHint: stillCurrent ? runtime.hint : `Zeiger steht auf ${active ?? "keinem Release"}; dieses Deployment ist nicht mehr aktiv.`
  });
  observe({
    type: "deployment.verified",
    message: `Deployment ${deploymentId}: ${state} (Build ${runtime.runningBuildId ?? "unbekannt"})`,
    status: state === "ACTIVE" ? "SUCCEEDED" : state === "ROLLED_BACK" ? "ROLLING_BACK" : "WAITING",
    actor: "CREATOR",
    action: "deployment.verify",
    resource: deploymentId,
    decision: "ALLOW",
    purpose: "Ausgerollten Stand gegen den laufenden Server messen.",
    result: runtime.hint,
    argumentsValue: {active, runningBuildId: runtime.runningBuildId, state}
  });
  return updated;
}

export type RollbackResult = {deployment: Deployment; performed: boolean; reasons: string[]};

/** Rollt auf den vorherigen Slot zurück — nur mit vorhandenem, unversehrtem Vorgänger. */
export async function rollbackDeployment(deploymentId: string, requestedBy: string, reason: string, base?: string): Promise<RollbackResult> {
  const deployment = getDeployment(deploymentId);
  if (!deployment) throw new DeploymentRejected([`deployment ${deploymentId} not found`]);
  const reasons: string[] = [];
  if (!deployment.fromReleaseId) reasons.push("no previous release recorded — rollback impossible");
  else if (!verifyRelease(deployment.fromReleaseId).ok) reasons.push(`previous release ${deployment.fromReleaseId} is not intact`);
  if (["ROLLED_BACK", "REJECTED"].includes(deployment.state)) reasons.push(`deployment is ${deployment.state}`);
  if (isKilled("DEPLOYMENT", deploymentId)) reasons.push("deployment kill-switch active");

  if (reasons.length > 0) {
    const blocked = save({...deployment, reasons: [...deployment.reasons, ...reasons], supervisorHint: "Rollback nicht möglich."});
    observe({
      type: "deployment.rollback.rejected",
      message: `Rollback ${deploymentId} verweigert: ${reasons.join("; ")}`,
      status: "BLOCKED",
      actor: requestedBy,
      action: "deployment.rollback",
      resource: deploymentId,
      decision: "DENY",
      purpose: "Nur auf einen geprüften Vorgänger zurückrollen.",
      result: reasons.join("; "),
      argumentsValue: {reasons}
    });
    return {deployment: blocked, performed: false, reasons};
  }

  const previous = deployment.fromReleaseId as string;
  setCurrentRelease(previous);
  const health = await runHealthChecks(previous, base ?? selfUrl());
  const failed = health.filter(check => !check.ok);
  const runtime = runningState(previous);
  const state: DeploymentState = failed.length > 0 ? "FAILED" : "ROLLED_BACK";
  const rolledBack = save({
    ...deployment,
    state,
    health,
    runningBuildId: runtime.runningBuildId,
    runningReleaseId: runtime.runningReleaseId,
    verifiedActive: false,
    restartRequired: runtime.restartRequired,
    rolledBackFrom: deployment.releaseId,
    finishedAt: now(),
    reasons: [...deployment.reasons, reason, ...failed.map(check => `${check.name}: ${check.detail}`)],
    supervisorHint:
      failed.length > 0
        ? `Rollback ausgeführt, aber Health-Check des Vorgängers fehlgeschlagen (${failed.map(check => check.name).join(", ")}).`
        : `Zeiger steht wieder auf ${previous}. ${runtime.hint}`
  });

  if (deployment.pipelineId) {
    try {
      promote(deployment.pipelineId, "ROLLED_BACK");
    } catch {
      /* Pipeline-Buchführung darf den Rollback nicht verhindern. */
    }
  }
  if (failed.length > 0) {
    notifyInbox({mode: "BLOCK", title: `Rollback ${deploymentId} ohne gesunden Vorgänger`, message: failed.map(check => `${check.name}: ${check.detail}`).join("; ")});
  }

  observe({
    type: "deployment.rolled_back",
    message: `Deployment ${deploymentId} zurückgerollt auf ${previous}${failed.length ? " (Vorgänger nicht gesund)" : ""}`,
    status: failed.length > 0 ? "FAILED" : "ROLLING_BACK",
    actor: requestedBy,
    action: "deployment.rollback",
    resource: deploymentId,
    decision: failed.length > 0 ? "ERROR" : "ALLOW",
    purpose: "Fehlerhaften Stand zurücknehmen und den vorherigen Stand wiederherstellen.",
    result: runtime.hint,
    argumentsValue: {from: deployment.releaseId, to: previous, reason, health}
  });
  return {deployment: rolledBack, performed: true, reasons: failed.map(check => check.detail)};
}

/** Betriebsbild für die Oberfläche: Slots, Zeiger, laufender Stand, Historie. */
export function deploymentSnapshot() {
  const running = runningBuildId();
  return {
    root: releaseRoot(),
    current: currentReleaseId(),
    runningBuildId: running.buildId,
    runningReleaseId: running.releaseId,
    workingDirectory: running.cwd,
    runningReason: running.reason,
    selfUrl: selfUrl(),
    releases: listReleases(),
    deployments: listDeployments().slice(-50).reverse(),
    store: store.integrity()
  };
}
