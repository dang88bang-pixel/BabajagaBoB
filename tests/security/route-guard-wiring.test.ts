import fs from "node:fs";
import path from "node:path";
import {describe, expect, it} from "vitest";

/**
 * Statische Verdrahtungsprüfung (Phase 4 / 7.5, verriegelt 2026-09-27):
 * Jede API-Route muss in jedem exportierten HTTP-Handler eine
 * aktionsspezifische Guard-Prüfung aufrufen. Die Middleware ist fail closed,
 * aber sie kennt keine Aktion, kein Risiko und keine Kill-Switch-Ziele —
 * diese Defense-in-depth-Ebene darf nicht stillschweigend entfallen.
 *
 * Ausnahmen sind ausdrücklich erlaubt und hier benannt (nicht entdeckbar):
 * - `/api/auth` stellt die Session überhaupt erst aus (siehe middleware.ts).
 */
const API_ROOT = path.join(process.cwd(), "app", "api");
const HANDLER = /export (?:async )?function (GET|POST|PUT|PATCH|DELETE)\b/g;
const GUARDED = /guardRequest|guardOrDeny|publicAction/;

/** Dokumentierte, bewusst unbewachte Routen (mit Begründung). */
const EXCEPTIONS: Record<string, string> = {
  "app/api/auth/route.ts": "stellt die Session aus; einzige Middleware-Ausnahme (siehe middleware.ts)"
};

function routeFiles(): string[] {
  const found: string[] = [];
  const walk = (dir: string) => {
    for (const entry of fs.readdirSync(dir, {withFileTypes: true})) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name === "route.ts") found.push(full);
    }
  };
  walk(API_ROOT);
  return found.sort();
}

describe("Guard-Verdrahtung aller API-Routen (Defense-in-depth)", () => {
  it("jede Route existiert unter app/api und hat mindestens einen Handler", () => {
    const files = routeFiles();
    expect(files.length).toBeGreaterThan(40);
    for (const file of files) {
      const source = fs.readFileSync(file, "utf8");
      const handlers = [...source.matchAll(HANDLER)].map(m => m[1]);
      expect(handlers.length, `${file} exportiert keinen HTTP-Handler`).toBeGreaterThan(0);
    }
  });

  it("jeder HTTP-Handler ruft einen aktionsspezifischen Guard auf (oder ist dokumentierte Ausnahme)", () => {
    const violations: string[] = [];
    for (const file of routeFiles()) {
      const relative = path.relative(process.cwd(), file);
      const source = fs.readFileSync(file, "utf8");
      const segments = source.split(/(?=export (?:async )?function (?:GET|POST|PUT|PATCH|DELETE)\b)/);
      for (const segment of segments) {
        const match = /^export (?:async )?function (GET|POST|PUT|PATCH|DELETE)/.exec(segment);
        if (!match) continue;
        const handler = match[1];
        if (!GUARDED.test(segment)) {
          if (EXCEPTIONS[relative]) continue;
          violations.push(`${relative}::${handler}`);
        }
      }
    }
    expect(violations, `Handler ohne Guard-Verdrahtung: ${violations.join(", ")}`).toEqual([]);
  });

  it("Ausnahmen sind begründet und bleiben explizit", () => {
    for (const [file, reason] of Object.entries(EXCEPTIONS)) {
      expect(fs.existsSync(path.join(process.cwd(), file)), `${file} fehlt`).toBe(true);
      expect(reason.length).toBeGreaterThan(10);
    }
  });
});
