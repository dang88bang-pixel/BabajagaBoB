import {existsSync, readdirSync, readFileSync, statSync} from "node:fs";
import {join} from "node:path";
import {describe, expect, it} from "vitest";

/**
 * Quellvertrag der Oberfläche.
 *
 * Diese Tests prüfen die Control-Center-Komponente gegen den echten Code — nicht
 * gegen eine nachgebildete API. Anlass waren zwei echte Defekte:
 *  1. literales `**nicht lesbar**` im JSX-Text (wurde als Sternchen angezeigt),
 *  2. Spalten der Runtimes-Tabelle (`language`, `mode`, `status`, `notes`),
 *     die im Datenmodell nicht existieren und dauerhaft „—“ gezeigt hätten.
 */

const SOURCE_PATH = join(process.cwd(), "components", "control-center.tsx");
const source = readFileSync(SOURCE_PATH, "utf8");

type Column = {key: string; label: string};
type Entry = {id: string; url: string; path: string[]; columns: Column[]};

const START = new RegExp("^ {2}([A-Za-z]+): \\{$");
const END = new RegExp("^ {2}\\},?$");

/** Liest die `SOURCES`-Tabelle zeilenweise (verschachtelte Blöcke beenden keinen Eintrag). */
function parseSources(): Entry[] {
  const block = source.slice(source.indexOf("const SOURCES"), source.indexOf("type PanelState")).split("\n");
  const entries: Entry[] = [];
  let current: {id: string; body: string[]} | null = null;
  for (const line of block) {
    if (current === null) {
      const start = START.exec(line);
      if (start) current = {id: start[1], body: []};
      continue;
    }
    if (END.test(line)) {
      const body = current.body.join("\n");
      entries.push({
        id: current.id,
        url: /url: "([^"]+)"/.exec(body)?.[1] ?? "",
        path: [...(/path: \[([^\]]*)\]/.exec(body)?.[1] ?? "").matchAll(/"([^"]+)"/g)].map(match => match[1]),
        columns: [...body.matchAll(/\{key: "([^"]+)", label: "([^"]+)"/g)].map(match => ({key: match[1], label: match[2]}))
      });
      current = null;
      continue;
    }
    current.body.push(line);
  }
  return entries;
}

/** Ist ein Feldname in Typen oder Objektliteralen von lib/ und app/ deklariert? */
function declared(field: string): boolean {
  const pattern = new RegExp("\\b" + field + "\\??\\s*:", "m");
  const stack = ["lib", "app"];
  while (stack.length > 0) {
    const dir = stack.pop() as string;
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) stack.push(full);
      else if (/\.tsx?$/.test(entry) && !entry.endsWith(".d.ts") && pattern.test(readFileSync(full, "utf8"))) return true;
    }
  }
  return false;
}

/** Übersetzt einen API-Pfad in die zugehörige Route-Datei. */
function routeFile(url: string): string {
  const clean = url.split("?")[0].replace(/^\//, "");
  return join(process.cwd(), "app", clean, "route.ts");
}

const entries = parseSources();

describe("Oberflächenvertrag", () => {
  it("liest die Datenquellen der Oberfläche", () => {
    expect(entries.length).toBeGreaterThanOrEqual(27);
    expect(entries.every(entry => entry.id.length > 0 && entry.url.length > 0)).toBe(true);
    expect(entries.every(entry => entry.columns.length > 0)).toBe(true);
  });

  it("zeigt keinen literalen Markdown-Text an", () => {
    // Nur JSX-Textknoten zählen: ein `**…**` nach `>` bzw. am Zeilenanfang,
    // ohne `<`, `>`, `{`, `}` oder Anführungszeichen dazwischen. Template-Literale
    // (Backticks) in Ausdrücken sind erlaubter Code.
    const offenders = source
      .split("\n")
      .map((line, index) => ({line, number: index + 1}))
      .filter(({line}) => !/^\s*(\*|\/\/|\/\*)/.test(line)) // Kommentare sind erlaubt
      .filter(({line}) => /(>|^)\s*[^<>{}"\n]*\*\*[^<>{}"\n]/.test(line))
      .map(({line, number}) => `${number}: ${line.trim().slice(0, 80)}`);
    expect(offenders).toEqual([]);
  });

  it("verwendet nur Spalten, die im Datenmodell deklariert sind", () => {
    const unknown = entries.flatMap(entry => entry.columns.filter(column => !declared(column.key)).map(column => `${entry.id}.${column.key}`));
    expect(unknown).toEqual([]);
  });

  it("bindet jede Datenquelle an eine existierende Route", () => {
    const missing = entries.filter(entry => !existsSync(routeFile(entry.url))).map(entry => `${entry.id} → ${entry.url}`);
    expect(missing).toEqual([]);
  });

  it("führt in der Runtimes-Tabelle den echten Laufzeitvertrag", () => {
    const runtimes = entries.find(entry => entry.id === "Runtimes");
    expect(runtimes).toBeDefined();
    const keys = (runtimes as Entry).columns.map(column => column.key);
    expect(keys).toContain("id");
    expect(keys).toContain("networkDefault");
    expect(keys).toContain("sandboxSupport");
    // Felder, die es im RuntimeDefinition-Vertrag nie gab:
    expect(keys).not.toContain("language");
    expect(keys).not.toContain("notes");
    expect(keys).not.toContain("mode");
    expect(keys).not.toContain("status");
  });
});
