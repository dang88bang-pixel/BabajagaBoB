#!/usr/bin/env node
/**
 * Fehlerinjektion am **laufenden Dienst** (Abschnitt 37 / TEST-003).
 *
 *   node scripts/fault-injection.mjs                     # 2 Zyklen, Port 3300
 *   node scripts/fault-injection.mjs --cycles=3 --port=3400
 *   node scripts/fault-injection.mjs --storage=/tmp/bob-crash
 *
 * Was hier wirklich passiert — kein Mock, kein Nachstellen:
 *
 *   1. Ein **echter** Dienst wird gestartet (`next start` aus dem gebauten
 *      Stand) und über HTTP benutzt: Bootstrap, Mission, Aufgabe, Dispatch.
 *   2. Ein Job wird **geleast** — es liegt also echte Arbeit „in Arbeit“, als
 *      der Prozess stirbt.
 *   3. Der Prozess wird mit **SIGKILL** abgeschossen (kein Aufräumen, keine
 *      Hooks, kein letzter Schreibvorgang).
 *   4. Der Dienst wird neu gestartet und gegen **denselben** Speicher geprüft:
 *      Sitzung, Daten, Job-Identität (keine Doppelung), Lease-Wiederherstellung,
 *      Audit-/Event-Kette, Store-Integrität.
 *
 * Jede Prüfung ist ein Objekt `{name, ok, detail}`; der Bericht landet in
 * `<storage>/fault-injection/report.json` — genau dort, wo
 * `lib/fault-injection.ts#faultSnapshot()` ihn für die Oberfläche liest.
 *
 * Exit 0 nur, wenn **alle** Prüfungen aller Zyklen bestanden sind.
 */
import {Buffer} from "node:buffer";
import {spawn} from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import process from "node:process";

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const argv = process.argv.slice(2);
const flag = name => argv.find(argument => argument.startsWith(`--${name}=`))?.slice(name.length + 3);
const args = new Set(argv);

const PORT = Number(flag("port") ?? 3300);
const BASE = flag("base") ?? `http://127.0.0.1:${PORT}`;
const CYCLES = Number(flag("cycles") ?? 2);
const STORAGE = path.resolve(flag("storage") ?? process.env.BOB_STORAGE_DIR ?? path.join(ROOT, ".bob-data"));
const REPORT = path.join(STORAGE, "fault-injection", "report.json");
const BOOTSTRAP_SECRET = process.env.BOB_BOOTSTRAP_SECRET ?? `fault-injection-${crypto.randomUUID()}`;
const READY_TIMEOUT_MS = Number(flag("timeoutMs") ?? 180_000);
/** Die Standard-Lease des Dienstes beträgt 60 s — so lange darf die Probe warten. */
const RECOVERY_TIMEOUT_MS = Number(flag("recoveryTimeoutMs") ?? 120_000);
const KEEP_LOGS = args.has("--keep-logs");

const say = text => console.log(text);
const ok = text => console.log(`  \u001b[32mPASS\u001b[0m ${text}`);
const bad = text => console.log(`  \u001b[31mFAIL\u001b[0m ${text}`);

const checks = [];
function record(name, passed, detail) {
  checks.push({name, ok: passed, detail});
  if (passed) ok(`${name} — ${detail}`);
  else bad(`${name} — ${detail}`);
  return passed;
}

/* ------------------------------------------------------------- HTTP-Hilfen */

let cookie = "";

function request(method, url, body) {
  return new Promise((resolve, reject) => {
    const payload = body === undefined ? null : JSON.stringify(body);
    const target = new URL(url);
    const req = http.request(
      {
        method,
        hostname: target.hostname,
        port: target.port,
        path: target.pathname + target.search,
        timeout: 30_000,
        headers: {
          ...(payload ? {"content-type": "application/json", "content-length": Buffer.byteLength(payload)} : {}),
          ...(cookie ? {cookie} : {})
        }
      },
      response => {
        let text = "";
        response.setEncoding("utf8");
        response.on("data", chunk => {
          text += chunk;
        });
        response.on("end", () => {
          const setCookie = response.headers["set-cookie"]?.find?.(value => value.startsWith("bob_session="));
          if (setCookie) cookie = setCookie.split(";")[0];
          let json = null;
          try {
            json = text.length > 0 ? JSON.parse(text) : null;
          } catch {
            json = null;
          }
          resolve({status: response.statusCode ?? 0, json, text, headers: response.headers});
        });
      }
    );
    req.on("timeout", () => req.destroy(new Error(`timeout: ${method} ${url}`)));
    req.on("error", reject);
    if (payload) req.write(payload);
    req.end();
  });
}

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

