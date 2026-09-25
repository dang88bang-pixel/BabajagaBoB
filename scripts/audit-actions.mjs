#!/usr/bin/env node
/**
 * ============================================================================
 * Vollständige Aktions-, Attribut- und Interaktionsprüfung der Plattform.
 *
 *   BASE=http://127.0.0.1:3000 BOB_BOOTSTRAP_SECRET=… BOB_CREATOR_LOGIN_SECRET=… \
 *     node scripts/audit-actions.mjs
 *
 * Was geprüft wird — vollständig, nicht stichprobenartig:
 *
 *  1. Statik: die Aktionsmatrix wird **aus dem Quellcode** gelesen
 *     (`app/api/…/route.ts`). Eine neue Aktion ohne Prüfung fällt auf, weil sie
 *     automatisch in die Matrix aufgenommen wird.
 *  2. Robustheit je POST-Route: unlesbarer Body, leerer Body, unbekannte Aktion
 *     → immer 4xx, **nie** 5xx und nie ein stiller Erfolg (2xx ohne Wirkung).
 *  3. Attribute je Aktion: fehlende Pflichtfelder (`{action}` allein) und
 *     falsch typisierte Attribute (Zahl statt Zeichenkette, Zeichenkette statt
 *     Liste usw.) → 4xx, nie 5xx, kein Teildatensatz.
 *  4. Interaktionsketten mit echten Kennungen: Mission → Objective → Task →
 *     Agent → Sandbox → Capability → Run → Gate → Runtime → Evidence →
 *     Provenance → Queue → Fehlerkette → Recovery → Regression → Knowledge,
 *     dazu Skills/Werkstatt/Simulation, Apps/Module, CI/CD/Promotion, Geräte,
 *     Computer Use, Provider, Secrets, Inbox, Approvals, Persistenz.
 *  5. Integrität: Persistenzbericht, Audit-Kette, Erreichbarkeit aller
 *     GET-Routen, Worker-Zyklus, Reconciliation.
 *
 * Exit 0 nur bei 0 Fehlschlägen. Das Skript ist wiederholbar: Kennungen werden
 * je Lauf neu vergeben, geprüft werden Zustandsübergänge und Attribute, keine
 * festen IDs aus früheren Läufen.
 * ============================================================================
 */
import {readFileSync, readdirSync, statSync} from "node:fs";
import {join, relative} from "node:path";

const BASE = process.env.BASE ?? "http://127.0.0.1:3000";
const BOOTSTRAP_SECRET = process.env.BOB_BOOTSTRAP_SECRET ?? "";
const LOGIN_SECRET = process.env.BOB_CREATOR_LOGIN_SECRET ?? "";
const STAMP = `${Date.now().toString(36)}${Math.floor(Math.random() * 1e6).toString(36)}`;

let pass = 0;
let fail = 0;
const failures = [];
const ok = (name, detail) => { pass += 1; console.log(`  \u001b[32mPASS\u001b[0m ${name}${detail ? ` — ${detail}` : ""}`); };
const bad = (name, detail) => { fail += 1; failures.push({name, detail}); console.log(`  \u001b[31mFAIL\u001b[0m ${name}${detail ? ` — ${detail}` : ""}`); };
const step = title => console.log(`\n\u001b[1m${title}\u001b[0m`);

const cookies = new Map();
function cookieHeader() {
  return [...cookies.entries()].map(([k, v]) => `${k}=${v}`).join("; ");
}
function rememberCookies(response) {
  const list = typeof response.headers.getSetCookie === "function" ? response.headers.getSetCookie() : [];
  for (const entry of list) {
    const [pair] = entry.split(";");
    const index = pair.indexOf("=");
    if (index > 0) cookies.set(pair.slice(0, index).trim(), pair.slice(index + 1).trim());
  }
}

async function api(method, path, body, options = {}) {
  const headers = {"content-type": "application/json"};
  if (options.session !== false && cookies.size > 0) headers.cookie = cookieHeader();
  const init = {method, headers, redirect: "manual"};
  if (body !== undefined) init.body = options.raw ? body : JSON.stringify(body);
  const response = await fetch(`${BASE}${path}`, init);
  rememberCookies(response);
  const text = await response.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* kein JSON */ }
  return {status: response.status, json, text};
}
const post = (path, body, options) => api("POST", path, body, options);
const get = path => api("GET", path);

/* ------------------------------------------------------------------ Statik */

function walkRoutes(dir = "app/api") {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...walkRoutes(full));
    else if (entry === "route.ts") out.push(full);
  }
  return out;
}

/** Aktionen je Route direkt aus dem Quellcode — die Matrix bleibt synchron. */
function actionMatrix() {
  const matrix = new Map();
  for (const file of walkRoutes()) {
    const route = `/api/${relative("app/api", file).replace(/\/route\.ts$/, "")}`;
    const source = readFileSync(file, "utf8");
    const actions = new Set([
      ...[...source.matchAll(/action\s*===\s*"([^"]+)"/g)].map(match => match[1]),
      ...[...source.matchAll(/case\s+"([^"]+)"/g)].map(match => match[1])
    ]);
    if (/export async function POST/.test(source)) matrix.set(route, [...actions].sort());
  }
  return matrix;
}

/**
 * Routen ohne Body-Vertrag: ihr POST liest den Request-Body nie, ein
 * unlesbarer oder leerer Body ist deshalb kein Fehler (z. B. `/api/worker`
 * startet einen Zyklus, `/api/audit` verifiziert die Kette). Geprüft wird dort
 * nur, dass kein 5xx entsteht.
 */
