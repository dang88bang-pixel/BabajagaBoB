import {beforeAll, describe, expect, it, vi} from "vitest";
import {isolatedStorageRoot, TEST_BOOTSTRAP_SECRET} from "../helpers/runtime";

/**
 * Leseantworten dürfen kein Token-Geheimnismaterial enthalten.
 *
 * Gefundener Fehler: `GET /api/capabilities` und `GET /api/authority` lieferten
 * `secretHash` jedes Capability-Tokens an den Client. Der Hash ist für die
 * server-seitige Prüfung nötig, für die Oberfläche wertlos — und Zugangs-
 * material gehört nicht in den Browser. Geprüft wird gegen die **echten**
 * Routen-Handler (nicht gegen eine Nachbildung).
 */

const root = isolatedStorageRoot("token-projection");
void root;

const BASE = "http://localhost:3000";
let cookie = "";
let capabilities: typeof import("../../app/api/capabilities/route");
let authority: typeof import("../../app/api/authority/route");
let authorityLib: typeof import("../../lib/authority");

function authed(path: string) {
  return new Request(`${BASE}${path}`, {headers: {cookie}});
}

beforeAll(async () => {
  vi.resetModules();
  const auth = await import("../../app/api/auth/route");
  capabilities = await import("../../app/api/capabilities/route");
  authority = await import("../../app/api/authority/route");
  authorityLib = await import("../../lib/authority");

  const login = await auth.POST(
    new Request(`${BASE}/api/auth`, {
      method: "POST",
      headers: {"content-type": "application/json"},
      body: JSON.stringify({action: "bootstrap", secret: TEST_BOOTSTRAP_SECRET, creatorName: "Token-Tester"})
    })
  );
  expect(login.status).toBe(201);
  cookie = (login.headers.get("set-cookie") ?? "").split(";")[0];

  const issued = await capabilities.POST(
    new Request(`${BASE}/api/capabilities`, {
      method: "POST",
      headers: {"content-type": "application/json", cookie},
      body: JSON.stringify({
        kind: "TOKEN",
        token: {
          subject: "AG-QA",
          taskId: "TASK-PROJECTION",
          sandboxId: "SBX-PROJECTION",
          environment: "test",
          capabilities: ["exec:run"],
          risk: "LOW",
          issuedBy: "CREATOR",
          expiresAt: new Date(Date.now() + 5 * 60_000).toISOString()
        }
      })
    })
  );
  expect(issued.status).toBe(201);
});

describe("Token-Leseprojektion", () => {
  it("legt serverseitig weiterhin den Hash ab", () => {
    const tokens = authorityLib.capabilityTokens();
    expect(tokens.length).toBeGreaterThan(0);
    expect(tokens.every(token => typeof token.secretHash === "string" && token.secretHash.length > 0)).toBe(true);
  });

  it("liefert über /api/capabilities keine Hash-Felder", async () => {
    const response = await capabilities.GET(authed("/api/capabilities"));
    expect(response.status).toBe(200);
    const body = (await response.json()) as {tokens: Record<string, unknown>[]};
    expect(body.tokens.length).toBeGreaterThan(0);
    expect(body.tokens.some(token => "secretHash" in token)).toBe(false);
    expect(JSON.stringify(body)).not.toContain("secretHash");
  });

  it("liefert über /api/authority keine Hash-Felder", async () => {
    const response = await authority.GET(authed("/api/authority"));
    expect(response.status).toBe(200);
    const body = (await response.json()) as {tokens: Record<string, unknown>[]};
    expect(body.tokens.length).toBeGreaterThan(0);
    expect(JSON.stringify(body)).not.toContain("secretHash");
  });

  it("behält die für die Oberfläche nötigen Metadaten", async () => {
    const response = await capabilities.GET(authed("/api/capabilities"));
    const body = (await response.json()) as {tokens: Record<string, unknown>[]};
    const token = body.tokens.find(entry => entry.taskId === "TASK-PROJECTION");
    expect(token).toBeDefined();
    for (const key of ["id", "subject", "sandboxId", "environment", "capabilities", "risk", "expiresAt", "revoked"]) {
      expect(token).toHaveProperty(key);
    }
  });
});
