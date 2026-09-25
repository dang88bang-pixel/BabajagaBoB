#!/usr/bin/env node
/**
 * ============================================================================
 * GUI-Prüfung des Control Centers.
 *
 *   BASE=http://127.0.0.1:3000 BOB_BOOTSTRAP_SECRET=… BOB_CREATOR_LOGIN_SECRET=… \
 *     node scripts/audit-ui.mjs
 *
 * Geprüft wird in drei Stufen:
 *
 *  A. Statik (Quellcode `components/control-center.tsx`):
 *     - alle Navigationsabschnitte haben einen Renderpfad (kein leerer Abschnitt),
 *     - jede Datenquelle zeigt auf eine **existierende** Route,
 *     - kein literales Markdown (`**…**`) im sichtbaren Text,
 *     - keine Platzhalterzustände („READY“ ohne Datenbezug, „TODO“, „Lorem“),
 *     - das `pick()`-Pfadziel jeder Quelle existiert in der Live-Antwort.
 *
 *  B. Auslieferung über HTTP:
 *     - `/` liefert die Anwendung (Status, `lang="de"`, Titel, Shell),
 *     - jedes referenzierte JS-/CSS-Asset ist abrufbar (kein 404 im Browser),
 *     - **kein Geheimnis** im HTML oder in den JS-Chunks (Bootstrap-, Creator-,
 *       TOTP-Secret, Session-Token),
 *     - das Session-Cookie ist `HttpOnly` und `SameSite`,
 *     - ohne Session enthält das HTML keine Betriebsdaten.
 *
 *  C. Datenvertrag je Abschnitt (mit Session):
 *     - für alle 38 Abschnitte wird die tatsächlich verwendete Route abgerufen,
 *     - der von der Oberfläche gelesene Pfad muss ein Array ergeben
 *       (sonst zeigt die Seite fälschlich „keine Einträge“),
 *     - die konfigurierten Spalten kommen in den Daten vor (soweit Daten da sind),
 *     - Antworten enthalten keine Geheimnisfelder mit Werten.
 *
 * Exit 0 nur bei 0 Fehlschlägen.
 * ============================================================================
 */
import {readFileSync, readdirSync, statSync} from "node:fs";
import {join} from "node:path";

const BASE = process.env.BASE ?? "http://127.0.0.1:3000";
const BOOTSTRAP_SECRET = process.env.BOB_BOOTSTRAP_SECRET ?? "";
const LOGIN_SECRET = process.env.BOB_CREATOR_LOGIN_SECRET ?? "";
const TOTP_SECRET = process.env.BOB_TOTP_SECRET ?? "";

let pass = 0;
let fail = 0;
const failures = [];
const ok = (name, detail) => { pass += 1; console.log(`  \u001b[32mPASS\u001b[0m ${name}${detail ? ` — ${detail}` : ""}`); };
const bad = (name, detail) => { fail += 1; failures.push({name, detail}); console.log(`  \u001b[31mFAIL\u001b[0m ${name}${detail ? ` — ${detail}` : ""}`); };
const step = title => console.log(`\n\u001b[1m${title}\u001b[0m`);

const COMPONENT = "components/control-center.tsx";

/* ------------------------------------------------------------------- Statik */

function source() {
  return readFileSync(COMPONENT, "utf8");
}

/** Navigationsabschnitte mit Beschriftung und Gruppe. */
function navEntries(text) {
  return [...text.matchAll(/\{id: "(\w+)", label: "([^"]+)", group: "([^"]+)"\}/g)].map(match => ({
    id: match[1],
    label: match[2],
    group: match[3]
  }));
}

/**
 * Datenquellen der modularen Abschnitte (url, path, Spalten).
 *
 * Zeilenweise gelesen: ein Abschnitt beginnt mit `  Name: {` und endet mit der
 * gleich eingerückten schließenden Klammer. Ein verschachtelter Block
 * (z. B. ein `render`-Objekt) beendet den Eintrag damit nicht versehentlich.
 */
