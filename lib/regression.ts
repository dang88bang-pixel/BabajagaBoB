import crypto from "node:crypto";
import {createStore} from "./persistence/store";
import {activeSandboxRuntime} from "./runtime-factory";
import {observe} from "./observability";
import {addProvenanceEdge} from "./provenance";

/**
 * Regression Engine (Abschnitt 18).
 *
 *   Incident ERR-123 → Root Cause RC-123 → Regressionstest REG-123 → Ausführung → PASS/FAIL
 *
 * Regressionstests werden dauerhaft gespeichert, ausgeführt (echter Prozess im
 * Sandbox-Workspace) und ihr Ergebnis wird als Evidence/Provenance festgehalten.
 * Eine Promotion ist nur mit bestandener Regression-Suite zulässig (siehe cicd.ts).
 */

export type RegressionTest = {
  regressionId: string;
  incidentId?: string;
  rootCause?: string;
  name: string;
  description: string;
  argv: string[];
  expectExitCode: number;
  createdAt: string;
  createdBy: string;
  status: "ACTIVE" | "QUARANTINED";
};

export type RegressionRun = {
  regressionRunId: string;
  regressionId: string;
  sandboxId: string;
  startedAt: string;
  finishedAt: string;
  accepted: boolean;
  exitCode: number | null;
  durationMs: number;
  timedOut: boolean;
  output: string;
  runtimeMode: string;
};

type Payload = {tests: RegressionTest[]; runs: RegressionRun[]; status: Record<string, "PASS" | "FAIL" | "UNKNOWN">};
const store = createStore<Payload>("regression", 1, () => ({tests: [], runs: [], status: {}}));

const MAX_ARGV_LENGTH = 4096;
const MAX_OUTPUT = 4000;

