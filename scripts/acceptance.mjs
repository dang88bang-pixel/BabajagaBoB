#!/usr/bin/env node
/**
 * ============================================================================
 * Abnahme-Prüfer (Acceptance Contract Enforcer)
 * ============================================================================
 *
 *   node scripts/acceptance.mjs                  # statisch (Dateien, Tests, UI)
 *   node scripts/acceptance.mjs --live           # + HTTP-Nachweise gegen BASE
 *   node scripts/acceptance.mjs --write          # docs/ACCEPTANCE.md erzeugen
 *
 * Was dieses Skript durchsetzt: **Kein Status ohne Nachweis.**
 *
 *   1. Struktur der Matrix (`docs/acceptance/requirements.json`): eindeutige
 *      IDs, erlaubte Statuswerte, erlaubte Phasen, vollständige Querverweise.
 *   2. Existenz: jede genannte Implementierungsdatei, Testdatei und jedes
 *      Dokument muss existieren; jede genannte Oberflächensektion muss in
 *      `components/control-center.tsx` als Navigationseintrag vorkommen.
 *   3. Nachweisregel: `PASS` verlangt Implementierung **und** Test (mit
 *      Mindestanzahl Testfälle) **und** Nachweis; `PARTIAL`/`NOT_*`/`BLOCKED`
 *      verlangen eine Begründung.
 *   4. Vollständigkeit: alle 18 Stufen der Zielkette und alle 14 §44-Dokumente
 *      müssen in der Matrix vorkommen.
 *   5. `--live`: jeder geforderte Routen-Nachweis wird wirklich aufgerufen
 *      (Standard: HTTP 200; erwartete Alternativen stehen in der Matrix).
 *      Ohne Session wird ein 401/403/428 nur akzeptiert, wenn die Matrix das
 *      ausdrücklich erlaubt — sonst ist der Nachweis **nicht erbracht**.
 *
 * Exit-Code 0 nur ohne Verstoß. In CI läuft der statische Modus; ein
 * Statuswechsel ohne Nachweis lässt damit den Bau rot werden.
 */
import {existsSync, readFileSync, writeFileSync} from "node:fs";
import {join} from "node:path";

/**
 * Matrix-Pfad. Über `--matrix=<datei>` kann eine Kopie geprüft werden — das
 * nutzt die Negativprobe in `tests/unit/acceptance-matrix.test.ts`, um zu
 * belegen, dass der Prüfer eine Verletzung tatsächlich erkennt.
 */
const MATRIX = (process.argv.find(argument => argument.startsWith("--matrix=")) ?? "").slice("--matrix=".length) || "docs/acceptance/requirements.json";
const COMPONENT = "components/control-center.tsx";
const REPORT = "docs/ACCEPTANCE.md";
const BASE = process.env.BASE ?? "http://127.0.0.1:3000";
const COOKIE = process.env.BOB_SESSION_COOKIE ?? "";

const args = new Set(process.argv.slice(2));
const LIVE = args.has("--live");
const WRITE = args.has("--write");

let pass = 0;
let fail = 0;
const failures = [];
const ok = (name, detail) => { pass += 1; console.log(`  \u001b[32mPASS\u001b[0m ${name}${detail ? ` — ${detail}` : ""}`); };
const bad = (name, detail) => { fail += 1; failures.push({name, detail}); console.log(`  \u001b[31mFAIL\u001b[0m ${name}${detail ? ` — ${detail}` : ""}`); };
const step = title => console.log(`\n\u001b[1m${title}\u001b[0m`);

/* ---------------------------------------------------------------- Hilfen */

