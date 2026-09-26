import http from "node:http";
import next from "next";

/**
 * Produktionsserver (Abschnitt 37.15 / OPS-004).
 *
 * `next start` beendet den Prozess bei SIGTERM sofort: Verbindungen brechen ab,
 * ein Ausrollvorgang sieht einen harten Abbruch statt einer geordneten Übergabe.
 * Dieser Server ist der explizite Betriebsweg:
 *
 *   - fester Bind (`BOB_HOSTNAME`, Standard `0.0.0.0` — im Container/Preview
 *     muss der Dienst von außen erreichbar sein),
 *   - `SIGTERM`/`SIGINT` leiten die Drainage ein: keine neuen Verbindungen,
 *     laufende Anfragen dürfen zu Ende laufen,
 *   - nach `BOB_SHUTDOWN_TIMEOUT_MS` (Standard 15 s) werden verbliebene
 *     Verbindungen geschlossen, Exit-Code 1 — ein erzwungenes Ende wird nicht
 *     als sauberer Stopp ausgegeben,
 *   - der Drainage-Zustand geht über `BOB_SHUTTING_DOWN=1` an die Control Plane:
 *     `lib/shutdown.ts#isShuttingDown()` liest genau dieses Signal, und
 *     `guardOrDeny` verweigert dann neue Arbeit mit 503. Bewusst eine
 *     Umgebungsvariable statt eines Imports: Next lädt Routen-Module in einem
 *     eigenen Modulkontext, ein Prozess-lokaler Zustand wäre dort unsichtbar.
 *
 * Wichtig: Diese Datei wird von Node direkt ausgeführt (kein Build-Schritt).
 * Sie darf deshalb **nur** auflösbare Importe enthalten — ein Import auf eine
 * TypeScript-Datei ließe den Produktionsserver nicht starten.
 * `tests/integration/graceful-shutdown.test.ts` startet ihn wirklich.
 */

const dev = process.env.NODE_ENV !== "production";
const hostname = process.env.BOB_HOSTNAME ?? "0.0.0.0";
const port = Number(process.env.PORT ?? 3000);
const shutdownTimeoutMs = Math.max(1000, Number(process.env.BOB_SHUTDOWN_TIMEOUT_MS ?? 15000));

const app = next({dev, hostname, port});
const handle = app.getRequestHandler();
await app.prepare();

const server = http.createServer((request, response) => {
  handle(request, response).catch(error => {
    if (!response.headersSent) response.writeHead(500, {"content-type": "application/json"});
    response.end(JSON.stringify({error: "INTERNAL_SERVER_ERROR"}));
    process.stderr.write(`BabajagaBoB request failed: ${String(error)}\n`);
  });
});

let shuttingDown = false;

function beginDrain(signal) {
  // Sichtbar für die Control Plane (andere Modulkontexte) und für Ausrollskripte.
  process.env.BOB_SHUTTING_DOWN = "1";
  process.stderr.write(`BabajagaBoB draining (${signal})\n`);
}

async function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  beginDrain(signal);
  const force = setTimeout(() => {
    process.stderr.write(`BabajagaBoB shutdown timeout after ${shutdownTimeoutMs}ms — forcing exit\n`);
    server.closeAllConnections?.();
    process.exit(1);
  }, shutdownTimeoutMs);
  force.unref();
  server.close(() => {
    clearTimeout(force);
    process.stdout.write("BabajagaBoB stopped cleanly\n");
    process.exit(0);
  });
}

process.once("SIGTERM", () => void shutdown("SIGTERM"));
process.once("SIGINT", () => void shutdown("SIGINT"));

server.listen(port, hostname, () => {
  process.stdout.write(`BabajagaBoB listening on http://${hostname}:${port}\n`);
});
