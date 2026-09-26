import fs from "node:fs";
import path from "node:path";
import {beforeAll, describe, expect, it, vi} from "vitest";
import {isolatedStorageRoot, TEST_BOOTSTRAP_SECRET} from "../helpers/runtime";

const root = isolatedStorageRoot("sec-creator-login");

let authRoute: typeof import("../../app/api/auth/route");
let creatorAuth: typeof import("../../lib/creator-auth");
let session: typeof import("../../lib/session");
let bootstrap: typeof import("../../lib/bootstrap");
let audit: typeof import("../../lib/audit");

const AUTH_URL = "http://localhost/api/auth";

function post(body: unknown, cookie?: string): Request {
  return new Request(AUTH_URL, {
    method: "POST",
    headers: {"content-type": "application/json", ...(cookie ? {cookie} : {})},
    body: JSON.stringify(body)
  });
}

function cookieOf(response: Response): string {
  return (response.headers.get("set-cookie") ?? "").split(";")[0];
}

beforeAll(async () => {
  vi.resetModules();
  authRoute = await import("../../app/api/auth/route");
  creatorAuth = await import("../../lib/creator-auth");
  session = await import("../../lib/session");
  bootstrap = await import("../../lib/bootstrap");
  audit = await import("../../lib/audit");
});

describe("Creator-Anmeldung (Re-Authentifizierung)", () => {
  it("legt vor dem Bootstrap kein Login-Secret an", async () => {
    const status = (await (await authRoute.GET(new Request(AUTH_URL))).json()) as {loginAvailable: boolean};
    expect(status.loginAvailable).toBe(false);
    expect(fs.existsSync(path.join(root, "creator-token"))).toBe(false);
  });

  it("erzeugt beim Bootstrap ein Creator-Secret als Datei mit Rechten 0600", async () => {
    const response = await authRoute.POST(post({action: "bootstrap", secret: TEST_BOOTSTRAP_SECRET, creatorName: "Test Creator"}));
    expect(response.status).toBe(201);

    const file = path.join(root, "creator-token");
    expect(fs.existsSync(file)).toBe(true);
    expect(fs.statSync(file).mode & 0o777).toBe(0o600);
    const secret = fs.readFileSync(file, "utf8").trim();
    expect(secret.length).toBeGreaterThanOrEqual(32);

    // Das Secret wird nirgends über die API ausgeliefert.
    const status = (await (await authRoute.GET(new Request(AUTH_URL))).json()) as Record<string, unknown>;
    expect(status.loginAvailable).toBe(true);
    expect(JSON.stringify(status)).not.toContain(secret);
    const report = creatorAuth.creatorAuthReport();
    expect(report.configured).toBe(true);
    expect(JSON.stringify(report)).not.toContain(secret);

    await expect(
      authRoute.POST(post({action: "bootstrap", secret: TEST_BOOTSTRAP_SECRET, creatorName: "Zweiter"})).then(r => r.status)
    ).resolves.toBeGreaterThanOrEqual(400);
  });

  it("verweigert ein falsches Creator-Secret und auditiert die Ablehnung", async () => {
    const before = audit.auditSnapshot(200).filter(record => record.decision === "DENY").length;
    const response = await authRoute.POST(post({action: "login", secret: "definitiv-falsch"}));
    expect(response.status).toBe(403);
    expect(((await response.json()) as {error: string}).error).toBe("CREATOR_SECRET_MISMATCH");
    const after = audit.auditSnapshot(200).filter(record => record.decision === "DENY").length;
    expect(after).toBeGreaterThan(before);
    expect(audit.verifyAuditChain().valid).toBe(true);
  });

  it("stellt mit dem korrekten Secret eine Creator-Session aus", async () => {
    const secret = fs.readFileSync(path.join(root, "creator-token"), "utf8").trim();
    const response = await authRoute.POST(post({action: "login", secret}));
    expect(response.status).toBe(201);
    const cookie = cookieOf(response);
    expect(cookie).toContain(session.SESSION_COOKIE);
    expect(response.headers.get("set-cookie")).toContain("HttpOnly");

    const resolved = session.resolveSession(cookie.split("=")[1]);
    expect(resolved?.actorId).toBe("CREATOR");
    expect(resolved?.role).toBe("OWNER");

    // Nach erfolgreicher Anmeldung ist der Fehlversuchszähler zurückgesetzt.
    expect(creatorAuth.creatorLockState()).toEqual({locked: false, lockedUntil: null, failures: 0});
  });

  it("verweigert die Anmeldung nach Root-Widerruf (fail closed)", async () => {
    const secret = fs.readFileSync(path.join(root, "creator-token"), "utf8").trim();
    bootstrap.revokeRoot("Test-Widerruf", "CREATOR");
    const response = await authRoute.POST(post({action: "login", secret}));
    expect(response.status).toBe(423);
    expect(((await response.json()) as {error: string}).error).toBe("ROOT_REVOKED");
  });
});
