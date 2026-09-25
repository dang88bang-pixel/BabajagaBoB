#!/usr/bin/env node
/**
 * Sabotageproben (Abschnitt 37 / TEST-004).
 *
 * Eine Suite, die nie rot wird, beweist nichts. Dieses Skript schwächt
 * Sicherheits- und Nachweisregeln im Quellcode **absichtlich** ab, führt die
 * zuständigen Tests aus und verlangt, dass sie **fehlschlagen**. Bleiben sie
 * grün, ist die Probe `MISSED` — und der Lauf endet mit Exit-Code 1.
 *
 *   node scripts/sabotage.mjs              # alle Proben
 *   node scripts/sabotage.mjs --check      # nur prüfen, ob alle Anker gültig sind (ändert nichts)
 *   node scripts/sabotage.mjs --probe=ID   # eine Probe
 *   node scripts/sabotage.mjs --list       # Katalog ausgeben
 *
 * Sicherheitsnetze (die Probe darf das Repository nicht beschädigen):
 *   1. Jede Datei wird vor der Mutation byteweise gesichert (Hash), nach dem
 *      Lauf wiederhergestellt und erneut gehasht.
 *   2. Bei Abbruch (SIGINT/SIGTERM/Ausnahme) läuft die Wiederherstellung im
 *      `finally`-Pfad trotzdem.
 *   3. Am Ende prüft das Skript **alle** Dateien des Katalogs gegen die
 *      Start-Hashes; jede Abweichung ist ein Abbruchgrund (Exit 2).
 *   4. Ein Anker, der nicht genau einmal vorkommt, ist `INVALID` und zählt als
 *      Fehlschlag — eine Probe, die nichts mutiert, wäre wertlos.
 *
 * Der Bericht landet in `${BOB_STORAGE_DIR:-.bob-data}/sabotage/report.json`,
 * damit die Oberfläche (Abschnitt „Fehlerinjektion“) denselben Stand zeigt.
 */
import {execFile} from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const CATALOG = path.join(ROOT, "docs", "acceptance", "sabotage-probes.json");
const STORAGE = process.env.BOB_STORAGE_DIR ?? path.join(ROOT, ".bob-data");
const REPORT_DIR = path.join(STORAGE, "sabotage");
const REPORT = path.join(REPORT_DIR, "report.json");
const TEST_TIMEOUT = Number(process.env.SABOTAGE_TIMEOUT_MS ?? 600_000);
fs.mkdirSync(REPORT_DIR, {recursive: true});

const args = new Set(process.argv.slice(2));
const CHECK_ONLY = args.has("--check");
const LIST_ONLY = args.has("--list");
const VERBOSE = args.has("--verbose") || args.has("-v");
const only = [...args].find(argument => argument.startsWith("--probe="))?.slice("--probe=".length);

const hash = value => crypto.createHash("sha256").update(value).digest("hex");
/** ANSI-Farbcodes (ESC = 0x1B) — als RegExp gebaut, damit kein Steuerzeichen im Quelltext steht. */
const ANSI = new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, "g");
const say = text => console.log(text);
const ok = text => console.log(`  \u001b[32mPASS\u001b[0m ${text}`);
const bad = text => console.log(`  \u001b[31mFAIL\u001b[0m ${text}`);

function loadProbes() {
  if (!fs.existsSync(CATALOG)) {
    console.error(`Sabotage-Katalog fehlt: ${CATALOG}`);
    process.exit(2);
  }
  const parsed = JSON.parse(fs.readFileSync(CATALOG, "utf8"));
  if (!Array.isArray(parsed.probes) || parsed.probes.length === 0) {
    console.error("Sabotage-Katalog enthält keine Proben");
    process.exit(2);
  }
  return parsed.probes;
}

/**
 * Änderungen einer Probe. Eine Probe kann **mehrere** Stellen ändern: greift
 * eine Regel auf zwei redundanten Ebenen (z. B. Gate + Broker), muss die Probe
 * die wirksame Schutzwirkung entfernen — sonst belegt sie nichts.
 */
function editsOf(probe) {
  const edits = probe.edits ?? [{file: probe.file, find: probe.find, replace: probe.replace}];
  return edits.map(edit => {
    if (!edit.file || typeof edit.find !== "string" || typeof edit.replace !== "string") {
      throw new Error(`Probe ${probe.id}: unvollständige Änderung (file, find, replace erforderlich)`);
    }
    return edit;
  });
}