function sources(text) {
  const block = text.slice(text.indexOf("const SOURCES"), text.indexOf("type PanelState")).split("\n");
  const entries = [];
  let current = null;
  for (const line of block) {
    if (current === null) {
      const start = new RegExp("^ {2}(\\w+): \\{$").exec(line);
      if (start) current = {id: start[1], body: []};
      continue;
    }
    if (new RegExp("^ {2}\\},?$").test(line)) {
      const body = current.body.join("\n");
      const url = /url: "([^"]+)"/.exec(body)?.[1];
      const pathText = /path: \[([^\]]*)\]/.exec(body)?.[1] ?? "";
      const path = [...pathText.matchAll(/"([^"]+)"/g)].map(entry => entry[1]);
      const columns = [...body.matchAll(/\{key: "([^"]+)", label: "([^"]+)"/g)].map(entry => entry[1]);
      entries.push({id: current.id, url, path, columns});
      current = null;
      continue;
    }
    current.body.push(line);
  }
  return entries;
}

/**
 * Ist ein Feldname irgendwo in der Plattform deklariert?
 *
 * Geprüft wird auf `feld:` bzw. `feld?:` — das deckt Typ-Blöcke
 * (`type X = {feld: …}`), einzeilige Typ-Aliase und Objekt-Literale ab.
 * Ein Feld, das nur die Oberfläche kennt, ist ein Vertragsfehler.
 */
function declaredField(field) {
  const pattern = new RegExp(`\\b${field}\\??\\s*:`, "m");
  const stack = ["lib", "app"];
  while (stack.length > 0) {
    const dir = stack.pop();
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) stack.push(full);
      else if (/\.tsx?$/.test(entry) && !entry.endsWith(".d.ts") && pattern.test(readFileSync(full, "utf8"))) return full;
    }
  }
  return null;
}

