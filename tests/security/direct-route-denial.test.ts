import {beforeAll, describe, expect, it, vi} from "vitest";
import {isolatedStorageRoot, TEST_BOOTSTRAP_SECRET} from "../helpers/runtime";

/**
 * Verweigerungen bleiben Verweigerungen (Abschnitt 37.13).
 *
 * Das API-Gate in `middleware.ts` fängt den Regelfall ab. Diese Suite prüft den
 * zweiten Weg: den Routen-Handler **direkt** aufzurufen (genau das passiert,
 * wenn das Gate durchlässt und erst der Routen-Guard verweigert). Früher löste
 * `guardRequest` dabei eine Ausnahme aus bzw. der Runtime-Handler antwortete
 * mit 503 — beides wäre ein Informations- und Verfügbarkeitsproblem. Erwartet
 * wird eine echte 428/401/403-Antwort, niemals 500/503.
 */

const root = isolatedStorageRoot("sec-direct-denial");
const BASE = "http://localhost:3000";

type Handler = (request: Request) => Response | Promise<Response>;
let routes: Record<string, Handler> = {};
let authRoute: typeof import("../../app/api/auth/route");
let cookie = "";

function request(path: string, headers: Record<string, string> = {}): Request {
  return new Request(`${BASE}${path}`, {headers: {host: "localhost:3000", ...headers}});
}

beforeAll(async () => {
  vi.resetModules();
  routes = {
    "/api/control": (await import("../../app/api/control/route")).GET,
    "/api/missions": (await import("../../app/api/missions/route")).GET,
    "/api/tasks": (await import("../../app/api/tasks/route")).GET,
    "/api/sandboxes": (await import("../../app/api/sandboxes/route")).GET,
    "/api/runtime": (await import("../../app/api/runtime/route")).GET,
    "/api/errors": (await import("../../app/api/errors/route")).GET,
    "/api/authority": (await import("../../app/api/authority/route")).GET,
    "/api/governance": (await import("../../app/api/governance/route")).GET
  };
  authRoute = await import("../../app/api/auth/route");
  expect(root).toContain("sec-direct-denial");
});

async function call(path: string, cookieValue?: string): Promise<Response> {
  const handler = routes[path];
  return handler(request(path, cookieValue ? {cookie: cookieValue} : {}));
}

describe("Direkter Routenaufruf ohne Gate", () => {
  it("verweigert vor dem Bootstrap fail closed mit 428 statt einer Ausnahme", async () => {
    for (const [path, handler] of Object.entries(routes)) {
      const response = await handler(request(path));
      expect(response.status, `${path} muss fail closed sein`).toBe(428);
      const body = (await response.json()) as {error?: string};
      expect(body.error, `${path} liefert einen Grund`).toBeTruthy();
    }
  });

  it("verweigert nach dem Bootstrap ohne Session mit 401 (kein 500/503)", async () => {
    const bootstrap = await authRoute.POST(
      new Request(`${BASE}/api/auth`, {
        method: "POST",
        headers: {"content-type": "application/json"},
        body: JSON.stringify({action: "bootstrap", secret: TEST_BOOTSTRAP_SECRET, creatorName: "Gate-Tester"})
      })
    );
    expect(bootstrap.status).toBe(201);
    cookie = (bootstrap.headers.get("set-cookie") ?? "").split(";")[0];

    for (const [path, handler] of Object.entries(routes)) {
      const response = await handler(request(path));
      expect(response.status, `${path} muss 401 liefern`).toBe(401);
      const body = (await response.json()) as {error?: string};
      expect(body.error, `${path} nennt den Code`).toBe("UNAUTHENTICATED");
    }
  });

  it("liefert mit Session echte Daten (die Abbildung blockiert nichts)", async () => {
    for (const path of Object.keys(routes)) {
      const response = await call(path, cookie);
      expect(response.status, `${path} muss mit Session antworten`).toBe(200);
    }
  });

  it("akzeptiert kein Agenten-/Legacy-Token auf Leserouten", async () => {
    const response = await call("/api/runtime", "bob_session=ungueltig");
    expect(response.status).toBe(401);
    const forged = await routes["/api/runtime"](request("/api/runtime", {authorization: "Bearer angreifer"}));
    expect(forged.status).toBe(401);
  });
});
