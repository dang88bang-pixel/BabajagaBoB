import fs from "node:fs";
import path from "node:path";
import {describe, expect, it} from "vitest";

/**
 * Struktureller Regressionstest für die API-Grenze.
 *
 * Die Middleware schließt jede `/api/*`-Route ohne Session. Zusätzlich muss jede
 * Route ihre konkrete Aktion prüfen (`guardRequest`/`guardOrDeny`). Dieser Test
 * verhindert, dass eine neue Route ohne Aktionsprüfung hinzukommt – die Lücke
 * wäre sonst nur zur Laufzeit und nur bei passender Authentifizierung sichtbar.
 *
 * Ausnahme ist ausschließlich die Authentifizierungsstrecke `/api/auth`, die die
 * Session selbst ausstellt.
 */
const API_ROOT = path.resolve(__dirname, "../../app/api");

function routeFiles(): string[] {
  return fs
    .readdirSync(API_ROOT, {withFileTypes: true})
    .filter(entry => entry.isDirectory())
    .map(entry => path.join(API_ROOT, entry.name, "route.ts"))
    .filter(file => fs.existsSync(file));
}

function source(file: string): string {
  return fs.readFileSync(file, "utf8");
}

describe("API-Grenze (struktureller Vertrag)", () => {
  it("findet überhaupt Routen (Test wirkt nicht ins Leere)", () => {
    expect(routeFiles().length).toBeGreaterThan(30);
  });

  it("prüft in jeder Route außer /api/auth eine konkrete Aktion", () => {
    const offenders = routeFiles()
      .filter(file => path.basename(path.dirname(file)) !== "auth")
      .filter(file => !/guard(Request|OrDeny)\(/.test(source(file)))
      .map(file => path.relative(API_ROOT, file));
    expect(offenders).toEqual([]);
  });

  it("verwendet in jeder Aktion der Routen eine nicht-leere Aktionsbezeichnung", () => {
    const problems: string[] = [];
    for (const file of routeFiles()) {
      const text = source(file);
      if (path.basename(path.dirname(file)) === "auth") continue;
      for (const match of text.matchAll(/guard(?:Request|OrDeny)\([^)]*\{[^}]*action\s*:\s*([^,}]+)/g)) {
        const expression = match[1].trim();
        // Erlaubt sind String-Literale und Template-/Ternär-Ausdrücke, die ihrerseits
        // auf Literalen beruhen (z. B. `sandbox:${action}`).
        const literals = expression.match(/"([a-z][a-z0-9:_-]{2,})"/gi) ?? [];
        if (literals.length === 0 && !/`[a-z][a-z0-9:_-]*/.test(expression)) {
          problems.push(`${path.relative(API_ROOT, file)}: ${expression}`);
        }
      }
    }
    expect(problems).toEqual([]);
  });

  it("prüft jede exportierte Methode einzeln (kein ungeschützter Methodenzweig)", () => {
    const problems: string[] = [];
    for (const file of routeFiles()) {
      const route = path.basename(path.dirname(file));
      const text = source(file);
      const blocks = text.split(/export async function (GET|POST|PATCH|PUT|DELETE)/);
      for (let index = 1; index < blocks.length; index += 2) {
        const method = blocks[index];
        const body = blocks[index + 1].split(/export (?:async )?function/)[0];
        const isAuthRoute = route === "auth" && method === "POST";
        if (isAuthRoute) continue;
        if (!/guard(Request|OrDeny)\(/.test(body)) problems.push(`${route}.${method}`);
      }
    }
    expect(problems).toEqual([]);
  });

  it("verbietet öffentliche Aktionen ohne ausdrückliche Kennzeichnung", () => {
    const offenders = routeFiles()
      .filter(file => path.basename(path.dirname(file)) !== "auth")
      .filter(file => /publicAction\s*:\s*true/.test(source(file)))
      .map(file => path.relative(API_ROOT, file));
    expect(offenders).toEqual([]);
  });
});