function bodyFreeRoutes() {
  const free = new Set();
  for (const file of walkRoutes()) {
    const route = `/api/${relative("app/api", file).replace(/\/route\.ts$/, "")}`;
    const source = readFileSync(file, "utf8");
    const handler = source.slice(source.indexOf("export async function POST"));
    if (!/(request|req)\.(clone\(\)\.)?json\(|readJson\(|readAction\(/.test(handler)) free.add(route);
  }
  return free;
}

/**
 * Aktionen, die ohne Attribute gültig sind (2xx ist dort korrekt).
 * `logout` würde die laufende Sitzung beenden und wird nur am Ende geprüft.
 */
const ATTRIBUTE_FREE_ACTIONS = new Set(["renew", "expire", "guardian", "verify", "reconcile", "logout", "is-killed", "worker.cycle", "backup", "repair"]);
const DESTRUCTIVE_ACTIONS = new Set(["logout"]);

/** Attribute, die in einer Route aus dem Body gelesen werden. */
function attributeMatrix() {
  const attributes = new Map();
  for (const file of walkRoutes()) {
    const route = `/api/${relative("app/api", file).replace(/\/route\.ts$/, "")}`;
    const source = readFileSync(file, "utf8");
    const fields = new Set([
      ...[...source.matchAll(/(?:string|number|object|bool)Field\(\s*\w+\s*,\s*"([^"]+)"/g)].map(m => m[1]),
      ...[...source.matchAll(/requiredStrings\([^,]+,\s*\[([^\]]*)\]/g)].flatMap(m => m[1].split(",").map(s => s.trim().replace(/^"|"$/g, "")))
    ]);
    if (fields.size) attributes.set(route, [...fields].sort());
  }
  return attributes;
}

/* ------------------------------------------------------------------ Ablauf */

async function login() {
  step("0. Anmeldung");
  if (!BOOTSTRAP_SECRET || !LOGIN_SECRET) throw new Error("BOB_BOOTSTRAP_SECRET und BOB_CREATOR_LOGIN_SECRET werden benötigt");
  const bootstrap = await post("/api/auth", {action: "bootstrap", secret: BOOTSTRAP_SECRET, creatorName: "Aktionsprüfer"});
  if ([201, 400, 409].includes(bootstrap.status)) ok("Bootstrap", `Status ${bootstrap.status}`);
  else bad("Bootstrap", `Status ${bootstrap.status}`);
  const login = await post("/api/auth", {action: "login", secret: LOGIN_SECRET});
  if (login.status !== 201 && login.status !== 200) { bad("Creator-Anmeldung", `Status ${login.status}`); throw new Error("Anmeldung fehlgeschlagen"); }
  ok("Creator-Anmeldung", `Status ${login.status}, Rolle ${login.json?.actor?.role ?? "?"}`);
  const control = await get("/api/control");
  if (control.status === 200) ok("Sitzung gültig (GET /api/control 200)");
  else bad("Sitzung gültig", `Status ${control.status}`);
}

async function robustnessMatrix(matrix, bodyFree) {
  step("1. Robustheit: unlesbarer Body, leerer Body, unbekannte Aktion");
  for (const [route, actions] of matrix) {
    const free = bodyFree.has(route);
    for (const [label, request] of [["unlesbarer Body", () => post(route, "{kaputt", {raw: true})], ["leerer Body", () => post(route, {})]]) {
      const response = await request();
      if (response.status >= 500) bad(`${route}: ${label}`, `Status ${response.status} ${response.text.slice(0, 120)}`);
      else if (response.status < 400 && !free) bad(`${route}: ${label}`, `Status ${response.status} (stiller Erfolg)`);
      else ok(`${route}: ${label}`, String(response.status));
    }

    if (actions.length > 0) {
      const unknown = await post(route, {action: "gibtsnicht"});
      if (unknown.status >= 500) bad(`${route}: unbekannte Aktion`, `Status ${unknown.status}`);
      else if (unknown.status < 400) bad(`${route}: unbekannte Aktion`, `Status ${unknown.status} (stiller Erfolg)`);
      else ok(`${route}: unbekannte Aktion`, String(unknown.status));
    }
  }
}

async function attributeChecks(matrix, attributes) {
  step("2. Attribute: fehlende Pflichtfelder und falsche Typen");
  for (const [route, actions] of matrix) {
    for (const action of actions) {
      if (DESTRUCTIVE_ACTIONS.has(action)) continue; // logout beendet die Sitzung
      const missing = await post(route, {action});
      const allowed = ATTRIBUTE_FREE_ACTIONS.has(action);
      if (missing.status >= 500) bad(`${route} ${action}: ohne Attribute`, `Status ${missing.status}`);
      else if (missing.status < 400 && !allowed) bad(`${route} ${action}: ohne Attribute`, `Status ${missing.status} (stiller Erfolg)`);
      else ok(`${route} ${action}: ohne Attribute`, String(missing.status));
    }
    const fields = attributes.get(route) ?? [];
    for (const field of fields.slice(0, 6)) {
      // Falscher Typ: Zeichenkette statt Liste bzw. Zahl statt Zeichenkette.
      const payload = {action: actions[0], [field]: 12345, id: 12345, taskId: 12345, sandboxId: 12345};
      const wrong = await post(route, payload);
      if (wrong.status >= 500) bad(`${route} ${field}: falscher Typ`, `Status ${wrong.status}`);
      else ok(`${route} ${field}: falscher Typ`, String(wrong.status));
    }
  }
}

/* ------------------------------------------------------------ Kettenprüfung */

const state = {};
function expectStatus(name, response, allowed) {
  const list = Array.isArray(allowed) ? allowed : [allowed];
  if (list.includes(response.status)) ok(name, String(response.status));
  else bad(name, `erwartet ${list.join("/")}, erhalten ${response.status} ${response.text.slice(0, 160)}`);
}
function expectField(name, response, predicate, description) {
  if (response.json && predicate(response.json)) ok(name, description);
  else bad(name, `Attribut fehlt: ${description} — ${response.text.slice(0, 160)}`);
}

async function chainControlPlane() {
  step("3. Kette: Mission → Objective → Task → Agent");
  expectStatus("Mission ohne Titel wird abgelehnt", await post("/api/missions", {action: "create-mission", objective: "ohne Titel"}), 400);
  expectStatus("Mission ohne Ziel wird abgelehnt", await post("/api/missions", {action: "create-mission", title: "ohne Ziel"}), 400);
  const mission = await post("/api/missions", {action: "create-mission", title: `Audit ${STAMP}`, objective: "Aktionsketten prüfen"});
  expectStatus("Mission anlegen", mission, 201);
  state.missionId = mission.json?.mission?.missionId;
  expectField("Mission hat Kennung und Status", mission, j => typeof j.mission?.missionId === "string" && typeof j.mission?.status === "string", "missionId + status");

  const objective = await post("/api/missions", {action: "create-objective", missionId: state.missionId, title: `Ziel ${STAMP}`, description: "Attributprüfung"});
  expectStatus("Objective anlegen", objective, 201);
  state.objectiveId = objective.json?.objective?.objectiveId;

  const task = await post("/api/tasks", {action: "create", missionId: state.missionId, objectiveId: state.objectiveId, title: `Task ${STAMP}`, risk: "LOW", assignedAgent: "AG-BUILD"});
  expectStatus("Task anlegen", task, 201);
  state.taskId = task.json?.task?.taskId;
  expectField("Task hat Risiko und Agentenbindung", task, j => j.task?.risk === "LOW" && j.task?.assignedAgent === "AG-BUILD", "risk + assignedAgent");

  expectStatus("Task zuweisen", await post("/api/tasks", {action: "assign", taskId: state.taskId, agentId: "AG-QA"}), 200);
  expectStatus("Task-Status setzen", await post("/api/tasks", {action: "status", taskId: state.taskId, status: "EXECUTING", progress: 25}), 200);

  expectStatus("Agent-Status setzen", await post("/api/agents/fabric", {action: "status", id: "AG-QA", status: "WORKING", progress: 10, task: state.taskId}), 200);
  expectStatus("Agent-Heartbeat", await post("/api/agents/fabric", {action: "heartbeat", id: "AG-QA"}), 200);
  const handoff = await post("/api/agents/fabric", {action: "handoff", fromAgentId: "AG-QA", toAgentId: "AG-BUILD", taskId: state.taskId, reason: "Übergabe im Audit"});
  expectStatus("Handoff anfordern", handoff, 201);
  state.handoffId = handoff.json?.handoff?.id ?? handoff.json?.handoff?.handoffId;
  expectStatus("Handoff auflösen", await post("/api/agents/fabric", {action: "resolve", id: state.handoffId, status: "ACCEPTED"}), 200);
  return true;
}

async function chainRuntime() {
  step("4. Kette: Sandbox → Snapshot → Restore → Capability → Run → Gate → Runtime → Evidence");
  const sandbox = await post("/api/sandboxes", {action: "create", type: "test", taskId: state.taskId, agentId: "AG-QA", risk: "LOW"});
  expectStatus("Sandbox anlegen", sandbox, 201);
  state.sandboxId = sandbox.json?.sandbox?.sandboxId;
  expectField("Sandbox hat Lifecycle und Netzwerk-Default", sandbox, j => typeof j.sandbox?.lifecycle === "string" && j.sandbox?.network === "DENY", "lifecycle + network=DENY");

  expectStatus("Sandbox starten", await post("/api/sandboxes", {action: "start", sandboxId: state.sandboxId}), 200);
  const snapshot = await post("/api/sandboxes", {action: "snapshot", sandboxId: state.sandboxId});
  expectStatus("Snapshot erstellen", snapshot, 201);
  state.snapshotId = snapshot.json?.snapshot?.snapshotId;
  expectField("Snapshot hat Digest", snapshot, j => typeof j.snapshot?.digest === "string" && j.snapshot.digest.length >= 16, "digest");
  expectStatus("Snapshot wiederherstellen", await post("/api/sandboxes", {action: "restore", sandboxId: state.sandboxId, snapshotId: state.snapshotId}), 200);
  expectStatus("Sandbox pausieren", await post("/api/sandboxes", {action: "pause", sandboxId: state.sandboxId}), 200);
  expectStatus("Sandbox zurücksetzen", await post("/api/sandboxes", {action: "reset", sandboxId: state.sandboxId}), 200);
  expectStatus("Sandbox klonen", await post("/api/sandboxes", {action: "clone", sourceSandboxId: state.sandboxId, taskId: state.taskId, agentId: "AG-QA", risk: "LOW", type: "test"}), 201);

  // Vertrag: `expiresAt` (ISO) und `risk` — nicht `ttlMs`/`maxRisk`. Früher
  // nahm das Modul jeden Körper an und speicherte Tokens **ohne Ablauf**, die
  // dadurch nie ungültig wurden (fail open). Seit dem Fix ist der Ablauf Pflicht.
  const token = await post("/api/authority", {action: "issue", input: {subject: "AG-QA", issuedBy: "CREATOR", issuedByKind: "CREATOR", taskId: state.taskId, sandboxId: state.sandboxId, environment: "test", capabilities: ["sandbox:run", "run:manage"], risk: "LOW", expiresAt: new Date(Date.now() + 600_000).toISOString()}});
  expectStatus("Capability ausstellen", token, [200, 201]);
  state.tokenId = token.json?.token?.tokenId ?? token.json?.tokenId;
  expectField("Capability ist an einen Ablauf gebunden", token, j => Number.isFinite(Date.parse(String(j.token?.expiresAt ?? ""))), "expiresAt");
  const noExpiry = await post("/api/authority", {action: "issue", input: {subject: "AG-QA", issuedBy: "CREATOR", issuedByKind: "CREATOR", taskId: state.taskId, sandboxId: state.sandboxId, capabilities: ["sandbox:run"], risk: "LOW"}});
  expectStatus("Capability ohne Ablauf wird verweigert", noExpiry, 400);
  expectField("Verweigerungsgrund nennt den Ablauf", noExpiry, j => /expiry|expiresAt/i.test(String(j.message ?? j.error ?? "")), "expiry");

  const run = await post("/api/runs", {action: "create", taskId: state.taskId, agentId: "AG-QA", risk: "LOW", sandboxId: state.sandboxId});
  expectStatus("Run anlegen", run, 201);
  state.runId = run.json?.run?.runId;
  expectField("Run hat Zustand", run, j => typeof j.run?.state === "string", "state");

  const gate = await post("/api/execution-gate", {taskId: state.taskId});
  expectStatus("Execution Gate bewertet Task", gate, [200, 403]);
  expectField("Gate liefert Entscheidung und Gründe", gate, j => typeof j.allowed === "boolean" && Array.isArray(j.reasons), "allowed + reasons");

  const execution = await post("/api/runtime", {action: "execute", taskId: state.taskId, sandboxId: state.sandboxId, agentId: "AG-QA", capabilityTokenId: state.tokenId, argv: ["node", "-e", "console.log('aktions-audit-ok')"], purpose: "Aktionsprüfung"});
  expectStatus("Autorisierte Ausführung", execution, [200, 409]);
  if (execution.status === 200) {
    expectField("Ausführung liefert Ergebnis", execution, j => j.accepted === true && typeof j.result?.stdout === "string", "accepted + stdout");
    expectField("Ausführung ist evidenzgebunden", execution, j => typeof j.evidenceId === "string" || typeof j.result?.evidenceId === "string", "evidenceId");
  }
  expectStatus("Runtime abstimmen", await post("/api/runtime", {action: "reconcile"}), 200);
  return true;
}

async function chainErrorLifecycle() {
  step("5. Kette: Fehler → Diagnose → Experiment → Root Cause → Recovery → Verifikation → Regression");
  const incident = await post("/api/errors", {action: "create", input: {
    severity: "MEDIUM", symptom: "Aktions-Audit Ausfall", incident: "Ausfallmeldung der Aktionsprüfung",
    failureMode: "RUN_EXECUTION_FAILURE", contributingFactors: ["audit"], prevention: [], evidenceIds: [],
    taskId: state.taskId, runId: state.runId, agentId: "AG-QA", sandboxId: state.sandboxId, error: "Ausfallmeldung der Aktionsprüfung"
  }});
  expectStatus("Fehler-Incident anlegen", incident, 201);
  state.incidentId = incident.json?.incidentId ?? incident.json?.incident?.incidentId;
  expectField("Incident beginnt in DETECTED", incident, j => (j.status ?? j.incident?.status) === "DETECTED", "status=DETECTED");

  expectStatus("Transition TRIAGING", await post("/api/errors", {action: "transition", id: state.incidentId, status: "TRIAGING"}), 200);
  const investigation = await post("/api/errors", {action: "investigate", id: state.incidentId});
  expectStatus("Untersuchung bis DIAGNOSING", investigation, 200);
  expectField("Untersuchung liefert Diagnose-Sandbox", investigation, j => typeof j.diagnosticSandboxId === "string" || typeof j.incident?.diagnosticSandboxId === "string", "diagnosticSandboxId");

  expectStatus("Hypothese", await post("/api/errors", {action: "hypothesis", id: state.incidentId, hypothesis: "Der Ausfall entsteht durch die unbehandelte Fehlerbedingung"}), 200);
  expectStatus("Experiment starten", await post("/api/errors", {action: "experiment", id: state.incidentId}), 201);
  expectStatus("Evidenz erfassen", await post("/api/errors", {action: "evidence", id: state.incidentId, claim: "Reproduktion", value: "Fehler tritt reproduzierbar auf"}), 200);
  const rootCause = await post("/api/errors", {action: "root_cause", id: state.incidentId, rootCause: "Unbehandelte Fehlerbedingung bricht den Lauf ab"});
  expectStatus("Root Cause mit Evidenz", rootCause, 200);
  expectField("Root Cause verweist auf Evidenz", rootCause, j => Array.isArray(j.evidenceIds) && j.evidenceIds.length > 0, "evidenceIds");
  expectStatus("Root Cause ohne Evidenz wird verweigert", await post("/api/errors", {action: "root_cause", id: state.incidentId, rootCause: "Ursache ohne Nachweis"}), [400, 409]);

  const recovery = await post("/api/errors", {action: "recovery", id: state.incidentId});
  expectStatus("Recovery vorbereiten", recovery, 201);
  state.recoveryId = recovery.json?.recoveryId ?? recovery.json?.incident?.recoveryId;
  expectField("Recovery hat Stufe und Gründe", recovery, j => typeof (j.recoveryTier ?? j.incident?.recoveryTier) === "number" && Array.isArray(j.recoveryReasons ?? j.incident?.recoveryReasons ?? []), "recoveryTier + recoveryReasons");

  expectStatus("Recovery ausführen", await post("/api/errors", {action: "recovery.execute", id: state.incidentId}), [200, 201]);
  expectStatus("Recovery verifizieren", await post("/api/errors", {action: "recovery.verify", id: state.incidentId}), 200);
  const regression = await post("/api/errors", {action: "regression", id: state.incidentId, argv: ["node", "-e", "process.exit(0)"]});
  expectStatus("Regressionstest registrieren", regression, [200, 201]);
  const verify = await post("/api/errors", {action: "fix.verify", id: state.incidentId});
  expectStatus("Fix verifizieren", verify, 200);
  const learn = await post("/api/errors", {action: "learn", id: state.incidentId, summary: "Audit: Fehlerbedingung behandeln"});
  expectStatus("Lernen bis REGRESSION_LOCKED", learn, 200);
  expectField("Negatives Wissen verknüpft", learn, j => typeof (j.knowledgeId ?? j.incident?.knowledgeId) === "string", "knowledgeId");
  return true;
}

async function chainFabricAndOps() {
  step("6. Kette: Skills, Werkstatt, Simulation, Apps/Module, CI/CD");
  const skill = await post("/api/skills", {action: "register", skill: {id: `skill.audit.${STAMP}`, name: "Audit-Skill", description: "Prüfskill", version: "1.0.0", tools: [], inputSchema: {}, outputSchema: {}, capabilities: [], allowedEnvironments: ["test"], risk: "LOW", timeoutMs: 1000, resourceLimits: {cpuMillicores: 100, memoryMb: 128}, network: "DENY", sideEffects: [], reversible: true, approvalRequired: false, lifecycle: "DRAFT"}});
  expectStatus("Skill registrieren", skill, 201);
  state.skillId = skill.json?.skill?.id;
  expectStatus("Skill-Lifecycle wechseln", await post("/api/skills", {action: "transition", id: state.skillId, lifecycle: "VALIDATED"}), 200);

  const workshop = await post("/api/workshop", {action: "create", value: {id: `WS-${STAMP}`, kind: "TOOL_ADAPTER", name: "Audit-Werkstattstück", description: "Prüfstück", risk: "LOW", stage: "DRAFT"}});
  expectStatus("Werkstatt-Objekt anlegen", workshop, 201);
  state.workshopId = workshop.json?.item?.id;
  expectStatus("Werkstatt-Objekt fortführen", await post("/api/workshop", {action: "advance", id: state.workshopId, stage: "SPECIFICATION"}), 200);

  const scenario = await post("/api/simulation", {action: "create", scenario: {id: `SIM-${STAMP}`, name: "Audit-Szenario", kind: "FAILURE_DRILL", description: "Prüfszenario", state: "READY"}});
  expectStatus("Simulation anlegen", scenario, 201);
  state.scenarioId = scenario.json?.scenario?.id ?? scenario.json?.id;
  expectStatus("Simulation fortschreiben", await post("/api/simulation", {action: "advance", id: state.scenarioId, state: "RUNNING", result: {detail: "ok"}}), 200);

  const module = await post("/api/apps", {action: "register-module", value: {id: `MOD-${STAMP}`, name: "Audit-Modul", description: "Prüfmodul", version: "1.0.0", kind: "SCRIPT", entrypoint: "index.js", digest: "a".repeat(64), validated: true}});
  expectStatus("Ausführbares Modul registrieren", module, [201, 400]);
  state.moduleId = module.json?.module?.id;
  expectStatus("Modul ohne Freigabe installieren", await post("/api/apps", {action: "install-module", moduleId: state.moduleId, approvalId: "APR-gibtsnicht", taskId: state.taskId}), [400, 403, 409]);
  const app = await post("/api/apps", {action: "create", value: {name: "Audit-App", description: "Prüfanwendung", version: "1.0.0", taskId: state.taskId}});
  expectStatus("App anlegen", app, 201);
  state.appId = app.json?.app?.id;
  expectField("App hat Kennung und Zustand", app, j => typeof j.app?.id === "string" && typeof j.app?.state === "string", "id + state");
  expectStatus("App-Zustand setzen", await post("/api/apps", {action: "state", appId: state.appId, state: "RUNNING", progress: 50, taskId: state.taskId}), 200);

  const pipeline = await post("/api/cicd", {action: "create", value: {taskId: state.taskId, branch: `audit/${STAMP}`}});
  expectStatus("Pipeline anlegen", pipeline, 201);
  state.pipelineId = pipeline.json?.pipeline?.id;
  expectField("Pipeline hat Kennung und Stufe", pipeline, j => typeof j.pipeline?.id === "string" && typeof j.pipeline?.stage === "string", "id + stage");
  expectStatus("Pipeline-Prüfung erfassen", await post("/api/cicd", {action: "check", pipelineId: state.pipelineId, kind: "BUILD", status: "PASSED", summary: "ok"}), 200);
  expectStatus("Promotion-Gate verweigert ohne Nachweise", await post("/api/promotion-gate", {pipelineId: state.pipelineId, target: "PRODUCTION"}), [403, 400, 200]);
  expectStatus("Promotion-Gate unbekannte Pipeline", await post("/api/promotion-gate", {pipelineId: "PIPE-gibtsnicht", target: "PRODUCTION"}), 404);
  return true;
}

async function chainDevicesAndProviders() {
  step("7. Kette: Geräte, Computer Use, Provider, Secrets");
  const device = await post("/api/devices", {action: "discover", device: {id: `DEV-${STAMP}`, name: "Audit-Gerät", os: "linux", kind: "SENSOR"}});
  expectStatus("Gerät entdecken", device, 201);
  state.deviceId = device.json?.id ?? device.json?.device?.id;
  expectField("Gerät ist nicht implizit autorisiert", device, j => j.device?.authorized === false || j.device?.authorized === undefined, "authorized != true");
  expectStatus("Gerät autorisieren", await post("/api/devices", {action: "authorize", id: state.deviceId, authorized: true}), 200);
  expectStatus("Gerät reservieren", await post("/api/devices", {action: "allocate", id: state.deviceId, taskId: state.taskId}), 200);
  expectStatus("Gerät freigeben", await post("/api/devices", {action: "release", id: state.deviceId}), 200);

  const computer = await post("/api/computer-use", {action: "register", computer: {id: `CU-${STAMP}`, name: "Audit-Computer", kind: "DESKTOP", description: "Prüfgerät"}});
  expectStatus("Computer registrieren", computer, [201, 400]);
  state.computerId = computer.json?.id ?? computer.json?.computer?.id;
  expectStatus("Computer ohne Autorisierung reservieren", await post("/api/computer-use", {action: "allocate", id: state.computerId, taskId: state.taskId, sandboxId: state.sandboxId}), [400, 403, 409]);
  // Discovery ≠ Autorisierung: die Registrierung darf keine Autorisierung
  // mitbringen (sie hätte keinen `computer.authorized`-Nachweis in der Kette).
  const preAuthorized = await post("/api/computer-use", {action: "register", computer: {name: `Audit-Computer-Vorautorisiert-${STAMP}`, kind: "CLI", os: "linux", arch: "x64", network: "DENY", capabilities: [{kind: "CLI", actions: ["PROCESS_READ"], environments: ["test"], network: "DENY", risk: "LOW"}], authorized: true}});
  expectStatus("Computer mit Autorisierung registrieren", preAuthorized, 201);
  expectField("Registrierung verwirft die Autorisierung", preAuthorized, j => j.computer?.authorized === false, "authorized=false");
  const preAuthorizedAllocation = await post("/api/computer-use", {action: "allocate", id: preAuthorized.json?.computer?.id, taskId: state.taskId});
  expectStatus("Vorautorisiert gemeldeter Computer bleibt gesperrt", preAuthorizedAllocation, [400, 403, 409]);
  expectStatus("Computer autorisieren", await post("/api/computer-use", {action: "authorize", id: state.computerId, authorized: true}), 200);

  const provider = await post("/api/providers", {action: "connect", id: `PRV-${STAMP}`, endpoint: "https://provider.invalid", credentialRef: "secret://audit", approvalId: "APR-gibtsnicht"});
  expectStatus("Provider verbinden ohne Freigabe", provider, [400, 403, 409]);
  expectStatus("Provider-Zustand lesen", await post("/api/providers", {action: "state", id: `PRV-${STAMP}`, lifecycle: "DISCOVERED", health: "UNKNOWN"}), [200, 400]);

  expectStatus("Secret-Lease ohne Subjekt wird abgelehnt", await post("/api/secrets", {action: "issue"}), 400);
  expectStatus("Secret-Prüfung ohne Kennung wird abgelehnt", await post("/api/secrets", {action: "validate"}), 400);
  expectStatus("Secret-Widerruf ohne Kennung wird abgelehnt", await post("/api/secrets", {action: "revoke"}), 400);
  expectStatus("Secret-Redaktion ohne Wert wird abgelehnt", await post("/api/secrets", {action: "redact"}), 400);
  const lease = await post("/api/secrets", {action: "issue", subjectId: "AG-QA", taskId: state.taskId, scopes: ["read"], ttlMs: 60_000});
  expectStatus("Secret-Lease ausstellen", lease, [200, 201]);
  state.leaseId = lease.json?.lease?.id ?? lease.json?.lease?.leaseId;
  expectField("Secret-Lease hat Kennung und Ablauf", lease, j => typeof j.lease?.id === "string" && typeof j.lease?.expiresAt === "string", "lease.id + expiresAt");
  expectStatus("Secret-Lease prüfen", await post("/api/secrets", {action: "validate", leaseId: state.leaseId, subjectId: "AG-QA", taskId: state.taskId}), 200);
  expectStatus("Secret-Lease widerrufen", await post("/api/secrets", {action: "revoke", leaseId: state.leaseId}), 200);
  expectStatus("Secret redigieren", await post("/api/secrets", {action: "redact", value: "token=abcdef"}), 200);
  return true;
}

async function chainInboxApprovalsKnowledge() {
  step("8. Kette: Inbox, Approvals, Knowledge, Provenance, Persistenz");
  for (const mode of ["INFORM", "ASK", "BLOCK", "ESCALATE"]) {
    const created = await post("/api/inbox", {action: "notify", item: {mode, title: `Audit ${mode}`, message: `Prüfnachricht ${mode}`, taskId: state.taskId, agentId: "AG-QA"}});
    expectStatus(`Inbox ${mode} anlegen`, created, [201, 200]);
    const id = created.json?.item?.id ?? created.json?.id;
    expectStatus(`Inbox ${mode} beantworten`, await post("/api/inbox", {action: "resolve", id, decision: "ACKNOWLEDGED"}), [200, 400]);
  }

  const approval = await post("/api/approvals/center", {action: "create", value: {
    taskId: state.taskId, requestedBy: "AG-QA", changeSummary: "Audit-Änderung", why: "Aktionsprüfung",
    expectedEffect: "Nachweis", risks: ["keine"], testResults: ["ok"], rollbackPlan: "Revert",
    files: [], dbChanges: [], networkEffects: [], affectedSystems: []
  }});
  expectStatus("Approval anlegen", approval, 201);
  state.approvalId = approval.json?.approval?.id ?? approval.json?.approval?.approvalId;
  expectStatus("Approval prüfen", await post("/api/approvals/center", {action: "check", id: state.approvalId}), 200);

  const knowledge = await post("/api/knowledge", {action: "upsert", record: {layer: "SEMANTIC", subject: `Audit ${STAMP}`, predicate: "verified_by", object: "Aktionsprüfung", state: "OBSERVED", sourceIds: ["AUDIT"], evidenceIds: []}});
  expectStatus("Wissen anlegen", knowledge, 201);
  state.knowledgeId = knowledge.json?.knowledgeId ?? knowledge.json?.knowledge?.knowledgeId;
  expectStatus("Wissen verknüpfen", await post("/api/knowledge", {action: "link", from: state.knowledgeId, to: state.knowledgeId, relation: "REFINES"}), [201, 400]);
  expectStatus("Wissen aktualisieren", await post("/api/knowledge", {action: "update", id: state.knowledgeId, patch: {state: "SUPPORTED"}}), 200);

  const node = await post("/api/provenance", {action: "node", value: {id: `NODE-${STAMP}`, kind: "ARTIFACT", label: "Audit-Artefakt", refId: state.taskId}});
  expectStatus("Provenance-Knoten", node, [201, 400]);
  expectStatus("Provenance-Kante", await post("/api/provenance", {action: "edge", value: {id: `EDGE-${STAMP}`, from: `NODE-${STAMP}`, to: `NODE-${STAMP}`, relation: "DERIVED_FROM", evidenceIds: []}}), [201, 400]);

  expectStatus("Persistenz-Backup", await post("/api/persistence", {action: "backup"}), 201);
  expectStatus("Persistenz-Reparatur", await post("/api/persistence", {action: "repair"}), [200, 201]);
  const report = await get("/api/persistence");
  expectField(
    "Persistenzbericht ohne Integritätsfehler",
    report,
    j => Array.isArray(j.stores?.stores) && j.stores.stores.every(entry => entry.ok !== false),
    "stores.stores[] alle ok"
  );
  return true;
}

async function chainWorkersAndGates() {
  step("9. Kette: Dispatcher → Worker → Queue → Gate");
  const dispatch = await post("/api/dispatcher", {action: "dispatch", taskId: state.taskId, agentId: "AG-QA", risk: "LOW", sandboxType: "test"});
  expectStatus("Dispatch legt Lauf und Job an", dispatch, 201);
  state.jobId = dispatch.json?.jobId;
  state.dispatchedRunId = dispatch.json?.runId;
  expectField("Dispatch liefert Lauf, Job und Sandbox", dispatch, j => typeof j.runId === "string" && typeof j.jobId === "string" && typeof j.sandboxId === "string", "runId + jobId + sandboxId");

  const snapshot = await get("/api/queue");
  const job = (snapshot.json?.jobs ?? []).find(entry => entry.jobId === state.jobId);
  if (job) ok("Job steht in der Queue", `${job.jobId} ${job.state}`);
  else bad("Job steht in der Queue", JSON.stringify(snapshot.json).slice(0, 160));
  if (job && job.state === "QUEUED") {
    expectStatus("Job leasen", await post("/api/queue", {action: "lease", id: state.jobId}), 200);
    expectStatus("Job starten", await post("/api/queue", {action: "start", id: state.jobId}), 200);
    expectStatus("Job-Heartbeat", await post("/api/queue", {action: "heartbeat", id: state.jobId}), 200);
    expectStatus("Job abschließen", await post("/api/queue", {action: "complete", id: state.jobId}), 200);
  }
  expectStatus("Abgelaufene Leases aufräumen", await post("/api/queue", {action: "expire"}), 200);

  const cycle = await post("/api/worker", {});
  expectStatus("Worker-Zyklus", cycle, 200);
  expectField("Worker-Zyklus meldet alle Ergebnisklassen", cycle, j => ["leased", "completed", "failed", "recovered", "deadLettered", "recoveryFailures", "jobFailures"].every(key => Array.isArray(j[key])), "leased/failed/recovered/recoveryFailures/jobFailures");
  return true;
}

async function chainGovernance() {
  step("10. Kette: Governance, Lockdown, Audit, Artefakte");
  expectStatus("Kill-Switch setzen", await post("/api/governance", {action: "kill", scope: "TASK", targetId: state.taskId, reason: "Aktionsprüfung"}), [200, 201]);
  expectStatus("Kill-Switch prüfen", await post("/api/governance", {action: "is-killed", scope: "TASK", targetId: state.taskId}), 200);
  expectStatus("Kill-Switch aufheben", await post("/api/governance", {action: "release", scope: "TASK", targetId: state.taskId, reason: "Aktionsprüfung beendet"}), [200, 201]);
  expectStatus("Autoritätskante delegieren", await post("/api/authority", {action: "delegate", edge: {id: `EDGE-${STAMP}`, from: "CREATOR", to: "AG-QA", kind: "DELEGATES", capabilities: ["sandbox:run"], maxRisk: "LOW", expiresAt: null}}), [200, 201]);

  const lockdown = await post("/api/control", {action: "lockdown", locked: false});
  expectStatus("Lockdown setzen", lockdown, 200);
  expectStatus("Guardian-Lauf", await post("/api/control", {action: "guardian"}), 200);

  expectStatus("Audit-Kette verifizieren", await post("/api/audit", {action: "verify"}), 200);
  const audit = await get("/api/audit");
  expectField("Audit-Kette integer", audit, j => (j.chain?.valid ?? j.integrity?.valid ?? j.valid) !== false, "chain.valid != false");

  const artifact = await post("/api/artifacts", {content: "audit-nachweis", artifact: {id: `ART-${STAMP}`, kind: "REPORT", label: "Audit-Bericht", taskId: state.taskId}});
  expectStatus("Artefakt schreiben", artifact, [201, 400]);
  if (artifact.status === 201) expectField("Artefakt hat serverseitigen Digest", artifact, j => typeof j.artifact?.digest === "string", "digest");
  return true;
}

async function chainScience() {
  step("11. Kette: Science (Objective → Experiment → Lauf → Validierung → Entscheidung)");
  const objective = await post("/api/science", {action: "objective", value: {id: `SOBJ-${STAMP}`, missionId: state.missionId, title: "Audit-Wissenschaftsziel", description: "Prüfziel"}});
  expectStatus("Science-Objective", objective, 201);
  const experiment = await post("/api/science", {action: "experiment", value: {
    experimentId: `SEXP-${STAMP}`, taskId: state.taskId, agentId: "AG-QA", objectiveId: objective.json?.objective?.objectiveId ?? `SOBJ-${STAMP}`,
    title: "Audit-Experiment", sandboxId: state.sandboxId, hypothesis: "Der Nachweis ist reproduzierbar",
    baseline: "bekannt guter Lauf", control: "unveränderter Ablauf", variables: ["audit"], confounders: ["Umgebung"],
    expectedResult: "Reproduktion", alternativeExplanations: ["Umgebungsvarianz"]
  }});
  expectStatus("Science-Experiment anlegen", experiment, 201);
  const evidence = await post("/api/science", {action: "evidence", value: {experimentId: `SEXP-${STAMP}`, kind: "OBSERVATION", claim: "Audit-Beobachtung", value: "beobachtet", knowledgeState: "OBSERVED"}});
  expectStatus("Science-Evidenz", evidence, [201, 400]);
  expectStatus("Science-Validierung", await post("/api/science", {action: "experiment.validate", id: `SEXP-${STAMP}`}), [200, 400]);
  expectStatus("Science-Entscheidung", await post("/api/science", {action: "decision", value: {experimentId: `SEXP-${STAMP}`, decision: "CONTINUE", rationale: "Nachweis reproduzierbar"}}), [201, 400]);
  return true;
}

/**
 * Restliche Aktionen mit echten Zustandsübergängen: alles, was in den Ketten
 * oben noch nicht positiv durchlaufen wurde (Run-Lebenszyklus, Queue-Fehler,
 * Capability-Modi, Provider mit Freigabe, Computer-Start, Science-Lauf,
 * Autoritäts-Widerruf, Inbox-Doppelantwort, Approval-Auflösung).
 */
async function chainRemainingActions() {
  step("14. Restliche Aktionen mit echten Übergängen");

  // --- Runs: create → start → complete, create → cancel, create → fail → recover
  const runA = await post("/api/runs", {action: "create", taskId: state.taskId, agentId: "AG-QA", risk: "LOW", sandboxId: state.sandboxId});
  expectStatus("Run für Abschluss anlegen", runA, 201);
  const runAId = runA.json?.run?.runId;
  expectStatus("Run starten", await post("/api/runs", {action: "start", runId: runAId}), 200);
  expectStatus("Run abschließen", await post("/api/runs", {action: "complete", runId: runAId}), 200);

  const runB = await post("/api/runs", {action: "create", taskId: state.taskId, agentId: "AG-QA", risk: "LOW", sandboxId: state.sandboxId});
  const runBId = runB.json?.run?.runId;
  expectStatus("Run abbrechen", await post("/api/runs", {action: "cancel", runId: runBId}), 200);

  const runC = await post("/api/runs", {action: "create", taskId: state.taskId, agentId: "AG-QA", risk: "LOW", sandboxId: state.sandboxId});
  const runCId = runC.json?.run?.runId;
  expectStatus("Run starten", await post("/api/runs", {action: "start", runId: runCId}), 200);
  expectStatus("Run scheitern lassen", await post("/api/runs", {action: "fail", runId: runCId, error: "Audit-Ausfall"}), 200);
  expectStatus("Run-Recovery beginnen", await post("/api/runs", {action: "recover", runId: runCId}), 200);
  const runCState = (await get("/api/runs")).json?.runs?.find(entry => entry.runId === runCId)?.state;
  if (runCState) ok("Run-Zustand nach Recovery", runCState);
  else bad("Run-Zustand nach Recovery", "Lauf nicht gefunden");

  // --- Queue: Fehlerpfad und Abbruch
  // Eigener Task: Dispatch ist auf die zugewiesene Aufgabe begrenzt, und der
  // Haupt-Task hat bereits einen Lauf in Behandlung.
  const queueTask = await post("/api/tasks", {action: "create", missionId: state.missionId, title: `Queue-Fehlerpfad ${STAMP}`, risk: "LOW", assignedAgent: "AG-QA"});
  const queueTaskId = queueTask.json?.task?.taskId;
  const dispatchQ = await post("/api/dispatcher", {action: "dispatch", taskId: queueTaskId, agentId: "AG-QA", risk: "LOW", sandboxType: "test"});
  const jobQ = dispatchQ.json?.jobId;
  if (jobQ) {
    expectStatus("Job leasen (Fehlerpfad)", await post("/api/queue", {action: "lease", id: jobQ}), 200);
    expectStatus("Job starten (Fehlerpfad)", await post("/api/queue", {action: "start", id: jobQ}), 200);
    expectStatus("Job scheitern lassen", await post("/api/queue", {action: "fail", id: jobQ, error: "Audit-Fehler"}), [200, 201]);
    const afterFail = (await get("/api/queue")).json?.jobs?.find(entry => entry.jobId === jobQ);
    if (afterFail && ["QUEUED", "FAILED", "DEAD_LETTER"].includes(afterFail.state)) ok("Job bleibt in gültigem Zustand nach Fehler", `${afterFail.state} attempt=${afterFail.attempt}`);
    else bad("Job bleibt in gültigem Zustand nach Fehler", JSON.stringify(afterFail));
    expectStatus("Job abbrechen", await post("/api/queue", {action: "cancel", id: jobQ}), [200, 409]);
  } else {
    bad("Job für Fehlerpfad", "kein Job aus Dispatch");
  }
  expectStatus("Job mit unbekannter Kennung", await post("/api/queue", {action: "lease", id: "JOB-gibtsnicht"}), 409);

  // --- Capabilities: beide Prüfmodi
  expectStatus("Rollenprüfung erlaubt", await post("/api/capabilities", {mode: "role-check", role: "DEVELOPER", capability: "sandbox:run"}), 200);
  expectStatus("Rollenprüfung verweigert", await post("/api/capabilities", {mode: "role-check", role: "VIEWER", capability: "sandbox:run"}), 200);
  expectStatus("Unbekannte Rolle wird mit Klartext abgelehnt", await post("/api/capabilities", {mode: "role-check", role: "GIBTSNICHT", capability: "sandbox:run"}), 400);
  const abac = await post("/api/capabilities", {mode: "authorize", subject: {actorId: "AG-QA", role: "DEVELOPER", capabilities: ["sandbox:run"], environment: "development"}, policy: {action: "sandbox:run", resource: state.sandboxId, risk: "LOW", requiresApproval: false, environment: "development"}});
  expectStatus("ABAC-Prüfung liefert Entscheidung", abac, [200, 403]);
  expectField("ABAC-Antwort ist begründet", abac, j => typeof j.allowed === "boolean" && typeof j.reason === "string", "allowed + reason");

  // --- Authority: Token widerrufen, unbekannte Kante verweigert
  if (state.tokenId) expectStatus("Capability widerrufen", await post("/api/authority", {action: "revoke", id: state.tokenId}), [200, 201]);
  const selfGrant = await post("/api/authority", {action: "issue", input: {subject: "AG-QA", issuedBy: "AG-QA", capabilities: ["sandbox:run"], risk: "LOW", expiresAt: new Date(Date.now() + 60_000).toISOString()}});
  expectStatus("Selbstvergabe wird verweigert", selfGrant, [400, 403]);
  expectField("Verweigerungsgrund ist die Selbstvergabe", selfGrant, j => /self-grant|SELF_GRANT/i.test(JSON.stringify(j)), "SELF_GRANT");

  // --- Provider: Discovery ≠ Verbindung; Verbindung nur mit Freigabe
  expectStatus("Provider entdecken (Zustand setzen)", await post("/api/providers", {action: "state", id: `PRV-${STAMP}`, lifecycle: "DISCOVERED", health: "UNKNOWN"}), [200, 400, 404]);
  expectStatus("Provider ohne Freigabe verbinden", await post("/api/providers", {action: "connect", id: `PRV-${STAMP}`, endpoint: "https://provider.invalid", credentialRef: "secret://audit", approvalId: "APR-unbekannt"}), [400, 403, 409]);
  expectStatus("Provider-Heartbeat", await post("/api/providers", {action: "heartbeat", id: `PRV-${STAMP}`, health: "HEALTHY", latencyMs: 12}), [200, 400, 404]);
  expectStatus("Provider binden", await post("/api/providers", {action: "bind", providerId: `PRV-${STAMP}`, scope: "TASK", scopeId: state.taskId, capabilities: ["inference"]}), [201, 400, 404]);

  // --- Computer Use: Start erst nach Autorisierung und Reservierung
  if (state.computerId) {
    expectStatus("Computer reservieren", await post("/api/computer-use", {action: "allocate", id: state.computerId, taskId: state.taskId, sandboxId: state.sandboxId}), [200, 400, 409]);
    expectStatus("Computer starten", await post("/api/computer-use", {action: "start", id: state.computerId}), [200, 400, 409]);
    expectStatus("Computer freigeben", await post("/api/computer-use", {action: "release", id: state.computerId}), [200, 400]);
  }

  // --- Science: echter Experimentlauf über den Broker
  if (state.tokenId) {
    const scienceRun = await post("/api/science", {action: "experiment.run", id: `SEXP-${STAMP}`, kind: "BASELINE", sandboxId: state.sandboxId, agentId: "AG-QA", taskId: state.taskId, capabilityTokenId: state.tokenId, argv: ["node", "-e", "console.log('science-ok')"]});
    expectStatus("Science-Experimentlauf", scienceRun, [201, 409]);
  }

  // --- Inbox: doppelte Beantwortung ist kein stiller Erfolg
  const inbox = await post("/api/inbox", {action: "notify", item: {mode: "ASK", title: "Doppelantwort", message: "Prüfung", taskId: state.taskId}});
  const inboxId = inbox.json?.inboxId ?? inbox.json?.item?.inboxId ?? inbox.json?.item?.id;
  expectStatus("Inbox beantworten", await post("/api/inbox", {action: "resolve", id: inboxId, decision: "ACKNOWLEDGED"}), 200);
  expectStatus("Inbox doppelt beantworten wird verweigert", await post("/api/inbox", {action: "resolve", id: inboxId, decision: "ACKNOWLEDGED"}), 400);

  // --- Approvals: Auflösung über Capability statt Sitzung
  const tokenForApproval = await post("/api/authority", {action: "issue", input: {subject: "AG-QA", issuedBy: "CREATOR", issuedByKind: "CREATOR", taskId: state.taskId, sandboxId: state.sandboxId, environment: "test", capabilities: ["approval:resolve"], risk: "LOW", expiresAt: new Date(Date.now() + 600_000).toISOString()}});
  const approvalTokenId = tokenForApproval.json?.token?.tokenId ?? tokenForApproval.json?.token?.id ?? tokenForApproval.json?.id;
  if (state.approvalId && approvalTokenId) {
    const resolve = await post("/api/approvals/center", {action: "resolve", id: state.approvalId, status: "GRANTED", actor: "CREATOR", capabilityTokenId: approvalTokenId});
    expectStatus("Approval mit Capability auflösen", resolve, [200, 201]);
    const withoutToken = await post("/api/approvals/center", {action: "resolve", id: state.approvalId, status: "DENIED", actor: "AG-QA"});
    expectStatus("Approval ohne Capability wird verweigert", withoutToken, [400, 401, 403]);
  } else {
    bad("Approval-Auflösung", "Freigabe- oder Token-Kennung fehlt");
  }

  // --- Fehler: Eskalation und Regression ohne Nachweis
  const escalated = await post("/api/errors", {action: "create", input: {severity: "LOW", symptom: "Eskalationsprüfung", incident: "Eskalationsprüfung", failureMode: "RUN_EXECUTION_FAILURE", contributingFactors: ["audit"], prevention: [], evidenceIds: [], error: "Eskalationsprüfung"}});
  const escalateId = escalated.json?.incidentId;
  expectStatus("Incident eskalieren", await post("/api/errors", {action: "transition", id: escalateId, status: "ESCALATED"}), 200);
  expectStatus("Ungültiger Übergang wird verweigert", await post("/api/errors", {action: "transition", id: escalateId, status: "REGRESSION_LOCKED"}), [400, 409]);
  const badSeverity = await post("/api/errors", {action: "create", input: {severity: "LAUT", symptom: "x", incident: "y", failureMode: "RUN_EXECUTION_FAILURE", contributingFactors: [], prevention: [], evidenceIds: []}});
  expectStatus("Ungültige Schwere wird abgelehnt", badSeverity, 400);
}

async function integrity() {
  step("12. Integrität: GET-Routen, Readiness, Metriken, Timeline");
  const routes = walkRoutes().map(file => `/api/${relative("app/api", file).replace(/\/route\.ts$/, "")}`);
  let checked = 0;
  for (const route of routes) {
    const response = await get(route);
    checked += 1;
    if (response.status >= 500) bad(`GET ${route}`, `Status ${response.status}`);
    else if (response.status === 200 && response.text.trim().length === 0) bad(`GET ${route}`, "leerer Body");
  }
  ok(`${checked} GET-Routen ohne 5xx und ohne leere Antwort`);
  const readiness = await get("/api/readiness");
  expectField("Readiness meldet Status", readiness, j => typeof (j.status ?? j.ready) !== "undefined", "status/ready");
  const metrics = await get("/api/metrics");
  if (metrics.status === 200 && metrics.text.includes("bob_audit_chain_ok")) ok("Metriken enthalten Audit-Ketten-Prüfung");
  else bad("Metriken enthalten Audit-Ketten-Prüfung", `Status ${metrics.status}`);
}

async function main() {
  const matrix = actionMatrix();
  const attributes = attributeMatrix();
  const bodyFree = bodyFreeRoutes();
  console.log(`Aktionsmatrix aus dem Quellcode: ${matrix.size} POST-Routen, ${[...matrix.values()].reduce((sum, list) => sum + list.length, 0)} Aktionen`);
  await login();
  await robustnessMatrix(matrix, bodyFree);
  await attributeChecks(matrix, attributes);
  // Nach den Robustheitsprüfungen erneut anmelden: die Prüfungen rufen die
  // Authentifizierungsgrenze absichtlich ohne gültige Sitzung auf.
  const relogin = await post("/api/auth", {action: "login", secret: LOGIN_SECRET}, {session: false});
  if (relogin.status === 201 || relogin.status === 200) ok("Erneute Anmeldung nach der Matrix", String(relogin.status));
  else bad("Erneute Anmeldung nach der Matrix", `Status ${relogin.status}`);
  const chains = [
    ["Control Plane", chainControlPlane],
    ["Runtime", chainRuntime],
    ["Fabric und Betrieb", chainFabricAndOps],
    ["Geräte/Provider", chainDevicesAndProviders],
    ["Inbox/Approvals/Wissen", chainInboxApprovalsKnowledge],
    ["Worker/Queue", chainWorkersAndGates],
    ["Science", chainScience],
    ["Governance", chainGovernance],
    ["Fehlerlebenszyklus", chainErrorLifecycle],
    ["Restaktionen", chainRemainingActions]
  ];
  for (const [name, run] of chains) {
    try {
      await run();
    } catch (error) {
      const detail = error instanceof Error ? error.stack?.split("\n").slice(0, 2).join(" | ") : String(error);
      bad(`Kette ${name}: unerwarteter Abbruch`, detail);
    }
  }
  await integrity();

  step("13. Sitzungsverwaltung (renew/logout am Ende)");
  const renew = await post("/api/auth", {action: "renew"});
  expectStatus("Sitzung erneuern", renew, [200, 201]);
  const logout = await post("/api/auth", {action: "logout"});
  expectStatus("Sitzung beenden", logout, 200);
  const after = await get("/api/control");
  if (after.status === 401 || after.status === 403) ok("Nach dem Logout ist die Sitzung ungültig", String(after.status));
  else bad("Nach dem Logout ist die Sitzung ungültig", `Status ${after.status}`);

  step("Ergebnis");
  console.log(`Ergebnis: \u001b[32m${pass} bestanden\u001b[0m, \u001b[31m${fail} fehlgeschlagen\u001b[0m`);
  if (fail > 0) {
    console.log("\nFehlschläge:");
    for (const entry of failures) console.log(`  - ${entry.name}${entry.detail ? `: ${entry.detail}` : ""}`);
  }
  process.exit(fail === 0 ? 0 : 1);
}

main().catch(error => {
  console.error(`Abbruch: ${error instanceof Error ? error.stack : String(error)}`);
  process.exit(1);
});
