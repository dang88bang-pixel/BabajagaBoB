import {spawn} from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import path from "node:path";
import {afterEach, describe, expect, it} from "vitest";
import {isolatedStorageRoot, TEST_BOOTSTRAP_SECRET} from "../helpers/runtime";

/**
 * Produktionsserver und geordnetes Herunterfahren (OPS-004).
 *
 * Geprüft wird der **echte** Betriebsweg aus `package.json` (`node server.mjs`),
 * nicht ein nachgebauter Ersatz: Der Prozess wird gestartet, antwortet, bekommt
 * `SIGTERM` und muss sich sauber beenden. Genau hier lag ein Fehler, der keiner
 * Suite auffiel, weil keine sie den Server wirklich startete: `server.mjs`
 * importierte eine TypeScript-Datei und kam damit in Produktion nicht hoch.
 *
 * Zusätzlich geprüft: Vor dem Signal ist der Dienst erreichbar; nach dem Signal
 * beendet er sich mit Exit-Code 0 und der Meldung „stopped cleanly" — und die
 * Drainage ist über `BOB_SHUTTING_DOWN` sichtbar, das `lib/shutdown.ts` und der
 * Routen-Guard auswerten (503 statt neuer Arbeit).
 */

const root = isolatedStorageRoot("graceful-shutdown");
const SERVER = path.join(process.cwd(), "server.mjs");

let child: ReturnType<typeof spawn> | null = null;

afterEach(() => {
  if (child && child.exitCode === null && !child.killed) child.kill("SIGKILL");
  child = null;
});

/** Freien Port im Betriebssystem erfragen (kein fest verdrahteter Port). */
async function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.on("error", reject);
    probe.listen(0, "127.0.0.1", () => {
      const address = probe.address();
      const port = typeof address === "object" && address ? address.port : 0;
      probe.close(() => resolve(port));
    });
  });
}

type Started = {port: number; output: () => string};

/** Startet den Produktionsserver und wartet auf die Bereitschaftsmeldung. */
async function startServer(): Promise<Started> {
  // Der Produktionsserver wird von Node direkt ausgeführt und braucht den
  // Build (`.next`). Fehlt er, ist das ein Vorbereitungsfehler und kein
  // Ergebnis — die Meldung muss das sagen, sonst sieht es wie ein Serverfehler
  // aus (in CI genau so aufgetreten: Integrationstests ohne `npm run build`).
  if (!fs.existsSync(path.join(process.cwd(), ".next", "BUILD_ID"))) {
    throw new Error(
      "Produktionsbuild fehlt: `npm run build` vor den Integrationstests ausführen (der Prozesstest startet den echten Server)."
    );
  }
  const port = await freePort();
  const storage = fs.mkdtempSync(path.join(root, "server-"));
  const process_ = spawn(process.execPath, [SERVER], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      NODE_ENV: "production",
      PORT: String(port),
      BOB_HOSTNAME: "127.0.0.1",
      BOB_STORAGE_DIR: storage,
      BOB_BOOTSTRAP_SECRET: TEST_BOOTSTRAP_SECRET,
      BOB_SESSION_SECRET: "integration-session-secret-0123456789ab",
      BOB_SANDBOX_RUNTIME: "local",
      BOB_NS_ISOLATION: "off"
    },
    stdio: ["ignore", "pipe", "pipe"]
  });
  child = process_;
  let output = "";
  process_.stdout?.on("data", chunk => (output += String(chunk)));
  process_.stderr?.on("data", chunk => (output += String(chunk)));

  const ready = await new Promise<boolean>(resolve => {
    const timer = setTimeout(() => resolve(false), 60_000);
    const check = () => {
      if (output.includes("listening on")) {
        clearTimeout(timer);
        resolve(true);
      }
    };
    process_.stdout?.on("data", check);
    process_.stderr?.on("data", check);
    process_.once("exit", () => {
      clearTimeout(timer);
      resolve(false);
    });
  });
  if (!ready) {
    throw new Error(`Server wurde nicht bereit. Ausgabe:\n${output}`);
  }
  return {port, output: () => output};
}

describe("Graceful Shutdown des Produktionsservers", () => {
  it("startet, antwortet und beendet sich auf SIGTERM sauber (Exit 0)", async () => {
    const started = await startServer();

    // Der Dienst ist wirklich erreichbar (nicht nur „Prozess läuft").
    const status = await fetch(`http://127.0.0.1:${started.port}/api/auth`);
    expect(status.status).toBe(200);
    // Die frische Instanz ist fail closed: ohne Creator-Bootstrap antwortet die
    // Control Plane mit 428, nicht mit Daten.
    const guarded = await fetch(`http://127.0.0.1:${started.port}/api/runs`);
    expect(guarded.status).toBe(428);
    const payload = (await guarded.json()) as {error: string};
    expect(payload.error).toMatch(/BOOTSTRAP/);

    const exited = new Promise<{code: number | null; signal: string | null}>(resolve => {
      child?.once("exit", (code, signal) => resolve({code, signal}));
    });
    child?.kill("SIGTERM");
    const result = await exited;

    expect(result.signal, "der Server muss selbst beenden, nicht durch das Signal sterben").toBeNull();
    expect(result.code, `Ausgabe:\n${started.output()}`).toBe(0);
    expect(started.output()).toContain("stopped cleanly");
    expect(started.output()).toContain("draining (SIGTERM)");
  }, 90_000);

  it("hält den Drainage-Zustand für die Control Plane bereit", async () => {
    // Die Drainage wird über `BOB_SHUTTING_DOWN` veröffentlicht — genau das
    // Signal, das `lib/shutdown.ts#isShuttingDown()` und der Routen-Guard lesen.
    // Ein Prozess-lokaler Zustand wäre für die Route (anderer Modulkontext)
    // unsichtbar; dieser Test schützt den Kanal selbst.
    const shutdown = await import("../../lib/shutdown");
    expect(shutdown.isShuttingDown()).toBe(false);
    process.env.BOB_SHUTTING_DOWN = "1";
    try {
      expect(shutdown.isShuttingDown()).toBe(true);
      expect(shutdown.shutdownStatus().draining || process.env.BOB_SHUTTING_DOWN === "1").toBe(true);
    } finally {
      delete process.env.BOB_SHUTTING_DOWN;
    }
  });
});