/** 200 und 201 sind Erfolg — ein Anlegen antwortet mit 201. */
const isOk = status => status === 200 || status === 201;

/* ------------------------------------------------------------ Dienstzyklus */

const logs = [];

function startService() {
  const child = spawn(process.execPath, [path.join(ROOT, "node_modules", "next", "dist", "bin", "next"), "start", "-p", String(PORT)], {
    cwd: ROOT,
    env: {
      ...process.env,
      NODE_ENV: "production",
      PORT: String(PORT),
      BOB_STORAGE_DIR: STORAGE,
      BOB_BOOTSTRAP_SECRET: BOOTSTRAP_SECRET,
      BOB_NS_ISOLATION: process.env.BOB_NS_ISOLATION ?? "off"
    },
    stdio: ["ignore", "pipe", "pipe"],
    detached: true
  });
  const logFile = path.join(STORAGE, "fault-injection", `service-${child.pid}.log`);
  fs.mkdirSync(path.dirname(logFile), {recursive: true});
  const stream = fs.createWriteStream(logFile, {flags: "a"});
  child.stdout.pipe(stream);
  child.stderr.pipe(stream);
  logs.push(logFile);
  return child;
}

async function waitForService(label) {
  const deadline = Date.now() + READY_TIMEOUT_MS;
  while (Date.now() < deadline) {
    try {
      const response = await request("GET", `${BASE}/api/auth`);
      if (response.status === 200) return true;
    } catch {
      /* Dienst noch nicht erreichbar */
    }
    await sleep(500);
  }
  bad(`${label}: Dienst war binnen ${Math.round(READY_TIMEOUT_MS / 1000)} s nicht erreichbar`);
  return false;
}

/** Prozessgruppe hart beenden — genau das, was ein Absturz ist. */
function hardKill(child) {
  try {
    process.kill(-child.pid, "SIGKILL");
  } catch {
    try {
      process.kill(child.pid, "SIGKILL");
    } catch {
      /* schon beendet */
    }
  }
}

async function isDown(child) {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null || child.signalCode !== null) return true;
    await sleep(200);
  }
  return false;
}

/* -------------------------------------------------------------- Prüfungen */

async function auditChainValid() {
  const response = await request("GET", `${BASE}/api/audit`);
  const chain = response.json?.chain;
  return {status: response.status, valid: chain?.valid === true, length: chain?.length ?? 0, issues: chain?.issues ?? []};
}

async function storeIntegrity() {
  const response = await request("GET", `${BASE}/api/persistence`);
  // `/api/persistence` liefert `stores: {root, stores[], ok, unregistered[], registered}`.
  const report = response.json?.stores;
  const list = Array.isArray(report?.stores) ? report.stores : null;
  const broken = list ? list.filter(entry => entry.ok === false) : null;
  const events = response.json?.events;
  return {
    status: response.status,
    registered: report?.registered ?? null,
    ok: report?.ok === true,
    broken: broken === null ? null : broken.length,
    unregistered: Array.isArray(report?.unregistered) ? report.unregistered.length : null,
    eventsOk: events ? events.ok !== false : null
  };
}

