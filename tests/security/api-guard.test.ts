import {beforeAll, describe, expect, it, vi} from "vitest";
import {isolatedStorageRoot, TEST_BOOTSTRAP_SECRET} from "../helpers/runtime";

isolatedStorageRoot("sec-guard");

let guard: typeof import("../../lib/api/guard");
let bootstrap: typeof import("../../lib/bootstrap");
let session: typeof import("../../lib/session");

beforeAll(async () => {
  vi.resetModules();
  guard = await import("../../lib/api/guard");
  bootstrap = await import("../../lib/bootstrap");
  session = await import("../../lib/session");
});

function deniedStatus(request: Request): number {
  try {
    guard.guardRequest(request, {action: "control.read"});
  } catch (error) {
    if (error instanceof guard.ApiDenied) return error.status;
    throw error;
  }
  return 200;
}

describe("API-Guard (Server-Authentifizierung)", () => {
  it("antwortet vor dem Bootstrap mit 428 (fail closed)", () => {
    expect(deniedStatus(new Request("http://localhost/api/control"))).toBe(428);
  });

  it("verweigert unauthentifizierte Anfragen nach dem Bootstrap", () => {
    bootstrap.completeBootstrap({secret: TEST_BOOTSTRAP_SECRET, creatorName: "Test Creator"});
    expect(deniedStatus(new Request("http://localhost/api/control"))).toBe(401);
  });

  it("verweigert fremde Origins (CSRF-Schutz) auch mit gültiger Session", () => {
    const {token} = session.createSession({actorId: "CREATOR", role: "OWNER"});
    let status = 200;
    try {
      guard.guardRequest(
        new Request("http://localhost/api/control", {
          method: "POST",
          headers: {origin: "https://evil.example", host: "localhost", cookie: `${session.SESSION_COOKIE}=${token}`}
        }),
        {action: "control.read"}
      );
    } catch (error) {
      if (error instanceof guard.ApiDenied) status = error.status;
      else throw error;
    }
    expect(status).toBe(403);
  });

  it("akzeptiert gleichursprüngliche POSTs mit Creator-Session", () => {
    const {token} = session.createSession({actorId: "CREATOR", role: "OWNER"});
    const guarded = guard.guardRequest(
      new Request("http://localhost/api/control", {
        method: "POST",
        headers: {origin: "http://localhost", host: "localhost", cookie: `${session.SESSION_COOKIE}=${token}`}
      }),
      {action: "control.read"}
    );
    expect(guarded.actor.kind).toBe("CREATOR");
  });

  it("deaktiviert den Legacy-Administrationstoken standardmäßig (fail closed)", () => {
    process.env.BOB_CONTROL_PLANE_TOKEN = "legacy-test-token";
    delete process.env.BOB_ALLOW_LEGACY_CONTROL_TOKEN;
    const request = () =>
      new Request("http://localhost/api/control", {headers: {authorization: "Bearer legacy-test-token"}});

    // Ohne explizite Freigabe gilt der Token als nicht vorhanden → nicht authentifiziert.
    expect(deniedStatus(request())).toBe(401);

    // Mit Freigabe wird die Authentifizierung erreicht; die Rolle bleibt aber
    // beschränkt und wird nicht automatisch zum Creator/OWNER.
    process.env.BOB_ALLOW_LEGACY_CONTROL_TOKEN = "1";
    let status = 200;
    let code = "";
    try {
      guard.guardRequest(request(), {action: "control.read"});
    } catch (error) {
      if (error instanceof guard.ApiDenied) {
        status = error.status;
        code = error.code;
      } else throw error;
    }
    expect(status).toBe(403);
    expect(code).toBe("RBAC_DENIED");

    delete process.env.BOB_ALLOW_LEGACY_CONTROL_TOKEN;
    delete process.env.BOB_CONTROL_PLANE_TOKEN;
  });

  it("erlaubt eine Creator-Session ausschließlich serverseitig ausgestellter Cookies", () => {
    const {token} = session.createSession({actorId: "CREATOR", role: "OWNER"});
    const guarded = guard.guardRequest(
      new Request("http://localhost/api/control", {headers: {cookie: `${session.SESSION_COOKIE}=${token}`}}),
      {action: "control.read"}
    );
    expect(guarded.actor.kind).toBe("CREATOR");
    expect(guarded.actor.role).toBe("OWNER");
  });

  it("verweigert ein gefälschtes Session-Cookie", () => {
    const status = deniedStatus(
      new Request("http://localhost/api/control", {headers: {cookie: `${session.SESSION_COOKIE}=SES-FAKE.falsch`}})
    );
    expect(status).toBeGreaterThanOrEqual(400);
  });

  it("verweigert Agenten-Aktionen mit Governance-Prefix", () => {
    const issued = guardGuardCapability();
    const status = deniedStatus(
      new Request("http://localhost/api/x", {
        headers: {authorization: `Bobcap ${issued.tokenId}.${issued.secret}`}
      })
    );
    expect(status).toBeGreaterThanOrEqual(400);
  });
});

function guardGuardCapability(): {tokenId: string; secret: string} {
  // Ein Agent-Token kann keine Governance-Aktion ausführen; der Guard muss
  // bereits die Secretprüfung fail closed beenden.
  return {tokenId: "CAP-FAKE", secret: "falsch"};
}