function validateArgv(argv: string[]) {
  if (!Array.isArray(argv) || argv.length === 0) throw new Error("regression argv must not be empty");
  for (const arg of argv) {
    if (typeof arg !== "string" || arg.length === 0 || arg.length > MAX_ARGV_LENGTH) throw new Error("invalid regression argv entry");
  }
  if (/[;&|`$><\n]/.test(argv[0])) throw new Error("shell metacharacters are forbidden; regression tests use argv[] with shell:false");
}

export function registerRegressionTest(input: {
  incidentId?: string;
  rootCause?: string;
  name: string;
  description: string;
  argv: string[];
  expectExitCode?: number;
  createdBy: string;
}): RegressionTest {
  validateArgv(input.argv);
  const existing = store.read().tests.find(t => t.name === input.name && JSON.stringify(t.argv) === JSON.stringify(input.argv));
  if (existing) return structuredClone(existing);
  const test: RegressionTest = {
    regressionId: `REG-${crypto.randomUUID().slice(0, 8).toUpperCase()}`,
    incidentId: input.incidentId,
    rootCause: input.rootCause,
    name: input.name,
    description: input.description,
    argv: input.argv,
    expectExitCode: input.expectExitCode ?? 0,
    createdAt: new Date().toISOString(),
    createdBy: input.createdBy,
    status: "ACTIVE"
  };
  store.update(payload => {
    payload.tests.push(test);
    payload.status[test.regressionId] = "UNKNOWN";
  });
  observe({
    type: "regression.registered",
    message: `Regressionstest ${test.regressionId} registriert`,
    status: "COMPLETED",
    actor: input.createdBy,
    action: "regression.register",
    resource: test.regressionId,
    outputRef: test.regressionId,
    argumentsValue: {name: test.name, incidentId: test.incidentId, argv: test.argv}
  });
  if (input.incidentId) {
    addProvenanceEdge({from: test.regressionId, to: input.incidentId, relation: "TESTED_BY"});
  }
  return structuredClone(test);
}

export function listRegressionTests(): RegressionTest[] {
  return structuredClone(store.read().tests);
}

export function getRegressionTest(regressionId: string): RegressionTest | null {
  return structuredClone(store.read().tests.find(t => t.regressionId === regressionId) ?? null);
}

export function listRegressionRuns(): RegressionRun[] {
  return structuredClone(store.read().runs);
}

export function regressionStatus(): Record<string, "PASS" | "FAIL" | "UNKNOWN"> {
  return structuredClone(store.read().status);
}

/** Führt einen Regressionstest im Sandbox-Workspace aus (echter Prozess, argv[], shell:false). */
export async function runRegressionTest(regressionId: string, sandboxId: string): Promise<RegressionRun> {
  const test = store.read().tests.find(t => t.regressionId === regressionId);
  if (!test) throw new Error(`regression test not found: ${regressionId}`);
  if (test.status !== "ACTIVE") throw new Error(`regression test is not active: ${regressionId}`);
  const result = await activeSandboxRuntime.execute(sandboxId, test.argv);
  const finishedAt = new Date();
  const run: RegressionRun = {
    regressionRunId: `RRUN-${crypto.randomUUID().slice(0, 8).toUpperCase()}`,
    regressionId,
    sandboxId,
    startedAt: new Date(finishedAt.getTime() - result.durationMs).toISOString(),
    finishedAt: finishedAt.toISOString(),
    accepted: result.exitCode === test.expectExitCode && !result.timedOut,
    exitCode: result.exitCode,
    durationMs: result.durationMs,
    timedOut: result.timedOut,
    output: `${result.stdout}\n${result.stderr}`.trim().slice(0, MAX_OUTPUT),
    runtimeMode: activeSandboxRuntime.mode
  };
  store.update(payload => {
    payload.runs.push(run);
    if (payload.runs.length > 1000) payload.runs.splice(0, payload.runs.length - 1000);
    payload.status[regressionId] = run.accepted ? "PASS" : "FAIL";
  });
  observe({
    type: run.accepted ? "regression.passed" : "regression.failed",
    message: `Regressionstest ${regressionId}: ${run.accepted ? "PASS" : "FAIL"}`,
    status: run.accepted ? "COMPLETED" : "ERROR",
    actor: "QA",
    agentId: "AG-QA",
    sandboxId,
    action: "regression.run",
    resource: regressionId,
    decision: run.accepted ? "ALLOW" : "ERROR",
    argumentsValue: {exitCode: run.exitCode, durationMs: run.durationMs, timedOut: run.timedOut}
  });
  return run;
}

export type RegressionSuiteResult = {
  suiteId: string;
  sandboxId: string;
  passed: boolean;
  total: number;
  passedCount: number;
  failed: string[];
  runs: RegressionRun[];
};

/** Führt die Regression-Suite aus. Ohne Tests gilt sie als NICHT bestanden (fail closed). */
export async function runRegressionSuite(sandboxId: string, regressionIds?: string[]): Promise<RegressionSuiteResult> {
  const tests = listRegressionTests().filter(t => t.status === "ACTIVE" && (!regressionIds || regressionIds.includes(t.regressionId)));
  const runs: RegressionRun[] = [];
  const failed: string[] = [];
  for (const test of tests) {
    const run = await runRegressionTest(test.regressionId, sandboxId);
    runs.push(run);
    if (!run.accepted) failed.push(test.regressionId);
  }
  const result: RegressionSuiteResult = {
    suiteId: `RSUITE-${crypto.randomUUID().slice(0, 8).toUpperCase()}`,
    sandboxId,
    passed: tests.length > 0 && failed.length === 0,
    total: tests.length,
    passedCount: tests.length - failed.length,
    failed,
    runs
  };
  observe({
    type: result.passed ? "regression.suite.passed" : "regression.suite.failed",
    message: `Regression-Suite ${result.suiteId}: ${result.passedCount}/${result.total} bestanden`,
    status: result.passed ? "COMPLETED" : "ERROR",
    actor: "QA",
    agentId: "AG-QA",
    sandboxId,
    action: "regression.suite",
    resource: result.suiteId,
    decision: result.passed ? "ALLOW" : "ERROR",
    argumentsValue: {failed: result.failed}
  });
  return result;
}

export function regressionStoreReport() {
  return store.integrity();
}