async function main() {
  if (!fs.existsSync(path.join(ROOT, ".next", "BUILD_ID"))) {
    console.error(`Fehlerinjektion: kein gebauter Stand gefunden (${path.join(ROOT, ".next", "BUILD_ID")}). Zuerst \`npm run build\` ausführen.`);
    process.exit(2);
  }
  fs.mkdirSync(path.join(STORAGE, "fault-injection"), {recursive: true});
  say(`Fehlerinjektion am laufenden Dienst — ${CYCLES} Zyklus/Zyklen, ${BASE}, Speicher ${STORAGE}`);

  const cycles = [];
  let service = startService();
  const stopEverything = () => {
    if (service.exitCode === null) hardKill(service);
    if (!KEEP_LOGS) for (const file of logs) fs.rmSync(file, {force: true});
  };
  process.on("SIGINT", () => {
    stopEverything();
    process.exit(2);
  });

  try {
    if (!(await waitForService("Start"))) throw new Error("Dienst startete nicht");

    // Bootstrap der Erstinstanz (einmalig, danach existiert die Sitzung bereits).
    const auth = await request("POST", `${BASE}/api/auth`, {action: "bootstrap", secret: BOOTSTRAP_SECRET, creatorName: "Fehlerinjektion"});
    if (![200, 201, 409].includes(auth.status)) {
      throw new Error(`Bootstrap fehlgeschlagen: HTTP ${auth.status} ${auth.text.slice(0, 200)}`);
    }
    if (auth.status === 409) {
      const login = await request("POST", `${BASE}/api/auth`, {action: "login", secret: BOOTSTRAP_SECRET});
      if (login.status !== 200) throw new Error(`Anmeldung an bestehendem Speicher fehlgeschlagen: HTTP ${login.status}`);
    }
    record("Erststart und Creator-Sitzung", Boolean(cookie), cookie ? "Sitzungscookie erhalten" : "keine Sitzung");

    const preAudit = await auditChainValid();
    record("Audit-Kette vor dem Absturz", preAudit.status === 200 && preAudit.valid, `HTTP ${preAudit.status}, ${preAudit.length} Einträge, gültig=${preAudit.valid}`);

    // Echte Arbeit anlegen: Mission → Ziel → Aufgabe → Dispatch (erzeugt echte Jobs).
    const mission = await request("POST", `${BASE}/api/missions`, {action: "create-mission", title: `Absturzprobe ${new Date().toISOString()}`, objective: "Prozessabsturz überleben"});
    const missionId = mission.json?.mission?.missionId ?? mission.json?.missionId;
    record("Mission angelegt", isOk(mission.status) && Boolean(missionId), `HTTP ${mission.status}, ${missionId ?? mission.text.slice(0, 120)}`);
    if (!missionId) throw new Error(`keine Mission erhalten: HTTP ${mission.status} ${mission.text.slice(0, 160)}`);

    const objective = await request("POST", `${BASE}/api/missions`, {action: "create-objective", missionId, title: "Absturzfestigkeit", description: "Lease-Wiederherstellung nach SIGKILL"});
    const objectiveId = objective.json?.objective?.objectiveId ?? objective.json?.objectiveId;
    record("Ziel angelegt", isOk(objective.status) && Boolean(objectiveId), `HTTP ${objective.status}, ${objectiveId ?? objective.text.slice(0, 120)}`);
    if (!objectiveId) throw new Error(`kein Ziel erhalten: HTTP ${objective.status} ${objective.text.slice(0, 160)}`);

    const task = await request("POST", `${BASE}/api/tasks`, {action: "create", missionId, objectiveId, title: "Absturzprobe-Aufgabe", risk: "LOW", assignedAgent: "AG-BUILD"});
    const taskId = task.json?.task?.taskId ?? task.json?.taskId;
    record("Aufgabe angelegt", isOk(task.status) && Boolean(taskId), `HTTP ${task.status}, ${taskId ?? task.text.slice(0, 120)}`);
    if (!taskId) throw new Error(`keine Aufgabe erhalten: HTTP ${task.status} ${task.text.slice(0, 160)}`);

    const dispatch = await request("POST", `${BASE}/api/dispatcher`, {action: "dispatch", taskId, agentId: "AG-BUILD"});
    const jobId = dispatch.json?.jobId ?? dispatch.json?.job?.jobId ?? null;

    // Wenn der Dispatch keinen Job erzeugt, ist die Probe nicht durchführbar
    // — das wird als solches gemeldet, nicht als „bestanden“.
    if (!jobId) {
      record("Job über den Dispatcher angelegt", false, `HTTP ${dispatch.status}: ${dispatch.text.slice(0, 200)}`);
      throw new Error("kein Job erhalten — Abbruch, damit der Bericht keine Lücke verschweigt");
    }
    record("Job über den Dispatcher angelegt", true, jobId);

    const lease = await request("POST", `${BASE}/api/queue`, {action: "lease", id: jobId});
    const leasedState = lease.json?.job?.state ?? null;
    record("Job geleast (Arbeit „in Arbeit“ vor dem Absturz)", isOk(lease.status) && leasedState === "LEASED", `HTTP ${lease.status}, Zustand ${leasedState}`);

    const queueBefore = await request("GET", `${BASE}/api/queue`);
    const jobsBefore = Array.isArray(queueBefore.json?.jobs) ? queueBefore.json.jobs : [];
    const idsBefore = jobsBefore.map(job => job.jobId);
    record("Doppelte Job-Identitäten vor dem Absturz ausgeschlossen", new Set(idsBefore).size === idsBefore.length, `${idsBefore.length} Jobs, ${new Set(idsBefore).size} eindeutig`);

    for (let cycle = 1; cycle <= CYCLES; cycle += 1) {
      say(`\nZyklus ${cycle}: SIGKILL auf Prozess ${service.pid}`);
      const pid = service.pid;
      hardKill(service);
      const down = await isDown(service);
      const crashChecks = [];
      crashChecks.push({name: `Zyklus ${cycle}: Prozess durch SIGKILL beendet`, ok: down, detail: `PID ${pid}, exit=${service.exitCode ?? service.signalCode ?? "?"}`});
      let reachableDuringCrash = false;
      try {
        const probe = await request("GET", `${BASE}/api/auth`);
        reachableDuringCrash = probe.status === 200;
      } catch {
        reachableDuringCrash = false;
      }
      crashChecks.push({name: `Zyklus ${cycle}: Dienst war während des Absturzes nicht erreichbar`, ok: !reachableDuringCrash, detail: reachableDuringCrash ? "Dienst antwortete noch — der Absturz war nicht echt" : "keine Antwort ohne Prozess"});

      service = startService();
      const restarted = await waitForService(`Neustart ${cycle}`);
      crashChecks.push({name: `Zyklus ${cycle}: Dienst nach dem Absturz wieder erreichbar`, ok: restarted, detail: `neue PID ${service.pid}`});

      if (restarted) {
        const auth2 = await request("GET", `${BASE}/api/auth`);
        crashChecks.push({name: `Zyklus ${cycle}: Sitzung hat den Absturz überlebt`, ok: auth2.status === 200 && auth2.json?.authenticated === true, detail: `HTTP ${auth2.status}, authenticated=${auth2.json?.authenticated}`});

        const queueAfter = await request("GET", `${BASE}/api/queue`);
        const jobsAfter = Array.isArray(queueAfter.json?.jobs) ? queueAfter.json.jobs : [];
        const idsAfter = jobsAfter.map(job => job.jobId);
        const duplicates = idsAfter.filter((id, index) => idsAfter.indexOf(id) !== index);
        crashChecks.push({name: `Zyklus ${cycle}: kein Datenverlust, keine Doppel-Jobs`, ok: idsAfter.length === idsBefore.length && duplicates.length === 0, detail: `${idsAfter.length} Jobs (vorher ${idsBefore.length}), ${duplicates.length} Duplikate`});

        const crashedJob = jobsAfter.find(job => job.jobId === jobId);
        const leaseLost = crashedJob && crashedJob.state === "LEASED" && crashedJob.leaseOwner;
        crashChecks.push({name: `Zyklus ${cycle}: Lease des abgestürzten Workers ist noch sichtbar`, ok: Boolean(leaseLost), detail: crashedJob ? `Zustand ${crashedJob.state}, Eigentümer ${crashedJob.leaseOwner ?? "-"}` : "Job fehlt"});

        // Lease wirklich ablaufen lassen: verwaiste Arbeit muss zurück in die
        // Queue kommen. Hier wird **gewartet**, bis die Lease abgelaufen ist —
        // eine Probe, die den Ablauf nur behauptet, belegt nichts.
        const waitedFrom = Date.now();
        let recovered = crashedJob ?? null;
        while (recovered && recovered.state === "LEASED" && Date.now() - waitedFrom < RECOVERY_TIMEOUT_MS) {
          await sleep(2_000);
          const expire = await request("POST", `${BASE}/api/queue`, {action: "expire"});
          const jobs = Array.isArray(expire.json?.jobs) ? expire.json.jobs : [];
          recovered = jobs.find(job => job.jobId === jobId) ?? recovered;
        }
        const waitedSeconds = Math.round((Date.now() - waitedFrom) / 1000);
        const recoveredState = recovered?.state ?? null;
        crashChecks.push({
          name: `Zyklus ${cycle}: verwaiste Lease läuft ab und der Job ist wieder einreihbar`,
          ok: recoveredState === "QUEUED",
          detail: `Zustand nach ${waitedSeconds} s Wartezeit: ${recoveredState ?? "-"}; Versuche: ${recovered?.attempt ?? "-"} von ${recovered?.maxAttempts ?? "-"}${recoveredState === "LEASED" ? ` (Lease bis ${recovered?.leasedUntil ?? "-"})` : ""}`
        });

        // Und die eigentliche Wiederherstellung: derselbe Job ist erneut
        // ausführbar — mit erhaltenem Versuchszähler und ohne zweiten Job.
        // Nach einem Lease-Ablauf gilt der Backoff des Jobs; er wird respektiert
        // und die Wartezeit im Nachweis ausgewiesen.
        const queuedJob = (await request("GET", `${BASE}/api/queue`)).json?.jobs?.find?.(job => job.jobId === jobId) ?? null;
        const dueAt = queuedJob?.nextAttemptAt ? new Date(queuedJob.nextAttemptAt).getTime() : 0;
        const backoffWaitMs = Math.max(0, Math.min(dueAt - Date.now(), RECOVERY_TIMEOUT_MS));
        if (backoffWaitMs > 0) await sleep(backoffWaitMs + 1_000);
        const releasable = await request("POST", `${BASE}/api/queue`, {action: "lease", id: jobId});
        const releasableJob = releasable.json?.job ?? null;
        const queueFinal = await request("GET", `${BASE}/api/queue`);
        const finalJobs = Array.isArray(queueFinal.json?.jobs) ? queueFinal.json.jobs : [];
        const sameIdCount = finalJobs.filter(job => job.jobId === jobId).length;
        crashChecks.push({
          name: `Zyklus ${cycle}: derselbe Job ist erneut ausführbar (kein Doppel-Job)`,
          ok:
            isOk(releasable.status) &&
            releasableJob?.state === "LEASED" &&
            releasableJob?.attempt === (recovered?.attempt ?? 1) + 1 &&
            sameIdCount === 1,
          detail: `HTTP ${releasable.status}, Zustand ${releasableJob?.state ?? "-"}, Versuch ${releasableJob?.attempt ?? "-"} (Backoff ${Math.round(backoffWaitMs / 1000)} s respektiert), Vorkommen der Job-ID: ${sameIdCount}`
        });

        const postAudit = await auditChainValid();
        crashChecks.push({name: `Zyklus ${cycle}: Audit-Kette nach dem Absturz unversehrt`, ok: postAudit.status === 200 && postAudit.valid && postAudit.length >= preAudit.length, detail: `HTTP ${postAudit.status}, ${postAudit.length} Einträge, gültig=${postAudit.valid}${postAudit.issues.length ? `, Probleme: ${postAudit.issues.slice(0, 2).join("; ")}` : ""}`});

        const integrity = await storeIntegrity();
        crashChecks.push({
          name: `Zyklus ${cycle}: alle Stores lesbar und digest-geprüft`,
          ok:
            integrity.status === 200 &&
            integrity.ok &&
            integrity.broken === 0 &&
            integrity.unregistered === 0 &&
            integrity.eventsOk !== false,
          detail: `HTTP ${integrity.status}, ${integrity.registered} registrierte Stores, defekt: ${integrity.broken ?? "?"}, unregistriert: ${integrity.unregistered ?? "?"}, Events ok=${integrity.eventsOk}`
        });
      }

      for (const check of crashChecks) record(check.name, check.ok, check.detail);
      cycles.push({cycle, pid, restartedPid: service.pid, checks: crashChecks});

      if (crashChecks.some(check => !check.ok)) break;
    }
  } finally {
    if (service.exitCode === null) hardKill(service);
    await sleep(300);
  }

  const passed = checks.filter(check => check.ok).length;
  const failed = checks.length - passed;
  const report = {
    ranAt: new Date().toISOString(),
    mode: "PROCESS_CRASH",
    service: "next start",
    base: BASE,
    storage: STORAGE,
    cycles: cycles.length,
    checks,
    passed,
    failed,
    outcome: failed === 0 ? "SURVIVED" : "FAILED",
    logs: KEEP_LOGS ? logs : [],
    node: process.version,
    host: os.hostname()
  };
  fs.mkdirSync(path.dirname(REPORT), {recursive: true});
  fs.writeFileSync(REPORT, JSON.stringify(report, null, 1), {mode: 0o600});
  const reportPath = REPORT.startsWith(ROOT) ? path.relative(ROOT, REPORT) : REPORT;
  say(`\nErgebnis: ${passed}/${checks.length} Prüfungen bestanden, ${cycles.length} Absturzzyklen — Bericht: ${reportPath}`);
  stopEverything();
  process.exit(failed === 0 ? 0 : 1);
}

main().catch(error => {
  bad(`Fehlerinjektion abgebrochen: ${error instanceof Error ? error.message : String(error)}`);
  const report = {
    ranAt: new Date().toISOString(),
    mode: "PROCESS_CRASH",
    base: BASE,
    storage: STORAGE,
    checks,
    passed: checks.filter(check => check.ok).length,
    failed: checks.filter(check => !check.ok).length + 1,
    outcome: "FAILED",
    error: error instanceof Error ? error.message : String(error)
  };
  try {
    fs.mkdirSync(path.dirname(REPORT), {recursive: true});
    fs.writeFileSync(REPORT, JSON.stringify(report, null, 1), {mode: 0o600});
  } catch {
    /* Bericht ist Zusatz — der Exit-Code bleibt maßgeblich */
  }
  process.exit(1);
});
