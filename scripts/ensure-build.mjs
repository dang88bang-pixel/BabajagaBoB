#!/usr/bin/env node
/**
 * Baut die Anwendung **nur, wenn sie fehlt** — Vorbedingung für `npm test`.
 *
 * Warum es das gibt: `tests/integration/graceful-shutdown.test.ts` startet den
 * echten Produktionsserver (`node server.mjs`). Ohne `.next/BUILD_ID` schlug
 * `npm test` auf einem frischen Checkout ab — laut, aber mit einer Ursache, die
 * nichts mit dem Test zu tun hat („Produktionsbuild fehlt\"). Ein frischer
 * Klon muss mit `npm ci && npm test` grün werden; deshalb erzeugt der
 * `pretest`-Haken den Build bei Bedarf selbst.
 *
 * Verhalten:
 *   - `.next/BUILD_ID` vorhanden → nichts tun, Exit 0 (wiederholte Läufe sind
 *     damit kostenlos, CI-Jobs mit eigenem Build-Schritt unberührt),
 *   - fehlt der Build → `npm run build` ausführen; ein Fehlbuild ist ein
 *     Fehlbuild (Exit 1, keine stille Fortsetzung),
 *   - `BOB_SKIP_PRETEST_BUILD=1` überspringt den Haken (z. B. wenn ein Job den
 *     Build bewusst selbst steuert). Der Integrationstest meldet dann weiterhin
 *     klar, dass der Build fehlt.
 */
import {existsSync} from "node:fs";
import {join} from "node:path";
import {spawnSync} from "node:child_process";

const buildId = join(process.cwd(), ".next", "BUILD_ID");

if (existsSync(buildId)) {
  process.stdout.write("ensure-build: vorhandener Produktionsbuild wird verwendet (.next/BUILD_ID).\n");
  process.exit(0);
}

if (process.env.BOB_SKIP_PRETEST_BUILD === "1") {
  process.stdout.write("ensure-build: übersprungen (BOB_SKIP_PRETEST_BUILD=1) — Prozesstests können dann fehlen.\n");
  process.exit(0);
}

process.stdout.write("ensure-build: kein Produktionsbuild gefunden — `npm run build` wird ausgeführt.\n");
const result = spawnSync("npm", ["run", "build"], {stdio: "inherit", shell: false});
if (result.error) {
  process.stderr.write(`ensure-build: Build konnte nicht gestartet werden: ${result.error.message}\n`);
  process.exit(1);
}
process.exit(result.status ?? 1);
