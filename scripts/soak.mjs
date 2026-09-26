#!/usr/bin/env node
/**
 * Begrenzter Last-/Soak-Nachweis gegen die echte HTTP-Oberfläche (Abschnitt 43).
 *
 * Was gemessen wird: autorisierte Ausführungen über den vollständigen Weg
 *   Login → (Mission → Objective → Task → Sandbox) → Token je Ausführung
 *   → POST /api/runtime → Broker → isolierte Runtime → Evidenz
 * inklusive Latenz je Ausführung, Durchsatz, Fehlerquote und dem Zustand danach
 * (Audit-Kette, Store-Integrität, Isolationsstufe).
 *
 * Was ausdrücklich **nicht** gemessen wird: eine SLO-Zusage für Dauerbetrieb.
 * Ein einzelner, begrenzter Lauf in dieser Umgebung ist eine Momentaufnahme,
 * keine Lastkurve. Damit die Momentaufnahme trotzdem **bewertbar** ist, gelten
 * für den Lauf definierte Schwellen:
 *
 *   `SOAK_SLO_P95_MS`           Budget für die p95-Latenz (Vorgabe 5000 ms)
 *   `SOAK_SLO_MIN_SUCCESS_RATIO` Mindestanteil erfolgreicher Ausführungen (Vorgabe 1.0)
 *
 * Der Lauf endet mit Exit 1, wenn eine dieser Schwellen verletzt ist — die
 * Schwellen stehen im Bericht (`slo`), zusammen mit dem Zustand danach
 * (Audit-Kette, Isolation, Store-Integrität). Die betriebsweite Bewertung des
 * Zustands liegt in `lib/slo.ts` (Route `/api/slo`, Abschnitt „Service-Level“).
 *
 * Aufruf:
 *   BASE=http://localhost:3000 BOB_BOOTSTRAP_SECRET=… BOB_CREATOR_LOGIN_SECRET=… \
 *   SOAK_COUNT=120 SOAK_CONCURRENCY=4 node scripts/soak.mjs
 */
import fs from "node:fs";

const BASE = process.env.BASE ?? "http://localhost:3000";
const COUNT = Number(process.env.SOAK_COUNT ?? 100);
const CONCURRENCY = Math.max(1, Number(process.env.SOAK_CONCURRENCY ?? 4));
const REPORT = process.env.SOAK_REPORT ?? "/tmp/bob-soak-report.json";
const MARKER = "soak-ok";
const SLO_P95_MS = Number(process.env.SOAK_SLO_P95_MS ?? 5000);
const SLO_MIN_SUCCESS_RATIO = Number(process.env.SOAK_SLO_MIN_SUCCESS_RATIO ?? 1);

let cookie = "";

async function call(path, init = {}) {
  const headers = {"content-type": "application/json", ...(cookie ? {cookie} : {}), ...(init.headers ?? {})};
  const response = await fetch(`${BASE}${path}`, {...init, headers});
  const setCookie = response.headers.getSetCookie?.() ?? [];
  for (const entry of setCookie) {
    const pair = entry.split(";")[0];
    if (pair.startsWith("bob_session=")) cookie = pair;
  }
  const text = await response.text();
  let body = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    // Prometheus-Text (Metriken) ist kein JSON und wird als Text weitergereicht.
    body = {raw: text};
  }
  return {status: response.status, body, text};
}

async function mutate(path, payload) {
  return call(path, {method: "POST", body: JSON.stringify(payload)});
}

function requireOk(result, what) {
  if (result.status >= 300) {
    throw new Error(`${what} fehlgeschlagen: HTTP ${result.status} ${JSON.stringify(result.body)?.slice(0, 200)}`);
  }
  return result.body;
}

async function authenticate() {
  const status = await call("/api/auth");
  if (!status.body?.initialized) {
    requireOk(await mutate("/api/auth", {action: "bootstrap", secret: process.env.BOB_BOOTSTRAP_SECRET ?? "", creatorName: "Soak"}), "Bootstrap");
  }
  const login = await mutate("/api/auth", {action: "login", secret: process.env.BOB_CREATOR_LOGIN_SECRET ?? ""});
  if (login.status !== 201) {
    throw new Error(
      `Login fehlgeschlagen: HTTP ${login.status} ${JSON.stringify(login.body)}` +
        (login.body?.error === "TOTP_REQUIRED" ? " (zweiter Faktor gesetzt: Soak-Skript unterstützt TOTP nicht)" : "")
    );
  }
}

function percentile(sorted, p) {
  if (!sorted.length) return 0;
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[index];
}