/** Prüft, ob eine Probe überhaupt anwendbar ist (jeder Anchor genau einmal vorhanden). */
function inspect(probe) {
  const edits = editsOf(probe);
  const sources = new Map();
  for (const edit of edits) {
    const file = path.join(ROOT, edit.file);
    if (!fs.existsSync(file)) return {valid: false, reason: `Datei fehlt: ${edit.file}`};
    const source = sources.get(edit.file) ?? fs.readFileSync(file, "utf8");
    const occurrences = source.split(edit.find).length - 1;
    if (occurrences !== 1) return {valid: false, reason: `Anchor in ${edit.file} kommt ${occurrences}× vor (erwartet: 1)`, occurrences};
    sources.set(edit.file, source.replace(edit.find, edit.replace));
  }
  const missing = (probe.tests ?? []).filter(test => !fs.existsSync(path.join(ROOT, test)));
  if (missing.length > 0) return {valid: false, reason: `Testdatei fehlt: ${missing.join(", ")}`};
  if (!probe.guard || probe.guard.trim().length < 10) return {valid: false, reason: "keine Schutzaussage (guard) angegeben"};
  return {valid: true, sources, edits, files: [...sources.keys()]};
}

/** Schreibt alle Änderungen einer Probe und gibt die Originalinhalte zurück. */
function applyEdits(state) {
  const originals = new Map();
  // Wichtig: Die Sicherung **vor** der ersten Änderung nehmen. Mehrere
  // Änderungen an derselben Datei dürfen das Original nicht überschreiben.
  for (const file of state.files) originals.set(file, fs.readFileSync(path.join(ROOT, file)));
  for (const file of state.files) fs.writeFileSync(path.join(ROOT, file), state.sources.get(file));
  return originals;
}

function restoreEdits(originals) {
  let failed = [];
  for (const [file, content] of originals) {
    const target = path.join(ROOT, file);
    const current = fs.existsSync(target) ? fs.readFileSync(target) : null;
    if (!current || hash(current) !== hash(content)) {
      fs.writeFileSync(target, content);
      const check = fs.readFileSync(target);
      if (hash(check) !== hash(content)) failed.push(file);
    }
  }
  return failed;
}

function runTests(testFiles) {
  return new Promise(resolve => {
    const started = Date.now();
    execFile(
      process.execPath,
      [path.join(ROOT, "node_modules", "vitest", "vitest.mjs"), "run", "--reporter=basic", ...testFiles],
      {cwd: ROOT, timeout: TEST_TIMEOUT, maxBuffer: 32 * 1024 * 1024, env: {...process.env, CI: "true"}},
      (error, stdout, stderr) => {
        // Farbcodes entfernen — sonst zerbricht die Auswertung der Zusammenfassung.
        const output = `${stdout ?? ""}\n${stderr ?? ""}`.replace(ANSI, "");
        const summary = /Tests\s+(\d+) failed/.exec(output)?.[1] ?? /Failed Tests (\d+)/.exec(output)?.[1] ?? null;
        const failedTests = summary === null ? 0 : Number(summary);
        resolve({
          exitCode: typeof error?.code === "number" ? error.code : error ? 1 : 0,
          failedTests,
          durationMs: Date.now() - started,
          /** true, wenn vitest gar nicht bis zur Auswertung kam (z. B. Sammelfehler). */
          infrastructureError: error !== null && summary === null,
          output
        });
      }
    );
  });
}

const probes = loadProbes();
if (LIST_ONLY) {
  say(`Sabotagekatalog: ${probes.length} Proben`);
  for (const probe of probes) say(`  ${probe.id.padEnd(28)} ${probe.title} → ${probe.file} (${(probe.tests ?? []).join(", ")})`);
  process.exit(0);
}

const selected = only ? probes.filter(probe => probe.id === only) : probes;
if (only && selected.length === 0) {
  console.error(`Unbekannte Probe: ${only}`);
  process.exit(2);
}

// Startzustand aller beteiligten Dateien festhalten.
const originals = new Map();
for (const probe of probes) {
  for (const edit of editsOf(probe)) {
    const file = path.join(ROOT, edit.file);
    if (fs.existsSync(file) && !originals.has(edit.file)) {
      const content = fs.readFileSync(file);
      originals.set(edit.file, {content, digest: hash(content)});
    }
  }
}

function restoreAll() {
  const restored = [];
  for (const [file, original] of originals) {
    const target = path.join(ROOT, file);
    const current = fs.existsSync(target) ? fs.readFileSync(target) : null;
    if (!current || hash(current) !== original.digest) {
      fs.writeFileSync(target, original.content);
      restored.push(file);
    }
  }
  return restored;
}

let interrupted = false;
for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => {
    interrupted = true;
    restoreAll();
    console.error(`\nSabotage: ${signal} empfangen — Quellcode wiederhergestellt, Abbruch.`);
    process.exit(2);
  });
}

say(`Sabotageproben — ${selected.length} Probe(n), Katalog ${path.relative(ROOT, CATALOG)}`);
const results = [];
/** Dateien, die ein Lauf verändert zurückließ (Warnung, kein bestandener Lauf). */
const integrityWarnings = [];

