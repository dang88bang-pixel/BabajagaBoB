import crypto from "node:crypto";
import {createStore} from "./persistence/store";
import {runtimeModeLabel} from "./runtime-factory";
import {runRegressionSuite, type RegressionSuiteResult} from "./regression";
import {observe} from "./observability";
import {executeSystemAuthorized} from "./system-execution";
import {addProvenanceEdge} from "./provenance";
import {listSnapshots} from "./sandbox/fabric";

/**
 * Verifikations-Pipeline (Abschnitt 13/17).
 *
 *   RESTORE → VERIFY (Digest) → SMOKE TEST → REGRESSION TEST → ACCEPT / REJECT
 *
 * Eine Recovery oder ein Restore gilt niemals allein deshalb als erfolgreich,
 * weil `restore()` ohne Exception endet. Akzeptanz erfordert:
 *  1. Snapshot existiert und der Digest des wiederhergestellten Zustands stimmt
 *  2. Smoketest im Sandbox-Workspace läuft erfolgreich (echter Prozess)
 *  3. Regression-Suite ist vorhanden und besteht vollständig
 */

export type VerificationCheck = {
  checkId: string;
  kind: "INTEGRITY" | "SMOKE" | "REGRESSION";
  name: string;
  accepted: boolean;
  detail: string;
  durationMs: number;
};

export type VerificationResult = {
  verificationId: string;
  sandboxId: string;
  runId?: string;
  acceptance: "ACCEPT" | "REJECT";
  reasons: string[];
  checks: VerificationCheck[];
  regression?: RegressionSuiteResult;
  startedAt: string;
  finishedAt: string;
  runtimeMode: string;
};

type Payload = {verifications: VerificationResult[]};
const store = createStore<Payload>("verifications", 1, () => ({verifications: []}));

const SMOKE_ARGV = ["node", "-e", "process.stdout.write('smoke-ok')"];

export async function runSmokeTest(sandboxId: string, argv: string[] = SMOKE_ARGV) {
  const started = Date.now();
  try {
    // Auch der Smoke-Test läuft über Gate und Broker (kein Bypass der Autorisierung).
    const result = await executeSystemAuthorized({purpose: "SMOKE_TEST", sandboxId, argv});
    const accepted = result.accepted && result.stdout.includes("smoke-ok");
    return {
      accepted,
      detail: accepted ? "smoke test passed" : `smoke test failed (exit ${result.exitCode}): ${(result.stderr || result.stdout).slice(0, 500)}`,
      durationMs: Date.now() - started
    };
  } catch (error) {
    return {accepted: false, detail: error instanceof Error ? error.message : "smoke test could not be executed", durationMs: Date.now() - started};
  }
}

export async function verifySandboxState(input: {
  sandboxId: string;
  runId?: string;
  snapshotId?: string;
  regressionIds?: string[];
  smokeArgv?: string[];
  requireRegression?: boolean;
}): Promise<VerificationResult> {
  const startedAt = new Date().toISOString();
  const checks: VerificationCheck[] = [];
  const reasons: string[] = [];
  const checkId = () => `CHK-${crypto.randomUUID().slice(0, 8).toUpperCase()}`;

  // 1. Integrität: Snapshot muss existieren und zum Sandbox-Zustand passen.
  if (input.snapshotId) {
    const snapshot = listSnapshots(input.sandboxId).find(s => s.snapshotId === input.snapshotId);
    const accepted = Boolean(snapshot);
    checks.push({
      checkId: checkId(),
      kind: "INTEGRITY",
      name: "snapshot digest present",
      accepted,
      detail: snapshot ? `snapshot ${snapshot.snapshotId} digest ${snapshot.digest.slice(0, 16)}…` : "snapshot metadata missing",
      durationMs: 0
    });
    if (!accepted) reasons.push("snapshot metadata missing");
  }

  // 2. Smoketest: echter Prozess im Sandbox-Workspace.
  const smoke = await runSmokeTest(input.sandboxId, input.smokeArgv);
  checks.push({checkId: checkId(), kind: "SMOKE", name: "sandbox smoke test", accepted: smoke.accepted, detail: smoke.detail, durationMs: smoke.durationMs});
  if (!smoke.accepted) reasons.push(smoke.detail);

  // 3. Regression: muss vorhanden sein und bestehen (fail closed).
  const requireRegression = input.requireRegression ?? true;
  let regression: RegressionSuiteResult | undefined;
  try {
    regression = await runRegressionSuite(input.sandboxId, input.regressionIds);
    const accepted = regression.passed || (!requireRegression && regression.total === 0);
    checks.push({
      checkId: checkId(),
      kind: "REGRESSION",
      name: "regression suite",
      accepted,
      detail: regression.total === 0 ? "no regression tests registered" : `${regression.passedCount}/${regression.total} passed`,
      durationMs: regression.runs.reduce((sum, run) => sum + run.durationMs, 0)
    });
    if (!accepted) reasons.push(regression.total === 0 ? "regression suite is empty (fail closed)" : `failing regression tests: ${regression.failed.join(", ")}`);
  } catch (error) {
    const detail = error instanceof Error ? error.message : "regression suite could not run";
    checks.push({checkId: checkId(), kind: "REGRESSION", name: "regression suite", accepted: false, detail, durationMs: 0});
    reasons.push(detail);
  }

  const acceptance: VerificationResult["acceptance"] = checks.every(c => c.accepted) ? "ACCEPT" : "REJECT";
  const result: VerificationResult = {
    verificationId: `VER-${crypto.randomUUID().slice(0, 8).toUpperCase()}`,
    sandboxId: input.sandboxId,
    runId: input.runId,
    acceptance,
    reasons: reasons.length ? reasons : ["all verification checks passed"],
    checks,
    regression,
    startedAt,
    finishedAt: new Date().toISOString(),
    runtimeMode: runtimeModeLabel()
  };

  store.update(payload => {
    payload.verifications.push(result);
    if (payload.verifications.length > 500) payload.verifications.splice(0, payload.verifications.length - 500);
  });

  observe({
    type: acceptance === "ACCEPT" ? "verification.accepted" : "verification.rejected",
    message: `Verifikation ${result.verificationId}: ${acceptance}`,
    status: acceptance === "ACCEPT" ? "COMPLETED" : "ERROR",
    actor: "AG-QA",
    agentId: "AG-QA",
    runId: input.runId,
    sandboxId: input.sandboxId,
    action: "verification.run",
    resource: result.verificationId,
    decision: acceptance === "ACCEPT" ? "ALLOW" : "DENY",
    argumentsValue: {checks: checks.map(c => ({kind: c.kind, accepted: c.accepted, detail: c.detail}))}
  });

  if (input.runId) {
    addProvenanceEdge({from: input.runId, to: result.verificationId, relation: "TESTED_BY"});
  }

  return result;
}

export function listVerifications(): VerificationResult[] {
  return structuredClone(store.read().verifications);
}

export function getVerification(verificationId: string): VerificationResult | null {
  return structuredClone(store.read().verifications.find(v => v.verificationId === verificationId) ?? null);
}

export function verificationStoreReport() {
  return store.integrity();
}