async function main() {
  const startedAt = new Date().toISOString();
  await authenticate();

  const mission = requireOk(await mutate("/api/missions", {action: "create-mission", title: `Soak ${startedAt}`, objective: "Lastnachweis"}), "Mission");
  const objective = requireOk(
    await mutate("/api/missions", {action: "create-objective", missionId: mission.mission.missionId, title: "Soak", description: "Lastnachweis"}),
    "Objective"
  );
  const task = requireOk(
    await mutate("/api/tasks", {
      action: "create",
      missionId: mission.mission.missionId,
      objectiveId: objective.objective.objectiveId,
      title: "Soak-Task",
      risk: "LOW",
      assignedAgent: "AG-BUILD"
    }),
    "Task"
  );
  const taskId = task.task.taskId;
  const sandbox = requireOk(
    await mutate("/api/sandboxes", {action: "create", type: "test", taskId, agentId: "AG-BUILD", risk: "LOW"}),
    "Sandbox"
  );
  const sandboxId = sandbox.sandbox.sandboxId;
  requireOk(await mutate("/api/sandboxes", {action: "start", sandboxId}), "Sandbox-Start");

  const expiresAt = new Date(Date.now() + 10 * 60_000).toISOString();
  const latencies = [];
  const issueLatencies = [];
  const failures = [];

  async function iteration(index) {
    const issueStart = Date.now();
    const issued = requireOk(
      await mutate("/api/authority", {
        action: "issue",
        input: {
          subject: "AG-BUILD",
          taskId,
          sandboxId,
          environment: "test",
          capabilities: ["task:execute", "sandbox:run"],
          risk: "LOW",
          issuedBy: "CREATOR",
          issuedByKind: "CREATOR",
          expiresAt
        }
      }),
      `Token ${index}`
    );
    issueLatencies.push(Date.now() - issueStart);

    const runStart = Date.now();
    const result = await mutate("/api/runtime", {
      action: "execute",
      taskId,
      agentId: "AG-BUILD",
      sandboxId,
      capabilityTokenId: issued.token.id,
      argv: ["node", "-e", `process.stdout.write('${MARKER}')`]
    });
    const elapsed = Date.now() - runStart;
    if (result.status !== 200 || result.body?.accepted !== true || result.body?.stdout !== MARKER) {
      failures.push({index, status: result.status, body: result.body});
      return;
    }
    latencies.push(elapsed);
  }

  const wallStart = Date.now();
  let next = 0;
  const workers = Array.from({length: Math.min(CONCURRENCY, COUNT)}, async () => {
    while (next < COUNT) {
      const index = next++;
      await iteration(index);
    }
  });
  await Promise.all(workers);
  const wallMs = Date.now() - wallStart;

  const sorted = [...latencies].sort((a, b) => a - b);
  const audit = await call("/api/audit");
  const metrics = await call("/api/metrics");
  const runtime = await call("/api/runtime");
  const metricText = metrics.text ?? "";
  const metric = name => new RegExp(`^${name} (\\S+)$`, "m").exec(metricText)?.[1];

  const successRatio = COUNT === 0 ? 0 : Number((latencies.length / COUNT).toFixed(4));
  const slo = {
    p95BudgetMs: SLO_P95_MS,
    p95Ms: percentile(sorted, 95),
    p95Ok: percentile(sorted, 95) <= SLO_P95_MS,
    minSuccessRatio: SLO_MIN_SUCCESS_RATIO,
    successRatio,
    successOk: successRatio >= SLO_MIN_SUCCESS_RATIO,
    state: percentile(sorted, 95) <= SLO_P95_MS && successRatio >= SLO_MIN_SUCCESS_RATIO ? "MEETS_BUDGET" : "BREACHED"
  };

  const report = {
    startedAt,
    finishedAt: new Date().toISOString(),
    base: BASE,
    count: COUNT,
    concurrency: CONCURRENCY,
    succeeded: latencies.length,
    failed: failures.length,
    failures: failures.slice(0, 5),
    latencyMs: {
      min: sorted[0] ?? 0,
      p50: percentile(sorted, 50),
      p95: percentile(sorted, 95),
      p99: percentile(sorted, 99),
      max: sorted[sorted.length - 1] ?? 0
    },
    issueLatencyMs: {p50: percentile([...issueLatencies].sort((a, b) => a - b), 50)},
    throughputPerSecond: Number((latencies.length / (wallMs / 1000)).toFixed(2)),
    wallMs,
    slo,
    afterwards: {
      auditChainValid: audit.body?.chain?.valid === true,
      auditRetention: audit.body?.integrity?.retentionIntegrity ?? null,
      isolation: runtime.body?.isolation?.level ?? null,
      storeIntegrityOk: metric("bob_store_integrity_ok") ?? null,
      auditChainMetric: metric("bob_audit_chain_ok") ?? null
    },
    note: "Momentaufnahme eines begrenzten Laufs in dieser Umgebung, keine SLO-Zusage und keine Lastkurve."
  };
  fs.writeFileSync(REPORT, `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify(report, null, 2));
  if (failures.length || slo.state !== "MEETS_BUDGET") process.exitCode = 1;
}

main().catch(error => {
  console.error(`soak failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