try {
  for (const probe of selected) {
    const state = inspect(probe);
    if (!state.valid) {
      bad(`${probe.id}: ungültig — ${state.reason}`);
      results.push({id: probe.id, title: probe.title, outcome: "INVALID", detail: state.reason, tests: probe.tests ?? [], files: probe.edits?.map(edit => edit.file) ?? [probe.file]});
      continue;
    }
    if (CHECK_ONLY) {
      ok(`${probe.id}: Anker gültig — ${probe.guard}`);
      results.push({id: probe.id, title: probe.title, outcome: "VALID", detail: probe.guard, tests: probe.tests ?? [], files: state.files});
      continue;
    }

    const applied = applyEdits(state);
    let run;
    try {
      run = await runTests(probe.tests);
    } finally {
      const failedRestore = restoreEdits(applied);
      if (failedRestore.length > 0) {
        console.error(`Sabotage: Wiederherstellung fehlgeschlagen: ${failedRestore.join(", ")} — Abbruch.`);
        restoreAll();
        process.exit(2);
      }
    }

    const caught = run.exitCode !== 0 && run.failedTests > 0;
    const outcome = caught ? "CAUGHT" : "MISSED";
    if (run.infrastructureError) {
      console.error(`Sabotage: Testlauf für ${probe.id} brach ohne Auswertung ab — Lauf gilt als ungültig.`);
      if (VERBOSE) say(run.output.split("\n").slice(-40).join("\n"));
      fs.writeFileSync(REPORT, JSON.stringify({ranAt: new Date().toISOString(), mode: "INVALID", results}, null, 1));
      process.exit(2);
    }
    if (caught) ok(`${probe.id}: erkannt (${run.failedTests} Testfehler in ${Math.round(run.durationMs / 1000)} s) — ${probe.guard}`);
    else {
      bad(`${probe.id}: NICHT erkannt — die Suiten bleiben bei geschwächter Regel grün (${probe.tests.join(", ")})`);
      if (VERBOSE) say(run.output.split("\n").slice(-40).join("\n"));
    }
    results.push({
      id: probe.id,
      title: probe.title,
      guard: probe.guard,
      files: state.files,
      edits: state.edits.length,
      tests: probe.tests ?? [],
      outcome,
      failedTests: run.failedTests,
      durationMs: run.durationMs
    });
  }
} finally {
  const leftover = restoreAll();
  if (leftover.length > 0) {
    bad(`Sabotage: ${leftover.length} Datei(en) waren nach dem Lauf verändert — wiederhergestellt: ${leftover.join(", ")}`);
    integrityWarnings.push(...leftover);
  }
}

// Abschlussprüfung: jede Datei muss wieder ihren Start-Hash haben.
const damaged = [];
for (const [file, original] of originals) {
  const target = path.join(ROOT, file);
  const current = fs.existsSync(target) ? fs.readFileSync(target) : null;
  if (!current || hash(current) !== original.digest) damaged.push(file);
}
if (damaged.length > 0) {
  bad(`Quellcode nicht im Ausgangszustand: ${damaged.join(", ")}`);
  for (const file of damaged) fs.writeFileSync(path.join(ROOT, file), originals.get(file).content);
  console.error("Sabotage: Zustand wiederhergestellt — Lauf gilt als ungültig (Exit 2).");
  process.exit(2);
}
ok(`Alle ${originals.size} Dateien sind unverändert (sha256 geprüft).`);

const caught = results.filter(entry => entry.outcome === "CAUGHT").length;
const missed = results.filter(entry => entry.outcome === "MISSED").length;
const invalid = results.filter(entry => entry.outcome === "INVALID").length;
const report = {
  ranAt: new Date().toISOString(),
  mode: CHECK_ONLY ? "CHECK" : "SABOTAGE",
  total: results.length,
  caught,
  missed,
  invalid,
  results,
  restored: true,
  integrityWarnings
};
fs.writeFileSync(REPORT, JSON.stringify(report, null, 1), {mode: 0o600});

if (CHECK_ONLY) {
  say(`\nErgebnis: ${results.filter(entry => entry.outcome === "VALID").length}/${results.length} Anker gültig, ${invalid} ungültig.`);
  process.exit(invalid === 0 ? 0 : 1);
}

say(`\nErgebnis: ${caught} erkannt, ${missed} nicht erkannt, ${invalid} ungültig — Bericht: ${path.relative(ROOT, REPORT)}`);
if (integrityWarnings.length > 0) bad(`Zurückgebliebene Änderungen: ${integrityWarnings.join(", ")}`);
// Exit 0 = alle Proben erkannt, 1 = mindestens eine Probe nicht erkannt,
// 2 = Lauf ungültig (ungültiger Anker, Abbruch oder zurückgebliebene Änderung).
const integrityBroken = integrityWarnings.length > 0 || invalid > 0 || interrupted;
process.exit(missed === 0 && !integrityBroken ? 0 : integrityBroken ? 2 : 1);