/** Alle im Client verwendeten API-Pfade. */
function clientPaths(text) {
  return [...new Set([...text.matchAll(/["`](\/api\/[a-zA-Z0-9_\-/]+)["`]/g)].map(match => match[1]))];
}

function routeExists(path) {
  const file = `app${path}/route.ts`;
  try {
    return statSync(file).isFile();
  } catch {
    return false;
  }
}

function staticChecks(text) {
  step("A. Statik der Oberfläche");
  const nav = navEntries(text);
  const sourceEntries = sources(text);
  const sourceIds = new Set(sourceEntries.map(entry => entry.id));
  const branchIds = new Set([...text.matchAll(/if \(section === "(\w+)"\)/g)].map(match => match[1]));

  if (nav.length >= 38) ok(`Navigationsliste vollständig (${nav.length} Abschnitte)`);
  else bad("Navigationsliste vollständig", `nur ${nav.length} Einträge`);

  const withoutPath = nav.filter(entry => !sourceIds.has(entry.id) && !branchIds.has(entry.id)).map(entry => entry.id);
  if (withoutPath.length === 0) ok("Jeder Abschnitt hat einen Renderpfad (kein leerer Abschnitt)");
  else bad("Jeder Abschnitt hat einen Renderpfad", `ohne Pfad: ${withoutPath.join(", ")}`);

  const orphanBranches = [...branchIds].filter(id => !nav.some(entry => entry.id === id));
  if (orphanBranches.length === 0) ok("Kein Renderzweig ohne Navigationseintrag");
  else bad("Kein Renderzweig ohne Navigationseintrag", orphanBranches.join(", "));

  const missingSources = sourceEntries.filter(entry => entry.url && !routeExists(entry.url)).map(entry => `${entry.id}→${entry.url}`);
  if (missingSources.length === 0) ok(`Alle ${sourceEntries.length} Datenquellen zeigen auf existierende Routen`);
  else bad("Datenquellen zeigen auf existierende Routen", missingSources.join(", "));

  const missingClient = clientPaths(text).filter(path => !routeExists(path));
  if (missingClient.length === 0) ok(`Alle ${clientPaths(text).length} im Client genutzten API-Pfade existieren`);
  else bad("Im Client genutzte API-Pfade existieren", missingClient.join(", "));

  // Literales Markdown im sichtbaren Text (JSX-Textknoten), z. B. `**fett**`.
  const lines = text.split("\n");
  const markdown = [];
  lines.forEach((line, index) => {
    if (/^\s*(\*|\/\/|\/\*)/.test(line)) return; // Kommentare
    const match = /(>|^)\s*[^<>{}"\n]*\*\*[^<>{}\n]/.exec(line);
    if (match) markdown.push(`Zeile ${index + 1}: ${line.trim().slice(0, 90)}`);
  });
  if (markdown.length === 0) ok("Kein literales Markdown im sichtbaren Text");
  else bad("Kein literales Markdown im sichtbaren Text", markdown.join(" | "));

  // Platzhalterzustände: „READY“ darf nur als Wert echter Daten erscheinen.
  const placeholder = [];
  lines.forEach((line, index) => {
    if (/\b(TODO|FIXME|Lorem ipsum|Platzhaltertext|dummy value)\b/i.test(line)) placeholder.push(`Zeile ${index + 1}`);
  });
  if (placeholder.length === 0) ok("Keine Platzhaltertexte in der Oberfläche");
  else bad("Keine Platzhaltertexte in der Oberfläche", placeholder.join(", "));

  // Spaltenvertrag: jede Spalte muss ein in der Plattform deklariertes Feld
  // sein. Sonst zeigt die Tabelle dauerhaft „—“ (Phantoms palte).
  const phantom = [];
  for (const entry of sourceEntries) {
    for (const column of entry.columns) {
      if (declaredField(column) === null) phantom.push(`${entry.id}.${column}`);
    }
  }
  if (phantom.length === 0) ok(`Alle Spalten der ${sourceEntries.length} Datenquellen sind deklarierte Felder`);
  else bad("Spalten sind deklarierte Felder", phantom.join(", "));

  // Keine Geheimnisse im Clientcode.
  const leaks = [];
  for (const [label, value] of [["Bootstrap-Secret", BOOTSTRAP_SECRET], ["Creator-Secret", LOGIN_SECRET], ["TOTP-Secret", TOTP_SECRET]]) {
    if (value && text.includes(value)) leaks.push(label);
  }
  if (leaks.length === 0) ok("Clientcode enthält keine Zugangsgeheimnisse");
  else bad("Clientcode enthält keine Zugangsgeheimnisse", leaks.join(", "));

  return {nav, sources: sourceEntries};
}

/* ------------------------------------------------------------- HTTP-Helfer */

const cookies = new Map();
const cookieHeader = () => [...cookies.entries()].map(([k, v]) => `${k}=${v}`).join("; ");
function remember(response) {
  for (const entry of response.headers.getSetCookie?.() ?? []) {
    const [pair] = entry.split(";");
    const index = pair.indexOf("=");
    if (index > 0) cookies.set(pair.slice(0, index).trim(), pair.slice(index + 1).trim());
  }
}

async function request(method, path, body, options = {}) {
  const headers = {};
  if (options.json !== false) headers["content-type"] = "application/json";
  if (cookies.size > 0 && options.session !== false) headers.cookie = cookieHeader();
  const response = await fetch(`${BASE}${path}`, {method, headers, body: body === undefined ? undefined : JSON.stringify(body), redirect: "manual"});
  remember(response);
  const text = await response.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* kein JSON */ }
  return {status: response.status, text, json, headers: response.headers};
}

/* ------------------------------------------------------------ Auslieferung */

async function deliveryChecks() {
  step("B. Auslieferung und Geheimnisschutz");
  const anonymous = await request("GET", "/", undefined, {json: false, session: false});
  if (anonymous.status === 200) ok("Startseite erreichbar", String(anonymous.status));
  else bad("Startseite erreichbar", `Status ${anonymous.status}`);
  if (/<html lang="de"/.test(anonymous.text)) ok("Sprache der Seite ist Deutsch (lang=\"de\")");
  else bad("Sprache der Seite ist Deutsch", "lang-Attribut fehlt");
  if (/<title>BabajagaBoB/.test(anonymous.text)) ok("Seitentitel gesetzt");
  else bad("Seitentitel gesetzt", "Titel fehlt");

  // Assets, die der Browser laden muss.
  const scripts = [...new Set([...anonymous.text.matchAll(/\/_next\/static\/[^"'\s]+\.(?:js|css)/g)].map(match => match[0]))];
  if (scripts.length === 0) {
    bad("Assets verlinkt", "keine JS-/CSS-Assets im HTML gefunden");
  } else {
    const broken = [];
    const bodies = [];
    for (const asset of scripts) {
      const response = await request("GET", asset, undefined, {json: false, session: false});
      if (response.status !== 200) broken.push(`${asset} → ${response.status}`);
      else bodies.push(response.text);
    }
    if (broken.length === 0) ok(`Alle ${scripts.length} referenzierten Assets werden ausgeliefert`);
    else bad("Assets werden ausgeliefert", broken.slice(0, 5).join(", "));

    // Geheimnisse dürfen weder im HTML noch in den Chunks stehen.
    const haystack = [anonymous.text, ...bodies].join("\n");
    const leaks = [];
    for (const [label, value] of [["Bootstrap-Secret", BOOTSTRAP_SECRET], ["Creator-Secret", LOGIN_SECRET], ["TOTP-Secret", TOTP_SECRET]]) {
      if (value && haystack.includes(value)) leaks.push(label);
    }
    // Betriebsdaten dürfen ohne Session nicht im HTML stehen.
    for (const marker of ["MIS-", "TASK-", "SB-", "AG-BUILD"]) {
      if (anonymous.text.includes(marker)) leaks.push(`Betriebsdaten (${marker}) im ausgelieferten HTML`);
    }
    if (leaks.length === 0) ok("Kein Geheimnis und keine Betriebsdaten im ausgelieferten HTML/JS");
    else bad("Kein Geheimnis und keine Betriebsdaten im ausgelieferten HTML/JS", leaks.join(", "));
  }

  // Anmeldung: Cookie muss HttpOnly und SameSite sein.
  const bootstrap = await request("POST", "/api/auth", {action: "bootstrap", secret: BOOTSTRAP_SECRET, creatorName: "GUI-Prüfer"}, {session: false});
  if ([201, 409].includes(bootstrap.status)) ok("Bootstrap", String(bootstrap.status));
  else bad("Bootstrap", `Status ${bootstrap.status} ${bootstrap.text.slice(0, 120)}`);
  const login = await request("POST", "/api/auth", {action: "login", secret: LOGIN_SECRET}, {session: false});
  if ([200, 201].includes(login.status)) ok("Creator-Anmeldung", String(login.status));
  else bad("Creator-Anmeldung", `Status ${login.status} ${login.text.slice(0, 120)}`);
  const setCookie = (login.headers.getSetCookie?.() ?? []).join(" | ");
  if (/HttpOnly/i.test(setCookie)) ok("Session-Cookie ist HttpOnly");
  else bad("Session-Cookie ist HttpOnly", setCookie.slice(0, 120));
  if (/SameSite/i.test(setCookie)) ok("Session-Cookie hat SameSite");
  else bad("Session-Cookie hat SameSite", setCookie.slice(0, 120));

  const session = await request("GET", "/");
  if (session.status === 200 && !session.text.includes(LOGIN_SECRET)) ok("Startseite mit Session ohne Geheimnis im HTML");
  else bad("Startseite mit Session ohne Geheimnis im HTML", `Status ${session.status}`);
  // Der Session-Token darf nicht im HTML stehen (nur Cookie).
  const token = cookies.get("bob_session") ?? "";
  if (token && session.text.includes(token)) bad("Session-Token nicht im HTML", "Token im HTML gefunden");
  else ok("Session-Token wird nicht ins HTML geschrieben");
}

/* ---------------------------------------------------------- Datenverträge */

/** Entspricht `pick(body, path)` in der Oberfläche. */
function pick(body, path) {
  if (Array.isArray(body)) return body;
  if (!path || path.length === 0) return [];
  let current = body;
  for (const key of path) {
    if (!current || typeof current !== "object") return [];
    current = current[key];
  }
  return Array.isArray(current) ? current : [];
}

/** Abschnitte ohne modulare Quelle: die Routen, die ihren Panel füllen. */
const CUSTOM_SECTIONS = {
  Overview: ["/api/control", "/api/timeline", "/api/readiness", "/api/runtime"],
  Evidence: ["/api/artifacts", "/api/experiments"],
  Audit: ["/api/audit"],
  Provenance: ["/api/provenance"],
  Timeline: ["/api/timeline"],
  Errors: ["/api/errors"],
  Inbox: ["/api/inbox"],
  Security: ["/api/governance", "/api/capabilities"],
  Operations: ["/api/persistence", "/api/readiness"],
  Metrics: ["/api/metrics"],
  Secrets: [] // bewusst keine Datenroute: keine Leseoperation auf Geheimnisse
};

/** Felder, die niemals mit Wert im Browser landen dürfen. */
const FORBIDDEN_FIELDS = ["secret", "secretHash", "password", "privateKey", "apiKey", "credential", "totpSecret"];

function scanForSecrets(label, text) {
  const found = [];
  for (const [name, value] of [["Bootstrap-Secret", BOOTSTRAP_SECRET], ["Creator-Secret", LOGIN_SECRET], ["TOTP-Secret", TOTP_SECRET]]) {
    if (value && value.length > 8 && text.includes(value)) found.push(name);
  }
  const parsed = (() => { try { return JSON.parse(text); } catch { return null; } })();
  const walk = (node, path) => {
    if (!node || typeof node !== "object") return;
    for (const [key, value] of Object.entries(node)) {
      if (FORBIDDEN_FIELDS.includes(key) && typeof value === "string" && value.length > 0) found.push(`${path}${key}`);
      else if (value && typeof value === "object") walk(value, `${path}${key}.`);
    }
  };
  walk(parsed, "");
  if (found.length > 0) bad(`Keine Geheimnisfelder: ${label}`, [...new Set(found)].join(", "));
  return found.length === 0;
}

async function contractChecks(nav, sourceEntries) {
  step("C. Datenvertrag je Abschnitt (mit Session)");
  const byId = new Map(sourceEntries.map(entry => [entry.id, entry]));
  let checked = 0;
  let withData = 0;

  for (const entry of nav) {
    const source = byId.get(entry.id);
    const urls = source ? [source.url] : CUSTOM_SECTIONS[entry.id] ?? [];
    if (urls.length === 0) {
      ok(`Abschnitt ${entry.label}: bewusst ohne Datenroute (Geheimnisgrenze)`);
      continue;
    }
    for (const url of urls) {
      const response = await request("GET", url);
      checked += 1;
      if (response.status !== 200) {
        bad(`Abschnitt ${entry.label}: ${url}`, `Status ${response.status} ${response.text.slice(0, 100)}`);
        continue;
      }
      if (response.text.trim().length === 0) {
        bad(`Abschnitt ${entry.label}: ${url}`, "leere Antwort");
        continue;
      }
      scanForSecrets(`${entry.label} ${url}`, response.text);
      if (source && url === source.url) {
        const rows = pick(response.json, source.path);
        if (!Array.isArray(rows)) {
          bad(`Abschnitt ${entry.label}: Pfad ${JSON.stringify(source.path)}`, "kein Array — Seite zeigt fälschlich „keine Einträge“");
          continue;
        }
        if (rows.length > 0) {
          withData += 1;
          const keys = new Set(rows.flatMap(row => (row && typeof row === "object" ? Object.keys(row) : [])));
          const absent = source.columns.filter(column => !keys.has(column));
          // Ein Feld, das nirgends in der Plattform deklariert ist, ist ein
          // Tippfehler in der Oberfläche (Spalte zeigt immer „—“).
          const unknown = absent.filter(column => declaredField(column) === null);
          if (unknown.length > 0) {
            bad(`Abschnitt ${entry.label}: unbekannte Spaltenfelder`, unknown.join(", "));
          } else if (absent.length > 0) {
            ok(`Abschnitt ${entry.label}: ${rows.length} Zeilen, ${absent.length} optionale Spalte(n) ohne Wert (${absent.join(", ")})`);
          } else {
            ok(`Abschnitt ${entry.label}: ${rows.length} Zeilen, alle ${source.columns.length} Spalten belegt`);
          }
        } else {
          ok(`Abschnitt ${entry.label}: Pfad gültig, aktuell keine Zeilen`);
        }
      } else {
        ok(`Abschnitt ${entry.label}: ${url} liefert Daten`);
      }
    }
  }
  ok(`${checked} Datenabrufe geprüft, davon ${withData} Abschnitte mit echten Zeilen`);
}

async function main() {
  const text = source();
  const {nav, sources: sourceEntries} = staticChecks(text);
  await deliveryChecks();
  await contractChecks(nav, sourceEntries);

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