/** Anzahl Testfälle in einer Datei (`it(`/`test(` am Zeilenanfang). */
function countTests(file) {
  if (!existsSync(file)) return -1;
  const text = readFileSync(file, "utf8");
  return (text.match(/^\s*(it|test)\(/gm) ?? []).length;
}

/** Navigationseinträge der Oberfläche: `{id: "X", label: "Y"`. */
function uiSections() {
  const text = readFileSync(COMPONENT, "utf8");
  return new Set([...text.matchAll(/\{id:\s*"([A-Za-z]+)",\s*label:/g)].map(match => match[1]));
}

/** Route-Datei zu `/api/x/y` — `app/api/x/y/route.ts` (oder Index). */
function routeFile(path) {
  const clean = path.replace(/^\//, "").split("?")[0];
  const direct = join("app", clean, "route.ts");
  if (existsSync(direct)) return direct;
  return null;
}


/* --------------------------------------------------------------- Prüfungen */

const matrix = JSON.parse(readFileSync(MATRIX, "utf8"));
const requirements = matrix.requirements ?? [];
const chain = matrix.chain ?? [];
const requiredDocs = matrix.requiredDocs ?? [];
const allowedStatus = new Set(matrix.statusValues ?? []);
const sections = uiSections();

step(`0. Struktur der Matrix (${requirements.length} Anforderungen)`);
{
  const ids = requirements.map(entry => entry.id);
  const duplicates = ids.filter((id, index) => ids.indexOf(id) !== index);
  if (duplicates.length === 0) ok("Anforderungs-IDs sind eindeutig", `${ids.length} IDs`);
  else bad("Anforderungs-IDs sind eindeutig", duplicates.join(", "));

  const badStatus = requirements.filter(entry => !allowedStatus.has(entry.status)).map(entry => `${entry.id}:${entry.status}`);
  if (badStatus.length === 0) ok("Alle Statuswerte sind zulässig", [...allowedStatus].join(" / "));
  else bad("Alle Statuswerte sind zulässig", badStatus.join(", "));

  const badPhase = requirements.filter(entry => !/^P[0-5]$/.test(entry.phase)).map(entry => entry.id);
  if (badPhase.length === 0) ok("Alle Anforderungen sind einer Phase zugeordnet");
  else bad("Alle Anforderungen sind einer Phase zugeordnet", badPhase.join(", "));

  const unexplained = requirements.filter(entry => entry.status !== "PASS" && String(entry.note ?? "").trim().length < 20).map(entry => entry.id);
  if (unexplained.length === 0) ok("Nicht-PASS-Anforderungen sind begründet");
  else bad("Nicht-PASS-Anforderungen sind begründet", `ohne ausreichende Begründung: ${unexplained.join(", ")}`);
}

step("1. Existenz der genannten Nachweise");
{
  const missingImpl = [];
  for (const entry of requirements) {
    for (const file of entry.implementation ?? []) if (!existsSync(file)) missingImpl.push(`${entry.id}:${file}`);
    if ((entry.implementation ?? []).length === 0 && entry.status === "PASS") missingImpl.push(`${entry.id}:keine Implementierung`);
  }
  if (missingImpl.length === 0) ok("Alle Implementierungsdateien existieren");
  else bad("Alle Implementierungsdateien existieren", missingImpl.join(", "));

  const missingTests = [];
  const weakTests = [];
  for (const entry of requirements) {
    for (const test of entry.tests ?? []) {
      if (!existsSync(test.file)) { missingTests.push(`${entry.id}:${test.file}`); continue; }
      const found = countTests(test.file);
      if (found < (test.min ?? 1)) weakTests.push(`${entry.id}:${test.file} ${found}<${test.min}`);
    }
  }
  if (missingTests.length === 0) ok("Alle genannten Testdateien existieren");
  else bad("Alle genannten Testdateien existieren", missingTests.join(", "));
  if (weakTests.length === 0) ok("Jede genannte Testdatei enthält mindestens die zugesagte Testmenge");
  else bad("Jede genannte Testdatei enthält mindestens die zugesagte Testmenge", weakTests.join(", "));

  const missingDocs = [];
  for (const entry of requirements) for (const doc of entry.docs ?? []) if (!existsSync(doc)) missingDocs.push(`${entry.id}:${doc}`);
  for (const doc of requiredDocs) if (!existsSync(join("docs", doc))) missingDocs.push(`§44:${doc}`);
  if (missingDocs.length === 0) ok("Alle genannten Dokumente existieren", `inkl. ${requiredDocs.length} §44-Dokumente`);
  else bad("Alle genannten Dokumente existieren", missingDocs.join(", "));

  const unknownUi = [];
  for (const entry of requirements) for (const section of entry.ui ?? []) if (!sections.has(section)) unknownUi.push(`${entry.id}:${section}`);
  if (unknownUi.length === 0) ok("Alle genannten Oberflächensektionen existieren", `${sections.size} Abschnitte`);
  else bad("Alle genannten Oberflächensektionen existieren", unknownUi.join(", "));
}

step("2. Nachweisregel (kein DONE ohne Nachweis)");
{
  const unproven = [];
  for (const entry of requirements) {
    if (entry.status !== "PASS") continue;
    if ((entry.implementation ?? []).length === 0) unproven.push(`${entry.id}:Implementierung`);
    if ((entry.tests ?? []).length === 0) unproven.push(`${entry.id}:Test`);
    if ((entry.evidence ?? []).length === 0) unproven.push(`${entry.id}:Nachweis`);
  }
  if (unproven.length === 0) ok("Jede PASS-Anforderung hat Implementierung, Test und Nachweis");
  else bad("Jede PASS-Anforderung hat Implementierung, Test und Nachweis", unproven.join(", "));

  const covered = new Set(requiredDocs);
  const referenced = new Set(requirements.flatMap(entry => (entry.docs ?? []).map(doc => doc.replace(/^docs\//, ""))));
  const unreferenced = [...covered].filter(doc => !referenced.has(doc));
  if (unreferenced.length === 0) ok("Jedes §44-Dokument ist an mindestens eine Anforderung gebunden");
  else bad("Jedes §44-Dokument ist an mindestens eine Anforderung gebunden", unreferenced.join(", "));

  const chainRequirements = requirements.filter(entry => entry.area === "Zielkette");
  const coveredStages = new Set(chainRequirements.map(entry => String(entry.requirement).split(":")[0]));
  const missingStages = chain.filter(stage => !coveredStages.has(stage));
  if (missingStages.length === 0) ok(`Alle ${chain.length} Stufen der Zielkette sind abgedeckt`, chain.join(" → "));
  else bad(`Alle ${chain.length} Stufen der Zielkette sind abgedeckt`, missingStages.join(", "));

  const routeEvidence = requirements.flatMap(entry => (entry.evidence ?? []).filter(item => item.kind === "route").map(item => ({id: entry.id, ...item})));
  const brokenRoutes = routeEvidence.filter(item => routeFile(item.path) === null).map(item => `${item.id}:${item.path}`);
  if (brokenRoutes.length === 0) ok("Jeder Routen-Nachweis zeigt auf eine existierende Route", `${routeEvidence.length} Routen`);
  else bad("Jeder Routen-Nachweis zeigt auf eine existierende Route", brokenRoutes.join(", "));

  const scriptEvidence = requirements.flatMap(entry => (entry.evidence ?? []).filter(item => item.kind === "script").map(item => item.script));
  const missingScripts = [...new Set(scriptEvidence)].filter(script => !existsSync(script) && script !== "scripts/acceptance.mjs");
  if (missingScripts.length === 0) ok("Jeder Skript-Nachweis existiert", `${new Set(scriptEvidence).size} Skripte`);
  else bad("Jeder Skript-Nachweis existiert", missingScripts.join(", "));

  // Datei-Nachweise (z. B. CI-Workflow, Testdatei als Beleg) müssen existieren.
  const fileEvidence = requirements.flatMap(entry => (entry.evidence ?? []).filter(item => item.kind === "file").map(item => ({id: entry.id, path: item.path})));
  const missingFiles = fileEvidence.filter(item => !existsSync(item.path)).map(item => `${item.id}:${item.path}`);
  if (missingFiles.length === 0) ok("Jeder Datei-Nachweis existiert", `${fileEvidence.length} Dateien`);
  else bad("Jeder Datei-Nachweis existiert", missingFiles.join(", "));
}

/* ------------------------------------------------------------------ Live */

async function liveChecks() {
  step(`3. Live-Nachweise gegen ${BASE} (Matrix-Routen)`);
  const items = requirements.flatMap(entry => (entry.evidence ?? []).filter(item => item.kind === "route").map(item => ({id: entry.id, ...item})));
  let reachable = 0;
  for (const item of items) {
    const headers = {"content-type": "application/json"};
    if (COOKIE) headers.cookie = COOKIE;
    let status = 0;
    try {
      const response = await fetch(`${BASE}${item.path}`, {method: item.method ?? "GET", headers, redirect: "manual"});
      status = response.status;
    } catch (error) {
      bad(`${item.id} ${item.method ?? "GET"} ${item.path}`, `nicht erreichbar: ${error instanceof Error ? error.message : String(error)}`);
      continue;
    }
    const expected = item.expect ?? [200];
    if (expected.includes(status)) {
      reachable += 1;
      ok(`${item.id} ${item.method ?? "GET"} ${item.path}`, String(status));
    } else {
      bad(`${item.id} ${item.method ?? "GET"} ${item.path}`, `Status ${status}, erwartet ${expected.join("/")}`);
    }
  }
  ok(`${reachable}/${items.length} Routen-Nachweise live erbracht`, COOKIE ? "mit Session" : "ohne Session (nur ausdrücklich erlaubte Status)");
}

/* ----------------------------------------------------------------- Bericht */

function report() {
  const lines = [];
  const counts = {PASS: 0, PARTIAL: 0, FAIL: 0, NOT_IMPLEMENTED: 0, NOT_VERIFIED: 0, BLOCKED: 0};
  for (const entry of requirements) counts[entry.status] = (counts[entry.status] ?? 0) + 1;
  const phases = [...new Set(requirements.map(entry => entry.phase))].sort();
  const symbol = {PASS: "✅", PARTIAL: "🟡", FAIL: "❌", NOT_IMPLEMENTED: "⚪", NOT_VERIFIED: "🔵", BLOCKED: "⛔"};

  lines.push("# Abnahme-Matrix (generiert)");
  lines.push("");
  lines.push("> **Diese Datei wird erzeugt** — Quelle ist `docs/acceptance/requirements.json`.");
  lines.push("> Erzeugen: `node scripts/acceptance.mjs --write`. Prüfen: `node scripts/acceptance.mjs` (CI).");
  lines.push("");
  lines.push(`Eingefroren: ${matrix.frozenAt}. Quellen: ${matrix.sources.join("; ")}.`);
  lines.push("");
  lines.push(`**Regel:** ${matrix.rule}`);
  lines.push("");
  lines.push("## Übersicht");
  lines.push("");
  lines.push("| Status | Anzahl | Bedeutung |");
  lines.push("|---|---|---|");
  lines.push(`| ✅ PASS | ${counts.PASS} | Implementierung + Test + Nachweis vorhanden |`);
  lines.push(`| 🟡 PARTIAL | ${counts.PARTIAL} | Teilweise umgesetzt, Lücke benannt |`);
  lines.push(`| ❌ FAIL | ${counts.FAIL} | Umgesetzt, aber Nachweis fehlgeschlagen |`);
  lines.push(`| ⚪ NOT_IMPLEMENTED | ${counts.NOT_IMPLEMENTED} | Bewusst nicht gebaut (Begründung) |`);
  lines.push(`| 🔵 NOT_VERIFIED | ${counts.NOT_VERIFIED} | Vorhanden, aber Umgebung erlaubt keinen Nachweis |`);
  lines.push(`| ⛔ BLOCKED | ${counts.BLOCKED} | Durch äußere Abhängigkeit blockiert |`);
  lines.push("");
  lines.push("## Zielkette");
  lines.push("");
  lines.push("```");
  lines.push(chain.join(" → "));
  lines.push("```");
  lines.push("");
  for (const phase of phases) {
    const entries = requirements.filter(entry => entry.phase === phase);
    lines.push(`## ${phase} (${entries.filter(entry => entry.status === "PASS").length}/${entries.length} PASS)`);
    lines.push("");
    lines.push("| ID | Bereich | Anforderung | Implementierung | Test | Nachweis | UI | Status |");
    lines.push("|---|---|---|---|---|---|---|---|");
    for (const entry of entries) {
      const impl = (entry.implementation ?? []).map(file => `\`${file}\``).join("<br>") || "—";
      const tests = (entry.tests ?? []).map(test => `\`${test.file}\` (${test.min})`).join("<br>") || "—";
      const evidence = (entry.evidence ?? []).map(item => {
        if (item.kind === "route") return `\`${item.method ?? "GET"} ${item.path}\``;
        if (item.kind === "script") return `\`${item.script}\``;
        return `\`${item.path}\``;
      }).join("<br>") || "—";
      const ui = (entry.ui ?? []).join(", ") || "—";
      const note = entry.note ? `<br><small>${entry.note}</small>` : "";
      lines.push(`| ${entry.id} | ${entry.area} | ${entry.requirement}${note} | ${impl} | ${tests} | ${evidence} | ${ui} | ${symbol[entry.status] ?? entry.status} |`);
    }
    lines.push("");
  }
  lines.push("## Prüfer");
  lines.push("");
  lines.push("| Prüfung | Ergebnis |");
  lines.push("|---|---|");
  lines.push(`| Statische Matrix-Prüfung (\`node scripts/acceptance.mjs\`) | ${fail === 0 ? "**0 Verstöße**" : `**${fail} Verstöße**`} |`);
  lines.push(`| Live-Routennachweise (\`--live\`) | ${LIVE ? `${pass} Prüfungen ausgeführt` : "nicht ausgeführt (statischer Modus)"} |`);
  lines.push("");
  lines.push("Details: `docs/ABNAHMEPLAN.md`, `docs/TESTING.md`.");
  lines.push("");
  return lines.join("\n");
}

/* ------------------------------------------------------------------ Ablauf */

if (LIVE) await liveChecks();

step("Ergebnis");
console.log(`Ergebnis: \u001b[32m${pass} bestanden\u001b[0m, \u001b[31m${fail} fehlgeschlagen\u001b[0m`);
if (fail > 0) {
  console.log("\nVerstöße:");
  for (const entry of failures) console.log(`  - ${entry.name}${entry.detail ? `: ${entry.detail}` : ""}`);
}
if (WRITE) {
  writeFileSync(REPORT, report());
  console.log(`\nBericht geschrieben: ${REPORT}`);
}
// Die generierte Matrix muss auch ohne --write aktuell sein; in CI prüft das
// die Testsuite (`tests/unit/acceptance-matrix.test.ts`).
if (fail > 0) process.exit(1);
